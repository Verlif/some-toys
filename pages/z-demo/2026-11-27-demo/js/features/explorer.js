/* 文件资源管理器：目录树、标签筛选、搜索、拖拽移动与右键菜单 */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var Features = App.Features = App.Features || {};
  var UI = App.UI;
  var el = UI.el;

  function create(ctx, mount) {
    var state = { query: '', tag: '' };
    var searchInput = UI.input({
      placeholder: ctx.t('explorer.searchPlaceholder'),
      onInput: function (e) { state.query = e.target.value.trim().toLowerCase(); renderTree(); }
    });
    searchInput.setAttribute('data-i18n-placeholder', 'explorer.searchPlaceholder');
    var tagRow = el('div', { class: 'tag-filter' });
    var treeHost = el('div', { class: 'tree' });
    var heading = el('h2', { text: ctx.t('explorer.title') });
    heading.setAttribute('data-i18n', 'explorer.title');
    var header = el('div', { class: 'sidebar-header' }, [
      el('div', { class: 'sidebar-heading' }, [
        heading,
        el('div', { class: 'sidebar-tools' }, [
          withI18n(UI.iconButton('filePlus', { small: true, title: ctx.t('explorer.newDoc'), onClick: function () { ctx.createDoc(currentFolder()); } }), 'explorer.newDoc'),
          withI18n(UI.iconButton('folderPlus', { small: true, title: ctx.t('explorer.newFolder'), onClick: function () { ctx.createFolder(currentFolder()); } }), 'explorer.newFolder'),
          withI18n(UI.iconButton('refresh', { small: true, title: ctx.t('header.sync'), onClick: function () { ctx.syncNow(); } }), 'header.sync')
        ])
      ]),
      el('div', { class: 'sidebar-search' }, [UI.icon('search'), searchInput])
    ]);
    var root = el('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' } }, [
      header,
      tagRow,
      el('div', { class: 'sidebar-scroll' }, [treeHost])
    ]);
    mount.innerHTML = '';
    mount.appendChild(root);

    function withI18n(node, key) {
      node.setAttribute('data-i18n-title', key);
      return node;
    }

    function currentFolder() {
      var doc = ctx.activeDoc && ctx.activeDoc();
      return doc ? dirname(doc.path) : '';
    }

    function dirname(path) {
      var i = String(path).lastIndexOf('/');
      return i < 0 ? '' : path.slice(0, i);
    }

    function basename(path) {
      return String(path).split('/').pop().replace(/\.md$/i, '');
    }

    function renderTags() {
      var tags = {};
      ctx.store.list().forEach(function (doc) {
        (doc.tags || []).forEach(function (tag) { tags[tag] = (tags[tag] || 0) + 1; });
      });
      tagRow.innerHTML = '';
      var all = el('span', {
        class: 'chip' + (!state.tag ? ' active' : ''),
        text: ctx.t('explorer.allDocs'),
        onClick: function () { state.tag = ''; renderTree(); renderTags(); }
      });
      all.setAttribute('data-i18n', 'explorer.allDocs');
      tagRow.appendChild(all);
      Object.keys(tags).sort().forEach(function (tag) {
        var chip = el('span', {
          class: 'chip' + (state.tag === tag ? ' active' : ''),
          text: tag + ' (' + tags[tag] + ')',
          onClick: function () { state.tag = state.tag === tag ? '' : tag; renderTree(); renderTags(); }
        });
        tagRow.appendChild(chip);
      });
    }

    function matches(doc) {
      if (state.tag && (doc.tags || []).indexOf(state.tag) < 0) return false;
      if (!state.query) return true;
      var hay = [doc.title, doc.path, (doc.tags || []).join(' '), doc.body || ''].join(' ').toLowerCase();
      return hay.indexOf(state.query) >= 0;
    }

    function buildTree() {
      var docs = ctx.store.list().filter(matches);
      var folderSet = {};
      (ctx.folders || []).forEach(function (path) { folderSet[path] = true; });
      docs.forEach(function (doc) {
        var parts = String(doc.path).split('/');
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
      return rootNode;
    }

    function renderTree() {
      treeHost.innerHTML = '';
      var docs = ctx.store.list().filter(matches);
      if (!docs.length) {
        treeHost.appendChild(UI.empty('search', state.query || state.tag ? ctx.t('explorer.noMatch') : ctx.t('explorer.empty')));
        return;
      }
      if (state.query || state.tag) {
        docs.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
        docs.forEach(function (doc) { treeHost.appendChild(docNode(doc)); });
        return;
      }
      renderFolder(buildTree(), treeHost, true);
    }

    function renderFolder(node, host, isRoot) {
      Object.keys(node.children).sort().forEach(function (name) {
        host.appendChild(folderNode(node.children[name]));
      });
      node.files.slice().sort(function (a, b) { return a.path.localeCompare(b.path); }).forEach(function (doc) {
        host.appendChild(docNode(doc));
      });
    }

    function folderNode(node) {
      var children = el('div', { class: 'tree-children' });
      var toggle = el('span', { class: 'tree-toggle', text: '▾' });
      var item = el('div', { class: 'tree-item', dataset: { path: node.path, type: 'folder' } }, [
        toggle, UI.icon('folder'), el('span', { class: 'tree-label', text: node.name }),
        el('span', { class: 'tree-meta', text: countFiles(node) || '' }),
        el('span', { class: 'tree-actions' }, [
          UI.iconButton('filePlus', { small: true, title: ctx.t('explorer.newDoc'), onClick: function (e) { e.stopPropagation(); ctx.createDoc(node.path); } }),
          UI.iconButton('more', { small: true, title: ctx.t('common.rename'), onClick: function (e) { e.stopPropagation(); folderMenu(e, node); } })
        ])
      ]);
      item.addEventListener('click', function () {
        children.hidden = !children.hidden;
        toggle.textContent = children.hidden ? '▸' : '▾';
      });
      item.addEventListener('contextmenu', function (e) { e.preventDefault(); folderMenu(e, node); });
      item.addEventListener('dragover', function (e) { e.preventDefault(); item.classList.add('drop-target'); });
      item.addEventListener('dragleave', function () { item.classList.remove('drop-target'); });
      item.addEventListener('drop', function (e) {
        e.preventDefault();
        item.classList.remove('drop-target');
        var path = e.dataTransfer.getData('text/plain');
        if (path && path.indexOf(node.path + '/') !== 0) ctx.moveDoc(path, node.path + '/' + path.split('/').pop());
      });
      renderFolder(node, children, false);
      return el('div', {}, [item, children]);
    }

    function countFiles(node) {
      var n = node.files.length;
      Object.keys(node.children).forEach(function (key) { n += countFiles(node.children[key]); });
      return n ? String(n) : '';
    }

    function docNode(doc) {
      var dirty = !!ctx.store.pending[doc.path] || !!(ctx.isDirty && ctx.isDirty(doc.path));
      var label = el('span', { class: 'tree-label', text: doc.title || basename(doc.path) });
      if (dirty) label.appendChild(el('span', { class: 'doc-tab-dirty', style: { marginLeft: '6px', display: 'inline-block' } }));
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
      return item;
    }

    function folderMenu(e, node) {
      UI.menu([
        { label: ctx.t('explorer.newDoc'), iconName: 'filePlus', i18n: 'explorer.newDoc', onSelect: function () { ctx.createDoc(node.path); } },
        { label: ctx.t('explorer.newFolder'), iconName: 'folderPlus', i18n: 'explorer.newFolder', onSelect: function () { ctx.createFolder(node.path); } },
        { label: ctx.t('explorer.renameFolder'), iconName: 'edit', i18n: 'explorer.renameFolder', onSelect: function () { ctx.renameFolder(node.path); } },
        { separator: true },
        { label: ctx.t('explorer.deleteFolder'), iconName: 'trash', danger: true, i18n: 'explorer.deleteFolder', onSelect: function () { ctx.deleteFolder(node.path); } }
      ], e.clientX, e.clientY);
    }

    function docMenu(e, doc) {
      UI.menu([
        { label: ctx.t('editor.rename'), iconName: 'edit', i18n: 'editor.rename', onSelect: function () { ctx.renameDoc(doc.path); } },
        { label: ctx.t('explorer.move'), iconName: 'folder', i18n: 'explorer.move', onSelect: function () { ctx.moveDocPrompt(doc.path); } },
        { label: ctx.t('editor.history'), iconName: 'history', i18n: 'editor.history', onSelect: function () { ctx.showHistory(doc.path); } },
        { separator: true },
        { label: ctx.t('explorer.delete'), iconName: 'trash', danger: true, i18n: 'explorer.delete', onSelect: function () { ctx.deleteDoc(doc.path); } }
      ], e.clientX, e.clientY);
    }

    function refresh() { renderTags(); renderTree(); }
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
