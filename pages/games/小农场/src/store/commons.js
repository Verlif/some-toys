/**
 * 公共用地（第 58 轮）：村里那片谁都能照料、谁都能收的地。
 *
 * 它是一座**没有主人的农场**（`state.commons`，farm 表里 `kind='commons'`
 * 的那一行），所以地块与日志照样落在 plot / log 两张表里，
 * 存储层、备份、导入校验一行都不用改。
 *
 * 分工：
 *   - **播种**由系统代劳（`advanceCommons`，世界时钟每一步调一次）；
 *   - **照料**玩家在弹窗里点 💧 / 🐛，村民在在线空闲时顺手做（`npcCommonsTick`）；
 *   - **收获**先到先得，每块地每人最多 1 个（`taken` / `takers` 记账）；
 *   - 所有动作都写进公共地日志（保留 7 天）。
 *
 * 为什么不给「收获」经验：这块地没花谁的种子、也没花谁的工时，
 * 白拿还给经验的话，「每天来蹭一圈」就成了最优经验来源。
 * 浇水捉虫是劳动，照常按作物等级折十给（与照料邻居同一口径）。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state, PLAYER_ID, createCommonsPlot, farmRows } from './state.js';
import * as inventory from './inventory.js';
import * as player from './player.js';
import { CROPS } from '../data/crops.js';
import { SOILS } from '../data/soils.js';
import { produceId } from '../data/keys.js';
import { BOOST_CAP, PEST_YIELD_BONUS, WATER_SPEEDUP, trimLog } from '../data/friends.js';
import { careExp, needsPest, needsWater, scheduleCare, serveCare } from '../data/care.js';
import { stageBounds } from '../data/stages.js';
import {
  COMMONS_TAKE_PER_PERSON,
  commonsCanTake,
  commonsPlotCount,
  commonsRemain,
  commonsRipeDeadline,
  rollCommonsCrop,
} from '../data/commons.js';
import { villageYield } from './village.js';
import { randInt } from '../core/utils.js';
import { notify } from './notify.js';

/** 公共用地那座「农场」 */
const farm = () => state.commons;

/** 当前村庄等级（块数与作物池都看它） */
const villageLevel = () => state.farm?.village?.level || 1;

/** 按序号找一块公共地 */
const plotOf = (plotId) => farm()?.plots.find((plot) => plot.id === plotId) || null;

/* ============================================================
   日志
   ============================================================ */

/**
 * 往公共地日志里插一条（最新的排在最前）。
 *
 * 与农场日志同一套保留规则：**只按 7 天裁剪，不设条数上限**。
 * `by` 是「这件事是谁干的」—— 玩家是 `player`，村民是自己的 id，
 * 系统补种留空串。
 *
 * @param {string} emoji
 * @param {string} text
 * @param {string} [by]
 * @param {number} [at]
 */
export function logCommons(emoji, text, by = '', at = Date.now()) {
  const current = farm();
  if (!current) return;
  current.log ??= [];
  current.log.unshift({ at, emoji, text, by });
  trimLog(current.log, at);
}

/**
 * 公共地日志（最近 7 天，最新在前）。
 * @param {number} [now]
 * @returns {Array<{at: number, emoji: string, text: string, by: string}>}
 */
export function commonsLogs(now = Date.now()) {
  const current = farm();
  if (!current) return [];
  trimLog(current.log, now);
  return [...current.log].sort((a, b) => b.at - a.at);
}

/* ============================================================
   地块
   ============================================================ */

/**
 * 按村庄等级补齐地块。
 *
 * **只增不减**：村庄不会降级，所以这里只需要「少了几块就补几块」。
 * 村庄升级后由世界时钟的下一步自动补上（`advanceCommons` 每次都调它），
 * 所以 village.js 的升级流程不需要认识这个模块，依赖不会绕成环。
 *
 * @returns {boolean} 有没有补出新地块
 */
