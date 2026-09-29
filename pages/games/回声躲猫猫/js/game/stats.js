/**
 * 结算统计。
 *
 * 单文件版本里统计字段散落在各处的 stats.xxx++，
 * 这里统一成 bumpStat()，避免任何一个模块因为拿不到 stats 引用而漏统计。
 */
import { gstate } from '../core/state.js';

/** 新开一局时初始化统计 */
export function resetStats(role, { hiderCount, seekerCount, gameTime }) {
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
    playerRole: role
  };
  return gstate.stats;
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
