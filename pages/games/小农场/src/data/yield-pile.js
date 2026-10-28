/**
 * 可收获产出图的堆叠布局（纯计算，不碰 DOM）。
 *
 * 玩家的诉求很直白：**「看着就像产出很多」**。一大张 47px 的图标只能说明
 * 「这里有个东西熟了」，说明不了「熟了一堆」。所以成熟地块上的主图换成
 * 一摞同一张图 —— 每 2 个产出画一张，最多 10 张。
 *
 * 布局为什么不用网格：
 *   网格排出来是「货架」，一眼就看出是按行按列摆的，不像地里长出来的一堆。
 * 为什么不用纯随机：
 *   纯随机会聚成几团、中间留空洞，看着像撒出来的，也不像一堆。
 *
 * 用的是**黄金角螺旋**（2.39996 弧度）：任意个数的点按这个角度步进，
 * 都会均匀铺开而不重叠成一坨。再在每点上层叠一层随机抖动（角度、半径、
 * 额外的 x/y 位移），行列感就彻底没有了 —— 既散落，密度又均匀。
 *
 * 两条硬约束：
 *   ① **位置必须稳定**：地块每 500ms 心跳重绘一次，如果每次重算随机数，
 *      图会疯狂乱跳。所以种子从地块 id 派生，同一块地永远是同一堆。
 *   ② **数量变了要看得见**：被偷 2 个就少一张，玩家能直观看到「少了」。
 */

/**
 * 每几个产出画一张图。
 * @param {number} n
 */
const PER_IMAGE = 2;

/** 一张地图上最多摆几张。再多就只是糊成一团，反而看不出「多」 */
export const PILE_MAX = 10;

/**
 * 这个产量该画几张图。
 *
 * 为什么是 `floor(n/2) + 1` 而不是看起来更直觉的 `ceil(n/2)`：
 * 堆叠除了「表示有多少」，还承担一件事 —— **被偷走一个要看得出来**。
 * 两种取整在这一点上正好互补，而游戏里的产量绝大多数是偶数：
 *
 * | 产量 | `ceil(n/2)` | 偷 1 个后 | `floor(n/2)+1` | 偷 1 个后 |
 * | --- | --- | --- | --- | --- |
 * | 6 | 3 | 3（看不出） | 4 | 3（少一张） |
 * | 5 | 3 | 2（少一张） | 3 | 3（看不出） |
 * | 10 | 5 | 5（看不出） | 6 | 5（少一张） |
 *
 * 偶数产量占绝大多数，所以选后者：偷 1 个必然少一张，玩家不用去读
 * 「已被顺走 N 个」那行小字。代价是产量 2 会摞 2 张（略多于「每 2 个一张」），
 * 但那看起来也更像「有东西」而不是「孤零零一颗」。
 *
 * ⚠️ 产量 ≥ 19 时会顶到 PILE_MAX，这时偷 1 个看不出变化，
 * 由地块上的文字提示接手 —— 图能表达的上限就在这里。
 *
 * @param {number} yieldNow 当前剩余产量（已扣掉被偷走的）
 * @returns {number} 1 ~ PILE_MAX（产量 ≤ 0 时返回 0）
 */
export function pileCount(yieldNow) {
  const n = Math.floor(Number(yieldNow) || 0);
  if (n <= 0) return 0;
  return Math.min(PILE_MAX, Math.floor(n / PER_IMAGE) + 1);
}

/** 黄金角：360° × (1 − 1/φ) ≈ 137.508°。螺旋分布的经典常数 */
const GOLDEN_ANGLE = 2.39996323;

/**
 * 散落的横向 / 纵向半径，单位是**基准字号**的倍数（不是 px）。
 *
 * 横向给得比纵向大不少：地块是横的，横着摊才像「收了一把撒在地上」；
 * 纵向一拉高，几张图就会顶到上面的名字行。
 * 1.62 / 0.66 是「10 张图摆开仍看得出层次、又不至于散成孤立几点」的取值 ——
 * 再小会挤成一坨分不清张数，再大就超出地块、被卡片边缘切掉。
 *
 * ⚠️ 这个上界是**实测**出来的：横排取消右侧操作列、地块宽度还给作物图之后，
 * 图标外缘到格边只剩十几个像素；RADIUS_X 再往上加（约 1.7 以上），
 * 最外侧那张图会被卡片裁掉一角。改完这个值请在地块上量一遍。
 */
const RADIUS_X = 1.62;
const RADIUS_Y = 0.66;

