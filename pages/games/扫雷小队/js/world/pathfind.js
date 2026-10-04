/**
 * A* 寻路：8 向，对角需两侧都通行。
 * 代价按队伍的认知分档——已知安全最便宜，未知最贵，已知有雷直接不可走，
 * 于是「绕路」与「排雷」的取舍自然体现在路径长度上。
 */
import { W, H, DIRS8 } from '../core/config.js';
import { idx, inBounds } from '../core/utils.js';
import { game } from '../core/state.js';

/** 返回 -1 表示不可通行 */
export function tileCost(i, team) {
  if (game.walls[i]) return -1;
  const k = team.known[i];
  if (k === 2) return -1;   // 已知有雷
  if (k === 1) return 1;    // 已知安全
  return 5;                 // 未知：谨慎
}

export function findPath(sx, sy, gx, gy, team) {
  const N = W * H;
  const g = new Float32Array(N).fill(Infinity);
  const f = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const start = idx(sx, sy), goal = idx(gx, gy);

  if (start === goal) return [];
  if (!inBounds(sx, sy) || !inBounds(gx, gy)) return null;
  if (game.walls[start] || game.walls[goal]) return null;

  g[start] = 0;
  f[start] = Math.abs(sx - gx) + Math.abs(sy - gy);
  const open = [start];

  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
    const cur = open.splice(bi, 1)[0];

    if (cur === goal) {
      const path = [];
      let c = cur;
      while (c !== -1 && c !== start) {
        const x = c % W;
        path.push({ x, y: (c - x) / W });
        c = came[c];
      }
      return path.reverse();
    }

    if (closed[cur]) continue;
    closed[cur] = 1;

    const cx = cur % W, cy = (cur - cx) / W;

    for (let d = 0; d < 8; d++) {
      const nx = cx + DIRS8[d][0], ny = cy + DIRS8[d][1];
      if (!inBounds(nx, ny)) continue;
      const ni = idx(nx, ny);
      const cost = tileCost(ni, team);
      if (cost < 0) continue;

      if (d % 2 === 1) {              // 对角：不允许穿墙角
        if (tileCost(idx(nx, cy), team) < 0) continue;
        if (tileCost(idx(cx, ny), team) < 0) continue;
      }

      const step = (d % 2 === 1) ? 1.414 : 1;
      const ng = g[cur] + cost * step;

      if (ng < g[ni]) {
        g[ni] = ng;
        f[ni] = ng + Math.abs(nx - gx) + Math.abs(ny - gy);
        came[ni] = cur;
        if (!closed[ni]) open.push(ni);
      }
    }
  }
  return null;
}
