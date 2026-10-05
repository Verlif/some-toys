/**
 * 旗帜布置：迷宫内随机撒「队伍数量」面旗，全图可见（不受迷雾影响）。
 *
 * 拿到旗 → 该队**每个成员**的最终用时 -FLAG_BONUS 秒（在 scoring 里统一折算），
 * 所以夺旗是「全队受益」的目标，值得派专人去跑。
 *
 * 规则：
 *   - 只落在迷宫内部（离出发区与出口都留够距离），避免开局白送；
 *   - 旗与旗之间保持最小间距，散布到地图各处；
 *   - 旗格本身清掉地雷——「看得见的奖励不该是必炸的陷阱」。
 */
import { W, H, OUTSIDE_COLS, FLAG_MIN_GAP, FLAG_EXIT_MARGIN } from '../core/config.js';
import { idx, shuffle } from '../core/utils.js';
import { game } from '../core/state.js';

export function placeFlags(count) {
  const cand = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = OUTSIDE_COLS + 4; x < W - 2; x++) {
      const i = idx(x, y);
      if (game.walls[i]) continue;
      if (Math.abs(x - game.exitX) + Math.abs(y - game.exitY) < FLAG_EXIT_MARGIN) continue;
      cand.push({ x, y });
    }
  }
  shuffle(cand);

  const flags = [];
  for (const c of cand) {
    if (flags.length >= count) break;

    let ok = true;
    for (const f of flags) {
      if (Math.abs(f.x - c.x) + Math.abs(f.y - c.y) < FLAG_MIN_GAP) { ok = false; break; }
    }
    if (!ok) continue;

    game.mines[idx(c.x, c.y)] = 0;
    flags.push({ x: c.x, y: c.y, takenBy: -1, takenAt: 0, claim: null });
  }
  return flags;
}
