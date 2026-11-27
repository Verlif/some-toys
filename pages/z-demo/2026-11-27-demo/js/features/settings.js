/* 设置中心：通用 / GitHub / 编辑器 / 同步 / 关于 */
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

    function open() {
      currentTab = 'general';
      dialog = UI.modal({
        title: t('settings.title'),
        wide: true,
        class: 'modal-settings',
        content: [buildTabs(), el('div', { class: 'tab-body', id: 'settings-panels' })],
        actions: [UI.button({ label: t('common.close'), onClick: function () { dialog.close(); } })]
      });
      var host = dialog.body.querySelectorAll('.tab-body')[0];
      Object.keys(panels).forEach(function (key) { host.appendChild(panels[key]); });
      showTab('general');
      refreshGithub();
    }

    function buildTabs() {
      var bar = el('div', { class: 'tabs' });
      var tabs = [
        { key: 'general', label: t('settings.tab.general'), i18n: 'settings.tab.general' },
        { key: 'github', label: t('settings.tab.github'), i18n: 'settings.tab.github' },
        { key: 'editor', label: t('settings.tab.editor'), i18n: 'settings.tab.editor' },
        { key: 'sync', label: t('settings.tab.sync'), i18n: 'settings.tab.sync' },
        { key: 'about', label: t('settings.tab.about'), i18n: 'settings.tab.about' }
      ];
      tabs.forEach(function (tab) {
        var node = el('button', {
          type: 'button', class: 'tab' + (tab.key === currentTab ? ' active' : ''),
          text: tab.label, onClick: function () { showTab(tab.key); }
        });
        node.setAttribute('data-i18n', tab.i18n);
        bar.appendChild(node);
        panels[tab.key] = buildPanel(tab.key);
      });
      return bar;
    }

    function showTab(key) {
      currentTab = key;
      dialog.root.querySelectorAll('.tabs .tab').forEach(function (node, index) {
        node.classList.toggle('active', ['general', 'github', 'editor', 'sync', 'about'][index] === key);
      });
      Object.keys(panels).forEach(function (k) { panels[k].hidden = k !== key; });
      if (key === 'github') refreshGithub();
    }

    function buildPanel(key) {
      if (key === 'general') return generalPanel();
      if (key === 'github') return githubPanel();
      if (key === 'editor') return editorPanel();
      if (key === 'sync') return syncPanel();
      return aboutPanel();
    }

    function lab(text, i18n) {
      var node = el('span', { class: 'field-label', text: text });
      if (i18n) node.setAttribute('data-i18n', i18n);
      return node;
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

    function githubPanel() {
      var tokenTimer = null;
      var repoTimer = null;
      var branchTimer = null;
      refs.token = UI.input({
        type: 'password', value: ctx.binding.token || '', placeholder: 'ghp_…',
        onInput: function (e) {
          ctx.binding.token = e.target.value.trim();
          updateGithubEnabled();
          clearTimeout(tokenTimer);
          if (ctx.binding.token) tokenTimer = setTimeout(loadRepos, 350);
        }
      });
      refs.remember = el('input', { type: 'checkbox', checked: ctx.binding.remember !== false });
      refs.rootDir = UI.input({ value: ctx.binding.rootDir || 'docs' });
      refs.repoSearch = UI.input({
        placeholder: t('settings.github.repoPlaceholder'),
        onInput: function () { clearTimeout(repoTimer); repoTimer = setTimeout(loadRepos, 250); }
      });
      refs.repoSearch.setAttribute('data-i18n-placeholder', 'settings.github.repoPlaceholder');
      repoListNode = el('div', { class: 'dropdown-list inline' });
      refs.branchSearch = UI.input({
        placeholder: t('settings.github.branchPlaceholder'),
        onInput: function () { clearTimeout(branchTimer); branchTimer = setTimeout(function () { loadBranches(); }, 250); }
      });
      refs.branchSearch.setAttribute('data-i18n-placeholder', 'settings.github.branchPlaceholder');
      branchListNode = el('div', { class: 'dropdown-list inline' });
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
        refs.bindBtn, UI.button({ label: t('settings.github.tokenHelp'), onClick: showTokenHelp })
      ]);
      updateGithubEnabled();
      return el('div', { class: 'settings-panel' }, [
        UI.field(t('settings.github.token'), refs.token, 'settings.github.token'),
        refs.githubHint,
        rememberWrap,
        el('div', { class: 'divider' }),
        repoField,
        branchField,
        selection,
        UI.field(t('settings.github.dir'), refs.rootDir, 'settings.github.dir'),
        actions
      ]);
    }

    function updateGithubEnabled() {
      if (!refs.token) return;
      var enabled = !!refs.token.value.trim();
      [refs.repoSearch, refs.branchSearch, refs.rootDir, refs.bindBtn].forEach(function (node) {
        if (node) node.disabled = !enabled;
      });
      if (repoListNode) {
        repoListNode.hidden = !enabled;
        if (!enabled) { repoListNode.innerHTML = ''; repoListNode.classList.remove('is-empty'); }
      }
      if (branchListNode) {
        branchListNode.hidden = !enabled;
        if (!enabled) { branchListNode.innerHTML = ''; branchListNode.classList.remove('is-empty'); }
      }
      if (refs.githubHint) refs.githubHint.hidden = enabled;
    }

    function refreshGithub() {
      if (!refs.repoSearch) return;
      updateGithubEnabled();
      if (!refs.token.value.trim()) return;
      loadRepos();
      loadBranches();
    }

    function loadRepos() {
      updateGithubEnabled();
      if (!refs.token.value.trim()) { repoListNode.innerHTML = ''; return; }
      var wait = UI.busy(t('settings.github.loadingRepos'));
      ctx.listRepos().then(function (repos) {
        var query = (refs.repoSearch.value || '').toLowerCase();
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
              refs.repoValue.textContent = r.fullName;
              var parts = r.fullName.split('/');
              refs.branchValue.textContent = 'main';
              loadBranches(parts[0], parts[1]);
            }
          }));
        });
      }).catch(function (err) {
        ctx.log(t('log.syncFail', { msg: err.message }));
      }).then(function () { wait.close(); });
    }

    function loadBranches(owner, repo) {
      updateGithubEnabled();
      owner = owner || ctx.binding.owner;
      repo = repo || ctx.binding.repo;
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
        var query = (refs.branchSearch.value || '').toLowerCase();
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
            onMousedown: function (e) { e.preventDefault(); refs.branchValue.textContent = name; }
          }));
        });
        // 允许输入新分支名（需要 commit 时由 GitHub 自动创建）
        if (refs.branchSearch.value.trim() && items.indexOf(refs.branchSearch.value.trim()) < 0) {
          branchListNode.insertBefore(el('div', {
            class: 'dropdown-item', text: '+ ' + refs.branchSearch.value.trim(),
            onMousedown: function (e) { e.preventDefault(); refs.branchValue.textContent = refs.branchSearch.value.trim(); }
          }), branchListNode.firstChild);
        }
      }).catch(function (err) {
        ctx.log(t('log.syncFail', { msg: err.message }));
      }).then(function () { wait.close(); });
    }

    function showTokenHelp() {
      var d = UI.modal({
        title: t('settings.github.helpTitle'), small: true,
        content: el('div', { class: 'modal-note', text: t('settings.github.helpBody') }),
        actions: [UI.button({ label: t('common.close'), onClick: function () { d.close(); } })]
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
      var toolbar = el('input', { type: 'checkbox', checked: ctx.settings.showToolbar !== false, onChange: function (e) { ctx.setSetting('showToolbar', e.target.checked); } });
      var toolbarWrap = el('label', { class: 'checkbox' }, [toolbar, el('span', { text: t('settings.editor.toolbar') })]);
      toolbarWrap.querySelector('span').setAttribute('data-i18n', 'settings.editor.toolbar');
      return el('div', { class: 'settings-panel' }, [
        UI.field(t('settings.editor.defaultMode'), mode, 'settings.editor.defaultMode'),
        UI.field(t('settings.editor.tabSize'), tabSize, 'settings.editor.tabSize'),
        toolbarWrap
      ]);
    }

    function syncPanel() {
      var maxFetch = UI.input({
        type: 'number', value: ctx.settings.maxFetch || 40,
        onChange: function (e) { ctx.setSetting('maxFetch', Math.max(1, Number(e.target.value) || 40)); }
      });
      maxFetch.style.maxWidth = '120px';
      var maxRetries = UI.input({
        type: 'number', value: ctx.settings.maxRetries === undefined ? 2 : ctx.settings.maxRetries,
        onChange: function (e) {
          var value = Number(e.target.value);
          ctx.setSetting('maxRetries', isFinite(value) ? Math.max(0, Math.min(5, Math.round(value))) : 0);
        }
      });
      maxRetries.style.maxWidth = '120px';
      return el('div', { class: 'settings-panel' }, [
        UI.field(t('settings.sync.maxFetch'), maxFetch, 'settings.sync.maxFetch'),
        UI.field(t('settings.sync.maxRetries'), maxRetries, 'settings.sync.maxRetries'),
        el('div', { class: 'modal-note', text: t('settings.sync.retryInfo') }),
        el('div', { class: 'modal-note', text: t('settings.sync.info') })
      ]);
    }

    function aboutPanel() {
      return el('div', { class: 'settings-panel' }, [
        el('h3', { text: t('settings.about.title') }),
        el('p', { class: 'muted', text: t('settings.about.body') })
      ]);
    }

    return instance;
  }

  Features.Settings = { create: create };
})(window);
