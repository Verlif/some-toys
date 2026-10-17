/* =========================================================
   direction-hints.js — 起步方向提示
   倒计时期间在赛道地面上排一串箭头，并让一条亮带沿箭头
   向前扫过，提示行驶方向；GO 之后随 alpha 淡出。
   （箭头位置固定、亮度流动，避免位移产生跳帧）
   ========================================================= */
(function (DRC) {
  'use strict';

  const START = 12;    // 起点线之后的第一个箭头（采样点索引）
  const STEP = 14;     // 箭头间距（采样点）
  const COUNT = 8;     // 箭头数量

  function arrow(ctx, x, y, angle, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(92,242,168,' + alpha.toFixed(3) + ')';

    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(-7, 9.5);
    ctx.lineTo(-1.5, 0);
    ctx.lineTo(-7, -9.5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} track
   * @param {number} alpha 0~1 整体强度
   * @param {number} time  动画时间（秒），控制亮带位置
   */
  function draw(ctx, track, alpha, time) {
    if (alpha <= 0.01) return;

    const s = track.samples;
    const n = track.n;
    const phase = (time * 0.85) % 1;

    for (let i = 0; i < COUNT; i++) {
      const sm = s[(START + i * STEP) % n];
      const wave = (i / COUNT - phase + 1) % 1;
      const pulse = Math.pow(1 - wave, 3);
      const edge = (i === 0 || i === COUNT - 1) ? 0.45 : 1;
      const a = (0.18 + 0.58 * pulse) * edge * alpha;

      if (a < 0.01) continue;
      arrow(ctx, sm.x, sm.y, sm.ang, a);
    }
  }

  DRC.DirectionHints = { draw: draw };
})(window.DRC);
