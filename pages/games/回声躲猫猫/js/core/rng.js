/**
 * 可播种随机数（mulberry32）。
 *
 * 为什么不用 Math.random()：
 *   · 地图生成、AI 采样、道具刷新都必须由**种子**决定，否则同一局在两端跑不出同样的结果；
 *   · 联机（房主权威 / 锁定步进）与回放复现都需要「给出种子 → 得到同一场对局」；
 *   · 出问题时可以记录种子，之后 100% 复现。
 *
 * 全局只有一个随机流：调用 setSeed() 后，所有取随机数的地方都按调用顺序拿到确定值。
 * 需要独立流时用 createRng(seed) 自己拿一个实例。
 */

/** mulberry32：小、快、分布够好，适合游戏逻辑（不是密码学随机） */
export function createRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let stream = createRng(0x9e3779b9);

/** 设定本局种子（开始对局前调用一次） */
export function setSeed(seed) {
  stream = createRng(seed);
  return seed;
}

/** 生成一个新种子（只有这里允许用 Math.random，因为它是"进入世界"的入口） */
export function randomSeed() {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
}

/** 取一个 [0,1) 随机数 */
export function rng() {
  return stream();
}

/** [a,b) 之间的浮点数 */
export function randRange(a, b) {
  return a + stream() * (b - a);
}

/** 数组里随机取一个 */
export function pickOne(list) {
  return list[(stream() * list.length) | 0];
}

/** Fisher–Yates 洗牌（原地） */
export function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = (stream() * (i + 1)) | 0;
    const t = list[i]; list[i] = list[j]; list[j] = t;
  }
  return list;
}
