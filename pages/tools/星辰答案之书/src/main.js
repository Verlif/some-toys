/* =========================================================
   main.js —— 入口：装配各模块并驱动主循环
   ========================================================= */
(function (global) {
  'use strict';

  var NS = global.AnswerBook;
  var vp = NS.viewport;

  /**
   * 每帧执行顺序：
   *   黑洞移动 → 施力 → 星点积分 → 画尾流 → 画星点 → 画黑球
   * 先施力再积分，速度的改变才能当帧变成位移；黑球最后画，才能盖住所有星点。
   */
  function frame(dt, now) {
    vp.ctx.clearRect(0, 0, vp.width, vp.height);

    NS.blackhole.update(dt);
    NS.blackhole.attract(NS.stars.list, dt);
    NS.stars.update(dt);

    NS.stars.drawTrails();
    NS.stars.draw(now);

    NS.meteors.update(dt);
    NS.meteors.draw();

    NS.blackhole.draw();
  }

  function bootstrap() {
    vp.init('sky');
    NS.stars.build();

    /* 视口变化后星场需要按新面积重建 */
    vp.onResize(function () { NS.stars.build(); });

    NS.loop.start(frame);
    NS.answerText.start();
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})(window);
