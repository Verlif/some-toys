/**
 * 网格寻路（BFS）与路径跟随。
 *
 * ── BFS 四向最短路 + Bresenham 视线平滑
 *    逐格跟随会走成锯齿（对角路程 ≈ 直线的 1.41 倍），所以跟随前先瞄准
 *    「能直线到达、且下一步真的迈得出去」的最远节点。
 *
 * ── 两级防卡死
 *    1. 步伐级：本帧朝目标迈的这一步若撞墙，标记 blocked；连续 0.3 秒走不动就重规划。
 *    2. 进度级：只看位移是不够的 —— 顶着墙角时角色会小幅来回抖，每帧位移都不为零。
 *       所以再盯住「到目标的距离」，连续 PROGRESS_TIMEOUT 秒没有拉近就强制重规划。
 */
import { TILE, BASE_SPEED } from '../core/config.js';
import { gstate } from '../core/state.js';
import { tx, ty } from '../core/utils.js';
import { moveEntity, circleHitsWall } from './collision.js';

/** 进度看门狗判定“有拉近”的阈值（px） */
const PROGRESS_EPS = 6;
/** 进度看门狗的超时时间（秒）：这么久没拉近距离就重规划 */
const PROGRESS_TIMEOUT = 0.6;
/** 距离节点中心多近就算“已到达”（px） */
const NODE_SNAP = 3;
/** 宽路径检查的采样间隔（px） */
const WIDE_STEP = 6;

/**
 * 带半径的直线通路检查：沿 e → to 的连线按固定间隔采样，
 * 每一步都要求「角色中心放在该点不会撞墙」。
 * 比格心 Bresenham 严格，用于判断“能不能直接冲过去”。
 */
function widePathClear(e, to) {
  const dx = to.x - e.x, dy = to.y - e.y;
  const len = Math.hypot(dx, dy);
  if (len < WIDE_STEP) return true;
  const ux = dx / len, uy = dy / len;
  for (let d = WIDE_STEP; d < len; d += WIDE_STEP) {
    if (circleHitsWall(e.x + ux * d, e.y + uy * d, e.r * 0.98)) return false;
  }
  return true;
}

const grid = () => gstate.grid;

/**
 * 返回从 (sx,sy) 到 (gx,gy) 的格子路径（不含起点），不可达返回 null。
 */
export function findPath(sx, sy, gx, gy) {
  const g = grid();
  if (sx === gx && sy === gy) return [];
  if (gx < 0 || gy < 0 || gx >= g[0].length || gy >= g.length) return null;
  if (g[gy][gx] === 1) return null;

  const COLS = g[0].length, ROWS = g.length;
  const total = COLS * ROWS;
  const prev = new Int32Array(total).fill(-1);
  const seen = new Uint8Array(total);
  const start = sy * COLS + sx;
  const goal  = gy * COLS + gx;

  const queue = new Int32Array(total);
  let head = 0, tail = 0;
  queue[tail++] = start;
  seen[start] = 1;
  let found = false;

  while (head < tail) {
    const cur = queue[head++];
    if (cur === goal) { found = true; break; }
    const cx = cur % COLS, cy = (cur / COLS) | 0;
    if (cx + 1 < COLS) { const n = cur + 1;    if (!seen[n] && g[cy][cx + 1] === 0) { seen[n] = 1; prev[n] = cur; queue[tail++] = n; } }
    if (cx - 1 >= 0)   { const n = cur - 1;    if (!seen[n] && g[cy][cx - 1] === 0) { seen[n] = 1; prev[n] = cur; queue[tail++] = n; } }
    if (cy + 1 < ROWS) { const n = cur + COLS; if (!seen[n] && g[cy + 1][cx] === 0) { seen[n] = 1; prev[n] = cur; queue[tail++] = n; } }
    if (cy - 1 >= 0)   { const n = cur - COLS; if (!seen[n] && g[cy - 1][cx] === 0) { seen[n] = 1; prev[n] = cur; queue[tail++] = n; } }
  }

  if (!found) return null;
  const path = [];
  let cur = goal;
  while (cur !== start) {
    path.push({ x: cur % COLS, y: (cur / COLS) | 0 });
    cur = prev[cur];
    if (cur < 0) return null;
  }
  path.reverse();
  return path;
}

/** 为实体计算到世界坐标 (gx,gy) 的路径；失败时 e.path = null */
export function computePathFor(e, gx, gy) {
  const p = findPath(tx(e.x), ty(e.y), tx(gx), ty(gy));
  e.path = p || null;
  e.pathIdx = 0;
  e.stuckCount = 0;
}

/**
 * 格子之间是否看得见（Bresenham 连线，任一格是墙就不通）。
 * 用于路径平滑：能直着走过去的节点就不必先走到中间那个格子。
 */
export function lineOfSightClear(gridMap, x0, y0, x1, y1) {
  const g = gridMap || grid();
  const COLS = g[0].length, ROWS = g.length;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0, y = y0;
  for (let guard = 0; guard < 256; guard++) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return false;
    if (g[y][x] === 1) return false;
    if (x === x1 && y === y1) return true;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return false;
}

