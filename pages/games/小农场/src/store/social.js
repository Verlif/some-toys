/**
 * 社交领域：邻居农场（拜访 / 偷菜 / 帮忙照料）与在线演出。
 *
 * 邻居的成长不在这个文件里算，而是交给 npc-sim.js；
 * 这里负责三件事：
 *   1. **结算**：把邻居从上次结算点推进到现在（分帧，离线久了也不卡）；
 *   2. **演出**：玩家在线时，邻居的动作不再瞬间完成，而是隔几秒做一件；
 *   3. **互动**：玩家自己的偷菜与帮忙照料。
 *
 * 被偷过的地块用 stolenCount / stolenAt 标记，收获时按数量扣掉，
 * 因此不需要任何后台定时器去「清理状态」。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { PLAYER_ID, state, getFriend } from './state.js';
import * as player from './player.js';
import * as inventory from './inventory.js';
import { estimateWork, planVisit, runStep, simulateNpcUntil } from './npc-sim.js';
import { completeGuide } from './codex.js';
import { CROPS } from '../data/crops.js';
import { produceId } from '../data/keys.js';
import { BOOST_CAP, LIVE_STEP_MS, LOG_LIMIT, PEST_YIELD_BONUS } from '../data/friends.js';
import { needsPest, needsWater, serveCare } from '../data/care.js';
import { REL_PER_CARE, giftRelGain, stealRelLoss } from '../data/relation.js';
import { adjustRelation, getRelation } from './relation.js';
import { catchChance, DOG_FINE_MULTIPLE, dogBreed, dogSatietyAt } from '../data/dogs.js';
import { guardChance } from './dogs.js';
import { hasTool, useTool } from './tools.js';
import { notify } from './notify.js';
import { addNews } from './news.js';
import { formatCoins, randInt } from '../core/utils.js';

/* ---------- 邻居状态查询 ---------- */

/** 这块地本轮原本能产多少个（不考虑偷菜与虫子） */
export function baseYield(plot) {
  if (!plot.cropId) return 0;
  const crop = CROPS[plot.cropId];
  return Math.round(crop.yield[1] * (1 + (plot.boost || 0)));
}

/** 这块地当前还剩多少产量（已被偷走的要扣掉） */
export function remainYield(plot) {
  return Math.max(0, baseYield(plot) - (plot.stolenCount || 0));
}

/**
 * 某块邻居的地当前是否可偷。
 *
 * 两道限制：
 *   1. 每块地的每轮作物最多被偷 1 个；
 *   2. 被对方的守护犬逮住过一次，整座农场这一轮都不能再偷（guarded）。
 */
export function isStealable(plot, now = Date.now()) {
  if (!plot.cropId || now < plot.readyAt) return false;
  if (plot.stolen || plot.guarded) return false;
  return remainYield(plot) >= 1;
}

/** 邻居当前有几块可偷的成熟地 */
export function stealableCount(friend, now = Date.now()) {
  return friend.plots.filter((p) => isStealable(p, now)).length;
}

/** 邻居的地是否缺水 / 生虫：判定在 data/care.js，与玩家农场同一套规则 */
export { needsWater, needsPest };

/** 邻居有几块地需要照料（缺水或生虫） */
export const careCount = (friend, now = Date.now()) =>
  friend.plots.filter((p) => needsWater(p, now) || needsPest(p, now)).length;

/** 邻居有没有需要帮忙照料的地 */
export const needsHelp = (friend, now = Date.now()) => careCount(friend, now) > 0;

/* ---------- 世界推进 ---------- */

/**
 * 构造交给模拟层的「玩家农场」视图。
 *
 * 邻居会顺手偷一块成熟地、或帮一块缺水/生虫的地浇浇捉捉，
 * 改动直接落在 state.farm.plots 上。用回调写日志，npc-sim 依然不认识 store。
 *
 * dogGuardChanceAt(t) 让模拟能还原「那一刻」的拦截率：
 * 结算几天的离线时，狗不是一直满饱腹，而是随时间一路掉下去的。
 *
 * @returns {{id: string, name: string, plots: object[], stolen: number, cared: number, caught: number,
 *            log: Function, news: Function, dogGuardChanceAt: Function}}
 */
