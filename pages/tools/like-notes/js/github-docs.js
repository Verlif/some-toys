/**
 * GitHubDocs - GitHub REST 客户端（限流友好）
 *
 * 设计目标：
 * - 缓存优先：所有 GET 结果按 URL 缓存在 localStorage，命中 TTL 直接返回，不发请求
 * - 条件请求：带 If-None-Match，服务端 304 时不返回正文（GitHub 对 304 不计配额）
 * - 增量同步：Git Tree 一次请求拿全文件清单及各文件的 blob sha，只下载 sha 变化的文件
 * - 节流队列：并发上限、最小请求间隔、同 URL 去重、按 X-RateLimit / Retry-After 自动退避
 * - 按需加载：仓库/分支列表、提交历史只在用户主动操作时请求，页面加载零 API 调用
 */
(function (global) {
  'use strict';

  var API_ROOT = 'https://api.github.com';
  var CACHE_KEY = 'docs-kb:api-cache';
  var DEFAULT_TTL = 5 * 60 * 1000;
  var TREE_TTL = 60 * 1000;
  var REPO_TTL = 10 * 60 * 1000;
  var MIN_INTERVAL = 180;
  var MAX_INFLIGHT = 3;
  var MAX_RETRIES = 2;

  function now() {
    return Date.now();
  }

  function enc(value) {
    return encodeURIComponent(String(value));
  }

  function b64encode(text) {
    var bytes = new TextEncoder().encode(text);
    var binary = '';
    for (var i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  }

  function b64decode(text) {
    var binary = atob(String(text).replace(/\s/g, ''));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function base64ToBytes(text) {
    var binary = atob(String(text).replace(/\s/g, ''));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function bytesToBase64(bytes) {
    var view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var binary = '';
    for (var i = 0; i < view.length; i += 8192) {
      binary += String.fromCharCode.apply(null, view.subarray(i, i + 8192));
    }
    return btoa(binary);
  }

  function dataUrlToBytes(dataUrl) {
    var match = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(String(dataUrl || ''));
    if (!match) throw new Error('无效的图片数据');
    var raw = match[3];
    if (match[2]) return { mime: match[1] || 'application/octet-stream', bytes: base64ToBytes(raw) };
    return { mime: match[1] || 'text/plain', bytes: new TextEncoder().encode(decodeURIComponent(raw)) };
  }

  function bytesToDataUrl(bytes, mime) {
    return 'data:' + (mime || 'application/octet-stream') + ';base64,' + bytesToBase64(bytes);
  }

  function GitHubDocs(options) {
    options = options || {};
    this.token = options.token || '';
    this.owner = options.owner || '';
    this.repo = options.repo || '';
    this.branch = options.branch || 'main';
    this.rootDir = String(options.rootDir || 'docs').replace(/^\/+|\/+$/g, '');
    this.storage = options.storage || localStorage;
    this.onLog = options.onLog || function () {};
    var configuredRetries = Number(options.maxRetries);
    this.maxRetries = isFinite(configuredRetries)
      ? Math.max(0, Math.min(5, Math.round(configuredRetries)))
      : MAX_RETRIES;

    this._queue = [];
    this._inflight = 0;
    this._lastAt = 0;
    this._cooldownUntil = 0;
    this._timer = null;
    this._dedupe = {};
    this._limits = { remaining: null, resetAt: 0 };
    this._cache = this._loadCache();
  }

  // ---------- 本地响应缓存 ----------

  GitHubDocs.prototype._loadCache = function () {
    try {
      var raw = this.storage.getItem(CACHE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  };

  GitHubDocs.prototype._saveCache = function () {
    try {
      this.storage.setItem(CACHE_KEY, JSON.stringify(this._cache));
    } catch (e) {
      // 缓存写满时忽略，不影响主流程
    }
  };

  GitHubDocs.prototype._cacheGet = function (key, ttl) {
    var hit = this._cache[key];
    if (!hit) return null;
    if (ttl > 0 && now() - (hit.fetchedAt || 0) > ttl) return null;
    return hit;
  };

  GitHubDocs.prototype._cachePut = function (key, data, etag) {
    this._cache[key] = { data: data, etag: etag || null, fetchedAt: now() };
    this._saveCache();
  };

  GitHubDocs.prototype._cacheDrop = function (key) {
    if (this._cache[key]) {
      delete this._cache[key];
      this._saveCache();
    }
  };

  GitHubDocs.prototype._cacheDropPrefix = function (prefix) {
    var changed = false;
    Object.keys(this._cache).forEach(function (key) {
      if (key.indexOf(prefix) === 0) {
        delete this._cache[key];
        changed = true;
      }
    });
    if (changed) this._saveCache();
  };

  // ---------- 限流队列 ----------

  GitHubDocs.prototype._enqueue = function (task) {
    var self = this;
    return new Promise(function (resolve, reject) {
      task.resolve = resolve;
      task.reject = reject;
      self._queue.push(task);
      self._pump();
    });
  };

  GitHubDocs.prototype._pump = function () {
    var self = this;
    if (this._inflight >= MAX_INFLIGHT || !this._queue.length) return;

    var wait = Math.max(
      0,
      this._lastAt + MIN_INTERVAL - now(),
      this._cooldownUntil - now()
    );
    if (wait > 0) {
      if (!this._timer) {
        this._timer = setTimeout(function () {
          self._timer = null;
          self._pump();
        }, Math.min(wait, 1000));
      }
      return;
    }

    var task = this._queue.shift();
    this._inflight++;
    this._lastAt = now();
    this._request(task).then(function (res) {
      self._inflight--;
      task.resolve(res);
      self._pump();
    }, function (err) {
      self._inflight--;
      var retryable = !!(err.rateLimited || err.retryable);
      if (retryable && (task.retries || 0) < self.maxRetries) {
        task.retries = (task.retries || 0) + 1;
        if (err.retryAfter) {
          self._cooldownUntil = Math.max(self._cooldownUntil, now() + err.retryAfter);
        }
        self._queue.unshift(task);
        self.onLog('网络/限流波动，退避后重试（' + task.retries + '/' + self.maxRetries + '）');
      } else {
        task.reject(err);
      }
      self._pump();
    });
    this._pump();
  };

  GitHubDocs.prototype._readLimits = function (res) {
    var raw = res.headers.get('x-ratelimit-remaining');
    if (raw === null) return;
    var remaining = Number(raw);
    if (!isNaN(remaining)) this._limits.remaining = remaining;
    var reset = Number(res.headers.get('x-ratelimit-reset'));
    if (!isNaN(reset)) this._limits.resetAt = reset * 1000;
    if (remaining === 0 && this._limits.resetAt > now()) {
      this._cooldownUntil = Math.max(this._cooldownUntil, this._limits.resetAt + 1000);
      this.onLog('API 配额已用尽，暂停请求至 ' + new Date(this._limits.resetAt).toLocaleTimeString());
    } else if (remaining > 0 && remaining <= 20) {
      this.onLog('API 配额不足：剩余 ' + remaining);
    }
  };

  GitHubDocs.prototype._request = function (task) {
    var self = this;
    var headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + this.token,
      'X-GitHub-Api-Version': '2022-11-28'
    };
    Object.keys(task.headers || {}).forEach(function (key) {
      headers[key] = task.headers[key];
    });
    var options = { method: task.method || 'GET', headers: headers };
    if (task.body !== undefined) {
      options.body = typeof task.body === 'string' ? task.body : JSON.stringify(task.body);
    }

    return fetch(API_ROOT + task.path, options).then(function (res) {
      self._readLimits(res);
      if (res.status === 304 || res.status === 204) {
        return { status: res.status, data: null, etag: res.headers.get('etag') || null };
      }
      if (!res.ok) {
        var err = new Error('GitHub API ' + res.status);
        err.status = res.status;
        var retryAfter = Number(res.headers.get('retry-after'));
        if (!isFinite(retryAfter)) retryAfter = 0;
        if (res.status === 409) {
          err.code = 'CONFLICT';
          err.message = '文件已被其他人更新（409）';
        } else if (res.status === 401) {
          err.message = 'token 无效或已过期';
        } else if (res.status === 403 || res.status === 429) {
          err.message = 'API 限流或权限不足';
          if (retryAfter > 0) {
            self._cooldownUntil = Math.max(self._cooldownUntil, now() + retryAfter * 1000);
            err.rateLimited = true;
            err.retryAfter = retryAfter * 1000;
          } else if (self._limits.remaining === 0 && self._limits.resetAt > now()) {
            self._cooldownUntil = Math.max(self._cooldownUntil, self._limits.resetAt + 1000);
            err.rateLimited = true;
            err.retryAfter = self._limits.resetAt + 1000 - now();
          }
        } else if (res.status === 404) {
          err.message = '资源不存在（仓库、分支或文件）';
        } else if (res.status >= 500) {
          err.retryable = true;
          err.retryAfter = 1000;
        }
        return res.json().then(function (body) {
          if (body && body.message) {
            // 空仓库首次写入时 GitHub 也返回 409，但这是「无初始提交」而非文件冲突
            if (/git repository is empty/i.test(body.message)) {
              err.code = 'EMPTY_REPO';
              err.message = '仓库为空，正在自动创建初始提交';
            } else {
              err.message += '：' + body.message;
            }
          }
          throw err;
        }, function () { throw err; });
      }
      return res.json().then(function (data) {
        return { status: res.status, data: data, etag: res.headers.get('etag') || null };
      });
    }, function (err) {
      if (!err || typeof err !== 'object') err = new Error(String(err || '网络请求失败'));
      err.retryable = true;
      err.message = err.message || '网络请求失败';
      throw err;
    });
  };

  /** GET 统一入口：缓存命中 / 条件请求 / 并发去重 */
  GitHubDocs.prototype._get = function (path, options) {
    options = options || {};
    var self = this;
    var key = 'GET ' + path + (options.force ? ' !force' : '');
    if (this._dedupe[key]) return this._dedupe[key];

    var ttl = options.ttl === undefined ? DEFAULT_TTL : options.ttl;
    var cacheKey = 'GET ' + path;
    var hit = options.cache === false ? null : this._cacheGet(cacheKey, ttl);
    if (hit && !options.force) {
      return Promise.resolve({
        status: 200, data: hit.data, etag: hit.etag, fromCache: true
      });
    }

    // TTL 过期后仍带上旧 ETag 做条件请求：内容没变时服务端回 304，不耗配额、不传正文
    var stale = options.cache === false ? null : this._cacheGet(cacheKey, 0);
    var headers = {};
    if (stale && stale.etag) headers['If-None-Match'] = stale.etag;
    var promise = this._enqueue({ path: path, method: 'GET', headers: headers }).then(function (res) {
      if (res.status === 304 && stale) {
        stale.fetchedAt = now();
        self._saveCache();
        return { status: 304, data: stale.data, etag: stale.etag, fromCache: true };
      }
      if (res.status === 200 && options.cache !== false) {
        self._cachePut('GET ' + path, res.data, res.etag);
      }
      return res;
    }).then(function (res) {
      delete self._dedupe[key];
      return res;
    }, function (err) {
      delete self._dedupe[key];
      throw err;
    });
    this._dedupe[key] = promise;
    return promise;
  };

  GitHubDocs.prototype._apiPath = function (relPath) {
    var full = (this.rootDir ? this.rootDir + '/' : '') + String(relPath).replace(/^\/+/, '');
    return '/repos/' + enc(this.owner) + '/' + enc(this.repo) + '/contents/' +
      full.split('/').map(enc).join('/');
  };

  /** 判断 404 是否来自「仓库还没有任何提交」，避免把错误分支误判为空仓库 */
  GitHubDocs.prototype._repoIsEmpty = function () {
    var path = '/repos/' + enc(this.owner) + '/' + enc(this.repo);
    return this._get(path, { ttl: REPO_TTL }).then(function (res) {
      return !!(res.data && res.data.size === 0);
    });
  };

  /**
   * 空仓库没有分支，Git Data API 会返回 409 Git Repository is empty。
   * GitHub 官方推荐用 contents API 写第一个文件来完成初始化；初始化后即可正常读写 Git Tree。
   */
  GitHubDocs.prototype._bootstrapEmptyRepo = function () {
    if (this._bootstrapPromise) return this._bootstrapPromise;
    var self = this;
    var base = '/repos/' + enc(this.owner) + '/' + enc(this.repo);
    var keepPath = this.rootDir ? this.rootDir + '/.gitkeep' : '.gitkeep';
    var path = base + '/contents/' + keepPath.split('/').map(enc).join('/');
    var json = { 'Content-Type': 'application/json' };
    var message = 'docs: initialize empty repository';
    var content = b64encode('\n');

    function put(withBranch) {
      var body = { message: message, content: content };
      if (withBranch && self.branch) body.branch = self.branch;
      return self._enqueue({ method: 'PUT', path: path, headers: json, body: body });
    }

    this._bootstrapPromise = put(true).catch(function (err) {
      // 个别空仓库不接受 branch 参数（422/409），改用默认分支再试一次
      if (err.status !== 422 && err.status !== 409 && err.code !== 'EMPTY_REPO') throw err;
      return put(false);
    }).then(function () {
      self.invalidateTree();
      self._cacheDrop('GET ' + base); // 仓库已不再为空，避免后续误判
      return true;
    }).catch(function (err) {
      self._bootstrapPromise = null;
      throw err;
    });
    return this._bootstrapPromise;
  };

  GitHubDocs.prototype._treeKey = function () {
    return 'GET /repos/' + enc(this.owner) + '/' + enc(this.repo) + '/git/trees/' +
      enc(this.branch) + '?recursive=1';
  };

  GitHubDocs.prototype.invalidateTree = function () {
    this._cacheDrop(this._treeKey());
    this._cacheDrop(this._treeKey() + ' !force');
  };

  GitHubDocs.prototype.invalidateDoc = function (relPath) {
    this._cacheDropPrefix(this._apiPath(relPath));
  };

  /** 供状态栏展示：剩余配额、重置时间、退避剩余、队列长度 */
  GitHubDocs.prototype.getLimits = function () {
    return {
      remaining: this._limits.remaining,
      resetAt: this._limits.resetAt,
      pausedUntil: this._cooldownUntil,
      queued: this._queue.length,
      inflight: this._inflight
    };
  };

  // ---------- 公开 API ----------

  GitHubDocs.prototype.listRepos = function () {
    if (!this.token) return Promise.resolve([]);
    return this._get('/user/repos?per_page=100&sort=updated', { ttl: REPO_TTL }).then(function (res) {
      return (res.data || []).map(function (item) {
        return { fullName: item.full_name, private: !!item.private };
      });
    });
  };

  GitHubDocs.prototype.listBranches = function (owner, repo) {
    if (!owner || !repo) return Promise.resolve([]);
    var path = '/repos/' + enc(owner) + '/' + enc(repo) + '/branches?per_page=100';
    return this._get(path, { ttl: REPO_TTL }).then(function (res) {
      return (res.data || []).map(function (item) { return item.name; });
    });
  };

  /** 一次调用获取目录下全部 md 文件及其 blob sha */
  GitHubDocs.prototype.listTree = function (force) {
    if (!this.owner || !this.repo) return Promise.resolve({ files: [], truncated: false });
    var self = this;
    var path = '/repos/' + enc(this.owner) + '/' + enc(this.repo) + '/git/trees/' +
      enc(this.branch) + '?recursive=1';
    return this._get(path, { ttl: TREE_TTL, force: !!force }).then(function (res) {
      var data = res.data || {};
      var prefix = self.rootDir ? self.rootDir + '/' : '';
      var files = [];
      var folders = [];
      (data.tree || []).forEach(function (item) {
        if (item.type !== 'blob' || !item.path) return;
        if (prefix && item.path.indexOf(prefix) !== 0) return;
        var rel = prefix ? item.path.slice(prefix.length) : item.path;
        if (/\.md$/i.test(rel)) {
          files.push({ path: rel, sha: item.sha, size: item.size || 0 });
        } else if (/(^|\/)\.gitkeep$/i.test(rel)) {
          var dir = rel.slice(0, rel.lastIndexOf('/'));
          if (dir && folders.indexOf(dir) < 0) folders.push(dir);
        }
      });
      return {
        files: files,
        folders: folders,
        truncated: !!data.truncated,
        sha: data.sha || null,
        fromCache: !!res.fromCache
      };
    }).catch(function (err) {
      // 空仓库没有分支：tree 接口可能返回 404，也可能返回 409 Git Repository is empty.
      // 两种情况都自动建立初始提交，再当作空清单继续本轮同步，避免同步在读取阶段就中断。
      function emptyResult() {
        return self._bootstrapEmptyRepo().then(function () {
          return { files: [], folders: [], truncated: false, sha: null, fromCache: false };
        });
      }
      if (err.code === 'EMPTY_REPO') return emptyResult(); // 409 已经确定是空仓库，无需再查仓库信息
      if (err.status !== 404) throw err;
      return self._repoIsEmpty().then(function (empty) {
        if (!empty) throw err;
        return emptyResult();
      });
    });
  };

  /** 读取单个文档；ref 可用于历史版本（不可变内容永久缓存） */
  GitHubDocs.prototype.getFile = function (relPath, options) {
    options = options || {};
    var self = this;
    var ref = options.ref || this.branch;
    var path = this._apiPath(relPath) + '?ref=' + enc(ref);
    return this._get(path, {
      ttl: options.ref ? 0 : DEFAULT_TTL,
      force: !!options.force
    }).then(function (res) {
      if (!res.data || !res.data.content) return null;
      return {
        path: relPath,
        content: b64decode(res.data.content),
        sha: res.data.sha,
        etag: res.etag,
        fromCache: !!res.fromCache
      };
    }).catch(function (err) {
      if (err.status === 404) return null;
      throw err;
    });
  };

  GitHubDocs.prototype.putFile = function (relPath, content, message, sha) {
    var self = this;
    var body = {
      message: message || 'docs: update',
      content: b64encode(content),
      branch: this.branch
    };
    if (sha) body.sha = sha;
    function send() {
      return self._enqueue({
        method: 'PUT',
        path: self._apiPath(relPath),
        headers: { 'Content-Type': 'application/json' },
        body: body
      });
    }
    function done(res) {
      self.invalidateDoc(relPath);
      self.invalidateTree();
      var payload = res.data || {};
      return {
        sha: payload.content && payload.content.sha || null,
        commit: payload.commit || null
      };
    }
    return send().then(done).catch(function (err) {
      if (err.code !== 'EMPTY_REPO') throw err;
      // 空仓库首次写入：先建初始提交，再按正常 contents API 写入本文件
      return self._bootstrapEmptyRepo().then(function () { return send().then(done); });
    });
  };

  GitHubDocs.prototype.deleteFile = function (relPath, message, sha) {
    var self = this;
    var body = { message: message || 'docs: delete', branch: this.branch };
    if (sha) body.sha = sha;
    return this._enqueue({
      method: 'DELETE',
      path: this._apiPath(relPath),
      headers: { 'Content-Type': 'application/json' },
      body: body
    }).then(function (res) {
      self.invalidateDoc(relPath);
      self.invalidateTree();
      return { sha: null, commit: (res.data || {}).commit || null };
    }).catch(function (err) {
      // 空仓库里没有可删除的文件，直接视为已完成
      if (err.status === 404 || err.code === 'EMPTY_REPO') return { sha: null, commit: null };
      throw err;
    });
  };

  /** 提交历史：仅当用户打开历史弹窗时调用，结果缓存 5 分钟 */
  GitHubDocs.prototype.listCommits = function (relPath, limit) {
    if (!this.owner || !this.repo) return Promise.resolve([]);
    var fullPath = (this.rootDir ? this.rootDir + '/' : '') + String(relPath).replace(/^\/+/, '');
    var path = '/repos/' + enc(this.owner) + '/' + enc(this.repo) + '/commits' +
      '?path=' + enc(fullPath) + '&sha=' + enc(this.branch) + '&per_page=' + (limit || 30);
    return this._get(path, { ttl: DEFAULT_TTL }).then(function (res) {
      return (res.data || []).map(function (item) {
        var commit = item.commit || {};
        var author = commit.author || {};
        return {
          sha: item.sha,
          message: commit.message || '',
          date: author.date || '',
          author: item.author && item.author.login || author.name || 'unknown',
          url: item.html_url || ''
        };
      });
    });
  };

  GitHubDocs.prototype.getFileAtRef = function (relPath, sha) {
    return this.getFile(relPath, { ref: sha });
  };

  /** 读取二进制资源（图片等），返回 dataUrl，可直接用于 Markdown 预览 */
  GitHubDocs.prototype.getBinary = function (relPath, options) {
    options = options || {};
    var self = this;
    var ref = options.ref || this.branch;
    var path = this._apiPath(relPath) + '?ref=' + enc(ref);
    return this._get(path, {
      ttl: options.ref ? 0 : DEFAULT_TTL,
      force: !!options.force
    }).then(function (res) {
      if (!res.data || !res.data.content) return null;
      var bytes = base64ToBytes(res.data.content);
      return {
        path: relPath,
        bytes: bytes,
        dataUrl: bytesToDataUrl(bytes, guessMime(relPath)),
        sha: res.data.sha,
        etag: res.etag,
        fromCache: !!res.fromCache
      };
    }).catch(function (err) {
      if (err.status === 404) return null;
      throw err;
    });
  };

  /** 上传二进制资源；入参可为 dataUrl / ArrayBuffer / Uint8Array */
  GitHubDocs.prototype.putBinary = function (relPath, source, message, sha, mime) {
    var bytes;
    if (typeof source === 'string') {
      bytes = dataUrlToBytes(source).bytes;
    } else {
      bytes = source;
    }
    var self = this;
    var body = {
      message: message || 'docs: upload asset',
      content: bytesToBase64(bytes),
      branch: this.branch
    };
    if (sha) body.sha = sha;
    function send() {
      return self._enqueue({
        method: 'PUT',
        path: self._apiPath(relPath),
        headers: { 'Content-Type': 'application/json' },
        body: body
      });
    }
    function done(res) {
      self.invalidateDoc(relPath);
      self.invalidateTree();
      var payload = res.data || {};
      return {
        sha: payload.content && payload.content.sha || null,
        commit: payload.commit || null,
        dataUrl: bytesToDataUrl(bytes, mime || guessMime(relPath))
      };
    }
    return send().then(done).catch(function (err) {
      if (err.code !== 'EMPTY_REPO') throw err;
      return self._bootstrapEmptyRepo().then(function () { return send().then(done); });
    });
  };

  GitHubDocs.prototype.invalidateAsset = function (relPath) {
    this.invalidateDoc(relPath);
  };

  function guessMime(path) {
    var ext = String(path).split('.').pop().toLowerCase();
    var map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon' };
    return map[ext] || 'application/octet-stream';
  }

  global.GitHubDocs = GitHubDocs;
  global.GitHubDocs.encode = b64encode;
  global.GitHubDocs.decode = b64decode;
  global.GitHubDocs.bytesToBase64 = bytesToBase64;
  global.GitHubDocs.base64ToBytes = base64ToBytes;
})(window);
