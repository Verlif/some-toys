/**
 * 模态弹窗容器。与子页面、底部浮窗统一为「底部上滑 + 下拉关闭」。
 *
 * 用法：openModal(html, actionHandler)
 * html 里带 data-close 的元素点击关闭；带 data-action="xxx" 的元素
 * 会把 action 名与元素一起交给 actionHandler，由调用方决定怎么处理。
 */
import { byId, delegate } from '../core/dom.js';
import { dragToClose } from './drag-close.js';

/** 右上角的关闭按钮：所有弹窗都有，不用各自写 */
const CLOSE_HTML = '<button class="close" data-close aria-label="关闭">✕</button>';

let root = null;
let card = null;
let unbindAction = null;
let actionHandler = null;

/**
 * 打开弹窗
 * @param {string} html 卡片内部 HTML
 * @param {(action: string, el: Element, event: Event) => void} [onAction]
 */
export function openModal(html, onAction) {
  if (!root) mountModal();

  actionHandler = onAction || null;
  // handle 留在卡片上（拖动时它不能跟着内容滚走），内容包进可滚动的 body。
  // body 自己才是滚动容器，这样能在它身上做「边缘渐隐」而不会把卡片背景也淡掉。
  card.innerHTML = `<div class="sheet-handle"></div><div class="modal-body">${html}</div>`;

  const body = card.querySelector('.modal-body');
  const head = body.querySelector(':scope > .modal-head');
  if (head) {
    // 标题栏挪出滚动区：内容滚得再远，标题和关闭按钮都停在上方 ——
    // 塞在滚动容器里的话，往下滚一点就摸不到标题，也就没法「拖标题关闭」了
    body.before(head);
    if (!head.querySelector('[data-close]')) head.insertAdjacentHTML('beforeend', CLOSE_HTML);
  } else {
    // 没有标题的弹窗（比如邻居详情那种自定义头部）也补一条窄栏，只放关闭按钮
    card.querySelector('.sheet-handle')
      .insertAdjacentHTML('afterend', `<div class="modal-head bare">${CLOSE_HTML}</div>`);
  }

  root.classList.add('show');

  unbindAction?.();
  unbindAction = delegate(card, 'click', '[data-action]', (el, event) => {
    actionHandler?.(el.dataset.action, el, event);
  });
}

/** 关闭弹窗 */
export function closeModal() {
  if (!root) return;
  root.classList.remove('show');
  card.innerHTML = '';
  unbindAction?.();
  unbindAction = null;
  actionHandler = null;
}

/** 绑定遮罩、关闭按钮与下拉手势（只需执行一次） */
export function mountModal() {
  root = byId('modal');
  card = root.querySelector('.modal-card');

  delegate(root, 'click', '[data-close]', () => closeModal());
  // 内容每次打开都会重建，所以这里传一个取值函数而不是元素本身
  dragToClose(card, {
    onClose: closeModal,
    scrollArea: () => card.querySelector('.modal-body'),
  });
}