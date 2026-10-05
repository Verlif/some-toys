/**
 * A* 寻路：8 向，对角需两侧都通行。
 * 代价按队伍的认知分档——已知安全最便宜，未知较贵，已知有雷默认不可走，
 * 于是「绕路」与「排雷」的取舍自然体现在路径长度上。
 *
 * known 位图是队伍级的：谁扫出来的雷全队都知道，所以队友不会往已知雷上撞。
 * softMines=true 时把已知雷当作「极贵但可通行」的一步，用于雷把路彻底封死
 * 时的兜底（走到跟前再触发排雷决策，而不是站着不动）。
 */
import { W, H, DIRS8, OUTSIDE_COLS } from '../core/config.js';
import { idx, inBounds } from '../core/utils.js';
import { game } from '../core/state.js';

const SOFT_MINE_COST = 40;   // 兜底路径里「已知雷」的代价：贵到尽量绕，但不封死

/**
 * 返回 -1 表示不可通行。
 * @param {boolean} [noStaging] 禁止踏进左侧出发区。人已经在迷宫里时绕回那片空地
 *   毫无意义（出口在右边），只会让 AI 进进出出、在空地上反复决策。
 */
export function tileCost(i, team, noStaging) {
  if (game.walls[i]) return -1;
  if (noStaging && (i % W) < OUTSIDE_COLS) return -1;
  const k = team.known[i];
  // 已知有雷：雷还在才算不可走。延迟雷被踩掉 / 被别人拆掉之后 known 可能仍是 2，
  // 那时格子其实是安全的，别把队友绕到天边去
  if (k === 2) return game.mines[i] > 0 ? -1 : 1;
  if (k === 1) return 1;    // 已知安全
  return 5;                 // 未知：谨慎
}

/**
 * @param {object} [opts] allowMineGoal=true 允许把「已知有雷」的格子作为终点
 *   （排雷手需要走到雷旁边）；softMines=true 把已知雷降级为高代价而不是不可走；
 *   noStaging=true 禁止路径踏进左侧出发区（人已在迷宫里时用）。
 */
export function findPath(sx, sy, gx, gy, team, opts = null) {
  const allowMineGoal = !!(opts && opts.allowMineGoal);
  const softMines = !!(opts && opts.softMines);
  const noStaging = !!(opts && opts.noStaging);
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
      let cost = tileCost(ni, team, noStaging);
      // 终点本身是已知雷：只看作普通一步（排雷手要走到雷跟前）
      if (cost < 0 && allowMineGoal && ni === goal && !game.walls[ni]) cost = 1;
      if (cost < 0 && softMines && team.known[ni] === 2 && !game.walls[ni]) cost = SOFT_MINE_COST;
      if (cost < 0) continue;

      const isGoal = (i) => allowMineGoal && i === goal;
      if (d % 2 === 1) {              // 对角：不允许穿墙角
        const i1 = idx(nx, cy), i2 = idx(cx, ny);
        let c1 = tileCost(i1, team, noStaging);
        let c2 = tileCost(i2, team, noStaging);
        if (c1 < 0 && isGoal(i1)) c1 = 1;
        if (c2 < 0 && isGoal(i2)) c2 = 1;
        if (c1 < 0 && softMines && team.known[i1] === 2 && !game.walls[i1]) c1 = SOFT_MINE_COST;
        if (c2 < 0 && softMines && team.known[i2] === 2 && !game.walls[i2]) c2 = SOFT_MINE_COST;
        if (c1 < 0 || c2 < 0) continue;
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
