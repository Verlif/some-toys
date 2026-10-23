/**
 * 签到领域：每日签到 + 连续签到奖励 + 周六盲盒。
 *
 * 字段说明：
 *   lastSign   上次签到的时间戳
 *   signStreak 当前连续签到天数，断签归 1
 *   signTotal  累计签到总天数（不清零，用于展示生涯统计）
 *
 * 每天固定发：普通化肥（缩短 30 分钟）×1 + 一颗随机商店种子 + 少量金币。
 * 连续签到的 7 天循环体现在金币倍数上；每周六额外开一个盲盒。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';
import { addCoins } from './player.js';
import { add } from './inventory.js';
import { CYCLE_DAYS, DAILY_ITEM, daysLeftInCycle, isBigDay, rewardFor, SIGN_KEEP_DAYS } from '../data/signin.js';
import { CROPS } from '../data/crops.js';
import { MAP_TIERS, buildRewardPool } from '../data/adventure.js';
import { produceId, seedId } from '../data/keys.js';
import { dayKey, isSameDay, randInt } from '../core/utils.js';
import { completeGuide } from './codex.js';

const DAY_MS = 86_400_000;

/** 补齐后来新增的字段 */
export function ensureSignFields() {
  const p = state.farm.progress;
  if (p.signStreak === undefined) p.signStreak = 0;
  if (p.signTotal === undefined) p.signTotal = 0;
  if (!Array.isArray(p.signDays)) p.signDays = [];
}

/** 今天是否已经签过 */
export function signedToday(now = Date.now()) {
  const { lastSign } = state.farm.progress;
  return Boolean(lastSign) && isSameDay(lastSign, now);
}

/**
 * 某个日期键有没有签过到（日历标「已签」用）
 * @param {number} ts 当天的任意时刻
 * @returns {boolean}
 */
export function signedOn(ts) {
  return (state.farm.progress.signDays || []).includes(dayKey(ts));
}

/**
 * 连续签到是否已中断（昨天没签，且不是今天）
 * @returns {boolean}
 */
export function streakBroken(now = Date.now()) {
  const { lastSign, signStreak } = state.farm.progress;
  if (!lastSign || signStreak === 0) return false;
  return !isSameDay(lastSign, now) && now - lastSign > DAY_MS;
}

/** 今天是本轮的第几天（1 起算） */
export function todayStreakDay(now = Date.now()) {
  const { signStreak } = state.farm.progress;
  if (signedToday(now)) return (signStreak - 1) % CYCLE_DAYS + 1;
  return streakBroken(now) ? 1 : signStreak % CYCLE_DAYS + 1;
}

/** 当前连续签到的天数 */
export const currentStreak = () => state.farm.progress.signStreak;

/** 距离本轮结束还差几天 */
export const leftInCycle = () => daysLeftInCycle(state.farm.progress.signStreak);

/** 今天是不是大奖日（周六） */
export const isBigDayToday = (now = Date.now()) => isBigDay(now);

/**
 * 把「倍数」换算成实际数额。
 *
 * 基准是玩家当前等级的一次正常收获：
 *   金币 ≈ 该等级最贵作物的售价 × 3
 * 这样 200 级时签到依然有意义，1 级时也不会一次送掉几十级。
 */
function coinBase(level) {
  const best = Object.values(CROPS)
    .filter((c) => c.lv <= level)
    .reduce((max, c) => Math.max(max, c.sell), 12);
  return Math.max(10, Math.round(best * 3));
}

/**
 * 今天签到能拿到什么（用于界面上的预告）。
 *
 * 种子的具体品种是签到那一刻才掷的，这里只给等级上限 ——
 * 预告要是写死某一种种子，实际发到的却不是它，就成了一句话骗人。
 */
export function todayReward(now = Date.now()) {
  const level = state.farm.level;
  const mul = rewardFor(todayStreakDay(now));
  return {
    coins: Math.max(10, Math.round(coinBase(level) * mul.coins)),
    items: { [DAILY_ITEM]: 1 },
    /** 随机种子的等级上限 */
    seedLv: level,
    /** 今天是大奖日 */
    big: isBigDay(now),
  };
}

/** 随机一颗商店种子（等级不高于农场等级） */
function rollSeedId(level) {
  const pool = Object.keys(CROPS).filter((id) => !CROPS[id].special && CROPS[id].lv <= level);
  return pool.length ? pool[randInt(0, pool.length - 1)] : null;
}

/**
 * 周六盲盒：从「玩家等级对应的最高可用藏宝图」的奖励池里抽一份。
 *
 * 等级不够 10 级时还没有可用的藏宝图，返回 null（发奖时走兜底）。
 * @returns {?{map: object, reward: object}}
 */
export function rollBigBox(level = state.farm.level) {
  const usable = MAP_TIERS.filter((m) => level >= m.unlock);
  if (!usable.length) return null;

  const map = usable[usable.length - 1];
  const pool = buildRewardPool(map.tier);
  if (!pool.rewards.length) return null;

  return { map, reward: pool.rewards[randInt(0, pool.rewards.length - 1)] };
}

