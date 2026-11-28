/**
 * Storage - IndexedDB 存储层（零依赖）
 *
 * 数据库 docs-kb，版本 1，对象仓库：
 *   docs       keyPath=path   文档记录（含 body / conflict / remote）
 *   pending    keyPath=path   待同步队列
 *   folders    keyPath=path   文件夹占位
 *   kv         keyPath=key    设置、绑定、tree、deviceId 等单值
 *   apiCache   keyPath=key    GitHub GET 响应缓存
 *   assets     keyPath=path   图片二进制（Blob）
 *
 * 首次启动会把旧版 localStorage 数据迁移到 IndexedDB 并清除旧键。
 * 若浏览器禁用 IndexedDB（例如某些 file:// 环境），自动降级为
 * localStorage 的异步兼容层，功能不受影响。
 */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};

  var DB_NAME = 'docs-kb';
  var DB_VERSION = 1;
  var STORES = {
    docs: 'path',
    pending: 'path',
    folders: 'path',
    kv: 'key',
    apiCache: 'key',
    assets: 'path'
  };
  var LEGACY = {
    docs: 'docs-kb:docs',
    pending: 'docs-kb:pending',
    tree: 'docs-kb:tree',
    settings: 'docs-kb:settings',
    binding: 'docs-kb:binding',
    lastSync: 'docs-kb:lastSync',
    pinned: 'docs-kb:pinnedTabs',
    device: 'docs-kb:device',
    locale: 'docs-kb:locale',
    apiCache: 'docs-kb:api-cache'
  };
  var FALLBACK_PREFIX = 'docs-kb:idb:';
  var LEGACY_BINDING = 'config-sync:github-binding';

  var db = null;
  var backend = 'indexeddb';
  var initPromise = null;

  function ls() {
    try { return global.localStorage || null; } catch (e) { return null; }
  }

  function idbAvailable() {
    try { return !!(global.indexedDB && global.indexedDB.open); } catch (e) { return false; }
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!idbAvailable()) { reject(new Error('IndexedDB unavailable')); return; }
      var request;
      try { request = global.indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { reject(e); return; }
      request.onupgradeneeded = function () {
        var database = request.result;
        Object.keys(STORES).forEach(function (name) {
          if (!database.objectStoreNames.contains(name)) {
            database.createObjectStore(name, { keyPath: STORES[name] });
          }
        });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB open failed')); };
      request.onblocked = function () { reject(new Error('IndexedDB blocked')); };
    });
  }

  function requestPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB request failed')); };
    });
  }

  function transactionPromise(transaction) {
    return new Promise(function (resolve, reject) {
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () { reject(transaction.error || new Error('IndexedDB transaction failed')); };
      transaction.onabort = function () { reject(transaction.error || new Error('IndexedDB transaction aborted')); };
    });
  }

  function fallbackKey(store, key) {
    return FALLBACK_PREFIX + store + ':' + encodeURIComponent(String(key));
  }

  function fallbackPrefix(store) { return FALLBACK_PREFIX + store + ':'; }

  function fallbackGetAll(store) {
    var storage = ls();
    var result = [];
    if (!storage) return result;
    var prefix = fallbackPrefix(store);
    for (var i = 0; i < storage.length; i++) {
      var key = storage.key(i);
      if (!key || key.indexOf(prefix) !== 0) continue;
      var raw = storage.getItem(key);
      if (!raw) continue;
      try { result.push(JSON.parse(raw)); } catch (e) { /* 跳过损坏记录 */ }
    }
    return result;
  }

  var Storage = {
    /** 打开数据库、选择后端并完成旧数据迁移；可重复调用，返回同一个 Promise */
    init: function () {
      if (!initPromise) {
        initPromise = openDatabase().then(function (database) {
          db = database;
          backend = 'indexeddb';
          db.onversionchange = function () { db.close(); db = null; initPromise = null; };
        }).catch(function () {
          backend = 'localstorage';
        }).then(function () {
          return Storage.migrateLegacy();
        }).then(function () { return true; });
      }
      return initPromise;
    },

    backend: function () { return backend; },

    /** kv 仓库里的标量值以 { key, value } 包装，读取时统一拆包 */
    kvGet: function (key) {
      return Storage.get('kv', key).then(function (record) {
        if (!record || typeof record !== 'object') return record;
        var keys = Object.keys(record);
        if (keys.length === 2 && Object.prototype.hasOwnProperty.call(record, 'value')) return record.value;
        return record;
      });
    },

    kvPut: function (key, value) {
      var record = value;
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        record = { key: key, value: value };
      }
      return Storage.put('kv', key, record);
    },

    get: function (store, key) {
      if (!STORES[store]) return Promise.resolve(null);
      if (backend === 'indexeddb' && db) {
        try {
          return requestPromise(db.transaction(store, 'readonly').objectStore(store).get(key))
            .then(function (value) { return value === undefined ? null : value; });
        } catch (e) { return Promise.resolve(null); }
      }
      var raw = ls() && ls().getItem(fallbackKey(store, key));
      if (!raw) return Promise.resolve(null);
      try { return Promise.resolve(JSON.parse(raw)); } catch (e) { return Promise.resolve(null); }
    },

    getAll: function (store) {
      if (!STORES[store]) return Promise.resolve([]);
      if (backend === 'indexeddb' && db) {
        return new Promise(function (resolve, reject) {
          var result = [];
          var transaction;
          try { transaction = db.transaction(store, 'readonly'); }
          catch (e) { reject(e); return; }
          var request = transaction.objectStore(store).openCursor();
          request.onsuccess = function () {
            var cursor = request.result;
            if (cursor) { result.push(cursor.value); cursor.continue(); }
          };
          request.onerror = function () { reject(request.error || new Error('IndexedDB cursor failed')); };
          transaction.oncomplete = function () { resolve(result); };
        });
      }
      return Promise.resolve(fallbackGetAll(store));
    },

    put: function (store, key, value) {
      return Storage.putMany(store, [{ key: key, value: value }]);
    },

    /** entries: [{ key, value }]，同仓库一次事务写入 */
    putMany: function (store, entries) {
      if (!STORES[store] || !entries || !entries.length) return Promise.resolve();
      if (backend === 'indexeddb' && db) {
        return new Promise(function (resolve, reject) {
          var transaction;
          try { transaction = db.transaction(store, 'readwrite'); }
          catch (e) { reject(e); return; }
          var objectStore = transaction.objectStore(store);
          entries.forEach(function (entry) {
            var record = entry.value;
            if (!record || typeof record !== 'object') {
              record = {};
              record[STORES[store]] = entry.key;
              record.value = entry.value;
            } else if (record[STORES[store]] === undefined) {
              // 避免破坏调用方对象：只补 keyPath 字段
              record[STORES[store]] = entry.key;
            }
            objectStore.put(record);
          });
          transaction.oncomplete = function () { resolve(); };
          transaction.onerror = function () { reject(transaction.error || new Error('IndexedDB write failed')); };
          transaction.onabort = function () { reject(transaction.error || new Error('IndexedDB write aborted')); };
        });
      }
      var storage = ls();
      if (!storage) return Promise.resolve();
      entries.forEach(function (entry) {
        var record = entry.value;
        if (!record || typeof record !== 'object') {
          record = {}; record[STORES[store]] = entry.key; record.value = entry.value;
        } else if (record[STORES[store]] === undefined) {
          record = Object.assign({}, record);
          record[STORES[store]] = entry.key;
        }
        try { storage.setItem(fallbackKey(store, entry.key), JSON.stringify(record)); } catch (e) { /* 容量不足时忽略 */ }
      });
      return Promise.resolve();
    },

    del: function (store, key) {
      if (!STORES[store]) return Promise.resolve();
      if (backend === 'indexeddb' && db) {
        return new Promise(function (resolve, reject) {
          var transaction;
          try { transaction = db.transaction(store, 'readwrite'); }
          catch (e) { reject(e); return; }
          transaction.objectStore(store).delete(key);
          transaction.oncomplete = function () { resolve(); };
          transaction.onerror = function () { reject(transaction.error || new Error('IndexedDB delete failed')); };
        });
      }
      var storage = ls();
      if (storage) storage.removeItem(fallbackKey(store, key));
      return Promise.resolve();
    },

    clear: function (store) {
      if (!STORES[store]) return Promise.resolve();
      if (backend === 'indexeddb' && db) {
        return new Promise(function (resolve, reject) {
          var transaction;
          try { transaction = db.transaction(store, 'readwrite'); }
          catch (e) { reject(e); return; }
          transaction.objectStore(store).clear();
          transaction.oncomplete = function () { resolve(); };
          transaction.onerror = function () { reject(transaction.error || new Error('IndexedDB clear failed')); };
        });
      }
      var storage = ls();
      if (!storage) return Promise.resolve();
      var prefix = fallbackPrefix(store);
      var keys = [];
      for (var i = 0; i < storage.length; i++) {
        var key = storage.key(i);
        if (key && key.indexOf(prefix) === 0) keys.push(key);
      }
      keys.forEach(function (key) { storage.removeItem(key); });
      return Promise.resolve();
    },

    /** 旧版 localStorage → IndexedDB 一次性迁移 */
    migrateLegacy: function () {
      var storage = ls();
      if (!storage) return Promise.resolve(0);
      var done = null;
      try { done = JSON.parse(storage.getItem(LEGACY.done) || 'null'); } catch (e) { done = null; }
      if (done) return Promise.resolve(0);

      var chain = Promise.resolve();
      var count = 0;

      function legacyJSON(key) {
        try { var raw = storage.getItem(key); return raw ? JSON.parse(raw) : null; }
        catch (e) { return null; }
      }
      function queue(store, entries) {
        if (!entries.length) return;
        count += entries.length;
        chain = chain.then(function () { return Storage.putMany(store, entries); })
          .catch(function () { /* 单批失败不阻断其他数据 */ });
      }

      var docs = legacyJSON(LEGACY.docs);
      if (docs && typeof docs === 'object') {
        queue('docs', Object.keys(docs).map(function (path) {
          var doc = docs[path] || {};
          if (!doc.path) doc.path = path;
          return { key: path, value: doc };
        }));
      }
      var pending = legacyJSON(LEGACY.pending);
      if (pending && typeof pending === 'object') {
        queue('pending', Object.keys(pending).map(function (path) {
          var item = pending[path] || {};
          if (!item.path) item.path = path;
          return { key: path, value: item };
        }));
      }
      var folders = legacyJSON(LEGACY.folders);
      if (Array.isArray(folders)) {
        queue('folders', folders.filter(Boolean).map(function (path) {
          return { key: path, value: { path: path } };
        }));
      }
      var tree = legacyJSON(LEGACY.tree);
      if (tree && typeof tree === 'object') queue('kv', [{ key: 'tree', value: tree }]);
      ['settings', 'binding', 'lastSync', 'pinned', 'device', 'locale'].forEach(function (name) {
        var value = legacyJSON(LEGACY[name]);
        if (value !== null && value !== undefined) {
          count++;
          chain = chain.then(function () { return Storage.kvPut(name, value); })
            .catch(function () { /* 忽略单条失败 */ });
        }
      });
      var apiCache = legacyJSON(LEGACY.apiCache);
      if (apiCache && typeof apiCache === 'object') {
        queue('apiCache', Object.keys(apiCache).map(function (key) {
          var item = apiCache[key] || {};
          if (!item.key) item.key = key;
          return { key: key, value: item };
        }));
      }
      // 兼容旧版 config-sync demo：未绑定过时把它转成 binding
      if (!legacyJSON(LEGACY.binding)) {
        var oldBinding = legacyJSON(LEGACY_BINDING);
        if (oldBinding && oldBinding.repo) {
          var parts = String(oldBinding.repo).split('/');
          queue('kv', [{ key: 'binding', value: {
            token: oldBinding.token || '', owner: parts[0] || '', repo: parts[1] || '',
            branch: oldBinding.branch || 'main', rootDir: oldBinding.path || 'docs', remember: true
          } }]);
        }
      }

      return chain.then(function () {
        return Storage.put('kv', 'migrationDone', Date.now());
      }).then(function () {
        Object.keys(LEGACY).forEach(function (name) {
          if (name === 'done') return;
          try { storage.removeItem(LEGACY[name]); } catch (e) { /* 忽略 */ }
        });
        return count;
      });
    }
  };

  LEGACY.done = 'docs-kb:migrationDone';
  App.Storage = Storage;
})(window);
