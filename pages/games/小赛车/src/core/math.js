/* =========================================================
   math.js — 通用数学与格式化工具
   ========================================================= */
(function (DRC) {
  'use strict';

  DRC.clamp = function (v, a, b) {
    return v < a ? a : (v > b ? b : v);
  };

  DRC.normAngle = function (a) {
    while (a > Math.PI) a -= DRC.TAU;
    while (a < -Math.PI) a += DRC.TAU;
    return a;
  };

  DRC.rnd = function (a, b) {
    return a + Math.random() * (b - a);
  };

  DRC.lerp = function (a, b, t) {
    return a + (b - a) * t;
  };

  /** 帧率无关的指数平滑：rate 越大追得越紧 */
  DRC.damp = function (cur, target, rate, dt) {
    return cur + (target - cur) * (1 - Math.exp(-rate * dt));
  };

  DRC.easeOut = function (t) {
    const k = 1 - t;
    return 1 - k * k * k;
  };

  /** 秒 → m:ss.xx */
  DRC.formatTime = function (sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const mm = Math.floor(sec / 60);
    const ss = (sec % 60).toFixed(2).padStart(5, '0');
    return mm + ':' + ss;
  };
})(window.DRC);
