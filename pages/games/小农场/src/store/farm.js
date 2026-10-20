/**
 * 农场领域：种植 / 浇水 / 施肥 / 捉虫 / 收获 / 土地升级。
 *
 * 约定：每个动作先在内存里改完，再用 commit() 一次性落盘，
 * 保证「地块 + 背包 + 金币 + 经验」要么全成功要么全不变。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state, getPlot } from './state.js';
import * as player from './player.js';
import * as inventory from './inventory.js';
import { CROPS, expOf } from '../data/crops.js';
import { ITEMS, PESTICIDE_ID, SPRINKLER_ID } from '../data/items.js';
import { SOILS } from '../data/soils.js';
import { unlockedPlotCount as countUnlocked } from '../data/progression.js';
import { seedId, produceId } from '../data/keys.js';
import {
  BOOST_CAP,
  CARE_JITTER,
  PEST_INTERVAL,
  PEST_YIELD_BONUS,
  WATER_INTERVAL,
  WATER_SPEEDUP,
} from '../data/friends.js';
import { stageBounds } from '../data/stages.js';
import { randInt } from '../core/utils.js';
import { completeGuide, recordHarvested, recordPlanted } from './codex.js';
import { notify } from './notify.js';

/** 一次再生轮次的最短时长，防止高等级作物的 regrow 系数把时间压没 */
const MIN_REGROW_MS = 30_000;

/* ---------- 查询 ---------- */

/** 地块是否已解锁 */
const isUnlocked = (plot) => plot.id < countUnlocked(state.farm.level);

/** 当前已解锁的地块总数 */
export const unlockedPlotCount = () => countUnlocked(state.farm.level);

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

/** 是否有需要处理的情况（缺水 / 生虫） */
export const hasIssue = (plot, now = Date.now()) =>
  needsWater(plot, now) || needsPest(plot, now);

/**
 * 是否需要浇水（作物缺水了）
 *
 * 已经成熟的作物不再需要照料 —— 成熟后就不该再冒出浇水按钮。
 */
export const needsWater = (plot, now = Date.now()) =>
  Boolean(plot.cropId) && now < plot.readyAt && now >= (plot.waterAt || 0);

/** 是否需要捉虫（作物生虫了），同样只在成熟前 */
export const needsPest = (plot, now = Date.now()) =>
  Boolean(plot.cropId) && now < plot.readyAt && now >= (plot.pestAt || 0);

/** 可升级为指定土地的空闲普通地块 */
export function upgradeablePlots(soilId) {
  return state.farm.plots.filter(
    (p) => isUnlocked(p) && p.soil === 'normal' && !p.cropId,
  );
}

/* ---------- 内部工具 ---------- */

/**
 * 照料计时：给一块地安排「下次需要浇水 / 捉虫」的时间。
 * 加 ±30% 的随机浮动，让各个地不会整齐划一地同时出问题。
 */
function scheduleCare(plot, now) {
  plot.waterAt = now + WATER_INTERVAL * (1 - CARE_JITTER + Math.random() * CARE_JITTER * 2);
  plot.pestAt = now + PEST_INTERVAL * (1 - CARE_JITTER + Math.random() * CARE_JITTER * 2);
}

async function persist() {
  // 地块、金币、经验、背包都在玩家农场这一座里，一次提交全部写回；
  // 升级会同时写时报，所以把 news 也带上，免得关掉页面就丢了
  await commit({ farms: [state.farm], bag: state.bag, news: state.news });
  emit(EVENTS.PLAYER);
  emit(EVENTS.FARM);
  emit(EVENTS.INVENTORY);
}

