/**
 * 全局配置：逻辑画布尺寸、角色尺寸、规则常量、模式表。
 *
 * 这里是唯一放「可调数值」的地方——改这里就能调整手感，
 * 模拟 / 渲染 / UI 三层都从这里取值，不得在别处硬编码。
 */

/* ================================================================
   常量
================================================================ */
export const VW = 1440, VH = 560;
export const GROUND_Y = 470;

export const BOARD = { x: 50,  y: 100, w: 380, h: 340 };
export const INNER = { x: 62,  y: 112, w: 356, h: 316 };

export const CHAR_SIZE = 256;
export const CHAR_X = INNER.x + (INNER.w - CHAR_SIZE) / 2;
export const CHAR_Y = INNER.y + (INNER.h - CHAR_SIZE) / 2;

export const WRITER_X      = 460;
export const WOLF_SPEED    = 165;
export const AI_WOLF_SPEED = 105;
export const STROKE_TIME   = 2;    // 每画耗时（加快）
export const TOTAL_STROKES = 5;
export const LOOK_GRACE    = 0.30;
export const AI_REACT_MIN  = 0.12;
export const AI_REACT_MAX  = 0.46;
export const CATCH_DIST    = 62;
export const MIN_DIST      = 58;

export const WRITER_MAX_TIME = 50;
export const LOOK_PENALTY    = 3;
export const COUNTDOWN_TIME  = 3.0;
export const START_FLASH_DUR = 0.7;

/* 木头人主动制造声响：惊动写字人回头，逼他再吃一次 -3 秒 */
export const NOISE_COOLDOWN  = 6;    // 冷却（秒）
export const NOISE_ALERT     = 1.6;  // 惊扰后写字人的「警觉」时长（秒）
export const NOISE_LOOK_RATE = 7.5;  // 警觉期间每秒额外回头率
export const NOISE_FLASH     = 0.55; // 声波特效时长（秒）

/* 所有木头人的同一起点 */
export const WOLF_START_X = 1380;
export const WOLF_SPACING = 14;

/* 「田」字五画（归一化坐标） */
export const STROKES = [
  [[0.14, 0.10], [0.14, 0.90]],
  [[0.14, 0.10], [0.86, 0.10], [0.86, 0.90]],
  [[0.14, 0.50], [0.86, 0.50]],
  [[0.50, 0.10], [0.50, 0.90]],
  [[0.14, 0.90], [0.86, 0.90]]
];

export const MODE = {
  SOLO_WOLF   : 'solo_wolf',
  SOLO_WRITER : 'solo_writer',
  P1W         : 'p1w',
  P2W         : 'p2w',
  TWOW        : 'twow'
};

export const HUMAN_WOLF_COUNT = {
  [MODE.SOLO_WOLF]   : 1,
  [MODE.SOLO_WRITER] : 0,
  [MODE.P1W]         : 1,
  [MODE.P2W]         : 1,
  [MODE.TWOW]        : 2
};

export const WOLF_COUNT_OPTIONS = [1, 2, 4, 8];
