/**
 * 应用入口：初始化主题 / 语言 / 查看器，装配各功能模块
 * 脚本加载顺序见 index.html（core -> locales -> features -> app）
 */
(function () {
  'use strict';

  const $ = App.utils.$;
  const clamp = App.utils.clamp;

  /* ================= 主题 & 语言 ================= */
  App.i18n.init();
  App.theme.init();

  // 语言切换后：刷新主题按钮文案、容差显示与颜色列表
  App.i18n.onChange(function () {
    App.theme.apply();
    renderTol();
    App.colorList.render();
  });

  document.querySelectorAll('.lang-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      App.i18n.setLang(btn.getAttribute('data-lang'));
    });
  });

  $('themeToggle').addEventListener('click', function () {
    App.theme.toggle();
  });

  /* ================= 图片查看器 ================= */
  App.viewer.src = App.createViewer($('srcBody'), function (px, py) {
    App.colorList.pickColor(px, py, false);
  });
  App.viewer.out = App.createViewer($('outBody'), function (px, py) {
    App.colorList.pickColor(px, py, true);
  });

  /* ================= 像素预览开关 ================= */
  let pixelMode = true;

  function setPixelMode(v) {
    pixelMode = !!v;
    $('pixelToggle').setAttribute('aria-pressed', pixelMode ? 'true' : 'false');
    App.viewer.src.setPixelMode(pixelMode);
    App.viewer.out.setPixelMode(pixelMode);
  }

  $('pixelToggle').addEventListener('click', function (e) {
    e.stopPropagation();
    setPixelMode(!pixelMode);
  });
  $('pixelRow').addEventListener('click', function (e) {
    if (e.target.closest('.switch')) return;
    setPixelMode(!pixelMode);
  });

  /* ================= 容差（单通道 0 - 255） ================= */
  const tolRange = $('tolRange');
  const tolVal = $('tolVal');

  function renderTol() {
    App.state.tol = clamp(Math.round(+tolRange.value), 0, 255);
    tolVal.innerHTML = App.i18n.t('tolerance.value', { value: App.state.tol });
  }

  // 拖动中：仅更新数值与预览
  tolRange.addEventListener('input', function () {
    renderTol();
    App.processor.schedule(60);
  });

  // 松开鼠标 / 键盘操作结束：刷新颜色列表
  tolRange.addEventListener('change', function () {
    renderTol();
    if (App.state.merge) {
      const sig = App.palette.groupSignature(
        App.palette.computeGroups(App.state.colors, App.state.tol)
      );
      if (sig !== App.state.lastGroupSig) App.colorList.render();
    }
    App.processor.process();
  });

  /* ================= 合并开关 ================= */
  function toggleMerge() {
    App.state.merge = !App.state.merge;
    $('mergeToggle').setAttribute('aria-pressed', App.state.merge ? 'true' : 'false');
    App.state.lastGroupSig = null;
    App.colorList.render();
    App.processor.process();
  }

  $('mergeToggle').addEventListener('click', function (e) {
    e.stopPropagation();
    toggleMerge();
  });
  $('mergeRow').addEventListener('click', function (e) {
    if (e.target.closest('.switch')) return;
    toggleMerge();
  });

  /* ================= 重置全部 ================= */
  $('resetAllBtn').addEventListener('click', function () {
    App.state.colors.forEach(function (c) {
      c.tr = Math.round(c.r);
      c.tg = Math.round(c.g);
      c.tb = Math.round(c.b);
    });
    App.state.lastGroupSig = null;
    App.colorList.render();
    App.processor.process();
  });

  /* ================= 功能模块装配 ================= */
  App.colorList.bindListEvents();
  App.uploader.init();
  App.downloader.init();

  /* ================= 初始化显示（不触发刷新） ================= */
  setPixelMode(true);
  renderTol();
})();
