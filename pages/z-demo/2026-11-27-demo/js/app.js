/* 应用控制器：负责装配各模块、管理会话状态与 GitHub 同步流程 */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var UI = App.UI;
  var el = UI.el;
  var I18n = App.I18n;
  var Features = App.Features;

  var KEY_SETTINGS = 'docs-kb:settings';
  var KEY_BINDING = 'docs-kb:binding';
  var KEY_FOLDERS = 'docs-kb:folders';
  var KEY_LAST_SYNC = 'docs-kb:lastSync';
  var TREE_TTL = 60 * 1000;

  var defaultSettings = {
    theme: 'light', locale: 'zh-CN', fontSize: 14, tabSize: 2,
    autoSave: true, defaultMode: 'split', showToolbar: true, showOutline: true,
    maxFetch: 40, maxRetries: 2
  };

  var state = {
    settings: Object.assign({}, defaultSettings, readJSON(KEY_SETTINGS, {})),
    binding: loadBinding(),
    folders: readJSON(KEY_FOLDERS, []) || [],
    lastSync: Number(readJSON(KEY_LAST_SYNC, 0)) || 0,
    offline: false,
    syncing: false,
    activePath: null,
    tabs: [],
    dirty: {},
    logs: [],
    timer: null
  };

  var dom = {};
  var ctx = {};
  var store, client, explorer, editor, images, settingsPanel;

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 忽略 */ }
  }

  function loadBinding() {
    var saved = readJSON(KEY_BINDING, null);
    if (saved && typeof saved === 'object') return saved;
    // 兼容旧版配置同步 demo 的绑定
    var legacy = readJSON('config-sync:github-binding', null);
    if (legacy && legacy.repo) {
      var parts = String(legacy.repo).split('/');
      return {
        token: legacy.token || '', owner: parts[0] || '', repo: parts[1] || '',
        branch: legacy.branch || 'main', rootDir: legacy.path || 'docs', remember: true
      };
    }
    return { token: '', owner: '', repo: '', branch: 'main', rootDir: 'docs', remember: true };
  }

  // ---------- 通用能力（供模块调用） ----------
  function t(key, params) { return I18n.t(key, params); }

  function log(message) {
    var time = new Date().toLocaleTimeString();
    var line = '[' + time + '] ' + message;
    state.logs.push(line);
    if (state.logs.length > 200) state.logs.shift();
    if (dom.logPanel && !dom.logPanel.hidden) dom.logPanel.textContent = state.logs.join('\n');
    if (global.console) console.log(line);
  }

  function toast(message, type) { UI.toast(message, type); }

  function setSetting(key, value) {
    state.settings[key] = value;
    writeJSON(KEY_SETTINGS, state.settings);
    applySettings();
    if (key === 'maxRetries') refreshClient();
  }

  function applySettings() {
    document.documentElement.setAttribute('data-theme', state.settings.theme === 'dark' ? 'dark' : 'light');
    document.documentElement.style.setProperty('--editor-font-size', (state.settings.fontSize || 14) + 'px');
    if (dom.workspace) {
      dom.workspace.classList.toggle('no-outline', state.settings.showOutline === false);
    }
    if (editor) {
      editor.textarea.style.fontSize = (state.settings.fontSize || 14) + 'px';
      editor.textarea.style.tabSize = state.settings.tabSize || 2;
      var toolbar = editor.root.querySelector('.editor-toolbar');
      if (toolbar) toolbar.style.display = state.settings.showToolbar === false ? 'none' : '';
    }
  }

  function setLocale(locale) {
    if (!I18n.setLocale(locale)) return;
    state.settings.locale = locale;
    writeJSON(KEY_SETTINGS, state.settings);
    refreshExplorer();
    renderTabs();
    updateHeader();
    if (editor) editor.renderPreview();
  }

  function createClient() {
    var b = state.binding;
    if (!b.token || !b.owner || !b.repo) return null;
    var retries = Number(state.settings.maxRetries);
    if (!isFinite(retries)) retries = 2;
    retries = Math.max(0, Math.min(5, Math.round(retries)));
    return new GitHubDocs({
      token: b.token, owner: b.owner, repo: b.repo,
      branch: b.branch || 'main', rootDir: b.rootDir || 'docs',
      maxRetries: retries,
      onLog: function (msg) { log(msg); }
    });
  }

  function setBinding(binding) {
    state.binding = Object.assign({}, binding);
    state.binding.token = String(state.binding.token || '').trim();
    var persisted = Object.assign({}, state.binding);
    if (!persisted.remember) persisted.token = '';
    writeJSON(KEY_BINDING, persisted);
    client = createClient();
    updateHeader();
    refreshExplorer();
  }

  function refreshClient() { client = createClient(); updateHeader(); }

  function temporaryClient() {
    return new GitHubDocs({
      token: state.binding.token || '', maxRetries: state.settings.maxRetries || 0,
      onLog: function (msg) { log(msg); }
    });
  }

  function listRepos() {
    var c = client && client.token === state.binding.token ? client : temporaryClient();
    return c.listRepos();
  }

  function listBranches(owner, repo) {
    var c = client && client.token === state.binding.token ? client : temporaryClient();
    return c.listBranches(owner, repo);
  }

  function getAssetDataUrl(path) {
    if (!client || state.offline) return Promise.resolve(null);
    return client.getBinary(path).then(function (file) { return file ? file.dataUrl : null; })
      .catch(function () { return null; });
  }

  // ---------- 文档操作 ----------
  function dirname(path) {
    var i = String(path).lastIndexOf('/');
    return i < 0 ? '' : path.slice(0, i);
  }

  function uniquePath(folder, name) {
    var base = String(name).replace(/[\\/:*?"<>|]/g, '-').replace(/\.md$/i, '').trim() || t('editor.untitled');
    var path = (folder ? folder + '/' : '') + base + '.md';
    var n = 2;
    while (store.get(path) || state.folders.indexOf(path.replace(/\.md$/, '')) >= 0) {
      path = (folder ? folder + '/' : '') + base + '-' + n + '.md';
      n++;
    }
    return path;
  }

  function openDoc(path) {
    var doc = store.get(path);
    if (!doc) return;
    if (state.tabs.indexOf(path) < 0) state.tabs.push(path);
    state.activePath = path;
    editor.open(doc);
    editor.updateDirty();
    renderTabs();
    refreshExplorer();
  }

  function closeTab(path) {
    var index = state.tabs.indexOf(path);
    if (index < 0) return;
    if (state.dirty[path]) {
      var doc = store.get(path);
      if (doc && state.activePath === path) saveActive(true);
    }
    state.tabs.splice(index, 1);
    if (state.activePath === path) {
      state.activePath = state.tabs[Math.max(0, index - 1)] || null;
      if (state.activePath) editor.open(store.get(state.activePath));
      else editor.clear();
    }
    renderTabs();
    refreshExplorer();
  }

  function activeDoc() { return state.activePath ? store.get(state.activePath) : null; }
  function activePath() { return state.activePath; }
  function isDirty(path) { return !!state.dirty[path]; }

  function onEditorInput() {
    if (!state.activePath) return;
    state.dirty[state.activePath] = true;
    editor.updateDirty();
    renderTabs();
    if (state.settings.autoSave !== false) {
      clearTimeout(state.timer);
      state.timer = setTimeout(function () { saveActive(true); }, 800);
    }
  }

  function saveActive(silent) {
    if (!state.activePath) return;
    var draft = editor.getDraft();
    store.upsert(state.activePath, draft);
    delete state.dirty[state.activePath];
    editor.updateDirty();
    renderTabs();
    refreshExplorer();
    updateStatus();
    if (!silent) toast(t('toast.saved', { name: draft.title }), 'ok');
  }

  function createDoc(folder) {
    UI.prompt(t('explorer.docName'), '未命名文档', { title: t('explorer.newDoc'), okLabel: t('common.create') }).then(function (name) {
      if (!name || !name.trim()) return;
      var path = uniquePath(folder || '', name);
      store.upsert(path, { title: path.split('/').pop().replace(/\.md$/, ''), tags: [], body: '# ' + name.trim() + '\n\n' });
      openDoc(path);
      toast(t('toast.created', { name: name.trim() }), 'ok');
      log(t('toast.created', { name: path }));
    });
  }

  function renameDoc(path) {
    var doc = store.get(path);
    if (!doc) return;
    UI.prompt(t('explorer.docName'), path.split('/').pop().replace(/\.md$/, ''), { title: t('common.rename') }).then(function (name) {
      if (!name || !name.trim()) return;
      var target = uniquePath(dirname(path), name);
      if (target === path) return;
      if (state.dirty[path]) saveActive(true);
      store.rename(path, target);
      state.tabs = state.tabs.map(function (p) { return p === path ? target : p; });
      if (state.activePath === path) state.activePath = target;
      openDoc(target);
      toast(t('toast.renamed', { name: target }), 'ok');
    });
  }

  function moveDoc(oldPath, newPath) {
    if (!oldPath || oldPath === newPath || !store.get(oldPath)) return;
    if (state.dirty[oldPath]) saveActive(true);
    var dir = dirname(newPath);
    if (dir && state.folders.indexOf(dir) < 0) addFolder(dir, true);
    store.rename(oldPath, newPath);
    state.tabs = state.tabs.map(function (p) { return p === oldPath ? newPath : p; });
    if (state.activePath === oldPath) state.activePath = newPath;
    openDoc(newPath);
    toast(t('toast.moved', { name: newPath }), 'ok');
  }

  function moveDocPrompt(path) {
    UI.prompt(t('explorer.move'), dirname(path), { title: t('explorer.move') }).then(function (folder) {
      if (folder === null) return;
      folder = String(folder).trim().replace(/^\/+|\/+$/g, '');
      var target = (folder ? folder + '/' : '') + path.split('/').pop();
      moveDoc(path, target);
    });
  }

  function deleteDoc(path) {
    UI.confirm(t('explorer.confirmDeleteDoc', { name: path.split('/').pop() }), { danger: true }).then(function (yes) {
      if (!yes) return;
      store.remove(path);
      delete state.dirty[path];
      state.tabs = state.tabs.filter(function (p) { return p !== path; });
      if (state.activePath === path) {
        state.activePath = state.tabs[state.tabs.length - 1] || null;
        if (state.activePath) editor.open(store.get(state.activePath)); else editor.clear();
      }
      refreshExplorer();
      renderTabs();
      toast(t('toast.deleted', { name: path }), 'ok');
    });
  }

  function addFolder(path, silent) {
    var parts = String(path).split('/');
    var prefix = '';
    parts.forEach(function (part) {
      prefix = prefix ? prefix + '/' : part;
      if (prefix && state.folders.indexOf(prefix) < 0) state.folders.push(prefix);
    });
    writeJSON(KEY_FOLDERS, state.folders);
    if (!silent) refreshExplorer();
  }

  function createFolder(parent) {
    UI.prompt(t('explorer.folderName'), '', { title: t('explorer.newFolder'), okLabel: t('common.create') }).then(function (name) {
      if (!name || !name.trim()) return;
      var path = (parent ? parent + '/' : '') + name.trim().replace(/[\\/:*?"<>|]/g, '-');
      if (state.folders.indexOf(path) >= 0) { toast(t('explorer.noMatch'), 'warn'); return; }
      addFolder(path);
      if (client && !state.offline) {
        client.putFile(path + '/.gitkeep', '\n', 'docs: add folder ' + path).then(function () {
          log(t('log.folderCreated', { path: path }));
        }).catch(function (err) { log(t('log.syncFail', { msg: err.message })); });
      }
      toast(t('toast.created', { name: path }), 'ok');
    });
  }

  function renameFolder(path) {
    UI.prompt(t('explorer.folderName'), path.split('/').pop(), { title: t('explorer.renameFolder') }).then(function (name) {
      if (!name || !name.trim()) return;
      var parent = dirname(path);
      var target = (parent ? parent + '/' : '') + name.trim().replace(/[\\/:*?"<>|]/g, '-');
      if (target === path || state.folders.indexOf(target) >= 0) return;
      store.list().filter(function (doc) { return doc.path.indexOf(path + '/') === 0; })
        .forEach(function (doc) { moveDoc(doc.path, target + doc.path.slice(path.length)); });
      state.folders = state.folders.map(function (f) {
        if (f === path) return target;
        return f.indexOf(path + '/') === 0 ? target + f.slice(path.length) : f;
      });
      writeJSON(KEY_FOLDERS, state.folders);
      if (client && !state.offline) {
        client.deleteFile(path + '/.gitkeep', 'docs: rename folder ' + path).catch(function () {});
        client.putFile(target + '/.gitkeep', '\n', 'docs: rename folder ' + target).catch(function (err) { log(t('log.syncFail', { msg: err.message })); });
      }
      refreshExplorer();
      toast(t('toast.renamed', { name: target }), 'ok');
    });
  }

  function deleteFolder(path) {
    UI.confirm(t('explorer.confirmDeleteFolder', { name: path }), { danger: true }).then(function (yes) {
      if (!yes) return;
      var parent = dirname(path);
      store.list().filter(function (doc) { return doc.path.indexOf(path + '/') === 0; })
        .forEach(function (doc) { moveDoc(doc.path, (parent ? parent + '/' : '') + doc.path.split('/').pop()); });
      state.folders = state.folders.filter(function (f) { return f !== path && f.indexOf(path + '/') !== 0; });
      writeJSON(KEY_FOLDERS, state.folders);
      if (client && !state.offline) client.deleteFile(path + '/.gitkeep', 'docs: remove folder ' + path).catch(function () {});
      refreshExplorer();
    });
  }

  function resolveConflict(choice) {
    var doc = activeDoc();
    if (!doc) return;
    if (choice === 'remote') store.adoptRemote(doc.path);
    else store.keepLocal(doc.path);
    openDoc(doc.path);
    toast(t('toast.saved', { name: doc.title }), 'ok');
  }

  // ---------- 同步 ----------
  function remoteRecord(f, remote, parsed) {
    return {
      title: parsed.title || f.path.split('/').pop().replace(/\.md$/, ''),
      tags: parsed.tags || [],
      body: parsed.body || '',
      updatedAt: parsed.updatedAt || 0,
      deviceId: parsed.deviceId || '',
      sha: remote.sha,
      etag: remote.etag
    };
  }

  function conflictEntry(path, local, remote, type) {
    return { path: path, local: local, remote: remote, type: type || 'content' };
  }

  function localConflictView(doc) {
    if (!doc) return { title: '', body: '', deleted: true };
    return {
      title: doc.title || '', body: doc.body || '',
      updatedAt: doc.updatedAt || 0, deviceId: doc.deviceId || '',
      deleted: !!doc.deleted
    };
  }

  /** 冲突弹窗：逐条并排展示本地/远端内容，用户自行选择 */
  function showConflictDialog(conflicts) {
    if (!conflicts || !conflicts.length) return;
    var dialog = UI.modal({
      title: t('conflict.title'),
      wide: true,
      content: el('div', { class: 'conflict-list' }, [
        el('div', { class: 'modal-note', text: t('conflict.intro') })
      ]),
      actions: [UI.button({ label: t('common.close'), onClick: function () { dialog.close(); } })]
    });
    var list = dialog.body.querySelector('.conflict-list');

    function removeRow(row) {
      if (row && row.parentNode) row.parentNode.removeChild(row);
      if (!list.querySelector('.conflict-item')) dialog.close();
    }
    function rowFor(path) {
      return Array.prototype.filter.call(list.querySelectorAll('.conflict-item'), function (node) {
        return node.getAttribute('data-path') === path;
      })[0];
    }
    function finish(entry, row) {
      removeRow(row);
      if (state.activePath === entry.path) openDoc(entry.path);
      refreshExplorer();
      updateStatus();
    }

    conflicts.forEach(function (entry) {
      var remoteText = entry.remote && entry.remote.deleted
        ? t('conflict.remoteDeleted')
        : ((entry.remote && entry.remote.body) || '');
      var localText = entry.local && entry.local.deleted
        ? t('conflict.localDeleted')
        : ((entry.local && entry.local.body) || '');
      var row = el('div', { class: 'conflict-item', dataset: { path: entry.path } }, [
        el('div', { class: 'conflict-item-head' }, [UI.icon('info'), el('strong', { text: entry.path })]),
        el('div', { class: 'conflict-columns' }, [
          el('div', { class: 'conflict-col' }, [
            el('div', { class: 'conflict-col-title', text: t('conflict.localVersion') }),
            el('pre', { class: 'conflict-code', text: localText })
          ]),
          el('div', { class: 'conflict-col' }, [
            el('div', { class: 'conflict-col-title', text: t('conflict.remoteVersion') }),
            el('pre', { class: 'conflict-code', text: remoteText })
          ])
        ]),
        el('div', { class: 'conflict-actions' }, [
          UI.button({ label: t('conflict.useRemote'), small: true, variant: 'primary', onClick: function () {
            store.adoptRemote(entry.path);
            finish(entry, row);
          } }),
          UI.button({ label: t('conflict.keepLocal'), small: true, onClick: function () {
            store.keepLocal(entry.path);
            finish(entry, row);
          } }),
          UI.button({ label: t('conflict.later'), small: true, onClick: function () { removeRow(row); } })
        ])
      ]);
      list.appendChild(row);
    });
  }

  /**
   * 拉取远端。发现任何与本地待同步内容的冲突就整批中止，
   * 不写入远端内容、不推送本地改动，弹出冲突窗由用户决定。
   */
  function pullFromRemote(options) {
    options = options || {};
    if (state.syncing) return Promise.resolve({ aborted: true, reason: 'busy' });
    if (state.offline) {
      log(t('log.offlineSkip'));
      return Promise.resolve({ aborted: true, reason: 'offline' });
    }
    if (!client || !state.binding.owner || !state.binding.repo) {
      log(t('log.notBound'));
      if (!options.silent) {
        toast(t('log.notBound'), 'warn');
        settingsPanel.open();
      }
      return Promise.resolve({ aborted: true, reason: 'unbound' });
    }

    state.syncing = true;
    updateHeader();
    log(options.push === false ? t('log.pullStart') : t('log.syncStart'));

    return client.listTree(!!options.force).then(function (treeResult) {
      var files = treeResult.files || [];
      var remoteMap = {};
      files.forEach(function (f) { remoteMap[f.path] = f.sha; });
      (treeResult.folders || []).forEach(function (f) { addFolder(f, true); });
      if (treeResult.fromCache) log(t('log.treeCache'));
      if (treeResult.truncated) {
        log(t('log.treeTruncated'));
        toast(t('log.treeTruncated'), 'warn');
      }

      var pendingPaths = Object.keys(store.pending);
      var changed = files.filter(function (f) {
        var doc = store.get(f.path) || store.docs[f.path];
        return !doc || doc.sha !== f.sha;
      });
      // 有待同步改动的文件优先拉取，确保冲突不会被 maxFetch 截断漏掉
      var priority = changed.filter(function (f) { return pendingPaths.indexOf(f.path) >= 0; });
      var others = changed.filter(function (f) { return pendingPaths.indexOf(f.path) < 0; })
        .slice(0, Math.max(0, (state.settings.maxFetch || 40) - priority.length));
      var toFetch = priority.concat(others);
      if (toFetch.length) log(t('log.fetchCount', { count: toFetch.length }));

      return Promise.all(toFetch.map(function (f) {
        return client.getFile(f.path).then(function (remote) {
          if (!remote) return null;
          var parsed = DocsStore.parse(remote.content);
          return { path: f.path, meta: remoteRecord(f, remote, parsed) };
        });
      })).then(function (fetched) {
        var conflicts = [];
        fetched.forEach(function (item) {
          if (!item || !store.pending[item.path]) return;
          var local = store.docs[item.path];
          if (local) {
            conflicts.push(conflictEntry(item.path, localConflictView(local),
              Object.assign({ deleted: false }, item.meta), 'content'));
          }
        });
        if (!treeResult.truncated) {
          Object.keys(store.docs).forEach(function (path) {
            var doc = store.docs[path];
            if (doc.deleted || !doc.sha || remoteMap[path]) return;
            if (store.pending[path]) {
              conflicts.push(conflictEntry(path, localConflictView(doc),
                { deleted: true, updatedAt: 0, deviceId: '' }, 'delete'));
            }
          });
        }

        if (conflicts.length) {
          conflicts.forEach(function (entry) {
            if (entry.type === 'delete') store.applyRemoteDeletion(entry.path);
            else store.markConflictWithRemote(entry.path, entry.remote, t('conflict.found'));
          });
          log(t('log.pullConflictAbort', { count: conflicts.length }));
          toast(t('toast.conflict'), 'warn');
          showConflictDialog(conflicts);
          refreshExplorer();
          updateStatus();
          return { aborted: true, conflicts: conflicts };
        }

        fetched.forEach(function (item) {
          if (item) store.applyRemote(item.path, item.meta);
        });
        if (!treeResult.truncated) {
          store.list().forEach(function (doc) {
            if (doc.sha && !remoteMap[doc.path] && !store.pending[doc.path]) {
              var result = store.applyRemoteDeletion(doc.path);
              if (result === 'conflict') log(t('log.conflictRemoteDeleted', { path: doc.path }));
            }
          });
        }
        if (options.push !== false) {
          return pushPending().then(function () { return { aborted: false }; });
        }
        return { aborted: false };
      });
    }).then(function (result) {
      if (!result || !result.aborted) {
        state.lastSync = Date.now();
        writeJSON(KEY_LAST_SYNC, state.lastSync);
        if (options.push !== false) {
          log(t('log.syncDone'));
          toast(t('toast.synced'), 'ok');
        } else {
          log(t('log.pullDone'));
        }
      }
      refreshExplorer();
      updateStatus();
      return result;
    }).catch(function (err) {
      log(t('log.syncFail', { msg: err.message }));
      toast(t('log.syncFail', { msg: err.message }), 'error');
      return { aborted: true, error: err };
    }).then(function (result) {
      state.syncing = false;
      updateHeader();
      return result;
    });
  }

  function syncNow(force) {
    return pullFromRemote({ force: !!force, push: true });
  }

  function pushPending() {
    var items = store.pendingList();
    if (!items.length) { log(t('log.noPending')); return Promise.resolve(); }
    log(t('log.pushStart', { count: items.length }));
    var chain = Promise.resolve();
    items.forEach(function (item) {
      chain = chain.then(function () {
        var doc = item.doc;
        var content = DocsStore.serialize(doc);
        if (item.op === 'delete') {
          return client.deleteFile(item.path, 'docs: delete ' + item.path, doc.sha).then(function (res) {
            store.markSynced(item.path, null, null);
            log(t('log.pushed', { path: item.path }));
          });
        }
        return client.putFile(item.path, content, 'docs: update ' + item.path, doc.sha).then(function (res) {
          store.markSynced(item.path, res.sha, null);
          log(t('log.pushed', { path: item.path }));
        }).catch(function (err) {
          if (err.code === 'CONFLICT') {
            log(t('log.uploadConflict', { path: item.path }));
            client.invalidateDoc(item.path);
            return client.getFile(item.path, { force: true }).then(function (remote) {
              if (!remote) { store.markSynced(item.path, null, null); return; }
              var parsed = DocsStore.parse(remote.content);
              store.markConflictWithRemote(item.path, {
                title: parsed.title, tags: parsed.tags, body: parsed.body,
                updatedAt: parsed.updatedAt, deviceId: parsed.deviceId,
                sha: remote.sha, etag: remote.etag
              }, t('log.uploadConflict', { path: item.path }));
              toast(t('toast.conflict'), 'warn');
            });
          }
          throw err;
        });
      });
    });
    return chain;
  }

  // ---------- 历史版本 ----------
  function showHistory(path) {
    if (!client || !state.binding.owner || !state.binding.repo) {
      log(t('log.historyNeedBind')); toast(t('log.historyNeedBind'), 'warn'); return;
    }
    var listNode = el('div', { style: { minWidth: '230px', borderRight: '1px solid var(--border)', paddingRight: '8px' } });
    var detail = el('div', { class: 'markdown-body', style: { flex: '1', overflow: 'auto' } });
    var titleNode = el('h3', { text: t('history.title') });
    var body = el('div', { style: { display: 'flex', gap: '14px', minHeight: '360px' } }, [listNode, detail]);
    var dialog = UI.modal({ title: t('history.title'), wide: true, content: [body], actions: [] });
    titleNode.textContent = t('history.select');
    listNode.appendChild(el('div', { class: 'muted', text: t('history.loading') }));
    client.listCommits(path, 30).then(function (commits) {
      listNode.innerHTML = '';
      if (!commits.length) { listNode.appendChild(el('div', { class: 'muted', text: t('history.empty') })); return; }
      commits.forEach(function (commit) {
        var item = el('div', {
          class: 'tree-item',
          onClick: function () {
            Array.prototype.forEach.call(listNode.querySelectorAll('.tree-item'), function (n) { n.classList.remove('active'); });
            item.classList.add('active');
            detail.textContent = t('history.loading');
            client.getFileAtRef(path, commit.sha).then(function (file) {
              if (!file) return;
              var parsed = DocsStore.parse(file.content);
              var header = el('div', { class: 'muted', style: { marginBottom: '12px' } }, [
                el('div', { text: commit.date + ' · ' + commit.author }),
                el('div', { class: 'mono', text: commit.message })
              ]);
              detail.innerHTML = '';
              detail.appendChild(header);
              var rendered = Markdown.render(parsed.body);
              var article = el('div');
              article.innerHTML = rendered.html;
              detail.appendChild(article);
              detail.appendChild(UI.button({
                label: t('history.restore'), variant: 'primary',
                onClick: function () {
                  store.upsert(path, { title: parsed.title || path, tags: parsed.tags, body: parsed.body });
                  openDoc(path);
                  toast(t('toast.saved', { name: path }), 'ok');
                  dialog.close();
                }
              }));
            }).catch(function (err) { detail.textContent = t('history.loadFailed', { msg: err.message }); });
          }
        }, [
          el('div', { style: { overflow: 'hidden' } }, [
            el('div', { class: 'tree-label', text: commit.message.split('\n')[0] || commit.sha.slice(0, 7) }),
            el('div', { class: 'tree-meta', text: (commit.date || '').slice(0, 16) + ' · ' + commit.author })
          ])
        ]);
        listNode.appendChild(item);
      });
    }).catch(function (err) {
      listNode.innerHTML = '';
      listNode.appendChild(el('div', { class: 'muted', text: t('history.loadFailed', { msg: err.message }) }));
    });
  }

  // ---------- 命令面板 ----------
  function openCommandPalette() {
    var input = UI.input({ placeholder: t('command.placeholder') });
    var list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '320px', overflow: 'auto' } });
    var dialog = UI.modal({
      title: t('command.title'), small: true, focus: input,
      content: [input, el('div', { style: { marginTop: '10px' } }, [list])], actions: []
    });
    function render() {
      var q = input.value.toLowerCase();
      list.innerHTML = '';
      var commands = [
        { iconName: 'filePlus', label: t('command.newDoc'), run: function () { createDoc(''); } },
        { iconName: 'sync', label: t('command.sync'), run: function () { syncNow(); } },
        { iconName: 'settings', label: t('command.settings'), run: function () { settingsPanel.open(); } },
        { iconName: 'moon', label: t('command.toggleTheme'), run: function () { setSetting('theme', state.settings.theme === 'dark' ? 'light' : 'dark'); } }
      ];
      store.list().forEach(function (doc) {
        commands.push({ iconName: 'file', label: t('command.openDoc') + '：' + (doc.title || doc.path), run: function () { openDoc(doc.path); } });
      });
      commands.filter(function (c) { return !q || c.label.toLowerCase().indexOf(q) >= 0; }).forEach(function (c) {
        list.appendChild(el('div', {
          class: 'menu-item',
          onClick: function () { dialog.close(); c.run(); }
        }, [UI.icon(c.iconName), el('span', { text: c.label })]));
      });
      if (!list.children.length) list.appendChild(el('div', { class: 'dropdown-empty', text: t('command.empty') }));
    }
    input.addEventListener('input', render);
    render();
  }

  // ---------- 界面装配 ----------
  function renderTabs() {
    var bar = dom.tabbar;
    if (!bar) return;
    bar.innerHTML = '';
    state.tabs.forEach(function (path) {
      var doc = store.get(path);
      if (!doc) return;
      var tab = el('div', {
        class: 'doc-tab' + (state.activePath === path ? ' active' : ''),
        onClick: function () { openDoc(path); },
        onDblclick: function () { if (state.dirty[path]) saveActive(true); }
      }, [
        UI.icon('file'),
        el('span', { class: 'doc-tab-name', text: doc.title || path.split('/').pop() }),
        (state.dirty[path] ? el('span', { class: 'doc-tab-dirty', title: t('editor.saveLocal') }) : null),
        el('button', {
          type: 'button', class: 'doc-tab-close', text: '×',
          onClick: function (e) { e.stopPropagation(); closeTab(path); }
        })
      ]);
      bar.appendChild(tab);
    });
  }

  function updateHeader() {
    if (!dom.repoBadge) return;
    var bound = client && state.binding.owner;
    dom.repoBadge.textContent = bound
      ? state.binding.owner + '/' + state.binding.repo + ' @ ' + (state.binding.branch || 'main')
      : t('header.localMode');
    dom.repoBadge.classList.toggle('badge-ok', !!bound);
    var offlineButton = dom.offlineBtn;
    if (offlineButton) offlineButton.classList.toggle('btn-danger', state.offline);
    if (offlineButton) offlineButton.querySelector('span:last-child').textContent = state.offline ? t('header.offline') : 'ONLINE';
    var syncBtn = dom.syncBtn;
    if (syncBtn) syncBtn.disabled = state.syncing || state.offline || !bound;
    if (dom.syncLabel) dom.syncLabel.textContent = t('header.sync');
  }

  function updateStatus() {
    var stats = store.stats();
    if (dom.statusDocs) dom.statusDocs.textContent = t('status.docs') + ': ' + stats.count;
    if (dom.statusPending) dom.statusPending.textContent = t('status.pending') + ': ' + stats.pending;
    if (dom.statusUpdated) {
      dom.statusUpdated.textContent = stats.updatedAt
        ? t('status.updated') + ': ' + new Date(stats.updatedAt).toLocaleString()
        : '';
    }
    if (dom.syncStatus) {
      var conflicts = Object.keys(store.docs).filter(function (path) {
        return !!store.docs[path].conflict;
      }).length;
      var bound = !!(client && state.binding.owner && state.binding.repo);
      var cls = 'neutral';
      var text;
      if (state.offline || !bound) {
        text = t('status.sync.never');
      } else if (conflicts || stats.pending > 0) {
        cls = 'bad';
        text = t('status.sync.unsynced') +
          (conflicts ? ' · ' + t('status.sync.conflicts', { count: conflicts }) : '');
      } else if (state.lastSync) {
        cls = 'good';
        text = t('status.sync.last', { time: new Date(state.lastSync).toLocaleTimeString() });
      } else {
        text = t('status.sync.never');
      }
      dom.syncStatus.className = 'sync-status ' + cls;
      dom.syncStatus.textContent = text;
      dom.syncStatus.title = state.lastSync
        ? t('status.sync.lastFull', { time: new Date(state.lastSync).toLocaleString() })
        : t('status.sync.never');
    }
    if (dom.rateStatus && client) {
      var limits = client.getLimits();
      dom.rateStatus.textContent = limits.remaining === null
        ? t('status.localMode')
        : (limits.pausedUntil > Date.now() ? t('status.paused') : t('status.remaining') + ': ' + limits.remaining);
    } else if (dom.rateStatus) {
      dom.rateStatus.textContent = t('status.localMode');
    }
  }

  function buildActivityBar() {
    var bar = dom.activityBar;
    bar.innerHTML = '';
    var buttons = [
      { iconName: 'files', title: 'nav.files', onClick: function () {
        state.settings.showSidebar = state.settings.showSidebar === false;
        dom.workspace.classList.toggle('no-sidebar', state.settings.showSidebar === false);
        writeJSON(KEY_SETTINGS, state.settings);
      } },
      { iconName: 'search', title: 'nav.search', onClick: function () { explorer.focusSearch(); } },
      { iconName: 'history', title: 'nav.history', onClick: function () { if (state.activePath) showHistory(state.activePath); } },
      { iconName: 'command', title: 'command.title', onClick: openCommandPalette }
    ];
    buttons.forEach(function (item, index) {
      var node = UI.iconButton(item.iconName, { title: t(item.title), onClick: item.onClick });
      node.classList.add('activity-btn');
      if (index === 0) node.classList.add('active');
      node.setAttribute('data-i18n-title', item.title);
      bar.appendChild(node);
    });
    bar.appendChild(el('div', { class: 'activity-spacer' }));
    var settingsBtn = UI.iconButton('settings', { title: t('nav.settings'), onClick: function () { settingsPanel.open(); } });
    settingsBtn.classList.add('activity-btn');
    settingsBtn.setAttribute('data-i18n-title', 'nav.settings');
    bar.appendChild(settingsBtn);
  }

  function wireHeader() {
    dom.offlineBtn = el('button', { class: 'btn btn-sm', onClick: function () {
      state.offline = !state.offline;
      updateHeader();
      toast(state.offline ? t('toast.offline') : t('toast.online'), state.offline ? 'warn' : 'ok');
    } }, [UI.icon(state.offline ? 'cloudOff' : 'cloud'), el('span', { text: state.offline ? t('header.offline') : 'ONLINE' })]);
    dom.syncBtn = el('button', { class: 'btn btn-primary btn-sm', onClick: function () { syncNow(false); } }, [
      UI.icon('sync'), el('span', { id: 'syncLabel', text: t('header.sync') })
    ]);
    dom.syncLabel = dom.syncBtn.querySelector('span:last-child');
    var themeBtn = UI.iconButton('moon', { title: t('settings.general.theme'), onClick: function () {
      setSetting('theme', state.settings.theme === 'dark' ? 'light' : 'dark');
    } });
    var settingsBtn = UI.iconButton('settings', { title: t('common.settings'), onClick: function () { settingsPanel.open(); } });
    dom.topbarActions.appendChild(dom.offlineBtn);
    dom.topbarActions.appendChild(dom.syncBtn);
    dom.topbarActions.appendChild(themeBtn);
    dom.topbarActions.appendChild(settingsBtn);
  }

  function refreshExplorer() {
    if (explorer) explorer.refresh();
    updateStatus();
  }

  function init() {
    dom.app = document.getElementById('app');
    dom.workspace = document.getElementById('workspace');
    dom.activityBar = document.getElementById('activityBar');
    dom.sidebar = document.getElementById('sidebar');
    dom.editorRegion = document.getElementById('editorRegion');
    dom.outlineRegion = document.getElementById('outlineRegion');
    dom.repoBadge = document.getElementById('repoBadge');
    dom.syncStatus = document.getElementById('syncStatus');
    dom.topbarActions = document.getElementById('topbarActions');
    dom.statusDocs = document.getElementById('statusDocs');
    dom.statusPending = document.getElementById('statusPending');
    dom.statusUpdated = document.getElementById('statusUpdated');
    dom.rateStatus = document.getElementById('rateStatus');
    dom.logPanel = document.getElementById('logPanel');

    I18n.setLocale(state.settings.locale || 'zh-CN');
    applySettings();

    ctx = {
      t: t, toast: toast, log: log,
      settings: state.settings, setSetting: setSetting, applySettings: applySettings,
      locale: function () { return I18n.locale(); }, locales: function () { return I18n.locales(); },
      setLocale: setLocale,
      binding: state.binding, setBinding: setBinding, refreshClient: refreshClient,
      listRepos: listRepos, listBranches: listBranches,
      getAssetDataUrl: getAssetDataUrl,
      offline: function () { return state.offline; },
      store: null, client: null, folders: state.folders,
      activeDoc: activeDoc, activePath: activePath, isDirty: isDirty,
      openDoc: openDoc, createDoc: createDoc, renameDoc: renameDoc, deleteDoc: deleteDoc,
      createFolder: createFolder, renameFolder: renameFolder, deleteFolder: deleteFolder,
      moveDoc: moveDoc, moveDocPrompt: moveDocPrompt,
      onEditorInput: onEditorInput, saveActive: saveActive, resolveConflict: resolveConflict,
      showHistory: showHistory, syncNow: syncNow, refreshExplorer: refreshExplorer
    };

    store = new DocsStore({ onChange: function () { updateStatus(); } });
    client = createClient();
    ctx.store = store;
    Object.defineProperty(ctx, 'client', { get: function () { return client; }, configurable: true });

    var tabbar = el('div', { class: 'tabbar' });
    dom.editorRegion.appendChild(tabbar);
    var editorMount = el('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } });
    dom.editorRegion.appendChild(editorMount);
    dom.tabbar = tabbar;

    settingsPanel = Features.Settings.create(ctx);
    explorer = Features.Explorer.create(ctx, dom.sidebar);
    editor = Features.Editor.create(ctx, { editor: editorMount, outline: dom.outlineRegion });
    images = Features.Images.create(ctx);
    ctx.editor = editor;
    ctx.images = images;
    ctx.explorer = explorer;
    ctx.settingsPanel = settingsPanel;

    buildActivityBar();
    wireHeader();
    applySettings();
    updateHeader();

    var docs = store.list();
    if (docs.length) openDoc(docs[0].path); else editor.clear();
    refreshExplorer();
    renderTabs();
    updateStatus();
    log(t('log.init', { count: docs.length }));

    // 打开页面先拉取一次：只拉取不上传；发现冲突立即停止并交用户决定
    setTimeout(function () { pullFromRemote({ push: false, silent: true }); }, 0);

    I18n.onChange(function () {
      refreshExplorer();
      renderTabs();
      updateHeader();
      if (editor) editor.renderPreview();
    });

    document.getElementById('logToggle').addEventListener('click', function () {
      dom.logPanel.hidden = !dom.logPanel.hidden;
      if (!dom.logPanel.hidden) dom.logPanel.textContent = state.logs.join('\n');
    });
    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openCommandPalette(); }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveActive(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
