/**
 * 按住不放连续触发 —— 数量加减钮通用。
 *
 * 送 99 份的东西如果只能一次点一下，玩家得按 98 次。这里在按住 380ms 后
 * 进入连发（每 70ms 一次），松手即停。
 *
 * 两个坑：
 *   ① **松手会再补一次 click**：浏览器在 pointerup 之后仍会派发 click，
 *      如果不吞掉，按住「减」到 1 会多减一次。所以在捕获阶段拦下这一下。
 *   ② **不能绑在按钮上**：弹窗与子页面每次重绘都会换掉整块 innerHTML，
 *      挨个绑的监听跟着元素一起消失。所以只绑在**容器**上一次，
 *      靠事件委托在按下时才去找 `.qty-btn`。
 *
 * 用 pointer 事件而不是 touch：桌面端鼠标也能按，且不用自己处理
 * touch/mouse 两套路径。`touch-action: manipulation` 由 `.qty-btn` 的 CSS 负责，
 * 否则移动端长按会先弹系统的选择菜单。
 */

/** 按住多久才进入连发（ms）。太短会让「点一下」变成「按两下」 */
const HOLD_DELAY = 380;

/** 连发的间隔（ms）。70ms 大约每秒 14 个，从 1 按到 99 约 7 秒 */
const REPEAT_GAP = 70;

/**
 * 在某些容器上统一接管「数量加减钮的长按」。
 *
 * 为什么做成一层的委托，而不是让每处自己挂监听：
 * 加减钮在 13 个地方出现（种子 / 送礼 / 交易 / 联机送礼 / 卖货 / 订单 / 分解包装…），
 * 每一处都记着去挂一次绑定，早晚会漏。而它们**都带 `.qty-btn` 类、
 * 都通过 `data-action` 走动作分派**，所以只要在分派层拦截一次就够了：
 * 按住不放时，用同一套动作回调反复触发，业务代码一行都不用改。
 *
 * @param {Element} root 事件委托的根（`#modal` 或 `#subpage`）
 * @param {(el: Element) => void} fire 触发一次该按钮的动作
 * @returns {() => void} 解绑函数
 */
export function mountHoldRepeat(root, fire) {
  if (!root) return () => {};

  /** 一颗按钮的连发状态 */
  const timers = new WeakMap();

  const stop = (el) => {
    const t = timers.get(el);
    if (!t) return;
    clearTimeout(t.delay);
    clearInterval(t.repeat);
    timers.delete(el);
  };

  const onDown = (event) => {
    const el = event.target instanceof Element ? event.target.closest('.qty-btn') : null;
    if (!el || !root.contains(el) || el.disabled) return;
    // 已经在这颗按钮上连发着就别再来一个定时器（双指同时按下的情况）
    if (timers.has(el)) stop(el);

    const timer = { delay: 0, repeat: 0 };
    timers.set(el, timer);
    timer.delay = setTimeout(() => {
      // 打上标记：连发结束后浏览器补发的那次 click 要吞掉
      el.dataset.holdFiring = '1';
      // 先立刻走一格：否则按住之后还要空等一个间隔才有反应
      fire(el);
      timer.repeat = setInterval(() => {
        // 触到上下限会被业务侧禁用，这时自己停下，别继续空转
        if (el.disabled) { stop(el); return; }
        el.dataset.holdFiring = '1';
        fire(el);
      }, REPEAT_GAP);
    }, HOLD_DELAY);
  };

  const onUp = (event) => {
    const el = event.target instanceof Element ? event.target.closest('.qty-btn') : null;
    if (el) stop(el);
  };

  // 连发结束之后浏览器还会补一次 click，会把正要停的那个数多改一格。
  // 在捕获阶段吞掉：只有「刚才真的在连发」的按钮才拦
  const onClickCapture = (event) => {
    const el = event.target instanceof Element ? event.target.closest('.qty-btn') : null;
    if (!el || !el.dataset.holdFiring) return;
    delete el.dataset.holdFiring;
    event.stopPropagation();
    event.preventDefault();
  };

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('pointerleave', onUp, true);
  root.addEventListener('click', onClickCapture, true);

  return () => {
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onUp);
    root.removeEventListener('pointerleave', onUp, true);
    root.removeEventListener('click', onClickCapture, true);
  };
}