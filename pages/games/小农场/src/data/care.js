/**
 * 照料排程 —— 浇水与杀虫什么时候发生。
 *
 * 旧版是**固定周期**（6 小时浇一次水、12 小时生一次虫），和作物自己长了多久
 * 完全无关：半小时成熟的作物从头到尾一次都不用管，反而是等它熟了之后
 * 那个「该浇水了」的时间才到（成熟后又不显示按钮），等于永不触发。
 *
 * 现在按「这一轮已经处理过几次」排：
 *
 * ```
 * 下次 = 现在 + [1 分钟, (已处理次数 × 2 + 1) 小时] 内随机（精确到分钟）
 * ```
 *
 * 所以刚种下时窗口只有 1 小时，越往后越久（1h → 3h → 5h → 7h…），
 * 一旦下一次会落在成熟之后，这一轮就自然结束了 —— 不需要另设次数上限。
 *
 * 另外**不会排进成熟前 15 分钟**：那段时间玩家来不及操作，
 * 排了也只是「无缘无故被扣产量」。
 *
 * 这个模块是纯函数：玩家农场与邻居农场共用同一套规则。
 */
import { randInt } from '../core/utils.js';

const HOUR = 3600_000;
const MINUTE = 60_000;

/** 成熟前留出的操作余量：这段时间内不再安排新的照料需求 */
export const CARE_MARGIN = 15 * MINUTE;

/** 一次没处理就减产的比例 */
export const CARE_PENALTY = 0.15;

/** 两个都没处理时减产的比例（不是 30%，照需求取 40%） */
export const CARE_PENALTY_BOTH = 0.4;

/**
 * 排下一次照料时间。
 *
 * @param {number} now 起算时刻
 * @param {number} times 这一轮已经处理过几次（浇水次数 / 杀虫次数各自独立）
 * @param {number} readyAt 本轮成熟时间
 * @returns {number} 时间戳；**0 表示这一轮不会再需要**（已经来不及了）
 */
export function nextCareAt(now, times, readyAt) {
  const latest = readyAt - CARE_MARGIN;
  if (now >= latest) return 0;

  // 窗口随次数线性变长，但不会超过「成熟前 15 分钟」这道线
  const window = (Math.max(0, times) * 2 + 1) * HOUR;
  const span = Math.min(window, latest - now);
  const minutes = Math.max(1, Math.floor(span / MINUTE));
  return now + randInt(1, minutes) * MINUTE;
}

/**
 * 给一块地重排两种照料时间（种下、进入再生轮时调用）。
 * @param {object} plot
 * @param {number} [now]
 */
export function scheduleCare(plot, now = Date.now()) {
  if (!plot.cropId) {
    plot.waterNext = 0;
    plot.pestNext = 0;
    plot.waterTimes = 0;
    plot.pestTimes = 0;
    return;
  }
  plot.waterNext = nextCareAt(now, plot.waterTimes || 0, plot.readyAt);
  plot.pestNext = nextCareAt(now, plot.pestTimes || 0, plot.readyAt);
}

/**
 * 处理掉一次需求，并把下一次排上。
 *
 * @param {object} plot
 * @param {'water'|'pest'} kind
 * @param {number} [now]
 */
export function serveCare(plot, kind, now = Date.now()) {
  if (kind === 'water') {
    plot.waterTimes = (plot.waterTimes || 0) + 1;
    plot.waterNext = nextCareAt(now, plot.waterTimes, plot.readyAt);
  } else {
    plot.pestTimes = (plot.pestTimes || 0) + 1;
    plot.pestNext = nextCareAt(now, plot.pestTimes, plot.readyAt);
  }
}

/**
 * 是否需要浇水。
 *
 * 两道条件：`waterNext` 排上了（不是 0）、时间到了、**还没成熟**。
 * 成熟之后就不再冒照料按钮 —— 该结算的减产在成熟那一刻已经算过了。
 * @param {object} plot
 * @param {number} [now]
 */
export const needsWater = (plot, now = Date.now()) =>
  Boolean(plot.cropId) && now < plot.readyAt && (plot.waterNext || 0) > 0 && now >= plot.waterNext;

/** 是否需要杀虫，规则同上 */
export const needsPest = (plot, now = Date.now()) =>
  Boolean(plot.cropId) && now < plot.readyAt && (plot.pestNext || 0) > 0 && now >= plot.pestNext;

/**
 * 成熟时还在「等着被照料」的状态。
 *
 * 判据是「排上的那一次是不是落在成熟之前」—— 处理过一次就会往后挪，
 * 挪不动了（0）就说明这一轮已经尽到责任了。成熟之后这两个字段不再变化，
 * 所以随时算都得到同一个结果，不需要另存一份「减产了多少」。
 *
 * @param {object} plot
 * @returns {{mul: number, dry: boolean, buggy: boolean, pct: number}}
 */
export function carePenalty(plot) {
  if (!plot?.cropId) return { mul: 1, dry: false, buggy: false, pct: 0 };
  const dry = (plot.waterNext || 0) > 0 && plot.waterNext <= plot.readyAt;
  const buggy = (plot.pestNext || 0) > 0 && plot.pestNext <= plot.readyAt;
  if (!dry && !buggy) return { mul: 1, dry, buggy, pct: 0 };
  const lost = dry && buggy ? CARE_PENALTY_BOTH : CARE_PENALTY;
  return { mul: 1 - lost, dry, buggy, pct: Math.round(lost * 100) };
}
