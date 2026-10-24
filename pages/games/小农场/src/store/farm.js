/**
 * 农场领域：种植 / 浇水 / 施肥 / 捉虫 / 收获 / 土地升级。
 *
 * 约定：每个动作先在内存里改完，再用 commit() 一次性落盘，
 * 保证「地块 + 背包 + 金币 + 经验」要么全成功要么全不变。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state, getPlot, PLAYER_ID } from './state.js';
import * as player from './player.js';
import * as inventory from './inventory.js';
import { CROPS, expOf } from '../data/crops.js';
import { ITEMS } from '../data/items.js';
import { hasTool, useTool } from './tools.js';
import { SOILS, nextSoilId } from '../data/soils.js';
import { plotPrice } from '../data/plots.js';
import { seedId, produceId } from '../data/keys.js';
import { BOOST_CAP, PEST_YIELD_BONUS, WATER_SPEEDUP } from '../data/friends.js';
import { carePenalty, cornerBonusPct, farmMaxBonus, needsPest, needsWater, scheduleCare, serveCare } from '../data/care.js';
import { stageBounds } from '../data/stages.js';
import { fmtSaved, randInt } from '../core/utils.js';
import { completeGuide, recordHarvested, recordPlanted } from './codex.js';
import { notify } from './notify.js';
import { broadcastToast } from './peers.js';
import { bump, bumpMax } from './daily.js';

/** 一次再生轮次的最短时长，防止高等级作物的 regrow 系数把时间压没 */
const MIN_REGROW_MS = 30_000;

/* ---------- 查询 ---------- */

/**
 * 地块是否可用。
 *
 * 字段落在地块自己身上（`plot.usable`），等级不再决定它 ——
 * 这样联机同步时只发「对方用得上的地」，买地也才有意义。
 */
const isUnlocked = (plot) => plot.usable === true;

/** 当前可用的地块总数 */
export const unlockedPlotCount = () => state.farm.plots.filter((plot) => plot.usable).length;

/** 下一块还没买的地（按 id 顺序，只能从头买起） */
export const nextLockedPlot = () => state.farm.plots.find((plot) => !plot.usable) || null;

/** 下一块地的价格；全部买完返回 0 */
export const nextPlotPrice = () => (nextLockedPlot() ? plotPrice(unlockedPlotCount()) : 0);

/**
 * 买下下一块地。价格随已拥有数量上涨（见 data/plots.js）。
 * @returns {Promise<boolean>} 是否买成
 */
export async function unlockPlot() {
  const plot = nextLockedPlot();
  if (!plot) {
    notify('所有地块都已经买下了');
    return false;
  }
  const price = plotPrice(unlockedPlotCount());
  if (!player.spendCoins(price)) {
    notify(`💰 金币不够，这块地要 ${price} 金币`);
    return false;
  }

  plot.usable = true;
  const owned = unlockedPlotCount();
  player.addLog('🔓', `花 ${price} 金币买下第 ${owned} 块地`);

  await commit({ farms: [state.farm] });
  emit(EVENTS.FARM);
  emit(EVENTS.PLAYER);

  notify(`🔓 买下第 ${owned} 块地（-${price} 金币）`, 'gold');
  return true;
}

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
 * 是否需要浇水 / 捉虫：判定逻辑在 data/care.js（按次排程、成熟前 15 分钟封口），
 * 这里只做转出 —— 玩家农场、邻居农场、UI 用的是同一套口径。
 */
export { needsWater, needsPest };

/**
 * 可以升成指定土地档位的地块。
 *
 * 土地必须一级一级升（普通 → 红 → 黑 → …），所以候选地块的**下一档**
 * 正好等于 soilId 时才列出来 —— 想升黑土地得先有红土地。
 * @param {string} soilId 目标档位
 */
export function upgradeablePlots(soilId) {
  return state.farm.plots.filter(
    (p) => isUnlocked(p) && !p.cropId && nextSoilId(p.soil) === soilId,
  );
}

/* ---------- 内部工具 ---------- */

