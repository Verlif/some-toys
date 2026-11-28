# API 参考

所有模块都是经典脚本挂载到 `window`，无 `import/export`。返回 Promise 的方法均基于原生 `Promise`。

## 1. GitHubDocs

文件：`js/github-docs.js`，全局 `GitHubDocs`。

### 1.1 构造

```js
new GitHubDocs({
  token: '',          // PAT
  owner: '',          // 仓库所有者
  repo: '',           // 仓库名
  branch: 'main',
  rootDir: 'docs',    // 会去掉首尾斜杠
  onLog: function (msg) {},
  maxRetries: 2       // 0–5，默认 2
})
```

没有 `token/owner/repo` 时，客户端仍可构造，但绝大多数方法会返回空结果，不会发起请求。API 缓存统一从 IndexedDB `apiCache` 加载，可通过 `GitHubDocs.ready`（Promise）等待缓存就绪。

### 1.2 公开方法

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `listRepos()` | `Promise<Array<{fullName, private}>>` | 当前 token 可见仓库，缓存 10 分钟；无 token 返回 `[]` |
| `listBranches(owner, repo)` | `Promise<string[]>` | 分支名列表，缓存 10 分钟 |
| `listTree(force?)` | `Promise<{files, folders, truncated, sha, fromCache}>` | 一次拿全文件清单与 blob sha；缓存 60 秒 |
| `getFile(relPath, options?)` | `Promise<{path, content, sha, etag, fromCache} \| null>` | `options: { ref?, force? }`；404 返回 `null` |
| `putFile(relPath, content, message?, sha?)` | `Promise<{sha, commit}>` | 新建/更新文本文件；`sha` 用于乐观锁 |
| `deleteFile(relPath, message?, sha?)` | `Promise<{sha:null, commit}>` | 删除文件；404 视为成功 |
| `listCommits(relPath, limit?)` | `Promise<Array<{sha,message,date,author,url}>>` | 提交历史，默认 30 条，缓存 5 分钟 |
| `getFileAtRef(relPath, sha)` | 同 `getFile` | 历史版本；内容不可变，命中后永久缓存 |
| `getBinary(relPath, options?)` | `Promise<{path, bytes, dataUrl, sha, etag, fromCache} \| null>` | 读取图片等二进制资源 |
| `putBinary(relPath, source, message?, sha?, mime?)` | `Promise<{sha, commit, dataUrl}>` | `source` 可为 dataURL 字符串、`ArrayBuffer` 或 `Uint8Array` |
| `getLimits()` | `{remaining, resetAt, pausedUntil, queued, inflight}` | 配额与队列状态，供状态栏展示 |
| `invalidateTree()` | `void` | 清 Git Tree 缓存 |
| `invalidateDoc(relPath)` | `void` | 清该路径相关缓存（含条件请求 ETag） |
| `invalidateAsset(relPath)` | `void` | 等同 `invalidateDoc`，语义化别名 |

静态方法：

- `GitHubDocs.encode(text)` → base64 字符串（UTF-8 安全，使用 `TextEncoder`）
- `GitHubDocs.decode(base64)` → UTF-8 字符串
- 模块内部还导出 `bytesToBase64` / `base64ToBytes`（未在全局显式暴露，供内部使用）

### 1.3 请求错误对象

`fetch` 失败或 GitHub 返回非 2xx 时抛出 `Error`，可能带以下属性：

| 属性 | 含义 |
| --- | --- |
| `status` | HTTP 状态码 |
| `code` | `CONFLICT`（409） |
| `rateLimited` | 403/429 且命中限流 |
| `retryable` | 网络错误或 5xx，可重试 |
| `retryAfter` | 建议退避毫秒数 |

401、404 不会重试；5xx 会设 `retryable=true` 且 `retryAfter=1000`；网络异常统一设 `retryable=true`。

### 1.4 限流策略

- 队列并发上限 `MAX_INFLIGHT = 3`
- 最小请求间隔 `MIN_INTERVAL = 180ms`
- 同一 GET URL 并发去重（`_dedupe`）
- TTL 过期后用旧 ETag 发条件请求；304 不传正文、不耗配额
- 读取 `x-ratelimit-remaining` / `x-ratelimit-reset`，归零时暂停到重置时间
- 可重试错误按 `maxRetries` 退避，日志输出“网络/限流波动，退避后重试（n/max）”

## 2. DocsStore

文件：`js/docs-store.js`，全局 `DocsStore`。

### 2.1 构造

```js
new DocsStore({
  onChange: function () {}   // 每次异步落盘后调用
})
// 构造后等待 store.ready（Promise<DocsStore>）再读内存快照
```

文档与 pending 走 IndexedDB 对应仓库，写操作在内存中立即生效并由 `_enqueue` 串行落盘。

