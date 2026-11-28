# 开发指南

## 1. 项目定位

这是一个**纯前端**的 GitHub 文档知识库 demo：浏览器直接调用 GitHub REST API，把仓库中的 Markdown 文件当作知识库文档。没有后端、没有构建步骤、没有 CDN 依赖。

技术形态：

- 经典 `<script>` 脚本（非 ES Module），挂载全局对象，保证 `file://` 直接打开可用。
- 原生 DOM API + CSS 变量，无第三方 UI 框架。
- 数据落在 `IndexedDB`（`docs-kb`，六个仓库），首次启动自动迁移旧 `localStorage` 数据；GitHub 作为远端存储与版本历史。
- ZIP 导出/导入使用原生 `CompressionStream` / `DecompressionStream`，不支持时回退 STORE，保持零依赖。

> 全局协作规则（来自 `~/.dsh/AGENTS.md`）：**改动文件/配置、执行命令、创建或删除内容前，先给出简短计划并停止等待用户明确批准；每完成一项用自然语言汇报；提问引用编号前先在正文列全清单。** 后续维护同样适用。

## 2. 快速开始

### 2.1 直接打开

双击或拖入 `index.html` 即可（`file://` 协议）。首次打开处于**本地模式**，不会发起任何 GitHub 请求；初始化后会自动执行一次“只拉取”流程，但未绑定仓库时直接跳过。

### 2.2 本地静态服务器（推荐用于调试）

```bash
python -m http.server 8000
# 然后访问 http://localhost:8000/
```

不使用打包器，不需要 `npm install`。

### 2.3 绑定 GitHub

1. 打开顶栏/活动栏中的设置入口 → **GitHub** 标签。
2. 填写具备 `repo` 权限的 Personal Access Token（PAT）。
3. 输入 token 后会自动加载仓库列表；选择仓库后加载分支列表。
4. 设置根目录（默认 `docs`），点击绑定。

PAT 只在勾选“记住令牌”时持久化到 IndexedDB `kv` 的 `binding`；否则只保留在当前会话内存中。

需要的 PAT 权限：

- 私有仓库：`repo`（Full control of private repositories）
- 公开仓库：`public_repo` 通常足够
- 企业级实例需要改 `js/github-docs.js` 中的 `API_ROOT`

## 3. 目录结构

```text
.
├── index.html              # 应用骨架 + 脚本加载顺序
├── css/
│   ├── style.css           # 聚合入口（@import）
│   ├── tokens.css          # 设计令牌、主题变量、reset
│   ├── components.css      # 通用组件样式
│   ├── layout.css          # 三栏/活动栏/顶栏/状态栏/编辑器布局
│   └── markdown.css        # .markdown-body 排版
└── js/
    ├── config-sync.js      # 旧版配置同步 demo，仅保留 binding 迁移兼容
    ├── idb.js              # IndexedDB 持久化层 + 旧 localStorage 迁移 + 降级
    ├── zip.js              # ZIP 打包/解包（原生压缩流 + STORE 兜底）
    ├── github-docs.js      # GitHub REST 客户端：缓存/限流/文件 CRUD/二进制
    ├── docs-store.js       # 本地文档缓存、frontmatter、pending、冲突状态
    ├── markdown.js         # 安全 Markdown 子集渲染 + 大纲
    ├── i18n.js             # zh-CN / en / ja 三语字典
    ├── ui.js               # 通用组件工厂 + 弹窗/菜单/toast/busy
    ├── app.js              # 应用控制器：装配模块、同步流程、状态管理
    └── features/
        ├── settings.js     # 设置中心
        ├── explorer.js     # 文件树/标签/搜索/右键菜单/拖放
        ├── editor.js       # 编辑器工具栏/预览/大纲/视图切换
        └── images.js       # 图片粘贴/拖放上传到 docs/assets/
```

## 4. 加载顺序

`index.html` 中的脚本顺序**不可随意调整**，因为全部是经典脚本，依赖关系靠全局对象：

```text
config-sync.js
idb.js                  # 最先：暴露 App.Storage，github-docs/i18n/app 都依赖它
zip.js                  # 暴露 App.Zip
github-docs.js
docs-store.js
markdown.js
i18n.js
ui.js
features/settings.js
features/explorer.js
features/editor.js
features/images.js
app.js          # 必须最后，负责实例化全部模块
```

CSS 入口为 `css/style.css`，按 `tokens → components → layout → markdown` 顺序 `@import`。

## 5. 全局对象速查

| 全局名 | 来源 | 说明 |
| --- | --- | --- |
| `App.UI` | `js/ui.js` | `el/icon/button/input/select/field/badge/empty/segmented/menu/modal/confirm/prompt/toast/dropdown/busy` |
| `App.Storage` | `js/idb.js` | `init/backend/kvGet/kvPut/get/getAll/put/putMany/del/clear/migrateLegacy` |
| `App.Zip` | `js/zip.js` | `create/read/decodeText/deflateSupported/inflateSupported` |
| `App.I18n` | `js/i18n.js` | `t/apply/setLocale/locale/locales/onChange/ready` |
| `App.Features.Settings` | `js/features/settings.js` | `{ create(ctx) }` |
| `App.Features.Explorer` | `js/features/explorer.js` | `{ create(ctx, mount) }` |
| `App.Features.Editor` | `js/features/editor.js` | `{ create(ctx, mounts) }` |
| `App.Features.Images` | `js/features/images.js` | `{ create(ctx) }` |
| `DocsStore` | `js/docs-store.js` | 构造函数，`DocsStore.parse/serialize` 静态方法 |
| `GitHubDocs` | `js/github-docs.js` | 构造函数，`GitHubDocs.encode/decode` 静态方法 |
| `Markdown` | `js/markdown.js` | `{ render, escapeHtml, safeUrl, inline }` |
| `ConfigSync` | `js/config-sync.js` | 旧版单文件同步核心，当前仅用于兼容读取旧 binding |

