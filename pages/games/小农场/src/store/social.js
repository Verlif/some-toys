/**
 * 社交领域：邻居农场（拜访 / 偷菜 / 帮忙照料）与在线演出。
 *
 * 邻居的成长不在这个文件里算，而是交给 npc-sim.js；
 * 世界怎么随时间往前走交给世界时钟 world.js。这里负责三件事：
 *   1. **结算**：把世界从「上次离开」推进到现在（世界时钟，分帧不卡）；
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
import { runStep } from './npc-sim.js';
import { advanceWorld, createReport } from './world.js';
import { expireOrders, orderBoard, removeOrder } from './orders.js';
import { completeGuide } from './codex.js';
import { CROPS } from '../data/crops.js';
import { produceId } from '../data/keys.js';
import { BOOST_CAP, LIVE_STEP_MS, PEST_YIELD_BONUS, WATER_SPEEDUP, isNpcOnline, syncNpcPlots, trimLog } from '../data/friends.js';
import { careExp, needsPest, needsWater, serveCare } from '../data/care.js';
import { stageBounds } from '../data/stages.js';
import { CAUGHT_RIPPLE_REL_LOSS, REL_PER_CARE, SUMMON_REL_COST, dogCaughtRelLoss, giftRelGain, summonDelayRange, tradeRelCost } from '../data/relation.js';
import { adjustRelation, getRelation } from './relation.js';
import { bump, bumpMax, flushAwards } from './daily.js';
import { addCrystal, contributeCore, prayNpc, villageYield } from './village.js';
import { announceAuto } from './automation.js';
import { catchChance, DOG_FINE_MULTIPLE, DOG_FOOD_SATIETY, DOG_SATIETY_MAX, dogBreed, dogSatietyAt } from '../data/dogs.js';
import { guardChance } from './dogs.js';
import { hasTool, useTool } from './tools.js';
import { notify } from './notify.js';
import { addNews } from './news.js';
import { pushNotice } from './notices.js';
import { fmtDuration, fmtSaved, formatCoins, randInt } from '../core/utils.js';

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
  const view = {
    id: farm.id,
    // 邻居的动态文案里要写玩家的真实名字（「帮 XX 浇水」），不能硬编码「农场主」
    name: farm.name,
    plots: farm.plots,
    stolen: 0,
    cared: 0,
    caught: 0,
    /** NPC 交货会动玩家的包：置 true 后结算把背包一起落盘 */
    bagDirty: false,
    // by 是「这件事是谁干的」：邻居对玩家农场的操作会传自己的 id，
    // 农场日志浮窗据此分出「我的操作」与「邻居动向」两个 tab（见 ui/log-sheet.js）
    log: (at, emoji, text, by = '') => player.addLog(emoji, text, at, by),
    news: (at, emoji, text) => addNews(emoji, text, { at }),
    dogGuardChanceAt: (at) => guardChance(at),
    /** 守护犬拦下小偷时玩家入账的罚款（内存操作，随当次结算一起落盘） */
    addCoins: (amount) => player.addCoins(amount),
    /** NPC 交单：产出进玩家包裹（图鉴收集埋点在 inventory.add 里） */
    giveItem: null,
  };
  view.giveItem = (itemId, n) => {
    inventory.add(itemId, n);
    view.bagDirty = true;
  };
  return view;
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

  // 第 54 轮：礼物不再直接进背包，而是进「农场通知」等玩家手动收下 ——
  // 这样「谁送的、送了什么」会留在信箱里，而不是一闪而过的 toast。
  pushNotice({
    kind: 'gift',
    emoji: crop.emoji,
    title: `${npc.name} 送来 ${crop.emoji}${crop.name} ×${n}`,
    body: `值 ${formatCoins(crop.sell * n)} 金币`,
    by: npc.id,
    from: npc.name,
    at,
    reward: { items: { [produceId(cropId)]: n } },
    claimText: `收下了 ${npc.name} 送来的 ${crop.emoji}${crop.name} ×${n}`,
  });
  // by = npc.id：邻居主动送礼，归进农场日志的「邻居动向」tab
  player.addLog('🎁', `${npc.name} 送来 ${crop.emoji}${crop.name} ×${n}（待领取）`, at, npc.id);
  logFriend(npc, at, '🎁', `给 ${state.farm.name} 送去一份 ${crop.emoji}${crop.name}`);
  return crop;
}

