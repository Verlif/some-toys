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
  var KEY_PINNED = 'docs-kb:pinnedTabs';
  var TREE_TTL = 60 * 1000;
  var mobileQuery = window.matchMedia ? window.matchMedia('(max-width: 820px)') : null;

  var defaultSettings = {
    theme: 'light', locale: 'zh-CN', fontSize: 14, tabSize: 2,
    autoSave: true, autoSync: false, autoSyncDelay: 10,
    defaultMode: 'split', showToolbar: true, showOutline: true,
    lineNumbers: true, wordWrap: true, spellCheck: false,
    previewSyncScroll: true, autoCloseBrackets: false, fontFamily: 'mono',
    maxFetch: 40, maxRetries: 2
  };

  var state = {
    settings: Object.assign({}, defaultSettings),
    binding: { token: '', owner: '', repo: '', branch: 'main', rootDir: 'docs', remember: true },
    folders: [],
    lastSync: 0,
    offline: false,
    syncing: false,
    activePath: null,
    tabs: [],
    pinned: [],
    dirty: {},
    logs: [],
    timer: null,
    autoSyncTimer: null
  };

  var dom = {};
  var ctx = {};
  var store, client, explorer, editor, images, settingsPanel;
  var storage = App.Storage;

  function writeJSON(key, value) {
    if (storage) storage.kvPut(key, value).catch(function () { /* 忽略写入失败 */ });
  }

  // 应用元数据（设置 / 绑定 / 文件夹 / 时间 / 固定标签）统一从 IndexedDB 读取
  function loadState() {
    if (!storage) return Promise.resolve();
    return storage.init().then(function () {
      return Promise.all([
        storage.kvGet(KEY_SETTINGS), storage.kvGet(KEY_BINDING), storage.kvGet(KEY_FOLDERS),
        storage.kvGet(KEY_LAST_SYNC), storage.kvGet(KEY_PINNED)
      ]);
    }).then(function (values) {
      var settings = values[0], binding = values[1];
      state.settings = Object.assign({}, defaultSettings, settings && typeof settings === 'object' ? settings : {});
      state.binding = binding && typeof binding === 'object' ? Object.assign({
        token: '', owner: '', repo: '', branch: 'main', rootDir: 'docs', remember: true
      }, binding) : state.binding;
      // 兼容旧版本 addFolder 漏拼路径段产生的 "A/" 等畸形条目，避免树里出现空名文件夹、
      // 也避免导入时 cleanPath 把目标 "A/" 折叠回源文件夹 "A"
      var folders = Array.isArray(values[2]) ? values[2] : [];
      state.folders = [];
      folders.forEach(function (folder) {
        var path = cleanPath(folder);
        if (path && state.folders.indexOf(path) < 0) state.folders.push(path);
      });
      state.folders.slice().forEach(function (path) {
        var parent = dirname(path);
        while (parent) {
          if (state.folders.indexOf(parent) < 0) state.folders.push(parent);
          parent = dirname(parent);
        }
      });
      state.lastSync = Number(values[3]) || 0;
      state.pinned = Array.isArray(values[4]) ? values[4] : [];
    }).catch(function () { /* 存储不可用时保留默认值 */ });
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

  function hasLocalChanges() {
    return !!(store && store.pending && Object.keys(store.pending).length > 0);
  }

  function clearAutoSyncTimer() {
    if (state.autoSyncTimer) clearTimeout(state.autoSyncTimer);
    state.autoSyncTimer = null;
  }

  // 本地每次改动都重新计时；到点后只同步一次，手动同步进行中则顺延
  function autoSyncReady() {
    return state.settings.autoSync && !state.offline && !!state.binding.owner && !!state.binding.repo && hasLocalChanges();
  }

  function scheduleAutoSync() {
    clearAutoSyncTimer();
    if (!autoSyncReady()) return;
    var delay = Math.max(1, Number(state.settings.autoSyncDelay) || 10);
    function run() {
      state.autoSyncTimer = null;
      if (!autoSyncReady()) return;
      if (state.syncing) {
        state.autoSyncTimer = setTimeout(run, 1000);
        return;
      }
      syncNow(false);
    }
    state.autoSyncTimer = setTimeout(run, delay * 1000);
  }

  function setSetting(key, value) {
    state.settings[key] = value;
    writeJSON(KEY_SETTINGS, state.settings);
    applySettings();
    // editor.setMode 内部会在窄屏把 split 归为 source；设置值本身保持不变
    if (key === 'defaultMode' && editor) editor.setMode(value);
    if (key === 'theme') updateHeader();
    if (key === 'maxRetries') refreshClient();
    if (key === 'autoSync') {
      if (value) scheduleAutoSync();
      else clearAutoSyncTimer();
    }
    if (key === 'autoSyncDelay') scheduleAutoSync();
  }

  function applySettings() {
    document.documentElement.setAttribute('data-theme', state.settings.theme === 'dark' ? 'dark' : 'light');
    document.documentElement.style.setProperty('--editor-font-size', (state.settings.fontSize || 14) + 'px');
    var fonts = {
      mono: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
      system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif",
      serif: "Georgia, 'Times New Roman', 'Songti SC', serif"
    };
    document.documentElement.style.setProperty('--editor-font-family', fonts[state.settings.fontFamily] || fonts.mono);
    if (dom.workspace) {
      dom.workspace.classList.toggle('no-outline', state.settings.showOutline === false);
      dom.workspace.classList.toggle('no-sidebar', state.settings.showSidebar === false);
    }
    // 活动栏图标跟随设置同步高亮，保证从设置里切换折叠也与图标状态一致
    if (dom.activityBar) {
      var activityButtons = dom.activityBar.querySelectorAll('.activity-btn');
      if (activityButtons[0]) activityButtons[0].classList.toggle('active', state.settings.showSidebar !== false);
      if (activityButtons[1]) activityButtons[1].classList.toggle('active', state.settings.showOutline !== false);
    }
    if (editor) {
      editor.textarea.style.fontSize = (state.settings.fontSize || 14) + 'px';
      editor.textarea.style.tabSize = state.settings.tabSize || 2;
      editor.textarea.spellcheck = state.settings.spellCheck === true;
      editor.textarea.wrap = state.settings.wordWrap === false ? 'off' : 'soft';
      editor.root.classList.toggle('no-line-numbers', state.settings.lineNumbers === false);
      editor.root.classList.toggle('no-word-wrap', state.settings.wordWrap === false);
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
    scheduleAutoSync();
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

  function dataUrlToBytes(dataUrl) {
    var comma = String(dataUrl).indexOf(',');
    if (comma < 0) return new Uint8Array(0);
    var meta = dataUrl.slice(0, comma);
    var body = dataUrl.slice(comma + 1);
    var binary;
    try { binary = global.atob ? global.atob(body) : ''; } catch (e) { return new Uint8Array(0); }
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
    if (meta.indexOf(';base64') < 0) {
      try { bytes = new TextEncoder().encode(decodeURIComponent(binary)); } catch (e) { /* 保留原字节 */ }
    }
    return bytes;
  }

  function saveAsset(path, dataUrl, mime) {
    if (!storage) return Promise.resolve();
    var record = {
      path: String(path), dataUrl: String(dataUrl),
      mime: mime || (String(dataUrl).match(/^data:([^;,]+)/) || [])[1] || 'application/octet-stream',
      bytes: dataUrlToBytes(dataUrl)
    };
    return storage.init().then(function () { return storage.put('assets', record.path, record); });
  }

  function fetchAsset(path) {
    if (!client || state.offline) return Promise.resolve(null);
    return client.getBinary(path).then(function (file) {
      if (!file) return null;
      if (storage) saveAsset(path, file.dataUrl, file && file.mime).catch(function () {});
      return file.dataUrl;
    }).catch(function () { return null; });
  }

  // 先查 IndexedDB 缓存，未命中再回源 GitHub 并缓存，离线也能查看已缓存图片
  function getAssetDataUrl(path) {
    if (!storage) return fetchAsset(path);
    return storage.init().then(function () { return storage.get('assets', String(path)); })
      .then(function (record) {
        if (record && record.dataUrl) return record.dataUrl;
        if (record && record.bytes) return bytesToDataUrl(record.bytes, record.mime);
        return fetchAsset(path);
      }, function () { return fetchAsset(path); });
  }

  // ---------- 文件夹导出 / 导入（ZIP） ----------

  function cleanPath(path) {
    var parts = String(path == null ? '' : path).replace(/\\/g, '/').split('/');
    var out = [];
    parts.forEach(function (part) {
      if (!part || part === '.') return;
      if (part === '..') { out.pop(); return; }
      out.push(part.replace(/[<>:"|?*]/g, '-'));
    });
    return out.join('/');
  }

  function decodeLink(link) {
    try { return decodeURIComponent(link); } catch (e) { return link; }
  }

  function resolveRel(base, rel) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(rel)) return null;
    return cleanPath((rel.charAt(0) === '/' ? '' : (base || '')) + '/' + rel);
  }

  function relativeBetween(dir, target) {
    var from = dir ? dir.split('/') : [];
    var to = target.split('/');
    var i = 0;
    while (i < from.length && i < to.length && from[i] === to[i]) i++;
    var parts = from.slice(i).map(function () { return '..'; }).concat(to.slice(i));
    return parts.join('/') || target;
  }

  function rewriteLinks(text, oldDir, newDir, mapPath) {
    return String(text || '').replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (full, label, raw) {
      var match = /^(\S+)([\s\S]*)$/.exec(raw.trim());
      if (!match) return full;
      var link = decodeLink(match[1]);
      if (/^(?:data:|https?:|#|\/\/)/i.test(link)) return full;
      var oldAsset = resolveRel(oldDir, link);
      if (!oldAsset) return full;
      var newAsset = mapPath(oldAsset);
      if (!newAsset) return full;
      return '![' + label + '](' + relativeBetween(newDir, newAsset) + match[2] + ')';
    });
  }

  function referencedAssets(docs) {
    var found = {};
    docs.forEach(function (doc) {
      var dir = dirname(doc.path);
      var body = String(doc.body || '');
      var re = /!\[([^\]]*)\]\(([^)]+)\)/g;
      var match;
      while ((match = re.exec(body))) {
        var token = /^(\S+)/.exec(match[2].trim());
        if (!token) continue;
        var link = decodeLink(token[1]);
        if (/^(?:data:|https?:|#|\/\/)/i.test(link)) continue;
        var path = resolveRel(dir, link);
        if (path) found[path] = true;
      }
    });
    return Object.keys(found);
  }

  function mimeForPath(path) {
    var ext = String(path).split('.').pop().toLowerCase();
    var map = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon', bmp: 'image/bmp'
    };
    return map[ext] || 'application/octet-stream';
  }

  function bytesToDataUrl(bytes, mime) {
    var chunk = 0x8000;
    var binary = '';
    var view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    for (var i = 0; i < view.length; i += chunk) {
      binary += String.fromCharCode.apply(null, view.subarray(i, i + chunk));
    }
    var base64 = global.btoa ? global.btoa(binary) : '';
    return 'data:' + (mime || 'application/octet-stream') + ';base64,' + base64;
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 15000);
  }

  function exportArchive(folder) {
    folder = cleanPath(folder || '');
    var docs = store.list().filter(function (doc) {
      return !folder || doc.path.indexOf(folder + '/') === 0 || doc.path === folder;
    });
    if (!docs.length) { toast(t('transfer.empty'), 'warn'); return Promise.resolve(null); }
    var waiting = UI.busy(t('transfer.exporting'));
    var assetPaths = referencedAssets(docs);
    var entries = docs.map(function (doc) {
      return {
        name: doc.path,
        data: DocsStore.serialize({
          title: doc.title, tags: doc.tags, body: doc.body,
          updatedAt: doc.updatedAt, deviceId: doc.deviceId
        })
      };
    });
    var folderPaths = state.folders.filter(function (path) {
      return !folder || path.indexOf(folder + '/') === 0 || path === folder;
    });
    var assetRecords = {};
    var packedAssets = [];

    return (storage ? storage.init().then(function () { return storage.getAll('assets'); }) : Promise.resolve([]))
      .then(function (records) {
        (records || []).forEach(function (record) { if (record && record.path) assetRecords[record.path] = record; });
        assetPaths.forEach(function (path) {
          var record = assetRecords[path];
          if (!record) return;
          var data = record.bytes || (record.dataUrl ? dataUrlToBytes(record.dataUrl) : null);
          if (!data) return;
          entries.push({ name: path, data: data });
          packedAssets.push(path);
        });
        var manifest = {
          version: 1, type: 'docs-kb', root: folder,
          exportedAt: Date.now(),
          docs: docs.map(function (doc) { return doc.path; }),
          folders: folderPaths,
          assets: packedAssets
        };
        entries.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });
        return App.Zip.create(entries);
      }).then(function (bytes) {
        var name = (folder ? folder.split('/').pop() : 'docs-kb') + '.zip';
        downloadBlob(new Blob([bytes], { type: 'application/zip' }), name);
        toast(t('toast.exported', { name: name }), 'ok');
        return name;
      }).catch(function (err) {
        toast(t('transfer.invalidZip', { msg: err && err.message || String(err) }), 'error');
        return null;
      }).then(function (name) { waiting.close(); return name; });
  }

  function mapImportPath(path, sourceRoot, targetPrefix) {
    var relative = path;
    if (sourceRoot && relative.indexOf(sourceRoot + '/') === 0) {
      relative = relative.slice(sourceRoot.length + 1);
    }
    return cleanPath(targetPrefix ? targetPrefix + '/' + relative : relative);
  }

  function parseArchive(bytes) {
    return App.Zip.read(bytes).then(function (files) {
      var byName = {};
      files.forEach(function (file) { byName[file.name] = file; });
      var manifest = byName['manifest.json'] ? JSON.parse(App.Zip.decodeText(byName['manifest.json'].data)) : null;
      var sourceRoot = manifest && manifest.root ? cleanPath(manifest.root) : '';
      var docNames = (manifest && Array.isArray(manifest.docs) ? manifest.docs : files
        .filter(function (file) { return /\.md$/i.test(file.name); })
        .map(function (file) { return file.name; })).filter(function (name) {
        return byName[name] && /\.md$/i.test(name);
      });
      var assetNames = (manifest && Array.isArray(manifest.assets) ? manifest.assets : files
        .filter(function (file) { return !/\.md$/i.test(file.name) && file.name !== 'manifest.json'; })
        .map(function (file) { return file.name; })).filter(function (name) {
        return !!byName[name] && !/\.md$/i.test(name);
      });
      return { files: byName, manifest: manifest, sourceRoot: sourceRoot, docNames: docNames, assetNames: assetNames };
    });
  }

  function buildImportPlan(parsed, target) {
    var plan = { docs: [], assets: [], folders: [], sourceRoot: parsed.sourceRoot, target: target };
    var sourceRoot = parsed.sourceRoot;
    parsed.docNames.forEach(function (name) {
      var to = mapImportPath(name, sourceRoot, target);
      if (!to) return;
      var text = App.Zip.decodeText(parsed.files[name].data);
      plan.docs.push({
        from: name, to: to, text: text,
        local: store.get(to),
        conflict: !!store.get(to)
      });
    });
    parsed.assetNames.forEach(function (name) {
      var to = mapImportPath(name, sourceRoot, target);
      if (to) plan.assets.push({ from: name, to: to, bytes: parsed.files[name].data });
    });
    var manifestFolders = parsed.manifest && Array.isArray(parsed.manifest.folders) ? parsed.manifest.folders : [];
    manifestFolders.forEach(function (folder) {
      var to = mapImportPath(folder, sourceRoot, target);
      if (to && plan.folders.indexOf(to) < 0) plan.folders.push(to);
    });
    plan.docs.forEach(function (item) {
      var dir = dirname(item.to);
      while (dir) {
        if (plan.folders.indexOf(dir) < 0) plan.folders.push(dir);
        dir = dirname(dir);
      }
    });
    return plan;
  }

  function importDialog(plan, onConfirm) {
    var decisions = {};
    var content = [
      el('p', { class: 'muted', text: t('transfer.preview', {
        docs: plan.docs.length, assets: plan.assets.length, folders: plan.folders.length
      }) })
    ];
    if (plan.docs.some(function (item) { return item.conflict; })) {
      content.push(el('p', { class: 'muted', text: t('transfer.conflictIntro') }));
      var list = el('div', { class: 'conflict-list' });
      plan.docs.filter(function (item) { return item.conflict; }).forEach(function (item) {
        var overwriteBtn, skipBtn;
        function choose(value) {
          decisions[item.to] = value;
          overwriteBtn.classList.toggle('btn-primary', value === 'overwrite');
          skipBtn.classList.toggle('btn-primary', value === 'skip');
        }
        skipBtn = UI.button({ label: t('transfer.skip'), onClick: function () { choose('skip'); } });
        overwriteBtn = UI.button({ label: t('transfer.overwrite'), onClick: function () { choose('overwrite'); } });
        var local = item.local;
        var localText = DocsStore.serialize({
          title: local.title, tags: local.tags, body: local.body,
          updatedAt: local.updatedAt, deviceId: local.deviceId
        });
        list.appendChild(el('div', { class: 'conflict-item' }, [
          el('div', { class: 'conflict-item-head', text: item.to }),
          el('div', { class: 'conflict-columns' }, [
            el('div', { class: 'conflict-col' }, [
              el('div', { class: 'conflict-col-title', text: t('conflict.localVersion') }),
              el('pre', { class: 'conflict-code', text: localText.slice(0, 1200) })
            ]),
            el('div', { class: 'conflict-col' }, [
              el('div', { class: 'conflict-col-title', text: t('transfer.incomingVersion') }),
              el('pre', { class: 'conflict-code', text: item.text.slice(0, 1200) })
            ])
          ]),
          el('div', { class: 'conflict-actions' }, [skipBtn, overwriteBtn])
        ]));
      });
      content.push(list);
      content.push(el('div', { class: 'conflict-actions' }, [
        UI.button({ label: t('transfer.skipAll'), onClick: function () {
          plan.docs.forEach(function (item) { if (item.conflict) decisions[item.to] = 'skip'; });
          Array.prototype.forEach.call(list.querySelectorAll('.conflict-item .btn'), function (btn, i) {
            btn.classList.toggle('btn-primary', i % 2 === 0);
          });
        } }),
        UI.button({ label: t('transfer.overwriteAll'), onClick: function () {
          plan.docs.forEach(function (item) { if (item.conflict) decisions[item.to] = 'overwrite'; });
          Array.prototype.forEach.call(list.querySelectorAll('.conflict-item .btn'), function (btn, i) {
            btn.classList.toggle('btn-primary', i % 2 === 1);
          });
        } })
      ]));
    }
    var dialog = UI.modal({
      title: t('transfer.title'),
      wide: true,
      content: content,
      actions: [
        UI.button({ label: t('common.cancel'), onClick: function () { dialog.close(); } }),
        UI.button({ label: t('common.confirm'), variant: 'primary', onClick: function () {
          dialog.close();
          onConfirm(decisions);
        } })
      ]
    });
  }

  function applyImport(plan, decisions) {
    var waiting = UI.busy(t('transfer.importing'));
    var writes = Promise.resolve();
    plan.assets.forEach(function (asset) {
      writes = writes.then(function () {
        if (!storage) return;
        return storage.init().then(function () {
          return storage.put('assets', asset.to, {
            path: asset.to, bytes: asset.bytes,
            dataUrl: '', mime: mimeForPath(asset.to)
          });
        });
      });
    });
    return writes.then(function () {
      var skipped = 0;
      plan.docs.forEach(function (item) {
        if (item.conflict && decisions[item.to] !== 'overwrite') { skipped++; return; }
        var meta = DocsStore.parse(item.text);
        var oldDir = dirname(item.from);
        var newDir = dirname(item.to);
        var body = rewriteLinks(meta.body, oldDir, newDir, function (path) {
          return mapImportPath(path, plan.sourceRoot, plan.target);
        });
        var doc = store.upsert(item.to, {
          title: meta.title, tags: meta.tags, body: body
        });
        if (meta.updatedAt) doc.updatedAt = meta.updatedAt;
      });
      var folders = state.folders.slice();
      plan.folders.forEach(function (folder) {
        if (folders.indexOf(folder) < 0) folders.push(folder);
      });
      state.folders = folders;
      writeJSON(KEY_FOLDERS, folders);
      ctx.folders = folders;
      refreshExplorer();
      renderTabs();
      updateStatus();
      scheduleAutoSync();
      toast(t('toast.imported', {
        docs: plan.docs.length - skipped, assets: plan.assets.length, skipped: skipped
      }), 'ok');
    }).catch(function (err) {
      toast(t('transfer.invalidZip', { msg: err && err.message || String(err) }), 'error');
    }).then(function () { waiting.close(); });
  }

  function pickZip(callback) {
    var picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.zip,application/zip';
    picker.style.display = 'none';
    document.body.appendChild(picker);
    picker.addEventListener('change', function () {
      var file = picker.files && picker.files[0];
      picker.remove();
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { callback(new Uint8Array(reader.result)); };
      reader.onerror = function () { toast(t('transfer.invalidZip', { msg: 'FileReader' }), 'error'); };
      reader.readAsArrayBuffer(file);
    });
    picker.click();
  }

  function importArchive(folder) {
    folder = cleanPath(folder || '');
    pickZip(function (bytes) {
      parseArchive(bytes).then(function (parsed) {
        if (parsed.manifest) parsed.sourceRoot = cleanPath(parsed.manifest.root || '');
        else parsed.sourceRoot = '';
        var plan = buildImportPlan(parsed, folder);
        if (!plan.docs.length && !plan.assets.length) {
          toast(t('transfer.empty'), 'warn');
          return;
        }
        importDialog(plan, function (decisions) { return applyImport(plan, decisions); });
      }).catch(function (err) {
        var msg = err && err.message || String(err);
        var key = /DEFLATE unsupported|Unsupported ZIP compression/i.test(msg) ? 'transfer.noDeflate' : 'transfer.invalidZip';
        toast(t(key, { msg: msg }), 'error');
      });
    });
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

  function writePinned(paths) {
    state.pinned = paths;
    writeJSON(KEY_PINNED, state.pinned);
  }

  function closeTab(path) {
    var index = state.tabs.indexOf(path);
    if (index < 0) return;
    if (state.dirty[path]) {
      var doc = store.get(path);
      if (doc && state.activePath === path) saveActive(true);
    }
    state.tabs.splice(index, 1);
    if (state.pinned.indexOf(path) >= 0) writePinned(state.pinned.filter(function (p) { return p !== path; }));
    if (state.activePath === path) {
      state.activePath = state.tabs[Math.max(0, index - 1)] || null;
      if (state.activePath) editor.open(store.get(state.activePath));
      else editor.clear();
    }
    renderTabs();
    refreshExplorer();
  }

  /** 批量关闭标签：逐个走 closeTab，保留脏文档保存与活动标签切换的既有逻辑 */
  function closeTabs(paths) {
    paths.slice().forEach(function (path) { closeTab(path); });
  }

  function togglePin(path) {
    var index = state.pinned.indexOf(path);
    if (index >= 0) writePinned(state.pinned.filter(function (p) { return p !== path; }));
    else writePinned(state.pinned.concat([path]));
    renderTabs();
  }

  function activeDoc() { return state.activePath ? store.get(state.activePath) : null; }
  function activePath() { return state.activePath; }
  function isDirty(path) { return !!state.dirty[path]; }

  /** 红点=本地未保存，黄点=已保存本地待同步，绿点=已同步无改动 */
  function docStatus(path) {
    if (state.dirty[path]) return 'dirty';
    var doc = store.get(path);
    if (!doc) return 'synced';
    if (store.pending[path] || !doc.sha) return 'pending';
    return 'synced';
  }

  function statusDot(path) {
    var status = docStatus(path);
    return el('span', {
      class: 'doc-status-dot doc-status-' + status,
      title: t('doc.status.' + status), dataset: { docStatus: status }
    });
  }

  /** 输入时不重绘整棵树，只就地更新对应文档的状态点 */
  function updateDocStatusDots(path) {
    var status = docStatus(path);
    var title = t('doc.status.' + status);
    document.querySelectorAll('.tree-item[data-path], .doc-tab[data-path]').forEach(function (node) {
      if (node.dataset.path !== path) return;
      var dot = node.querySelector('.doc-status-dot');
      if (dot) {
        dot.className = 'doc-status-dot doc-status-' + status;
        dot.dataset.docStatus = status;
        dot.title = title;
      }
      var label = node.querySelector('.tree-label');
      if (label) {
        label.classList.toggle('doc-name-dirty', status === 'dirty');
        label.classList.toggle('doc-name-pending', status === 'pending' && state.settings.autoSync !== false && !state.offline);
      }
    });
  }

  function syncDraftTitle() {
    if (!state.activePath) return;
    var doc = store.get(state.activePath);
    if (!doc) return;
    var title = editor.titleInput.value.trim();
    if (title && doc.title !== title) doc.title = title; // 仅更新内存标题用于即时展示，保存由 store.upsert 负责
  }

  /** 标题变化时就地更新标签页；文件树始终显示真实文件名（含 .md） */
  function updateDocTitleLabels(path) {
    var doc = store.get(path);
    var fileName = path.split('/').pop();
    var tabNameText = (doc && doc.title) || fileName.replace(/\.md$/i, '');
    document.querySelectorAll('.doc-tab[data-path], .tree-item[data-type="doc"][data-path]').forEach(function (node) {
      if (node.dataset.path !== path) return;
      var tabName = node.querySelector('.doc-tab-name');
      if (tabName) tabName.textContent = tabNameText;
      var treeLabel = node.querySelector('.tree-label');
      // 文件树标签内还包含状态点，只改第一个文本节点，避免把状态点删掉
      if (treeLabel && treeLabel.firstChild && treeLabel.firstChild.nodeType === 3) treeLabel.firstChild.nodeValue = fileName;
    });
  }

  function onEditorInput() {
    if (!state.activePath) return;
    state.dirty[state.activePath] = true;
    syncDraftTitle();
    editor.updateDirty();
    renderTabs();
    updateDocTitleLabels(state.activePath);
    updateDocStatusDots(state.activePath);
    if (state.settings.autoSave !== false) {
      clearTimeout(state.timer);
      state.timer = setTimeout(function () { saveActive(true); }, 800);
    }
  }

  function saveActive(silent) {
    if (!state.activePath) return;
    var draft = editor.getDraft();
    store.upsert(state.activePath, draft);
    scheduleAutoSync();
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
      scheduleAutoSync();
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
      store.rename(path, target, name.trim());
      scheduleAutoSync();
      state.tabs = state.tabs.map(function (p) { return p === path ? target : p; });
      if (state.pinned.indexOf(path) >= 0) writePinned(state.pinned.map(function (p) { return p === path ? target : p; }));
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
    scheduleAutoSync();
    state.tabs = state.tabs.map(function (p) { return p === oldPath ? newPath : p; });
    if (state.pinned.indexOf(oldPath) >= 0) writePinned(state.pinned.map(function (p) { return p === oldPath ? newPath : p; }));
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
      scheduleAutoSync();
      delete state.dirty[path];
      state.tabs = state.tabs.filter(function (p) { return p !== path; });
      if (state.pinned.indexOf(path) >= 0) writePinned(state.pinned.filter(function (p) { return p !== path; }));
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
      prefix = prefix ? prefix + '/' + part : part;
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
    scheduleAutoSync();
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
    // 空仓库自动初始化后的重试需要复用同一次同步会话，不能被 busy guard 拦住
    if (state.syncing && !options._emptyRepoRetried) return Promise.resolve({ aborted: true, reason: 'busy' });
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
      renderTabs();
      updateStatus();
      return result;
    }).catch(function (err) {
      // 空仓库信号可能来自 tree 读取或首次写入；无论哪一步，都自动建初始提交并重试本轮同步
      if (err.code === 'EMPTY_REPO' && !options._emptyRepoRetried && client && client._bootstrapEmptyRepo) {
        log(t('log.emptyRepoInit'));
        return client._bootstrapEmptyRepo().then(function () {
          var retry = Object.assign({}, options, { _emptyRepoRetried: true, force: true });
          return pullFromRemote(retry);
        }).catch(function (bootErr) {
          log(t('log.syncFail', { msg: bootErr.message }));
          toast(t('log.syncFail', { msg: bootErr.message }), 'error');
          return { aborted: true, error: bootErr };
        });
      }
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
                  scheduleAutoSync();
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
        { iconName: 'download', label: t('explorer.exportAll'), run: function () { exportArchive(''); } },
        { iconName: 'upload', label: t('explorer.importAll'), run: function () { importArchive(''); } },
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
  function showTabMenu(e, path) {
    e.preventDefault();
    openDoc(path);
    var index = state.tabs.indexOf(path);
    var isPinned = state.pinned.indexOf(path) >= 0;
    UI.menu([
      { label: t('tab.closeOthers'), i18n: 'tab.closeOthers', onSelect: function () { closeTabs(state.tabs.filter(function (p) { return p !== path; })); } },
      { label: t('tab.closeLeft'), i18n: 'tab.closeLeft', disabled: index <= 0, onSelect: function () { closeTabs(state.tabs.slice(0, index)); } },
      { label: t('tab.closeRight'), i18n: 'tab.closeRight', disabled: index >= state.tabs.length - 1, onSelect: function () { closeTabs(state.tabs.slice(index + 1)); } },
      { label: t('tab.closeAll'), i18n: 'tab.closeAll', onSelect: function () { closeTabs(state.tabs.slice()); } },
      '-',
      { label: t(isPinned ? 'tab.unpin' : 'tab.pin'), i18n: isPinned ? 'tab.unpin' : 'tab.pin', onSelect: function () { togglePin(path); } }
    ], e.clientX, e.clientY);
  }

  function renderTabs() {
    var bar = dom.tabbar;
    var pinnedBar = dom.pinnedTabbar;
    if (!bar || !pinnedBar) return;
    // 文档删除或同步移除后，固定列表里不能留失效路径
    state.pinned = state.pinned.filter(function (p) { return state.tabs.indexOf(p) >= 0; });
    bar.innerHTML = '';
    pinnedBar.innerHTML = '';
    function makeTab(path, pinned) {
      var doc = store.get(path);
      if (!doc) return null;
      var children = [UI.icon('file')];
      if (pinned) children.push(el('span', { class: 'doc-tab-pinned', text: t('tab.pin') }));
      children.push(
        el('span', { class: 'doc-tab-name', text: doc.title || path.split('/').pop() }),
        statusDot(path),
        el('button', {
          type: 'button', class: 'doc-tab-close', text: '×',
          onClick: function (e) { e.stopPropagation(); closeTab(path); }
        })
      );
      return el('div', {
        class: 'doc-tab' + (pinned ? ' pinned' : '') + (state.activePath === path ? ' active' : ''),
        dataset: { path: path },
        onClick: function () { openDoc(path); },
        onDblclick: function () { if (state.dirty[path]) saveActive(true); },
        onContextmenu: function (e) { showTabMenu(e, path); }
      }, children);
    }
    state.tabs.forEach(function (path) {
      var tab = makeTab(path, state.pinned.indexOf(path) >= 0);
      if (!tab) return;
      (state.pinned.indexOf(path) >= 0 ? pinnedBar : bar).appendChild(tab);
    });
    pinnedBar.hidden = state.pinned.length === 0;
  }

  function replaceButtonIcon(button, name) {
    if (!button) return;
    var old = button.querySelector('.icon');
    if (!old) return;
    old.parentNode.replaceChild(UI.icon(name), old);
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
    if (offlineButton) {
      replaceButtonIcon(offlineButton, state.offline ? 'cloudOff' : 'cloud');
      offlineButton.querySelector('span:last-child').textContent = state.offline ? t('header.offline') : t('header.online');
    }
    replaceButtonIcon(dom.themeBtn, state.settings.theme === 'dark' ? 'sun' : 'moon');
    var syncBtn = dom.syncBtn;
    if (syncBtn) {
      syncBtn.disabled = state.syncing || state.offline || !bound;
      syncBtn.classList.toggle('is-syncing', state.syncing);
      syncBtn.setAttribute('aria-busy', state.syncing ? 'true' : 'false');
    }
    if (dom.syncLabel) dom.syncLabel.textContent = t(state.syncing ? 'header.syncing' : 'header.sync');
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
    var filesButton = null;
    var outlineButton = null;
    var buttons = [
      { iconName: 'files', title: 'nav.files', onClick: function () {
        // 统一走 setSetting：class、持久化与页面初始化使用同一份状态
        var show = state.settings.showSidebar === false;
        setSetting('showSidebar', show);
        if (filesButton) filesButton.classList.toggle('active', show);
      } },
      { iconName: 'panelRight', title: 'outline.title', onClick: function () {
        // 像 IDEA 一样用左侧活动栏图标折叠/展开右侧大纲
        var show = state.settings.showOutline === false;
        setSetting('showOutline', show);
        if (outlineButton) outlineButton.classList.toggle('active', show);
      } },
      { iconName: 'search', title: 'nav.search', onClick: function () { explorer.focusSearch(); } },
      { iconName: 'history', title: 'nav.history', onClick: function () { if (state.activePath) showHistory(state.activePath); } },
      { iconName: 'command', title: 'command.title', onClick: openCommandPalette }
    ];
    buttons.forEach(function (item, index) {
      var node = UI.iconButton(item.iconName, { title: t(item.title), onClick: item.onClick });
      node.classList.add('activity-btn');
      if (index === 0) {
        filesButton = node;
        if (state.settings.showSidebar !== false) node.classList.add('active');
      }
      if (index === 1) {
        outlineButton = node;
        if (state.settings.showOutline !== false) node.classList.add('active');
      }
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
      if (state.offline) clearAutoSyncTimer();
      else scheduleAutoSync();
      updateHeader();
      toast(state.offline ? t('toast.offline') : t('toast.online'), state.offline ? 'warn' : 'ok');
    } }, [UI.icon(state.offline ? 'cloudOff' : 'cloud'), el('span', { text: state.offline ? t('header.offline') : t('header.online') })]);
    dom.syncBtn = el('button', { class: 'btn btn-primary btn-sm', onClick: function () { syncNow(false); } }, [
      UI.icon('sync'), el('span', { id: 'syncLabel', text: t('header.sync') })
    ]);
    dom.syncLabel = dom.syncBtn.querySelector('span:last-child');
    // 右上角只保留一个主题切换按钮；设置入口统一放在左下角活动栏
    var themeBtn = UI.iconButton('moon', { title: t('settings.general.theme'), class: 'topbar-icon', onClick: function () {
      setSetting('theme', state.settings.theme === 'dark' ? 'light' : 'dark');
    } });
    themeBtn.setAttribute('data-i18n-title', 'settings.general.theme');
    dom.themeBtn = themeBtn;
    dom.topbarActions.appendChild(dom.offlineBtn);
    dom.topbarActions.appendChild(dom.syncBtn);
    dom.topbarActions.appendChild(themeBtn);
  }

  function isMobileLayout() { return !!(mobileQuery && mobileQuery.matches); }

  function setMobilePage(page) {
    if (!dom.app || !dom.mobileSegment) return;
    var target = ['files', 'editor', 'outline'].indexOf(page) >= 0 ? page : 'editor';
    dom.app.setAttribute('data-mobile-page', target);
    Array.prototype.forEach.call(dom.mobileSegment.querySelectorAll('button[data-mobile-page]'), function (button) {
      button.classList.toggle('active', button.getAttribute('data-mobile-page') === target);
    });
    if (target === 'files') refreshExplorer();
    if (target === 'outline' && editor) editor.renderPreview();
  }

  function wireMobileSegment() {
    if (!dom.mobileSegment) return;
    dom.mobileSegment.addEventListener('click', function (e) {
      var button = e.target;
      while (button && button !== dom.mobileSegment && !button.hasAttribute('data-mobile-page')) button = button.parentNode;
      if (button && button !== dom.mobileSegment) setMobilePage(button.getAttribute('data-mobile-page'));
    });
    setMobilePage(dom.app.getAttribute('data-mobile-page') || 'editor');
  }

  function onViewportChange() {
    if (!editor) return;
    if (isMobileLayout()) {
      // 进入窄屏：分栏降级为源码，只显示一个面板
      if (editor.mode() === 'split') editor.setMode('source');
    } else {
      // 回到宽屏：恢复设置里保存的模式（可能是 split）
      editor.setMode(state.settings.defaultMode || 'split');
    }
  }

  function refreshExplorer() {
    // renameFolder/deleteFolder 会重建 state.folders 数组，同步引用避免树读取旧数据
    if (ctx) ctx.folders = state.folders;
    if (explorer) explorer.refresh();
    updateStatus();
  }

  /** 所有带 title 的控件统一用自定义悬浮提示，0.5 秒延迟显示 */
  function wireTooltips() {
    var tip = null;
    var timer = null;
    var current = null;
    function hide() {
      clearTimeout(timer);
      if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
      tip = null;
      current = null;
    }
    document.addEventListener('mouseover', function (e) {
      if (!e.target || !e.target.closest) return;
      var node = e.target.closest('[title], [data-tooltip]');
      if (!node || node === current) return;
      hide();
      current = node;
      var text = node.getAttribute('data-tooltip') || node.getAttribute('title');
      if (!text) return;
      if (!node.hasAttribute('data-tooltip')) {
        // 去掉原生 title，避免浏览器自己的延迟与自定义提示重叠
        node.setAttribute('aria-label', text);
        node.setAttribute('data-tooltip', text);
        node.removeAttribute('title');
      }
      timer = setTimeout(function () {
        if (current !== node) return;
        tip = el('div', { class: 'ui-tooltip', text: text });
        document.body.appendChild(tip);
        var r = node.getBoundingClientRect();
        var tr = tip.getBoundingClientRect();
        var left = Math.max(8, Math.min(window.innerWidth - tr.width - 8, r.left + r.width / 2 - tr.width / 2));
        var top = r.bottom + 8;
        if (top + tr.height > window.innerHeight - 8) top = r.top - tr.height - 8;
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
      }, 500);
    });
    document.addEventListener('mouseout', function (e) {
      if (!current) return;
      if (e.relatedTarget && current.contains(e.relatedTarget)) return;
      hide();
    });
    window.addEventListener('scroll', hide, true);
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
    dom.mobileSegment = document.getElementById('mobileSegment');
    dom.statusDocs = document.getElementById('statusDocs');
    dom.statusPending = document.getElementById('statusPending');
    dom.statusUpdated = document.getElementById('statusUpdated');
    dom.rateStatus = document.getElementById('rateStatus');
    dom.logPanel = document.getElementById('logPanel');

    // 应用元数据、语言与 API 缓存都改为 IndexedDB 异步读取，加载完再装配界面
    loadState().then(function () {
      return Promise.all([I18n.ready, global.GitHubDocs.ready]);
    }).then(function () {
      startUI();
    }).catch(function (err) {
      if (global.console) console.error('[docs-kb] init failed:', err);
      startUI();
    });
  }

  function startUI() {
    I18n.setLocale(state.settings.locale || 'zh-CN');
    applySettings();

    ctx = {
      t: t, toast: toast, log: log,
      settings: state.settings, setSetting: setSetting, applySettings: applySettings,
      locale: function () { return I18n.locale(); }, locales: function () { return I18n.locales(); },
      setLocale: setLocale,
      binding: state.binding, setBinding: setBinding, refreshClient: refreshClient,
      listRepos: listRepos, listBranches: listBranches,
      getAssetDataUrl: getAssetDataUrl, saveAsset: saveAsset, storage: storage,
      exportFolder: exportArchive, importFolder: importArchive,
      exportAll: function () { exportArchive(''); },
      importAll: function () { importArchive(''); },
      offline: function () { return state.offline; },
      store: null, client: null, folders: state.folders,
      activeDoc: activeDoc, activePath: activePath, isDirty: isDirty,
      docStatus: docStatus, statusDot: statusDot,
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

    var pinnedTabbar = el('div', { class: 'tabbar tabbar-pinned', hidden: true });
    var tabbar = el('div', { class: 'tabbar' });
    dom.editorRegion.appendChild(pinnedTabbar);
    dom.editorRegion.appendChild(tabbar);
    var editorMount = el('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } });
    dom.editorRegion.appendChild(editorMount);
    dom.pinnedTabbar = pinnedTabbar;
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
    wireMobileSegment();
    wireTooltips();
    if (mobileQuery) {
      if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', onViewportChange);
      else if (mobileQuery.addListener) mobileQuery.addListener(onViewportChange);
    }
    onViewportChange();
    applySettings();
    updateHeader();

    store.ready.then(function () {
      var docs = store.list();
      if (docs.length) openDoc(docs[0].path); else editor.clear();
      refreshExplorer();
      renderTabs();
      updateStatus();
      log(t('log.init', { count: docs.length }));
      // 打开页面先拉取一次：只拉取不上传；发现冲突立即停止并交用户决定
      setTimeout(function () { pullFromRemote({ push: false, silent: true }); }, 0);
    }).catch(function (err) {
      if (global.console) console.error('[docs-kb] store ready failed:', err);
    });

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
