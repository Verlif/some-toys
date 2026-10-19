/**
 * 签到配置：七天循环。
 *
 * 周期短回报密，是养成游戏里最容易坚持下来的日常；
 * 第 7 天给一份明显更厚的大赏（含道具），让「快满一轮」成为一个可见的目标。
 * 中断签到不会倒退到零，而是从第 1 天重新累计（见 store/signin.js）。
 */

/** 一个完整循环的七天奖励 */
export const SIGN_CYCLE = [
  { coins: 50, exp: 20, items: {} },
  { coins: 80, exp: 30, items: {} },
  { coins: 120, exp: 45, items: { fertilizer: 1 } },
  { coins: 180, exp: 60, items: {} },
  { coins: 260, exp: 90, items: { organic: 1 } },
  { coins: 400, exp: 130, items: { dogFood: 2 } },
  { coins: 2000, exp: 500, items: { fertilizer: 5, organic: 3, dogFood: 3 } },
];

/** 循环长度 */
export const CYCLE_DAYS = SIGN_CYCLE.length;

/**
 * 取当天应得的奖励
 * @param {number} streak 连续签到天数（从 1 开始）
 */
export function rewardFor(streak) {
  return SIGN_CYCLE[(Math.max(1, streak) - 1) % CYCLE_DAYS];
}

/** 距离本轮结束还差几天（第 7 天签完即为 0） */
export const daysLeftInCycle = (streak) => CYCLE_DAYS - (streak % CYCLE_DAYS);