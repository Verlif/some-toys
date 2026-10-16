/**
 * ui/modal.js — 模态框统一开关
 */
import { $, qsa } from '../utils/dom.js';

/** modalId -> Set<回调>，关闭时触发 */
const closeHandlers = new Map();
/** 当前打开的模态框，用于 Esc 关闭最上层 */
const openStack = new Set();

/** 注册「某个模态框关闭后」的回调 */
export function onModalClose(modalId, fn) {
  if (!closeHandlers.has(modalId)) closeHandlers.set(modalId, new Set());
  closeHandlers.get(modalId).add(fn);
}

export function isModalOpen(modalId) {
  const el = $(modalId);
  return !!el && el.classList.contains('show');
}

export function openModal(modalId) {
  const el = $(modalId);
  if (!el) return;

  el.classList.add('show');
  el.setAttribute('aria-hidden', 'false');
  openStack.add(modalId);

  // 打开时把内容滚回顶部
  const panel = el.querySelector('.modal');
  if (panel) panel.scrollTop = 0;
}

export function closeModal(modalId) {
  const el = $(modalId);
  if (!el || !el.classList.contains('show')) return;

  el.classList.remove('show');
  el.setAttribute('aria-hidden', 'true');
  openStack.delete(modalId);

  const set = closeHandlers.get(modalId);
  if (!set) return;
  set.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error('[modal] 关闭回调抛出异常', e);
    }
  });
}

export function closeAllModals() {
  Array.from(openStack).forEach(closeModal);
}

/** 绑定静态交互：点遮罩关闭、[data-close] 按钮、Esc */
export function initModals() {
  qsa('.modal-mask').forEach((mask) => {
    mask.setAttribute('aria-hidden', 'true');
    mask.addEventListener('click', (e) => {
      if (e.target === mask) closeModal(mask.id);
    });
  });

  qsa('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close')));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || openStack.size === 0) return;

    // 上层还有对话框 / 图片预览 / 扫码 / 放大遮罩时，交给它们处理
    const dialog = $('dialogMask');
    const imageViewer = $('imageViewer');
    const scanner = $('scannerOverlay');
    const zoom = $('qrZoom');
    if (
      (dialog && !dialog.hidden) ||
      (imageViewer && !imageViewer.hidden) ||
      (scanner && !scanner.hidden) ||
      (zoom && !zoom.hidden)
    ) return;

    const top = Array.from(openStack).pop();
    if (top) closeModal(top);
  });
}
