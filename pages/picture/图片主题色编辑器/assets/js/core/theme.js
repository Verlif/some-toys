/**
 * 亮 / 暗色主题管理
 * 通过 <html data-theme="dark|light"> 驱动 CSS 变量切换
 * 优先级：localStorage > 系统偏好（prefers-color-scheme）> 暗色
 */
window.App = window.App || {};

App.theme = (function () {
  'use strict';

  let current = 'dark';

  function systemPrefersLight() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  }

  function apply() {
    document.documentElement.setAttribute('data-theme', current);
    const btn = App.utils.$('themeToggle');
    if (btn) {
      const title = current === 'dark'
        ? App.i18n.t('theme.toggleToLight')
        : App.i18n.t('theme.toggleToDark');
      btn.title = title;
      btn.setAttribute('aria-label', title);
    }
  }

  function set(theme) {
    current = theme === 'light' ? 'light' : 'dark';
    App.utils.storage.set(App.config.STORAGE_KEYS.theme, current);
    apply();
  }

  function toggle() {
    set(current === 'dark' ? 'light' : 'dark');
  }

  function get() {
    return current;
  }

  function init() {
    const saved = App.utils.storage.get(App.config.STORAGE_KEYS.theme, null);
    current = (saved === 'light' || saved === 'dark')
      ? saved
      : (systemPrefersLight() ? 'light' : 'dark');
    apply();
  }

  return {
    init: init,
    apply: apply,
    set: set,
    toggle: toggle,
    get: get
  };
})();