function ensurePlots() {
  const current = farm();
  if (!current) return false;
  const level = villageLevel();
  const want = commonsPlotCount(level);
  let grew = false;
  for (let id = current.plots.length; id < want; id += 1) {
    current.plots.push(createCommonsPlot(id));
    grew = true;
  }
  if (current.level !== level) {
    current.level = level;
    grew = true;
  }
  return grew;
}

/**
 * 把一块地种上（系统行为，不扣种子）。
 * @param {object} plot
 * @param {string} cropId
 * @param {number} at
 */
function plantCommonsPlot(plot, cropId, at) {
  const crop = CROPS[cropId];
  const soil = SOILS[plot.soil] || SOILS.normal;
  plot.cropId = cropId;
  plot.harvested = 0;
  plot.plantedAt = at;
  plot.total = Math.floor(crop.grow * 1000 * soil.timeMul);
  plot.readyAt = at + plot.total;
  plot.fert = false;
  plot.yieldBonus = 0;
  plot.boost = 0;
  plot.stolen = false;
  plot.stolenCount = 0;
  plot.stolenAt = 0;
  plot.pendingYield = 0;
  plot.waterTimes = 0;
  plot.pestTimes = 0;
  plot.taken = 0;
  plot.takers = [];
  scheduleCare(plot, at);
}

/** 清空一块地，等下一轮系统补种 */
function clearCommonsPlot(plot) {
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
    taken: 0,
    takers: [],
  });
}

/**
 * 成熟那一刻摇定这一轮的产量。
 *
 * 与自家农场的口径一致：捉虫加成 × 村庄产量倍率。
 * 不乘土地倍率 —— 公共地永远是普通土（没有「给公家地施肥」这回事）。
 *
 * @param {object} plot
 * @returns {number} ≥ 1
 */
function rollCommonsYield(plot) {
  const crop = CROPS[plot.cropId];
  let amount = randInt(crop.yield[0], crop.yield[1]);
  amount = Math.floor(amount * (1 + (plot.boost || 0)));
  amount = Math.floor(amount * villageYield());
  return Math.max(1, amount);
}

/** 给刚成熟的地块摇定产量（0 表示还没摇） */
function rollRipe(now) {
  let rolled = 0;
  for (const plot of farm()?.plots || []) {
    if (!plot.cropId || plot.pendingYield || now < plot.readyAt) continue;
    plot.pendingYield = rollCommonsYield(plot);
    rolled += 1;
  }
  return rolled;
}

/**
 * 空地补种：**系统代劳**，谁也不用掏种子。
 *
 * 开头先 `ensurePlots()`：村庄刚升级时新地块还没补，不先补就会「只种了旧的几块、
 * 新的几块空着等人点开弹窗」。幂等，`advanceCommons` 里多调一次没有代价。
 *
 * @param {number} [now]
 * @returns {number} 这次种了几块
 */
export function sowCommons(now = Date.now()) {
  const current = farm();
  if (!current) return 0;
  ensurePlots();
  const level = villageLevel();
  let sown = 0;
  for (const plot of current.plots) {
    if (plot.cropId) continue;
    const cropId = rollCommonsCrop(level);
    if (!cropId) continue;
    plantCommonsPlot(plot, cropId, now);
    sown += 1;
  }
  return sown;
}

/**
 * 世界时钟每一步调一次：补地块 → 摇产量 → 清空该换种的 → 补种。
 *
 * 返回 true 表示公共地在这一步里变过，调用方（world.js）要把它算进
 * 「这次推进动过东西、需要落盘」。
 *
 * ⚠️ **顺序不能倒**：先 `rollRipe` 再判断清空。`commonsRemain` 是拿
 * `pendingYield` 减 `taken` 算的，没摇过产量的地两者都是 0，先判就会把
 * 一块刚熟、一份都没被拿的地当成「已经被拿光了」直接铲掉重种。
 *
 * @param {number} [now]
 * @returns {boolean}
 */
