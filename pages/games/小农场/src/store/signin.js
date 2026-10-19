/**
 * 签到领域：每日签到 + 连续签到奖励。
 *
 * 字段说明：
 *   lastSign   上次签到的时间戳
 *   signStreak 当前连续签到天数，断签归 1
 *   signTotal  累计签到总天数（不清零，用于展示生涯统计）
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';
import { addCoins, addExpRaw } from './player.js';
import { add } from './inventory.js';
import { CYCLE_DAYS, daysLeftInCycle, rewardFor } from '../data/signin.js';
import { dayKey, isSameDay } from '../core/utils.js';
import { notify } from './notify.js';

const DAY_MS = 86_400_000;

/** 补齐后来新增的字段 */
export function ensureSignFields() {
  const p = state.player;
  if (p.signStreak === undefined) p.signStreak = 0;
  if (p.signTotal === undefined) p.signTotal = 0;
}

/** 今天是否已经签过 */
export function signedToday(now = Date.now()) {
  const { lastSign } = state.player;
  return Boolean(lastSign) && isSameDay(lastSign, now);
}

/**
 * 连续签到是否已中断（昨天没签，且不是今天）
 * @returns {boolean}
 */
export function streakBroken(now = Date.now()) {
  const { lastSign, signStreak } = state.player;
  if (!lastSign || signStreak === 0) return false;
  return !isSameDay(lastSign, now) && now - lastSign > DAY_MS;
}

/** 今天是本轮的第几天（1 起算） */
export function todayStreakDay(now = Date.now()) {
  const { signStreak } = state.player;
  if (signedToday(now)) return (signStreak - 1) % CYCLE_DAYS + 1;
  return streakBroken(now) ? 1 : signStreak % CYCLE_DAYS + 1;
}

/** 当前连续签到的天数 */
export const currentStreak = () => state.player.signStreak;

/** 距离本轮结束还差几天 */
export const leftInCycle = () => daysLeftInCycle(state.player.signStreak);

/** 今天签到能拿到什么（用于按钮上的预告） */
export function todayReward(now = Date.now()) {
  return rewardFor(todayStreakDay(now));
}

/**
 * 每日签到
 * @returns {Promise<boolean>} 今天已签过则返回 false
 */
export async function signIn(now = Date.now()) {
  ensureSignFields();
  if (signedToday(now)) return false;

  // 昨天签过就续上，否则从第 1 天重新开始
  state.player.signStreak = streakBroken(now) ? 1 : state.player.signStreak + 1;
  state.player.lastSign = now;
  state.player.signTotal += 1;

  const reward = rewardFor(state.player.signStreak);
  addCoins(reward.coins);
  addExpRaw(reward.exp);
  for (const [itemId, n] of Object.entries(reward.items)) add(itemId, n);

  await commit({ player: state.player }, { bag: state.bag });
  emit(EVENTS.PLAYER);
  emit(EVENTS.INVENTORY);
  emit(EVENTS.SIGN);

  const extras = Object.entries(reward.items)
    .map(([id, n]) => `${itemName(id)}×${n}`)
    .join(' ');
  notify(
    `📅 第 ${todayStreakDay(now)} 天签到　+${reward.coins} 💰 +${reward.exp} 经验${extras ? `　${extras}` : ''}`,
    'gold',
  );
  return true;
}

/* ---------- 日历 ---------- */

/** 道具 id → 中文名，用于签到提示 */
const ITEM_NAMES = {
  fertilizer: '普通化肥',
  organic: '有机化肥',
  herbicide: '除草剂',
  pesticide: '杀虫剂',
  dogFood: '狗粮',
};
const itemName = (id) => ITEM_NAMES[id] || id;

/**
 * 生成当月日历
 * @param {number} [now]
 * @returns {{title: string, head: string[], cells: Array<{day:number, state:'signed'|'today'|'future'|'missed'|'none'}>}}
 *   state: signed 已签 / today 今天未签 / future 未来 / missed 已错过 / none 空白补位
 */
export function calendarOf(now = Date.now()) {
  const date = new Date(now);
  const year = date.getFullYear();
  const month = date.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // getDay(): 0=周日，这里把周一排到第一列
  const lead = (date.getDay() + 6) % 7;

  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push({ day: 0, state: 'none' });

  for (let day = 1; day <= daysInMonth; day += 1) {
    const at = new Date(year, month, day, 12, 0, 0).getTime();
    const isToday = day === date.getDate();
    let state = 'future';

    if (isToday) {
      state = signedToday(at) ? 'signed' : 'today';
    } else if (at < now) {
      state = 'past';
    } else {
      state = 'future';
    }

    cells.push({ day, state, at, reward: rewardFor(day) });
  }

  return {
    title: `${year} 年 ${month + 1} 月`,
    head: ['一', '二', '三', '四', '五', '六', '日'],
    cells,
  };
}

export { CYCLE_DAYS, dayKey };