/**
 * 碰撞与移动：以圆形半径 + 八向采样判定墙体，
 * 允许贴墙「转角滑动」——卡在拐角时只锁死被挡的那个轴，不会被完全卡住。
 */
import { TILE } from '../core/config.js';
import { idx, inBounds, tileOf } from '../core/utils.js';
import { game } from '../core/state.js';

const SLIDE_OFFSETS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707]
];

export function collidesAt(px, py, r) {
  const cx = tileOf(px), cy = tileOf(py);
  if (!inBounds(cx, cy)) return true;
  if (game.walls[idx(cx, cy)]) return true;

  let wallCount = 0;
  for (const [ox, oy] of SLIDE_OFFSETS) {
    const x = tileOf(px + ox * r);
    const y = tileOf(py + oy * r);
    if (!inBounds(x, y) || game.walls[idx(x, y)]) wallCount++;
  }
  return wallCount > 4;
}

/** 分轴推进，任一轴被挡不影响另一轴 */
export function moveEntity(e, dx, dy) {
  if (!collidesAt(e.x + dx, e.y, e.radius)) e.x += dx;
  if (!collidesAt(e.x, e.y + dy, e.radius)) e.y += dy;
}

/** 朝目标点直线推进（用于 AI 救援 / 接近雷点，无寻路） */
export function moveToward(e, tx, ty, dt) {
  const dx = tx - e.x, dy = ty - e.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const nx = dx / len, ny = dy / len;
  e.faceX = nx; e.faceY = ny;
  moveEntity(e, nx * e.speed * dt, ny * e.speed * dt);
}
