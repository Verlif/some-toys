/* =========================================================
   core/loop.js —— 主渲染循环
   只做一件事：把 requestAnimationFrame 折算成秒级 dt 后交给 step
   ========================================================= */
(function (global) {
  'use strict';

  var NS = global.AnswerBook || (global.AnswerBook = {});

  NS.loop = {
    /** dt 上限（秒）。切回标签页时可能出现超大间隔，钳制以免物理爆炸 */
    maxDt: 0.05,

    /**
     * 启动循环
     * @param {(dt:number, now:number) => void} step 每帧回调
     */
    start: function (step) {
      var prev = global.performance.now();

      function frame(now) {
        var dt = Math.min((now - prev) / 1000, NS.loop.maxDt);
        prev = now;
        step(dt, now);
        global.requestAnimationFrame(frame);
      }

      global.requestAnimationFrame(frame);
    }
  };
})(window);