export function advanceCommons(now = Date.now()) {
  const current = farm();
  if (!current) return false;

  let dirty = ensurePlots();

  if (rollRipe(now)) dirty = true;

  // 该换种的两条路（第 59 轮加了第二条）：
  //   ① 已经被拿光了 —— 没东西可拿，留着只是占位置；
  //   ② 熟了满 1 天 —— 还剩一两份没人要也算到期。
  // 只看 ① 的话，剩一份的地会永远停在那儿，地里越来越空。
  for (const plot of current.plots) {
    if (!plot.cropId || now < plot.readyAt) continue;
    if (commonsRemain(plot) > 0 && now < commonsRipeDeadline(plot)) continue;
    clearCommonsPlot(plot);
    dirty = true;
  }

  if (sowCommons(now)) dirty = true;
  return dirty;
}

/* ============================================================
   玩家：照料与收获
   ============================================================ */

/**
 * 公共地的改动只动 commons 这一座农场 + 背包。
 *
 * 但**照料会给玩家经验**（`addExpRaw` 改的是 `state.farm`，升级还会写时报），
 * 所以玩家农场要跟着一起提交 —— 只写 commons 的话，浇十次水关掉页面，
 * 那点经验全丢，而地里的进度还在，玩家会觉得「白浇了」。
 *
 * @param {boolean} [leveledUp] 这次照料有没有升级（升级才有新时报要写）
 */
async function persist(leveledUp = false) {
  await commit({
    farms: farmRows(state.farm),
    bag: state.bag,
    ...(leveledUp ? { news: state.news } : {}),
  });
  emit(EVENTS.COMMONS);
  emit(EVENTS.INVENTORY);
  emit(EVENTS.PLAYER);
}

/**
 * 只把公共地落盘（不动玩家农场、背包）。
 *
 * 给「打开弹窗前补种过」用：补种是渲染前顺手做的事，不该等下一次心跳 ——
 * 玩家看两分钟关掉页面再回来，地里不该换一种作物。
 *
 * @returns {Promise<void>}
 */
export function flushCommons() {
  return commit({ farms: farmRows() });
}

/**
 * 给公共地浇水：当前生长阶段 -10%，按作物等级折十给经验。
 *
 * 与自家 / 邻居的地**完全同一套**规则（`WATER_SPEEDUP` / `careExp`），
 * 区别只有「这块地不属于任何人」。
 *
 * @param {number} plotId
 * @returns {Promise<boolean>}
 */
export async function waterCommons(plotId) {
  const plot = plotOf(plotId);
  const now = Date.now();
  if (!plot?.cropId || now >= plot.readyAt) return false;
  if (!needsWater(plot, now)) {
    notify('这块地还不缺水');
    return false;
  }

  const crop = CROPS[plot.cropId];
  const bounds = stageBounds(plot, crop, now);
  const saved = Math.max(0, Math.round((bounds.stageEnd - bounds.stageStart) * WATER_SPEEDUP));
  const exp = careExp(crop.lv);

  plot.readyAt = Math.max(now, plot.readyAt - saved);
  serveCare(plot, 'water', now);
  const gain = player.addExpRaw(exp);
  logCommons('💧', `${state.farm.name} 给公共地的 ${crop.name} 浇了水`, PLAYER_ID, now);

  await persist(gain.leveledUp);
  notify(`💧 给公共地浇了水，当前阶段缩短 ${Math.round(WATER_SPEEDUP * 100)}%　经验 +${exp}`);
  return true;
}

/**
 * 给公共地捉虫：产量 +10%，按作物等级折十给经验。
 * @param {number} plotId
 * @returns {Promise<boolean>}
 */
export async function pestCommons(plotId) {
  const plot = plotOf(plotId);
  const now = Date.now();
  if (!plot?.cropId) return false;
  if (!needsPest(plot, now)) {
    notify('这块地没有虫子');
    return false;
  }

  const crop = CROPS[plot.cropId];
  const before = plot.boost || 0;
  const exp = careExp(crop.lv);
  plot.boost = Math.min(BOOST_CAP, before + PEST_YIELD_BONUS);
  serveCare(plot, 'pest', now);
  const gain = player.addExpRaw(exp);
  logCommons('🐛', `${state.farm.name} 给公共地的 ${crop.name} 捉了虫`, PLAYER_ID, now);

  await persist(gain.leveledUp);
  notify(`🐛 给公共地捉了虫，产量 +${Math.round(PEST_YIELD_BONUS * 100)}%　经验 +${exp}`);
  return true;
}

