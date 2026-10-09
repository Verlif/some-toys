/** 底部轻提示 */
import { $ } from './dom.js';

let timer = null;
const DURATION = 2200;

export function toast(text, duration = DURATION) {
  const el = $('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), duration);
}