/** 两名角色之间是否没有墙壁阻挡（世界坐标） */
export function hasLineOfSight(a, b) {
  return lineOfSightClear(grid(), tx(a.x), ty(a.y), tx(b.x), ty(b.y));
}

/**
 * 路径平滑：在剩余路径里挑一个「连线看得见、而且下一步真的迈得出去」的节点。
 *
 * 为什么不能简单地“取最远可直达节点”：
 *   BFS 的四向路径在绕墙时会先给一个**斜插进墙角**的节点（例如角色在 (11,1)，
 *   墙在 (12,2)，路径第一步却是 (12,1)）。从格子中心看连线是通的，
 *   但角色有半径，朝那个方向迈步会被墙挡住 —— 于是它顶着墙角慢慢蹭，
 *   要一两秒才能滑出去，看起来就是“卡住”。
 *
 * 解决办法：沿路径往后找可用的绕行节点，跳过迈不出去的近端节点。
 *   1. 近端节点（下标 pathIdx）：必须连线可达且迈得出去，否则宁可原地重规划；
 *   2. 更远的节点：只要求连线可达 + 迈得出去，允许跳过中间那些走向死角的点，
 *      而且允许它出现在墙的另一侧（可以贴着墙角绕过去）。
 */
function aimAtVisibleNode(e, reach) {
  const g = grid();
  const cx = tx(e.x), cy = ty(e.y);
  const probe = TILE * 0.6;

  /** 从当前位置朝节点中心迈一小步会不会撞墙 */
  const canStepTo = (node) => {
    const nx = node.x * TILE + TILE / 2;
    const ny = node.y * TILE + TILE / 2;
    const len = Math.hypot(nx - e.x, ny - e.y) || 1;
    return !circleHitsWall(e.x + (nx - e.x) / len * probe, e.y + (ny - e.y) / len * probe, e.r * 0.98);
  };

  // ⓪ 目标本身就能直达时直接瞄目标。
  //    BFS 的四向最短路经常给出一条「先横着走完、再竖着走完」的 L 形路径：
  //    长度确实最短，但节点全在同一条直线上，挑节点怎么挑都会走成直角。
  //    只有直接瞄目标才能走出自然的直线。
  if (e.goal && Math.hypot(e.goal.x - e.x, e.goal.y - e.y) > TILE * 1.5) {
    const gx = tx(e.goal.x), gy = ty(e.goal.y);
    if (lineOfSightClear(g, cx, cy, gx, gy)
      && !circleHitsWall(e.goal.x, e.goal.y, e.r * 0.98)
      && widePathClear(e, e.goal)) {
      return { x: gx, y: gy };
    }
  }

  const startIdx = Math.min(e.pathIdx, e.path.length - 1);
  const limit = Math.min(e.path.length - 1, startIdx + reach);

  // ① 近端节点必须同时满足连线可达与可迈出
  if (startIdx <= limit) {
    const first = e.path[startIdx];
    if (lineOfSightClear(g, cx, cy, first.x, first.y) && canStepTo(first)) {
      e.pathIdx = startIdx;
      return first;
    }
  }

  // ② 近端节点不可用：往后找第一个能绕过去的节点（允许可迈出即可，不要求同格连通）
  for (let i = startIdx + 1; i <= limit; i++) {
    const node = e.path[i];
    if (!lineOfSightClear(g, cx, cy, node.x, node.y)) break;   // 后面都被墙挡住，不再看
    if (!canStepTo(node)) continue;                            // 这个也迈不出去，试下一个
    e.pathIdx = i;
    return node;
  }

  // ③ 都没找到：保持索引，朝它走（下一步会被判 blocked，交给看门狗重规划）
  e.pathIdx = startIdx;
  return e.path[startIdx];
}

/**
 * 进度看门狗：长时间没有靠近目标就强制重规划。
 *
 * 只看「有没有位移」是不够的 —— 被墙角卡住时角色会小幅来回抖，每帧位移都不为零，
 * 旧的卡住检测永远不会触发。这里改为盯住「到目标的距离有没有变小」。
 */
function updateProgressWatchdog(e, dt) {
  const goal = e.goal;
  if (!goal) return;
  const d = Math.hypot(goal.x - e.x, goal.y - e.y);
  if (d < PROGRESS_EPS) { e.progressTimer = 0; e.progressBest = d; return; }
  if (e.progressBest === undefined || e.progressBest === null || d < e.progressBest - PROGRESS_EPS) {
    e.progressBest = d;
    e.progressTimer = 0;
    return;
  }
  e.progressTimer = (e.progressTimer || 0) + dt;
  if (e.progressTimer >= PROGRESS_TIMEOUT) {
    e.progressTimer = 0;
    e.progressBest = d;
    e.path = null;          // 下一帧按当前状态重新规划
    e.pathIdx = 0;
    e.repathTimer = 0;
    e.stuckTimer = 0;
  }
}

/**
 * 沿当前路径前进一帧。
 * @returns {boolean} 路径是否仍然有效（false 表示已失效/被卡住）
 */
