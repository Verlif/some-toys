/**
 * 签到配置。
 *
 * 每天固定发三样：
 *   普通化肥（缩短 30 分钟）×1
 *   一颗随机商店种子（等级不高于当前农场等级）
 *   少量金币（按连续签到的天数递增）
 *
 * 连续签到仍然是一个 7 天循环，差异体现在金币倍数上 ——
 * 断签从第 1 天重新累计（见 store/signin.js）。
 *
 * 每周六是**大奖日**：除了日常奖励，还能开一个盲盒，
 * 从「玩家等级对应的那一档藏宝图」的奖励池里随机抽一份。
 */

/**
 * 一个完整循环的七天奖励。
 * coins 是「该等级一次正常收获的价值」的倍数。
 */
export const SIGN_CYCLE = [
  { day: 1, coins: 1.0 },
  { day: 2, coins: 1.3 },
  { day: 3, coins: 1.7 },
  { day: 4, coins: 2.2 },
  { day: 5, coins: 2.8 },
  { day: 6, coins: 3.5 },
  { day: 7, coins: 5.0 },
];

/** 循环长度 */
export const CYCLE_DAYS = SIGN_CYCLE.length;

/** 每天固定发的那一袋普通化肥（缩短 30 分钟） */
export const DAILY_ITEM = 'fertilizer';

/**
 * 取当天应得的奖励倍数
 * @param {number} streak 连续签到天数（从 1 开始）
 */
export function rewardFor(streak) {
  return SIGN_CYCLE[(Math.max(1, streak) - 1) % CYCLE_DAYS];
}

/** 距离本轮结束还差几天（第 7 天签完即为 0） */
export const daysLeftInCycle = (streak) => CYCLE_DAYS - (streak % CYCLE_DAYS);

/**
 * 某个时间戳是不是周六（大奖日）。
 * getDay(): 0=周日 … 6=周六
 * @param {number} ts
 */
export const isBigDay = (ts) => new Date(ts).getDay() === 6;
