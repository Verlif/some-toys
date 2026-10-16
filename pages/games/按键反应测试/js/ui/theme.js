/**
 * 亮 / 暗色主题。
 * 首次访问跟随系统 prefers-color-scheme，用户手动切换后写入本地存储。
 * 页面 <head> 里的内联脚本会提前落一次 data-theme，避免首屏闪白。
 */

import { load, save } from '../utils/storage.js';

const KEY = 'theme';
const MEDIA = window.matchMedia('(prefers-color-scheme: dark)');

let preference = load(KEY, null); // 'light' | 'dark' | null（跟随系统）
if (preference !== 'light' && preference !== 'dark') preference = null;

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function resolve() {
  return preference || (MEDIA.matches ? 'dark' : 'light');
}

function apply() {
  const theme = resolve();
  document.documentElement.dataset.theme = theme;
  document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

/**
 * 绑定切换按钮。按钮内需包含 .theme-toggle-icon 与 .theme-toggle-text。
 * @param {HTMLElement} button
 */
export function initTheme(button) {
  const icon = button?.querySelector('.theme-toggle-icon');
  const text = button?.querySelector('.theme-toggle-text');

  const sync = () => {
    const theme = currentTheme();
    if (icon) icon.textContent = theme === 'dark' ? '☾' : '☀';
    if (text) text.textContent = theme === 'dark' ? '暗色' : '亮色';
    if (button) button.title = `当前：${theme === 'dark' ? '暗色' : '亮色'}，点击切换`;
  };

  document.addEventListener('themechange', sync);
  apply();

  button?.addEventListener('click', () => {
    preference = currentTheme() === 'dark' ? 'light' : 'dark';
    save(KEY, preference);
    apply(); // apply 会派发 themechange，按钮随之同步
  });

  MEDIA.addEventListener('change', () => {
    if (!preference) apply();
  });
}
