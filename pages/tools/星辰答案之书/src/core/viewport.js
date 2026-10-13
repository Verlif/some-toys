/* =========================================================
   core/viewport.js —— 画布尺寸与高 DPI 适配
   负责：创建 canvas 上下文、处理 resize、广播尺寸变化
   ========================================================= */
(function (global) {
  'use strict';

  var NS = global.AnswerBook || (global.AnswerBook = {});
  var listeners = [];
  var rafId = 0;

  var viewport = {
    canvas: null,
    ctx: null,
    width: 0,
    height: 0,
    dpr: 1,
    /** 高 DPI 上限，避免 4K 屏上像素量爆炸 */
    maxDpr: 2,

    /** 初始化：绑定 canvas 并立即测量一次 */
    init: function (canvasId) {
      viewport.canvas = document.getElementById(canvasId || 'sky');
      viewport.ctx = viewport.canvas.getContext('2d');
      viewport.resize();

      global.addEventListener('resize', scheduleResize);
      global.addEventListener('orientationchange', scheduleResize);
      return viewport;
    },

    /** 重新测量视口并按 DPR 重建后备缓冲区，然后通知订阅者 */
    resize: function () {
      var canvas = viewport.canvas;
      var dpr = Math.min(global.devicePixelRatio || 1, viewport.maxDpr);

      viewport.dpr = dpr;
      viewport.width = global.innerWidth;
      viewport.height = global.innerHeight;

      canvas.width = Math.round(viewport.width * dpr);
      canvas.height = Math.round(viewport.height * dpr);
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';

      /* 一次性把缩放烘进变换矩阵，后续绘制一律使用 CSS 像素坐标 */
      viewport.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      for (var i = 0; i < listeners.length; i++) listeners[i](viewport);
    },

    /** 订阅尺寸变化，返回回调本身便于取消 */
    onResize: function (fn) {
      listeners.push(fn);
      return fn;
    }
  };

  function scheduleResize() {
    if (rafId) global.cancelAnimationFrame(rafId);
    rafId = global.requestAnimationFrame(function () {
      rafId = 0;
      viewport.resize();
    });
  }

  NS.viewport = viewport;
})(window);
