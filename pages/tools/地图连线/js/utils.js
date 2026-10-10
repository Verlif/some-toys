/* =========================================================
   utils.js — 通用工具函数
   暴露到：window.App.utils
   ========================================================= */
(function (App) {
  'use strict';

  /** 按 id 取元素（兼容带或不带前导 # 的写法） */
  const $ = (id) => document.getElementById(typeof id === 'string' && id[0] === '#' ? id.slice(1) : id);

  /** 数值夹取 */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /** 字符串哈希（用于稳定的道路弯曲方向，保证连线确定性） */
  function hashCode(s) {
    let h = 0;
    s = String(s);
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  /** 道路唯一键（无序：A-B 与 B-A 等价） */
  function edgeKey(a, b) {
    return [a, b].sort((x, y) => x - y).join('|');
  }

  /**
   * 计算两点间道路路径（两段三次贝塞尔，中间向外弯，避免与反向边重叠）
   */
  function roadPath(a, b) {
    const h = hashCode(a.id + b.id);
    const bend = h % 2 === 0 ? 1 : -1;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const off = Math.min(len * 0.13, 60) * bend;
    const cx = mx + nx * off;
    const cy = my + ny * off;
    const p = 0.32;
    const c1x = a.x + (cx - a.x) * p;
    const c1y = a.y + (cy - a.y) * p;
    const c2x = b.x + (cx - b.x) * p;
    const c2y = b.y + (cy - b.y) * p;
    return `M ${a.x} ${a.y} C ${c1x} ${c1y} ${c2x} ${c2y} ${b.x} ${b.y}`;
  }

  /**
   * 地点补偿缩放：地图整体缩放时，让地点保持相对恒定的视觉大小
   */
  function placeScale(scale) {
    return clamp(1 / Math.pow(scale, 0.8), 0.5, 3.6);
  }

  /** HTML 转义（注入用户文本到 SVG/innerHTML 前进行，避免 XSS） */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  App.utils = { $, clamp, hashCode, edgeKey, roadPath, placeScale, esc };

})(window.App = window.App || {});