/**
 * 摇一次本轮产量。
 *
 * 与土地倍率、捉虫加成、增产剂都相关；成熟后这三样都不会再变，
 * 所以「成熟那一刻摇一次、之后存起来」和「收获时才摇」等价，
 * 但能让地块上提前显示确定的「可收 X / 本应 Y」。
 * @returns {number} ≥1
 */
function rollYield(plot) {
  const crop = CROPS[plot.cropId];
  const soil = SOILS[plot.soil];
  let amount = randInt(crop.yield[0], crop.yield[1]);
  amount = Math.floor(amount * soil.yieldMul);
  // 每捉一次虫 +10% 产量
  amount = Math.floor(amount * (1 + (plot.boost || 0)));
  // 增产剂：本轮产量加成
  amount = Math.floor(amount * (1 + (plot.yieldBonus || 0)));
  // 成熟时还挂着「该浇水 / 该杀虫」的账：一次 −15%，两个都欠 −40%
  amount = Math.floor(amount * carePenalty(plot).mul);
  return Math.max(1, amount);
}

/**
 * 给刚成熟的地块摇定本轮产量（存进 plot.pendingYield）。
 *
 * 渲染前调用：pendingYield ≥ 1 表示已摇定，0 表示还没摇。
 * 收获时直接取用这个数，不再重摇 —— 玩家看到的「可收 X」就是到手的数。
 *
 * @returns {number} 这次新摇定了几块地（> 0 时调用方应落盘）
 */
export function rollRipeYields(now = Date.now()) {
  let rolled = 0;
  for (const plot of state.farm.plots) {
    if (!plot.cropId || plot.pendingYield || now < plot.readyAt) continue;
    plot.pendingYield = rollYield(plot);
    rolled += 1;
  }
  return rolled;
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
  plot.pendingYield = 0;
  // 新的一轮：照料次数清零，重新按「1 小时窗口」开始排
  plot.waterTimes = 0;
  plot.pestTimes = 0;
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
  plot.pendingYield = 0;
  plot.waterTimes = 0;
  plot.pestTimes = 0;
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
    waterNext: 0,
    pestNext: 0,
    waterTimes: 0,
    pestTimes: 0,
    stolen: false,
    stolenCount: 0,
    stolenAt: 0,
    pendingYield: 0,
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
  bump(PLAYER_ID, 'work');
  player.addLog('🌱', `种下 ${crop.name}（${soil.name}）`);
  await persist();
  await completeGuide('plant');
  notify(`${crop.emoji} 种下了 ${crop.name}（${soil.name}）`);
  // 村镇里的重要动态：播种是每天都会发生的事，但也是别人最想知道的
  broadcastToast(`🌱 种下了 ${crop.name}`);
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
  serveCare(plot, 'water', now);
  bump(PLAYER_ID, 'work');
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
  serveCare(plot, 'pest', now);
  bump(PLAYER_ID, 'work');
  player.addExpRaw(crop.lv);
  player.addLog('🐛', `给 ${crop.name} 捉虫，产量 +${Math.round(PEST_YIELD_BONUS * 100)}%`);

  await persist();
  await completeGuide('pest');
  const gain = Math.round((plot.boost - before) * 100);
  notify(`🐛 捉虫成功，产量 +${gain}%（当前 +${Math.round(plot.boost * 100)}%）　经验 +${crop.lv}`);
  return true;
}

