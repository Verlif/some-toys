/**
 * 纯函数工具：网格索引换算、边界判断、数组洗牌。
 * 不持有任何状态，可在任何层安全引用。
 */
import { W, H, TILE } from './config.js';

/** 二维格坐标 → 一维数组下标 */
export const idx = (x, y) => y * W + x;

/** 是否在网格范围内 */
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

/** 像素坐标 → 格坐标 */
export const tileOf = v => Math.floor(v / TILE);

/** 原地洗牌（Fisher–Yates） */
export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** '#rrggbb' → [r, g, b]，用于把队伍色转成半透明填充 */
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
