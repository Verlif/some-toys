/**
 * 图片载入：点击 / 拖拽 / 粘贴
 */
window.App = window.App || {};

App.uploader = (function () {
  'use strict';

  const $ = App.utils.$;
  const MAX_WORK = App.config.MAX_WORK;

  function handleFile(file) {
    if (!file || !file.type || file.type.indexOf('image/') !== 0) return;

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = function () {
      URL.revokeObjectURL(url);
      buildFromImage(img);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      alert(App.i18n.t('error.loadFailed'));
    };
    img.src = url;
  }

  function buildFromImage(img) {
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (!w || !h) return;

    // 超大图等比缩小到工作尺寸
    const scale = Math.min(1, MAX_WORK / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));

    const work = document.createElement('canvas');
    work.width = w;
    work.height = h;
    const wctx = work.getContext('2d', { willReadFrequently: true });
    wctx.imageSmoothingEnabled = true;
    wctx.imageSmoothingQuality = 'high';
    wctx.drawImage(img, 0, 0, w, h);

    const data = wctx.getImageData(0, 0, w, h);

    const st = App.state;
    st.srcData = data;
    st.outData = null;
    st.width = w;
    st.height = h;

    App.viewer.src.setImage(w, h);
    App.viewer.src.getCtx().putImageData(data, 0, 0);

    App.viewer.out.setImage(w, h);

    const result = App.palette.extractPalette(data, App.config.MAX_COLORS);
    st.totalPx = result.totalPx;
    st.colors = result.colors.map(c => ({
      r: c.r, g: c.g, b: c.b,
      count: c.n,
      tr: Math.round(c.r), tg: Math.round(c.g), tb: Math.round(c.b),
      off: false
    }));

    $('srcSize').textContent = w + ' × ' + h;

    // 刷新列表 + 预览
    st.lastGroupSig = null;
    App.colorList.render();
    App.processor.process();

    $('emptyState').classList.add('hide');
    $('reuploadBtn').style.display = '';
    $('downloadBtn').disabled = false;
    $('liveDot').style.display = 'block';
  }

  function init() {
    const uploadBox = $('uploadBox');
    const fileInput = $('fileInput');

    uploadBox.addEventListener('click', () => fileInput.click());
    $('reuploadBtn').addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (f) handleFile(f);
      fileInput.value = '';
    });

    ['dragenter', 'dragover'].forEach(ev => {
      document.addEventListener(ev, e => {
        e.preventDefault();
        uploadBox.classList.add('over');
      });
    });
    ['dragleave', 'drop'].forEach(ev => {
      document.addEventListener(ev, e => {
        e.preventDefault();
        if (ev === 'drop' || e.relatedTarget === null) uploadBox.classList.remove('over');
      });
    });
    document.addEventListener('drop', e => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });

    document.addEventListener('paste', e => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') === 0) {
          const f = items[i].getAsFile();
          if (f) { handleFile(f); break; }
        }
      }
    });
  }

  return {
    init: init,
    handleFile: handleFile
  };
})();
