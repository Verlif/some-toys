/**
 * 网格寻路（BFS）与路径跟随。
 *
 * BFS 保证四向最短路；路径跟随带卡住检测：
 * 连续 0.32 秒几乎没位移就丢弃当前路径强制重规划，避免 AI 顶着墙角原地抖。
 */
import { TILE, BASE_SPEED } from '../core/config.js';
import { gstate } from '../core/state.js';
import { tx, ty } from '../core/utils.js';
import { moveEntity } from './collision.js';

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
 * 沿当前路径前进一帧。
 * @returns {boolean} 路径是否仍然有效（false 表示已失效/被卡住）
 */
export function followPath(e, dt, mul = 1) {
  if (!e.path || e.pathIdx >= e.path.length) return false;

  const node = e.path[e.pathIdx];
  const gx = node.x * TILE + TILE / 2;
  const gy = node.y * TILE + TILE / 2;
  const dx = gx - e.x, dy = gy - e.y;
  const d = Math.hypot(dx, dy);
  if (d < 5) {
    e.pathIdx++;
    e.stuckTimer = 0;
    e.lastPathX = e.x;
    e.lastPathY = e.y;
    return true;
  }

  const sp = BASE_SPEED * mul;
  const px = e.x, py = e.y;
  moveEntity(e, dx / d * sp * dt, dy / d * sp * dt);

  const moved = Math.hypot(e.x - px, e.y - py);
  if (moved < 0.25) {
    e.stuckTimer = (e.stuckTimer || 0) + dt;
    // 不跳过被墙挡住的节点：保留路径，短暂观察后强制重规划。
    if (e.stuckTimer >= 0.32) {
      e.path = null;
      e.pathIdx = 0;
      e.repathTimer = 0;
      e.stuckTimer = 0;
      return false;
    }
  } else {
    e.stuckTimer = 0;
    e.lastPathX = e.x;
    e.lastPathY = e.y;
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
