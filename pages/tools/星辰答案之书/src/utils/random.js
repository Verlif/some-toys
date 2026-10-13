/* =========================================================
   utils/random.js —— 随机数工具
   直接挂载到 window.AnswerBook.rand / .randInt
   ========================================================= */
(function (global) {
  'use strict';

  var NS = global.AnswerBook || (global.AnswerBook = {});

  /** [a, b) 区间内的浮点数 */
  NS.rand = function (a, b) {
    return a + Math.random() * (b - a);
  };

  /** [a, b] 区间内的整数（含两端） */
  NS.randInt = function (a, b) {
    return Math.floor(a + Math.random() * (b - a + 1));
  };

  /** 返回 -1 或 1 */
  NS.randSign = function () {
    return Math.random() < 0.5 ? -1 : 1;
  };
})(window);
