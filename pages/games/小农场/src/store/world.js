/**
 * 世界时钟。
 *
 * 整个镇子只有一个驱动：**时间**。从「上次离开」逐段推进到「现在」，
 * 每一段把这段里到点的事按先后做完：
 *
 *   ① 邻居上线（到点就上，按 nextVisitAt 升序，不是按数组顺序）
 *   ② 订单到期（赏金退还）
 *   ③ 每日榜单跨 14:00 结算（必须在当期的动作都记完之后）
 *   ④ 种子制造间收炉
 *
 * 步长按离线总跨度自适应（见 data/world.js 的 stepMsFor）：
 * 一周以内 1 分钟一步，之后每翻一倍时长步长翻倍。
 *
 * 这个模块只负责「什么时候轮到谁」，具体做什么交给 npc-sim 的 ACTIONS；
 * 好感和订单看板由调用方（social.js）注入 ctx —— 时钟不认识任何业务。
 */
import { boardDayKey, dayKey } from '../core/utils.js';
import { state } from './state.js';
import { checkRollover } from './daily.js';
import { expireOrders } from './orders.js';
import { claimJobs } from './workshop.js';
import { beginVisit, bulkAdvance, estimateVisits, planVisit, runVisit } from './npc-sim.js';
import {
  FRAME_MS,
  REPORT_NOTES_PER_DAY,
  VISIT_BUDGET,
  stepMsFor,
} from '../data/world.js';

const DAY = 24 * 3600_000;

/** 让出主线程：优先 rAF，跑在没有 DOM 的环境里就退回 setTimeout */
const nextFrame = typeof requestAnimationFrame === 'function'
  ? () => new Promise((resolve) => requestAnimationFrame(resolve))
  : () => new Promise((resolve) => setTimeout(resolve, 0));

const clockNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const noDelta = () => ({ stolen: 0, cared: 0, caught: 0 });

/* ============================================================
   离线时间轴
   ============================================================ */

/**
 * 一份「你不在的这段时间」的流水账。
 *
 * 按**自然日**（0 点切）分桶 —— 玩家理解「昨天/前天」用的是自然日，
 * 而排行榜用的是 14 点账期，两套口径各自独立，别混在一起。
 *
 * @param {number} [from]
 * @param {number} [to]
 */
export function createReport(from = 0, to = 0) {
  return {
    from,
    to,
    visits: 0,
    stolen: 0,
    cared: 0,
    caught: 0,
    /** 离线太久、最早那段按汇总跳过时为 true，UI 要如实说一句 */
    degraded: false,
    /**
     * 时钟顺手改了别的表（订单赏金、制造间种子）。
     * 这些都不在 farm / news 里，补算结束要额外落一次盘。
     */
    dirty: false,
    /** dayKey → { date, visits, stolen, cared, caught, levelUps, awards, notes } */
    days: {},
  };
}

/** 取（或建）某一天的桶 */
function dayBucket(report, at) {
  const key = dayKey(at);
  let day = report.days[key];
  if (!day) {
    day = {
      date: key,
      visits: 0,
      stolen: 0,
      cared: 0,
      caught: 0,
      levelUps: [],
      awards: [],
      notes: [],
    };
    report.days[key] = day;
  }
  return day;
}

/** 往某天塞一条「有料」的事（每天有上限，超了只留计数） */
function note(day, emoji, text) {
  if (day.notes.length >= REPORT_NOTES_PER_DAY) return;
  day.notes.push({ emoji, text });
}