### 2.2 实例方法

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `list()` | `DocumentRecord[]` | 排除 `deleted`，按 `updatedAt` 倒序 |
| `get(path)` | `DocumentRecord \| null` | 已删除返回 `null` |
| `pendingList()` | `Array<{path, op, doc}>` | 过滤掉记录已不存在的项 |
| `stats()` | `{count, pending, updatedAt}` | 状态栏用 |
| `upsert(path, fields)` | `DocumentRecord` | 更新文档并写 pending upsert |
| `remove(path)` | `void` | 未推送的新文档直接丢弃；否则留墓碑 + pending delete |
| `rename(oldPath, newPath)` | `DocumentRecord \| null` | 新路径 upsert + 旧路径 remove |
| `applyRemote(path, remote)` | `'added' \| 'updated' \| 'unchanged' \| 'local-kept' \| 'conflict'` | 合并远端；冲突时不覆盖本地 |
| `applyRemoteDeletion(path)` | `'none' \| 'deleted' \| 'conflict'` | 远端删除；本地 pending upsert 时标记冲突 |
| `adoptRemote(path)` | `void` | 冲突处理：采用远端 |
| `keepLocal(path)` | `void` | 冲突处理：保留本地并重打时间戳 |
| `markConflict(path, message?)` | `void` | 仅打标记 |
| `markConflictWithRemote(path, remote, message?)` | `void` | 保存远端快照 + 消息，保留 pending |
| `markSynced(path, sha?, etag?)` | `void` | 清 pending；删除操作会删记录 |
| `setTree(map, fetchedAt?)` | `void` | 写 IndexedDB `kv:tree` |
| `ready` | `Promise<DocsStore>` | 构造后数据加载完成的 Promise，控制器会等待它再打开文档 |
| `treeIsFresh(ttl)` | `boolean` | 判断 Tree 快照是否过期 |

### 2.3 静态方法

```js
DocsStore.parse(text)       // { title, tags, updatedAt, deviceId, body }
DocsStore.serialize(meta)   // frontmatter + body 字符串
```

## 3. Markdown

文件：`js/markdown.js`，全局 `Markdown`。

### 3.1 `render(source)`

返回：

```js
{
  html: '<h1 id="...">...</h1>...',
  toc: [
    { level: 1, text: '标题', id: '标题' },
    { level: 2, text: '小节', id: '小节' }
  ]
}
```

支持语法：

- 标题 `#` ~ `######`（自动生成唯一 id，供大纲与双链跳转）
- 粗体 `**x**` / `__x__`、斜体 `*x*` / `_x_`、删除线 `~~x~~`
- 行内代码 `` `x` ``、围栏代码块（```lang）
- 链接 `[label](url)`、图片 `![alt](url)`
- Obsidian 双链 `[[标题]]` / `[[路径|别名]]` → `#slug`
- 有序/无序列表、任务项 `- [ ]` / `- [x]`
- 引用 `>`、表格、分隔线 `---`、段落

安全策略：

- 所有原文先 HTML 转义。
- `safeUrl` 仅允许 `http(s)`、`mailto:`、`#`、相对路径（`./`、`../`、`/`），以及图片 `data:image/(png|jpeg|gif|webp|svg+xml);base64,...`。
- 其他协议统一替换为 `#`。

### 3.2 其他导出

`Markdown.escapeHtml(value)`、`Markdown.safeUrl(url)`、`Markdown.inline(text, used)`。

## 4. I18n

文件：`js/i18n.js`，全局 `App.I18n`。

```js
App.I18n.t(key, params?)       // 文案；{name} 占位符替换为 params.name
App.I18n.apply(root?)          // 扫描 data-i18n / data-i18n-placeholder / data-i18n-title
App.I18n.setLocale(code)       // 'zh-CN' | 'en' | 'ja'；无效返回 false
App.I18n.locale()              // 当前代码
App.I18n.locales()             // [{code, label}, ...]
App.I18n.onChange(fn)          // 注册语言切换监听
```

缺失 key 的回退顺序：当前语言 → `en` → 原样返回 key。

新增文案必须同时加入 `zh-CN`、`en`、`ja` 三个字典（文件顶部 `dictionaries`）。

## 5. UI

文件：`js/ui.js`，全局 `App.UI`。

### 5.1 元素构造

```js
App.UI.el(tag, attrs, children)
```

常用 `attrs`：`class`、`text`、`html`、`style`（对象）、`id`、`type`、`value`、`checked`、`placeholder`、`title`、`data-*`、`onXxx`（如 `onClick`、`onInput`）。

`children` 可以是节点、字符串，或节点/字符串数组。

### 5.2 组件工厂

| 方法 | 说明 |
| --- | --- |
| `icon(name)` | 返回内联 SVG 节点；图标名见 `ICONS` 常量 |
| `button({label, onClick, ...})` | 按钮 |
| `iconButton(iconName, opts)` | 图标按钮 |
| `input({type, value, placeholder, onInput, ...})` | 输入框，支持 `i18nPlaceholder` |
| `select({value, options, onChange})` | 下拉框；`options` 为字符串或 `{value,label}` |
| `field(label, control, i18nKey?)` | 带标签的表单行 |
| `badge(text, type?)` | 徽标 |
| `empty(iconName, text, action?)` | 规范空态 |
| `segmented(items, value, onChange)` | 分段选择；`item` 可带 `{value,label,i18n,icon}` |
| `menu(items, x, y)` | 右键菜单 |
| `closeMenu()` | 关闭当前菜单 |
| `dropdown({trigger, items})` | 下拉菜单，返回 `{root, show, hide, list}` |
| `toast(message, type?, duration?)` | 右下角提示 |
| `busy(message)` | 全屏等待遮罩，返回 `{root, setMessage, close}` |

