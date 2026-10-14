/**
 * 通用工具函数与本地存储封装
 */
window.App = window.App || {};

App.utils = (function () {
  'use strict';

  function hexStr(r, g, b) {
    const h = v => Math.round(v).toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
  }

  function rgbStr(r, g, b) {
    return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
  }

  function clamp(v, a, b) {
    return v < a ? a : (v > b ? b : v);
  }

  function fmtCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function fmtPct(p) {
    return p < 0.1 ? '<0.1%' : p.toFixed(1) + '%';
  }

  function isChanged(c) {
    return c.tr !== Math.round(c.r) || c.tg !== Math.round(c.g) || c.tb !== Math.round(c.b);
  }

  function $(id) {
    return document.getElementById(id);
  }

  /** localStorage 安全封装（隐私模式 / file:// 下不可用时静默降级） */
  const storage = {
    get: function (key, fallback) {
      try {
        const v = window.localStorage.getItem(key);
        return v === null ? fallback : v;
      } catch (e) {
        return fallback;
      }
    },
    set: function (key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch (e) {
        /* 忽略写入失败 */
      }
    }
  };

  return {
    hexStr: hexStr,
    rgbStr: rgbStr,
    clamp: clamp,
    fmtCount: fmtCount,
    fmtPct: fmtPct,
    isChanged: isChanged,
    $: $,
    storage: storage
  };
})();
