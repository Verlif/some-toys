/**
 * 世界时钟的调参。
 *
 * 第 46 轮之前，离线是「按 NPC 各算各的」：7 天以内逐条跑上线，
 * 更早的一律用聚合公式一次性抹平。结果是离线一个月回来，
 * 前 23 天既没有过程也没有排行榜记录，地块还是按随机进度重造的。
 *
 * 现在整个世界的推进只有一个驱动 —— 时间：从上次下线逐段走到现在，
 * 每一段把「这段里到点的所有事」按先后做完（NPC 上线、订单到期、
 * 榜单跨 14 点结算、制造间收炉）。段长按离线总跨度自适应：
 * 一周以内 1 分钟一步，之后每翻一倍时长步长翻倍，封顶 1 小时。
 *
 * 为什么可以粗：邻居上线间隔是小时级、照料窗口是小时级，
 * 2~8 分钟的步长只会让动作发生时刻偏几分钟，不影响任何数值；
 * 而步长不放大，离线一年就是 52 万次循环（动作次数一分不少，
 * 白烧 CPU）。
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 逐分钟推进的基准跨度：一周以内都用 1 分钟一步 */
export const STEP_BASE_SPAN = 7 * DAY;

/** 步长下限 / 上限 */
export const STEP_MIN = MINUTE;
export const STEP_MAX = HOUR;

/**
 * 离线推进的步长。
 *
 * ≤7 天 → 1 分钟；7~14 天 → 2 分钟；14~28 天 → 4 分钟……
 * 一年 ≈ 512 分钟 → 封顶 60 分钟。
 *
 * @param {number} spanMs 离线总跨度
 * @returns {number} 毫秒
 */
export function stepMsFor(spanMs) {
  if (!Number.isFinite(spanMs) || spanMs <= STEP_BASE_SPAN) return STEP_MIN;
  const doublings = Math.ceil(Math.log2(spanMs / STEP_BASE_SPAN));
  return Math.min(STEP_MAX, STEP_MIN * 2 ** doublings);
}

/**
 * 超过这个跨度才值得弹「离线时间轴」。
 *
 * 两小时以内的零碎离开（切个后台、吃个饭）用邻居页那一句摘要就够，
 * 每次都弹一层报告会烦。
 */
export const REPORT_MIN_SPAN = 2 * HOUR;

/**
 * 单次推进最多逐条执行多少次上线。
 *
 * 步长自适应解决的是「循环次数」，解决不了「上线次数」——
 * 离线一年有约 5 万次上线，逐条跑要十几秒。超预算时把**最早的一段**
 * 按汇总跳过（等级、金币、地块照常推进，只是没有逐条过程），
 * 最近的那段仍然一分钟一分钟地走。正常玩家（一个月以内）永远碰不到。
 */
export const VISIT_BUDGET = 30_000;

/** 每帧的时间预算（毫秒）：一帧干这么多活就让出主线程 */
export const FRAME_MS = 12;

/** 一天里最多往报告里塞几条「有料」的事，超了就只留计数 */
export const REPORT_NOTES_PER_DAY = 6;
