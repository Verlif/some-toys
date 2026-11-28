# 数据模型

## 0. 本地持久化总览（IndexedDB）

数据库 `docs-kb`，版本 1，六个对象仓库：

| 仓库 | keyPath | 内容 |
| --- | --- | --- |
| `docs` | `path` | 文档记录（见 §3），含正文与冲突快照 |
| `pending` | `path` | 待同步队列（见 §4） |
| `folders` | `path` | 文件夹占位记录 `{ path }` |
| `kv` | `key` | `settings` / `binding` / `folders` / `lastSync` / `tree` / `device` / `locale` / `pinnedTabs` 及迁移标记 |
| `apiCache` | `key` | GitHub GET 响应缓存（见 §10） |
| `assets` | `path` | 图片二进制或 dataURL，`{ path, dataUrl?, bytes?, mime? }` |

`App.Storage.init()` 负责打开数据库；首次启动会把旧版 `docs-kb:*` localStorage 键一次性迁入并清除。若浏览器禁用 IndexedDB，降级为 localStorage 的异步兼容层（前缀 `docs-kb:idb:`），业务代码无感知。

## 1. 仓库路径约定

远端根目录由绑定中的 `rootDir` 决定，默认 `docs`。应用内所有路径都是**相对 rootDir** 的 POSIX 风格路径。

| 类型 | 路径示例 | 说明 |
| --- | --- | --- |
| 文档 | `guide/readme.md` | 一篇文档对应一个 Markdown 文件 |
| 根文档 | `index.md` | 允许，不带文件夹前缀 |
| 空文件夹 | `projects/.gitkeep` | 目录占位；同步时按真实文件上传 |
| 图片资源 | `assets/20261127-123456-abc.png` | 由 `images.js` 自动生成文件名 |

`GitHubDocs.listTree()` 会扫描 rootDir 下所有 blob：

- `*.md` → `files[]`，元素为 `{ path, sha, size }`
- `*/ .gitkeep`（即任意目录下的 `.gitkeep`）→ `folders[]`，元素为目录相对路径
- 其他文件不进入文档树，但可通过 `getBinary` / `putBinary` 访问

## 2. Markdown 文件与 frontmatter

写入仓库的文件形如：

```markdown
---
title: 我的文档
tags: [指南, GitHub]
updatedAt: 1764230400000
deviceId: dev-a1b2c3d4
---

# 正文标题

正文内容...
```

字段说明：

| 字段 | 类型 | 来源 | 说明 |
| --- | --- | --- | --- |
| `title` | string | 编辑器标题输入 | 换行会被替换为空格；缺省为“未命名文档” |
| `tags` | string[] | 编辑器标签输入 | 序列化为 `[a, b]`；`[`、`]`、`,` 会被替换为空格 |
| `updatedAt` | number | `Date.now()` | LWW 主比较键 |
| `deviceId` | string | IndexedDB `kv` 的 `device` | LWW 决胜键；格式 `dev-<随机>` |

解析与序列化入口：

```js
DocsStore.parse(text)            // -> { title, tags, updatedAt, deviceId, body }
DocsStore.serialize(meta)        // meta 需含 title/tags/updatedAt/deviceId/body
```

没有 frontmatter 的 Markdown 文件也能读取：`title` 为空、`tags` 为空数组、`updatedAt` 为 0。

## 3. 本地文档记录（DocumentRecord）

持久化在 IndexedDB `docs` 仓库（keyPath = `path`）；内存中 `DocsStore.docs` 是以路径为 key 的对象：

```js
{
  "docs/guide/readme.md": {
    path: "docs/guide/readme.md",
    title: "指南",
    tags: ["入门"],
    body: "# 正文\n...",
    updatedAt: 1764230400000,
    deviceId: "dev-a1b2c3d4",
    sha: "a1b2c3...",        // GitHub blob sha，乐观锁用
    etag: "W/\"xxx\"",       // 最近一次 GET 的 ETag
    syncedAt: 1764230405000,
    conflict: false,
    remote: null,            // 冲突时保存远端快照
    deleted: false           // 删除墓碑
  }
}
```

关键字段语义：

- `sha`：来自 GitHub contents API。PUT/DELETE 时带上它实现乐观锁；新建或远端已删除时为 `null`。
- `deleted`：`true` 表示本地已删除但尚未推送；`list()` 会过滤掉这些记录。
- `conflict` / `remote`：冲突态。`remote` 可能是完整远端文档，也可能是 `{ deleted: true, updatedAt: 0, deviceId: '' }` 或带 `message` 的错误快照。
- `syncedAt`：最近一次成功推送时间。

## 4. 待同步队列（pending）

持久化在 IndexedDB `pending` 仓库（keyPath = `path`）；内存中 `DocsStore.pending` 是：

```js
{
  "docs/guide/readme.md": {
    path: "docs/guide/readme.md",
    op: "upsert",            // 或 "delete"
    updatedAt: 1764230400000,
    deviceId: "dev-a1b2c3d4"
  }
}
```

规则：

- `upsert` / `remove` 会写入 pending。
- 新建后从未推送就删除：直接丢弃记录与 pending，**不发 DELETE**。
- 已存在文档删除：留墓碑 + `op: 'delete'`，等同步时发 DELETE。
- `rename` 实现为“新路径 upsert + 旧路径 remove”。
- 推送成功 → `markSynced()` 删除 pending；删除操作成功还会删除文档记录。

## 5. 冲突判定：LWW

```js
function remoteWins(local, remote) {
  var lt = local.updatedAt || 0;
  var rt = remote.updatedAt || 0;
  if (rt !== lt) return rt > lt;
  return String(remote.deviceId || '') > String(local.deviceId || '');
}
```

