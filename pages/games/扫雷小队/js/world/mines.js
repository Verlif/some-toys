/**
 * 地雷布置：在迷宫内部可通行格中随机撒雷，
 * 排除出发区与出口周边 3 格（保证开局与终点绝对安全）。
 * 80% 触发即炸，20% 为 1 秒延迟雷。
 */
import { W, H, OUTSIDE_COLS, MINE_INSTANT, MINE_DELAYED } from '../core/config.js';
import { idx, shuffle } from '../core/utils.js';
import { settings, game } from '../core/state.js';

export function placeMines() {
  const mines = new Uint8Array(W * H);
  const walkable = [];

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      if (game.walls[i]) continue;
      if (x < OUTSIDE_COLS + 1) continue;
      const dE = Math.abs(x - game.exitX) + Math.abs(y - game.exitY);
      if (dE < 3) continue;
      walkable.push(i);
    }
  }

  shuffle(walkable);
  const n = Math.min(settings.mineCount, walkable.length);

  for (let k = 0; k < n; k++) {
    mines[walkable[k]] = Math.random() < 0.8 ? MINE_INSTANT : MINE_DELAYED;
  }
  return mines;
}
