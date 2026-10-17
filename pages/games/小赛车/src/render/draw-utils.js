/* =========================================================
   draw-utils.js — Canvas 绘制小工具
   ========================================================= */
(function (DRC) {
  'use strict';

  /** 圆角矩形路径（只建路径，不填充） */
  DRC.roundRect = function (ctx, x, y, w, h, r) {
    const radius = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  };

  /** #rgb / #rrggbb → rgba(...) 字符串 */
  DRC.hexToRgba = function (hex, alpha) {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  };
})(window.DRC);