/** 按时间从旧到新取出来（UI 渲染直接用） */
export function reportDays(report) {
  return Object.values(report.days).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/* ============================================================
   推进
   ============================================================ */

/**
 * 把世界从 from 推到 to。
 *
 * @param {object} options
 * @param {number} options.from 起点（上次离开 / 上次心跳的时刻）
 * @param {number} options.to 终点（现在）
 * @param {object} options.ctx 模拟上下文（social 注入：好感、送礼、榜单、订单）
 * @param {number} [options.deferFrom] 从这个时刻起的上线不在这里执行，
 *   只把游标推过去，交给调用方演出 —— 玩家正盯着屏幕时用
 * @param {(visit: object) => void} [options.onVisit] 每次上线的回调
 * @param {(at: number) => void} [options.onProgress] 每推进一步回调一次
 * @param {object} [options.report] 时间轴收集器（不传就现造一个）
 * @returns {Promise<object>} 时间轴
 */
export async function advanceWorld({
  from,
  to,
  ctx,
  deferFrom = Infinity,
  onVisit = null,
  onProgress = null,
  report = null,
}) {
  // from / to 由调用方写进 report：**模拟起点**与**报告起点**是两件事
  // （新档要从最早的待办上线开始模拟，但报告只该从「上次在线」算起）
  const out = report || createReport(from, to);
  if (!(to > from)) return out;

  // ① 预算守卫：离线太久时，最早的那段按汇总跳过（等级与金币照常推进）
  const detailedFrom = planDetailedStart(from, to, ctx, out);
  const stepMs = stepMsFor(to - detailedFrom);

  let cursor = detailedFrom;
  let frameAt = clockNow();

  while (cursor < to) {
    const next = Math.min(cursor + stepMs, to);
    await tick(cursor, next, { ctx, deferFrom, onVisit, report: out });
    cursor = next;
    onProgress?.(next);
    if (clockNow() - frameAt >= FRAME_MS) {
      await nextFrame();
      frameAt = clockNow();
    }
  }
  return out;
}

/**
 * 逐条执行能覆盖多早。
 *
 * 正常情况（一个月以内）永远是 from，一分钟一分钟地走；
 * 只有上线次数超过预算时才把最早的一段交给聚合公式。
 *
 * @returns {number} 逐条推进的起点
 */
function planDetailedStart(from, to, ctx, report) {
  if (estimateVisits(state.friends, from, to) <= VISIT_BUDGET) return from;

  // 从最近 7 天起往上翻倍，找到第一个装得下的窗口
  let days = 7;
  while (to - days * DAY > from
    && estimateVisits(state.friends, to - days * DAY, to) > VISIT_BUDGET) {
    days *= 2;
  }
  const cut = Math.max(from, to - days * DAY);

  // 更早的那段：等级、金币、地块照样推进，只是没有逐条过程
  for (const npc of state.friends) {
    if ((npc.nextVisitAt || 0) < cut) bulkAdvance(npc, cut, ctx);
  }
  report.degraded = true;
  report.dirty = true;
  return cut;
}

/** 推进一段：先做完这段里到点的上线，再收尾本段到期的跨天事务 */
async function tick(prev, next, { ctx, deferFrom, onVisit, report }) {
  // ① 上线：按时刻先后一件件做（同一时刻按数组顺序）
  for (let guard = 0; guard < 500; guard += 1) {
    const due = nextDue(next);
    if (!due) break;
    runOne(due, next, { ctx, deferFrom, onVisit, report });
  }

  // ② 订单到期：放在上线之后 —— 这一步里到期的单，邻居还有机会接。
  //    补算模式下不落盘（一天可能过期好几条，每条写一次库会把启动拖垮）
  if (hasOrderDue(prev, next)) {
    const expired = await expireOrders(next, { quiet: true });
    if (expired) report.dirty = true;
  }

  // ③ 榜单：跨过 14:00 就结算那一期，奖励、时报、庆祝都落在正确的期次上
  if (boardDayKey(prev) !== boardDayKey(next)) {
    const results = checkRollover(next, { quiet: true });
    for (const row of results) {
      if (!row.playerAwards?.length) continue;
      const day = dayBucket(report, next);
      for (const award of row.playerAwards) {
        day.awards.push({ board: award.board, rank: award.rank, value: award.value });
        note(day, award.icon, `你拿了「${award.board}」第 ${award.rank} 名（${award.value}）`);
      }
    }
  }

  // ④ 制造间：到点的炉子收掉（同样不落盘，种子的账由调用方统一写）
  if (hasCraftDue(prev, next)) {
    await claimJobs(next, { quiet: true });
    report.dirty = true;
  }
}

/** 这一段里最早上线的邻居（没有到点的就返回 null） */
function nextDue(until) {
  let best = null;
  for (const npc of state.friends) {
    const at = npc.nextVisitAt || 0;
    if (!at || at > until) continue;
    if (!best || at < best.at) best = { npc, at };
  }
  return best;
}

/** 执行（或递延）一次上线，并把结果记进时间轴 */
function runOne({ npc, at }, until, { ctx, deferFrom, onVisit, report }) {
  const farm = ctx.farm;
  const before = {
    stolen: farm?.stolen ?? 0,
    cared: farm?.cared ?? 0,
    caught: farm?.caught ?? 0,
  };

  // 玩家正盯着：游标推过去，动作交给 social 一步一步演
  if (at >= deferFrom) {
    const levelBefore = beginVisit(npc, at);
    onVisit?.({
      npc,
      at,
      entries: [],
      delta: noDelta(),
      levelBefore,
      deferred: true,
      steps: planVisit(npc, at, ctx),
    });
    return;
  }

  const { levelBefore, results } = runVisit(npc, ctx, at);
  const delta = {
    stolen: (farm?.stolen ?? 0) - before.stolen,
    cared: (farm?.cared ?? 0) - before.cared,
    caught: (farm?.caught ?? 0) - before.caught,
  };
  record({ npc, at, results, delta, levelBefore, report });

  onVisit?.({ npc, at, entries: results, delta, levelBefore, deferred: false });
}

/** 把一次上线记进时间轴（总量 + 当天那一桶） */
function record({ npc, at, results, delta, levelBefore, report }) {
  report.visits += 1;
  report.stolen += delta.stolen;
  report.cared += delta.cared;
  report.caught += delta.caught;

  const day = dayBucket(report, at);
  day.visits += 1;
  day.stolen += delta.stolen;
  day.cared += delta.cared;
  day.caught += delta.caught;

  if (npc.level > levelBefore) {
    day.levelUps.push({ name: npc.name, avatar: npc.avatar, level: npc.level });
    note(day, '🎉', `${npc.name} 的农场升到 Lv.${npc.level}`);
  }
  if (delta.stolen > 0) note(day, '🥷', `${npc.name} 从你农场顺走 ${delta.stolen} 个作物`);
  if (delta.caught > 0) note(day, '🐕', `守护犬把 ${npc.name} 赶走了`);
  // 帮玩家凑齐订单 / 送礼这类「给玩家东西」的动作带上 gave 标记
  for (const entry of results) {
    if (entry?.gave) note(day, '📦', `${npc.name}：${entry.text}`);
  }
}

/* ---------- 本段有哪些跨天事务到期 ---------- */

function hasOrderDue(prev, next) {
  const inRange = (o) => o && o.deadline > prev && o.deadline <= next;
  if ((state.farm.orders || []).some(inRange)) return true;
  return state.friends.some((npc) => inRange(npc.order));
}

function hasCraftDue(prev, next) {
  return (state.farm.workshop?.jobs || []).some((job) => job.doneAt > prev && job.doneAt <= next);
}
