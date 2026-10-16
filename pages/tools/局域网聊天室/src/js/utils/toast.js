/**
 * utils/toast.js — 底部轻提示
 */
import { $ } from './dom.js';

let timer = null;

/** 显示一条短提示，重复调用会重置计时 */
export function showToast(message, duration = 2200) {
  const el = $('toast');
  if (!el) return;

  el.textContent = message;
  el.classList.add('show');

  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), duration);
}