/**
 * 从公共地拿走 1 个：**先到先得，每块地每人最多 1 个**。
 *
 * 拿光之后这块地要等世界时钟下一步（`advanceCommons`）才清空重种 ——
 * 这里不清，是因为「刚拿完」和「系统已经补种」之间只差几秒，
 * 玩家会看到地突然换了作物，反而像出了 bug。
 *
 * @param {number} plotId
 * @returns {Promise<{ok: boolean, crop?: object, n?: number, reason?: string}>}
 */
export async function takeCommons(plotId) {
  const plot = plotOf(plotId);
  const now = Date.now();
  if (!plot?.cropId) return { ok: false, reason: '这块地还空着' };
  if (now < plot.readyAt) return { ok: false, reason: '还没熟呢，再等等' };

  if (!plot.pendingYield) plot.pendingYield = rollCommonsYield(plot);
  if (!commonsCanTake(plot, PLAYER_ID)) {
    return {
      ok: false,
      reason: (plot.takers || []).includes(PLAYER_ID)
        ? '这块地这一轮你已经拿过了 —— 每人最多一个'
        : '手慢了，这块地已经被拿光了',
    };
  }

  const crop = CROPS[plot.cropId];
  const n = COMMONS_TAKE_PER_PERSON;
  plot.taken = (plot.taken || 0) + n;
  plot.takers ??= [];
  plot.takers.push(PLAYER_ID);
  inventory.add(produceId(plot.cropId), n);
  logCommons('🧺', `${state.farm.name} 从公共地拿走 ${crop.emoji}${crop.name} ×${n}`, PLAYER_ID, now);

  await persist();
  notify(`🧺 拿走 ${crop.emoji}${crop.name} ×${n}（这块地这一轮你拿过了）`, 'gold');
  return { ok: true, crop, n };
}

/* ============================================================
   村民：上线空闲时顺手来一趟
   ============================================================ */

/** 从数组里等概率挑一个 */
const pickOne = (list) => list[randInt(0, list.length - 1)];

/**
 * 村民在公共地做一件事（由 npc-sim 的 `commons` 空闲动作调）。
 *
 * 顺序刻意排成「先收后照料」：熟了的菜放着不拿，一分钟后可能就被别人拿走了，
 * 这比「先浇一遍水」更符合一个真实村民的取舍。
 *
 * 概率门（不是每次上线都来）：
 *   - 抢收 65%：有自己能拿的熟地才会掷
 *   - 照料 50%：没有熟地时才去浇水 / 捉虫
 *
 * @param {object} npc
 * @param {number} at 动作发生的时刻（补算时是过去的某一刻）
 * @returns {?{emoji: string, text: string}} 给 npc-sim 记动态用；没事可做返回 null
 */