export function followPath(e, dt, mul = 1) {
  updateProgressWatchdog(e, dt);
  if (!e.path || e.pathIdx >= e.path.length) return false;

  // 已经站在某个节点的中心附近时把它跳过。
  // 少了这一步，索引会永远停在“脚下那个节点”上，角色原地不动却是“没走完最后 1px”。
  while (e.pathIdx < e.path.length) {
    const n = e.path[e.pathIdx];
    const nx = n.x * TILE + TILE / 2, ny = n.y * TILE + TILE / 2;
    if (Math.hypot(nx - e.x, ny - e.y) > NODE_SNAP) break;
    e.pathIdx++;
  }
  if (e.pathIdx >= e.path.length) return false;

  const sp = BASE_SPEED * mul;
  let budget = sp * dt;
  let moved = 0;
  let blocked = false;
  let visited = 0;

  // 一帧内可能连续走过多个节点（平滑后相邻节点间距往往很小）
  for (let guard = 0; guard < 8 && budget > 0.05; guard++) {
    if (e.pathIdx >= e.path.length) break;
    const node = aimAtVisibleNode(e, 6);
    const gx = node.x * TILE + TILE / 2;
    const gy = node.y * TILE + TILE / 2;
    const dx = gx - e.x, dy = gy - e.y;
    const d = Math.hypot(dx, dy) || 0.0001;

    // 本步的位移：预算足够就直达节点，否则只走完预算
    const reachNode = d <= budget;
    const step = reachNode ? d : budget;
    const nx = dx / d * step;
    const ny = dy / d * step;
    if (circleHitsWall(e.x + nx, e.y + ny, e.r)) { blocked = true; break; }

    e.x += nx; e.y += ny;
    moved += step;
    e.stuckTimer = 0;
    e.lastPathX = e.x;
    e.lastPathY = e.y;

    if (reachNode) {
      // 到点就把坐标吸附到节点中心，避免 1e-13 级的残差让索引推不动
      e.x = gx; e.y = gy;
      budget -= d;
      e.pathIdx++;
      visited++;
      if (visited > 40) { budget = 0; break; }   // 异常路径兜底，下一帧重规划
      continue;
    }
    budget = 0;
  }

  // 走不动或被墙挡住：先贴墙蹭一下，短暂观察后强制重规划
  const expected = sp * dt;
  if (blocked || moved < expected * 0.25) {
    e.stuckTimer = (e.stuckTimer || 0) + dt;
    // 贴着墙角时按轴分离移动只会顶住不动，这里试着沿墙滑一下：
    // 方向取「期望方向旋转 ±90°」，两个方向都试，只接受真的能挪动的那一个。
    // 不能用目标方向算垂直方向 —— 目标可能在很远的另一侧，垂直方向会来回翻转，
    // 结果就是左右抖着不走（这个坑踩过一次）。
    if (e.stuckTimer > 0.12) {
      const node = e.path && e.pathIdx < e.path.length ? e.path[e.pathIdx] : null;
      const aim = node
        ? { x: node.x * TILE + TILE / 2, y: node.y * TILE + TILE / 2 }
        : e.goal;
      if (aim) {
        const ox = aim.x - e.x, oy = aim.y - e.y;
        const len = Math.hypot(ox, oy) || 1;
        const nudge = sp * dt * 0.6;
        const px1 = e.x, py1 = e.y;
        let slid = false;
        for (const sgn of [1, -1]) {
          moveEntity(e, (-oy / len) * nudge * sgn, (ox / len) * nudge * sgn);
          if (Math.hypot(e.x - px1, e.y - py1) > nudge * 0.35) { slid = true; break; }
          e.x = px1; e.y = py1;
        }
        if (!slid) { e.x = px1; e.y = py1; }
      }
    }
    if (e.stuckTimer >= 0.3) {
      e.path = null;
      e.pathIdx = 0;
      e.repathTimer = 0;
      e.stuckTimer = 0;
      e.progressTimer = 0;
      e.progressBest = null;
      return false;
    }
  } else {
    e.stuckTimer = 0;
  }
  return true;
}

/** 四向可通行邻居数量（用于评估路口/死路） */
export function cellQuality(gridMap, gx, gy) {
  const g = gridMap || grid();
  if (gx < 0 || gy < 0 || gx >= g[0].length || gy >= g.length) return 0;
  if (g[gy][gx] === 1) return 0;
  let open = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = gx + dx, ny = gy + dy;
    if (nx < 0 || ny < 0 || nx >= g[0].length || ny >= g.length) continue;
    if (g[ny][nx] === 0) open++;
  }
  return open;
}

/** 以 (cx,cy) 为中心撒 count 个落在空地格上的搜索点 */
export function generateSearchPoints(cx, cy, count) {
  const g = grid();
  const COLS = g[0].length, ROWS = g.length;
  const points = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 50 + Math.random() * 240;
    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;
    const gx = tx(x), gy = ty(y);
    if (gx >= 0 && gy >= 0 && gx < COLS && gy < ROWS && g[gy][gx] === 0) {
      points.push({ x: gx * TILE + TILE / 2, y: gy * TILE + TILE / 2, visited: false });
    }
  }
  return points;
}