/**
 * 一键浇灌：消耗 1 个洒水器（有永久版则不消耗），把所有缺水的地一次浇完。
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
  if (!hasTool('water')) {
    notify('没有洒水器了，去商店买一个吧');
    return false;
  }
  // 买过永久版就什么都不扣
  useTool('water');

  let exp = 0;
  for (const plot of targets) {
    const crop = CROPS[plot.cropId];
    const bounds = stageBounds(plot, crop, now);
    const saved = Math.max(0, Math.round((bounds.stageEnd - bounds.stageStart) * WATER_SPEEDUP));
    plot.readyAt = Math.max(now, plot.readyAt - saved);
    serveCare(plot, 'water', now);
    bump(PLAYER_ID, 'work');
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
 * 一键杀虫：消耗 1 个杀虫剂（有永久版则不消耗），把所有生虫的地一次捉完。
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
  if (!hasTool('pest')) {
    notify('没有杀虫剂了，去商店买一个吧');
    return false;
  }
  useTool('pest');

  let exp = 0;
  for (const plot of targets) {
    plot.boost = Math.min(BOOST_CAP, (plot.boost || 0) + PEST_YIELD_BONUS);
    serveCare(plot, 'pest', now);
    bump(PLAYER_ID, 'work');
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
  bump(PLAYER_ID, 'work');
  const crop = CROPS[plot.cropId];

  // 增产剂：不改时间，只加产量
  if (item.boost) {
    plot.yieldBonus = item.boost;
    plot.fert = true;
    player.addLog(item.emoji, `给 ${crop.name} 施了${item.name}（本轮产量 +${Math.round(item.boost * 100)}%）`);
    await persist();
    await completeGuide('fert');
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
  await completeGuide('fert');
  notify(
    item.instant
      ? '⚗️ 有机化肥生效，作物直接成熟！'
      : `🧪 ${item.name}生效，成熟时间 −${fmtSaved(saved)}`,
    item.instant ? 'gold' : '',
  );
  return true;
}

/**
 * 减产原因说成人话。
 *
 * 只报「收得少」玩家会以为出 bug，所以要把「成熟时还欠着浇水 / 杀虫」讲明白。
 * @param {{pct: number, dry: boolean, buggy: boolean}} care
 */
const careNoteOf = (care) => (care.pct
  ? `（成熟时${care.dry ? '缺水' : ''}${care.dry && care.buggy ? '又' : ''}${care.buggy ? '生虫' : ''}，产量 −${care.pct}%）`
  : '');

/**
 * 收掉一块成熟的地：算产量 → 入包 → 发经验 → 进入再生轮或清空。
 *
 * **只改内存**，不落盘、不弹提示。单块收获（`harvest`）与一键收获（`harvestAll`）
 * 都调它，区别只在外面怎么汇报 —— 再写一份「批量版」迟早会跟单块版算得不一样。
 *
 * @param {object} plot
 * @returns {{crop: object, amount: number, exp: number, remaining: boolean,
 *            stolen: number, boost: number, care: {pct: number, dry: boolean, buggy: boolean}}}
 */
function collectPlot(plot) {
  const crop = CROPS[plot.cropId];
  const soil = SOILS[plot.soil];

  // 产量在成熟那一刻就已摇定并存进 pendingYield，这里直接取用；
  // 玩家在地块上看到的「可收 X」就是本次到手的数（极端缺存档时现场补摇）。
  let amount = plot.pendingYield || rollYield(plot);

  // 成熟时还挂着照料需求的账：产量在摇定那一刻已经扣过了，这里只负责说明
  const care = carePenalty(plot);

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
  // 每日榜单：打理王 = 收获时带着的角标加成（重置前算）；农事劳模 = 收获一块地
  bumpMax(PLAYER_ID, 'manage', farmMaxBonus(state.farm.plots));
  bump(PLAYER_ID, 'work');
  const remaining = beginRegrow(plot, crop, soil);
  if (!remaining) clearPlot(plot);

  return { crop, amount, exp, remaining, stolen, boost, care };
}

/**
 * 收获一块地：按土地倍率和捉虫加成算产量，转成农产品入包并发经验。
 *
 * harvests > 1 的作物收获后不会消失，而是进入再生轮次；
 * 再生轮的时间更短，经验公式里的时间项自然更小。
 */
export async function harvest(plotId) {
  const plot = getPlot(plotId);
  if (!plot || !plot.cropId || Date.now() < plot.readyAt) return false;

  const result = collectPlot(plot);
  const { crop, amount, exp, remaining, stolen, boost, care } = result;
  const careNote = careNoteOf(care);
  const desc = amount > 0
    ? `收获 ${crop.emoji}${crop.name} ×${amount}`
    : `${crop.emoji}${crop.name} 被顺光了，颗粒无收`;
  const stolenNote = stolen ? `（被顺走 ${stolen} 个）` : '';
  player.addLog('🌾', `${desc}，经验 +${exp}${stolenNote}${careNote}`);

  await persist();
  await completeGuide('harvest');
  notify(
    `${desc}　经验 +${exp}`
    + (remaining ? `　还剩 ${crop.harvests - plot.harvested} 次` : '')
    + (boost ? `（含捉虫加成 +${Math.round(boost * 100)}%）` : '')
    + stolenNote
    + careNote,
    'gold',
  );
  return true;
}