function farmView() {
  const farm = state.farm;
  return {
    id: farm.id,
    // 邻居的动态文案里要写玩家的真实名字（「帮 XX 浇水」），不能硬编码「农场主」
    name: farm.name,
    plots: farm.plots,
    stolen: 0,
    cared: 0,
    caught: 0,
    // who 是「涉及的人」：邻居模拟层传进来，玩家自己的动作不传（默认农场主）
    log: (at, emoji, text, who) => player.addLog(emoji, text, at, who),
    news: (at, emoji, text, who) => addNews(emoji, text, { at, who }),
    dogGuardChanceAt: (at) => guardChance(at),
    /** 守护犬拦下小偷时玩家入账的罚款（内存操作，随当次结算一起落盘） */
    addCoins: (amount) => player.addCoins(amount),
  };
}

/**
 * 邻居送来礼物。
 *
 * 三种去处：产出进背包、两边各记一条动态、再广播一条 GIFT 事件交给 UI ——
 * 在线时是一条 toast，离线攒下的那些等上线时用整屏动画补给他。
 *
 * @param {number} at 送出时刻
 * @param {object} npc 送礼的邻居
 * @param {string} cropId
 * @param {number} n
 */
function receiveGift(at, npc, cropId, n = 1) {
  const crop = CROPS[cropId];
  if (!crop) return null;

  inventory.add(produceId(cropId), n);
  player.addLog('🎁', `${npc.name} 送来 ${crop.emoji}${crop.name} ×${n}`, at, npc.id);
  logFriend(npc, at, '🎁', `给 ${state.farm.name} 送去一份 ${crop.emoji}${crop.name}`);
  emit(EVENTS.GIFT, {
    at,
    from: npc.name,
    avatar: npc.avatar,
    cropId,
    name: crop.name,
    emoji: crop.emoji,
    n,
    offline: at < sessionStart,
  });
  return crop;
}

/**
 * 交给模拟层的上下文。
 *
 * npc-sim 是纯计算、不认识 store，所以「好感度怎么读怎么写」「收到礼物怎么办」
 * 都由这里注进去。farm 只建一次：一次结算里所有邻居看到的是同一份计数。
 *
 * @param {?object} farm 玩家农场视图
 */
function simCtx(farm = farmView()) {
  return {
    neighbours: state.friends,
    farm,
    rel: getRelation,
    relAdjust: adjustRelation,
    receiveGift,
  };
}

/** 本次在线会话的起点：早于它的上线都属于「你不在的时候」 */
let sessionStart = Date.now();

/** 正在进行的结算（同一时刻只会有一次） */
let settlePromise = null;

/** 标记本次在线会话的起点（打开游戏时调用一次） */
export function markSessionStart(now = Date.now()) {
  sessionStart = now;
}

/** 当前是否正在结算 */
export const isSettling = () => Boolean(settlePromise);

/**
 * 还有多少会话要补算。UI 层用它决定要不要显示等待画面。
 * @returns {number}
 */
export function pendingWork() {
  return estimateWork(state.friends, Date.now());
}

/**
 * 把所有邻居从上次结算点推进到「现在」。
 *
 * 分帧执行（每帧 12ms），离线很久也不会把主线程卡死。
 * 同一时刻只会有一次结算在进行，重复调用会拿到同一个结果。
 *
 * 本次会话之后才到点的上线**不在这里执行**，只把游标推过去，
 * 交给下面的在线演出一步步做（见 runLiveStep）。
 *
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<{total: number, visits: object[], deferred: object[], summary: object}>}
 */
export function settleWorld(onProgress) {
  if (settlePromise) return settlePromise;
  settlePromise = runSettle(onProgress).finally(() => { settlePromise = null; });
  return settlePromise;
}

/** 真正干活的结算 */
async function runSettle(onProgress) {
  const npcs = state.friends;
  const now = Date.now();
  const total = estimateWork(npcs, now);
  const farm = farmView();
  const ctx = simCtx(farm);
  const visits = [];
  const deferred = [];

  const collect = (npc) => (visit) => {
    if (visit.deferred) {
      deferred.push({ npc, at: visit.at, levelBefore: visit.levelBefore, steps: planVisit(npc) });
    } else {
      visits.push({ npc, ...visit });
    }
  };

  let index = 0;
  let done = 0;
  while (index < npcs.length) {
    const until = performance.now() + 12;
    while (index < npcs.length && performance.now() < until) {
      const npc = npcs[index];
      done += simulateNpcUntil(npc, ctx, now, collect(npc), sessionStart);
      index += 1;
    }
    onProgress?.(done, total);
    // 让出一帧，页面才不会卡住
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  // 没有新事情就别写库：轮询是定时跑的，每次都落盘太浪费
  if (visits.length) await persistFriends();

  return {
    total,
    visits,
    deferred,
    summary: { stolen: farm.stolen, cared: farm.cared, caught: farm.caught },
  };
}

/**
 * 把整批农场落盘。
 *
 * 结算会同时动玩家的地块与日志，所以玩家农场与邻居一起提交。
 */
export async function persistFriends() {
  await commit({
    farms: [state.farm, ...state.friends],
    news: state.news,
    relations: state.relations,
  });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.FARM);
  emit(EVENTS.PLAYER);
}

