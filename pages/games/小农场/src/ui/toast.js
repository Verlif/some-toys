/**
 * Toast 轻提示。
 * 订阅领域层通过事件总线发来的 NOTIFY，业务代码不需要认识 DOM。
 */
import { byId } from '../core/dom.js';
import { on, EVENTS } from '../core/bus.js';

const DISPLAY_MS = 1800;
const FADE_MS = 280;

let box = null;

/**
 * 弹一条提示
 * @param {string} message
 * @param {'gold'|''} [type]
 */
export function showToast(message, type = '') {
  if (!box) box = byId('toasts');
  if (!box) return;

  const el = document.createElement('div');
  el.className = `toast ${type}`.trim();
  el.textContent = message;
  box.appendChild(el);

  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), FADE_MS);
  }, DISPLAY_MS);
}

/** 接管事件总线上的提示请求 */
export function mountToast() {
  box = byId('toasts');
  on(EVENTS.NOTIFY, ({ message, type }) => showToast(message, type));
}