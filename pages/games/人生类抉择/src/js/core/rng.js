/**
 * 可控随机数
 *
 * 默认使用 Math.random（每局不同，保留随机乐趣）。
 * 调用 setSeed(n) 后切换为 mulberry32 伪随机序列：
 * 相同种子 + 相同操作序列 => 完全相同的结果，便于复现 bug 与写自动化测试。
 */

/** mulberry32：32 位种子伪随机算法，闭包内保存状态 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let generator = Math.random;
let currentSeed = null;

/** 传入数字启用确定性随机；传 null 恢复为原生随机 */
export function setSeed(seed) {
  if (seed === null || seed === undefined) {
    generator = Math.random;
    currentSeed = null;
  } else {
    currentSeed = seed >>> 0;
    generator = mulberry32(currentSeed);
  }
  return currentSeed;
}

export const getSeed = () => currentSeed;

/** [0,1) 随机数 */
export const random = () => generator();

/** 从数组中随机取一个元素 */
export const pick = arr => arr[Math.floor(generator() * arr.length)];

/** 从数组中不重复抽取 n 个元素（n 超过长度时返回全部） */
export function sample(arr, n) {
  const pool = arr.slice();
  const out = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(generator() * pool.length), 1)[0]);
  }
  return out;
}
