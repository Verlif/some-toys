/**
 * 玩家档案领域：等级 / 经验 / 金币。
 *
 * 分成两类函数：
 * - 无后缀的 mutator：只改内存，不落盘，便于与其它改动合并成一次事务；
 * - flushPlayer()：把当前档案写盘并广播变更。
 *
 * 签到已独立到 store/signin.js，统计与引导在 store/codex.js。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';
import { expForLevel, MAX_LEVEL, titleOf, unlockedPlotCount } from '../data/progression.js';
import { notify } from './notify.js';

/** 没加到经验时的返回值（等级保持不变） */
function noGain() {
  return {
    levelBefore: state.player.level,
    levelAfter: state.player.level,
    leveledUp: false,
    unlockedPlots: 0,
  };
}

/* ---------- 内存 mutator（不落盘） ---------- */

/** 加金币，下限 0 */
export function addCoins(amount) {
  state.player.coins = Math.max(0, state.player.coins + amount);
}

/** 扣金币；余额不足返回 false 且不改动 */
export function spendCoins(amount) {
  if (state.player.coins < amount) return false;
  state.player.coins -= amount;
  return true;
}

/**
 * 加经验并处理连续升级。
 * @param {number} amount
 * @returns {{levelBefore: number, levelAfter: number, leveledUp: boolean, unlockedPlots: number}}
 */
export function addExpRaw(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return noGain();

  const player = state.player;
  const levelBefore = player.level;
  const plotsBefore = unlockedPlotCount(levelBefore);

  player.exp += amount;
  while (player.level < MAX_LEVEL && player.exp >= expForLevel(player.level)) {
    player.exp -= expForLevel(player.level);
    player.level += 1;
  }
  // 满级后经验不再累积，避免溢出成一个天文数字
  if (player.level >= MAX_LEVEL) player.exp = 0;

  const result = {
    levelBefore,
    levelAfter: player.level,
    leveledUp: player.level > levelBefore,
    unlockedPlots: unlockedPlotCount(player.level) - plotsBefore,
  };

  if (result.leveledUp) {
    notify(`🎉 升级！现在是 Lv.${player.level} · ${titleOf(player.level)}`, 'gold');
    if (result.unlockedPlots > 0) {
      setTimeout(() => notify('🔓 新地块已解锁！'), 700);
    }
  }
  return result;
}

/* ---------- 落盘 ---------- */

/** 写回玩家档案并通知 UI */
export async function flushPlayer() {
  await commit({ player: state.player });
  emit(EVENTS.PLAYER);
}