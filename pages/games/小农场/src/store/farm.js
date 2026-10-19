/**
 * 农场领域：种植 / 浇水 / 施肥 / 除虫除草 / 收获 / 土地升级。
 *
 * 约定：每个动作先在内存里改完，再用 commit() 一次性落盘，
 * 保证「地块 + 背包 + 金币 + 经验」要么全成功要么全不变。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state, getPlot } from './state.js';
import * as player from './player.js';
import * as inventory from './inventory.js';
import { CROPS } from '../data/crops.js';
import { SOILS } from '../data/soils.js';
import { unlockedPlotCount as countUnlocked } from '../data/progression.js';
import { seedId, produceId } from '../data/keys.js';
import { randInt } from '../core/utils.js';
import { completeGuide, recordHarvested, recordPlanted } from './codex.js';
import { notify } from './notify.js';

/** 杂草 / 害虫造成减产的概率 */
const PEST_DAMAGE_CHANCE = 0.4;
const PEST_DAMAGE_RATIO = 0.7;

/** 多次收获作物，第 n 次收获的经验倍率（与 tools/gen-data.mjs 的平衡公式保持一致） */
export const REGROW_EXP_DECAY = 0.8;

/** 一次再生轮次的最短时长，防止高等级作物的 regrow 系数把时间压没 */
const MIN_REGROW_MS = 30_000;

/* ---------- 查询 ---------- */

/** 地块是否已解锁 */
const isUnlocked = (plot) => plot.id < countUnlocked(state.player.level);

/** 当前已解锁的地块总数 */
export const unlockedPlotCount = () => countUnlocked(state.player.level);

/** 地块状态：'locked' | 'empty' | 'growing' | 'ripe' */
export function plotStatus(plot) {
  if (!isUnlocked(plot)) return 'locked';
  if (!plot.cropId) return 'empty';
  return Date.now() >= plot.readyAt ? 'ripe' : 'growing';
}

/** 生长进度 0~1 */
export function growProgress(plot) {
  if (!plot.total) return 0;
  const remain = plot.readyAt - Date.now();
  return Math.max(0, Math.min(1, 1 - remain / plot.total));
}

/** 是否有需要处理的情况（杂草 / 害虫） */
export const hasIssue = (plot) => Boolean(plot.cropId && (plot.weed || plot.pest));

/** 可升级为指定土地的空闲普通地块 */
export function upgradeablePlots(soilId) {
  return state.plots.filter(
    (p) => isUnlocked(p) && p.soil === 'normal' && !p.cropId,
  );
}

/* ---------- 内部工具 ---------- */

async function persist(plot) {
  await commit({ player: state.player }, { plots: plot ? [plot] : [], bag: state.bag });
  emit(EVENTS.PLAYER);
  emit(EVENTS.FARM);
  emit(EVENTS.INVENTORY);
}

/** 播种的公共部分：扣种子、写地块字段 */
function applyPlant(plot, cropId) {
  const crop = CROPS[cropId];
  const soil = SOILS[plot.soil];

  inventory.take(seedId(cropId), 1);
  plot.cropId = cropId;
  plot.harvested = 0;
  plot.plantedAt = Date.now();
  plot.total = Math.floor(crop.grow * 1000 * soil.timeMul);
  plot.readyAt = plot.plantedAt + plot.total;
  plot.watered = false;
  plot.fert = false;
  plot.organic = false;
  plot.weed = false;
  plot.pest = false;
  return { crop, soil };
}

/**
 * 开启下一轮再生：把地块重置为「刚收获完」的状态并重算成熟时间。
 * @returns {boolean} 还有没有下一次收获
 */
function beginRegrow(plot, crop, soil) {
  const done = (plot.harvested || 0) + 1;
  if (done >= crop.harvests) return false;

  const regrowMs = Math.max(
    MIN_REGROW_MS,
    Math.floor(crop.grow * 1000 * soil.timeMul * crop.regrow),
  );

  plot.harvested = done;
  plot.plantedAt = Date.now();
  plot.total = regrowMs;
  plot.readyAt = plot.plantedAt + regrowMs;
  plot.watered = false;
  plot.fert = false;
  plot.organic = false;
  return true;
}

/** 清空地块 */
function clearPlot(plot) {
  Object.assign(plot, {
    cropId: null,
    harvested: 0,
    plantedAt: 0,
    readyAt: 0,
    total: 0,
    watered: false,
    fert: false,
    organic: false,
    weed: false,
    pest: false,
  });
}

/* ---------- 动作 ---------- */

/**
 * 用背包里的种子播种
 * @returns {Promise<boolean>}
 */
export async function plant(plotId, cropId) {
  const plot = getPlot(plotId);
  if (!plot || plot.cropId || !isUnlocked(plot)) return false;

  if (!inventory.has(seedId(cropId))) {
    notify('没有这种种子');
    return false;
  }

  const { crop, soil } = applyPlant(plot, cropId);
  recordPlanted(cropId);
  await persist(plot);
  await completeGuide('plant');
  notify(`${crop.emoji} 种下了 ${crop.name}（${soil.name}）`);
  return true;
}

/**
 * 先买种子再立刻播种（商店「购买并种植」按钮）
 * @returns {Promise<boolean>}
 */
export async function buyAndPlant(plotId, cropId) {
  const plot = getPlot(plotId);
  const crop = CROPS[cropId];
  if (!plot || plot.cropId || !crop) return false;

  if (!player.spendCoins(crop.seed)) {
    notify('金币不足 😥');
    return false;
  }

  const { soil } = applyPlant(plot, cropId);
  recordPlanted(cropId);
  await persist(plot);
  await completeGuide('plant');
  notify(`${crop.emoji} 种下了 ${crop.name}（${soil.name}）`);
  return true;
}

