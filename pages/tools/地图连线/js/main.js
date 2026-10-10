/* =========================================================
   main.js — 引导与界面编排
   初始化编辑器与游戏，处理屏幕切换、开始游戏、窗口尺寸自适应。
   暴露到：window.App（入口脚本，最后加载）
   ========================================================= */
(function (App) {
  'use strict';

  const { $ } = App.utils;

  function isEditorActive() {
    return $('#editorScreen').classList.contains('active');
  }

  function switchScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const map = { editor: 'editorScreen', game: 'gameScreen' };
    const el = $(map[name]);
    if (el) el.classList.add('active');
  }

  function init() {
    // 初始化两个模块
    App.Editor.init();
    App.Game.init();

    // 开始游戏
    $('#edStart').addEventListener('click', () => {
      const map = App.Editor.getMap();
      if (map.places.length < App.config.MIN_PLACES || map.edges.length < App.config.MIN_EDGES) return;
      App.Game.loadFrom(map);
      switchScreen('game');
      requestAnimationFrame(() => App.Game.resetView());
    });

    // 窗口尺寸变化：重新自适应视图
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (isEditorActive()) App.Editor.resetView();
        else App.Game.resetView();
      }, 200);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window.App = window.App || {});
