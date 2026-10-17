/* =========================================================
   main.js — 启动入口：画布尺寸、事件绑定、主循环
   ========================================================= */
(function (DRC) {
  'use strict';

  const canvas = document.getElementById('game');
  const game = new DRC.Game(canvas);

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    game.resize(window.innerWidth, window.innerHeight, dpr);
    DRC.UI.refreshPreview();
  }

  window.addEventListener('resize', resize);
  resize();

  DRC.UI.init(game);
  DRC.Input.attach({
    onPause: function () { game.togglePause(); },
    onKey: function (code) { game.onKey(code); },
  });
  DRC.UI.show('panelMain');

  // 窗口失焦 / 切到别的标签页时自动暂停，回来先看 3-2-1 再继续
  window.addEventListener('blur', function () { game.pause(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) game.pause();
  });

  let lastTS = 0;

  function frame(ts) {
    requestAnimationFrame(frame);

    if (!lastTS) lastTS = ts;
    let dt = (ts - lastTS) / 1000;
    lastTS = ts;
    dt = Math.min(dt, 0.05);   // 切后台回来不跳帧

    game.update(dt);
    DRC.Renderer.draw(game);
  }

  requestAnimationFrame(frame);
})(window.DRC);
