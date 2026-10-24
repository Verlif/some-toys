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
import { expForLevel, MAX_LEVEL } from '../data/progression.js';
import { trimLog } from '../data/friends.js';
import { notify } from './notify.js';
import { addNews } from './news.js';
import { broadcastToast } from './peers.js';

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
 *
 * 升级**不再送地** —— 地从第 7 块起都要花金币买（`store/farm.js` 的 `unlockPlot`），
 * 升级只给等级与称号。`unlockedPlots` 留着是为了不破坏调用方的解构，恒为 0。
 *
 * @param {number} amount
 * @returns {{levelBefore: number, levelAfter: number, leveledUp: boolean, unlockedPlots: number}}
 */
export function addExpRaw(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return noGain();

  const farm = state.farm;
  const levelBefore = farm.level;

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
    unlockedPlots: 0,
  };

  if (result.leveledUp) {
    notify(`🎉 升级！现在是 Lv.${farm.level}`, 'gold');
    addNews('🎉', `${farm.name} 的农场升到了 Lv.${farm.level}`);
    broadcastToast(`🎉 升到了 Lv.${farm.level}`);
  }
  return result;
}

/**
 * 改昵称。名字只影响**以后**的文案：日志里存的是写入时的整句话，
 * 旧记录里的旧名字不会跟着变（人名标签靠文本扫描匹配，见 ui/inline-tags.js）。
 *
 * @param {string} raw
 * @returns {Promise<boolean>} 是否真的改了
 */
export async function renamePlayer(raw) {
  const name = String(raw || '')
    .replace(/[<>&"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 10);
  if (!name || name === state.farm.name) return false;

  state.farm.name = name;
  await flushPlayer();
  notify(`📛 以后大家就叫你「${name}」了`);
  return true;
}

/* ---------- 农场日志 ---------- */

/**
 * 记一条农场日志（内存操作，随下一次 commit 一起落盘）。
 *
 * 玩家自己的操作、商店买卖都走这里；邻居来偷菜 / 帮忙照料 / 送礼走同一个入口，
 * 但要传 `by`（干这件事的邻居农场 id）—— 农场日志浮窗靠它分出
 * 「我的操作」与「邻居动向」两个 tab（见 ui/log-sheet.js）。
 *
 * 日志按写入顺序保存，展示时按时间倒序 —— 邻居结算会补写过去的时间点，
 * 所以不能假设数组本身就是有序的。
 *
 * 文案里的人名由 `ui/inline-tags.js` 在渲染时扫描匹配，
 * 命中就自动在名字旁边长出那颗人的头像，不需要在这里记「是谁」。
 *
 * @param {string} emoji
 * @param {string} text
 * @param {number} [at] 事件发生时间，补算历史时用
 * @param {string} [by] 邻居的农场 id：邻居对玩家农场的操作才传，玩家自己的操作留空
 */
export function addLog(emoji, text, at = Date.now(), by = '') {
  const log = state.farm.log ?? (state.farm.log = []);
  log.unshift({ at, emoji, text, by: by || '' });
  // 只按 7 天裁剪、不设条数上限：早年两个 tab 共用 60 条，
  // 玩家自己一天的操作就能把「邻居动向」挤光（2026-10-24 反馈）
  trimLog(log);
}

/* ---------- 落盘 ---------- */

/** 写回玩家农场并通知 UI */
export async function flushPlayer() {
  await commit({ farms: [state.farm] });
  emit(EVENTS.PLAYER);
}
