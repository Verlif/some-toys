/**
 * AI 决策：三层优先级 —— 生存（救援）→ 路线（绕路 vs 排雷）→ 探索（扫描）。
 *
 * 关键设计是「排雷 vs 绕路」的量化比较：
 * 把排雷耗时换算成等效格数（DEFUSE_DURATION × speed ÷ TILE），
 * 再和绕路的额外格数比较，谁便宜走谁。
 */
import { DIRS8, OUTSIDE_COLS, TILE, DEFUSE_DURATION } from '../core/config.js';
import { idx, inBounds, tileOf } from '../core/utils.js';
import { game } from '../core/state.js';
import { moveEntity, moveToward } from '../world/collision.js';
import { findPath } from '../world/pathfind.js';
import { startScan, revealScan, startDefuse, completeDefuse } from './scan.js';

/** 让 AI 停顿一小会儿，制造「思考」的节奏感 */
function triggerThink(e, fixed) {
  e.thinkTimer = fixed !== undefined ? fixed : (0.5 + Math.random() * 1.5);
}

/** 沿路径推进；连续两帧几乎没动就判定卡住，清空路径重新决策 */
function moveAlongPath(e, dt) {
  if (!e.path || e.path.length === 0) return false;
  const n = e.path[0];
  const tx = n.x * TILE + TILE / 2;
  const ty = n.y * TILE + TILE / 2;

  const d = Math.hypot(tx - e.x, ty - e.y);
  if (d < 4) { e.path.shift(); e.stuckCounter = 0; return true; }

  const oldX = e.x, oldY = e.y;
  moveToward(e, tx, ty, dt);

  const moved = Math.hypot(e.x - oldX, e.y - oldY);
  if (moved < dt * e.speed * 0.15) {
    e.stuckCounter++;
    // 先尝试侧滑（沿垂直方向）
    const perpX = -(ty - e.y);
    const perpY = (tx - e.x);
    const pl = Math.hypot(perpX, perpY);
    if (pl > 0.1) {
      moveEntity(e, (perpX / pl) * e.speed * dt * 0.85, (perpY / pl) * e.speed * dt * 0.85);
    }
    if (e.stuckCounter >= 2) {
      e.path = null;
      e.pathTimer = 0;
      e.stuckCounter = 0;
      e.routeRepickCount++;
      triggerThink(e, 0.4 + Math.random() * 0.6);
      return false;
    }
  } else {
    e.stuckCounter = 0;
  }
  return true;
}

/** 统计半径内未知格占比，用来判断「这里值不值得扫」 */
function localUnknownRatio(cx, cy, team, r) {
  let unknown = 0, total = 0;
  const r2 = r * r + 0.5;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = cx + dx, y = cy + dy;
      if (!inBounds(x, y)) continue;
      const i = idx(x, y);
      if (game.walls[i]) continue;
      total++;
      if (team.known[i] === 0) unknown++;
    }
  }
  return total === 0 ? 0 : unknown / total;
}

/** 绕路方案：与 findPath 同源，靠 known 位图天然避开已知雷 */
function findSafePath(cx, cy, gx, gy, team) {
  return findPath(cx, cy, gx, gy, team);
}

