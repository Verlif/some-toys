/* 设置中心：通用 / GitHub（含同步） / 编辑器 / 关于 */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var Features = App.Features = App.Features || {};
  var UI = App.UI;
  var el = UI.el, t;

  function create(ctx) {
    t = function (key, params) { return ctx.t(key, params); };
    var instance = { open: open };
    var currentTab = 'general';
    var dialog = null;
    var panels = {};
    var refs = {};
    var repoListNode = null;
    var branchListNode = null;
    // 设置面板当前选中的仓库；未点“绑定”前 ctx.binding 仍是旧值，分支列表与绑定按钮状态都以这里的为准
    var selectedOwner = '';
    var selectedRepo = '';

    function open() {
      currentTab = 'general';
      // 底部固定操作栏：左侧说明更改即时生效，右侧取消 / 完成
      var saveState = el('span', { class: 'settings-footer-state', text: t('settings.footer.saved') });
      saveState.setAttribute('data-i18n', 'settings.footer.saved');
      var cancelBtn = UI.button({ label: t('common.cancel'), onClick: function () { dialog.close(); } });
      cancelBtn.setAttribute('data-i18n', 'common.cancel');
      var doneBtn = UI.button({ label: t('common.confirm'), variant: 'primary', onClick: function () { dialog.close(); } });
      doneBtn.setAttribute('data-i18n', 'common.confirm');
      var footerActions = el('div', { class: 'settings-footer-actions' }, [cancelBtn, doneBtn]);
      dialog = UI.modal({
        title: t('settings.title'),
        wide: true,
        class: 'modal-settings',
        content: [buildTabs(), el('div', { class: 'tab-body', id: 'settings-panels' })],
        actions: [saveState, footerActions]
      });
      var host = dialog.body.querySelectorAll('.tab-body')[0];
      Object.keys(panels).forEach(function (key) { host.appendChild(panels[key]); });
      showTab('general');
    }

    function buildTabs() {
      var bar = el('div', { class: 'tabs' });
      var tabs = [
        { key: 'general', label: t('settings.tab.general'), i18n: 'settings.tab.general', icon: 'settings' },
        { key: 'github', label: t('settings.tab.github'), i18n: 'settings.tab.github', icon: 'github' },
        { key: 'editor', label: t('settings.tab.editor'), i18n: 'settings.tab.editor', icon: 'code' },
        { key: 'about', label: t('settings.tab.about'), i18n: 'settings.tab.about', icon: 'info' }
      ];
      tabs.forEach(function (tab) {
        // data-i18n 放在文本节点上：语言切换时不会清掉导航图标
        var label = el('span', { text: tab.label });
        label.setAttribute('data-i18n', tab.i18n);
        var node = el('button', {
          type: 'button', class: 'tab' + (tab.key === currentTab ? ' active' : ''),
          onClick: function () { showTab(tab.key); }
        }, [UI.icon(tab.icon), label]);
        bar.appendChild(node);
        panels[tab.key] = buildPanel(tab.key);
      });
      return bar;
    }

    function showTab(key) {
      currentTab = key;
      dialog.root.querySelectorAll('.tabs .tab').forEach(function (node, index) {
        node.classList.toggle('active', ['general', 'github', 'editor', 'about'][index] === key);
      });
      Object.keys(panels).forEach(function (k) { panels[k].hidden = k !== key; });
    }

    function buildPanel(key) {
      if (key === 'general') return generalPanel();
      if (key === 'github') return githubPanel();
      if (key === 'editor') return editorPanel();
      return aboutPanel();
    }

    function lab(text, i18n) {
      var node = el('span', { class: 'field-label', text: text });
      if (i18n) node.setAttribute('data-i18n', i18n);
      return node;
    }

    function section(i18nKey, children) {
      var title = el('div', { class: 'settings-section-title', text: t(i18nKey) });
      title.setAttribute('data-i18n', i18nKey);
      return el('section', { class: 'settings-section' }, [title].concat(children));
    }

    function generalPanel() {
      var locale = UI.select({
        value: ctx.locale(),
        options: ctx.locales().map(function (l) { return { value: l.code, label: l.label }; }),
        onChange: function (e) {
          ctx.setLocale(e.target.value);
          ctx.toast(t('toast.localeChanged'), 'ok');
        }
      });
      var theme = UI.segmented([
        { value: 'light', label: t('settings.general.theme.light'), i18n: 'settings.general.theme.light' },
        { value: 'dark', label: t('settings.general.theme.dark'), i18n: 'settings.general.theme.dark' }
      ], ctx.settings.theme, function (value) { ctx.setSetting('theme', value); });
      var autoSave = el('input', { type: 'checkbox', checked: !!ctx.settings.autoSave, onChange: function (e) { ctx.setSetting('autoSave', e.target.checked); } });
      var autoWrap = el('label', { class: 'checkbox' }, [autoSave, el('span', { text: t('settings.general.autoSave') })]);
      autoWrap.querySelector('span').setAttribute('data-i18n', 'settings.general.autoSave');
      var fontSize = UI.input({ type: 'number', value: ctx.settings.fontSize || 14, onChange: function (e) { ctx.setSetting('fontSize', Number(e.target.value) || 14); } });
      fontSize.style.maxWidth = '100px';
      var outline = el('input', { type: 'checkbox', checked: ctx.settings.showOutline !== false, onChange: function (e) { ctx.setSetting('showOutline', e.target.checked); } });
      var outlineWrap = el('label', { class: 'checkbox' }, [outline, el('span', { text: t('outline.title') })]);
      outlineWrap.querySelector('span').setAttribute('data-i18n', 'outline.title');
      return el('div', { class: 'settings-panel' }, [
        UI.field(t('settings.general.language'), locale, 'settings.general.language'),
        UI.field(t('settings.general.theme'), theme, 'settings.general.theme'),
        autoWrap,
        el('div', { class: 'divider' }),
        UI.field(t('settings.general.fontSize'), fontSize, 'settings.general.fontSize'),
        outlineWrap
      ]);
    }

    // 仓库/分支列表默认收起：选中后只回显已选项，只有用户主动聚焦或输入时才展开
    function setListOpen(node, open) {
      if (!node) return;
      node.hidden = !open;
      node.classList.toggle('is-open', !!open);
    }
    function closeRepoList() { setListOpen(repoListNode, false); }
    function closeBranchList() { setListOpen(branchListNode, false); }
    function closeLists() { closeRepoList(); closeBranchList(); }
    function openRepoList() {
      if (!refs.repoSearch || refs.repoSearch.disabled) return;
      closeBranchList();
      setListOpen(repoListNode, true);
    }
    function openBranchList() {
      if (!refs.branchSearch || refs.branchSearch.disabled) return;
      closeRepoList();
      setListOpen(branchListNode, true);
    }
    function markSelected(input, value) {
      if (!input) return;
      input.value = value;
      input.classList.add('is-selected');
    }

    function githubPanel() {
      var tokenTimer = null;
      var repoTimer = null;
      var branchTimer = null;
      // 每次打开面板都从已绑定配置初始化当前选中项
      selectedOwner = ctx.binding.owner || '';
      selectedRepo = ctx.binding.repo || '';
      refs.token = UI.input({
        type: 'password', value: ctx.binding.token || '', placeholder: 'ghp_…',
        onInput: function (e) {
          ctx.binding.token = e.target.value.trim();
          if (!ctx.binding.token) {
            closeLists();
            if (repoListNode) repoListNode.innerHTML = '';
            if (branchListNode) branchListNode.innerHTML = '';
          }
          updateGithubEnabled();
          clearTimeout(tokenTimer);
          if (ctx.binding.token) {
            // 只有 token 变化才主动拉取仓库/分支列表；打开设置或切换标签页都不请求
            tokenTimer = setTimeout(function () {
              loadRepos();
              if (selectedOwner && selectedRepo) loadBranches();
            }, 350);
          }
        }
      });
      refs.remember = el('input', { type: 'checkbox', checked: ctx.binding.remember !== false });
      refs.rootDir = UI.input({ value: ctx.binding.rootDir || 'docs' });
      refs.repoSearch = UI.input({
        placeholder: t('settings.github.repoPlaceholder'),
        onInput: function () {
          if (refs.repoSearch.disabled) return;
          refs.repoSearch.classList.remove('is-selected');
          clearTimeout(repoTimer);
          openRepoList();
          repoTimer = setTimeout(loadRepos, 250);
        }
      });
      refs.repoSearch.setAttribute('data-i18n-placeholder', 'settings.github.repoPlaceholder');
      refs.repoSearch.addEventListener('focus', function () { openRepoList(); loadRepos(); });
      refs.repoSearch.addEventListener('blur', function () {
        setTimeout(function () { if (document.activeElement !== refs.repoSearch) closeRepoList(); }, 120);
      });
      repoListNode = el('div', { class: 'dropdown-list inline', hidden: true });
      refs.branchSearch = UI.input({
        placeholder: t('settings.github.branchPlaceholder'),
        onInput: function () {
          if (refs.branchSearch.disabled) return;
          refs.branchSearch.classList.remove('is-selected');
          clearTimeout(branchTimer);
          openBranchList();
          branchTimer = setTimeout(function () { loadBranches(); }, 250);
        }
      });
      refs.branchSearch.addEventListener('focus', function () { openBranchList(); loadBranches(); });
      refs.branchSearch.addEventListener('blur', function () {
        setTimeout(function () { if (document.activeElement !== refs.branchSearch) closeBranchList(); }, 120);
      });
      refs.branchSearch.setAttribute('data-i18n-placeholder', 'settings.github.branchPlaceholder');
      branchListNode = el('div', { class: 'dropdown-list inline', hidden: true });
      refs.githubHint = el('div', { class: 'modal-note', text: t('settings.github.needToken') });
      refs.githubHint.setAttribute('data-i18n', 'settings.github.needToken');
      refs.repoValue = el('span', { class: 'badge', text: t('settings.github.bound') });
      refs.branchValue = el('span', { class: 'badge', text: ctx.binding.branch || 'main' });
      var repoField = el('div', { class: 'github-list-field' }, [
        lab(t('settings.github.repo'), 'settings.github.repo'), refs.repoSearch, repoListNode
      ]);
      var branchField = el('div', { class: 'github-list-field' }, [
        lab(t('settings.github.branch'), 'settings.github.branch'), refs.branchSearch, branchListNode
      ]);
      var rememberWrap = el('label', { class: 'checkbox' }, [refs.remember, el('span', { text: t('settings.github.remember') })]);
      rememberWrap.querySelector('span').setAttribute('data-i18n', 'settings.github.remember');
      var selection = el('div', { class: 'field-row github-selection' }, [
        el('span', { class: 'muted', text: '→' }), refs.repoValue, el('span', { class: 'muted', text: '@' }), refs.branchValue
      ]);
      refs.repoValue.textContent = ctx.binding.owner && ctx.binding.repo
        ? ctx.binding.owner + '/' + ctx.binding.repo : t('settings.github.bound');
      refs.branchValue.textContent = ctx.binding.branch || 'main';
      refs.bindBtn = UI.button({
        label: t('settings.github.bind'), variant: 'primary',
        onClick: function () {
          var parts = String(refs.repoValue.textContent || '').split('/');
          var binding = {
            token: refs.token.value.trim(),
            owner: parts[0] || '',
            repo: parts[1] || '',
            branch: refs.branchValue.textContent || 'main',
            rootDir: refs.rootDir.value.trim() || 'docs',
            remember: refs.remember.checked
          };
          if (!binding.token || !binding.owner || !binding.repo) {
            ctx.toast(t('log.notBound'), 'warn');
            return;
          }
          ctx.setBinding(binding);
          ctx.log(t('log.bound', { repo: binding.owner + '/' + binding.repo, branch: binding.branch, dir: binding.rootDir }));
          ctx.refreshExplorer();
          dialog.close();
        }
      });
      var actions = el('div', { class: 'field-row github-actions' }, [
        UI.button({ label: t('settings.github.tokenHelp'), onClick: showTokenHelp })
      ]);

      // 自动同步与原「同步」页的所有设置都收拢到 GitHub 标签下
      var ghAutoSync = el('input', { type: 'checkbox', checked: !!ctx.settings.autoSync, onChange: function (e) {
        ghDelayWrap.hidden = !e.target.checked;
        ctx.setSetting('autoSync', e.target.checked);
      } });
      var ghAutoSyncWrap = el('label', { class: 'checkbox' }, [ghAutoSync, el('span', { text: t('settings.general.autoSync') })]);
      ghAutoSyncWrap.querySelector('span').setAttribute('data-i18n', 'settings.general.autoSync');
      var ghDelayInput = UI.input({ type: 'number', min: 1, value: ctx.settings.autoSyncDelay || 10, onChange: function (e) {
        ctx.setSetting('autoSyncDelay', Math.max(1, Number(e.target.value) || 10));
      } });
      ghDelayInput.min = '1';
      ghDelayInput.style.maxWidth = '100px';
      var ghDelayHint = el('p', { class: 'field-hint', text: t('settings.general.autoSyncHelp') });
      ghDelayHint.setAttribute('data-i18n', 'settings.general.autoSyncHelp');
      var ghDelayWrap = el('div', { class: 'auto-sync-delay', hidden: !ctx.settings.autoSync }, [
        UI.field(t('settings.general.autoSyncDelay'), ghDelayInput, 'settings.general.autoSyncDelay'),
        ghDelayHint
      ]);
      var ghMaxFetch = UI.input({ type: 'number', value: ctx.settings.maxFetch || 40, onChange: function (e) {
        ctx.setSetting('maxFetch', Math.max(1, Number(e.target.value) || 40));
      } });
      ghMaxFetch.style.maxWidth = '100%';
      var ghMaxRetries = UI.input({
        type: 'number', value: ctx.settings.maxRetries === undefined ? 2 : ctx.settings.maxRetries,
        onChange: function (e) {
          var value = Number(e.target.value);
          ctx.setSetting('maxRetries', isFinite(value) ? Math.max(0, Math.min(5, Math.round(value))) : 0);
        }
      });
      ghMaxRetries.style.maxWidth = '100%';
      var syncFields = el('div', { class: 'settings-grid' }, [
        UI.field(t('settings.sync.maxFetch'), ghMaxFetch, 'settings.sync.maxFetch'),
        UI.field(t('settings.sync.maxRetries'), ghMaxRetries, 'settings.sync.maxRetries')
      ]);
      var syncNotes = el('div', { class: 'settings-notes' });
      ['settings.sync.retryInfo', 'settings.sync.info'].forEach(function (key) {
        var note = el('div', { class: 'modal-note', text: t(key) });
        note.setAttribute('data-i18n', key);
        syncNotes.appendChild(note);
      });

      if (ctx.binding.owner && ctx.binding.repo) {
        markSelected(refs.repoSearch, ctx.binding.owner + '/' + ctx.binding.repo);
        markSelected(refs.branchSearch, ctx.binding.branch || 'main');
      }
      closeLists(); // 打开设置时两个下拉默认收起；只有聚焦/输入才展开
      updateGithubEnabled();
      return el('div', { class: 'settings-panel settings-panel-github' }, [
        section('settings.github.section.auth', [
          UI.field(t('settings.github.token'), refs.token, 'settings.github.token'),
          refs.githubHint,
          rememberWrap,
          actions
        ]),
        section('settings.github.section.repo', [
          repoField,
          branchField,
          selection,
          UI.field(t('settings.github.dir'), refs.rootDir, 'settings.github.dir'),
          el('div', { class: 'field-row github-actions' }, [refs.bindBtn])
        ]),
        section('settings.github.section.sync', [
          ghAutoSyncWrap,
          ghDelayWrap,
          syncFields,
          syncNotes
        ])
      ]);
    }

    function updateGithubEnabled() {
      if (!refs.token) return;
      var enabled = !!refs.token.value.trim();
      [refs.repoSearch, refs.branchSearch, refs.rootDir].forEach(function (node) {
        if (node) node.disabled = !enabled;
      });
      // 绑定按钮需 token + 仓库 + 分支都就绪，避免“填了 token 就能绑定”的误导
      if (refs.bindBtn) {
        refs.bindBtn.disabled = !enabled || !selectedOwner || !selectedRepo || !String(refs.branchValue.textContent || '').trim();
      }
      if (!enabled) {
        // 无 token：两个选择器收起、禁用并清空候选项；有 token 时保持当前开合，避免刷新列表时把选项收掉
        closeLists();
        if (repoListNode) { repoListNode.innerHTML = ''; repoListNode.classList.remove('is-empty'); }
        if (branchListNode) { branchListNode.innerHTML = ''; branchListNode.classList.remove('is-empty'); }
      }
      if (refs.githubHint) refs.githubHint.hidden = enabled;
    }

    function loadRepos() {
      updateGithubEnabled();
      if (!refs.token.value.trim()) { repoListNode.innerHTML = ''; return; }
      var wait = UI.busy(t('settings.github.loadingRepos'));
      ctx.listRepos().then(function (repos) {
        var query = refs.repoSearch.classList.contains('is-selected') ? '' : (refs.repoSearch.value || '').toLowerCase();
        var items = repos.filter(function (r) { return r.fullName.toLowerCase().indexOf(query) >= 0; }).slice(0, 40);
        repoListNode.innerHTML = '';
        repoListNode.classList.toggle('is-empty', !items.length);
        if (!items.length) {
          repoListNode.appendChild(el('div', { class: 'dropdown-empty', text: t('settings.github.emptyRepos') }));
          return;
        }
        items.forEach(function (r) {
          repoListNode.appendChild(el('div', {
            class: 'dropdown-item', text: r.fullName + (r.private ? ' 🔒' : ''),
            onMousedown: function (e) {
              e.preventDefault();
              markSelected(refs.repoSearch, r.fullName);
              refs.repoValue.textContent = r.fullName;
              var parts = r.fullName.split('/');
              selectedOwner = parts[0] || '';
              selectedRepo = parts.slice(1).join('/');
              markSelected(refs.branchSearch, '');
              refs.branchValue.textContent = 'main';
              branchListNode.innerHTML = '';
              closeRepoList();
              // 选完仓库直接展开分支列表：分支加载以面板内选中的仓库为准，不再读尚未更新的 ctx.binding
              if (selectedOwner && selectedRepo) { openBranchList(); loadBranches(); }
              else closeBranchList();
            }
          }));
        });
      }).catch(function (err) {
        ctx.log(t('log.syncFail', { msg: err.message }));
      }).then(function () { wait.close(); });
    }

    function loadBranches(owner, repo) {
      updateGithubEnabled();
      owner = owner || selectedOwner || ctx.binding.owner;
      repo = repo || selectedRepo || ctx.binding.repo;
      if (!owner || !repo) {
        branchListNode.innerHTML = '';
        branchListNode.classList.add('is-empty');
        branchListNode.appendChild(el('div', { class: 'dropdown-empty', text: t('settings.github.selectRepoFirst') }));
        return;
      }
      if (!refs.token.value.trim()) return;
      var wait = UI.busy(t('settings.github.loadingBranches'));
      ctx.listBranches(owner, repo).then(function (branches) {
        branchListNode.innerHTML = '';
        var query = refs.branchSearch.classList.contains('is-selected') ? '' : (refs.branchSearch.value || '').toLowerCase();
        var items = branches.filter(function (b) { return b.toLowerCase().indexOf(query) >= 0; });
        if (!items.length) items = branches.slice(0, 30);
        branchListNode.classList.toggle('is-empty', !items.length);
        if (!items.length) {
          branchListNode.appendChild(el('div', { class: 'dropdown-empty', text: t('settings.github.emptyBranches') }));
          return;
        }
        items.forEach(function (name) {
          branchListNode.appendChild(el('div', {
            class: 'dropdown-item' + (name === refs.branchValue.textContent ? ' active' : ''),
            text: name,
            onMousedown: function (e) {
              e.preventDefault();
              markSelected(refs.branchSearch, name);
              refs.branchValue.textContent = name;
              closeBranchList();
              updateGithubEnabled();
            }
          }));
        });
        // 允许输入新分支名（需要 commit 时由 GitHub 自动创建）
        if (refs.branchSearch.value.trim() && items.indexOf(refs.branchSearch.value.trim()) < 0) {
          branchListNode.insertBefore(el('div', {
            class: 'dropdown-item', text: '+ ' + refs.branchSearch.value.trim(),
            onMousedown: function (e) {
              e.preventDefault();
              var custom = refs.branchSearch.value.trim();
              markSelected(refs.branchSearch, custom);
              refs.branchValue.textContent = custom;
              closeBranchList();
              updateGithubEnabled();
            }
          }), branchListNode.firstChild);
        }
      }).catch(function (err) {
        ctx.log(t('log.syncFail', { msg: err.message }));
      }).then(function () { wait.close(); });
    }

    function buildHelpContent(text) {
      var wrap = el('div', { class: 'permission-help' });
      var list = null;
      function flushList() { if (list) { wrap.appendChild(list); list = null; } }
      (text || '').split('\n').forEach(function (line) {
        if (!line.trim()) return;
        if (line.indexOf('## ') === 0) {
          flushList();
          wrap.appendChild(el('h4', { class: 'help-h', text: line.slice(3) }));
        } else if (line.indexOf('- ') === 0) {
          if (!list) list = el('ul', { class: 'help-list' });
          list.appendChild(el('li', { text: line.slice(2) }));
        } else {
          flushList();
          wrap.appendChild(el('p', { class: 'help-p', text: line }));
        }
      });
      flushList();
      return wrap;
    }

    function helpLink(label, href, iconName, i18nKey) {
      var text = el('span', { text: label });
      text.setAttribute('data-i18n', i18nKey);
      return el('a', {
        class: 'help-link', href: href, target: '_blank', rel: 'noopener noreferrer', title: label
      }, [UI.icon(iconName), text]);
    }

    function showTokenHelp() {
      // 帮助窗口顶部提供可达的官方入口；链接文案与文档地址均走三语文案
      var links = el('div', { class: 'help-links' }, [
        helpLink(t('settings.github.helpLinkCreate'), 'https://github.com/settings/personal-access-tokens/new', 'github', 'settings.github.helpLinkCreate'),
        helpLink(t('settings.github.helpLinkDocs'), t('settings.github.helpDocsUrl'), 'external', 'settings.github.helpLinkDocs')
      ]);
      var d = UI.modal({
        title: t('settings.github.helpTitle'), class: 'modal-help',
        content: el('div', {}, [links, buildHelpContent(t('settings.github.helpBody'))]),
        actions: [UI.button({ label: t('common.close'), variant: 'primary', onClick: function () { d.close(); } })]
      });
    }

    function editorPanel() {
      var mode = UI.segmented([
        { value: 'source', label: t('settings.editor.source'), i18n: 'settings.editor.source' },
        { value: 'split', label: t('settings.editor.split'), i18n: 'settings.editor.split' },
        { value: 'preview', label: t('settings.editor.preview'), i18n: 'settings.editor.preview' }
      ], ctx.settings.defaultMode || 'split', function (value) { ctx.setSetting('defaultMode', value); });
      var tabSize = UI.select({
        value: String(ctx.settings.tabSize || 2),
        options: [{ value: '2', label: '2' }, { value: '4', label: '4' }],
        onChange: function (e) { ctx.setSetting('tabSize', Number(e.target.value)); }
      });
      tabSize.style.maxWidth = '80px';
      var fontFamily = UI.select({
        value: ctx.settings.fontFamily || 'mono',
        options: [
          { value: 'mono', label: t('settings.editor.font.mono') },
          { value: 'system', label: t('settings.editor.font.system') },
          { value: 'serif', label: t('settings.editor.font.serif') }
        ],
        onChange: function (e) { ctx.setSetting('fontFamily', e.target.value); }
      });
      fontFamily.style.maxWidth = '160px';

      function toggle(key, i18nKey, defaultValue) {
        var input = el('input', {
          type: 'checkbox',
          checked: ctx.settings[key] === undefined ? defaultValue : !!ctx.settings[key],
          onChange: function (e) { ctx.setSetting(key, e.target.checked); }
        });
        var wrap = el('label', { class: 'checkbox' }, [input, el('span', { text: t(i18nKey) })]);
        wrap.querySelector('span').setAttribute('data-i18n', i18nKey);
        return wrap;
      }

      return el('div', { class: 'settings-panel settings-panel-editor' }, [
        section('settings.editor.section.behavior', [
          UI.field(t('settings.editor.defaultMode'), mode, 'settings.editor.defaultMode'),
          UI.field(t('settings.editor.tabSize'), tabSize, 'settings.editor.tabSize'),
          toggle('autoCloseBrackets', 'settings.editor.autoCloseBrackets', false),
          toggle('wordWrap', 'settings.editor.wordWrap', true)
        ]),
        section('settings.editor.section.view', [
          toggle('lineNumbers', 'settings.editor.lineNumbers', true),
          toggle('previewSyncScroll', 'settings.editor.previewSyncScroll', true),
          toggle('showToolbar', 'settings.editor.toolbar', true)
        ]),
        section('settings.editor.section.appearance', [
          UI.field(t('settings.editor.fontFamily'), fontFamily, 'settings.editor.fontFamily'),
          toggle('spellCheck', 'settings.editor.spellCheck', false)
        ])
      ]);
    }

    function aboutPanel() {
      var backend = ctx.storage && ctx.storage.backend() === 'indexeddb'
        ? t('settings.about.storage.indexeddb') : t('settings.about.storage.localstorage');
      return el('div', { class: 'settings-panel' }, [
        el('h3', { text: t('settings.about.title') }),
        el('p', { class: 'muted', text: t('settings.about.body') }),
        el('p', { class: 'muted', text: t('settings.about.storage', { backend: backend }) })
      ]);
    }

    return instance;
  }

  Features.Settings = { create: create };
})(window);
