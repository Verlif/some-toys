/* 文件资源管理器：目录树、标签筛选、搜索、拖拽移动与右键菜单 */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var Features = App.Features = App.Features || {};
  var UI = App.UI;
  var el = UI.el;

  function create(ctx, mount) {
    var state = { query: '' };
    var searchInput = UI.input({
      placeholder: ctx.t('explorer.searchPlaceholder'),
      onInput: function (e) { state.query = e.target.value.trim().toLowerCase(); renderTree(); }
    });
    searchInput.setAttribute('data-i18n-placeholder', 'explorer.searchPlaceholder');
    var treeHost = el('div', { class: 'tree' });
    // 从操作系统拖入文件：落在文件夹上进入该文件夹，落在空白处进入根目录，落在文件上进入同级目录
    treeHost.addEventListener('dragover', function (e) {
      if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    });
    treeHost.addEventListener('drop', function (e) {
      handleFilesDrop(e, '');
    });
    var heading = el('h2', { text: ctx.t('explorer.title') });
    heading.setAttribute('data-i18n', 'explorer.title');
    var header = el('div', { class: 'sidebar-header' }, [
      el('div', { class: 'sidebar-heading' }, [
        heading,
        el('div', { class: 'sidebar-tools' }, [
          withI18n(UI.iconButton('filePlus', { small: true, title: ctx.t('explorer.newDoc'), onClick: function () { ctx.createDoc(''); } }), 'explorer.newDoc'),
          withI18n(UI.iconButton('folderPlus', { small: true, title: ctx.t('explorer.newFolder'), onClick: function () { ctx.createFolder(''); } }), 'explorer.newFolder'),
          withI18n(UI.iconButton('download', { small: true, title: ctx.t('explorer.exportAll'), onClick: function () { ctx.exportAll(); } }), 'explorer.exportAll'),
          withI18n(UI.iconButton('upload', { small: true, title: ctx.t('explorer.importAll'), onClick: function () { ctx.importAll(); } }), 'explorer.importAll'),
          withI18n(UI.iconButton('refresh', { small: true, title: ctx.t('header.sync'), onClick: function () { ctx.syncNow(); } }), 'header.sync')
        ])
      ]),
      el('div', { class: 'sidebar-search' }, [UI.icon('search'), searchInput])
    ]);
    var root = el('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' } }, [
      header,
      el('div', { class: 'sidebar-scroll' }, [treeHost])
    ]);
    mount.innerHTML = '';
    mount.appendChild(root);

    function withI18n(node, key) {
      node.setAttribute('data-i18n-title', key);
      return node;
    }

    function basename(path) {
      // 文件树以真实文件名为准（含 .md），编辑器标题只用于标签页与正文展示
      return String(path).split('/').pop();
    }

    function hasFiles(e) {
      return !!(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0);
    }

    // 拖入文件夹时递归读取目录项，给每个文件标记相对路径以保留原有层级
    function collectDroppedFiles(e) {
      var items = e.dataTransfer && e.dataTransfer.items ? Array.prototype.slice.call(e.dataTransfer.items) : [];
      var entries = items.map(function (item) {
        return item && item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      }).filter(Boolean);
      if (!entries.length) {
        return Promise.resolve(Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []).map(function (file) {
          file.__dropPath = file.webkitRelativePath || file.name || 'file';
          return file;
        }));
      }
      var files = [];
      function walk(entry, prefix) {
        return new Promise(function (resolve) {
          if (entry.isFile) {
            entry.file(function (file) {
              file.__dropPath = prefix + (file.name || entry.name || 'file');
              files.push(file);
              resolve();
            }, function () { resolve(); });
          } else if (entry.isDirectory) {
            var reader = entry.createReader();
            function readBatch() {
              reader.readEntries(function (batch) {
                if (!batch.length) { resolve(); return; }
                Promise.all(batch.map(function (child) { return walk(child, prefix + entry.name + '/'); }))
                  .then(function () { readBatch(); }, function () { resolve(); });
              }, function () { resolve(); });
            }
            readBatch();
          } else {
            resolve();
          }
        });
      }
      return Promise.all(entries.map(function (entry) { return walk(entry, ''); })).then(function () { return files; });
    }

    function handleFilesDrop(e, target) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      collectDroppedFiles(e).then(function (files) {
        if (files.length) ctx.uploadFiles(files, target, true);
      });
    }

    function dirname(path) {
      var i = String(path).lastIndexOf('/');
      return i < 0 ? '' : path.slice(0, i);
    }

    function matches(doc) {
      if (!state.query) return true;
      var hay = [doc.title, doc.path, (doc.tags || []).join(' '), doc.body || ''].join(' ').toLowerCase();
      return hay.indexOf(state.query) >= 0;
    }

    function buildTree() {
      var assets = (ctx.assets ? ctx.assets() : []).filter(matches);
      var docs = ctx.store.list().filter(matches);
      var folderSet = {};
      (ctx.folders || []).forEach(function (path) { folderSet[path] = true; });
      docs.concat(assets).forEach(function (file) {
        var parts = String(file.path).split('/');
        parts.pop();
        var prefix = '';
        parts.forEach(function (part) {
          prefix = prefix ? prefix + '/' + part : part;
          folderSet[prefix] = true;
        });
      });
      var rootNode = { name: '', path: '', children: {}, files: [] };
      Object.keys(folderSet).sort().forEach(function (path) {
        var node = rootNode;
        path.split('/').forEach(function (part) {
          if (!node.children[part]) node.children[part] = { name: part, path: (node.path ? node.path + '/' : '') + part, children: {}, files: [] };
          node = node.children[part];
        });
      });
      docs.forEach(function (doc) {
        var node = rootNode;
        var parts = String(doc.path).split('/');
        parts.pop();
        parts.forEach(function (part) { node = node.children[part] || node; });
        node.files.push(doc);
      });
      assets.forEach(function (asset) {
        var node = rootNode;
        var parts = String(asset.path).split('/');
        parts.pop();
        parts.forEach(function (part) { node = node.children[part] || node; });
        node.files.push({ path: asset.path, asset: true, mime: asset.mime });
      });
      return rootNode;
    }

    function renderTree() {
      treeHost.innerHTML = '';
      var assets = (ctx.assets ? ctx.assets() : []).map(function (a) {
        return { path: a.path, asset: true, mime: a.mime };
      }).filter(matches);
      var docs = ctx.store.list().filter(matches);
      var files = docs.concat(assets);
      var hasFolders = (ctx.folders || []).length > 0 || Object.keys(buildTree().children).length > 0;
      if (!files.length && (state.query || !hasFolders)) {
        treeHost.appendChild(UI.empty('search', state.query ? ctx.t('explorer.noMatch') : ctx.t('explorer.empty')));
        return;
      }
      if (state.query) {
        files.sort(function (a, b) { return a.path.localeCompare(b.path); });
        files.forEach(function (file) { treeHost.appendChild(file.asset ? assetNode(file) : docNode(file)); });
        return;
      }
      renderFolder(buildTree(), treeHost, true);
    }

    function renderFolder(node, host, isRoot) {
      Object.keys(node.children).sort().forEach(function (name) {
        host.appendChild(folderNode(node.children[name]));
      });
      node.files.slice().sort(function (a, b) { return a.path.localeCompare(b.path); }).forEach(function (file) {
        host.appendChild(file.asset ? assetNode(file) : docNode(file));
      });
    }

    function folderNode(node) {
      var children = el('div', { class: 'tree-children' });
      var toggle = el('span', { class: 'tree-toggle', text: '▾' });
      var item = el('div', { class: 'tree-item', dataset: { path: node.path, type: 'folder' } }, [
        toggle, UI.icon('folder'), el('span', { class: 'tree-label', text: node.name }),
        folderMeta(node),
        el('span', { class: 'tree-actions' }, [
          UI.iconButton('more', { small: true, title: ctx.t('common.rename'), onClick: function (e) { e.stopPropagation(); folderMenu(e, node); } })
        ])
      ]);
      item.addEventListener('click', function () {
        children.hidden = !children.hidden;
        toggle.textContent = children.hidden ? '▸' : '▾';
      });
      item.addEventListener('contextmenu', function (e) { e.preventDefault(); folderMenu(e, node); });
      item.addEventListener('dragover', function (e) {
        e.preventDefault();
        if (hasFiles(e)) e.dataTransfer.dropEffect = 'copy';
        item.classList.add('drop-target');
      });
      item.addEventListener('dragleave', function () { item.classList.remove('drop-target'); });
      item.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        item.classList.remove('drop-target');
        if (hasFiles(e)) {
          handleFilesDrop(e, node.path);
          return;
        }
        var path = e.dataTransfer.getData('text/plain');
        if (path && path.indexOf(node.path + '/') !== 0) ctx.moveDoc(path, node.path + '/' + path.split('/').pop());
      });
      renderFolder(node, children, false);
      return el('div', {}, [item, children]);
    }

    function folderMeta(node) {
      var meta = el('span', { class: 'tree-meta' });
      // 只统计直接子项：子文件夹数量 + 直属文件数量，不递归，且为 0 时不显示
      var folderCount = Object.keys(node.children).length;
      var fileCount = node.files.length;
      if (folderCount) {
        var f = el('span', { class: 'tree-meta-item', title: ctx.t('explorer.folderCount') });
        f.appendChild(UI.icon('folder'));
        f.appendChild(el('span', { text: String(folderCount) }));
        meta.appendChild(f);
      }
      if (fileCount) {
        var d = el('span', { class: 'tree-meta-item', title: ctx.t('explorer.fileCount') });
        d.appendChild(UI.icon('file'));
        d.appendChild(el('span', { text: String(fileCount) }));
        meta.appendChild(d);
      }
      return meta;
    }

    function nameStatusClass(doc) {
      var status = ctx.docStatus ? ctx.docStatus(doc.path) : 'synced';
      if (status === 'dirty') return ' doc-name-dirty';
      // 关闭自动同步（或离线）时，已保存待同步不需要特殊颜色
      if (status === 'pending' && ctx.settings.autoSync !== false && !(ctx.offline && ctx.offline())) return ' doc-name-pending';
      return '';
    }

    function docNode(doc) {
      var label = el('span', { class: 'tree-label' + nameStatusClass(doc), text: basename(doc.path) });
      if (doc.conflict) label.appendChild(UI.badge(ctx.t('editor.conflict'), 'warn'));
      var item = el('div', {
        class: 'tree-item' + (ctx.activePath && ctx.activePath() === doc.path ? ' active' : ''),
        dataset: { path: doc.path, type: 'doc' }, draggable: true,
        onClick: function () { ctx.openDoc(doc.path); },
        onContextmenu: function (e) { e.preventDefault(); docMenu(e, doc); },
        onDragstart: function (e) { e.dataTransfer.setData('text/plain', doc.path); e.dataTransfer.effectAllowed = 'move'; }
      }, [
        UI.icon('file'), label,
        el('span', { class: 'tree-actions' }, [
          UI.iconButton('more', { small: true, title: ctx.t('common.rename'), onClick: function (e) { e.stopPropagation(); docMenu(e, doc); } })
        ])
      ]);
      item.addEventListener('dragover', function (e) {
        if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
      });
      item.addEventListener('drop', function (e) {
        if (!hasFiles(e)) return;
        handleFilesDrop(e, dirname(doc.path));
      });
      return item;
    }

    function assetNode(asset) {
      var name = basename(asset.path);
      var image = /^image\//.test(asset.mime || '') || /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(name);
      var item = el('div', {
        class: 'tree-item asset-item',
        dataset: { path: asset.path, type: 'asset' },
        onClick: function () { ctx.previewAsset(asset.path); },
        onContextmenu: function (e) { e.preventDefault(); assetMenu(e, asset); }
      }, [
        UI.icon(image ? 'image' : 'file'),
        el('span', { class: 'tree-label', text: name }),
        el('span', { class: 'tree-actions' }, [
          UI.iconButton('more', { small: true, title: ctx.t('explorer.previewAsset'), onClick: function (e) { e.stopPropagation(); assetMenu(e, asset); } })
        ])
      ]);
      item.addEventListener('dragover', function (e) {
        if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
      });
      item.addEventListener('drop', function (e) {
        if (!hasFiles(e)) return;
        handleFilesDrop(e, dirname(asset.path));
      });
      return item;
    }

    function folderMenu(e, node) {
      UI.menu([
        { label: ctx.t('explorer.newDoc'), iconName: 'filePlus', i18n: 'explorer.newDoc', onSelect: function () { ctx.createDoc(node.path); } },
        { label: ctx.t('explorer.newFolder'), iconName: 'folderPlus', i18n: 'explorer.newFolder', onSelect: function () { ctx.createFolder(node.path); } },
        { label: ctx.t('explorer.renameFolder'), iconName: 'edit', i18n: 'explorer.renameFolder', onSelect: function () { ctx.renameFolder(node.path); } },
        { separator: true },
        { label: ctx.t('explorer.exportFolder'), iconName: 'download', i18n: 'explorer.exportFolder', onSelect: function () { ctx.exportFolder(node.path); } },
        { label: ctx.t('explorer.importFolder'), iconName: 'upload', i18n: 'explorer.importFolder', onSelect: function () { ctx.importFolder(node.path); } },
        { separator: true },
        { label: ctx.t('explorer.deleteFolder'), iconName: 'trash', danger: true, i18n: 'explorer.deleteFolder', onSelect: function () { ctx.deleteFolder(node.path); } }
      ], e.clientX, e.clientY);
    }

    function docMenu(e, doc) {
      UI.menu([
        { label: ctx.t('editor.rename'), iconName: 'edit', i18n: 'editor.rename', onSelect: function () { ctx.renameDoc(doc.path); } },
        { label: ctx.t('explorer.move'), iconName: 'folder', i18n: 'explorer.move', onSelect: function () { ctx.moveDocPrompt(doc.path); } },
        { label: ctx.t('editor.history'), iconName: 'history', i18n: 'editor.history', onSelect: function () { ctx.showHistory(doc.path); } },
        { label: ctx.t('explorer.downloadDoc'), iconName: 'download', i18n: 'explorer.downloadDoc', onSelect: function () { ctx.downloadDoc(doc.path); } },
        { separator: true },
        { label: ctx.t('explorer.delete'), iconName: 'trash', danger: true, i18n: 'explorer.delete', onSelect: function () { ctx.deleteDoc(doc.path); } }
      ], e.clientX, e.clientY);
    }

    function assetMenu(e, asset) {
      UI.menu([
        { label: ctx.t('explorer.previewAsset'), iconName: 'eye', i18n: 'explorer.previewAsset', onSelect: function () { ctx.previewAsset(asset.path); } },
        { label: ctx.t('explorer.downloadAsset'), iconName: 'download', i18n: 'explorer.downloadAsset', onSelect: function () { ctx.downloadAsset(asset.path); } },
        { label: ctx.t('explorer.deleteAsset'), iconName: 'trash', danger: true, i18n: 'explorer.deleteAsset', onSelect: function () { ctx.deleteAsset(asset.path); } }
      ], e.clientX, e.clientY);
    }

    function refresh() {
      // 重建目录树会替换 DOM，先记住滚动位置和文件夹展开状态，刷新后原样恢复
      var scroller = treeHost.parentElement;
      var scrollTop = scroller ? scroller.scrollTop : 0;
      var collapsed = {};
      Array.prototype.forEach.call(treeHost.querySelectorAll('.tree-item[data-type="folder"]'), function (item) {
        var children = item.nextElementSibling;
        if (children && children.classList.contains('tree-children') && children.hidden) {
          collapsed[item.getAttribute('data-path')] = true;
        }
      });
      renderTree();
      Array.prototype.forEach.call(treeHost.querySelectorAll('.tree-item[data-type="folder"]'), function (item) {
        if (!collapsed[item.getAttribute('data-path')]) return;
        var children = item.nextElementSibling;
        if (children && children.classList.contains('tree-children')) children.hidden = true;
        var toggle = item.querySelector('.tree-toggle');
        if (toggle) toggle.textContent = '▸';
      });
      if (scroller) scroller.scrollTop = scrollTop;
    }
    refresh();

    return {
      root: root,
      refresh: refresh,
      focusSearch: function () { searchInput.focus(); },
      setQuery: function (value) { state.query = String(value || '').toLowerCase(); searchInput.value = value || ''; renderTree(); }
    };
  }

  Features.Explorer = { create: create };
})(window);