/**
 * 浇水：剩余时间减少 30%，每块地限一次
 */
export async function water(plotId) {
  const plot = getPlot(plotId);
  if (!plot || !plot.cropId || plot.watered || Date.now() >= plot.readyAt) return false;

  plot.readyAt -= Math.floor((plot.readyAt - Date.now()) * 0.3);
  plot.watered = true;

  await persist(plot);
  notify('💧 浇水成功，生长加速 30%');
  return true;
}

/**
 * 施肥：普通化肥加速 20%，有机化肥直接成熟（每块地限一次）
 * @param {'fertilizer'|'organic'} itemId
 */
export async function fertilize(plotId, itemId) {
  const plot = getPlot(plotId);
  if (!plot || !plot.cropId || Date.now() >= plot.readyAt) return false;

  if (!inventory.has(itemId)) {
    notify(`没有${itemId === 'organic' ? '有机化肥' : '普通化肥'}了`);
    return false;
  }
  if (itemId === 'organic' && plot.organic) {
    notify('这块地已经用过有机化肥了');
    return false;
  }

  inventory.take(itemId, 1);

  if (itemId === 'organic') {
    plot.readyAt = Date.now();
    plot.organic = true;
  } else {
    plot.readyAt -= Math.floor((plot.readyAt - Date.now()) * 0.2);
    plot.fert = true;
  }

  await persist(plot);
  notify(
    itemId === 'organic' ? '⚗️ 有机化肥生效，作物直接成熟！' : '🧪 普通化肥生效，生长加速 20%',
    itemId === 'organic' ? 'gold' : '',
  );
  return true;
}

/**
 * 除草：消耗 1 瓶除草剂
 * @param {boolean} [silent] 已由 UI 统一提示时传 true
 */
export async function clearWeed(plotId, silent = false) {
  const plot = getPlot(plotId);
  if (!plot || !plot.weed) return false;

  if (!inventory.take('herbicide', 1)) {
    notify('没有除草剂，去商店买吧');
    return false;
  }

  plot.weed = false;
  await persist(plot);
  if (!silent) notify('🧴 杂草已清除');
  return true;
}

/** 除虫：消耗 1 瓶杀虫剂 */
export async function clearPest(plotId, silent = false) {
  const plot = getPlot(plotId);
  if (!plot || !plot.pest) return false;

  if (!inventory.take('pesticide', 1)) {
    notify('没有杀虫剂，去商店买吧');
    return false;
  }

  plot.pest = false;
  await persist(plot);
  if (!silent) notify('🪲 害虫已清除');
  return true;
}

/**
 * 收获：按土地倍率算产量，杂草/害虫有概率减产，转成农产品入包并发经验。
 *
 * harvests > 1 的作物收获后不会消失，而是进入再生轮次；
 * 第 n 次收获的经验按 REGROW_EXP_DECAY 递减，总和与数值平衡公式一致。
 */
export async function harvest(plotId) {
  const plot = getPlot(plotId);
  if (!plot || !plot.cropId || Date.now() < plot.readyAt) return false;

  const crop = CROPS[plot.cropId];
  const soil = SOILS[plot.soil];

  let amount = randInt(crop.yield[0], crop.yield[1]);
  amount = Math.floor(amount * soil.yieldMul);

  let penalty = '';
  if (plot.weed && Math.random() < PEST_DAMAGE_CHANCE) {
    amount = Math.floor(amount * PEST_DAMAGE_RATIO);
    penalty += '杂草减产30% ';
  }
  if (plot.pest && Math.random() < PEST_DAMAGE_CHANCE) {
    amount = Math.floor(amount * PEST_DAMAGE_RATIO);
    penalty += '害虫减产30% ';
  }
  amount = Math.max(1, amount);

  inventory.add(produceId(plot.cropId), amount);
  recordHarvested(plot.cropId, amount);

  const exp = Math.floor(crop.exp * soil.expMul * REGROW_EXP_DECAY ** (plot.harvested || 0));
  player.addExpRaw(exp);

  const remaining = beginRegrow(plot, crop, soil);
  if (!remaining) clearPlot(plot);

  await persist(plot);
  await completeGuide('harvest');
  notify(
    `收获 ${crop.emoji}${crop.name} ×${amount}　经验 +${exp}`
    + (remaining ? `　还剩 ${crop.harvests - plot.harvested} 次` : '')
    + (penalty ? `（${penalty.trim()}）` : ''),
    'gold',
  );
  return true;
}

/**
 * 把一块空闲普通土地升级为指定类型
 */
export async function upgradeSoil(plotId, soilId) {
  const plot = getPlot(plotId);
  const soil = SOILS[soilId];
  if (!plot || !soil || soilId === 'normal') return false;

  if (!isUnlocked(plot) || plot.soil !== 'normal' || plot.cropId) {
    notify('这块地当前无法升级');
    return false;
  }
  if (state.player.level < soil.unlock) {
    notify(`需要 Lv.${soil.unlock} 才能升级`);
    return false;
  }
  if (!player.spendCoins(soil.cost)) {
    notify('金币不足');
    return false;
  }

  plot.soil = soilId;
  await persist(plot);
  await completeGuide('upgrade');
  notify(`🟫 地块 ${plotId + 1} 升级为 ${soil.name}`);
  return true;
}