/** 盲盒里那份奖励的发放方式 */
function applyBoxReward(reward) {
  if (!reward) return;
  if (reward.kind === 'coin') addCoins(reward.n);
  else if (reward.kind === 'item') add(reward.id, reward.n);
  else if (reward.kind === 'produce') add(produceId(reward.id), reward.n);
  else add(seedId(reward.id), reward.n);
}

/** 盲盒奖励的中文说明 */
export function describeBoxReward(reward) {
  if (!reward) return '';
  if (reward.kind === 'coin') return `💰 ${reward.n.toLocaleString()} 金币`;
  return `${reward.emoji} ${reward.name} ×${reward.n}`;
}

/**
 * 每日签到
 *
 * 提示不在这里发 —— 签到成功的庆祝画面由 UI 层订阅 SIGN 事件时播放，
 * 所以这里把「今天拿到了什么」一起带出去。
 *
 * @param {number} [now]
 * @returns {Promise<null|{day:number, streak:number, coins:number, items:object,
 *                        seed:?object, box:?object}>}
 *   今天已签过则返回 null
 */
export async function signIn(now = Date.now()) {
  ensureSignFields();
  if (signedToday(now)) return null;

  // 昨天签过就续上，否则从第 1 天重新开始
  state.farm.progress.signStreak = streakBroken(now) ? 1 : state.farm.progress.signStreak + 1;
  state.farm.progress.lastSign = now;
  state.farm.progress.signTotal += 1;

  // 签到历史：记下这一天，日历上才能看出「哪天签过、哪天断了」
  const days = state.farm.progress.signDays;
  days.push(dayKey(now));
  if (days.length > SIGN_KEEP_DAYS) days.splice(0, days.length - SIGN_KEEP_DAYS);

  const day = todayStreakDay(now);
  const reward = todayReward(now);
  addCoins(reward.coins);
  for (const [itemId, n] of Object.entries(reward.items)) add(itemId, n);

  // 每天一颗随机种子
  const seedIdPicked = rollSeedId(state.farm.level);
  const seed = seedIdPicked ? { id: seedIdPicked, ...CROPS[seedIdPicked] } : null;
  if (seedIdPicked) add(seedId(seedIdPicked), 1);

  // 周六大奖日：再开一个盲盒
  let box = null;
  if (reward.big) {
    box = rollBigBox(state.farm.level);
    if (box) {
      applyBoxReward(box.reward);
    } else {
      // 等级还不够买第一档藏宝图，兜底给点金币与化肥
      addCoins(Math.max(50, coinBase(state.farm.level)));
      add(DAILY_ITEM, 2);
      box = { map: null, reward: null };
    }
  }

  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.PLAYER);
  emit(EVENTS.INVENTORY);

  const payload = {
    day,
    streak: state.farm.progress.signStreak,
    coins: reward.coins,
    items: reward.items,
    seed,
    box,
  };
  emit(EVENTS.SIGN, payload);
  await completeGuide('sign');
  return payload;
}

/**
 * 打开游戏时自动结算今天的签到，已签过就什么都不做。
 *
 * 也挂在 main.js 的分钟 tick 上：玩家跨 0 点还在线上时，
 * 翻日的那一刻同样自动领（庆祝画面照播，与开机那次一致）。
 * @returns {Promise<null|object>} 同 signIn
 */
export async function autoSignIn(now = Date.now()) {
  return signedToday(now) ? null : signIn(now);
}

/* ---------- 日历 ---------- */

/**
 * 生成当月日历
 * @param {number} [now]
 * @returns {{title: string, head: string[], cells: Array<{day:number, state:'signed'|'today'|'past'|'future'|'none', at:number, big:boolean}>}}
 *   state: signed 已签 / today 今天未签 / past 已错过 / future 未来 / none 空白补位
 */
export function calendarOf(now = Date.now()) {
  const date = new Date(now);
  const year = date.getFullYear();
  const month = date.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // ⚠️ 空位数必须按**当月 1 号**是星期几算，不能拿「今天」算 ——
  // 拿今天算的话整月会被平移（10 月 21 日是周三，1 号却是周四，
  // 于是 21 号显示在「二」下面、周六的大奖图标跑到「五」上）。
  // getDay(): 0=周日，这里把周一排到第一列
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;

  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push({ day: 0, state: 'none' });

  for (let day = 1; day <= daysInMonth; day += 1) {
    const at = new Date(year, month, day, 12, 0, 0).getTime();
    const isToday = day === date.getDate();
    let state = 'future';

    if (isToday) {
      state = signedToday(at) ? 'signed' : 'today';
    } else if (at < now) {
      // 过去的日子按签到历史标：签过的是 signed，没签过的留 past
      state = signedOn(at) ? 'signed' : 'past';
    }

    cells.push({ day, state, at, big: isBigDay(at) });
  }

  return {
    title: `${year} 年 ${month + 1} 月`,
    head: ['一', '二', '三', '四', '五', '六', '日'],
    cells,
  };
}

export { CYCLE_DAYS, dayKey };