/** 播种的公共部分：扣种子、写地块字段 */
function applyPlant(plot, cropId) {
  const crop = CROPS[cropId];
  const soil = SOILS[plot.soil];
  const now = Date.now();

  inventory.take(seedId(cropId), 1);
  plot.cropId = cropId;
  plot.harvested = 0;
  plot.plantedAt = now;
  plot.total = Math.floor(crop.grow * 1000 * soil.timeMul);
  plot.readyAt = plot.plantedAt + plot.total;
  plot.fert = false;
  plot.yieldBonus = 0;
  plot.boost = 0;
  plot.stolen = false;
  plot.stolenCount = 0;
  plot.stolenAt = 0;
  scheduleCare(plot, now);
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

  const now = Date.now();
  plot.harvested = done;
  plot.plantedAt = now;
  plot.total = regrowMs;
  plot.readyAt = plot.plantedAt + regrowMs;
  plot.fert = false;
  plot.yieldBonus = 0;
  plot.stolen = false;
  plot.stolenCount = 0;
  plot.stolenAt = 0;
  scheduleCare(plot, now);
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
    fert: false,
    yieldBonus: 0,
    boost: 0,
    waterAt: 0,
    pestAt: 0,
    stolen: false,
    stolenCount: 0,
    stolenAt: 0,
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
  player.addLog('🌱', `种下 ${crop.name}（${soil.name}）`);
  await persist();
  await completeGuide('plant');
  notify(`${crop.emoji} 种下了 ${crop.name}（${soil.name}）`);
  return true;
}

/**
 * 浇水：只有作物缺水时才能浇。
 *
 * 效果是把**当前生长阶段**所需的时间砍掉 10% ——
 * 也就是让作物在当前阶段里少等 10% 的时间。
 * 经验按作物等级给：照料 12 级的作物就给 12 点。
 */
export async function water(plotId) {
  const plot = getPlot(plotId);
  const now = Date.now();
  if (!plot || !plot.cropId || now >= plot.readyAt) return false;
  if (!needsWater(plot, now)) {
    notify('这块地还不缺水');
    return false;
  }

  const crop = CROPS[plot.cropId];
  const bounds = stageBounds(plot, crop, now);
  const saved = Math.max(0, Math.round((bounds.stageEnd - bounds.stageStart) * WATER_SPEEDUP));

  plot.readyAt = Math.max(now, plot.readyAt - saved);
  scheduleCare(plot, now);
  player.addExpRaw(crop.lv);
  player.addLog('💧', `给 ${crop.name} 浇水，当前阶段 -${Math.round(WATER_SPEEDUP * 100)}%`);

  await persist();
  await completeGuide('water');
  notify(
    `💧 浇水成功，当前阶段缩短 ${Math.round(WATER_SPEEDUP * 100)}%（约 ${fmtSaved(saved)}）　经验 +${crop.lv}`,
  );
  return true;
}

/**
 * 捉虫：只有作物生虫时才能捉。
 * 每捉一次，这块地的产量增加 10%（有上限）。
 * 经验同样按作物等级给。
 */
export async function catchPest(plotId) {
  const plot = getPlot(plotId);
  const now = Date.now();
  if (!plot || !plot.cropId) return false;
  if (!needsPest(plot, now)) {
    notify('这块地没有虫子');
    return false;
  }

  const crop = CROPS[plot.cropId];
  const before = plot.boost || 0;
  plot.boost = Math.min(BOOST_CAP, before + PEST_YIELD_BONUS);
  plot.pestAt = now + PEST_INTERVAL * (1 - CARE_JITTER + Math.random() * CARE_JITTER * 2);
  player.addExpRaw(crop.lv);
  player.addLog('🐛', `给 ${crop.name} 捉虫，产量 +${Math.round(PEST_YIELD_BONUS * 100)}%`);

  await persist();
  const gain = Math.round((plot.boost - before) * 100);
  notify(`🐛 捉虫成功，产量 +${gain}%（当前 +${Math.round(plot.boost * 100)}%）　经验 +${crop.lv}`);
  return true;
}

/**
 * 一键浇灌：消耗 1 个洒水器，把所有缺水的地一次浇完。
 *
 * 单块效果与手动浇水完全一致（当前生长阶段 -10%，每块按作物等级给经验），
 * 道具只负责省掉「一块一块点」这件事。
 *
 * @returns {Promise<boolean>}
 */
