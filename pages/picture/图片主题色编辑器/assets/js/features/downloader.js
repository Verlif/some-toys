/**
 * 下载处理后的 PNG
 */
window.App = window.App || {};

App.downloader = (function () {
  'use strict';

  const $ = App.utils.$;

  function init() {
    $('downloadBtn').addEventListener('click', () => {
      if (!App.state.outData) return;

      $('outCanvas').toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = App.i18n.t('download.filename', {
          width: App.state.width,
          height: App.state.height
        });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }, 'image/png');
    });
  }

  return { init: init };
})();
