/* 编辑器：多标签内容、Markdown 工具栏、分栏预览、大纲与冲突处理 */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var Features = App.Features = App.Features || {};
  var UI = App.UI;
  var el = UI.el;

  function create(ctx, mounts) {
    var active = null;
    var mode = ctx.settings.defaultMode || 'split';
    var assetCache = {};

    var titleInput = el('input', {
      class: 'doc-title-input', placeholder: ctx.t('editor.titlePlaceholder'),
      onInput: function () { ctx.onEditorInput(); }
    });
    titleInput.setAttribute('data-i18n-placeholder', 'editor.titlePlaceholder');
    var tagsInput = el('input', {
      class: 'doc-tags-input', placeholder: ctx.t('editor.tagsPlaceholder'),
      onInput: function () { ctx.onEditorInput(); }
    });
    tagsInput.setAttribute('data-i18n-placeholder', 'editor.tagsPlaceholder');
    var pathLabel = el('span', { class: 'doc-path' });
    var dirtyBadge = UI.badge('●', 'warn');
    dirtyBadge.hidden = true;

    var conflictText = el('span', {});
    var conflictBar = el('div', { class: 'conflict-bar', hidden: true }, [
      UI.icon('info'), conflictText,
      el('span', { style: { flex: '1' } }),
      withI18n(UI.button({ label: ctx.t('editor.useRemote'), small: true, onClick: function () { ctx.resolveConflict('remote'); } }), 'editor.useRemote'),
      withI18n(UI.button({ label: ctx.t('editor.keepLocal'), small: true, variant: 'primary', onClick: function () { ctx.resolveConflict('local'); } }), 'editor.keepLocal')
    ]);

    var textarea = el('textarea', {
      spellcheck: false, placeholder: ctx.t('editor.placeholder'),
      onInput: function () { ctx.onEditorInput(); renderPreview(); },
      onKeydown: function (e) {
        if (e.key === 'Tab') {
          e.preventDefault();
          insertText(' '.repeat(ctx.settings.tabSize || 2));
        }
      },
      onPaste: function (e) { if (ctx.images) ctx.images.handlePaste(e); },
      onDrop: function (e) { if (ctx.images) ctx.images.handleDrop(e); },
      onScroll: syncScroll
    });
    textarea.setAttribute('data-i18n-placeholder', 'editor.placeholder');
    var preview = el('div', { class: 'markdown-body' });
    var panes = el('div', { class: 'panes' }, [
      el('div', { class: 'pane pane-source' }, [
        el('div', { class: 'pane-header' }, [
          UI.icon('code'), withI18n(el('span', { text: ctx.t('editor.edit') }), 'editor.edit')
        ]),
        textarea
      ]),
      el('div', { class: 'pane pane-preview' }, [
        el('div', { class: 'pane-header' }, [
          UI.icon('eye'), withI18n(el('span', { text: ctx.t('editor.preview') }), 'editor.preview')
        ]),
        preview
      ])
    ]);

    var titleBlock = el('div', { class: 'doc-title-block' }, [
      titleInput,
      el('div', { class: 'doc-subrow' }, [tagsInput, pathLabel])
    ]);
    var modeSwitch = UI.segmented([
      { value: 'source', label: ctx.t('settings.editor.source'), i18n: 'settings.editor.source', icon: 'code' },
      { value: 'split', label: ctx.t('settings.editor.split'), i18n: 'settings.editor.split', icon: 'columns' },
      { value: 'preview', label: ctx.t('settings.editor.preview'), i18n: 'settings.editor.preview', icon: 'eye' }
    ], mode, function (value) { setMode(value); ctx.setSetting('defaultMode', value); });
    var header = el('div', { class: 'doc-header editor-head-row' }, [
      titleBlock,
      el('div', { class: 'editor-view-switch' }, [modeSwitch])
    ]);

    var toolbar = el('div', { class: 'editor-toolbar' });
    toolbar.appendChild(buildToolbar());
    toolbar.appendChild(el('div', { class: 'editor-actions' }, [
      withI18n(UI.iconButton('save', { title: ctx.t('editor.saveLocal'), onClick: function () { ctx.saveActive(); } }), 'editor.saveLocal'),
      withI18n(UI.iconButton('history', { title: ctx.t('editor.history'), onClick: function () { if (active) ctx.showHistory(active.path); } }), 'editor.history'),
      withI18n(UI.iconButton('edit', { title: ctx.t('editor.rename'), onClick: function () { if (active) ctx.renameDoc(active.path); } }), 'editor.rename'),
      withI18n(UI.iconButton('trash', { title: ctx.t('editor.delete'), onClick: function () { if (active) ctx.deleteDoc(active.path); } }), 'editor.delete')
    ]));

    var empty = UI.empty('file', ctx.t('editor.untitled'), UI.button({
      label: ctx.t('explorer.newDoc'), variant: 'primary', onClick: function () { ctx.createDoc(''); }
    }));
    var root = el('div', { class: 'editor-shell' }, [empty, header, conflictBar, toolbar, panes]);
    header.hidden = true;
    root.querySelector('.doc-title-input').hidden = true;
    root.querySelector('.doc-tags-input').hidden = true;
    pathLabel.hidden = true;
    conflictBar.hidden = true;
    toolbar.hidden = true;
    panes.hidden = true;
    mounts.editor.innerHTML = '';
    mounts.editor.appendChild(root);

    var outlineTitle = el('div', { class: 'outline-header', text: ctx.t('outline.title') });
    outlineTitle.setAttribute('data-i18n', 'outline.title');
    var outlineList = el('div', { class: 'outline-list' });
    var outlineEmpty = el('div', { class: 'side-empty', text: ctx.t('outline.empty') });
    outlineEmpty.setAttribute('data-i18n', 'outline.empty');
    mounts.outline.classList.add('outline');
    mounts.outline.innerHTML = '';
    mounts.outline.appendChild(outlineTitle);
    mounts.outline.appendChild(outlineList);
    mounts.outline.appendChild(outlineEmpty);

    function withI18n(node, key) {
      node.setAttribute('data-i18n-title', key);
      return node;
    }
    function buildToolbar() {
      var bar = el('div', { class: 'toolbar' });
      var items = [
        ['heading', 'editor.toolbar.heading', function () { prefixLine('## '); }],
        ['bold', 'editor.toolbar.bold', function () { wrap('**', '**', 'bold text'); }],
        ['italic', 'editor.toolbar.italic', function () { wrap('*', '*', 'italic text'); }],
        ['code', 'editor.toolbar.code', function () { wrap('`', '`', 'code'); }],
        ['link', 'editor.toolbar.link', function () { wrap('[', '](https://)', 'link text'); }],
        ['imagePlus', 'editor.toolbar.image', function () { if (ctx.images) ctx.images.pickFile(); }],
        '-',
        ['quote', 'editor.toolbar.quote', function () { prefixLine('> '); }],
        ['list', 'editor.toolbar.ul', function () { prefixLine('- '); }],
        ['list', 'editor.toolbar.ol', function () { prefixLine('1. '); }],
        ['check', 'editor.toolbar.task', function () { prefixLine('- [ ] '); }],
        ['table', 'editor.toolbar.table', function () { insertText('| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |'); }],
        ['code', 'editor.toolbar.codeblock', function () { insertText('```js\n\n```'); }],
        ['minus', 'editor.toolbar.hr', function () { insertText('\n---\n'); }]
      ];
      items.forEach(function (item) {
        if (item === '-') { bar.appendChild(el('span', { class: 'tool-sep' })); return; }
        var btn = UI.iconButton(item[0], {
          title: ctx.t(item[1]),
          onClick: function () { if (!active) return; item[2](); textarea.focus(); ctx.onEditorInput(); renderPreview(); }
        });
        btn.setAttribute('data-i18n-title', item[1]);
        bar.appendChild(btn);
      });
      return bar;
    }

    function setMode(value) {
      mode = value;
      panes.classList.toggle('source-only', value === 'source');
      panes.classList.toggle('preview-only', value === 'preview');
      Array.prototype.forEach.call(modeSwitch.querySelectorAll('.seg'), function (node, index) {
        node.classList.toggle('active', ['source', 'split', 'preview'][index] === value);
      });
      if (value !== 'source') renderPreview();
    }

    function open(doc) {
      active = doc;
      root.querySelector('.empty')?.remove?.();
      header.hidden = false;
      titleInput.hidden = false;
      tagsInput.hidden = false;
      pathLabel.hidden = false;
      toolbar.hidden = false;
      panes.hidden = false;
      titleInput.value = doc.title || '';
      tagsInput.value = (doc.tags || []).join(', ');
      textarea.value = doc.body || '';
      pathLabel.textContent = doc.path || '';
      setConflict(doc);
      updateDirty();
      renderPreview();
    }

    function clear() {
      active = null;
      header.hidden = true;
      titleInput.hidden = true;
      tagsInput.hidden = true;
      pathLabel.hidden = true;
      toolbar.hidden = true;
      panes.hidden = true;
      conflictBar.hidden = true;
      outlineList.innerHTML = '';
      outlineEmpty.hidden = false;
      if (!root.querySelector('.empty')) {
        root.insertBefore(UI.empty('file', ctx.t('editor.untitled')), titleInput);
      }
    }

    function setConflict(doc) {
      var conflict = !!(doc && doc.conflict);
      conflictBar.hidden = !conflict;
      if (conflict) {
        var remote = doc.remote || {};
        conflictText.textContent = remote.deleted
          ? ctx.t('log.conflictRemoteDeleted', { path: doc.path })
          : (remote.message || ctx.t('editor.conflict') + ': ' + doc.path);
      }
    }

    function updateDirty() {
      dirtyBadge.hidden = !(active && ((ctx.isDirty && ctx.isDirty(active.path)) || ctx.store.pending[active.path]));
    }

    function getDraft() {
      return {
        title: titleInput.value.trim() || ctx.t('editor.untitled'),
        tags: tagsInput.value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean),
        body: textarea.value
      };
    }

    function insertText(text, startOffset, endOffset) {
      var start = textarea.selectionStart;
      var end = textarea.selectionEnd;
      textarea.setRangeText(text, start, end, 'end');
      if (startOffset !== undefined) textarea.selectionStart = start + startOffset;
      if (endOffset !== undefined) textarea.selectionEnd = start + endOffset;
      textarea.focus();
    }

    function wrap(before, after, placeholder) {
      var start = textarea.selectionStart;
      var end = textarea.selectionEnd;
      var selected = textarea.value.slice(start, end) || placeholder;
      insertText(before + selected + after, before.length, before.length + selected.length);
    }

    function prefixLine(prefix) {
      var start = textarea.selectionStart;
      var lineStart = textarea.value.lastIndexOf('\n', start - 1) + 1;
      textarea.setRangeText(prefix, lineStart, lineStart, 'end');
      textarea.focus();
    }

    function syncScroll() {
      if (mode !== 'split') return;
      var max = textarea.scrollHeight - textarea.clientHeight;
      if (max <= 0) return;
      var ratio = textarea.scrollTop / max;
      preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight);
    }

    function renderPreview() {
      if (!active || mode === 'source') { outlineList.innerHTML = ''; outlineEmpty.hidden = false; return; }
      var result = Markdown.render(textarea.value);
      preview.innerHTML = result.html || '<p class="muted">' + ctx.t('editor.placeholder') + '</p>';
      hydrateImages();
      renderOutline(result.toc);
    }

    function resolveAsset(src) {
      var value = String(src || '');
      while (value.indexOf('../') === 0) value = value.slice(3);
      if (value.indexOf('./') === 0) value = value.slice(2);
      return value;
    }

    function hydrateImages() {
      Array.prototype.forEach.call(preview.querySelectorAll('img'), function (img) {
        var src = img.getAttribute('src') || '';
        if (!/(^|\/)assets\//.test(src) && src.indexOf('../') !== 0) return;
        var path = resolveAsset(src);
        if (assetCache[path] !== undefined) {
          if (assetCache[path]) img.src = assetCache[path];
          return;
        }
        assetCache[path] = null;
        ctx.getAssetDataUrl(path).then(function (url) {
          assetCache[path] = url;
          if (url) img.src = url;
        });
      });
    }

    function renderOutline(toc) {
      outlineList.innerHTML = '';
      outlineEmpty.hidden = toc.length > 0;
      toc.forEach(function (item) {
        var node = el('button', {
          type: 'button', class: 'outline-item lv' + Math.min(item.level, 6), text: item.text,
          onClick: function () {
            var target = preview.querySelector('[id="' + item.id + '"]');
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
        outlineList.appendChild(node);
      });
    }

    function clearAssetCache() { assetCache = {}; }

    return {
      root: root,
      open: open,
      clear: clear,
      getDraft: getDraft,
      setMode: setMode,
      mode: function () { return mode; },
      insertText: insertText,
      focus: function () { textarea.focus(); },
      renderPreview: renderPreview,
      setConflict: setConflict,
      updateDirty: updateDirty,
      clearAssetCache: clearAssetCache,
      textarea: textarea,
      titleInput: titleInput,
      tagsInput: tagsInput
    };
  }

  Features.Editor = { create: create };
})(window);
