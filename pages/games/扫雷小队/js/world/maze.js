/**
 * 迷宫生成：递归回溯打底 → 随机打通环路 → 挖出左侧出发区、出口与若干入口。
 * 出口固定在右侧中部，入口按队伍数 +2 均匀分布在左边界。
 */
import { W, H, OUTSIDE_COLS } from '../core/config.js';
import { idx } from '../core/utils.js';
import { settings } from '../core/state.js';

export function generateMaze() {
  const walls = new Uint8Array(W * H).fill(1);
  const rX = (W - 1) >> 1;
  const rY = (H - 1) >> 1;
  const visited = new Uint8Array(rX * rY);
  const stack = [];

  const srx = 0, sry = rY >> 1;
  visited[sry * rX + srx] = 1;
  walls[idx(2 * srx + 1, 2 * sry + 1)] = 0;
  stack.push([srx, sry]);

  while (stack.length) {
    const [rx, ry] = stack[stack.length - 1];
    const n = [];
    if (rx > 0      && !visited[ry * rX + rx - 1]) n.push([rx - 1, ry, -1, 0]);
    if (rx < rX - 1 && !visited[ry * rX + rx + 1]) n.push([rx + 1, ry,  1, 0]);
    if (ry > 0      && !visited[(ry - 1) * rX + rx]) n.push([rx, ry - 1, 0, -1]);
    if (ry < rY - 1 && !visited[(ry + 1) * rX + rx]) n.push([rx, ry + 1, 0,  1]);
    if (!n.length) { stack.pop(); continue; }

    const [nx, ny, dx, dy] = n[(Math.random() * n.length) | 0];
    visited[ny * rX + nx] = 1;
    walls[idx(2 * rx + 1 + dx, 2 * ry + 1 + dy)] = 0;
    walls[idx(2 * nx + 1, 2 * ny + 1)] = 0;
    stack.push([nx, ny]);
  }

  // 打通环路：让迷宫不再是唯一解，给「绕路 vs 排雷」留出选择空间
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!walls[idx(x, y)]) continue;
      const isH = (x % 2 === 0 && y % 2 === 1);
      const isV = (x % 2 === 1 && y % 2 === 0);
      if ((isH || isV) && Math.random() < 0.30) walls[idx(x, y)] = 0;
    }
  }

  // 左侧外部区域：出发集合地，全部可通行
  for (let x = 0; x < OUTSIDE_COLS; x++)
    for (let y = 0; y < H; y++) walls[idx(x, y)] = 0;

  // 出口：3×3 空腔 + 右侧延伸通道
  const exitX = W - 4, exitY = H >> 1;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = exitX + dx, y = exitY + dy;
      if (x > 0 && x < W - 1 && y > 0 && y < H - 1) walls[idx(x, y)] = 0;
    }
  for (let dx = 2; dx <= 3; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      const x = exitX + dx, y = exitY + dy;
      if (x > 0 && x < W - 1 && y > 0 && y < H - 1) walls[idx(x, y)] = 0;
    }

  // 边界墙
  for (let x = 0; x < W; x++) { walls[idx(x, 0)] = 1; walls[idx(x, H - 1)] = 1; }
  for (let y = 0; y < H; y++) walls[idx(W - 1, y)] = 1;

  // 入口：沿左边界均匀取 teamCount + 2 个
  const candidates = [];
  for (let y = 3; y < H - 3; y += 2) candidates.push(y);
  const numEntrances = Math.min(settings.teamCount + 2, candidates.length);
  const entranceYs = [];
  for (let i = 0; i < numEntrances; i++) {
    const pos = Math.floor((i + 0.5) * candidates.length / numEntrances);
    const y = candidates[Math.min(pos, candidates.length - 1)];
    if (!entranceYs.includes(y)) {
      entranceYs.push(y);
      walls[idx(OUTSIDE_COLS, y)] = 0;
      walls[idx(OUTSIDE_COLS - 1, y)] = 0;
    }
  }

  return { walls, entranceYs, exitX, exitY };
}
