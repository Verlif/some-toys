/**
 * 签到配置：七天循环。
 *
 * 周期短回报密，是养成游戏里最容易坚持下来的日常；
 * 第 7 天给一份明显更厚的大赏（含道具），让「快满一轮」成为一个可见的目标。
 * 中断签到不会倒退到零，而是从第 1 天重新累计（见 store/signin.js）。
 *
 * 奖励用**倍数**表示而不是固定数额：
 * 作物成熟时间从 40 秒变成几小时之后，经验与金币的量级在 200 级跨度上
 * 相差上万倍，写死数字会让签到在前期送钱送经验、后期什么都不算。
 */

/** 一个完整循环的七天奖励，数值是相对「一次正常收获」的倍数 */
export const SIGN_CYCLE = [
  { day: 1, coins: 1.0, exp: 0.5, items: {} },
  { day: 2, coins: 1.4, exp: 0.8, items: {} },
  { day: 3, coins: 2.0, exp: 1.2, items: { fertilizer: 1 } },
  { day: 4, coins: 2.8, exp: 1.8, items: {} },
  { day: 5, coins: 4.0, exp: 2.6, items: { organic: 1 } },
  { day: 6, coins: 6.0, exp: 4.0, items: { dogFood: 2 } },
  { day: 7, coins: 20.0, exp: 14.0, items: { fertilizer: 5, organic: 3, dogFood: 3 } },
];

/** 循环长度 */
export const CYCLE_DAYS = SIGN_CYCLE.length;

/**
 * 取当天应得的奖励倍数
 * @param {number} streak 连续签到天数（从 1 开始）
 */
export function rewardFor(streak) {
  return SIGN_CYCLE[(Math.max(1, streak) - 1) % CYCLE_DAYS];
}

/** 距离本轮结束还差几天（第 7 天签完即为 0） */
export const daysLeftInCycle = (streak) => CYCLE_DAYS - (streak % CYCLE_DAYS);
