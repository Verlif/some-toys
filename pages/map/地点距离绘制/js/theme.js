(function (app) {
  'use strict';
  const KEY = 'place-distance-drawing:theme';
  function apply(theme) {
    const value = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = value;
    const button = document.querySelector('#themeToggle');
    if (button) {
      button.textContent = value === 'dark' ? '☀' : '☾';
      button.title = value === 'dark' ? '切换到明亮主题' : '切换到暗色主题';
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', String(value === 'dark'));
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = value === 'dark' ? '#182321' : '#f5f7f8';
  }
  function init() {
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (_) { /* Theme can still be changed for this page view. */ }
    let theme = saved === 'dark' || saved === 'light' ? saved : 'light';
    apply(theme);
    document.querySelector('#themeToggle').addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, theme); } catch (_) { /* Keep the in-memory selection. */ }
      apply(theme);
    });
  }
  app.theme = { init, apply };
})(window.DistanceDrawing = window.DistanceDrawing || {});
