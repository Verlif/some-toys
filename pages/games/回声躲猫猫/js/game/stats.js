/**
 * 结算统计。
 *
 * 单文件版本里统计字段散落在各处的 stats.xxx++，
 * 这里统一成 bumpStat()，避免任何一个模块因为拿不到 stats 引用而漏统计。
 */
import { gstate } from '../core/state.js';

/** 新开一局时初始化统计 */
export function resetStats(role, { hiderCount, seekerCount, gameTime, playerCount = 1 }) {
  gstate.stats = {
    playerSoundCount: 0,
    playerNoiseCount: 0,
    playerDetectedEnemy: 0,
    playerDetectedByEnemy: 0,
    hidersCaught: 0,
    hidersAlive: hiderCount,
    totalHiders: hiderCount,
    totalSeekers: seekerCount,
    gameTimeTotal: gameTime,
    playerRole: role,
    // 每位玩家各自抓到的躲藏者数量（下标 = 玩家序号）
    playerCatchCounts: new Array(Math.max(1, Math.min(2, playerCount))).fill(0)
  };
  return gstate.stats;
}

/** 记一次玩家抓捕（玩家是搜捕者时才有意义） */
export function addPlayerCatch(playerIndex) {
  const list = gstate.stats.playerCatchCounts;
  if (!list || playerIndex < 0 || playerIndex >= list.length) return;
  list[playerIndex]++;
}

export function getPlayerCatchCount(playerIndex) {
  const list = gstate.stats.playerCatchCounts;
  if (!list || playerIndex < 0 || playerIndex >= list.length) return 0;
  return list[playerIndex];
}

/** 统计项 +1 */
export function bumpStat(key, delta = 1) {
  if (gstate.stats[key] === undefined) gstate.stats[key] = 0;
  gstate.stats[key] += delta;
}

/** 直接写统计项（例如每帧刷新存活人数） */
export function setStat(key, value) {
  gstate.stats[key] = value;
}