export function updateAI(e, dt) {
  if (e.downed || e.arrived) return;

  // 排雷中（AI 自动完成，不需要按住）
  if (e.defuseTimer > 0) {
    e.defuseTimer -= dt;
    if (e.defuseTimer <= 0) completeDefuse(e);
    return;
  }

  // 扫描中
  if (e.scanTimer > 0) {
    e.scanTimer -= dt;
    if (e.scanTimer <= 0) {
      e.scanTimer = 0;
      revealScan(e);
      e.scanCooldown = 0.2;
    }
    return;
  }

  const team = game.teams[e.teamId];
  const cx = tileOf(e.x), cy = tileOf(e.y);
  if (!e.enteredMaze && cx >= OUTSIDE_COLS + 1) e.enteredMaze = true;

  // 思考等待
  if (e.thinkTimer > 0) { e.thinkTimer -= dt; return; }

  // 未进入迷宫：先走到自己的入口
  if (!e.enteredMaze) {
    const entY = game.entranceYs[e.entranceId % game.entranceYs.length];
    const targetY = entY * TILE + TILE / 2;
    if (Math.abs(e.y - targetY) > 3) {
      const dy = Math.sign(targetY - e.y);
      moveEntity(e, 0, dy * e.speed * dt);
    } else {
      e.y = targetY;
      e.faceX = 1; e.faceY = 0;
      moveEntity(e, e.speed * dt, 0);
    }
    return;
  }

  // 救援：优先救队友，其次才是别人（约 320px 的「嫌弃距离」）
  let rescueTarget = null, rescueScore = Infinity;
  for (const o of game.entities) {
    if (o === e || !o.downed) continue;
    const d = Math.hypot(o.x - e.x, o.y - e.y);
    const score = o.teamId === e.teamId ? d : d + 320;
    if (score < rescueScore) { rescueScore = score; rescueTarget = o; }
  }
  if (rescueTarget && rescueScore < 180) {
    moveToward(e, rescueTarget.x, rescueTarget.y, dt);
    return;
  }

  /* ========== 重大决策 1：首次路线选择 ========== */
  if (!e.initialRouteChosen) {
    e.initialRouteChosen = true;
    e.path = findPath(cx, cy, game.exitX, game.exitY, team) || [];
    e.pathTimer = 3.0;
    triggerThink(e, 1.0 + Math.random() * 1.0);
    return;
  }

  /* ========== 重大决策 2：前方有已知雷 → 排雷 vs 绕路 ========== */
  if (e.path && e.path.length > 0) {
    const next = e.path[0];
    const ni = idx(next.x, next.y);
    const isMineAhead = team.known[ni] === 2 && game.mines[ni] > 0;

    if (isMineAhead && !e.mineDecisionLock) {
      e.mineDecisionLock = true;

      // 计算绕路方案（避开已知雷）
      const altPath = findSafePath(cx, cy, game.exitX, game.exitY, team);

      // 排雷耗时折算为格数（2 秒 × 速度 ÷ 格子像素）
      const defuseCost = DEFUSE_DURATION * e.speed / TILE;

      if (!altPath || altPath.length === 0) {
        // 无替代路径 → 必须排雷
        e.wantToDefuse = { x: next.x, y: next.y };
        e.defuseApproachTimer = 0;
      } else {
        const detourExtra = altPath.length - e.path.length;
        // 若绕路额外代价明显小于排雷 → 绕路
        if (detourExtra >= 0 && detourExtra < defuseCost * 0.9) {
          e.path = altPath;
          e.pathTimer = 2.0;
          e.wantToDefuse = null;
        } else {
          // 排雷更划算
          e.wantToDefuse = { x: next.x, y: next.y };
          e.defuseApproachTimer = 0;
        }
      }
      triggerThink(e);
      return;
    } else if (!isMineAhead) {
      e.mineDecisionLock = false;
    }
  }

  /* ========== 处理排雷意图 ========== */
  if (e.wantToDefuse && e.defuseCooldown <= 0 && e.defuseTimer <= 0) {
    const tgt = e.wantToDefuse;
    const tx = tgt.x * TILE + TILE / 2;
    const ty = tgt.y * TILE + TILE / 2;
    const d = Math.hypot(tx - e.x, ty - e.y);
    const reachDist = TILE * e.scanRadius * 0.85;

    if (d < reachDist) {
      e.wantToDefuse = null;
      e.defuseApproachTimer = 0;
      startDefuse(e);
      return;
    }

    e.defuseApproachTimer += dt;
    if (e.defuseApproachTimer > 4.0) {
      // 无法接近 → 放弃，重新决策
      e.wantToDefuse = null;
      e.defuseApproachTimer = 0;
      e.mineDecisionLock = false;
      e.path = null;
      triggerThink(e, 0.6);
      return;
    }

    moveToward(e, tx, ty, dt);
    return;
  }

  /* ========== 重大决策 3：复杂岔路口 → 重新评估路径 ========== */
  const cellKey = cx + ',' + cy;
  if (e.path && e.path.length > 0 && e.lastJunctionCell !== cellKey) {
    let openDirs = 0, unknownDirs = 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DIRS8[d][0], ny = cy + DIRS8[d][1];
      if (!inBounds(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (game.walls[ni]) continue;
      if (team.known[ni] === 2) continue;
      openDirs++;
      if (team.known[ni] === 0) unknownDirs++;
    }
    if (openDirs >= 4 && unknownDirs >= 2) {
      e.lastJunctionCell = cellKey;
      const newPath = findPath(cx, cy, game.exitX, game.exitY, team);
      if (newPath && newPath.length > 0) {
        e.path = newPath;
        e.pathTimer = 2.5;
      }
      triggerThink(e);
      return;
    }
  }

  /* ========== 常规：智能扫描 ========== */
  e.aiScanTimer -= dt;
  if (e.aiScanTimer <= 0 && e.scanCooldown <= 0) {
    const ratio = localUnknownRatio(cx, cy, team, 2);
    const sameCell = e.lastScanCell === cellKey;
    const recent = (game.elapsed - e.lastScanTime) < 4.0;

    if (ratio > 0.4 && !(sameCell && recent)) {
      startScan(e);
      e.lastScanCell = cellKey;
      e.lastScanTime = game.elapsed;
      e.aiScanTimer = 2.5 + Math.random() * 2.5;
      return;
    }
    e.aiScanTimer = 1;
  }

  /* ========== 常规：寻路 ========== */
  e.pathTimer -= dt;
  if (!e.path || e.pathTimer <= 0 || e.path.length === 0) {
    e.path = findPath(cx, cy, game.exitX, game.exitY, team) || [];
    e.pathTimer = 0.8 + Math.random() * 0.4;
  }

  moveAlongPath(e, dt);
}
