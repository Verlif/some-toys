/**
 * 多语言管理（zh-CN / en-US）
 *
 * HTML 用法：
 *   data-i18n="key"              文本内容
 *   data-i18n-html="key"         含少量标签的内容（innerHTML）
 *   data-i18n-title="key"        title 属性
 *   data-i18n-aria-label="key"   aria-label 属性
 *
 * JS 用法：
 *   App.i18n.t('key', { name: 'x' })   // {{name}} 占位符替换
 */
window.App = window.App || {};

App.i18n = (function () {
  'use strict';

  let current = App.config.DEFAULT_LANG;
  const listeners = [];

  function lookup(dict, key) {
    return key.split('.').reduce(function (o, k) {
      return (o && typeof o === 'object' && o[k] !== undefined) ? o[k] : null;
    }, dict);
  }

  function t(key, params) {
    let s = lookup(App.locales[current] || {}, key);
    if (typeof s !== 'string') {
      s = lookup(App.locales[App.config.FALLBACK_LANG] || {}, key);
    }
    if (typeof s !== 'string') return key;
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split('{{' + k + '}}').join(String(params[k]));
      });
    }
    return s;
  }

  /** 将当前语言应用到整个文档 */
  function apply() {
    document.documentElement.lang = current;
    document.title = t('app.title');

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
    });

    listeners.forEach(function (fn) {
      try {
        fn();
      } catch (e) {
        /* 忽略单个监听器异常 */
      }
    });
  }

  function updateLangButtons() {
    document.querySelectorAll('.lang-btn').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-lang') === current ? 'true' : 'false');
    });
  }

  function setLang(lang) {
    if (!App.locales[lang] || lang === current) return;
    current = lang;
    App.utils.storage.set(App.config.STORAGE_KEYS.lang, lang);
    updateLangButtons();
    apply();
  }

  function getLang() {
    return current;
  }

  /** 注册语言变化回调（用于刷新 JS 动态生成的文本） */
  function onChange(fn) {
    listeners.push(fn);
  }

  /** 初始化：localStorage > 浏览器语言 > 默认语言 */
  function init() {
    const saved = App.utils.storage.get(App.config.STORAGE_KEYS.lang, null);
    let lang = App.config.DEFAULT_LANG;
    if (saved && App.locales[saved]) {
      lang = saved;
    } else {
      const nav = (navigator.language || '').toLowerCase();
      if (nav.indexOf('zh') === 0) lang = 'zh-CN';
      else if (nav.indexOf('en') === 0) lang = 'en-US';
    }
    current = lang;
    updateLangButtons();
    apply();
  }

  return {
    t: t,
    apply: apply,
    setLang: setLang,
    getLang: getLang,
    onChange: onChange,
    init: init,
    updateLangButtons: updateLangButtons
  };
})();