/**
 * 交给模拟层的上下文。
 *
 * npc-sim 是纯计算、不认识 store，所以「好感度怎么读怎么写」「收到礼物怎么办」
 * 「每日榜单怎么记」都由这里注进去。farm 只建一次：一次结算里所有邻居看到的是同一份计数。
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
    // 每日榜单记账：actor 是邻居农场 id，at 决定记到哪天（补算的访问发生在过去）
    daily: (actor, metric, n = 1, at = Date.now()) => bump(actor, metric, n, at),
    dailyMax: (actor, metric, n = 0, at = Date.now()) => bumpMax(actor, metric, n, at),
    // 订单看板与摘单：npc-sim 是纯计算，不认 state（见 store/orders.js）
    orders: () => orderBoard(),
    removeOrder: (order) => removeOrder(order),
    // 村庄（第 48 轮）：产量加成、挖到水晶、每日祈福。
    // 同样是「注入」而不是让模拟层去 import store —— 它只认这些函数
    villageYield: villageYield(),
    addCrystal: (tier, who, at) => addCrystal(tier, who, at),
    prayNpc: (npc, at) => prayNpc(npc, at),
    // 村民也会往村建设里投钱投水晶（第 49 轮）—— 同样注入，模拟层不 import store
    contributeNpc: (npc, at) => contributeCore(npc, at),
  };
}

/** 本次在线会话的起点：早于它的上线都属于「你不在的时候」 */
let sessionStart = Date.now();

/** 世界时钟已经推到了哪一刻：在线心跳每次从它往前推一分钟 */
let worldCursor = sessionStart;

/** 正在进行的结算（同一时刻只会有一次） */
let settlePromise = null;

/** 老存档没有「上次在线」字段时的兜底：往前找这么久 */
const LAST_SEEN_FALLBACK = 8 * 3600_000;

/** 标记本次在线会话的起点（打开游戏时调用一次） */
export function markSessionStart(now = Date.now()) {
  sessionStart = now;
  worldCursor = Math.min(worldCursor, now);
}

/**
 * 时间轴的起点：**上次离开的那一刻**。
 *
 * 优先读存档里的 `progress.lastSeenAt`（每次结算与页面隐藏时写）；
 * 老存档没这个字段时退回「所有邻居里最早的那个待办上线」——
 * 那正是世界停摆的位置，再兜一层 8 小时。
 *
 * @param {number} [now]
 * @returns {number}
 */
function lastSeen(now = Date.now()) {
  const saved = state.farm?.progress?.lastSeenAt || 0;
  let earliest = Infinity;
  for (const npc of state.friends) {
    const at = npc.nextVisitAt || 0;
    if (at && at < earliest) earliest = at;
  }
  const guess = Number.isFinite(earliest) ? earliest : now - LAST_SEEN_FALLBACK;
  // 设备时钟往回拨过时别把循环推到未来
  return Math.min(saved > 0 ? Math.min(saved, guess) : guess, now);
}

/** 当前是否正在结算 */
export const isSettling = () => Boolean(settlePromise);

/**
 * 距离上次离开过去了多久。UI 层用它决定要不要显示等待画面 / 离线报告。
 * @returns {number} 毫秒
 */
export function pendingSpan(now = Date.now()) {
  return Math.max(0, now - lastSeen(now));
}

/**
 * 把世界从「上次离开」推进到「现在」。
 *
 * 走的是世界时钟：一段一段往前推，每段把到点的上线、订单、翻日、收炉做完。
 * 分帧执行（每帧 12ms），离线很久也不会把主线程卡死；同一时刻只会有一份。
 *
 * 本次会话开始之后才到点的上线**不在这里执行**，只把游标推过去，
 * 交给下面的在线演出一步步做（见 runLiveStep）。
 *
 * @param {(progress: {at: number, from: number, to: number, percent: number}) => void} [onProgress]
 * @returns {Promise<{span: number, visits: object[], deferred: object[], report: object, summary: object}>}
 */
export function settleWorld(onProgress) {
  if (settlePromise) return settlePromise;
  settlePromise = runSettle(onProgress).finally(() => { settlePromise = null; });
  return settlePromise;
}

