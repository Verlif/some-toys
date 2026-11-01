/**
 * 承包地比赛（第 62 轮）：村中心那片「比试的地」。
 *
 * 它和公共用地同一个思路 —— 一座**不属于任何人**的农场（`state.contract`，
 * farm 表里 `kind='contract'` 的那一行），所以地块与日志照样落在 plot / log
 * 两张表里，存储层、备份、导入校验一行都不用改。
 *
 * 一局的流程：
 *
 * ```
 * idle ──挑对手──▶ pick ──挑种子──▶ grow ──两块都熟──▶ ripe ──结算──▶ done
 *                    │（扣对方 5 点好感）                        │
 *                    └────────── 中途认输 ────────────────────────┘
 * ```
 *
 * 三条与其他地块不同的规矩（都是用户定的）：
 *   - **谁都不能手收**：熟了只显示「可收获 N 个」，两块都熟了才由玩家点结算；
 *   - **不许施肥**：这块地没有施肥入口，也只有普通土；
 *   - **一局同时只有一局**：`state.contract.match` 有值就是有比赛。
 *
 * 为什么要单开一座农场而不是塞进玩家农场：两边的地要能被**所有人**照料
 * （村民上线顺路也来浇一瓢），而玩家农场的照料只认玩家自己那套流程。
 * 独立成一行之后，`npcContractTick` 与玩家操作改的是同一份数据，
 * 谁浇水都算数，落盘走 `farmRows()` 自动带上。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { PLAYER_ID, farmRows, state } from './state.js';
import * as inventory from './inventory.js';
import * as player from './player.js';
import { getRelation, setRelation } from './relation.js';
import { addNews } from './news.js';
import { notify } from './notify.js';
import { CROPS } from '../data/crops.js';
import { SOILS } from '../data/soils.js';
import { produceId } from '../data/keys.js';
import { BOOST_CAP, PEST_YIELD_BONUS, WATER_SPEEDUP, trimLog } from '../data/friends.js';
import { careExp, needsPest, needsWater, scheduleCare, serveCare } from '../data/care.js';
import { stageBounds } from '../data/stages.js';
import { randInt } from '../core/utils.js';
import { villageYield } from './village.js';
import {
  CONTRACT_COST,
  CONTRACT_RETRY_MS,
  CONTRACT_WIN_BONUS,
  PLOT_PLAYER,
  PLOT_RIVAL,
  contractCropPool,
  contractPhase,
  contractRefuseChance,
  contractWinner,
} from '../data/contract.js';

/** 承包地那座「农场」 */
const farm = () => state.contract;

/** 当前这一局（没有就是 null） */
export const currentMatch = () => farm()?.match || null;

/** 按序号找一块承包地 */
const plotOf = (index) => farm()?.plots?.[index] || null;

/**
 * 这一局还差多久能结算：两块地里**最晚**成熟的那一块。
 *
 * 两块地同时种下，`readyAt` 一样；但玩家可以只给自己那块浇水，
 * 于是它们会分开 —— 结算要等最后一块。
 *
 * @param {object[]} plots
 * @returns {number} 时间戳；没种下就是 0
 */
export const contractReadyAt = (plots) => (plots || [])
  .reduce((max, plot) => (plot?.cropId ? Math.max(max, plot.readyAt || 0) : max), 0);

/* ============================================================
   日志
   ============================================================ */

/**
 * 往承包地日志里插一条（最新在前，沿用农场日志那套 7 天裁剪）。
 * @param {string} emoji
 * @param {string} text
 * @param {string} [by] 谁干的（玩家 `player` / 村民自己的 id）
 * @param {number} [at]
 */
export function logContract(emoji, text, by = '', at = Date.now()) {
  const current = farm();
  if (!current) return;
  current.log ??= [];
  current.log.unshift({ at, emoji, text, by });
  trimLog(current.log, at);
}

/**
 * 承包地日志（最近 7 天，最新在前）。
 * @param {number} [now]
 */
export function contractLogs(now = Date.now()) {
  const current = farm();
  if (!current) return [];
  trimLog(current.log, now);
  return [...current.log].sort((a, b) => b.at - a.at);
}

/* ============================================================
   落盘
   ============================================================ */