/**
 * 单张图的最大随机旋转（度，正负各一半）。
 *
 * 全是正着的图摆在一起像贴纸；给一点角度（±24°）之后，
 * 一眼就能看出「这是一把随手堆起来的」，而不是排版排出来的。
 */
const MAX_ROT = 24;

/**
 * 一个 32 位的确定性伪随机数生成器（LCG）。
 *
 * 不用 Math.random：位置必须跨刷新稳定，而 LCG 只要种子一样，
 * 吐出来的序列就完全一样。
 * @param {number} seed
 * @returns {() => number} 每次调用返回 [0, 1)
 */
function seededRandom(seed) {
  let s = (Math.floor(seed) >>> 0) || 1;
  return () => {
    // 数值取自 Numerical Recipes，乘数与被加数都是 32 位内常见的取值
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 把任意字符串折成一个 32 位整数种子。
 * 地块 id 是 `p1` / `p2` 这种短串，用 djb2 就够了。
 * @param {string} text
 */
function seedOf(text) {
  let h = 5381;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i += 1) {
    h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * 算出一摞产出图的摆放坐标。
 *
 * 返回的每一项都是**基准字号的倍数**，视图层再乘上字号转成 em ——
 * 这样紧凑模式只改 CSS 的字号，整摞图就等比缩下去。
 * `z` 决定谁压着谁：越靠中心越高（后画的盖住前面的），堆叠才显得厚。
 *
 * @param {number} yieldNow 当前剩余产量
 * @param {string} key 稳定的种子来源（地块 id）
 * @returns {Array<{x: number, y: number, rot: number, scale: number, z: number}>}
 */
export function pileLayout(yieldNow, key = '') {
  const count = pileCount(yieldNow);
  if (!count) return [];
  // 只有一张时摆在正中间：一张图还要抖一下反而像没对齐
  if (count === 1) return [{ x: 0, y: 0, rot: 0, scale: 1, z: 1 }];

  const rand = seededRandom(seedOf(key));
  const out = [];

  for (let i = 0; i < count; i += 1) {
    // 半径随序号开方增长：开方之后点的**面积密度**才均匀，
    // 直接用序号会让中心挤成一团、外圈稀疏
    const t = (i + 0.6) / count;
    const base = 0.5 + 0.5 * Math.sqrt(t);
    // 角度按黄金角步进，再加一点抖动打散螺旋的规律
    const angle = i * GOLDEN_ANGLE + (rand() - 0.5) * 0.9;
    // 半径也抖一下，否则同一圈上的点会落在同一个椭圆轨迹上
    const radius = base * (0.72 + rand() * 0.56);

    out.push({
      x: Math.cos(angle) * radius * RADIUS_X + (rand() - 0.5) * 0.34,
      y: Math.sin(angle) * radius * RADIUS_Y + (rand() - 0.5) * 0.24,
      rot: (rand() - 0.5) * MAX_ROT * 2,
      scale: 0.82 + rand() * 0.34,
      // 越靠近中心 z 越高：中心附近约 35，最外圈约 10
      z: Math.round(60 - radius * 42),
    });
  }
  return out;
}

/**
 * 直接产出堆叠区的 HTML。
 *
 * 放这里而不是各自的视图里：自家农场与邻居地块用的是同一套 —— 两边看起来
 * 必须是同一堆东西，否则玩家会以为是两种机制。
 *
 * 坐标输出成 **em** 而不是 px：紧凑模式（手机竖屏）下地块只有 90 多像素宽，
 * 用 px 写死的半径会溢出格子、跟右侧按钮打架。用 em 之后 CSS 只要换一个
 * 字号档位，整摞图就等比缩下去，半径与旋转都不用另算。
 *
 * @param {string} emoji 作物的图标
 * @param {number} yieldNow 当前剩余产量
 * @param {string} key 稳定的种子来源（地块 id，邻居家要带上邻居 id 才不撞）
 * @returns {string}
 */
export function pileHTML(emoji, yieldNow, key = '') {
  const items = pileLayout(yieldNow, key);
  if (!items.length) return '';
  const pieces = items.map((it) => (
    `<i style="transform:translate(-50%,-50%) translate(${it.x.toFixed(2)}em,${it.y.toFixed(2)}em)`
    + ` rotate(${it.rot.toFixed(1)}deg) scale(${it.scale.toFixed(2)});z-index:${it.z}">${emoji}</i>`
  )).join('');
  return `<div class="yield-pile" aria-hidden="true">${pieces}</div>`;
}