/**
 * 农场主领域：等级 / 经验 / 金币 / 农场日志。
 *
 * 这些字段都是「农场」的属性，存在 state.farm 上 ——
 * 玩家农场与邻居农场是同一套结构，区别只在于玩家这一座还带
 * progress（签到 / 图鉴 / 称号 / 引导）与狗窝。
 *
 * 分成两类函数：
 * - 无后缀的 mutator：只改内存，不落盘，便于与其它改动合并成一次提交；
 * - flushPlayer()：把农场写盘并广播变更。
 *
 * 签到已独立到 store/signin.js，统计与引导在 store/codex.js。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';
import { expForLevel, MAX_LEVEL, unlockedPlotCount } from '../data/progression.js';
import { notify } from './notify.js';
import { addNews } from './news.js';

/** 没加到经验时的返回值（等级保持不变） */
function noGain() {
  return {
    levelBefore: state.farm.level,
    levelAfter: state.farm.level,
    leveledUp: false,
    unlockedPlots: 0,
  };
}

/* ---------- 内存 mutator（不落盘） ---------- */

/** 加金币，下限 0 */
export function addCoins(amount) {
  state.farm.coins = Math.max(0, state.farm.coins + amount);
}

/** 扣金币；余额不足返回 false 且不改动 */
export function spendCoins(amount) {
  if (state.farm.coins < amount) return false;
  state.farm.coins -= amount;
  return true;
}

/**
 * 加经验并处理连续升级。
 * @param {number} amount
 * @returns {{levelBefore: number, levelAfter: number, leveledUp: boolean, unlockedPlots: number}}
 */
export function addExpRaw(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return noGain();

  const farm = state.farm;
  const levelBefore = farm.level;
  const plotsBefore = unlockedPlotCount(levelBefore);

  farm.exp += amount;
  while (farm.level < MAX_LEVEL && farm.exp >= expForLevel(farm.level)) {
    farm.exp -= expForLevel(farm.level);
    farm.level += 1;
  }
  // 满级后经验不再累积，避免溢出成一个天文数字
  if (farm.level >= MAX_LEVEL) farm.exp = 0;

  const result = {
    levelBefore,
    levelAfter: farm.level,
    leveledUp: farm.level > levelBefore,
    unlockedPlots: unlockedPlotCount(farm.level) - plotsBefore,
  };

  if (result.leveledUp) {
    notify(`🎉 升级！现在是 Lv.${farm.level}`, 'gold');
    addNews('🎉', `${farm.name} 的农场升到了 Lv.${farm.level}`, Date.now(), farm.id);
    if (result.unlockedPlots > 0) {
      setTimeout(() => notify('🔓 新地块已解锁！'), 700);
    }
  }
  return result;
}

/* ---------- 农场日志 ---------- */

/** 农场日志只保留最近这么多天 */
const LOG_KEEP_DAYS = 7;

/** 再多也留这么些条，避免存档无限膨胀 */
const LOG_CAP = 60;

/**
 * 记一条农场日志（内存操作，随下一次 commit 一起落盘）。
 *
 * 玩家自己的操作、商店买卖、邻居来偷菜 / 帮忙照料都走这里。
 * 日志按写入顺序保存，展示时按时间倒序 —— 邻居结算会补写过去的时间点，
 * 所以不能假设数组本身就是有序的。
 *
 * @param {string} emoji
 * @param {string} text
 * @param {number} [at] 事件发生时间，补算历史时用
 */
export function addLog(emoji, text, at = Date.now()) {
  const log = state.farm.log ?? (state.farm.log = []);
  log.unshift({ at, emoji, text });

  const cutoff = Date.now() - LOG_KEEP_DAYS * 86_400_000;
  const kept = log.filter((entry) => entry.at >= cutoff).slice(0, LOG_CAP);
  log.length = 0;
  log.push(...kept);
}

/* ---------- 落盘 ---------- */

/** 写回玩家农场并通知 UI */
export async function flushPlayer() {
  await commit({ farms: [state.farm] });
  emit(EVENTS.PLAYER);
}