- 先比较 `updatedAt`，大者胜。
- 时间相同则比较 `deviceId` 字典序，大者胜。
- 本地有 pending 且远端胜出 → 标记 `conflict`，**不自动覆盖**。
- 本地有 pending 且本地胜出 → `applyRemote` 返回 `local-kept`，保留本地版本。

远端删除冲突：本地存在 pending upsert 但远端文件已消失 → `applyRemoteDeletion` 返回 `conflict`，同样交用户决定。

## 6. 冲突生命周期

```text
本地编辑（pending upsert）
      │
远端 sha 变化或远端删除
      ▼
markConflictWithRemote / applyRemoteDeletion 打标
      ▼
showConflictDialog（并排展示，整批中止同步）
      ├─ 采用远端 → adoptRemote（清 pending，用远端内容）
      ├─ 保留本地 → keepLocal（重打时间戳，保留 pending，sha 视远端是否存在而定）
      └─ 稍后处理 → 保留 conflict/remote 快照，状态栏红色
```

`keepLocal` 的 sha 处理很重要：

- 远端文件仍存在：保留远端 sha，下次 PUT 用它覆盖，避免 409。
- 远端已删除：清空 sha，下次 PUT 不带 sha，从而重建文件。

## 7. 文件树快照（tree）

IndexedDB `kv` 仓库中的 `tree`：

```js
{
  map: {
    "docs/guide/readme.md": "a1b2c3..."   // path -> blob sha
  },
  fetchedAt: 1764230400000
}
```

- `setTree(map, fetchedAt)` 写入。
- `treeIsFresh(ttl)` 判断是否过期；控制器默认 TTL 为 60 秒。
- 拉取时优先使用 Tree 里的 sha 判断哪些文件需要下载，避免逐个 GET。

## 8. GitHub API 响应结构

contents API 返回的相关字段：

```js
{
  path: "docs/guide/readme.md",
  content: "base64...",        // 文本或二进制
  sha: "a1b2c3...",
  etag: "W/\"xxx\"",           // 响应头，用于条件请求
  fromCache: true              // 本工具附加字段，标记是否来自本地缓存
}
```

`listTree()` 返回：

```js
{
  files: [{ path, sha, size }],
  folders: ["guide", "projects"],
  truncated: false,           // true 时清单不完整，控制器跳过删除判定
  sha: "tree-sha",
  fromCache: false
}
```

`putFile()` / `putBinary()` 返回：

```js
{
  sha: "new-blob-sha",
  commit: { /* GitHub commit 对象 */ },
  dataUrl: "data:image/png;base64,..."  // 仅 putBinary
}
```

## 9. 提交信息约定

所有写操作使用 `docs:` 前缀，便于在提交历史中筛选：

| 操作 | 默认提交信息 |
| --- | --- |
| 上传/更新文档 | `docs: update` |
| 删除文档 | `docs: delete` |
| 上传图片 | `docs: upload asset` |

控制器实际调用时可传入更具体的 message，例如 `docs: upload image ...`。

## 10. 缓存与限流数据

IndexedDB `apiCache` 仓库由 `GitHubDocs` 维护，按 `'GET <path>'` 缓存（keyPath = `key`）：

```js
{
  "GET /repos/o/r/git/trees/main?recursive=1": {
    data: { /* 响应体 */ },
    etag: "W/\"xxx\"",
    fetchedAt: 1764230400000
  }
}
```

TTL 常量：

| 数据 | TTL |
| --- | --- |
| 通用 GET | 5 分钟 |
| Git Tree | 60 秒 |
| 仓库 / 分支列表 | 10 分钟 |
| 指定 `ref` 的历史版本 | 0（内容不可变，命中后永久缓存） |

限流状态由 `getLimits()` 暴露：`remaining`、`resetAt`、`pausedUntil`、`queued`、`inflight`。

## 11. 设置对象

IndexedDB `kv` 仓库中 `settings` 的默认值（`js/app.js:16-20`）：

```js
{
  theme: 'light',
  locale: 'zh-CN',
  fontSize: 14,
  tabSize: 2,
  autoSave: true,
  defaultMode: 'split',
  showToolbar: true,
  showOutline: true,
  maxFetch: 40,
  maxRetries: 2
}
```

- `defaultMode`：`source` / `split` / `preview`，对应编辑器右上角三种视图。
- `maxFetch`：单次拉取最多下载多少篇变化文档。
- `maxRetries`：网络错误/限流重试次数，范围 0–5，会传入 `GitHubDocs`。

## 12. ZIP 归档格式

导出 ZIP 使用仓库相对路径，并附 `manifest.json`：

```js
{
  version: 1,
  type: 'docs-kb',
  root: 'guide',                       // 导出时的根文件夹，空串表示整库
  exportedAt: 1764230400000,
  docs: ['guide/readme.md', ...],      // 相对 rootDir 的文档路径
  folders: ['guide/sub', ...],
  assets: ['assets/x.png', ...]        // 文档正文引用的图片
}
```

- 文档内容就是 `DocsStore.serialize()` 的输出（含 frontmatter）。
- 压缩方式优先 `deflate-raw`（method 8），不支持时用 STORE（method 0）；解压支持两者，遇到其他方式报错。
- 导入到目标文件夹时，把 `manifest.root` 前缀替换为目标路径，并按新旧目录深度重写 Markdown 图片相对链接；无 manifest 的纯 `.md` ZIP 也会按相对路径导入。
- 同名文档先在弹窗中让用户逐项选择“覆盖 / 跳过”，未列出的直接导入。
