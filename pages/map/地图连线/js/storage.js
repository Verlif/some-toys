/* =========================================================
   storage.js — 数据持久化与文件导入导出
   暴露到：window.App.storage
   ========================================================= */
(function (App) {
  'use strict';

  /** 下载 JSON 为文件 */
  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** 读取文件文本（Promise） */
  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file);
    });
  }

  /** 保存编辑器状态到 localStorage */
  function saveEditor(state) {
    try {
      localStorage.setItem(App.config.STORAGE_KEY, JSON.stringify(state));
    } catch (_) { /* 忽略隐私模式 / 容量异常 */ }
  }

  /** 读取编辑器状态（无则返回 null） */
  function loadEditor() {
    try {
      const raw = localStorage.getItem(App.config.STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.places)) return null;
      return s;
    } catch (_) {
      return null;
    }
  }

  App.storage = { downloadJSON, readFileText, saveEditor, loadEditor };

})(window.App = window.App || {});