## 6. IndexedDB 仓库与旧数据迁移

数据库 `docs-kb` v1（`js/idb.js`）：

| 仓库 / kv 键 | 写入方 | 内容 |
| --- | --- | --- |
| `kv:settings` | `app.js` | 主题、语言、字号、tabSize、自动保存、工具栏/大纲显隐、`maxFetch`、`maxRetries` |
| `kv:binding` | `app.js` | `{ token, owner, repo, branch, rootDir, remember }`；`remember=false` 时落盘 token 为空 |
| `folders` | `app.js` | 文件夹占位记录 `{ path }` |
| `kv:lastSync` | `app.js` | 上次成功同步的时间戳（毫秒） |
| `kv:pinnedTabs` | `app.js` | 置顶标签路径数组 |
| `docs` | `DocsStore` | 每条 `{ path, ...DocumentRecord }`，全量本地文档 |
| `pending` | `DocsStore` | 每条 `{ path, op, updatedAt, deviceId }` 待同步队列 |
| `kv:tree` | `DocsStore` | `{ map, fetchedAt }` 最近一次 Git Tree 快照 |
| `kv:device` | `DocsStore` | 当前浏览器设备 ID，冲突决胜用 |
| `apiCache` | `GitHubDocs` | GitHub GET 响应缓存（key / data / etag / fetchedAt） |
| `kv:locale` | `I18n` | 当前语言代码：`zh-CN` / `en` / `ja` |
| `assets` | `Images` / `app.js` | 图片 `{ path, dataUrl }` 或 `{ path, bytes, mime }` |
| `kv:migrationDone` | `App.Storage` | 一次性迁移标记 |

首次打开会迁移旧键 `docs-kb:docs` / `:pending` / `:folders` / `:tree` / `:settings` / `:binding` / `:lastSync` / `:pinnedTabs` / `:device` / `:locale` / `:api-cache` 与旧 demo 的 `config-sync:github-binding`，成功后删除旧键。若 IDB 不可用，降级为 localStorage 前缀 `docs-kb:idb:`。

调试时可在 DevTools → Application → IndexedDB → `docs-kb` 中清空数据库恢复初始状态；如仍看到旧键，说明迁移未完成。

## 7. 验证方式

### 7.1 语法检查

```bash
node --check js/*.js js/features/*.js
```

全部通过输出 `ALL_SYNTAX_OK`（或静默成功）。

### 7.2 DOM 桩冒烟

历史上使用过 `tmp/smoke.js`（已删除，避免污染仓库）：自实现最小 DOM 桩，按 `index.html` 顺序用 `vm.runInContext` 加载全部脚本，验证：

1. 模块挂载、编辑区/标签栏/文件树/大纲/活动栏存在。
2. 未绑定时启动拉取为 **0 次 API 调用**。
3. 三语 `zh-CN → en → ja` 切换。
4. 冲突场景：注入假 `GitHubDocs`，验证冲突弹窗、双栏内容、无 `putFile`、pending 保留。

需要重建时注意两点：

- 替换 `GitHubDocs` 的 hook 必须在 `github-docs.js` **执行之后**注入，否则会被脚本自身导出覆盖。
- Node 环境需向 sandbox 注入 `TextEncoder`/`TextDecoder`、`btoa`/`atob`。

### 7.3 手动验收清单

- 首次打开：本地模式，顶部状态中性，日志显示“未发起任何 GitHub 请求”。
- 绑定仓库后刷新：仅拉取；无冲突时不上传。
- 制造远端同文件改动后刷新：弹出冲突窗，本地内容未被覆盖。
- 同步完成后：顶部状态变绿并显示上次同步时间。
- 设置 → GitHub：无 token 时控件禁用、下拉框为规范空态；输入 token 后显示全屏蒙层加载。
- 设置 → 同步：重试次数 0–5 可改，修改后立即影响新建的客户端。
- 编辑器右上角三种视图切换正常；预览分栏标题显示。
- 粘贴/拖放图片：离线插入 dataURL；已绑定上传至 `docs/assets/` 并插入相对链接；两种情况下图片都写入 IndexedDB `assets`，断网刷新后预览仍可显示。
- 首次从旧版本升级：旧 `docs-kb:*` localStorage 键被迁入 IndexedDB 后删除，文档与设置不丢失。
- 文件夹右键 → 导出文件夹：得到 ZIP，含 `.md`、引用的 `assets/*` 与 `manifest.json`；用系统解压工具可打开。
- 文件夹右键 → 从 ZIP 导入到此处：文档落到目标文件夹，图片相对链接随目录深度重写；同名文档弹出覆盖/跳过选择，选择跳过不改动本地内容。
- 侧栏下载/上传按钮或命令面板：`导出全部` / `导入到根目录` 正常，三语文案齐全。

## 8. 调试入口

- 状态栏右侧 `rateStatus`：显示剩余配额、退避剩余、队列长度。
- 状态栏 `日志` 按钮：展开最近 200 条运行日志。
- `GitHubDocs` 所有请求都经过统一队列，日志中会输出重试与限流信息。
- 冲突相关的核心状态在 `DocsStore.docs[path].conflict` 与 `.remote`。