/**
 * 往某位邻居的动态里插一条（最新的排在最前）。
 *
 * 这是「玩家侧」写的动态：偷菜、帮忙照料、被狗抓住。
 * 邻居自己上线时写的动态由 npc-sim 负责，两边共用同一个 log 数组。
 *
 * @param {object} friend 邻居农场
 * @param {number} at 发生时刻（毫秒时间戳）
 * @param {string} emoji 动态图标
 * @param {string} text 动态文案
 */
function logFriend(friend, at, emoji, text) {
  friend.log ??= [];
  friend.log.unshift({ at, emoji, text });
  if (friend.log.length > LOG_LIMIT) friend.log.length = LOG_LIMIT;
}

/* ---------- 在线演出 ---------- */

/**
 * 玩家在线时，邻居的上线不再「一瞬间做完」。
 *
 * 一趟上线在 npc-sim 里是被拆成动作序列的，这里隔几秒执行一步：
 * 玩家会先看到「谁上线了」，然后一件一件地看见他顺菜 / 打理 / 帮你的忙。
 *
 * 每完成一步就落盘一次 —— 玩家这时关掉页面，
 * 已经发生的事（尤其是被顺走的菜）都不会白丢。
 */
const liveQueue = [];
let liveTimer = 0;

/** 空动作的间隔：只为了让出一帧，不是给玩家看的 */
const LIVE_SKIP_MS = 260;

/** 把一次「到点了」的上线排进演出队列（游标已在结算里推进过） */
function enqueueVisit(visit) {
  liveQueue.push({ ...visit, index: 0 });
  pendingArrivals.push({
    name: visit.npc.name,
    avatar: visit.npc.avatar,
    text: '正在你的农场里转悠',
  });
  scheduleLive();
}

/**
 * 排下一步。
 *
 * 有实际动作时等 3~7 秒，让玩家「看得见」；
 * 什么都没做成（没成熟的地可收、没空地可种）就快速跳过，
 * 否则一串空动作会把队列堵住好几十秒。
 *
 * @param {number} [delay] 毫秒；不传就掷一个演出间隔
 */
function scheduleLive(delay) {
  if (liveTimer || !liveQueue.length) return;
  liveTimer = setTimeout(runLiveStep, delay ?? randInt(LIVE_STEP_MS[0], LIVE_STEP_MS[1]));
}

/** 执行队首那位邻居的下一个动作 */
async function runLiveStep() {
  liveTimer = 0;
  const visit = liveQueue[0];
  if (!visit) return;

  let spoke = false;
  const npc = visit.npc;
  const kind = visit.steps[visit.index];
  visit.index += 1;

  try {
    const entry = runStep(npc, visit.at, kind, simCtx());
    if (entry) {
      spoke = true;
      // 落盘：这位邻居 + 玩家农场（可能刚被他顺走一块地 / 帮他浇了水 / 送了礼）
      await commit({
        farms: [state.farm, npc],
        news: state.news,
        relations: state.relations,
      });
      emit(EVENTS.FARM);
      emit(EVENTS.FRIENDS);
      emit(EVENTS.PLAYER);
      notify(`${npc.avatar} ${npc.name}：${entry.emoji} ${entry.text}`);
    }
  } catch (error) {
    console.error(error);
  }

  if (visit.index >= visit.steps.length) {
    liveQueue.shift();
    if (npc.level > visit.levelBefore) {
      addNews('🎉', `${npc.name} 的农场升到了 Lv.${npc.level}`, { at: visit.at, who: npc.id });
      await commit({ farms: [npc], news: state.news }).catch(() => {});
      emit(EVENTS.NEWS);
    }
  }

  scheduleLive(spoke ? undefined : LIVE_SKIP_MS);
}

/* ---------- 在线提醒 ---------- */

/**
 * 「你不在的时候」发生的事，暂存在这里，等 UI 层来取。
 *
 * 存起来而不是直接弹提示，是为了让邻居页仍然能给出那句
 * 「🏡 你不在时：被顺走 3 个作物」—— 那是玩家最需要知道的一句话。
 */
