# 扩展指南

本文面向后续维护者。所有改动仍遵守全局规则：**先给计划、等待明确批准，再动手；每完成一项自然语言汇报。**

## 1. 动手前的检查清单

1. 明确改动属于哪一层：数据层（`docs-store.js`）、网络层（`github-docs.js`）、UI 层（`ui.js` / `features/*`）、控制器（`app.js`）还是样式（`css/*`）。
2. 确认是否涉及全局状态。优先通过 `ctx` 暴露能力，不要让模块直接读 `app.js` 的 `state` 或 `client`。
3. 确认是否涉及用户可见文案。凡是界面上的文字都必须走 i18n key，不要硬编码中文。
4. 确认是否新增持久化数据。新键应写入 IndexedDB（`App.Storage` 的 `kv` / 对应仓库），并在 [DEVELOPMENT.md](DEVELOPMENT.md) 表格中登记；除降级兜底外不要直接读写 `localStorage`。
5. 确认是否改变同步语义。任何涉及冲突、上传、删除的改动都必须保持 [ARCHITECTURE.md](ARCHITECTURE.md) 中的不变量（含 ZIP 导入冲突必须让用户选择）。
6. 确认脚本是否依赖 `App.Storage` / `App.Zip`：它们必须在 `github-docs.js` / `i18n.js` / `app.js` 之前加载（见 [DEVELOPMENT.md](DEVELOPMENT.md) 第 4 节）。

## 2. 新增一个功能面板（类似设置中心）

以新增 `features/foo.js` 为例：

1. 创建 `js/features/foo.js`：

   ```js
   (function (global) {
     'use strict';
     var App = global.App = global.App || {};
     var Features = App.Features = App.Features || {};
     var UI = App.UI;

     function create(ctx) {
       var root = UI.el('div', { class: 'foo-panel' });
       function open() { /* 使用 ctx.t / ctx.toast / ctx.settings */ }
       return { root: root, open: open };
     }

     Features.Foo = { create: create };
   })(window);
   ```

2. 在 `index.html` 中于 `app.js` 之前插入 `<script src="js/features/foo.js"></script>`。顺序错误会导致 `App.Features` 未就绪。
3. 在 `app.js:startUI()`（由 `init()` 异步加载持久化数据后调用）中实例化：

   ```js
   foo = Features.Foo.create(ctx);
   ctx.foo = foo;
   ```

4. 在活动栏或顶栏增加入口（`buildActivityBar()` / `wireHeader()`），调用 `ctx.foo.open()`。
5. 样式加到 `css/components.css`（通用）或 `css/layout.css`（布局），优先复用已有 token 与组件类。

## 3. 新增一个设置项

1. 在 `app.js:defaultSettings` 中加默认值（如 `foo: false`）。
2. 若是数字且有合法范围，仿照 `maxRetries` 做 clamp：

   ```js
   var n = Number(state.settings.foo);
   if (!isFinite(n)) n = 2;
   n = Math.max(0, Math.min(5, Math.round(n)));
   ```

3. 若设置变化需要重建客户端或其他资源，在 `setSetting(key, value)` 中加分支（参考 `maxRetries` → `refreshClient()`）。
4. 在对应设置面板（`features/settings.js` 的 `generalPanel` / `editorPanel` / `syncPanel`）加入控件，并绑定 `ctx.setSetting('foo', value)`。
5. 若需要立即视觉反馈，把处理逻辑加到 `applySettings()`。
6. 在 `js/i18n.js` 三个字典中加入 label / help 文案 key。
7. 更新 [DATA_MODEL.md](DATA_MODEL.md) 的设置对象示例。

## 4. 新增一种语言

1. 在 `js/i18n.js` 顶部的 `dictionaries` 中新增字典，例如 `ko: { ... }`。
2. **复制一份完整 `en` 字典作为起点**，逐条翻译，确保 key 不漏。
3. 在 `locales()` 返回值中加入 `{ code: 'ko', label: '한국어' }`。
4. 检查所有新增/修改的界面文案都用 `data-i18n` 或 `ctx.t()`，不要遗留硬编码字符串。
5. 在冒烟脚本中把语言循环改为 `zh-CN → en → ja → ko` 验证。
6. 更新 [DEVELOPMENT.md](DEVELOPMENT.md) 中的语言列表。

> 注意：I18n 的回退顺序是“当前语言 → en → key”。如果新语言漏 key，会显示英文而不是中文。

## 5. 新增 Markdown 语法

1. 在 `js/markdown.js` 的 `inline()` 或块级解析（`render()`）中加入规则。
2. **先转义再解析**：`inline()` 已对原文做 `escapeHtml`，新规则要基于转义后的文本写正则。
3. 链接类语法必须通过 `safeUrl()`，不要直接拼接 `href`/`src`。
4. 如果需要新的 CSS 类，加到 `css/markdown.css` 的 `.markdown-body` 作用域内。
5. 在 `docs/API_REFERENCE.md` 的支持语法列表中登记。
6. 增加轻量自测：`Markdown.render(source)` 断言 html 与 toc。

