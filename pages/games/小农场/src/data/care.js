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
 * 下限 = 已处理次数 × 1 小时
 * 上限 = 已处理次数 × 2 + 1 小时
 * 下次 = 现在 + [下限, 上限] 内随机（精确到分钟）
 * ```
 *
 * 下限跟着次数走是这一版的重点：**处理得越多，下一次来得越晚**
 * （0 次 → 1h、1 次 → 3h、2 次 → 5h…），否则会出现「刚浇完一分钟又缺水」
 * 这种纯粹折腾人的循环。刚种下时下限是 0，可以立刻遇到第一次需求。
 *
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

/**
 * 一次照料（浇水 / 捉虫）给的经验：**作物等级 ÷ 10，至少 1**。
 *
 * 旧口径是「作物几级就给几点」——搬到 200 级作物身上，一次浇水就顶别人
 * 半级经验，照料从「顺手做的事」变成了刷经验的最优解，玩家会去挑最高级
 * 的作物反复浇水而不是好好种地。除以 10 之后，1 级作物仍然是 1 点，
 * 200 级作物给 20 点：高级作物照样更值钱，但不至于离谱。
 *
 * 四舍五入而不是直接截断：7 级的作物给 1 点、16 级的给 2 点，
 * 曲线在 `lv × 10 + 5` 处台阶式上升，玩家不会因为「差一级就是不给」而困惑。
 *
 * @param {number} level 作物等级（`crop.lv`）
 * @returns {number} 整数经验，至少 1
 */
export const careExp = (level) => Math.max(1, Math.round((Number(level) || 1) / 10));

/** 一次没处理就减产的比例 */
export const CARE_PENALTY = 0.15;

/** 两个都没处理时减产的比例（不是 30%，照需求取 40%） */
export const CARE_PENALTY_BOTH = 0.4;

/**
 * 排下一次照料时间。
 *
 * 窗口是 `[次数 × 1h, (次数 × 2 + 1)h]`，再夹到「成熟前 15 分钟」这道线以内。
 * 下限顶到线上（剩下的时间不够再排一次）时返回 0：这一轮不再需要照料，
 * 也就不该因为「排不下」而扣玩家的产量。
 *
 * @param {number} now 起算时刻
 * @param {number} times 这一轮已经处理过几次（浇水次数 / 杀虫次数各自独立）
 * @param {number} readyAt 本轮成熟时间
 * @returns {number} 时间戳；**0 表示这一轮不会再需要**（已经来不及了）
 */
export function nextCareAt(now, times, readyAt) {
  const latest = readyAt - CARE_MARGIN;
  if (now >= latest) return 0;

  const done = Math.max(0, times);
  const loMinutes = done * 60;
  const hiMinutes = Math.min((done * 2 + 1) * 60, Math.floor((latest - now) / MINUTE));
  // 连下限都放不下：剩下的时间不够玩家反应，直接结束这一轮
  if (loMinutes > hiMinutes) return 0;
  return now + randInt(loMinutes, hiMinutes) * MINUTE;
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

/**
 * 地块左上角那个「+XX%」角标的数值（渲染见 views/farm.js 的 boostHTML）。
 *
 * 两种来源相乘：捉虫累积（每只 +10%）× 增产剂（一次性 10/20/30%），
 * 显示的是合并后的实际增幅（百分比取整）。
 *
 * 每日排行榜的「打理王」用它当口径：收获时这块地带着多少加成，就记多少。
 * NPC 地块没有增产剂（yieldBonus 缺省按 0），两边同一套公式才公平。
 *
 * @param {object} plot
 * @returns {number} 整数百分比，如 69；没有任何加成返回 0
 */
export function cornerBonusPct(plot) {
  const total = (1 + (plot?.boost || 0)) * (1 + (plot?.yieldBonus || 0)) - 1;
  return Math.round(total * 100);
}

/**
 * 一座农场所有地块里最高的角标加成百分比（「打理王」口径 = 全场当前最高）。
 * @param {object[]} plots
 * @returns {number} 整数百分比
 */
export function farmMaxBonus(plots) {
  let max = 0;
  for (const plot of plots || []) {
    if (!plot?.cropId) continue;
    const v = cornerBonusPct(plot);
    if (v > max) max = v;
  }
  return max;
}