export async function waterAll() {
  const now = Date.now();
  const targets = state.farm.plots.filter((p) => isUnlocked(p) && needsWater(p, now));
  if (!targets.length) {
    notify('现在没有需要浇水的地');
    return false;
  }
  if (!inventory.has(SPRINKLER_ID)) {
    notify('没有洒水器了，去商店买一个吧');
    return false;
  }
  inventory.take(SPRINKLER_ID, 1);

  let exp = 0;
  for (const plot of targets) {
    const crop = CROPS[plot.cropId];
    const bounds = stageBounds(plot, crop, now);
    const saved = Math.max(0, Math.round((bounds.stageEnd - bounds.stageStart) * WATER_SPEEDUP));
    plot.readyAt = Math.max(now, plot.readyAt - saved);
    scheduleCare(plot, now);
    exp += crop.lv;
  }

  player.addExpRaw(exp);
  player.addLog('🚿', `用洒水器给 ${targets.length} 块地浇了水，经验 +${exp}`);

  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.PLAYER);
  emit(EVENTS.FARM);
  emit(EVENTS.INVENTORY);
  notify(`🚿 一键浇水：${targets.length} 块地，经验 +${exp}`, 'gold');
  return true;
}

/**
 * 一键杀虫：消耗 1 个杀虫剂，把所有生虫的地一次捉完。
 * 每块地产量 +10%，经验按作物等级给。
 * @returns {Promise<boolean>}
 */
export async function catchPestAll() {
  const now = Date.now();
  const targets = state.farm.plots.filter((p) => isUnlocked(p) && needsPest(p, now));
  if (!targets.length) {
    notify('现在没有需要捉虫的地');
    return false;
  }
  if (!inventory.has(PESTICIDE_ID)) {
    notify('没有杀虫剂了，去商店买一个吧');
    return false;
  }
  inventory.take(PESTICIDE_ID, 1);

  let exp = 0;
  for (const plot of targets) {
    plot.boost = Math.min(BOOST_CAP, (plot.boost || 0) + PEST_YIELD_BONUS);
    plot.pestAt = now + PEST_INTERVAL * (1 - CARE_JITTER + Math.random() * CARE_JITTER * 2);
    exp += CROPS[plot.cropId].lv;
  }

  player.addExpRaw(exp);
  player.addLog('🧴', `用杀虫剂给 ${targets.length} 块地除了虫，经验 +${exp}`);

  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.PLAYER);
  emit(EVENTS.FARM);
  emit(EVENTS.INVENTORY);
  notify(`🧴 一键杀虫：${targets.length} 块地，经验 +${exp}`, 'gold');
  return true;
}

/**
 * 施肥。
 *
 * 三类肥料共用**同一个额度** —— 一株作物一轮只能施一次：
 *   普通化肥  缩短成熟时间（五档）
 *   增产剂    提高本轮产量（+10% / +20% / +30%）
 *   有机化肥  直接成熟
 *
 * 普通化肥按档位直接扣掉剩余时间；剩余时间不足一档时，
 * 撒下去就是直接成熟 —— 不会浪费。
 *
 * @param {string} plotId
 * @param {string} itemId 见 data/items.js 的 FERTILIZER_IDS
 */