## 6. 新增 GitHub API 能力

1. 在 `js/github-docs.js` 中新增公开方法，**必须**使用 `_get()` 或 `_enqueue()`，不要直接调用 `fetch`。
2. GET 指定合适的 `ttl`：普通数据 5 分钟、Tree 60 秒、仓库/分支 10 分钟、历史 `ref` 用 0。
3. 写操作要传 `branch` 与 `sha`（乐观锁），并在成功后调用 `invalidateDoc()` / `invalidateTree()`。
4. 错误对象沿用现有约定：`status`、`code`、`rateLimited`、`retryable`、`retryAfter`。
5. 在 `docs/API_REFERENCE.md` 的方法表中补签名与返回值。
6. 更新 `ctx`（如需要）让模块可调用，例如新增 `ctx.getFoo()`。

## 7. 新增命令面板命令

命令面板在 `app.js:openCommandPalette()`。新增条目时：

1. 在 `commands` 数组中加入 `{ id, label, run }`。
2. `label` 用 `t('command.xxx')`，并在三语字典补 key。
3. `run` 只调用 `ctx` 上已有能力（如 `ctx.createDoc()`、`ctx.syncNow()`）。
4. 如果命令需要确认，用 `UI.confirm()`；需要输入用 `UI.prompt()`。

## 8. 调整编辑器视图/工具栏

- 编辑器结构在 `js/features/editor.js`：`doc-header`（标题行 + 右上角视图切换）、`editor-toolbar`、`panes`。
- 三种模式由 `setMode(mode)` 切换 `source-only` / `preview-only`，`split` 为默认两栏。
- 新增工具按钮：在 `buildToolbar()` 中加 `UI.iconButton({ icon: 'xxx', ... })`，点击调用 `insertText` / `wrap` / `prefixLine`。
- 新增图标：在 `js/ui.js` 的 `ICONS` 中加 SVG path，再在按钮/菜单里用图标名引用。
- 布局改动优先改 `css/layout.css`；颜色/间距优先用 `css/tokens.css` 的变量。

## 9. 修改同步/冲突逻辑

这是风险最高的区域，必须谨慎：

1. 启动拉取只能调用 `pullFromRemote({ push: false, silent: true })`，**不能上传**。
2. 发现冲突必须整批中止：不执行 `applyRemote`、不执行 `pushPending`。
3. 冲突展示必须并排显示本地与远端内容，且给用户三个选择。
4. `keepLocal` 的 sha 规则不能破坏：远端存在保留 sha，远端删除清空 sha。
5. `tree.truncated` 时跳过远端删除判定。
6. 上传 409 时先 `invalidateDoc` 再强制拉取，避免拿到 304 旧内容。
7. 每次成功同步后写 IndexedDB `kv:lastSync` 并刷新状态徽标。
8. 改动后用 DOM 桩注入假 `GitHubDocs` 验证冲突路径，且断言没有 `putFile` 调用。

## 10. 验证清单（每次改动都建议跑）

```bash
node --check js/*.js js/features/*.js
```

然后按 [DEVELOPMENT.md](DEVELOPMENT.md) 第 7 节做手动验收。若改动涉及同步/冲突/设置/i18n，建议重建 DOM 桩冒烟脚本覆盖对应场景。ZIP 改动可先在 Node 中做无 DOM 往返测试：

```bash
node -e "global.window=global; require('./js/zip.js'); var z=App.Zip; z.create([{name:'a.md',data:'hi'}]).then(function(b){return z.read(b)}).then(function(f){console.log(z.decodeText(f[0].data))})"
```

若改动涉及 IDB 键或迁移，还需验证首次启动时旧 `docs-kb:*` 键被清除且数据完整迁入 IndexedDB。

## 11. 常见坑

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 新脚本报 `App.Features is not defined` | 脚本加载顺序错，`app.js` 先于 feature 执行 | 把 feature 脚本放在 `app.js` 之前 |
| 假客户端替换不生效 | hook 在 `github-docs.js` 执行前注入，被自身导出覆盖 | hook 放到 `vm.runInContext` 之后 |
| `input[type="number"]` 选择器命中不到 | `el()` 直接设属性而非 `setAttribute` | DOM 桩的属性选择器要回退到 `node[key]` |
| `[data-i18n-placeholder="a.b"]` 匹配失败 | 属性值里的点被当成 class 选择器 | 匹配 tag/id/class 前先剔除属性选择器 |
| 切换语言后图标消失 | `segmented` 把 `data-i18n` 放在按钮节点上，覆盖内部 HTML | 把 `data-i18n` 放到内部 span 上 |
| Node 冒烟报 `TextEncoder is not defined` | vm sandbox 缺浏览器全局 | 注入 `TextEncoder` / `TextDecoder` |
| 设置弹窗很矮 | 空 `.dropdown-list` 没有最小高度 | 使用 `.dropdown-list.inline`（min-height 78px） |
| 无 token 时下拉仍可点 | 未调用 `updateGithubEnabled()` | 在 token 变化与打开设置时都调用它 |
