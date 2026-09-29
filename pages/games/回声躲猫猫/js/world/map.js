/**
 * 地图生成：随机矩形障碍物 + 连通性检测，保证不存在闭合区域。
 */
import { COLS, ROWS, WALL_COUNT } from '../core/config.js';
import { gstate } from '../core/state.js';

/** 随机撒一批矩形障碍物，四周留出边界墙 */
function buildRandomMap() {
  const g = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  for (let x = 0; x < COLS; x++) { g[0][x] = 1; g[ROWS - 1][x] = 1; }
  for (let y = 0; y < ROWS; y++) { g[y][0] = 1; g[y][COLS - 1] = 1; }

  for (let i = 0; i < WALL_COUNT; i++) {
    let w, h;
    const r = Math.random();
    if (r < 0.22)      { w = 4 + ((Math.random() * 3) | 0); h = 1; }
    else if (r < 0.44) { w = 1; h = 4 + ((Math.random() * 3) | 0); }
    else               { w = 1 + ((Math.random() * 3) | 0); h = 1 + ((Math.random() * 3) | 0); }

    const x = 1 + ((Math.random() * (COLS - 2 - w)) | 0);
    const y = 1 + ((Math.random() * (ROWS - 2 - h)) | 0);
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) g[yy][xx] = 1;
  }
  return g;
}

/** 洪水填充给空地打连通分量，返回最大分量的编号与大小 */
function labelComponents(g) {
  const comp = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  let id = 0, bestId = 0, bestSize = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (g[y][x] !== 0 || comp[y][x] !== 0) continue;
      id++;
      let size = 0;
      const stack = [[x, y]];
      comp[y][x] = id;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        size++;
        const nb = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
        for (let k = 0; k < 4; k++) {
          const nx = nb[k][0], ny = nb[k][1];
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          if (g[ny][nx] !== 0 || comp[ny][nx] !== 0) continue;
          comp[ny][nx] = id;
          stack.push([nx, ny]);
        }
      }
      if (size > bestSize) { bestSize = size; bestId = id; }
    }
  }
  return { comp, bestId, bestSize };
}

/**
 * 生成地图。
 * 最多尝试 40 次，直到最大连通区域占比 ≥ 40%；
 * 仍不达标时退回“尝试过的最好结果”，最后兜底一个空房间。
 */
export function generateMap() {
  let fallback = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const g = buildRandomMap();
    const { comp, bestId, bestSize } = labelComponents(g);
    // 把所有非最大连通区域的空地填成墙 —— 保证地图没有闭合小房间
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (g[y][x] === 0 && comp[y][x] !== bestId) g[y][x] = 1;
    if (bestSize >= COLS * ROWS * 0.40) return g;
    if (!fallback || bestSize > fallback.size) fallback = { g, size: bestSize };
  }
  const g = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  for (let x = 0; x < COLS; x++) { g[0][x] = 1; g[ROWS - 1][x] = 1; }
  for (let y = 0; y < ROWS; y++) { g[y][0] = 1; g[y][COLS - 1] = 1; }
  return g;
}

/** 格子是否为墙（越界按墙处理） */
export function isWall(gx, gy) {
  const g = gstate.grid;
  if (!g || gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) return true;
  return g[gy][gx] === 1;
}

/** 缓存全部空地格子 */
export function getOpenCells() {
  if (!gstate.openCells) {
    const list = [];
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (gstate.grid[y][x] === 0) list.push({ x, y });
    gstate.openCells = list;
  }
  return gstate.openCells;
}

export function randomOpenCell() {
  const list = getOpenCells();
  return list[(Math.random() * list.length) | 0];
}

/** 丢弃空地缓存（重开一局时必须调用） */
export function forgetOpenCells() {
  gstate.openCells = null;
}

export function openCellCount() {
  return getOpenCells().length;
}
