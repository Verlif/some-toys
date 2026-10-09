/**
 * DOM 小工具
 * 项目里所有 getElementById 都收敛到这里，便于日后换成别的渲染方案
 */

export const $ = id => document.getElementById(id);

export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** 生成内联 SVG 字符串 */
export const svg = (path, attrs = '') =>
  `<svg viewBox="0 0 24 24" fill="currentColor"${attrs ? ' ' + attrs : ''}>${path}</svg>`;

/** 安全地写文本（避免 innerHTML 注入） */
export function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

/** 绑定事件，元素不存在时静默跳过（视图未渲染时不会报错） */
export function on(id, type, handler, options) {
  const el = typeof id === 'string' ? $(id) : id;
  if (el) el.addEventListener(type, handler, options);
}

export function toggleClass(id, cls, force) {
  const el = $(id);
  if (el) el.classList.toggle(cls, force);
}

/** 强制重排一次，用于重启 CSS 入场动画 */
export function reflow(el) {
  void el.offsetWidth;
}
