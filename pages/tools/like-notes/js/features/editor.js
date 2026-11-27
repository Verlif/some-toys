/* 编辑器：多标签内容、Markdown 工具栏、分栏预览、大纲与冲突处理 */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var Features = App.Features = App.Features || {};
  var UI = App.UI;
  var el = UI.el;

  function create(ctx, mounts) {
    var active = null;
    var mobileQuery = window.matchMedia ? window.matchMedia('(max-width: 820px)') : null;
    var mode = ctx.settings.defaultMode || 'split';
    // 窄屏只能用源码或预览；分栏偏好保留在设置里，回到宽屏再恢复
    if (mobileQuery && mobileQuery.matches && mode === 'split') mode = 'source';
    var assetCache = {};

    var titleInput = el('input', {
      class: 'doc-title-input', placeholder: ctx.t('editor.titlePlaceholder'),
      onInput: function () { ctx.onEditorInput(); }
    });
    titleInput.setAttribute('data-i18n-placeholder', 'editor.titlePlaceholder');
    var tags = [];
    var tagChips = el('span', { class: 'tag-chips' });
    var tagSuggestions = el('div', { class: 'tag-suggest-list', hidden: true });
    var tagsInput = el('input', {
      type: 'text', class: 'doc-tags-input', placeholder: ctx.t('editor.tagsPlaceholder'),
      onInput: function () { renderTagSuggestions(); ctx.onEditorInput(); },
      onFocus: function () { renderTagSuggestions(); },
      onBlur: function () { setTimeout(hideTagSuggestions, 120); },
      onKeydown: function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          addTag(tagsInput.value);
          tagsInput.value = '';
          hideTagSuggestions();
          ctx.onEditorInput();
        } else if (e.key === ',' || e.key === '，') {
          e.preventDefault(); // 不再让用户用逗号手工分隔标签
        } else if (e.key === 'Backspace' && !tagsInput.value && tags.length) {
          removeTag(tags.length - 1);
          ctx.onEditorInput();
        }
      },
      onPaste: function (e) {
        var raw = e.clipboardData && e.clipboardData.getData('text');
        if (!raw) return;
        e.preventDefault();
        tagsInput.value += String(raw).replace(/[,，]/g, '');
        renderTagSuggestions();
        ctx.onEditorInput();
      }
    });
    tagsInput.setAttribute('data-i18n-placeholder', 'editor.tagsPlaceholder');
    var tagsWrap = el('div', { class: 'doc-tags-wrap' }, [tagChips, tagsInput, tagSuggestions]);

    function allTags() {
      var found = {};
      var docs = (ctx.store && ctx.store.docs) || {};
      Object.keys(docs).forEach(function (path) {
        (docs[path].tags || []).forEach(function (tag) { found[tag] = true; });
      });
      return Object.keys(found).sort();
    }

    function renderTagChips() {
      tagChips.innerHTML = '';
      tags.forEach(function (tag, index) {
        var remove = withI18n(UI.iconButton('close', {
          small: true, title: ctx.t('common.delete'), onClick: function () {
            removeTag(index);
            ctx.onEditorInput();
          }
        }), 'common.delete');
        tagChips.appendChild(el('span', { class: 'tag-chip' }, [el('span', { text: tag }), remove]));
      });
    }

    function addTag(raw) {
      var tag = String(raw || '').replace(/^#/, '').replace(/[,，]/g, '').trim();
      if (!tag || tags.indexOf(tag) >= 0) return;
      tags.push(tag);
      renderTagChips();
    }

    function removeTag(index) {
      tags.splice(index, 1);
      renderTagChips();
    }

    function setTags(list) {
      tags = (list || []).slice();
      renderTagChips();
      hideTagSuggestions();
    }

    function renderTagSuggestions() {
      var query = tagsInput.value.trim().toLowerCase();
      var matches = allTags().filter(function (tag) {
        return tags.indexOf(tag) < 0 && tag.toLowerCase().indexOf(query) >= 0;
      }).slice(0, 8);
      tagSuggestions.innerHTML = '';
      if (!matches.length) { tagSuggestions.hidden = true; return; }
      matches.forEach(function (tag) {
        tagSuggestions.appendChild(el('button', {
          type: 'button', class: 'tag-suggest', onMousedown: function (e) {
            e.preventDefault();
            addTag(tag);
            tagsInput.value = '';
            hideTagSuggestions();
            ctx.onEditorInput();
          }
        }, [UI.icon('tag'), el('span', { text: tag })]));
      });
      tagSuggestions.hidden = false;
    }

    function hideTagSuggestions() { tagSuggestions.hidden = true; }

    var conflictText = el('span', {});
    var conflictBar = el('div', { class: 'conflict-bar', hidden: true }, [
      UI.icon('info'), conflictText,
      el('span', { style: { flex: '1' } }),
      withI18n(UI.button({ label: ctx.t('editor.useRemote'), small: true, onClick: function () { ctx.resolveConflict('remote'); } }), 'editor.useRemote'),
      withI18n(UI.button({ label: ctx.t('editor.keepLocal'), small: true, variant: 'primary', onClick: function () { ctx.resolveConflict('local'); } }), 'editor.keepLocal')
    ]);

    var lineNumbers = el('div', { class: 'line-numbers' });
    var textarea = el('textarea', {
      spellcheck: false, placeholder: ctx.t('editor.placeholder'),
      onInput: function () { ctx.onEditorInput(); updateLineNumbers(); renderPreview(); },
      onKeydown: function (e) {
        if (e.key === 'Tab') {
          e.preventDefault();
          insertText(' '.repeat(ctx.settings.tabSize || 2));
          return;
        }
        if (ctx.settings.autoCloseBrackets) {
          var pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
          if (Object.prototype.hasOwnProperty.call(pairs, e.key)) {
            e.preventDefault();
            var start = textarea.selectionStart;
            var end = textarea.selectionEnd;
            var selected = textarea.value.slice(start, end);
            insertText(e.key + selected + pairs[e.key], e.key.length, e.key.length + selected.length);
          }
        }
      },
      onPaste: function (e) { if (ctx.images) ctx.images.handlePaste(e); },
      onDrop: function (e) { if (ctx.images) ctx.images.handleDrop(e); },
      onScroll: function () { syncScroll(); lineNumbers.scrollTop = textarea.scrollTop; }
    });
    textarea.setAttribute('data-i18n-placeholder', 'editor.placeholder');
    var preview = el('div', { class: 'markdown-body' });
    var panes = el('div', { class: 'panes' }, [
      el('div', { class: 'pane pane-source' }, [
        el('div', { class: 'pane-header' }, [
          UI.icon('code'), withI18n(el('span', { text: ctx.t('editor.edit') }), 'editor.edit')
        ]),
        el('div', { class: 'pane-body' }, [lineNumbers, textarea])
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
      el('div', { class: 'doc-subrow' }, [tagsWrap])
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
    tagsWrap.hidden = true;
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
    // 初始模式必须同步到 .panes 样式类；须等大纲节点就绪，否则 setMode 内的 renderPreview 会访问未初始化的变量
    setMode(mode);

    function withI18n(node, key) {
      node.setAttribute('data-i18n-title', key);
      return node;
    }
    function buildToolbar() {
      var bar = el('div', { class: 'toolbar' });
      // 分组：行内格式 / 插入与块级结构，右侧文档操作由 .editor-actions 承载
      var groups = [
        [
          ['heading', 'editor.toolbar.heading', function () { prefixLine('## '); }],
          ['bold', 'editor.toolbar.bold', function () { wrap('**', '**', 'bold text'); }],
          ['italic', 'editor.toolbar.italic', function () { wrap('*', '*', 'italic text'); }],
          ['code', 'editor.toolbar.code', function () { wrap('`', '`', 'code'); }],
          ['link', 'editor.toolbar.link', function () { wrap('[', '](https://)', 'link text'); }],
          ['imagePlus', 'editor.toolbar.image', function () { if (ctx.images) ctx.images.pickFile(); }]
        ],
        [
          ['quote', 'editor.toolbar.quote', function () { prefixLine('> '); }],
          ['list', 'editor.toolbar.ul', function () { prefixLine('- '); }],
          ['listOrdered', 'editor.toolbar.ol', function () { prefixLine('1. '); }],
          ['task', 'editor.toolbar.task', function () { prefixLine('- [ ] '); }],
          ['table', 'editor.toolbar.table', function () { insertText('| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |'); }],
          ['codeBlock', 'editor.toolbar.codeblock', function () { insertText('```js\n\n```'); }],
          ['minus', 'editor.toolbar.hr', function () { insertText('\n---\n'); }]
        ]
      ];
      groups.forEach(function (group) {
        var box = el('div', { class: 'toolbar-group' });
        group.forEach(function (item) {
          var btn = UI.iconButton(item[0], {
            title: ctx.t(item[1]),
            onClick: function () { if (!active) return; item[2](); textarea.focus(); ctx.onEditorInput(); renderPreview(); }
          });
          btn.setAttribute('data-i18n-title', item[1]);
          box.appendChild(btn);
        });
        bar.appendChild(box);
      });
      return bar;
    }

    function updateLineNumbers() {
      var count = textarea.value.split('\n').length;
      var text = '';
      for (var i = 1; i <= count; i++) text += i + '\n';
      lineNumbers.textContent = text;
    }

    function setMode(value) {
      // 窄屏不允许分栏：即使设置里存的是 split，也只落到源码
      if (mobileQuery && mobileQuery.matches && value === 'split') value = 'source';
      mode = value;
      panes.classList.toggle('source-only', value === 'source');
      panes.classList.toggle('preview-only', value === 'preview');
      Array.prototype.forEach.call(modeSwitch.querySelectorAll('.seg'), function (node) {
        node.classList.toggle('active', node.dataset.value === value);
      });
      if (value !== 'source') renderPreview();
    }

    function open(doc) {
      active = doc;
      root.querySelector('.empty')?.remove?.();
      header.hidden = false;
      titleInput.hidden = false;
      tagsWrap.hidden = false;
      toolbar.hidden = false;
      panes.hidden = false;
      titleInput.value = doc.title || '';
      setTags(doc.tags || []);
      textarea.value = doc.body || '';
      updateLineNumbers();
      lineNumbers.scrollTop = 0;
      setConflict(doc);
      updateDirty();
      renderPreview();
    }

    function clear() {
      active = null;
      header.hidden = true;
      titleInput.hidden = true;
      tagsWrap.hidden = true;
        toolbar.hidden = true;
      panes.hidden = true;
      conflictBar.hidden = true;
      outlineList.innerHTML = '';
      outlineEmpty.hidden = false;
      if (!root.querySelector('.empty')) {
        root.insertBefore(UI.empty('file', ctx.t('editor.untitled')), header);
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
      // 保存状态统一由文件树/标签页的状态点表达，编辑器内不再显示单独徽标
    }

    function getDraft() {
      return {
        title: titleInput.value.trim() || ctx.t('editor.untitled'),
        tags: tags.slice(),
        body: textarea.value
      };
    }

    function insertText(text, startOffset, endOffset) {
      var start = textarea.selectionStart;
      var end = textarea.selectionEnd;
      textarea.setRangeText(text, start, end, 'end');
      if (startOffset !== undefined) textarea.selectionStart = start + startOffset;
      if (endOffset !== undefined) textarea.selectionEnd = start + endOffset;
      updateLineNumbers();
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
      updateLineNumbers();
      textarea.focus();
    }

    function syncScroll() {
      if (mode !== 'split' || ctx.settings.previewSyncScroll === false) return;
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