/**
 * 承包地的改动只动它自己 + 玩家农场 + 背包 + 好感。
 *
 * 为什么玩家农场必须跟着提交：照料会给经验（`addExpRaw` 改的是 `state.farm`，
 * 升级还会写时报），只写承包地的话，浇十瓢水关掉页面，地里的进度在、
 * 经验没了。和公共地那条线一模一样。
 *
 * ⚠️ `npcs` 只在**结算 / 认输**时打开（第 62 轮修的一个真 bug）：
 * 对手赢了两块地的产出写进 `rival.bag`，那是 `state.friends` 里的一行 ——
 * 只写 `farmRows(state.farm)` 的话他只在自己内存里富了一下，玩家重开就没了。
 * 但一条 34 座农场全量重写的代价不小，所以只有真动过邻居才带（「动了才带」）。
 *
 * @param {{bag?: boolean, relations?: boolean, news?: boolean, npcs?: boolean}} [dirty]
 */
async function persist(dirty = {}) {
  await commit({
    farms: dirty.npcs
      ? farmRows(state.farm, ...state.friends)
      : farmRows(state.farm),
    ...(dirty.bag ? { bag: state.bag } : {}),
    ...(dirty.relations ? { relations: state.relations } : {}),
    ...(dirty.news ? { news: state.news } : {}),
  });
  emit(EVENTS.CONTRACT);
  emit(EVENTS.FARM);
  emit(EVENTS.PLAYER);
  if (dirty.bag) emit(EVENTS.INVENTORY);
  if (dirty.relations) emit(EVENTS.RELATION);
  if (dirty.news) emit(EVENTS.NEWS);
  // 邻居那一行被写下去了：邻居页 / 总览里的背包数字要跟着刷
  if (dirty.npcs) emit(EVENTS.FRIENDS);
}

/* ============================================================
   地块
   ============================================================ */

