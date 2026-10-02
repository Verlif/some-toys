/**
 * 网格寻路：BFS 最短路 + 路径平滑（拉直）→ 输出稳定的世界坐标路点。
 *
 * ── 谁负责什么
 *   world/pathfind.js —— 「往哪走」：算路径、把路径拉直成少量路点（waypoints）
 *   sim/navigation.js —— 「怎么走」：沿路点推进、卡住看门狗、重规划
 *
 * ── 为什么是“路点”而不是每帧现挑朝向
 *   早期实现每帧重新挑一次朝向（直接奔目标 / 走下一个节点 二选一），
 *   两者会来回抢占：同一个位置上一帧往右、下一帧往左，
 *   表现出来就是贴着墙左右晃（用户反馈的问题）。
 *   现在把「往哪走」固定在**重规划的那一刻**：BFS 出路径后做一次
 *   string pulling（能直线到达就跳过中间节点），之后角色只认这几个路点，
 *   两次重规划之间方向完全稳定。
 */
import { TILE, WAYPOINT_LOOKAHEAD } from '../core/config.js';
import { gstate } from '../core/state.js';
import { tx, ty } from '../core/utils.js';
import { randRange } from '../core/rng.js';
import { circleHitsWall } from './collision.js';

/** 距离路点多近就算“已到达”（px） */
export const NODE_SNAP = 3;
/** 宽路径检查的采样间隔（px） */
const WIDE_STEP = 6;

const grid = () => gstate.grid;
export const cellCenterX = gx => gx * TILE + TILE / 2;
export const cellCenterY = gy => gy * TILE + TILE / 2;

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

/**
 * 这一段直线能不能走：先看格子连线，再按半径采样。
 * @param {number} fromX 起点（世界坐标，可以是角色当前位置或上一个路点）
 * @param {object} node 目标格子
 * @param {number} r 角色半径
 */
function segmentClear(fromX, fromY, node, r) {
  const g = grid();
  if (!lineOfSightClear(g, tx(fromX), ty(fromY), node.x, node.y)) return false;
  return widePathClear(
    { x: fromX, y: fromY, r },
    { x: cellCenterX(node.x), y: cellCenterY(node.y) }
  );
}

/**
 * 路径拉直：从当前位置出发，尽量往后跳到「能直线走过去」的最远节点，
 * 于是直角拐弯被抹掉，角色走出自然直线，而且路点数量很少（通常 1~3 个）。
 */
function buildWaypoints(e, path) {
  if (!path || !path.length) return [];
  const out = [];
  let anchorX = e.x, anchorY = e.y;
  let i = 0;
  let guard = 0;
  while (i < path.length && guard++ < 512) {
    const limit = Math.min(path.length - 1, i + WAYPOINT_LOOKAHEAD);
    let chosen = i;
    for (let j = limit; j > i; j--) {
      if (segmentClear(anchorX, anchorY, path[j], e.r)) { chosen = j; break; }
    }
    const node = path[chosen];
    const wp = { x: cellCenterX(node.x), y: cellCenterY(node.y), gx: node.x, gy: node.y };
    out.push(wp);
    anchorX = wp.x; anchorY = wp.y;
    i = chosen + 1;
  }
  return out;
}

/** 为实体计算到世界坐标 (gx,gy) 的路径；失败时清空路径 */
export function computePathFor(e, gx, gy) {
  const raw = findPath(tx(e.x), ty(e.y), tx(gx), ty(gy));
  e.path = raw || null;
  e.pathIdx = 0;
  e.waypoints = raw ? buildWaypoints(e, raw) : null;
  e.wpIdx = 0;
  e.stuckCount = 0;
  e.stuckTimer = 0;
  e.progressTimer = 0;
  e.progressBest = null;
}

/** 路径是否还没走完 */
export function hasPath(e) {
  return !!(e.waypoints && e.wpIdx < e.waypoints.length);
}

/**
 * 格子之间是否看得见（Bresenham 连线，任一格是墙就不通）。
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
 * 带半径的直线通路检查：沿 e → to 的连线按固定间隔采样，
 * 每一步都要求「角色中心放在该点不会撞墙」。
 */
export function widePathClear(e, to) {
  const dx = to.x - e.x, dy = to.y - e.y;
  const len = Math.hypot(dx, dy);
  if (len < WIDE_STEP) return true;
  const ux = dx / len, uy = dy / len;
  for (let d = WIDE_STEP; d < len; d += WIDE_STEP) {
    if (circleHitsWall(e.x + ux * d, e.y + uy * d, e.r * 0.98)) return false;
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
    const angle = randRange(0, Math.PI * 2);
    const dist = randRange(50, 290);
    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;
    const gx = tx(x), gy = ty(y);
    if (gx >= 0 && gy >= 0 && gx < COLS && gy < ROWS && g[gy][gx] === 0) {
      points.push({ x: gx * TILE + TILE / 2, y: gy * TILE + TILE / 2, visited: false });
    }
  }
  return points;
}
