/**
 * 每帧推进：倒计时 → 迷雾恢复 → 实体行为 → 踩雷 → 延迟雷 → 复活 → 到达判定 → 特效。
 *
 * stepMatch 只负责「对局进行中」的一步推进，被正式对局与菜单演示局共用；
 * update() 额外处理开局倒计时，并返回 true 表示本局结束，由 main.js 转交 ui/flow 做结算，
 * 这样模拟层完全不依赖界面层。
 */
import { W, H, TILE, FOG_REGEN, FOG_VISION_R, END_COUNTDOWN, TEAM_COLORS } from '../core/config.js';
import { idx, inBounds, tileOf } from '../core/utils.js';
import { game } from '../core/state.js';
import { updatePlayer } from './player.js';
import { updateAI } from './ai.js';
import { checkMineHit, triggerExplosion, updateRespawn, inExitZone } from './hazard.js';
import { clearFogCircle, cancelDefuse } from './scan.js';
import { updateEffects } from './effects.js';

/** 夺旗：踩到旗格即归该队所有，全队每人最终 -FLAG_BONUS 秒 */
function updateFlags() {
  for (const f of game.flags) {
    if (f.takenBy >= 0) continue;

    for (const e of game.entities) {
      if (e.downed || e.arrived) continue;
      if (tileOf(e.x) !== f.x || tileOf(e.y) !== f.y) continue;

      f.takenBy = e.teamId;
      f.takenAt = game.elapsed;
      f.claim = null;
      game.teams[e.teamId].flags++;
      e.stats.flags++;

      const px = f.x * TILE + TILE / 2, py = f.y * TILE + TILE / 2;
      game.ripples.push({ x: px, y: py, t: 0, dur: 0.7, maxR: TILE * 3, color: TEAM_COLORS[e.teamId] });
      for (let k = 0; k < 14; k++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 30 + Math.random() * 70;
        game.particles.push({
          x: px, y: py,
          vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
          life: 0.5 + Math.random() * 0.5, maxLife: 1.0,
          size: 1.5 + Math.random() * 2, hue: 45 + Math.random() * 15
        });
      }
      break;
    }
  }
}

/** 对局进行中的一步推进；返回 true 表示本局应当结束 */
export function stepMatch(dt) {
  game.elapsed += dt;

  /* 迷雾恢复 */
  for (const team of game.teams) {
    const fog = team.fog;
    for (let i = 0; i < W * H; i++) {
      if (fog[i] < 1) fog[i] = Math.min(1, fog[i] + FOG_REGEN * dt);
    }
  }

  /* 实体更新 */
  for (const e of game.entities) {
    if (e.scanCooldown > 0) e.scanCooldown -= dt;
    if (e.defuseCooldown > 0) e.defuseCooldown -= dt;
    if (e.invuln > 0) e.invuln -= dt;
    e.bob += dt * 6;

    const cx0 = tileOf(e.x), cy0 = tileOf(e.y);
    clearFogCircle(game.teams[e.teamId], cx0, cy0, FOG_VISION_R);

    // 路径：按队伍记录，写入后永不消失
    if (inBounds(cx0, cy0)) {
      const i = idx(cx0, cy0);
      game.teamTrails[e.teamId][i] = 1;
      if (!game.walls[i] && game.mines[i] === 0 && game.teams[e.teamId].known[i] === 0) {
        game.teams[e.teamId].known[i] = 1;
      }
    }

    if (e.downed || e.arrived) continue;

    const px0 = e.x, py0 = e.y;
    if (e.isPlayer) updatePlayer(e, dt);
    else updateAI(e, dt);
    e.stats.distance += Math.hypot(e.x - px0, e.y - py0);

    if (e.scanTimer > 0) {
      clearFogCircle(game.teams[e.teamId], cx0, cy0, e.scanRadius);
    }
  }

  /* 踩雷检测 */
  for (const e of game.entities) {
    if (e.downed || e.arrived || e.invuln > 0) continue;
    checkMineHit(e);
  }

  /* 延迟雷倒计时 */
  for (const e of game.entities) {
    if (!e.pendingExplosions.length) continue;
    for (let i = e.pendingExplosions.length - 1; i >= 0; i--) {
      const pe = e.pendingExplosions[i];
      pe.timer -= dt;
      if (pe.timer <= 0) {
        triggerExplosion(pe.x, pe.y);
        e.pendingExplosions.splice(i, 1);
      }
    }
  }

  updateRespawn(dt);
  updateFlags();

  /* 到达检测 */
  for (const e of game.entities) {
    if (e.arrived) continue;
    if (inExitZone(e)) {
      e.arrived = true;
      e.arrivedAt = game.elapsed;
      game.exitFlash = 0.6;
      cancelDefuse(e);
    }
  }

  /* 首个到达后进入 60 秒结算倒计时；全员到达立即结束 */
  const anyArrived = game.entities.some(e => e.arrived);
  if (anyArrived && game.endCountdown === null) {
    game.endCountdown = END_COUNTDOWN;
  }
  if (game.endCountdown !== null) {
    game.endCountdown -= dt;
    if (game.endCountdown <= 0) return true;
  }
  if (game.entities.every(e => e.arrived)) return true;

  updateEffects(dt);
  return false;
}

export function update(dt) {
  if (game.state === 'countdown') {
    game.countdown -= dt;
    if (game.countdown <= 0) {
      game.state = 'playing';
      game.elapsed = 0;
    }
    return false;
  }

  if (game.state !== 'playing') return false;
  return stepMatch(dt);
}
