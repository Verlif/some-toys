/**
 * 扫描与排雷：队伍认知（known 位图）的唯一写入口。
 *
 * 扫描：以自身为圆心、scanRadius 为半径，把圈内格子标记为已知安全 / 已知有雷。
 * 排雷：在扫描范围内挑最近的一颗「已知雷」，耗时 DEFUSE_DURATION；
 *      成功后该雷从场上移除，且所有队伍的认知同步刷新为安全。
 */
import { TILE, SCAN_DURATION, DEFUSE_DURATION, TEAM_COLORS } from '../core/config.js';
import { idx, inBounds, tileOf } from '../core/utils.js';
import { game } from '../core/state.js';

/** 清除队伍迷雾（常驻视野 + 扫描时的大范围） */
export function clearFogCircle(team, cx, cy, radius) {
  const r2 = radius * radius + 0.5;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = cx + dx, y = cy + dy;
      if (!inBounds(x, y)) continue;
      team.fog[idx(x, y)] = 0;
    }
  }
}

/** 开始扫描，并压入一圈涟漪特效 */
export function startScan(e) {
  if (e.scanTimer > 0 || e.scanCooldown > 0 || e.downed || e.arrived) return;
  e.scanTimer = SCAN_DURATION;
  e.scanMax = SCAN_DURATION;
  e.stats.scans++;
  game.ripples.push({
    x: e.x, y: e.y, t: 0, dur: SCAN_DURATION,
    maxR: e.scanRadius * TILE,
    color: TEAM_COLORS[e.teamId]
  });
}

/** 扫描完成：写入队伍认知 */
export function revealScan(e) {
  const team = game.teams[e.teamId];
  const cx = tileOf(e.x), cy = tileOf(e.y);
  const r = e.scanRadius;

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + 0.9) continue;
      const x = cx + dx, y = cy + dy;
      if (!inBounds(x, y)) continue;
      const i = idx(x, y);
      if (game.walls[i]) continue;

      if (game.mines[i] > 0) {
        if (team.known[i] !== 2) { team.known[i] = 2; team.minesFound++; }
      } else if (team.known[i] !== 2) {
        team.known[i] = 1;
      }
    }
  }
}

/** 排雷范围 = 扫描范围：锁定范围内最近的一颗已知雷 */
export function startDefuse(e) {
  if (e.defuseTimer > 0 || e.defuseCooldown > 0 || e.downed || e.arrived) return;
  if (e.scanTimer > 0) return;

  const team = game.teams[e.teamId];
  const cx = tileOf(e.x), cy = tileOf(e.y);
  const r = e.scanRadius;
  const r2 = r * r + 0.9;

  let best = null, bestD = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = cx + dx, y = cy + dy;
      if (!inBounds(x, y)) continue;
      const i = idx(x, y);
      if (team.known[i] !== 2 || game.mines[i] <= 0) continue;
      const d = Math.hypot(x * TILE + TILE / 2 - e.x, y * TILE + TILE / 2 - e.y);
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
  }

  if (best) {
    e.defuseTimer = DEFUSE_DURATION;
    e.defuseMax = DEFUSE_DURATION;
    e.defuseTarget = best;
  }
}

/** 排雷成功：地雷移除，所有队伍的认知同步为安全 */
export function completeDefuse(e) {
  e.defuseTimer = 0;
  e.defuseCooldown = 0.6;
  const target = e.defuseTarget;
  e.defuseTarget = null;
  if (!target) return;

  const i = idx(target.x, target.y);
  if (game.mines[i] > 0) {
    game.mines[i] = 0;
    e.stats.minesDefused++;
    for (const t of game.teams) t.known[i] = 1;
  }
}

/** 松开按键 / 被打断时取消排雷 */
export function cancelDefuse(e) {
  e.defuseTimer = 0;
  e.defuseTarget = null;
}
