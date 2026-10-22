# someToys 项目约定

## 项目定位
**纯静态作品导航站（不挑来源）**：`pages/` 放作品 → push → GitHub Actions 用 `generate-index.js` 生成 `index.html` → GitHub Pages 发布。收录范围是所有**纯静态**作品——单文件 HTML、多文件项目文件夹、打包产物（dist）、教学 Demo、文档页，来源不限（手写 / AI 生成 / 脚手架产物）；唯一门槛是不需要服务端、数据库或运行时构建。**改动范围通常分「主站点」与「pages/ 下的子作品」两层，用户说「只改主项目」时不要动 pages/ 子目录里的作品。**

## 关键规则
- `index.html` 是**生成物**，永远不要手改；改 `templates/nav-template.html` 或 `generate-index.js` 后必须 `node generate-index.js` 重新生成。
- **站点信息（名称 / 简介 / GitHub 地址 / 头像 / branch / docsDir）统一写在根目录 `site.config.json`**，由 `generate-index.js` 的 `readConfig()`→`parseGithub()`→`buildSite()` 读取，缺字段走 `DEFAULT_SITE`。`github` 支持 `https://github.com/o/r`、`github.com/o`、`o/r`、`o`。改配置后要重新生成，工作流触发路径已含 `site.config.json`。
- 模板个人信息占位符是 `{{siteTitle}}` `{{ownerText}}` `{{bio}}` `{{githubUrl}}` `{{avatarUrl}}` `{{siteConfig}}`（旧的 `{{owner}}` 已废弃）。`{{siteConfig}}` 注入 `window.SITE`，必须在 `assets/i18n.js` 之前。
- i18n 字典里的个人信息用站点变量 `{siteTitle}` `{owner}` `{repo}` `{branch}` `{docsDir}` `{bio}`；`assets/i18n.js` 内置 `SITE_DEFAULTS` 兜底，所以没注入的静态页也能正常渲染。`site.config.json` 只驱动 `index.html`，`pages/介绍.html` 是独立静态作品页、不读配置。
- 介绍页的 GitHub / 文档链接不写死：用 `data-gh="repo|owner"`、`data-doc="dev|user"` 标记，由脚本从 `I18N.site` 拼装 href；HTML 里保留相对路径 `../docs/...` 作无 JS 兜底。`window.SITE` 由生成器注入，含 `repo / branch / docsDir`。
- 页面滚动条是**隐藏**的（`html, body` 的 `scrollbar-width: none` + `::-webkit-scrollbar{display:none}`），目的是避免折叠/展开改变页面高度时的横向位移；`.side-links`、`.modal-desc` 仍保留细滚动条，不要改回去。
- `assets/nav.css`、`assets/i18n.js` 是运行时引用，改动后**不需要**重新生成，刷新即可。
- 卡片悬浮阴影不能被裁剪：`.group-body` 常态必须 `overflow: visible`，折叠动画只允许在 JS 动画期间临时加 `overflow: hidden`。
- 双语统一走 `assets/i18n.js` + `data-i18n*` 属性；新增文案要 zh/en 两个字典同时加 key，并用 `I18N.t()` 取动态文案，同时在 `I18N.onChange` 回调里重算。
- 目录形态判定只看有没有 `index.html`：有 → 项目文件夹（一张卡片）；没有 → 分组文件夹（递归收录）。单独的 `.html` 文件 → 单文件页面卡片。**来源不参与判定。**
- 改 `iconMap`（键是子串、命中即停）后要同步 `pages/介绍.html` 与 `README.md` 里的图标对照表。
- i18n key 命名：`nav.*` 导航页、`intro.*` 介绍页、`common.*` 通用（如 `common.siteTitle`）、`time.*` 相对时间；不要把介绍页文案塞进 `nav.*`。
- **每个项目文件夹必须有 `README.md`**，它会被 `generate-index.js` 在构建期用零依赖 markdown 渲染器转成 HTML，塞进卡片 `<template class="card-readme">`，弹窗打开时搬进 `.md-body` 显示。没有 README 才退回 `meta description` / 正文摘要。改 README 内容要重新生成。
- 卡片描述优先级：`meta description` → README 首段 → HTML 正文摘要；README 首段还会进 `data-name` 搜索索引，所以 README 第一段要写成一句人话。
- README 里的相对链接按项目目录改写：`.md` 等文件走 GitHub blob，图片走 raw.githubusercontent；仓库信息缺失时退回相对页面路径。
- `{{...}}` 占位符替换一律用 `put(re, () => value)` 函数形式（README 里的 `$&`/`$'` 不是替换模式）；残留检查走 `KNOWN_PLACEHOLDERS` 白名单，因为 README 正文可能合法出现 `{{var}}`。
- 弹窗滚动：**只有 `.md-body` 可以滚**。有 README 时 `.modal-panel` 加 `has-readme`，面板 `overflow: hidden` + flex 纵向布局，头部/简介/底部 `flex: none`，README 区 `flex: 1 1 auto; min-height: 0`；`max-height: 560px` 以下才退回面板滚动。面板与 `.md-body` 都要 `min-width: 0`，否则 README 的长代码行会把弹窗顶宽。
- 生成时间：模板里是 `<time class="gen-time" datetime="ISO">北京时间</time>`，由 `syncGeneratedAt()` 转成访问者本地时间；不要改回写死 UTC 字符串。
- **弹窗二维码由 `assets/qrcode.js` 运行时生成**（自研编码器，byte 模式 + 纠错 M + 版本 1–10，零依赖），不用 CDN、不做构建期预生成。`drawQr()` 用 `modalOpen.href`（DOM 属性天然是绝对地址）绘制，语言切换时随 `openModal(lastCard)` 重绘。二维码底色必须恒为白（深色模式不反色），否则扫不出；本地地址要显示「仅同一网络可访问」提示。改编码器时注意：生成多项式要转成首项在前、对齐图形必须先于定时图形绘制。

## 断点和工具约定
- 响应式断点：1600 / 1200 / 1199（抽屉化）/ 1023 / 767 / 420。
- 本地预览用静态服务器（`python -m http.server`），不要 file:// 直开。
- 冒烟脚本在 `.ta3NewCoder/smoke.js`（已被 gitignore），jsdom 装在 `C:/Users/16508/.workbuddy/binaries/node/workspace`，运行时要带 `NODE_PATH`。
- **用户偏好：只做静态验证，不要跑运行时测试。** 验证手段＝内联脚本 `new Function` 语法检查 + i18n key 中英完整性比对 + 相对链接存在性检查。
