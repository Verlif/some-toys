/**
 * DocsStore - 文档知识库的本地数据层（IndexedDB）
 *
 * 每篇文档在仓库里是一个 Markdown 文件，头部 frontmatter 保存标题、标签、时间戳和设备号。
 * 本地全量缓存、待同步队列与 Tree 快照落在 IndexedDB；冲突按 LWW
 * （updatedAt，deviceId 决胜）处理。所有写操作在内存中立即生效，后台串行落盘。
 */
(function (global) {
  'use strict';

  var Storage = global.App && global.App.Storage;

  function now() {
    return Date.now();
  }

  function randomId() {
    return 'dev-' + Math.random().toString(36).slice(2, 10);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /** 解析 frontmatter：--- 包裹的 title / tags / updatedAt / deviceId */
  function parse(text) {
    var src = String(text == null ? '' : text);
    var result = { title: '', tags: [], updatedAt: 0, deviceId: '', body: src };
    var match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
    if (!match) return result;
    result.body = src.slice(match[0].length);
    match[1].split(/\r?\n/).forEach(function (line) {
      var idx = line.indexOf(':');
      if (idx < 0) return;
      var key = line.slice(0, idx).trim();
      var value = line.slice(idx + 1).trim();
      if (key === 'title') result.title = value;
      else if (key === 'tags') {
        result.tags = value.replace(/^\[|\]$/g, '')
          .split(',').map(function (tag) { return tag.trim(); }).filter(Boolean);
      } else if (key === 'updatedAt') result.updatedAt = Number(value) || 0;
      else if (key === 'deviceId') result.deviceId = value;
    });
    return result;
  }

  function serialize(meta) {
    var tags = (meta.tags || []).map(function (tag) {
      return String(tag).replace(/[\[\],]/g, ' ').trim();
    }).filter(Boolean);
    var title = String(meta.title || '未命名文档').replace(/\r?\n/g, ' ');
    return '---\n' +
      'title: ' + title + '\n' +
      'tags: [' + tags.join(', ') + ']\n' +
      'updatedAt: ' + (meta.updatedAt || 0) + '\n' +
      'deviceId: ' + String(meta.deviceId || '') + '\n' +
      '---\n' + (meta.body || '');
  }

  function DocsStore(options) {
    options = options || {};
    this.onChange = options.onChange || function () {};
    this.docs = {};
    this.pending = {};
    this.tree = { map: {}, fetchedAt: 0 };
    this.deviceId = randomId();
    this._writes = Promise.resolve();

    var self = this;
    this.ready = (Storage ? Storage.init() : Promise.resolve()).then(function () {
      return Promise.all([
        Storage ? Storage.getAll('docs') : Promise.resolve([]),
        Storage ? Storage.getAll('pending') : Promise.resolve([]),
        Storage ? Storage.kvGet('tree') : Promise.resolve(null),
        Storage ? Storage.kvGet('device') : Promise.resolve(null)
      ]);
    }).then(function (results) {
      var docs = results[0] || [], pending = results[1] || [];
      var tree = results[2], device = results[3];
      docs.forEach(function (doc) {
        if (doc && doc.path) self.docs[doc.path] = doc;
      });
      pending.forEach(function (item) {
        if (item && item.path) self.pending[item.path] = item;
      });
      if (tree && typeof tree === 'object' && tree.map) self.tree = tree;
      if (device) self.deviceId = device;
      else if (Storage) self._enqueue(Storage.kvPut('device', self.deviceId));
      return self;
    });
  }

  /** 串行落盘，避免快速编辑时写操作乱序 */
  DocsStore.prototype._enqueue = function (task) {
    var self = this;
    this._writes = this._writes.then(task).catch(function (err) {
      if (global.console) console.warn('[DocsStore] 写入失败:', err && err.message);
    });
    return this._writes;
  };

  DocsStore.prototype._putDocs = function (paths) {
    if (!Storage || !paths.length) return;
    var self = this;
    this._enqueue(function () {
      return Storage.putMany('docs', paths.filter(function (path) {
        return !!self.docs[path];
      }).map(function (path) { return { key: path, value: self.docs[path] }; }));
    });
  };

  DocsStore.prototype._putPending = function (paths) {
    if (!Storage || !paths.length) return;
    var self = this;
    this._enqueue(function () {
      return Storage.putMany('pending', paths.filter(function (path) {
        return !!self.pending[path];
      }).map(function (path) { return { key: path, value: self.pending[path] }; }));
    });
  };

  DocsStore.prototype._delDocs = function (paths) {
    if (!Storage || !paths.length) return;
    this._enqueue(function () {
      return Promise.all(paths.map(function (path) { return Storage.del('docs', path); }));
    });
  };

  DocsStore.prototype._delPending = function (paths) {
    if (!Storage || !paths.length) return;
    this._enqueue(function () {
      return Promise.all(paths.map(function (path) { return Storage.del('pending', path); }));
    });
  };

  /** 可见文档列表（排除已删除），按更新时间倒序 */
  DocsStore.prototype.list = function () {
    var self = this;
    return Object.keys(this.docs).map(function (path) {
      return self.docs[path];
    }).filter(function (doc) {
      return !doc.deleted;
    }).sort(function (a, b) {
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  };

  DocsStore.prototype.get = function (path) {
    var doc = this.docs[path];
    return doc && !doc.deleted ? doc : null;
  };

  DocsStore.prototype.pendingList = function () {
    var self = this;
    return Object.keys(this.pending).map(function (path) {
      return { path: path, op: self.pending[path].op, doc: self.docs[path] || null };
    }).filter(function (item) {
      return !!item.doc;
    });
  };

  DocsStore.prototype.stats = function () {
    return {
      count: this.list().length,
      pending: Object.keys(this.pending).length,
      updatedAt: this.list().reduce(function (max, doc) {
        return Math.max(max, doc.updatedAt || 0);
      }, 0)
    };
  };

  /** 新建或更新一篇文档，并标记为待同步 */
  DocsStore.prototype.upsert = function (path, fields) {
    fields = fields || {};
    var doc = this.docs[path] || {
      path: path, sha: null, etag: null, syncedAt: 0, conflict: false, remote: null
    };
    doc.title = fields.title || doc.title || path;
    doc.tags = Array.isArray(fields.tags) ? fields.tags.slice() : (doc.tags || []);
    doc.body = fields.body == null ? (doc.body || '') : String(fields.body);
    doc.updatedAt = now();
    doc.deviceId = this.deviceId;
    doc.deleted = false;
    doc.conflict = false;
    doc.remote = null;
    this.docs[path] = doc;
    this.pending[path] = {
      path: path, op: 'upsert', updatedAt: doc.updatedAt, deviceId: doc.deviceId
    };
    this._putDocs([path]);
    this._putPending([path]);
    this.onChange();
    return doc;
  };

  /**
   * 删除文档。从未推到远端的新文档直接丢弃（省一次 API 调用）；
   * 已存在的文档留墓碑，等同步时发 DELETE。
   */
  DocsStore.prototype.remove = function (path) {
    var doc = this.docs[path];
    if (!doc) return;
    if (!doc.sha && this.pending[path] && this.pending[path].op === 'upsert') {
      delete this.docs[path];
      delete this.pending[path];
      this._delDocs([path]);
      this._delPending([path]);
    } else {
      doc.deleted = true;
      doc.updatedAt = now();
      doc.deviceId = this.deviceId;
      doc.conflict = false;
      doc.remote = null;
      this.pending[path] = {
        path: path, op: 'delete', updatedAt: doc.updatedAt, deviceId: doc.deviceId
      };
      this._putDocs([path]);
      this._putPending([path]);
    }
    this.onChange();
  };

  DocsStore.prototype.rename = function (oldPath, newPath, title) {
    if (oldPath === newPath) return null;
    var oldDoc = this.docs[oldPath];
    if (!oldDoc) return null;
    var fresh = this.upsert(newPath, {
      title: title || oldDoc.title, tags: oldDoc.tags.slice(), body: oldDoc.body
    });
    this.remove(oldPath);
    return fresh;
  };

  function remoteWins(local, remote) {
    var lt = local.updatedAt || 0;
    var rt = remote.updatedAt || 0;
    if (rt !== lt) return rt > lt;
    return String(remote.deviceId || '') > String(local.deviceId || '');
  }

  /**
   * 把远端文档并入本地。返回：added / updated / local-kept / conflict / unchanged
   * 远端删除单独走 applyRemoteDeletion。
   */
  DocsStore.prototype.applyRemote = function (path, remote) {
    var local = this.docs[path];
    var pending = this.pending[path];

    if (!local) {
      this.docs[path] = Object.assign({
        path: path, sha: null, etag: null, syncedAt: 0,
        conflict: false, remote: null, deleted: false
      }, remote);
      this._putDocs([path]);
      this.onChange();
      return 'added';
    }

    var win = remoteWins(local, remote);
    if (pending) {
      if (!win) return 'local-kept';
      local.conflict = true;
      local.remote = clone(remote);
      local.sha = remote.sha || local.sha;
      local.etag = remote.etag || local.etag;
      this._putDocs([path]);
      this.onChange();
      return 'conflict';
    }

    if (local.sha === remote.sha && local.updatedAt === remote.updatedAt) return 'unchanged';
    local.title = remote.title || local.title;
    local.tags = (remote.tags || []).slice();
    local.body = remote.body || '';
    local.updatedAt = remote.updatedAt || 0;
    local.deviceId = remote.deviceId || '';
    local.sha = remote.sha || null;
    local.etag = remote.etag || null;
    local.deleted = false;
    local.conflict = false;
    local.remote = null;
    this._putDocs([path]);
    this.onChange();
    return 'updated';
  };

  /** 远端已删除该文件 */
  DocsStore.prototype.applyRemoteDeletion = function (path) {
    var doc = this.docs[path];
    if (!doc || doc.deleted) return 'none';
    var pending = this.pending[path];
    if (pending && pending.op === 'upsert') {
      doc.conflict = true;
      doc.remote = { deleted: true, updatedAt: 0, deviceId: '' };
      this._putDocs([path]);
      this.onChange();
      return 'conflict';
    }
    doc.deleted = true;
    doc.conflict = false;
    doc.remote = null;
    delete this.pending[path];
    this._putDocs([path]);
    this._delPending([path]);
    this.onChange();
    return 'deleted';
  };

  /** 冲突处理：采用远端版本 */
  DocsStore.prototype.adoptRemote = function (path) {
    var doc = this.docs[path];
    if (!doc || !doc.conflict || !doc.remote) return;
    var remote = doc.remote;
    if (remote.deleted) {
      delete this.docs[path];
      delete this.pending[path];
      this._delDocs([path]);
      this._delPending([path]);
    } else {
      doc.title = remote.title || doc.title;
      doc.tags = (remote.tags || []).slice();
      doc.body = remote.body || '';
      doc.updatedAt = remote.updatedAt || 0;
      doc.deviceId = remote.deviceId || '';
      doc.sha = remote.sha || null;
      doc.etag = remote.etag || null;
      doc.deleted = false;
      doc.conflict = false;
      doc.remote = null;
      delete this.pending[path];
      this._putDocs([path]);
      this._delPending([path]);
    }
    this.onChange();
  };

  /** 冲突处理：保留本地版本，重新打时间戳以便下次同步覆盖远端 */
  DocsStore.prototype.keepLocal = function (path) {
    var doc = this.docs[path];
    if (!doc) return;
    var wasDeleted = !!doc.deleted;
    var remoteDeleted = !!(doc.remote && doc.remote.deleted);
    doc.updatedAt = now();
    doc.deviceId = this.deviceId;
    doc.conflict = false;
    doc.remote = null;
    doc.deleted = false;
    // 远端文件仍在时用远端 sha 覆盖它；远端已删除则不带 sha，让 PUT 重建文件。
    if (remoteDeleted) doc.sha = null;
    this.pending[path] = {
      path: path,
      op: wasDeleted ? 'delete' : 'upsert',
      updatedAt: doc.updatedAt,
      deviceId: doc.deviceId
    };
    this._putDocs([path]);
    this._putPending([path]);
    this.onChange();
  };

  /** 上传冲突时打标记，保留用户正在编辑的内容 */
  DocsStore.prototype.markConflict = function (path, message) {
    var doc = this.docs[path];
    if (!doc) return;
    doc.conflict = true;
    if (!doc.remote) doc.remote = { message: message || '', updatedAt: 0, deviceId: '' };
    this._putDocs([path]);
    this.onChange();
  };

  /** 上传冲突后拉回远端最新版本，让用户可以二选一 */
  DocsStore.prototype.markConflictWithRemote = function (path, remote, message) {
    var doc = this.docs[path];
    if (!doc || !remote) return;
    doc.conflict = true;
    doc.remote = clone(remote);
    if (message) doc.remote.message = message;
    doc.sha = remote.sha || doc.sha;
    doc.etag = remote.etag || doc.etag;
    // 保留本地排队状态，用户选择“保留本地”后即可用远端 sha 覆盖推送
    this._putDocs([path]);
    this.onChange();
  };

  /** 推送成功后清除待同步标记 */
  DocsStore.prototype.markSynced = function (path, sha, etag) {
    var doc = this.docs[path];
    delete this.pending[path];
    this._delPending([path]);
    if (!doc) return;
    if (doc.deleted) {
      delete this.docs[path];
      this._delDocs([path]);
    } else {
      if (sha) doc.sha = sha;
      if (etag) doc.etag = etag;
      doc.syncedAt = now();
      doc.conflict = false;
      doc.remote = null;
      this._putDocs([path]);
    }
    this.onChange();
  };

  DocsStore.prototype.setTree = function (map, fetchedAt) {
    var tree = { map: map || {}, fetchedAt: fetchedAt || now() };
    this.tree = tree;
    if (Storage) this._enqueue(function () { return Storage.kvPut('tree', tree); });
  };

  DocsStore.prototype.treeIsFresh = function (ttl) {
    return now() - (this.tree.fetchedAt || 0) < ttl;
  };

  DocsStore.parse = parse;
  DocsStore.serialize = serialize;
  global.DocsStore = DocsStore;
})(window);