/**
 * 一键收获：消耗 1 台采收机（有永久版则不消耗），把自家所有成熟的地一次收完。
 *
 * 每块地都走同一条 `collectPlot`，所以产量、照料减产、被顺走、再生轮次
 * 和单块收获完全一致；区别只有汇报方式 —— 一次落盘、一条日志、一条提示。
 *
 * @returns {Promise<boolean>}
 */
export async function harvestAll() {
  const now = Date.now();
  const targets = state.farm.plots.filter(
    (p) => isUnlocked(p) && p.cropId && now >= p.readyAt,
  );
  if (!targets.length) {
    notify('现在没有可以收的地');
    return false;
  }
  if (!hasTool('harvest')) {
    notify('没有采收机了，去商店买一台吧');
    return false;
  }
  useTool('harvest');

  let exp = 0;
  let total = 0;
  let stolenAll = 0;
  let dryPlots = 0;
  for (const plot of targets) {
    const r = collectPlot(plot);
    exp += r.exp;
    total += r.amount;
    stolenAll += r.stolen;
    if (r.care.pct) dryPlots += 1;
  }

  const stolenNote = stolenAll ? `（其中被顺走 ${stolenAll} 个）` : '';
  // 减产不必一块块列，点出「几块照料不周」就够玩家自己回想
  const careNote = dryPlots ? `，${dryPlots} 块照料不周` : '';
  player.addLog(
    '🚜',
    `用采收机收了 ${targets.length} 块地，共 ${total} 份，经验 +${exp}${careNote}${stolenNote}`,
  );

  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.PLAYER);
  emit(EVENTS.FARM);
  emit(EVENTS.INVENTORY);
  await completeGuide('harvest');
  notify(
    `🚜 一键收获：${targets.length} 块地，共 ${total} 份，经验 +${exp}${careNote}${stolenNote}`,
    'gold',
  );
  return true;
}

/**
 * 铲除：把种着作物的地恢复成空地。
 *
 * 不做任何返还 —— 种子、化肥、捉虫攒下的产量加成全部作废，
 * 所以 UI 那边一定要先弹确认框。成熟的作物也允许铲
 * （有人就是想腾地重种），但确认框里会提示「先收再铲更划算」。
 *
 * @param {number} plotId
 * @returns {Promise<boolean>}
 */
export async function removeCrop(plotId) {
  const plot = getPlot(plotId);
  if (!plot || !plot.cropId) return false;

  const crop = CROPS[plot.cropId];
  const ripe = Date.now() >= plot.readyAt;
  clearPlot(plot);
  bump(PLAYER_ID, 'work');

  player.addLog('🪓', `铲除了 ${crop.emoji}${crop.name}${ripe ? '（已成熟，没收获）' : ''}`);
  await persist();
  notify(`🪓 铲除了 ${crop.emoji}${crop.name}，地块已清空`);
  return true;
}

/**
 * 把一块空闲地块升到下一档土地。
 *
 * 逐级晋升：普通 → 红 → 黑 → 白银 → …，不能跳级（想直接上神话得一块块升上来）。
 * 已经是顶档（神话）的地块没有再上一级。
 * @param {number} plotId
 * @param {string} soilId 目标档位，必须正好是这块地当前档位的下一档
 * @returns {Promise<boolean>}
 */
export async function upgradeSoil(plotId, soilId) {
  const plot = getPlot(plotId);
  const soil = SOILS[soilId];
  if (!plot || !soil || soilId === 'normal') return false;

  if (!isUnlocked(plot) || plot.cropId) {
    notify('这块地当前无法升级');
    return false;
  }
  // 跳级拦截：目标档位不是当前档位的下一档就不给升
  if (nextSoilId(plot.soil) !== soilId) {
    const need = SOILS[nextSoilId(plot.soil)];
    notify(
      nextSoilId(plot.soil)
        ? `土地要一级一级升：先把它升成${need.name}`
        : '这块地已经是最高档土地了',
    );
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