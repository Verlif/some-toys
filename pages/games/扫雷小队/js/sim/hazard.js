/**
 * 危险与伤害：踩雷判定、十字形爆炸、倒地与复活、出口区域判定。
 * 爆炸会连带清除波及格上的地雷，并同步所有队伍的认知——
 * 「用一条命换取一片已知安全区」是这局游戏的隐性策略。
 */
import { TILE, RESPAWN_TIME, MINE_INSTANT, MINE_DELAYED } from '../core/config.js';
import { idx, inBounds, tileOf } from '../core/utils.js';
import { game } from '../core/state.js';
import { cancelDefuse } from './scan.js';

/** 爆炸：中心 + 上下左右四格 */
export function triggerExplosion(cx, cy) {
  const cells = [[cx, cy], [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
  const valid = [];

  for (const [x, y] of cells) {
    if (!inBounds(x, y)) continue;
    if (game.walls[idx(x, y)]) continue;
    valid.push([x, y]);
    const i = idx(x, y);
    if (game.mines[i] > 0) game.mines[i] = 0;
    for (const t of game.teams) t.known[i] = 1;
  }

  game.explosions.push({
    x: cx * TILE + TILE / 2,
    y: cy * TILE + TILE / 2,
    t: 0, dur: 0.85,
    cells: valid
  });

  // 粒子效果
  const px0 = cx * TILE + TILE / 2;
  const py0 = cy * TILE + TILE / 2;
  for (let i = 0; i < 26; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 25 + Math.random() * 100;
    game.particles.push({
      x: px0, y: py0,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      life: 0.55 + Math.random() * 0.6,
      maxLife: 1.15,
      size: 1.5 + Math.random() * 2.8,
      hue: 20 + Math.random() * 30
    });
  }

  // 屏幕震动
  game.screenShake = 0.35;

  // 伤害
  for (const e of game.entities) {
    if (e.downed || e.arrived || e.invuln > 0) continue;
    const ex = tileOf(e.x), ey = tileOf(e.y);
    for (const [x, y] of valid) {
      if (ex === x && ey === y) { downEntity(e); break; }
    }
  }
}

/** 踩雷：即炸型当场引爆，延迟型挂 1 秒倒计时 */
export function checkMineHit(e) {
  if (e.downed || e.arrived || e.invuln > 0) return;
  const cx = tileOf(e.x), cy = tileOf(e.y);
  if (!inBounds(cx, cy)) return;
  const i = idx(cx, cy);
  const mine = game.mines[i];

  if (mine === MINE_INSTANT) {
    game.mines[i] = 0;
    triggerExplosion(cx, cy);
  } else if (mine === MINE_DELAYED) {
    game.mines[i] = 0;
    e.pendingExplosions.push({ x: cx, y: cy, timer: 1.0 });
  }
}

/** 倒地：清空一切进行中的动作，并把脚下标记为已知安全 */
export function downEntity(e) {
  e.downed = true;
  e.respawnTimer = RESPAWN_TIME;
  e.stats.downs++;
  e.scanTimer = 0;
  e.actionKeyHeld = false;
  e.actionKeyHoldTime = 0;
  e.actionKeyTriggered = false;
  e.thinkTimer = 0;
  e.wantToDefuse = null;
  e.mineDecisionLock = false;
  e.mineLockKey = null;
  e.stuckCounter = 0;
  e.rushMode = false;      // 倒地后重新评估是否直冲
  e.rushRetry = 0;
  e.corridor = false;      // 已经进过场了，复活后直接走正常 AI
  e.corridorTimer = 0;
  cancelDefuse(e);
  e.path = null;
  e.goal = null;
  e.goalTimer = 0;

  // 倒地就放弃夺旗目标，让队友能接手；也不再占用 / 等待救援名额
  if (e.flagTarget && e.flagTarget.claim === e) e.flagTarget.claim = null;
  e.flagTarget = null;
  if (e.rescueTarget && e.rescueTarget.rescuer === e) e.rescueTarget.rescuer = null;
  e.rescueTarget = null;
  e.rescueTimer = 0;

  const gx = tileOf(e.x), gy = tileOf(e.y);
  if (inBounds(gx, gy)) {
    const i = idx(gx, gy);
    if (!game.walls[i] && game.mines[i] === 0) game.teams[e.teamId].known[i] = 1;
  }
}

/** 复活：原地起身，2.5 秒无敌，路线重新规划 */
export function updateRespawn(dt) {
  for (const e of game.entities) {
    if (!e.downed) continue;
    e.respawnTimer -= dt;
    if (e.respawnTimer <= 0) {
      e.downed = false;
      e.respawnTimer = 0;
      e.invuln = 2.5;
      e.initialRouteChosen = false;
      e.routeRepickCount = 0;
      e.rushMode = false;
      e.rushRetry = 0;
      e.goal = null;
      e.goalTimer = 0;

      // 起身：把救援者放开，别让他继续守着空气
      if (e.rescuer) {
        if (e.rescuer.rescueTarget === e) { e.rescuer.rescueTarget = null; e.rescuer.rescueTimer = 0; }
        e.rescuer = null;
      }
    }
  }
}

/** 出口是 3×3 区域，踩到边缘就算到达 */
export function inExitZone(e) {
  const gx = tileOf(e.x), gy = tileOf(e.y);
  return Math.abs(gx - game.exitX) <= 1 && Math.abs(gy - game.exitY) <= 1;
}
