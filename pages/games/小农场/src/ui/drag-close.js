/**
 * 下拉关闭手势。
 *
 * 手机上「点遮罩关闭」既慢又容易误触，从顶部往下拉是更符合直觉的操作。
 * 这个组件挂在一个面板上：
 *   - 只有**向下**拖动且超过阈值时接管手势，向上推还给内部滚动；
 *   - 内部内容已经滚动时不接管，避免和原生滚动打架；
 *   - 松手时按位移决定是回弹还是关闭。
 *
 * 为什么用 Touch 事件而不是 Pointer 事件：
 * 面板是纵向可滚动的容器，CSS 里必须写 `touch-action: pan-y`，
 * 而这会让浏览器接管纵向手势、直接忽略 touchmove 上的 preventDefault，
 * Pointer 方案会因此收到 pointercancel 而中断。
 * Touch 事件里主动 preventDefault 才能真正把这次手势抢回来。
 *
 * 面板的「隐藏态 / 展开态」都交给 CSS 表达，这里只在拖动过程中写内联
 * transform，松手后清空内联样式，动画自动交还给 CSS。
 */
import { clamp } from '../core/utils.js';

const START_THRESHOLD = 8;
const CLOSE_THRESHOLD = 72;
const MAX_SHIFT = 420;

/**
 * @param {HTMLElement} panel 承载面板（其 CSS 负责定义收起/展开的 transform）
 * @param {{onClose: () => void, scrollArea?: HTMLElement | (() => HTMLElement|null)}} options
 *   scrollArea 可以是元素，也可以是取值函数 —— 弹窗内容每次打开都会重建，
 *   滚动容器是新建的，传函数才能总是拿到当前那个
 * @returns {() => void} 解绑函数
 */
export function dragToClose(panel, { onClose, scrollArea = null }) {
  let startY = 0;
  let shift = 0;
  let engaged = false;
  let ignored = false;
  /** 是否已经按下过。没按下过时，move 事件必须忽略。 */
  let tracking = false;

  function release() {
    panel.style.transition = '';
    panel.style.transform = '';
    engaged = false;
    ignored = false;
    tracking = false;
    shift = 0;
  }

  /** 是否可以从当前位置开始接管手势 */
  function canStart() {
    // 内部已滚动说明用户想看内容而不是关掉它
    const scroller = typeof scrollArea === 'function' ? scrollArea() : scrollArea;
    return !(scroller && scroller.scrollTop > 0);
  }

  function begin(clientY) {
    ignored = !canStart();
    if (ignored) return;
    startY = clientY;
    shift = 0;
    engaged = false;
    tracking = true;
  }

  function move(clientY, event) {
    // 关键：没有按下过就不算拖动。
    // 否则窗口上的一次普通 mousemove 会被当成「从 0 拖到 clientY」，
    // 直接把面板甩出去。
    if (!tracking || ignored) return;
    const dy = clientY - startY;

    if (!engaged) {
      if (dy < -START_THRESHOLD) { ignored = true; return; }
      if (dy < START_THRESHOLD) return;
      engaged = true;
      panel.style.transition = 'none';
    }

    shift = clamp(dy, 0, MAX_SHIFT);
    panel.style.transform = `translateY(${shift}px)`;
    // 抢下这次手势，浏览器就不会同时滚动页面
    if (event.cancelable) event.preventDefault();
  }

  function end() {
    if (!tracking) return;
    const shouldClose = engaged && shift > CLOSE_THRESHOLD;
    release();
    if (shouldClose) onClose();
  }

  /* ---------- 触摸 ---------- */
  const onTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    begin(e.touches[0].clientY);
  };
  const onTouchMove = (e) => {
    if (e.touches.length !== 1) return;
    move(e.touches[0].clientY, e);
  };
  const onTouchEnd = () => end();

  /* ---------- 鼠标（桌面端）---------- */
  // move / up 只在按下期间才监听，松开立刻摘掉，
  // 免得页面上的普通移动误触发拖动
  const onMouseMove = (e) => move(e.clientY, e);
  const onMouseUp = () => {
    end();
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    begin(e.clientY);
    if (!tracking) return;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  panel.addEventListener('touchstart', onTouchStart, { passive: true });
  panel.addEventListener('touchmove', onTouchMove, { passive: false });
  panel.addEventListener('touchend', onTouchEnd);
  panel.addEventListener('touchcancel', onTouchEnd);
  panel.addEventListener('mousedown', onMouseDown);

  return () => {
    panel.removeEventListener('touchstart', onTouchStart);
    panel.removeEventListener('touchmove', onTouchMove);
    panel.removeEventListener('touchend', onTouchEnd);
    panel.removeEventListener('touchcancel', onTouchEnd);
    panel.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };
}
