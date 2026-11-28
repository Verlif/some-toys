/* 图片模块：粘贴 / 拖放 / 工具栏上传，写入仓库 docs/assets/ 并插入相对链接 */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var Features = App.Features = App.Features || {};

  function create(ctx) {
    function t(key, params) { return ctx.t(key, params); }

    function readAsDataUrl(file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result)); };
        reader.onerror = function () { reject(new Error('读取图片失败')); };
        reader.readAsDataURL(file);
      });
    }

    function fileName(file) {
      var ext = (file.name || 'image.png').split('.').pop().toLowerCase();
      if (!/^(png|jpe?g|gif|webp|svg)$/.test(ext)) ext = 'png';
      var d = new Date();
      var stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') +
        '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + String(d.getSeconds()).padStart(2, '0');
      return stamp + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    }

    function relativeLink(assetPath) {
      var doc = ctx.activeDoc && ctx.activeDoc();
      var dir = doc ? String(doc.path).split('/').slice(0, -1).join('/') : '';
      var depth = dir ? dir.split('/').length : 0;
      return (depth ? '../'.repeat(depth) : '') + assetPath;
    }

    function uploadFile(file) {
      if (!file || !/^image\//.test(file.type)) return Promise.resolve(null);
      ctx.toast(t('editor.uploading'), 'info');
      return readAsDataUrl(file).then(function (dataUrl) {
        var path = 'assets/' + fileName(file);
        var canUpload = ctx.client && ctx.binding.token && !ctx.offline();
        if (!canUpload) {
          // 离线时内嵌 data URL，保证文档仍可预览；同时缓存进 IndexedDB 供导出/离线查看
          if (ctx.saveAsset) {
            ctx.saveAsset(path, dataUrl, file.type)
              .then(function () { if (ctx.refreshAssets) ctx.refreshAssets(); })
              .catch(function () {});
          }
          return { link: dataUrl, name: file.name, offline: true };
        }
        if (ctx.saveAsset) {
          ctx.saveAsset(path, dataUrl, file.type)
            .then(function () { if (ctx.refreshAssets) ctx.refreshAssets(); })
            .catch(function () {});
        }
        return ctx.client.putBinary(path, dataUrl, 'docs: upload image ' + file.name).then(function () {
          return { link: relativeLink(path), name: file.name, offline: false };
        });
      }).then(function (result) {
        if (!result) return null;
        ctx.editor.insertText('![](' + result.link + ')');
        ctx.onEditorInput();
        ctx.editor.renderPreview();
        ctx.toast(t('toast.uploadedImage', { name: result.name }), 'ok');
        if (result.offline) ctx.toast(t('toast.offline'), 'warn');
        return result;
      }).catch(function (err) {
        ctx.toast(t('editor.uploadFailed', { msg: err.message }), 'error');
        return null;
      });
    }

    function pickFile() {
      var picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = 'image/*';
      picker.multiple = true;
      picker.style.display = 'none';
      document.body.appendChild(picker);
      picker.addEventListener('change', function () {
        Array.prototype.forEach.call(picker.files || [], uploadFile);
        picker.remove();
      });
      picker.click();
    }

    function handlePaste(e) {
      var files = [];
      if (e.clipboardData && e.clipboardData.files) {
        files = Array.prototype.slice.call(e.clipboardData.files);
      }
      if (!files.length && e.clipboardData && e.clipboardData.items) {
        Array.prototype.forEach.call(e.clipboardData.items, function (item) {
          if (item.kind === 'file' && /^image\//.test(item.type)) files.push(item.getAsFile());
        });
      }
      files = files.filter(function (f) { return f && /^image\//.test(f.type); });
      if (!files.length) return;
      e.preventDefault();
      files.forEach(uploadFile);
    }

    function handleDrop(e) {
      var files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || [])
        .filter(function (f) { return /^image\//.test(f.type); });
      if (!files.length) return;
      e.preventDefault();
      files.forEach(uploadFile);
    }

    return { uploadFile: uploadFile, pickFile: pickFile, handlePaste: handlePaste, handleDrop: handleDrop };
  }

  Features.Images = { create: create };
})(window);