let pendingOffline = { stolen: 0, cared: 0, caught: 0, count: 0 };

/** 玩家在线期间上线的邻居，同样先存着，等 UI 层取走 */
const pendingArrivals = [];

/** 取走「你不在时」的汇总（取过就没有了） */
export function takeOfflineSummary() {
  const out = pendingOffline;
  pendingOffline = { stolen: 0, cared: 0, caught: 0, count: 0 };
  return out;
}

/** 取走「刚刚上线」的邻居列表（取过就没有了） */
export function takeArrivals() {
  return pendingArrivals.splice(0).slice();
}

/**
 * 结算一次世界，把发生的事分门别类地存起来。
 *
 * 早于本次会话起点的上线已经逐条算完了，汇总进离线摘要；
 * 玩家正看着时到点的上线则排进演出队列，动作会一件一件发生。
 *
 * 提示由 UI 层发出（见 ui/views/friends.js），这里只负责把结果算出来。
 *
 * @param {(done: number, total: number) => void} [onProgress] 启动画面用它画进度
 */
export async function pollOnline(onProgress) {
  const { visits, deferred, summary } = await settleWorld(onProgress);

  pendingOffline.count += visits.length;
  pendingOffline.stolen += summary.stolen;
  pendingOffline.cared += summary.cared;
  pendingOffline.caught += summary.caught;

  for (const visit of deferred) enqueueVisit(visit);
}

/* ---------- 玩家与邻居互动 ---------- */

/**
 * 偷一块成熟的作物。
 *
 * 偷菜**不给经验** —— 经验只来自自己的收获和照料邻居，
 * 否则「到处偷」就变成了最优解。
 *
 * @returns {Promise<{ok: boolean, reason?: string, caught?: boolean, cropId?: string}>}
 */
export async function steal(friendId, index) {
  const friend = getFriend(friendId);
  const target = friend?.plots[index];
  const now = Date.now();

  if (!friend || !target || !isStealable(target, now)) {
    return { ok: false, reason: '这块地现在不能偷' };
  }
  const crop = CROPS[target.cropId];

  // 邻居的狗也在看家：品种决定它的能耐，饱腹度决定它现在有没有力气。
  // 一旦被逮住，这座农场**当前所有作物**这一轮都进不去了 ——
  // 和「每块地已被偷过」是同一个效果，只是原因不同。
  // 此外还要按这个果实的价值 ×DOG_FINE_MULTIPLE 缴纳罚款，钱归邻居；
  // 玩家钱不够就倾家荡产，不记负债。
  const breed = dogBreed(friend.dog.breed);
  const chance = breed ? catchChance(breed.rate, dogSatietyAt(friend.dog, now)) : 0;
  if (chance > 0 && Math.random() < chance) {
    for (const plot of friend.plots) {
      if (plot.cropId) plot.guarded = true;
    }
    const fine = Math.round(crop.sell * DOG_FINE_MULTIPLE);
    const paid = Math.min(state.farm.coins, fine);
    player.addCoins(-paid);
    friend.coins += paid;
    // 文案里要写真实名字（不是硬编码「农场主」）：日志与时报会把名字就地
    // 渲染成「名字 + 头像」的标签，写死了改名之后就对不上
    // 想偷还被当场逮住，关系只会更差
    adjustRelation(PLAYER_ID, friend.id, -stealRelLoss(crop.lv));
    logFriend(friend, now, '🐕', `守护犬抓住了想偷菜的 ${state.farm.name}，罚了 ${formatCoins(paid)} 金币`);
    player.addLog('🐕', `${state.farm.name} 偷 ${friend.name} 家被守护犬抓住，罚款 ${formatCoins(paid)} 金币`, now, [PLAYER_ID, friend.id]);
    addNews('🐕', `${state.farm.name} 偷 ${friend.name} 家被守护犬抓住，罚了 ${formatCoins(paid)} 金币`, {
      at: now,
      who: [PLAYER_ID, friend.id],
    });

    await commit({ farms: [state.farm, friend], news: state.news, relations: state.relations });
    emit(EVENTS.FRIENDS);
    emit(EVENTS.PLAYER);
    emit(EVENTS.RELATION);
    // 全屏闪一下这只狗：玩家正盯着地块点偷，toast 很容易看漏
    emit(EVENTS.DOG_CAUGHT, { breed: friend.dog.breed, owner: friend.name, fine: paid });

    notify(`🐕 被 ${friend.name} 家的守护犬抓住了！罚款 ${formatCoins(paid)} 金币，这一轮他家的作物都不敢碰了`, 'gold');
    return { ok: false, caught: true, reason: '被守护犬抓住了' };
  }

  // 标记：这块地这轮只能被偷一次，邻居之后的收获少 1 个
  target.stolen = true;
  target.stolenCount = (target.stolenCount || 0) + 1;
  target.stolenAt = now;

  inventory.add(produceId(target.cropId), 1);
  // 被顺走的人心里有数：好感按这份产出的售价折算
  const lost = stealRelLoss(crop.lv);
  adjustRelation(PLAYER_ID, friend.id, -lost);
  logFriend(friend, now, '🥷', `被 ${state.farm.name} 顺走了 ${crop.emoji}${crop.name} ×1`);

  await commit({ farms: [state.farm, friend], bag: state.bag, relations: state.relations });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.INVENTORY);
  emit(EVENTS.PLAYER);
  emit(EVENTS.RELATION);

  await completeGuide('steal');
  notify(`偷到 ${crop.emoji}${crop.name} ×1（好感 −${lost}）`, 'gold');
  return { ok: true, cropId: target.cropId };
}