export async function fertilize(plotId, itemId) {
  const plot = getPlot(plotId);
  const item = ITEMS[itemId];
  const now = Date.now();
  if (!plot || !plot.cropId || now >= plot.readyAt || !item?.fert) return false;

  if (!inventory.has(itemId)) {
    notify(`没有${item.name}了`);
    return false;
  }
  if (plot.fert) {
    notify('这块地这轮已经施过肥了');
    return false;
  }

  inventory.take(itemId, 1);
  const crop = CROPS[plot.cropId];

  // 增产剂：不改时间，只加产量
  if (item.boost) {
    plot.yieldBonus = item.boost;
    plot.fert = true;
    player.addLog(item.emoji, `给 ${crop.name} 施了${item.name}（本轮产量 +${Math.round(item.boost * 100)}%）`);
    await persist();
    notify(`${item.emoji} ${item.name}生效，${crop.name} 的产量 +${Math.round(item.boost * 100)}%`, 'gold');
    return true;
  }

  const before = Math.max(0, plot.readyAt - now);
  const saved = item.instant ? before : Math.min(before, item.minutes * 60_000);

  if (item.instant) {
    plot.readyAt = now;
  } else {
    plot.readyAt = Math.max(now, plot.readyAt - saved);
  }
  plot.fert = true;

  player.addLog(
    item.instant ? '⚗️' : '🧪',
    `给 ${crop.name} 施了${item.name}（成熟 −${fmtSaved(saved)}）`,
  );

  await persist();
  notify(
    item.instant
      ? '⚗️ 有机化肥生效，作物直接成熟！'
      : `🧪 ${item.name}生效，成熟时间 −${fmtSaved(saved)}`,
    item.instant ? 'gold' : '',
  );
  return true;
}

/** 把毫秒数说成人话，用于提示文案 */
function fmtSaved(ms) {
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)} 分钟`;
  return `${(ms / 3600_000).toFixed(1)} 小时`;
}

/**
 * 收获：按土地倍率和捉虫加成算产量，转成农产品入包并发经验。
 *
 * harvests > 1 的作物收获后不会消失，而是进入再生轮次；
 * 再生轮的时间更短，经验公式里的时间项自然更小。
 */
export async function harvest(plotId) {
  const plot = getPlot(plotId);
  if (!plot || !plot.cropId || Date.now() < plot.readyAt) return false;

  const crop = CROPS[plot.cropId];
  const soil = SOILS[plot.soil];

  let amount = randInt(crop.yield[0], crop.yield[1]);
  amount = Math.floor(amount * soil.yieldMul);
  // 每捉一次虫 +10% 产量
  amount = Math.floor(amount * (1 + (plot.boost || 0)));
  // 增产剂：本轮产量加成
  amount = Math.floor(amount * (1 + (plot.yieldBonus || 0)));
  amount = Math.max(1, amount);

  // 被邻居顺走的要真的扣掉：偷一个就少一个，不做翻倍惩罚
  const stolen = plot.stolenCount || 0;
  if (stolen) amount = Math.max(0, amount - stolen);

  inventory.add(produceId(plot.cropId), amount);
  recordHarvested(plot.cropId, amount);

  // 经验只看「收到几个」：每份产出 = 作物等级 + 2，再乘土地的经验倍率
  const exp = Math.round(expOf(crop.lv, amount) * soil.expMul);
  player.addExpRaw(exp);

  // 收完之后地块会被重置，提示里要用的加成得先存下来
  const boost = plot.boost || 0;
  const remaining = beginRegrow(plot, crop, soil);
  if (!remaining) clearPlot(plot);

  const desc = amount > 0
    ? `收获 ${crop.emoji}${crop.name} ×${amount}`
    : `${crop.emoji}${crop.name} 被顺光了，颗粒无收`;
  const stolenNote = stolen ? `（被顺走 ${stolen} 个）` : '';
  player.addLog('🌾', `${desc}，经验 +${exp}${stolenNote}`);

  await persist();
  await completeGuide('harvest');
  notify(
    `${desc}　经验 +${exp}`
    + (remaining ? `　还剩 ${crop.harvests - plot.harvested} 次` : '')
    + (boost ? `（含捉虫加成 +${Math.round(boost * 100)}%）` : '')
    + stolenNote,
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
  if (state.farm.level < soil.unlock) {
    notify(`需要 Lv.${soil.unlock} 才能升级`);
    return false;
  }
  if (!player.spendCoins(soil.cost)) {
    notify('金币不足');
    return false;
  }

  plot.soil = soilId;
  player.addLog('🟫', `地块 ${plotId + 1} 升级为 ${soil.name}`);
  await persist();
  await completeGuide('upgrade');
  notify(`🟫 地块 ${plotId + 1} 升级为 ${soil.name}`);
  return true;
}