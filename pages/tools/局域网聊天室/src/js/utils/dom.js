/**
 * utils/dom.js — DOM 查询与操作的轻量封装
 */

/** 按 id 取元素 */
export const $ = (id) => document.getElementById(id);

/** 单元素查询 */
export const qs = (selector, root = document) => root.querySelector(selector);

/** 多元素查询（返回数组） */
export const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** 绑定事件，返回解绑函数 */
export function on(el, type, handler, options) {
  if (!el) return () => {};
  el.addEventListener(type, handler, options);
  return () => el.removeEventListener(type, handler, options);
}

/** 显隐切换（走 hidden 属性，样式由 [hidden] 统一处理） */
export function setHidden(el, hidden) {
  if (el) el.hidden = !!hidden;
}

/** 设置文本（避免 innerHTML 注入） */
export function setText(el, text) {
  if (el) el.textContent = text == null ? '' : String(text);
}

/** HTML 转义，用于必须拼 innerHTML 的场合 */
export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
