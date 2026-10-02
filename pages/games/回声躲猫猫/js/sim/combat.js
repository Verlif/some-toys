/**
 * 抓捕判定（模拟层规则）。
 *
 * 搜捕者碰到躲藏者即淘汰：
 *   · 人类搜捕者抓到人后进入 CATCH_COOLDOWN 硬直（冷却期间不能再抓）；
 *   · **AI 搜捕者没有冷却**（需求：去除 AI 抓捕冷却），可以连续抓捕；
 *   · 被「凝滞之锁」定格的搜捕者不能抓人；
 *   · 出局的躲藏者不再参与判定。
 *
 * 这里只负责“谁抓到了谁”，被抓之后的提示、观战切换、结算延迟由 sim/simulation.js 决定。
 */
import { CATCH_COOLDOWN, CATCH_COOLDOWN_AI } from '../core/config.js';
import { gstate, countAliveHiders } from '../core/state.js';
import { nowSec } from '../core/timer.js';
import { isFrozen } from '../core/status.js';
import { bumpStat, setStat, addPlayerCatch } from './stats.js';

/** 抓取判定的额外宽容（px） */
const CATCH_PAD = 2;

/**
 * 解算本帧的抓捕。
 * @returns {{hider:object, seeker:object}[]} 本帧被抓到的躲藏者
 */
export function resolveCatches() {
  const caught = [];
  const nowT = nowSec();

  for (const h of gstate.hiders) {
    if (!h.alive) continue;
    for (const s of gstate.seekers) {
      // 人类玩家用 CATCH_COOLDOWN；AI 默认 CATCH_COOLDOWN_AI = 0（无冷却）
      const cdTotal = s.isPlayer ? CATCH_COOLDOWN : CATCH_COOLDOWN_AI;
      if (cdTotal > 0 && s.catchCooldownUntil > nowT) continue;
      // 被定格的搜捕者动不了，也抓不了人
      if (isFrozen(s, nowT)) continue;
      if (Math.hypot(s.x - h.x, s.y - h.y) >= s.r + h.r + CATCH_PAD) continue;

      h.alive = false;
      caught.push({ hider: h, seeker: s });

      if (cdTotal > 0) s.catchCooldownUntil = nowT + cdTotal;
      if (s.isPlayer) {
        const catcherIndex = gstate.players.indexOf(s);
        if (catcherIndex >= 0) addPlayerCatch(catcherIndex);
      }
      bumpStat('hidersCaught');
      break;
    }
  }

  // 同一帧内可能有多人被淘汰（多个搜捕者同时得手），人数统计在结算前统一刷新
  if (caught.length > 0) setStat('hidersAlive', countAliveHiders());
  return caught;
}