/**
 * 帮邻居的地浇水。只能对**具体那块地**操作。
 * @returns {Promise<boolean>} 是否操作成功
 */
export async function waterNeighborPlot(friendId, index) {
  const friend = getFriend(friendId);
  const target = friend?.plots[index];
  const now = Date.now();

  if (!friend || !target || !target.cropId) return false;
  if (!needsWater(target, now)) {
    notify('这块地还不缺水');
    return false;
  }

  serveCare(target, 'water', now);
  adjustRelation(PLAYER_ID, friend.id, REL_PER_CARE);
  // 经验跟着被照料的作物走：作物几级就给几点，不随玩家等级膨胀
  const exp = CROPS[target.cropId].lv;
  player.addExpRaw(exp);
  logFriend(friend, now, '💧', `${state.farm.name} 来帮忙浇了水`);

  await commit({ farms: [state.farm, friend], relations: state.relations });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.PLAYER);
  emit(EVENTS.RELATION);

  // 在邻居家浇水也算「第一次浇水」——引导不该分自家还是别人家
  await completeGuide('water');
  await completeGuide('care');
  notify(`💧 帮 ${friend.name} 浇了水（经验 +${exp}，好感 +${REL_PER_CARE}）`);
  return true;
}

/**
 * 帮邻居的地捉虫。每次让那块地的产量 +10%。
 * @returns {Promise<boolean>} 是否操作成功
 */
export async function catchPestNeighborPlot(friendId, index) {
  const friend = getFriend(friendId);
  const target = friend?.plots[index];
  const now = Date.now();

  if (!friend || !target || !target.cropId) return false;
  if (!needsPest(target, now)) {
    notify('这块地没有虫子');
    return false;
  }

  target.boost = Math.min(BOOST_CAP, (target.boost || 0) + PEST_YIELD_BONUS);
  serveCare(target, 'pest', now);
  adjustRelation(PLAYER_ID, friend.id, REL_PER_CARE);
  const exp = CROPS[target.cropId].lv;
  player.addExpRaw(exp);
  logFriend(friend, now, '🐛', `${state.farm.name} 来帮忙捉了虫`);

  await commit({ farms: [state.farm, friend], relations: state.relations });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.PLAYER);
  emit(EVENTS.RELATION);

  await completeGuide('care');
  notify(`🐛 帮 ${friend.name} 捉了虫（经验 +${exp}，好感 +${REL_PER_CARE}）`);
  return true;
}

/**
 * 一键帮邻居浇水：消耗 1 个洒水器，把他家所有缺水的地一次浇完。
 * 单块效果与手动浇水一致（按次重排下一次需求），经验按作物等级给；
 * 好感度按「打理了几块地」记 —— 一块 +1。
 * @returns {Promise<boolean>}
 */
