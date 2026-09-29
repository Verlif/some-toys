/**
 * 碰撞与移动。
 * 采用圆 vs 格子 AABB 的检测，轴向分离移动（先 X 后 Y），贴墙滑行手感更好。
 */
import { TILE } from '../core/config.js';
import { gstate } from '../core/state.js';
import { tx, ty, clamp } from '../core/utils.js';

/** 圆是否与任意墙格相交 */
export function circleHitsWall(x, y, r) {
  const grid = gstate.grid;
  const minTx = tx(x - r), maxTx = tx(x + r);
  const minTy = ty(y - r), maxTy = ty(y + r);
  for (let cyy = minTy; cyy <= maxTy; cyy++) {
    for (let cxx = minTx; cxx <= maxTx; cxx++) {
      if (grid[cyy][cxx] !== 1) continue;
      const rx = cxx * TILE, ry = cyy * TILE;
      const nx = clamp(x, rx, rx + TILE);
      const ny = clamp(y, ry, ry + TILE);
      const dx = x - nx, dy = y - ny;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

/** 按轴移动实体，撞墙则该轴回退 */
export function moveEntity(e, dx, dy) {
  if (dx) { e.x += dx; if (circleHitsWall(e.x, e.y, e.r)) e.x -= dx; }
  if (dy) { e.y += dy; if (circleHitsWall(e.x, e.y, e.r)) e.y -= dy; }
}