/** 真正干活的结算 */
async function runSettle(onProgress) {
  const now = Date.now();
  const from = Math.min(worldCursor, lastSeen(now));

  // 起点之前就到期的订单先清掉（赏金退还）：世界从这一刻重新开始转，
  // 别让邻居去接一张早就作废的单。循环内的过期由时钟按 deadline 处理
  await expireOrders(from);

  const farm = farmView();
  const ctx = simCtx(farm);
  const visits = [];
  const deferred = [];

  // 报告起点：**上次真的还在**的那一刻。
  // 新档的「上次在线」就是建号时间，而开局那批邻居的 nextVisitAt 排在十几小时前 ——
  // 那些上线要模拟（世界本来就是那么摆着的），但不该让玩家一进游戏就看到
  // 一份「你不在的 16 小时」
  const seenAt = state.farm?.progress?.lastSeenAt || 0;
  const reportFrom = seenAt > 0 ? Math.max(seenAt, from) : from;
  const report = createReport(reportFrom, now);
  const span = Math.max(1, now - reportFrom);

  // 只有「刚刚这一分钟」到点的上线才值得演给玩家看。
  // 页面藏了半小时再切回来（浏览器把定时器节流了），这段时间的事已经过去了，
  // 直接算完 —— 否则会把十几趟上线排成一条三分钟的演出队列。
  const deferFrom = now - from <= 2 * 60_000 ? sessionStart : Infinity;

  await advanceWorld({
    from,
    to: now,
    ctx,
    deferFrom,
    report,
    onVisit: (visit) => {
      if (visit.deferred) deferred.push(visit);
      else visits.push(visit);
    },
    onProgress: (at) => onProgress?.({
      at,
      from,
      to: now,
      percent: Math.min(100, Math.round(((at - from) / span) * 100)),
    }),
  });

  worldCursor = now;
  // 下次开机从这里接着算。落盘跟着其它写一起走（见 touchLastSeen）
  state.farm.progress.lastSeenAt = now;

  // 没有新事情就别写库：在线心跳每 60 秒跑一次，每次都落盘太浪费。
  // `report.idles` 也算「有新事情」—— 在线邻居顺手做的那些小事
  // （收自家地、串门、祈福）同样改了内存，不写就白做了
  if (visits.length || report.idles) await persistFriends(farm);

  // 自动机器（第 51 轮）：整段累加完之后只播一次。
  // 放在 flushAwards 之前 —— 它写的是农场日志，得跟着同一次提交落盘
  if (report.auto && (report.auto.water || report.auto.pest || report.auto.harvest)) {
    announceAuto(report.auto);
  }

  // 补算期间的榜单奖励、订单退款、出种子都是「安静结算」的（不落盘、不弹提示），
  // 这里统一写一次（farm 金币 / bag 道具 / news 时报）
  if (report.dirty || reportHadAwards(report)) await flushAwards();

  return {
    span,
    visits,
    deferred,
    report,
    summary: { stolen: farm.stolen, cared: farm.cared, caught: farm.caught },
  };
}

/** 这次推进里有没有发过榜奖金（有就得把 farm / bag / news 一起落盘） */
function reportHadAwards(report) {
  return Object.values(report.days).some((day) => day.awards.length > 0);
}

/**
 * 页面藏进后台 / 关掉之前，把「我刚才还在」记下来。
 *
 * 不写这个字段的话，下次开机只能靠「最早的待办上线」猜世界停在哪，
 * 玩家离开三天也可能从五天前开始补算（多跑一段无用的循环）。
 *
 * @param {number} [now]
 */
export async function touchLastSeen(now = Date.now()) {
  state.farm.progress.lastSeenAt = now;
  await commit({ farms: [state.farm] }).catch(() => {});
}

/**
 * 把整批农场落盘。
 *
 * 结算会同时动玩家的地块与日志，所以玩家农场与邻居一起提交。
 * @param {?object} [farm] 本次结算用的玩家农场视图：NPC 交货动过包裹时才带 bag
 */
