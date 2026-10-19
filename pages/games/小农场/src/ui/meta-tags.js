/**
 * 种子信息的配色分档。
 *
 * 茬数与产量是最容易「一眼扫过去」却没被读到的两个数字，
 * 所以给它们各配一套按数量递增的颜色：数字越大，颜色越靠后
 * （灰 → 青 → 绿 → 蓝 → 紫；产量另用 灰 → 绿 → 橙 → 金）。
 * 商店列表与播种弹窗共用这里的分档，避免两处各写一套。
 */

/**
 * 茬数的配色档位
 * @param {number} n 收获次数
 * @returns {string} meta-tag 的修饰类
 */
export function stackClass(n) {
  if (n >= 5) return 'h5';
  return `h${Math.max(1, Math.min(4, n))}`;
}

/**
 * 单次产量的配色档位
 * @param {number} max 产量区间上限
 * @returns {string} meta-tag 的修饰类
 */
export function yieldClass(max) {
  if (max > 28) return 'y4';
  if (max > 20) return 'y3';
  if (max > 14) return 'y2';
  return 'y1';
}