/** 清空一块承包地 */
function clearPlot(plot) {
  if (!plot) return;
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
 * 把两块地一起种上（同一种作物，同时成熟）。
 *
 * **不让玩家掏种子**（用户定的）：种子是比赛方出的，两块地各免费种一颗。
 * 土地永远是普通土，`fert` 恒 false —— 这块地没有施肥这回事。
 *
 * @param {string} cropId
 * @param {number} at
 */
function plantBoth(cropId, at) {
  const current = farm();
  const crop = CROPS[cropId];
  if (!current || !crop) return;
  const soil = SOILS.normal;
  const total = Math.floor(crop.grow * 1000 * soil.timeMul);
  for (const plot of current.plots.slice(0, 2)) {
    plot.cropId = cropId;
    plot.soil = 'normal';
    plot.harvested = 0;
    plot.plantedAt = at;
    plot.total = total;
    plot.readyAt = at + total;
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
}

/**
 * 成熟那一刻摇定产量（幂等，0 才算没摇过）。
 *
 * 与自家农场同一套口径：基础产量 ×(1 + 捉虫加成) × 村庄产量倍率。
 * 不吃土地倍率 —— 承包地永远是普通土，两边完全对等。
 *
 * @param {object} plot
 * @returns {number} ≥ 1
 */
function rollYield(plot) {
  const crop = CROPS[plot.cropId];
  let amount = randInt(crop.yield[0], crop.yield[1]);
  amount = Math.floor(amount * (1 + (plot.boost || 0)));
  amount = Math.floor(amount * villageYield());
  return Math.max(1, amount);
}

/**
 * 给刚成熟的地块摇定产量。
 *
 * 玩家拿它当「可收获 N 个」的数字来源：不能手收（用户要求），
 * 但得看得见 —— 两边产量都摆出来，玩家自己就知道谁赢。
 *
 * @param {number} [now]
 * @returns {number} 这次摇了几块
 */
export function rollContractRipe(now = Date.now()) {
  let rolled = 0;
  for (const plot of farm()?.plots || []) {
    if (!plot.cropId || plot.pendingYield || now < plot.readyAt) continue;
    plot.pendingYield = rollYield(plot);
    rolled += 1;
  }
  return rolled;
}

/**
 * 世界时钟每一步调一次：给刚熟的地摇产量。
 *
 * 返回 true 表示动过东西，调用方（world.js）要把它算进「需要落盘」。
 * @param {number} [now]
 */
export function advanceContract(now = Date.now()) {
  return rollContractRipe(now) > 0;
}

/* ============================================================
   玩家：挑对手 / 挑种子 / 照料 / 结算 / 认输
   ============================================================ */

/**
 * 这位村民能不能被挑战（界面列表用它筛，`challenge` 里再判一次）。
 *
 * 四条门：不在一局里（一局同时只有一局）、在线、好感是正数、
 * 最近没被同一件事拒过。
 *
 * @param {object} npc
 * @param {number} [now]
 * @returns {{ok: boolean, reason?: string}}
 */
export function canChallenge(npc, now = Date.now()) {
  if (!npc || npc.net) return { ok: false, reason: '联机好友不在这个体系里' };
  if (currentMatch()) return { ok: false, reason: '你已经在比一场了' };
  if (!(now < (npc.onlineUntil || 0))) return { ok: false, reason: '他不在家' };
  if (getRelation(PLAYER_ID, npc.id) <= 0) return { ok: false, reason: '交情还不够' };
  const cool = farm()?.cool?.[npc.id] || 0;
  if (cool > now) return { ok: false, reason: '刚被拒过，等会儿再说' };
  return { ok: true };
}

/**
 * 向一位在线村民下战书。
 *
 * 对方按性格掷一道拒绝概率（最高 30%）；答应的话当场扣 5 点好感 ——
 * 这是「陪你玩一场」的代价，好感不够正数时连挑战都发不出去。
 *
 * 被拒会记一条冷却：不记的话「拒绝概率」就是个摆设，玩家连点五次
 * 30% 也变成必过。
 *
 * @param {string} npcId
 * @returns {Promise<{ok: boolean, refused?: boolean, reason?: string, npc?: object}>}
 */
export async function challenge(npcId) {
  const npc = state.friends.find((item) => item.id === npcId);
  const now = Date.now();
  const gate = canChallenge(npc, now);
  if (!gate.ok) {
    notify(gate.reason);
    return { ok: false, reason: gate.reason };
  }

  const chance = contractRefuseChance(npc.personality);
  if (Math.random() < chance) {
    const current = farm();
    current.cool ??= {};
    current.cool[npc.id] = now + CONTRACT_RETRY_MS;
    logContract('🙅', `${npc.name} 摆摆手，没答应这场比试`, npc.id, now);
    await persist();
    notify(`🙅 ${npc.name} 没答应 —— 过 ${Math.round(CONTRACT_RETRY_MS / 60_000)} 分钟再问一次吧`);
    return { ok: false, refused: true, reason: 'refused', npc };
  }

  const left = setRelation(
    PLAYER_ID,
    npc.id,
    getRelation(PLAYER_ID, npc.id) - CONTRACT_COST,
  );
  const current = farm();
  current.match = {
    rivalId: npc.id,
    cropId: null,
    at: now,
    result: null,
  };
  // 上一局的两块地要是还留着（认输没清干净之类的），这里顺手清一遍
  for (const plot of current.plots) clearPlot(plot);
  logContract('⚔️', `${npc.name} 接下了战书（好感 −${CONTRACT_COST}）`, npc.id, now);
  await persist({ relations: true });
  notify(`⚔️ ${npc.name} 接下了战书，挑一种作物吧（好感 −${CONTRACT_COST}，现在 ${left}）`, 'gold');
  return { ok: true, npc };
}

/**
 * 挑一种种子，两块地同时种下。
 *
 * 池子由 `contractCropPool` 给（玩家与对手里等级更高的那位附近），
 * 这里只判「是不是池子里的」—— 免得界面被改过的 data-crop 塞进限定作物。
 *
 * @param {string} cropId
 * @returns {Promise<boolean>}
 */
export async function pickCrop(cropId) {
  const match = currentMatch();
  if (!match || match.cropId || match.result) return false;
  const rival = state.friends.find((item) => item.id === match.rivalId);
  if (!rival) return false;

  const pool = contractCropPool(state.farm.level, rival.level);
  if (!pool.includes(cropId)) return false;

  const now = Date.now();
  match.cropId = cropId;
  plantBoth(cropId, now);

  const crop = CROPS[cropId];
  logContract('🌱', `两块承包地同时种下了 ${crop.emoji}${crop.name}`, '', now);
  await persist();
  notify(`🌱 两块地都种上了 ${crop.emoji}${crop.name} —— 谁先收得多谁赢`, 'gold');
  return true;
}

/**
 * 给承包地浇水：当前生长阶段 -10%，按作物等级折十给经验。
 *
 * **不动好感**：这是比赛的地，玩家帮对手浇水只是因为「早点见分晓」，
 * 不该变成刷交情的新路子（公共地那条线已经给全村 +1 了）。
 *
 * @param {number} index 0 = 你的地，1 = 对手的
 * @returns {Promise<boolean>}
 */
export async function waterContract(index) {
  const plot = plotOf(index);
  const now = Date.now();
  if (!plot?.cropId || now >= plot.readyAt) return false;
  if (!needsWater(plot, now)) {
    notify('这块地还不缺水');
    return false;
  }

  const crop = CROPS[plot.cropId];
  const bounds = stageBounds(plot, crop, now);
  const saved = Math.max(0, Math.round((bounds.stageEnd - bounds.stageStart) * WATER_SPEEDUP));
  plot.readyAt = Math.max(now, plot.readyAt - saved);
  serveCare(plot, 'water', now);

  const exp = careExp(crop.lv);
  const gain = player.addExpRaw(exp);
  const whose = index === PLOT_PLAYER ? '自己的' : '对手的';
  logContract('💧', `${state.farm.name} 给${whose}承包地浇了水`, PLAYER_ID, now);

  await persist();
  notify(`💧 给${whose}承包地浇了水，当前阶段缩短 ${Math.round(WATER_SPEEDUP * 100)}%　经验 +${exp}`);
  return true;
}

/**
 * 给承包地捉虫：产量 +10%。
 *
 * 这一手是有策略的：给自己那块捉虫 = 拉高自己的产量，
 * 给对手那块捉虫 = 帮他抬产量（正常人不会做，但规则允许 —— 用户说的是
 * 「所有人可以按照意愿打理」，不给它加限制）。
 *
 * @param {number} index
 * @returns {Promise<boolean>}
 */
export async function pestContract(index) {
  const plot = plotOf(index);
  const now = Date.now();
  if (!plot?.cropId) return false;
  if (!needsPest(plot, now)) {
    notify('这块地没有虫子');
    return false;
  }

  const crop = CROPS[plot.cropId];
  plot.boost = Math.min(BOOST_CAP, (plot.boost || 0) + PEST_YIELD_BONUS);
  serveCare(plot, 'pest', now);

  const exp = careExp(crop.lv);
  player.addExpRaw(exp);
  const whose = index === PLOT_PLAYER ? '自己的' : '对手的';
  logContract('🐛', `${state.farm.name} 给${whose}承包地捉了虫`, PLAYER_ID, now);

  await persist();
  notify(`🐛 给${whose}承包地捉了虫，产量 +${Math.round(PEST_YIELD_BONUS * 100)}%　经验 +${exp}`);
  return true;
}

/**
 * 结算这一局：两块地都熟了才能点。
 *
 * 产出**全归赢家**（用户定的）：
 *   - 玩家赢 → 两块地的产量一起进背包，再补 5 点好感；
 *   - 对手赢 → 一起进他的仓库（他之后会拿去交订单），好感不动。
 *
 * 平局算玩家赢，理由写在 data/contract.js 的 `contractWinner` 里。
 *
 * @returns {Promise<{ok: boolean, reason?: string, result?: object}>}
 */
export async function settleContract() {
  const match = currentMatch();
  if (!match || match.result) return { ok: false, reason: '现在没有进行中的比赛' };
  if (!match.cropId) return { ok: false, reason: '还没挑种子呢' };

  const current = farm();
  const now = Date.now();
  rollContractRipe(now);
  const [mine, theirs] = current.plots;
  if (!mine?.pendingYield || !theirs?.pendingYield) {
    return { ok: false, reason: '两块地都熟了才能结算' };
  }

  const rival = state.friends.find((item) => item.id === match.rivalId);
  if (!rival) return { ok: false, reason: '找不到对手了' };

  const crop = CROPS[match.cropId];
  const playerYield = mine.pendingYield;
  const rivalYield = theirs.pendingYield;
  const winner = contractWinner(playerYield, rivalYield);
  const total = playerYield + rivalYield;

  const result = {
    winner,
    playerYield,
    rivalYield,
    cropId: match.cropId,
    at: now,
    forfeit: false,
  };

  if (winner === 'player') {
    inventory.add(produceId(match.cropId), total);
    setRelation(PLAYER_ID, rival.id, getRelation(PLAYER_ID, rival.id) + CONTRACT_WIN_BONUS);
    player.addLog(
      '🏆',
      `承包地比赛赢了 ${rival.name}（${playerYield} : ${rivalYield}），拿走 ${crop.emoji}${crop.name} ×${total}`,
      now,
    );
    logContract('🏆', `${state.farm.name} 以 ${playerYield} : ${rivalYield} 赢下这一局`, PLAYER_ID, now);
    addNews('🏆', `${state.farm.name} 在承包地比赛里赢了 ${rival.name}（${playerYield} : ${rivalYield}）`, { at: now });
  } else {
    rival.bag ??= {};
    const key = produceId(match.cropId);
    rival.bag[key] = (rival.bag[key] || 0) + total;
    player.addLog(
      '🥈',
      `承包地比赛输给 ${rival.name}（${playerYield} : ${rivalYield}），两块地的产出都归他了`,
      now,
    );
    logContract('🥈', `${rival.name} 以 ${rivalYield} : ${playerYield} 赢下这一局`, rival.id, now);
    addNews('🥈', `承包地比赛：${rival.name} 赢了 ${state.farm.name}（${rivalYield} : ${playerYield}）`, { at: now });
  }

  match.result = result;
  for (const plot of current.plots) clearPlot(plot);
  await persist({ bag: true, relations: true, news: true, npcs: true });

  notify(
    winner === 'player'
      ? `🏆 你赢了 ${rival.name}（${playerYield} : ${rivalYield}）—— ${crop.emoji}${crop.name} ×${total} 全归你，好感 +${CONTRACT_WIN_BONUS}`
      : `🥈 你输给 ${rival.name}（${playerYield} : ${rivalYield}）—— 两块地的 ${crop.emoji}${crop.name} ×${total} 都归他了`,
    winner === 'player' ? 'gold' : '',
  );
  return { ok: true, result };
}

/**
 * 中途认输：这一局当对方赢，两块地的产出全归他。
 *
 * 为什么要有：用户定了「不设期限」——一株高阶作物可能要长好几天，
 * 没有认输的话玩家想把这一局甩掉就只能等它熟。好感不退
 * （应战时扣的那 5 点已经花出去了）。
 *
 * @returns {Promise<boolean>}
 */
export async function surrenderContract() {
  const match = currentMatch();
  if (!match || match.result) return false;
  const rival = state.friends.find((item) => item.id === match.rivalId);
  const now = Date.now();

  const current = farm();
  const mine = current.plots[PLOT_PLAYER];
  const theirs = current.plots[PLOT_RIVAL];
  const playerYield = mine?.pendingYield || 0;
  const rivalYield = theirs?.pendingYield || 0;
  // 认输时可能一株都还没熟：那就按 0 : 0 记，胜负判给对手
  const cropId = match.cropId || '';

  if (rival && cropId) {
    const total = playerYield + rivalYield;
    if (total > 0) {
      rival.bag ??= {};
      const key = produceId(cropId);
      rival.bag[key] = (rival.bag[key] || 0) + total;
    }
    logContract('🏳️', `${state.farm.name} 认输了，两块地归 ${rival.name}`, rival.id, now);
    player.addLog('🏳️', `承包地比赛对 ${rival.name} 认输`, now);
  } else {
    logContract('🏳️', `${state.farm.name} 认输了`, PLAYER_ID, now);
  }

  match.result = {
    winner: 'rival',
    playerYield,
    rivalYield,
    cropId,
    at: now,
    forfeit: true,
  };
  for (const plot of current.plots) clearPlot(plot);
  await persist({ bag: true, npcs: true });
  notify(rival ? `🏳️ 认输了，这一局归 ${rival.name}` : '🏳️ 认输了');
  return true;
}

/**
 * 收掉这一局（「再来一局」/ 看完比分之后点的那一下）。
 *
 * 只清 `match`：日志留着（承包地日志是这块地的历史），地块已经清过了。
 * @returns {Promise<void>}
 */
export async function clearMatch() {
  const current = farm();
  if (!current?.match) return;
  current.match = null;
  for (const plot of current.plots) clearPlot(plot);
  await persist();
}

/* ============================================================
   村民：上线顺路来照料
   ============================================================ */

/** 从数组里等概率挑一个 */
const pickOne = (list) => list[randInt(0, list.length - 1)];

/**
 * 村民在承包地做一件事（由 npc-sim 的 `contract` 顺路动作调）。
 *
 * 「所有人都可以按照意愿给两块地进行打理」—— 所以谁都可能来，
 * 而且挑哪块不看他是哪一边的：有人帮自己、有人故意帮对手，都算真实。
 *
 * 概率门 50%：这不是他自家的活，路过搭把手而已。
 *
 * @param {object} npc
 * @param {number} at
 * @returns {?{emoji: string, text: string}} 给 npc-sim 记动态用；没事可做返回 null
 */
export function npcContractTick(npc, at) {
  const current = farm();
  const match = current?.match;
  if (!match || !match.cropId || match.result) return null;

  const growing = current.plots.filter((plot) => plot.cropId && at < plot.readyAt);
  if (!growing.length) return null;

  const dry = growing.filter((plot) => needsWater(plot, at));
  const buggy = growing.filter((plot) => needsPest(plot, at));
  if ((!dry.length && !buggy.length) || Math.random() >= 0.5) return null;

  const water = dry.length && (!buggy.length || Math.random() < 0.5);
  const plot = pickOne(water ? dry : buggy);
  const index = current.plots.indexOf(plot);
  const crop = CROPS[plot.cropId];
  const whose = index === PLOT_PLAYER ? '你的' : '对手的';

  if (water) {
    const bounds = stageBounds(plot, crop, at);
    const saved = Math.max(0, Math.round((bounds.stageEnd - bounds.stageStart) * WATER_SPEEDUP));
    plot.readyAt = Math.max(at, plot.readyAt - saved);
    serveCare(plot, 'water', at);
    logContract('💧', `${npc.name} 给${whose}承包地浇了水`, npc.id, at);
    return { emoji: '💧', text: `给${whose}承包地浇了水` };
  }

  plot.boost = Math.min(BOOST_CAP, (plot.boost || 0) + PEST_YIELD_BONUS);
  serveCare(plot, 'pest', at);
  logContract('🐛', `${npc.name} 给${whose}承包地捉了虫`, npc.id, at);
  return { emoji: '🐛', text: `给${whose}承包地捉了虫` };
}

/* ============================================================
   给 UI 的读接口
   ============================================================ */

/**
 * 承包地快照（入口按钮与弹窗渲染用）。
 *
 * 顺手做一件「读的时候才需要」的幂等修正：给刚熟的地摇产量。
 * 不在这里做任何会改时间的事（种地必须由 `pickCrop` 做）——
 * 这个函数会被 `renderCenter` 每个 tick 调一次。
 *
 * @param {number} [now]
 * @returns {{match: ?object, rival: ?object, plots: object[], phase: string,
 *   readyAt: number, mine: number, theirs: number, ripe: number}}
 */
export function contractSnapshot(now = Date.now()) {
  const current = farm();
  const empty = {
    match: null,
    rival: null,
    plots: [],
    phase: 'idle',
    readyAt: 0,
    mine: 0,
    theirs: 0,
    ripe: 0,
  };
  if (!current) return empty;

  rollContractRipe(now);
  const match = current.match;
  const plots = current.plots;
  const rival = match ? state.friends.find((item) => item.id === match.rivalId) || null : null;

  return {
    match,
    rival,
    plots,
    // 阶段一律走 data/contract.js 那个纯函数：弹窗按它切屏，
    // 别在这里再算一遍「两块都熟了没有」—— 两处口径早晚分叉
    phase: contractPhase(match, plots, now),
    readyAt: contractReadyAt(plots),
    mine: plots[PLOT_PLAYER]?.pendingYield || 0,
    theirs: plots[PLOT_RIVAL]?.pendingYield || 0,
    ripe: plots.filter((plot) => plot.cropId && now >= plot.readyAt).length,
  };
}

/**
 * 可以挑战的对手（入口列表用）。
 *
 * 只列「现在真能挑战的」：在线 + 好感正数 + 不在冷却里。
 * 排序按好感从高到低 —— 交情越好越愿意陪你玩，玩家也更容易从熟人下手。
 *
 * @param {number} [now]
 * @returns {object[]}
 */
export function challengeList(now = Date.now()) {
  if (currentMatch()) return [];
  return state.friends
    .filter((npc) => canChallenge(npc, now).ok)
    .sort((a, b) => getRelation(PLAYER_ID, b.id) - getRelation(PLAYER_ID, a.id));
}