export async function persistFriends(farm = null) {
  await commit({
    farms: [state.farm, ...state.friends],
    news: state.news,
    relations: state.relations,
    // NPC 交货会动玩家的包：脏了才带（动了才带）
    ...(farm?.bagDirty ? { bag: state.bag } : {}),
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
  // 与玩家农场日志同一套规则：只按 7 天裁剪，不设条数上限
  trimLog(friend.log);
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
  // 整趟上线共用一份 farmView / ctx：早先每一步都新建一次，导致
  // ① bagDirty 跨步丢失 —— NPC 交货进玩家背包的产出没跟着落盘，
  //    玩家看着提示说「交了一单」，仓库里却没有；
  // ② stolen / cared / caught 计数每步归零，一趟上线做了几件事也统计不出来。
  liveQueue.push({ ...visit, index: 0, ctx: simCtx() });

  // 上线通知**必须当场发**（第 48 轮修）：
  // 早先它被塞进 pendingArrivals，要等 60 秒后那次轮询才弹 toast，
  // 而动作 3~7 秒后就开始演了 —— 于是玩家先看到「金链哥收了一茬菜」，
  // 过一会儿才被告知「金链哥上线了」，催上线时尤其出戏。
  emit(EVENTS.ARRIVAL, { name: visit.npc.name, avatar: visit.npc.avatar, text: '上线了' });
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
  // 整趟上线共用同一份 ctx（见 enqueueVisit）：玩家农场的计数与 bagDirty 跨步累加
  const ctx = visit.ctx ?? (visit.ctx = simCtx());

  try {
    const entry = runStep(npc, visit.at, kind, ctx);
    if (entry) {
      spoke = true;
      // 接单可能动了别的 NPC 的农场与玩家的包：涉及的农场一并落盘
      const extra = (entry.farms || [])
        .map((id) => state.friends.find((f) => f.id === id))
        .filter((f) => f && f !== npc);
      await commit({
        farms: [state.farm, npc, ...extra],
        // bagDirty 是「这趟上线动过玩家背包」的唯一信号：
        // NPC 交货 / 送礼都落在 inventory.add 上，不把 bag 一起写就会白丢
        ...(entry.gave || ctx.farm?.bagDirty ? { bag: state.bag } : {}),
        news: state.news,
        relations: state.relations,
      });
      if (ctx.farm?.bagDirty) ctx.farm.bagDirty = false;
      emit(EVENTS.FARM);
      emit(EVENTS.FRIENDS);
      emit(EVENTS.PLAYER);
      if (entry.gave) emit(EVENTS.INVENTORY);
      notify(`${npc.avatar} ${npc.name}：${entry.emoji} ${entry.text}`);
    }
  } catch (error) {
    // 单个动作抛错不该让整趟上线静默缩水：记下是哪个动作、哪位邻居
    console.error(`[social] ${npc?.id} 的 ${kind} 动作失败`, error);
  }

  if (visit.index >= visit.steps.length) {
    liveQueue.shift();
    // 一趟上线里可能连升几级：地块数跟着等级走，收尾时补上 ——
    // 离线路径的 runVisit 一直有这一步，在线路径早先漏了，
    // 结果邻居升级后新地块要等下次上线才出现（农场看着「没长」）
    syncNpcPlots(npc, visit.at);
    const bagDirty = Boolean(ctx.farm?.bagDirty);
    if (npc.level > visit.levelBefore) {
      addNews('🎉', `${npc.name} 的农场升到了 Lv.${npc.level}`, { at: visit.at });
    }
    if (npc.level > visit.levelBefore || bagDirty) {
      await commit({
        farms: [npc],
        ...(bagDirty ? { bag: state.bag } : {}),
        news: state.news,
      }).catch(() => {});
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

/** 玩家在线期间上线的邻居不再攒在这里 —— 见 enqueueVisit 的 EVENTS.ARRIVAL */

/** 取走「你不在时」的汇总（取过就没有了） */
export function takeOfflineSummary() {
  const out = pendingOffline;
  pendingOffline = { stolen: 0, cared: 0, caught: 0, count: 0 };
  return out;
}

/**
 * 结算一次世界，把发生的事分门别类地存起来。
 *
 * 早于本次会话起点的上线已经逐条算完了，汇总进离线摘要；
 * 玩家正看着时到点的上线则排进演出队列，动作会一件一件发生。
 *
 * 提示由 UI 层发出（见 ui/views/friends.js），这里只负责把结果算出来。
 *
 * @param {(progress: {at: number, from: number, to: number, percent: number}) => void} [onProgress]
 *   启动画面用它画进度（按时间比例，不是按会话数）
 */
export async function pollOnline(onProgress) {
  const { span, visits, deferred, summary, report } = await settleWorld(onProgress);

  pendingOffline.count += visits.length;
  pendingOffline.stolen += summary.stolen;
  pendingOffline.cared += summary.cared;
  pendingOffline.caught += summary.caught;

  for (const visit of deferred) enqueueVisit(visit);
  // 时间轴交给调用方：启动流程要用它决定弹不弹「你不在的 N 天」
  return { span, report, visits: visits.length, deferred: deferred.length };
}

/* ---------- 玩家与邻居互动 ---------- */

/**
 * 「被狗逮住」这件事在村里传开了：除当事人以外，每位邻居各掉 1 点好感。
 *
 * 只掉固定的 1 点、**不乘在线双倍** —— 双倍是主人家的事（他家的菜被惦记了），
 * 旁人只是听说了，不该跟着翻倍。被偷那家已经在别处按售价折算过，这里跳过。
 * 联机真人（state.peers）不是 NPC，本来就不在 state.friends 里。
 *
 * @param {string} culpritId 被偷的那家
 * @returns {number} 被牵连的人数
 */
function spreadCaughtRelLoss(culpritId) {
  let count = 0;
  for (const npc of state.friends) {
    if (npc.id === culpritId) continue;
    adjustRelation(PLAYER_ID, npc.id, -CAUGHT_RIPPLE_REL_LOSS);
    count += 1;
  }
  return count;
}

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
  // 偷**正在在线**的邻居被抓住：双倍惩罚（金币与好感）—— 人家盯着呢。
  // 联机好友没有在线态（onlineUntil 缺省 0），天然不触发
  const online = isNpcOnline(friend, now);
  const mul = online ? 2 : 1;
  if (chance > 0 && Math.random() < chance) {
    for (const plot of friend.plots) {
      if (plot.cropId) plot.guarded = true;
    }
    const fine = Math.round(crop.sell * DOG_FINE_MULTIPLE) * mul;
    const paid = Math.min(state.farm.coins, fine);
    player.addCoins(-paid);
    friend.coins += paid;
    // 文案里要写真实名字（不是硬编码「农场主」）：日志与时报会把名字就地
    // 渲染成「名字 + 头像」的标签，写死了改名之后就对不上
    // 想偷还被当场逮住，关系只会更差：按这个果实的售价折算（至少 1）
    adjustRelation(PLAYER_ID, friend.id, -dogCaughtRelLoss(crop.sell) * mul);
    // 村里没有秘密：这事第二天半个村子都在说，其他邻居各掉 1 点
    const ripple = spreadCaughtRelLoss(friend.id);
    // 狗狗王记在**狗主人**头上：谁家的狗拦下的功劳就归谁。
    // 玩家偷 NPC 被抓时玩家一分不得 —— 这里是玩家唯一能给别人刷分的地方，
    // 所以漏了这一笔，NPC 的狗狗王就永远是 0（曾经真的漏了）
    bump(friend.id, 'dog', 1, now);
    const doubleNote = online ? '（对方在线，双倍惩罚）' : '';
    // 被牵连的人数是文案里的实情：村里几位邻居，就说几位
    const rippleNote = ripple ? `，消息传遍全村（其他 ${ripple} 位邻居好感 −1）` : '';
    logFriend(friend, now, '🐕', `守护犬抓住了想偷菜的 ${state.farm.name}，罚了 ${formatCoins(paid)} 金币${doubleNote}`);
    player.addLog('🐕', `${state.farm.name} 偷 ${friend.name} 家被守护犬抓住，罚款 ${formatCoins(paid)} 金币${doubleNote}${rippleNote}`, now);
    addNews('🐕', `${state.farm.name} 偷 ${friend.name} 家被守护犬抓住，罚了 ${formatCoins(paid)} 金币${doubleNote}`, { at: now });

    await commit({ farms: [state.farm, friend], news: state.news, relations: state.relations });
    emit(EVENTS.FRIENDS);
    emit(EVENTS.PLAYER);
    emit(EVENTS.RELATION);
    // 全屏闪一下这只狗：玩家正盯着地块点偷，toast 很容易看漏。
    // 「消息传遍全村」这件事也交给它说 —— toast 是药丸形，塞不下第二行
    emit(EVENTS.DOG_CAUGHT, { breed: friend.dog.breed, owner: friend.name, fine: paid, ripple });

    notify(
      `🐕 被 ${friend.name} 家的守护犬抓住了！${online ? '对方在线，双倍罚款！' : ''}`
      + `罚款 ${formatCoins(paid)} 金币，这一轮他家的作物都不敢碰了`,
      'gold',
    );
    return { ok: false, caught: true, reason: '被守护犬抓住了' };
  }

  // 标记：这块地这轮只能被偷一次，邻居之后的收获少 1 个
  target.stolen = true;
  target.stolenCount = (target.stolenCount || 0) + 1;
  target.stolenAt = now;

  inventory.add(produceId(target.cropId), 1);
  // 顺走不进好感账：被偷的心里有数，但不至于撕破脸（被守护犬抓住才算）
  logFriend(friend, now, '🥷', `被 ${state.farm.name} 顺走了 ${crop.emoji}${crop.name} ×1`);

  await commit({ farms: [state.farm, friend], bag: state.bag, relations: state.relations });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.INVENTORY);
  emit(EVENTS.PLAYER);
  emit(EVENTS.RELATION);

  await completeGuide('steal');
  notify(`偷到 ${crop.emoji}${crop.name} ×1`, 'gold');
  return { ok: true, cropId: target.cropId };
}

/**
 * 帮邻居的地浇水。只能对**具体那块地**操作。
 *
 * 效果与自家农场浇水完全一致：当前生长阶段砍 10%（WATER_SPEEDUP）。
 * 少了这一段，帮忙浇水就只剩好感和经验，作物该多久熟还是多久熟 ——
 * 玩家在邻居家看不到任何时间变化，还会白等（2026-10-24 反馈）。
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

  const crop = CROPS[target.cropId];
  const bounds = stageBounds(target, crop, now);
  const saved = Math.max(0, Math.round((bounds.stageEnd - bounds.stageStart) * WATER_SPEEDUP));
  target.readyAt = Math.max(now, target.readyAt - saved);

  serveCare(target, 'water', now);
  adjustRelation(PLAYER_ID, friend.id, REL_PER_CARE);
  bump(PLAYER_ID, 'care');
  // 经验跟着被照料的作物走：作物等级 ÷ 10（至少 1），不随玩家等级膨胀
  const exp = careExp(crop.lv);
  player.addExpRaw(exp);
  logFriend(friend, now, '💧', `${state.farm.name} 来帮忙浇了水`);

  await commit({ farms: [state.farm, friend], relations: state.relations });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.PLAYER);
  emit(EVENTS.RELATION);

  // 在邻居家浇水也算「第一次浇水」——引导不该分自家还是别人家
  await completeGuide('water');
  await completeGuide('care');
  notify(
    `💧 帮 ${friend.name} 浇了水，当前阶段缩短 ${Math.round(WATER_SPEEDUP * 100)}%`
    + `（约 ${fmtSaved(saved)}）　经验 +${exp}，好感 +${REL_PER_CARE}`,
  );
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
  bump(PLAYER_ID, 'care');
  const exp = careExp(CROPS[target.cropId].lv);
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
 * 单块效果与手动浇水一致（按次重排下一次需求），经验按作物等级折十给；
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
    exp += careExp(CROPS[plot.cropId].lv);
  }
  // 打理一块 +1：一次浇满一片，交情自然涨得快
  adjustRelation(PLAYER_ID, friend.id, REL_PER_CARE * targets.length);
  // 最友善榜按「打理了几块地」记，与好感同口径
  bump(PLAYER_ID, 'care', targets.length);

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
    exp += careExp(CROPS[plot.cropId].lv);
  }
  adjustRelation(PLAYER_ID, friend.id, REL_PER_CARE * targets.length);
  // 最友善榜按「打理了几块地」记，与好感同口径
  bump(PLAYER_ID, 'care', targets.length);

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
 * 给邻居的狗添一份狗粮（从自己包裹扣）。
 *
 * 好感 +1，且计入每日「最友善」榜 —— 帮人喂狗和帮人浇水一样是善举。
 *
 * @param {string} friendId
 * @returns {Promise<boolean>}
 */
export async function feedFriendDog(friendId) {
  const friend = getFriend(friendId);
  if (!friend?.dog?.breed) {
    notify('对方没有养狗');
    return false;
  }

  const now = Date.now();
  const before = dogSatietyAt(friend.dog, now);
  if (before >= DOG_SATIETY_MAX - 1) {
    notify(`🐕 ${friend.name} 的狗粮槽已经满了`);
    return false;
  }
  if (!inventory.take('dogFood', 1)) {
    notify('没有狗粮，去商店买吧');
    return false;
  }

  const next = Math.min(DOG_SATIETY_MAX, before + DOG_FOOD_SATIETY);
  friend.dog.satiety = next;
  // ⚠️ 写的是 `at` 而不是 `fedAt`：`dogSatietyAt()` 按 `at`（上次结算那一刻）算衰减，
  // 只改 satiety 不改 at，等于把「从很久以前到现在」的消耗重新扣一遍，喂了也白喂
  friend.dog.at = now;
  adjustRelation(PLAYER_ID, friend.id, 1);
  bump(PLAYER_ID, 'care', 1, now);
  player.addLog('🦴', `给 ${friend.name} 的守护犬添了狗粮`);
  logFriend(friend, now, '🦴', `${state.farm.name} 给你的守护犬添了狗粮`);
  notify(`🐕 ${friend.name} 的狗粮槽 ${Math.round(next)}%`, 'gold');
  await commit({ farms: [friend], bag: state.bag, relations: state.relations });
  emit(EVENTS.FRIENDS);
  return true;
}

/* ---------- 催上线 ---------- */

/**
 * 已经排下的「催促」定时器：friendId → timer。
 * 一位邻居同时只认一个，催第二次就覆盖（好感照扣，谁让你催得急）。
 */
const summonTimers = new Map();

/**
 * 催促一位邻居尽快上线。
 *
 * 花的是**好感**（`SUMMON_REL_COST`），换的是**他出现的时间**：
 * 交情越好来得越快（挚交 1~30 秒，结怨 5~10 分钟，见 `summonDelayRange`）。
 *
 * 实现上只做一件事：把他的 `nextVisitAt` 提前到 `now + 随机延迟`，
 * 然后挂一个定时器到点把世界往前推一次 —— 于是他会走**和平时完全一样**
 * 的上线流程（`beginVisit` 更新在线窗口、`planVisit` 抽动作、在线演出一件件做）。
 * 不新造一条「被催促的上线」通道，也不给任何数值加成：催来的这次和撞上的那次一样。
 *
 * 存档里只有 `nextVisitAt`，所以中途关掉页面也不会丢：下次开机世界时钟
 * 从「上次离开」往前推，到点照样让他上线（只是那会儿玩家不在，算进离线补算）。
 *
 * @param {string} friendId
 * @returns {Promise<{ok: boolean, wait?: number, reason?: string}>}
 */
export async function summonNpc(friendId) {
  const friend = getFriend(friendId);
  if (!friend || friend.net) return { ok: false, reason: '联机好友不在这个体系里' };

  const now = Date.now();
  if (isNpcOnline(friend, now)) {
    notify(`${friend.name} 就在村里，不用催`);
    return { ok: false, reason: 'online' };
  }

  const rel = getRelation(PLAYER_ID, friend.id);
  const range = summonDelayRange(rel);
  const delay = randInt(range.min, range.max);
  // 原本就快上线了就别往后拖：催促只会让事情提前
  const at = Math.min(friend.nextVisitAt || Infinity, now + delay);
  const wait = Math.max(0, at - now);

  friend.nextVisitAt = at;
  adjustRelation(PLAYER_ID, friend.id, -SUMMON_REL_COST);
  player.addLog('📣', `催了 ${friend.name} 一声，花掉 ${SUMMON_REL_COST} 点好感`);
  logFriend(friend, now, '📣', `${state.farm.name} 捎了句话，让他早点回来看看`);

  await commit({ farms: [friend], relations: state.relations });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.RELATION);

  scheduleSummon(friend, at);
  notify(`📣 已经捎信给 ${friend.name}，他说 ${fmtDuration(wait)}内回来`, 'gold');
  return { ok: true, wait };
}

/**
 * 排一次「到点把世界往前推」。
 *
 * 为什么不靠每分钟那次心跳：好感高的邻居说好 1~30 秒到，
 * 让玩家干等一分钟就完全不是「催促」了。定时器只负责**叫醒世界时钟**，
 * 真正的上线仍然由 `advanceWorld` 按正常流程处理（含在线演出与 toast）。
 *
 * @param {object} friend
 * @param {number} at 毫秒时间戳
 */
function scheduleSummon(friend, at) {
  clearTimeout(summonTimers.get(friend.id));
  // +300ms 缓冲：定时器可能比时间戳早一丁点触发，差这几百毫秒他就会被
  // 判成「还没到点」，于是白等下一分钟
  const delay = Math.max(0, at - Date.now()) + 300;
  const timer = setTimeout(() => {
    summonTimers.delete(friend.id);
    // 走 pollOnline 而不是 settleWorld：前者会把「刚刚上线」排进演出队列
    pollOnline().catch((error) => console.error('[social] 催促上线失败', error));
  }, delay);
  summonTimers.set(friend.id, timer);
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
  bump(PLAYER_ID, 'gift', crop.sell * qty);
  const times = qty > 1 ? ` ×${qty}` : '';

  logFriend(friend, now, '🎁', `${state.farm.name} 送来 ${crop.emoji}${crop.name}${times}`);
  player.addLog('🎁', `给 ${friend.name} 送了 ${crop.emoji}${crop.name}${times}（好感 +${gain}）`, now);

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

/* ---------- 跟邻居买产出 ---------- */

/**
 * 邻居仓库里现在有什么、各有多少。
 *
 * 只认产出（`crop_` 前缀且 CROPS 里有），仓库里别的脏数据不往界面上带。
 * 按等级从高到低排：玩家来交易多半是想补某种高阶作物，
 * 从低到高排等于让他一路划到底。
 *
 * @param {object} friend
 * @returns {Array<{cropId: string, itemId: string, crop: object, have: number}>}
 */
export function tradeStock(friend) {
  if (!friend?.bag) return [];
  return Object.entries(friend.bag)
    .filter(([itemId, n]) => itemId.startsWith('crop_') && n > 0 && CROPS[itemId.slice('crop_'.length)])
    .map(([itemId, n]) => {
      const cropId = itemId.slice('crop_'.length);
      return { cropId, itemId, crop: CROPS[cropId], have: n };
    })
    .sort((a, b) => b.crop.lv - a.crop.lv);
}

/**
 * 一次交易的报价：花多少钱、掉多少好感、能不能做。
 *
 * 拆成纯函数是为了让界面在玩家拨份数时实时重算，
 * 而不用每动一下就真的去扣一次（扣钱与扣好感只在 buyFromFriend 里做）。
 *
 * 三条门槛：
 *   - 邻居**必须在线** —— 人不在家，仓库的门是锁着的（第 45 轮玩家要求）；
 *   - 仓库里得有那么多；
 *   - 好感要够付这笔账，付完不能掉到负数。
 *
 * @param {string} friendId
 * @param {string} cropId
 * @param {number} [qty]
 * @returns {{ok: boolean, reason?: string, crop?: object, have?: number, qty?: number,
 *   coins?: number, relCost?: number, relation?: number, offline?: boolean}}
 */
export function tradeQuote(friendId, cropId, qty = 1) {
  const friend = getFriend(friendId);
  const crop = CROPS[cropId];
  if (!friend || !crop) return { ok: false, reason: '没有这件东西' };

  const now = Date.now();
  if (friend.net !== true && !isNpcOnline(friend, now)) {
    return { ok: false, offline: true, reason: `${friend.name} 不在家，等他上线再来` };
  }

  const have = friend.bag?.[produceId(cropId)] || 0;
  const want = Math.max(1, Math.floor(qty) || 1);
  const coins = crop.sell * want;
  const relCost = tradeRelCost(crop.lv, want);
  const relation = getRelation(PLAYER_ID, friend.id);

  if (have <= 0) return { ok: false, reason: `${friend.name} 家里没有${crop.name}了` };
  if (want > have) return { ok: false, reason: `他只剩 ${have} 份${crop.name}` };
  if (state.farm.coins < coins) return { ok: false, reason: `金币不够，需要 ${formatCoins(coins)}` };
  if (relation < relCost) {
    return { ok: false, reason: `好感不够：这笔要 ${relCost} 点，你只有 ${relation}` };
  }

  return { ok: true, crop, have, qty: want, coins, relCost, relation };
}

/**
 * 从邻居仓库里按**原价**买一批产出。
 *
 * 钱进邻居口袋（他才有钱买种子继续种），货进玩家仓库，
 * 好感按 `产出等级 × 份数 / 2` 扣掉 —— 这是用户定的口径：
 * 交易不是白拿，交情也是要花的。
 *
 * 校验全部走 tradeQuote()，这里只在真正动手前再查一次，
 * 免得玩家在弹窗里拨份数的时候仓库被别处改掉了。
 *
 * @param {string} friendId
 * @param {string} cropId
 * @param {number} [qty]
 * @returns {Promise<{ok: boolean, reason?: string, qty?: number, coins?: number,
 *   relCost?: number, relation?: number}>}
 */
export async function buyFromFriend(friendId, cropId, qty = 1) {
  const friend = getFriend(friendId);
  const quote = tradeQuote(friendId, cropId, qty);
  if (!quote.ok) {
    notify(quote.reason || '这笔交易做不了');
    return quote;
  }

  const { crop } = quote;
  const n = quote.qty;
  const itemId = produceId(cropId);
  const now = Date.now();

  if (!player.spendCoins(quote.coins)) return { ok: false, reason: '金币不足' };
  friend.bag[itemId] -= n;
  if (friend.bag[itemId] <= 0) delete friend.bag[itemId];
  friend.coins = (friend.coins || 0) + quote.coins;

  inventory.add(itemId, n);
  const relation = adjustRelation(PLAYER_ID, friend.id, -quote.relCost);
  // 「送出的礼物」与「买来的货」都算这一栏的流水，榜单口径保持一致
  bump(PLAYER_ID, 'gift', quote.coins, now);

  const times = n > 1 ? ` ×${n}` : '';
  logFriend(friend, now, '💰', `${state.farm.name} 买走了 ${crop.emoji}${crop.name}${times}，收 ${formatCoins(quote.coins)} 金币`);
  player.addLog('💰', `从 ${friend.name} 家买了 ${crop.emoji}${crop.name}${times}（${formatCoins(quote.coins)} 金币，好感 −${quote.relCost}）`, now);

  await commit({ farms: [state.farm, friend], bag: state.bag, relations: state.relations });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.INVENTORY);
  emit(EVENTS.PLAYER);
  emit(EVENTS.RELATION);

  notify(
    `💰 从 ${friend.name} 家买到 ${crop.emoji}${crop.name}${times}（好感 −${quote.relCost}，现在 ${relation}）`,
    'gold',
  );
  return { ok: true, qty: n, coins: quote.coins, relCost: quote.relCost, relation };
}
