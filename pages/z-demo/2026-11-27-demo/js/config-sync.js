/**
 * ConfigSync - 离线优先的配置同步器
 *
 * 设计目标：
 * - 本地优先：读写先走本地存储，离线时照常工作
 * - 可插拔传输：适配器模式，换后端不改核心逻辑
 * - LWW 合并：按 updatedAt 解决并发改动，deviceId 作为确定性 tie-break
 * - 无 UI 依赖：纯数据层，可在任意页面复用
 */
(function (global) {
  'use strict';

  var DEVICE_KEY = 'config-sync:device-id';

  function now() {
    return Date.now();
  }

  function randomId() {
    return 'dev-' + Math.random().toString(36).slice(2, 10);
  }

  function isValidEnvelope(value) {
    return !!value && typeof value === 'object' &&
      typeof value.updatedAt === 'number' &&
      typeof value.data === 'string';
  }

  function makeEnvelope(data, deviceId) {
    return {
      version: 1,
      updatedAt: now(),
      deviceId: deviceId,
      data: data
    };
  }

  // ---------- 传输适配器 ----------

  function BaseAdapter() {}

  BaseAdapter.prototype.pull = function () {
    throw new Error('Adapter.pull() not implemented');
  };
  BaseAdapter.prototype.push = function () {
    throw new Error('Adapter.push() not implemented');
  };

  /**
   * 本地模拟适配器：用 localStorage 当云端、sessionStorage 当设备本地。
   * 同一浏览器开多个标签页即可模拟多设备（本地隔离、云端共享）。
   */
  function LocalMockAdapter(remoteKey) {
    this.remoteKey = remoteKey || 'config-sync:remote';
  }
  LocalMockAdapter.prototype = Object.create(BaseAdapter.prototype);
  LocalMockAdapter.prototype.constructor = LocalMockAdapter;
  LocalMockAdapter.prototype.pull = function () {
    var raw = localStorage.getItem(this.remoteKey);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      return isValidEnvelope(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  };
  LocalMockAdapter.prototype.push = function (envelope) {
    localStorage.setItem(this.remoteKey, JSON.stringify(envelope));
  };

  /**
   * npoint.io 适配器：公开 bin，无需注册。
   * 创建 bin 后把地址填入即可（形如 https://api.npoint.io/xxxxxxxx）。
   */
  function NpointAdapter(binUrl) {
    if (!binUrl) throw new Error('NpointAdapter requires a bin URL');
    this.binUrl = binUrl;
  }
  NpointAdapter.prototype = Object.create(BaseAdapter.prototype);
  NpointAdapter.prototype.constructor = NpointAdapter;
  NpointAdapter.prototype.pull = function () {
    return fetch(this.binUrl, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('pull failed: HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      return isValidEnvelope(data) ? data : null;
    });
  };
  NpointAdapter.prototype.push = function (envelope) {
    return fetch(this.binUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope)
    }).then(function (res) {
      if (!res.ok) throw new Error('push failed: HTTP ' + res.status);
    });
  };

  /**
   * JSONBin 适配器：需要 binId 和 master key。
   */
  function JsonBinAdapter(binId, apiKey) {
    if (!binId || !apiKey) throw new Error('JsonBinAdapter requires binId and apiKey');
    this.binId = binId;
    this.apiKey = apiKey;
  }
  JsonBinAdapter.prototype = Object.create(BaseAdapter.prototype);
  JsonBinAdapter.prototype.constructor = JsonBinAdapter;
  JsonBinAdapter.prototype.pull = function () {
    var url = 'https://api.jsonbin.io/v3/b/' + this.binId;
    return fetch(url, {
      headers: { 'X-Master-Key': this.apiKey },
      cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) throw new Error('pull failed: HTTP ' + res.status);
      return res.json();
    }).then(function (payload) {
      var record = payload && payload.record;
      return isValidEnvelope(record) ? record : null;
    });
  };
  JsonBinAdapter.prototype.push = function (envelope) {
    var url = 'https://api.jsonbin.io/v3/b/' + this.binId;
    return fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': this.apiKey
      },
      body: JSON.stringify(envelope)
    }).then(function (res) {
      if (!res.ok) throw new Error('push failed: HTTP ' + res.status);
    });
  };

  // ---------- GitHub 适配器 ----------

  function githubFetch(token, path, options) {
    options = options || {};
    var headers = Object.assign({
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28'
    }, options.headers || {});
    return fetch('https://api.github.com' + path, Object.assign({}, options, { headers: headers }))
      .then(function (res) {
        if (!res.ok) {
          var err = new Error('GitHub API ' + res.status);
          err.status = res.status;
          if (res.status === 409) {
            err.code = 'CONFLICT';
            err.message = '文件已被其他设备更新';
          } else if (res.status === 401) {
            err.message = 'token 无效或已过期';
          } else if (res.status === 403) {
            err.message = '权限不足或限流：确认 token 的 Contents 为 Read and write、目标仓库已勾选';
          } else if (res.status === 404) {
            err.message = '资源不存在（仓库、分支或文件）';
          }
          return res.json().then(function (body) {
            if (body && body.message) err.message += '：' + body.message;
            throw err;
          }, function () { throw err; });
        }
        return res.json();
      });
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

  function contentPath(owner, repo, path) {
    var segments = String(path).replace(/^\/+/, '').split('/').map(encodeURIComponent);
    return '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/contents/' + segments.join('/');
  }

  /**
   * GitHub 仓库适配器：把配置作为仓库里的一个 JSON 文件同步。
   * 用 contents API 返回的 sha 做乐观锁，冲突时抛 CONFLICT 错误。
   */
  function GitHubAdapter(options) {
    if (!options || !options.token || !options.owner || !options.repo) {
      throw new Error('GitHubAdapter 需要 token、owner 和 repo');
    }
    this.token = options.token;
    this.owner = options.owner;
    this.repo = options.repo;
    this.branch = options.branch || 'main';
    this.path = options.path || 'config.json';
    this.sha = null;
  }
  GitHubAdapter.prototype = Object.create(BaseAdapter.prototype);
  GitHubAdapter.prototype.constructor = GitHubAdapter;

  /**
   * 拉取配置。GET 返回 404 即视为"文件还不存在"，直接返回 null，
   * 由后续 push 以新建文件的方式创建。
   */
  GitHubAdapter.prototype.pull = function () {
    var self = this;
    var path = contentPath(this.owner, this.repo, this.path) +
      '?ref=' + encodeURIComponent(this.branch);
    return githubFetch(this.token, path).catch(function (err) {
      if (err.status === 404) {
        self.sha = null;
        return null;
      }
      throw err;
    }).then(function (payload) {
      if (!payload || !payload.content) {
        self.sha = null;
        return null;
      }
      self.sha = payload.sha;
      try {
        var data = JSON.parse(b64decode(payload.content));
        return isValidEnvelope(data) ? data : null;
      } catch (e) {
        return null;
      }
    });
  };

  /**
   * 推送配置。没有 sha 时按"新建文件"提交（GitHub contents API 会自动创建文件）。
   * 只有当分支确实不存在导致 404 时，才建分支重试一次。
   */
  GitHubAdapter.prototype.push = function (envelope) {
    var self = this;
    return this.writeFile(envelope).catch(function (err) {
      if (err.status !== 404 || self.sha) throw err;
      return self.createBranch().then(function () {
        self.sha = null;
        return self.writeFile(envelope);
      });
    });
  };

  GitHubAdapter.prototype.writeFile = function (envelope) {
    var self = this;
    var body = {
      message: 'sync config from ' + envelope.deviceId,
      content: b64encode(JSON.stringify(envelope)),
      branch: this.branch
    };
    if (this.sha) body.sha = this.sha;
    return githubFetch(this.token, contentPath(this.owner, this.repo, this.path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (payload) {
      if (payload && payload.content && payload.content.sha) self.sha = payload.content.sha;
    });
  };

  /**
   * 创建当前分支（仅在 push 因分支不存在而 404 时调用）。
   * 从默认分支的提交创建；空仓库没有提交时先写入一份空配置作为初始提交。
   */
  GitHubAdapter.prototype.createBranch = function () {
    var self = this;
    var base = '/repos/' + encodeURIComponent(this.owner) + '/' + encodeURIComponent(this.repo);
    return githubFetch(this.token, base).then(function (info) {
      return githubFetch(self.token, base + '/git/ref/heads/' + encodeURIComponent(info.default_branch))
        .catch(function (err) {
          if (err.status !== 404) throw err;
          return self.seedDefaultBranch(info.default_branch);
        });
    }).then(function (ref) {
      return githubFetch(self.token, base + '/git/refs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: 'refs/heads/' + self.branch, sha: ref.object.sha })
      });
    });
  };

  GitHubAdapter.prototype.seedDefaultBranch = function (defaultBranch) {
    return githubFetch(this.token, contentPath(this.owner, this.repo, '.gitkeep'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'init repository',
        content: b64encode(''),
        branch: defaultBranch
      })
    }).then(function (payload) {
      return { object: { sha: payload.commit.sha } };
    });
  };

  GitHubAdapter.listRepos = function (token) {
    return githubFetch(token, '/user/repos?per_page=100&sort=updated').then(function (list) {
      return list.map(function (item) {
        return { fullName: item.full_name, private: item.private };
      });
    });
  };

  GitHubAdapter.listBranches = function (token, owner, repo) {
    return githubFetch(token, '/repos/' + encodeURIComponent(owner) + '/' +
      encodeURIComponent(repo) + '/branches?per_page=100').then(function (list) {
      return list.map(function (item) { return item.name; });
    });
  };

  // ---------- 同步核心 ----------

  function ConfigSync(options) {
    options = options || {};
    this.storage = options.storage || sessionStorage;
    this.key = options.key || 'config-sync:data';
    this.adapter = options.adapter || new LocalMockAdapter();
    this.deviceId = options.deviceId || this.loadDeviceId();
    this.onChange = options.onChange || function () {};
    this.onStatus = options.onStatus || function () {};
    this.pending = this.loadPending();
    this.envelope = this.loadEnvelope();
  }

  ConfigSync.prototype.loadDeviceId = function () {
    var id = this.storage.getItem(DEVICE_KEY);
    if (!id) {
      id = randomId();
      this.storage.setItem(DEVICE_KEY, id);
    }
    return id;
  };

  ConfigSync.prototype.loadEnvelope = function () {
    var raw = this.storage.getItem(this.key);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      return isValidEnvelope(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  };

  ConfigSync.prototype.loadPending = function () {
    var raw = this.storage.getItem(this.key + ':pending');
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  };

  ConfigSync.prototype.saveEnvelope = function (envelope) {
    this.envelope = envelope;
    this.storage.setItem(this.key, JSON.stringify(envelope));
    this.onChange(this.get(), this.status());
  };

  ConfigSync.prototype.savePending = function () {
    this.storage.setItem(this.key + ':pending', JSON.stringify(this.pending));
  };

  ConfigSync.prototype.get = function () {
    return this.envelope ? this.envelope.data : '';
  };

  ConfigSync.prototype.set = function (text) {
    var envelope = makeEnvelope(String(text == null ? '' : text), this.deviceId);
    this.saveEnvelope(envelope);
    this.pending.push(envelope);
    this.savePending();
    this.onStatus(this.status());
    return envelope.data;
  };

  ConfigSync.prototype.status = function () {
    return {
      deviceId: this.deviceId,
      pendingCount: this.pending.length,
      updatedAt: this.envelope ? this.envelope.updatedAt : null,
      lastDeviceId: this.envelope ? this.envelope.deviceId : null
    };
  };

  ConfigSync.prototype.merge = function (local, remote) {
    if (!remote) return local;
    if (!local) return remote;
    if (local.updatedAt !== remote.updatedAt) {
      return local.updatedAt > remote.updatedAt ? local : remote;
    }
    return local.deviceId >= remote.deviceId ? local : remote;
  };

  ConfigSync.prototype.sync = function () {
    var self = this;
    this.onStatus(Object.assign({ phase: 'pulling' }, this.status()));
    return this.adapter.pull().then(function (remote) {
      var local = self.envelope;
      var merged = self.merge(local, remote);
      var appliedRemote = !!remote && (!local ||
        (remote.updatedAt > local.updatedAt ||
          (remote.updatedAt === local.updatedAt && remote.deviceId > local.deviceId)));

      if (appliedRemote) {
        self.saveEnvelope(merged);
      }

      self.onStatus(Object.assign({ phase: 'pushing' }, self.status()));
      var outgoing = self.envelope || makeEnvelope('', self.deviceId);
      return self.adapter.push(outgoing).then(function () {
        self.pending = [];
        self.savePending();
        var result = {
          pulled: !!remote,
          appliedRemote: appliedRemote,
          pushed: true
        };
        self.onStatus(Object.assign({ phase: 'done' }, self.status()));
        return result;
      });
    });
  };

  global.ConfigSync = ConfigSync;
  global.ConfigSyncAdapters = {
    Base: BaseAdapter,
    LocalMock: LocalMockAdapter,
    Npoint: NpointAdapter,
    JsonBin: JsonBinAdapter,
    GitHub: GitHubAdapter
  };

})(window);