### 5.3 弹窗

```js
var modal = App.UI.modal({
  title: '标题',
  wide: true,           // 或 small: true
  class: 'modal-settings',
  content: [/* 节点或字符串 */],
  actions: [App.UI.button({ label: '关闭', onClick: function () { modal.close(); } })],
  onClose: function () {},
  focus: true
});
```

返回 `{ root, mask, body, footer, title, setTitle(text), close() }`。ESC 与点击遮罩会关闭。

确认/输入快捷方法：

```js
App.UI.confirm(message, opts?)  // Promise<boolean>
App.UI.prompt(message, value?, opts?) // Promise<string|null>
```

## 6. Features 模块

四个模块都通过 `App.Features.<Name>.create(...)` 构造，依赖 `ctx`（见 [ARCHITECTURE.md](ARCHITECTURE.md)）。

### 6.1 Settings

```js
App.Features.Settings.create(ctx) // -> { open() }
```

五个标签：`general` / `github` / `editor` / `sync` / `about`。GitHub 标签负责 PAT 输入、仓库/分支加载、`UI.busy` 蒙层与绑定。

### 6.2 Explorer

```js
App.Features.Explorer.create(ctx, mount) // -> { root, refresh(), focusSearch(), setQuery(q) }
```

从 `ctx.store.list()` 与 `ctx.folders` 构建树，支持标签筛选、全文搜索、右键菜单、文档拖放到文件夹。

### 6.3 Editor

```js
App.Features.Editor.create(ctx, { editor, outline })
// -> {
//   root, open(doc), clear(), getDraft(), setMode(mode), mode(),
//   insertText(text, start?, end?), focus(), renderPreview(),
//   setConflict(doc), updateDirty(), clearAssetCache(),
//   textarea, titleInput, tagsInput
// }
```

`mode` 取 `source` / `split` / `preview`。预览会调用 `Markdown.render`，并把 assets 相对链接替换为 `ctx.getAssetDataUrl()` 的 dataURL。

### 6.4 Images

```js
App.Features.Images.create(ctx)
// -> { uploadFile(file), pickFile(), handlePaste(event), handleDrop(event) }
```

## 7. ConfigSync（遗留）

文件：`js/config-sync.js`，全局 `ConfigSync`。原单文件配置同步 demo，核心 envelope：

```js
{ version, updatedAt, deviceId, data: string }
```

LWW 规则与 `DocsStore` 相同。当前知识库只用它兼容读取旧绑定：迁移逻辑在 `App.Storage.migrateLegacy()`（`js/idb.js`），新功能不要依赖它；如果以后要移除，需要保留该迁移逻辑或明确放弃兼容。

## 8. App.Storage（IndexedDB 持久化）

文件：`js/idb.js`，全局 `App.Storage`。数据库 `docs-kb` v1，仓库：`docs` / `pending` / `folders` / `kv` / `apiCache` / `assets`。

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `init()` | `Promise<boolean>` | 打开数据库、首次迁移旧 localStorage；可重复调用，返回同一 Promise |
| `backend()` | `'indexeddb' \| 'localstorage'` | 当前后端（IDB 不可用时降级） |
| `kvGet(key)` | `Promise<any>` | 读 `kv` 并自动拆包标量 |
| `kvPut(key, value)` | `Promise<void>` | 写 `kv`，标量自动包装为 `{ key, value }` |
| `get(store, key)` / `getAll(store)` | `Promise<record \| null>` / `Promise<record[]>` | 读单条 / 全表 |
| `put(store, key, value)` / `putMany(store, entries)` | `Promise<void>` | 写入，自动补 keyPath 字段 |
| `del(store, key)` / `clear(store)` | `Promise<void>` | 删除单条 / 清空仓库 |
| `migrateLegacy()` | `Promise<number>` | 一次性迁移旧键，返回迁移条目数 |

## 9. App.Zip（ZIP 编解码）

文件：`js/zip.js`，全局 `App.Zip`。

```js
App.Zip.create([{ name: 'a.md', data: 'hello' }])  // -> Promise<Uint8Array>
App.Zip.read(bytes)                                // -> Promise<[{ name, data: Uint8Array, method }]>
App.Zip.decodeText(bytes)                          // -> string（UTF-8）
App.Zip.deflateSupported() / inflateSupported()   // -> boolean
```

压缩优先 `deflate-raw`（method 8），不支持时写 STORE（method 0）；解压支持 method 0/8，其他方式抛 `Unsupported ZIP compression`。`data` 支持字符串、`Uint8Array` / `ArrayBuffer`、以及带 `bytes`/`dataUrl` 的对象。
