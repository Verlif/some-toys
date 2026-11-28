# GitHub 文档知识库（前端 Demo）

一个纯前端的文档知识库：浏览器直接通过 GitHub REST API 把仓库里的 Markdown 文件当作文档管理，支持 IndexedDB 本地存储、文件夹 ZIP 导出/导入、冲突处理、文件夹分类、标签、版本历史和 i18n 多语言。

## 特性

- 每篇文档对应仓库中的一个 `.md` 文件，frontmatter 保存标题、标签、时间戳与设备号。
- 文件树、标签筛选、全文搜索、右键菜单、拖放移动文档。
- Markdown 预览、自动生成大纲、Obsidian 风格双链与任务列表。
- 图片粘贴/拖放上传至 `docs/assets/`，同时缓存进 IndexedDB，断网刷新后预览仍可用。
- 所有本地数据（文档、待同步队列、文件夹、设置、API 缓存、图片）存于 IndexedDB；首次启动自动迁移旧 localStorage 数据。
- 文件夹与整库可导出 ZIP（含文档、引用的图片和 manifest），也可从 ZIP 导入；同名文档由用户选择覆盖或跳过。
- 本地缓存优先，Git Tree 增量同步，ETag 条件请求，节流队列与限流退避。
- 冲突时整批中止拉取/上传，弹窗并排展示本地与远端内容，绝不自动覆盖用户数据。
- 三语界面：简体中文 / English / 日本語。
- IDEA 风格右上角视图切换：仅编辑 / 同步预览 / 仅预览。

## 快速开始

直接打开 `index.html` 即可（支持 `file://`）。推荐用本地静态服务器：

```bash
python -m http.server 8000
# 访问 http://localhost:8000/
```

首次打开处于本地模式，不会发起任何 GitHub 请求。进入设置 → GitHub，填入 PAT，加载仓库与分支后绑定即可开始同步。

PAT 权限：私有仓库需要 `repo`；公开仓库 `public_repo` 通常足够。勾选“记住令牌”才会把 token 持久化到 IndexedDB。

## 开发文档

| 文档 | 内容 |
| --- | --- |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 环境与启动、加载顺序、IndexedDB 仓库与迁移、验证方式、调试入口 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 分层、模块职责、`ctx` 契约、同步/冲突/图片数据流、不变量 |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | 路径约定、frontmatter、DocumentRecord、pending、LWW、缓存结构 |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | `GitHubDocs` / `DocsStore` / `App.Storage` / `App.Zip` / `Markdown` / `I18n` / `UI` / Features 公开 API |
| [docs/EXTENSION_GUIDE.md](docs/EXTENSION_GUIDE.md) | 新增面板、设置项、语言、Markdown 语法、GitHub 能力、命令、视图的步骤 |

## 验证

```bash
node --check js/*.js js/features/*.js
```

无构建步骤、无第三方依赖、无 CDN。所有脚本都是经典脚本，按 `index.html` 中的顺序加载。

## 协作规则

改动文件/配置、执行命令、创建或删除内容前，先给出简短计划并等待明确批准；每完成一项用自然语言汇报。详情见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) 与 [docs/EXTENSION_GUIDE.md](docs/EXTENSION_GUIDE.md)。
