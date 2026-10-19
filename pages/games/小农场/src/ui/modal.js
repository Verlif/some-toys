/**
 * 模态弹窗容器。与子页面、底部浮窗统一为「底部上滑 + 下拉关闭」。
 *
 * 用法：openModal(html, actionHandler)
 * html 里带 data-close 的元素点击关闭；带 data-action="xxx" 的元素
 * 会把 action 名与元素一起交给 actionHandler，由调用方决定怎么处理。
 */
import { byId, delegate } from '../core/dom.js';
import { dragToClose } from './drag-close.js';

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
  card.innerHTML = `<div class="sheet-handle"></div>${html}`;
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
  dragToClose(card, { onClose: closeModal, scrollArea: card });
}