/**
 * 芯片条重绘后接力横向滚动位置。
 *
 * 排序 / 筛选 / tab 芯片条都是 `overflow-x: auto` 的横滚条，整块重绘后
 * 新元素的 scrollLeft 归零 —— 手机上点了右边那颗「好感」，标签条会自己
 * 滚回最前面。所以重绘前后手动接力一次横向位置，同步赋值、不会闪一下。
 *
 * `display: none` 的条（商店在非种子 tab 下收起的筛选条）scrollLeft 恒为 0，
 * 读不到真实位置 —— 这时拿上一次记下的值兜底，切回该 tab 时芯片条还在原位。
 *
 * @param {Element|null} root 含芯片条的根节点
 * @param {string} selector 芯片条选择器（同一 root 内唯一）
 * @param {() => void} render 重绘动作
 */
const memo = new WeakMap();

export function keepBarScroll(root, selector, render) {
  const bar = root?.querySelector(selector);
  const keep = bar?.clientWidth ? bar.scrollLeft : (memo.get(root)?.get(selector) || 0);

  render();

  const next = root?.querySelector(selector);
  if (!next?.clientWidth) return;
  if (keep) next.scrollLeft = keep;
  // 记下这次的位置：下次重绘时若条是收起的，就靠它兜底
  const bySel = memo.get(root) || new Map();
  bySel.set(selector, next.scrollLeft);
  memo.set(root, bySel);
}
