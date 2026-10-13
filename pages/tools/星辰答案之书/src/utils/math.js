/* =========================================================
   utils/math.js —— 数学工具
   全局命名空间：window.AnswerBook.math
   ========================================================= */
(function (global) {
  'use strict';

  var NS = global.AnswerBook || (global.AnswerBook = {});
  var TAU = Math.PI * 2;

  var math = {
    TAU: TAU,

    /** 把 v 限制在 [min, max] */
    clamp: function (v, min, max) {
      return v < min ? min : (v > max ? max : v);
    },

    /** 线性插值 */
    lerp: function (a, b, t) {
      return a + (b - a) * t;
    },

    /** 平滑阶跃：x <= edge0 返回 0，x >= edge1 返回 1，中间为 S 曲线 */
    smoothstep: function (edge0, edge1, x) {
      var span = edge1 - edge0;
      if (span === 0) return x < edge0 ? 0 : 1;
      var t = math.clamp((x - edge0) / span, 0, 1);
      return t * t * (3 - 2 * t);
    },

    /** 向量长度 */
    len: function (x, y) {
      return Math.sqrt(x * x + y * y);
    }
  };

  NS.math = math;
})(window);