export function npcCommonsTick(npc, at) {
  const current = farm();
  if (!current || !current.plots.length) return null;

  const ripe = current.plots.filter((plot) => plot.cropId && at >= plot.readyAt
    && commonsCanTake(plot, npc.id));
  if (ripe.length && Math.random() < 0.65) {
    const plot = pickOne(ripe);
    if (!plot.pendingYield) plot.pendingYield = rollCommonsYield(plot);
    const crop = CROPS[plot.cropId];
    plot.taken = (plot.taken || 0) + 1;
    plot.takers ??= [];
    plot.takers.push(npc.id);
    // 村民拿走的东西进他自己的小仓库 —— 他之后会拿它交订单、送人
    npc.bag ??= {};
    const key = produceId(plot.cropId);
    npc.bag[key] = (npc.bag[key] || 0) + 1;
    logCommons('🧺', `${npc.name} 从公共地拿走 ${crop.emoji}${crop.name} ×1`, npc.id, at);
    return { emoji: '🧺', text: `在公共地拿走一份 ${crop.emoji}${crop.name}` };
  }

  // 照料：只挑还在长、且真的欠水 / 欠虫的那几块
  const dry = current.plots.filter((plot) => plot.cropId && at < plot.readyAt
    && needsWater(plot, at));
  const buggy = current.plots.filter((plot) => plot.cropId && at < plot.readyAt
    && needsPest(plot, at));
  if ((!dry.length && !buggy.length) || Math.random() >= 0.5) return null;

  const water = dry.length && (!buggy.length || Math.random() < 0.5);
  const plot = pickOne(water ? dry : buggy);
  const crop = CROPS[plot.cropId];
  if (water) {
    const bounds = stageBounds(plot, crop, at);
    const saved = Math.max(0, Math.round((bounds.stageEnd - bounds.stageStart) * WATER_SPEEDUP));
    plot.readyAt = Math.max(at, plot.readyAt - saved);
    serveCare(plot, 'water', at);
    logCommons('💧', `${npc.name} 给公共地的 ${crop.name} 浇了水`, npc.id, at);
    return { emoji: '💧', text: `给公共地的 ${crop.name} 浇了水` };
  }

  plot.boost = Math.min(BOOST_CAP, (plot.boost || 0) + PEST_YIELD_BONUS);
  serveCare(plot, 'pest', at);
  logCommons('🐛', `${npc.name} 给公共地的 ${crop.name} 捉了虫`, npc.id, at);
  return { emoji: '🐛', text: `给公共地的 ${crop.name} 捉了虫` };
}

/* ============================================================
   给 UI 的读接口
   ============================================================ */

/**
 * 公共地快照（弹窗渲染用）。
 *
 * 顺手做两件「读的时候才需要」的幂等修正：按等级补地块、给刚熟的地摇产量 ——
 * 这样玩家打开弹窗看到的第一屏就是对的，不必等下一次心跳。
 *
 * ⚠️ **不在这里播种**。播种会写下 `plantedAt` / `readyAt`，属于「改动」，
 * 而这是个会被 `renderCenter` 每个 tick 调一次的函数 —— 在渲染路径上改状态
 * 又不管落盘，玩家会看到「刚才明明是西瓜，回来变成萝卜」。
 * 播种交给 `advanceCommons`（世界时钟）与 `openCommonsModal`（开弹窗前）。
 *
 * @param {number} [now]
 * @returns {{level: number, plots: object[], ripe: number, mine: number, ready: number, water: number, pest: number, total: number}}
 */
export function commonsSnapshot(now = Date.now()) {
  const current = farm();
  if (!current) {
    return {
      level: 1, plots: [], ripe: 0, mine: 0, ready: 0, water: 0, pest: 0, total: 0,
    };
  }
  ensurePlots();
  rollRipe(now);

  const ripe = current.plots.filter((plot) => plot.cropId && now >= plot.readyAt
    && commonsCanTake(plot, PLAYER_ID)).length;
  const mine = current.plots.filter((plot) => (plot.takers || []).includes(PLAYER_ID)
    && plot.cropId && now >= plot.readyAt).length;
  // 熟了的总块数（含「你拿过了」的那些）：入口文案要靠它区分
  // 「地里都在长」与「都熟了但这一轮你拿过了」—— 后者在 1 天窗口里
  // 可能持续好几个小时，说「都在长」就是骗人
  const ready = current.plots.filter((plot) => plot.cropId && now >= plot.readyAt).length;
  // 入口那颗方格右下角要报的两个数（第 60 轮）：只算「还在长」的地 ——
  // 熟了的浇水捉虫本来就不让点了（waterCommons / pestCommons 会挡），
  // 算进去只会出现一个按不动的数字
  const growing = current.plots.filter((plot) => plot.cropId && now < plot.readyAt);
  const water = growing.filter((plot) => needsWater(plot, now)).length;
  const pest = growing.filter((plot) => needsPest(plot, now)).length;

  return {
    level: current.level,
    plots: current.plots,
    ripe,
    mine,
    ready,
    water,
    pest,
    total: current.plots.length,
  };
}
