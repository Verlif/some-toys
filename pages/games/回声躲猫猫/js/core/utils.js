/**
 * 基础工具函数：钳制、格子坐标、插值、时间格式化。
 *
 * 全部依赖 config 中的实时绑定 TILE / COLS / ROWS，切地图后自动生效。
 * 随机数不在这里 —— 见 core/rng.js（可播种，联机/回放要复现）。
 */
import { TILE, COLS, ROWS } from './config.js';

export const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

/** 世界坐标 → 格子 X（越界自动钳制） */
export const tx = v => clamp(Math.floor(v / TILE), 0, COLS - 1);

/** 世界坐标 → 格子 Y（越界自动钳制） */
export const ty = v => clamp(Math.floor(v / TILE), 0, ROWS - 1);

export const lerp = (a, b, t) => a + (b - a) * t;

/** 两点距离 */
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

/** 秒 → m:ss */
export const fmtTime = (sec) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/** 格子中心的世界坐标 */
export const cellCenterX = gx => gx * TILE + TILE / 2;
export const cellCenterY = gy => gy * TILE + TILE / 2;