export async function waterAllNeighborPlots(friendId) {
  const friend = getFriend(friendId);
  const now = Date.now();
  if (!friend) return false;

  const targets = friend.plots.filter((p) => needsWater(p, now));
  if (!targets.length) {
    notify('他家的地现在都不缺水');
    return false;
  }
  if (!hasTool('water')) {
    notify('没有洒水器了，去商店买一个吧');
    return false;
  }
  // 永久版和消耗版同一个入口：买过永久洒水器，帮邻居浇水也不扣
  useTool('water');

  let exp = 0;
  for (const plot of targets) {
    serveCare(plot, 'water', now);
    exp += CROPS[plot.cropId].lv;
  }
  // 打理一块 +1：一次浇满一片，交情自然涨得快
  adjustRelation(PLAYER_ID, friend.id, REL_PER_CARE * targets.length);

  player.addExpRaw(exp);
  logFriend(friend, now, '🚿', `${state.farm.name} 用洒水器帮他给 ${targets.length} 块地浇了水`);

  await commit({ farms: [state.farm, friend], bag: state.bag, relations: state.relations });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.PLAYER);
  emit(EVENTS.INVENTORY);
  emit(EVENTS.RELATION);

  await completeGuide('water');
  await completeGuide('care');
  notify(`🚿 帮 ${friend.name} 浇了 ${targets.length} 块地（经验 +${exp}，好感 +${targets.length}）`, 'gold');
  return true;
}

/**
 * 一键帮邻居杀虫：消耗 1 个杀虫剂，把他家所有生虫的地一次捉完。
 * 每块地产量 +10%，经验按作物等级给。
 * @returns {Promise<boolean>}
 */
export async function catchPestAllNeighborPlots(friendId) {
  const friend = getFriend(friendId);
  const now = Date.now();
  if (!friend) return false;

  const targets = friend.plots.filter((p) => needsPest(p, now));
  if (!targets.length) {
    notify('他家的地现在都没有虫子');
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
    exp += CROPS[plot.cropId].lv;
  }
  adjustRelation(PLAYER_ID, friend.id, REL_PER_CARE * targets.length);

  player.addExpRaw(exp);
  logFriend(friend, now, '🧴', `${state.farm.name} 用杀虫剂帮他给 ${targets.length} 块地除了虫`);

  await commit({ farms: [state.farm, friend], bag: state.bag, relations: state.relations });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.PLAYER);
  emit(EVENTS.INVENTORY);
  emit(EVENTS.RELATION);

  await completeGuide('care');
  notify(`🧴 帮 ${friend.name} 除了 ${targets.length} 块地的虫（经验 +${exp}，好感 +${targets.length}）`, 'gold');
  return true;
}

/**
 * 给邻居送几份仓库里的产出（默认 1 份）。
 *
 * 好感按这份产出的**等级**涨（`round(等级 / 2)`，至少 1），再乘份数 ——
 * 送高阶作物才显得有诚意，送得多则成倍。送出就从仓库扣掉、不可撤销，所以 UI 那边要先弹确认框。
 *
 * @param {string} friendId
 * @param {string} cropId 农产品 id（作物 id）
 * @param {number} [n] 送几份，默认 1
 * @returns {Promise<{ok: boolean, qty?: number, gain?: number, relation?: number, reason?: string}>}
 */
export async function sendGift(friendId, cropId, n = 1) {
  const friend = getFriend(friendId);
  const crop = CROPS[cropId];
  if (!friend || !crop) return { ok: false, reason: '没有这件东西' };

  const itemId = produceId(cropId);
  if (!inventory.has(itemId)) return { ok: false, reason: '仓库里没有这种产出' };

  // 送几份就扣几份，好感**线性**叠加 —— 送五份就是五倍心意，
  // 不做递减，否则「全送」这个操作反而变得不划算，玩家会一直点 1
  const qty = Math.max(1, Math.min(Math.floor(n) || 1, inventory.count(itemId)));
  if (!inventory.take(itemId, qty)) return { ok: false, reason: '仓库里的数量不够了' };

  const unit = giftRelGain(crop.lv);
  const gain = unit * qty;
  const now = Date.now();
  const relation = adjustRelation(PLAYER_ID, friend.id, gain);
  const times = qty > 1 ? ` ×${qty}` : '';

  logFriend(friend, now, '🎁', `${state.farm.name} 送来 ${crop.emoji}${crop.name}${times}`);
  player.addLog(
    '🎁',
    `给 ${friend.name} 送了 ${crop.emoji}${crop.name}${times}（好感 +${gain}）`,
    now,
    [PLAYER_ID, friend.id],
  );

  await commit({ farms: [state.farm, friend], bag: state.bag, relations: state.relations });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.INVENTORY);
  emit(EVENTS.PLAYER);
  emit(EVENTS.RELATION);

  notify(
    `🎁 把 ${crop.emoji}${crop.name}${times} 送给了 ${friend.name}（好感 +${gain}，现在 ${relation}）`,
    'gold',
  );
  return { ok: true, qty, gain, relation };
}
