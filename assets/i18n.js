/**
 * someToys 双语运行时（中 / 英）
 *
 * 导航页 index.html 与介绍页 pages/介绍.html 共用这个文件。
 * 用法：在 HTML 里给需要翻译的节点加上 data-i18n 属性，值为字典 key；
 *      需要插值时用 data-i18n-vars='{"n":3}'（JSON 字符串）。
 *
 * 支持的属性：
 *   data-i18n                → textContent
 *   data-i18n-html           → innerHTML
 *   data-i18n-title          → title
 *   data-i18n-placeholder    → placeholder
 *   data-i18n-aria-label     → aria-label
 *
 * 语言优先级：URL ?lang=xx > localStorage > 浏览器语言 > 默认 zh
 */
(function (global) {
  'use strict';

  var STORE_KEY = 'lang';
  var SUPPORTED = ['zh', 'en'];
  var FALLBACK = 'zh';

  // ---------------------------------------------------------------- 站点信息
  // 站点名称 / 作者 / 简介由生成脚本注入 window.SITE（源自 site.config.json）。
  // 这里保留一份默认值，介绍页等没有注入的静态页面也能照常渲染。

  var SITE_DEFAULTS = {
    siteTitle: 'someToys',
    owner: 'Verlif',
    repo: 'someToys',
    branch: 'main',
    docsDir: 'docs',
    bio: '单页面与项目文件夹作品集',
  };

  function siteVars() {
    var injected = (global && global.SITE) || {};
    var out = {};
    for (var key in SITE_DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(SITE_DEFAULTS, key)) {
        out[key] = injected[key] || SITE_DEFAULTS[key];
      }
    }
    return out;
  }

  /** 站点变量打底，调用方传入的 vars 覆盖它：{siteTitle} 来自站点配置，{n} 来自调用方 */
  function mergeVars(vars) {
    var out = siteVars();
    if (vars) {
      for (var key in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, key)) out[key] = vars[key];
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- 字典
  // 新增文案时：先在这里补 key（zh / en 各一条），再在 HTML 上写 data-i18n="xxx"。
  var DICT = {
    // ============================== 中文 ==============================
    zh: {
      // ---- 导航页 ----
      'nav.docTitle': '{siteTitle} · {owner} 的作品导航',
      'nav.metaDesc': '{bio}：单文件页面与项目文件夹的自动导航站。',
      'nav.home': '首页',
      'nav.bio': '{bio}',
      'nav.openMenu': '打开分组菜单',
      'nav.closeMenu': '关闭分组菜单',
      'nav.search': '搜索项目',
      'nav.searchHint': '搜索项目（按 / 聚焦）',
      'nav.clearSearch': '清空搜索',
      'nav.collapseAll': '折叠全部分组',
      'nav.expandAll': '展开全部分组',
      'nav.backToTop': '回到顶部',
      'nav.toggleLang': '切换语言',
      'nav.langLabel': 'EN',
      'nav.tooltipTheme': '切换主题（D）',
      'nav.pageTitle': '作品导航',
      'nav.pageSubtitle': '所有收录的作品都在下面，搜索、折叠、打开，仅此而已。',
      'nav.statProjects': '项目',
      'nav.statPages': '页面',
      'nav.statGroups': '分组',
      'nav.generatedAt': '生成于',
      'nav.slogan': '放文件 → 推送 → 自动上线',
      'nav.noResult': '没有找到匹配的项目',
      'nav.noResultHint': '试试其它关键词，或按 Esc 清空',
      'nav.projectTag': '项目',
      'nav.viewMore': '查看完整介绍',
      'nav.introLink': '项目介绍',
      'nav.userDocLink': '使用文档',
      'nav.devDocLink': '开发文档',
      'common.close': '关闭',
      'nav.kindProject': '项目文件夹',
      'nav.kindPage': '单文件页面',
      'nav.pages': '共 {n} 页',
      'nav.chars': '{n} 字描述',
      'nav.noDesc': '这个页面还没有写 description，可以在 <head> 里补一条。',
      'nav.openPage': '打开页面',
      'nav.copyLink': '复制链接',
      'nav.copied': '已复制',
      'nav.copyPrompt': '复制这个链接：',
      'nav.countPages': '{n} 个页面',
      'nav.hits': '{visible} / {total}',
      'nav.langName': '中文',
      'common.siteTitle': '{siteTitle}',

      // ---- 时间 ----
      'time.today': '今天',
      'time.yesterday': '昨天',
      'time.daysAgo': '{n} 天前',
      'time.monthsAgo': '{n} 个月前',
      'time.yearAgo': '1 年前',
      'time.yearsAgo': '{n} 年前',

      // ---- 介绍页：Hero ----
      'intro.docTitle': '{siteTitle} · 单页面与项目文件夹导航站',
      'intro.metaDesc': '不挑来源的作品导航站：单个 HTML 文件、多文件项目文件夹，放进 pages/ 推送即自动生成导航页。',
      'intro.badge': '单页面 & 项目文件夹导航',
      'intro.heroSub': '不管是一个 HTML 文件，还是带资源的多文件项目，丢进 pages/ 推送就能上线。',
      'intro.source': '查看源码',
      'intro.author': '@{owner}',
      'intro.docDev': '开发文档',
      'intro.docUser': '使用文档',
      'intro.navHome': '返回导航页',
      'intro.introTitle': '这是什么',
      'intro.introBody': '{siteTitle} 是一个「只负责展示」的作品架：把作品放进 pages/ 目录，推送到 GitHub，Actions 会自动扫描、生成带分组与搜索的导航页，再由 GitHub Pages 发布。单个 HTML 文件和多文件项目文件夹都收，整个过程不需要手写任何清单或配置。',

      // ---- 介绍页：流程 ----
      'intro.flow1': '放入作品',
      'intro.flow2': '推送',
      'intro.flow3': '自动生成',
      'intro.flow4': '自动上线',

      // ---- 介绍页：收录范围 ----
      'intro.supportTitle': '支持哪些作品',
      'intro.supportLead': '判断规则只有一条：文件夹里有没有 index.html。来源不限、技术栈不限，纯静态就行。',
      'intro.form1Tag': '单文件页面',
      'intro.form1Body': '一个 .html 里塞满 CSS / JS，双击就能跑。手写的、AI 生成的、工具导出的都算。',
      'intro.form2Tag': '项目文件夹',
      'intro.form2Body': 'index.html 加 css / js / img 的多文件项目，整目录收成一张卡片，内部相对路径不用改。',
      'intro.form3Tag': '分组文件夹',
      'intro.form3Body': '没有 index.html 的文件夹用来归类，里面的页面、项目和子分组会被递归收录，可无限嵌套。',
      'intro.supportTip': '不挑来源：手写页面、AI 生成、脚手架打包产物（Vite / webpack 的 dist）、教学 Demo、数据可视化、小游戏、文档页……只要能用浏览器直接打开就行。',
      'intro.limitTip': '唯一硬要求是「纯静态」：需要服务端、数据库或运行时构建的项目（Node / PHP 后端、SSR）不在射程内 —— GitHub Pages 只提供静态托管。',

      // ---- 介绍页：特性 ----
      'intro.featTitle': '核心特性',
      'intro.feat1Title': '单文件 / 项目都收',
      'intro.feat1Body': '单个 HTML 与多文件项目文件夹各自成卡，卡片上会标明是哪一种形态。',
      'intro.feat2Title': '自动分组',
      'intro.feat2Body': '没有 index.html 的文件夹自动成为分组，子分组可以无限嵌套。',
      'intro.feat3Title': '实时搜索',
      'intro.feat3Body': '按标题、描述、文件名和标签过滤，命中处高亮，无匹配的分组自动隐藏。',
      'intro.feat4Title': '全自动构建',
      'intro.feat4Body': 'GitHub Actions 在每次推送后自动扫描并重新生成导航页。',
      'intro.feat5Title': '中英双语',
      'intro.feat5Body': '导航页与介绍页内置中文 / 英文切换，语言偏好自动记忆。',
      'intro.feat6Title': '跨端响应式',
      'intro.feat6Body': '手机、平板与桌面分别适配：窄屏抽屉导航、单列瀑布卡片。',
      'intro.feat7Title': '双主题',
      'intro.feat7Body': '暗色与亮色主题自由切换，可跟随系统，选择会被记住。',
      'intro.feat8Title': '零成本',
      'intro.feat8Body': '基于 GitHub Pages 托管，完全免费，自带 HTTPS 与 CDN 加速。',

      // ---- 介绍页：目录结构 ----
      'intro.treeTitle': '目录结构',
      'intro.treeNote1': '# 自动化工作流',
      'intro.treeNote2': '# 所有作品放这里（单文件 / 项目 / 分组）',
      'intro.treeNote3': '# 根目录单文件页面 → 一张卡片',
      'intro.treeNote4': '# 一级子文件夹 → 分组',
      'intro.treeNote5': '# 项目文件夹 → 一张卡片',
      'intro.treeNote6': '# 导航页模板',
      'intro.treeNote7': '# 导航页样式',
      'intro.treeNote8': '# 双语字典与运行时',
      'intro.treeNote9': '# 生成脚本',
      'intro.treeNote10': '# 自动生成，勿手改',
      'intro.treeNote11': '# 开发文档 / 使用文档',
      'intro.treeNote12': '# 分组里的单文件页面',
      'intro.treeNote13': '# 站点信息配置',

      // ---- 介绍页：快速开始 ----
      'intro.quickTitle': '快速开始',
      'intro.step1Title': '启用 GitHub Pages',
      'intro.step1Body': '打开仓库 Settings → Pages，Source 选择 Deploy from a branch，Branch 选 main，文件夹选 / (root)，保存。',
      'intro.step2Title': '配置 Actions 写权限',
      'intro.step2Body': '打开 Settings → Actions → General，在 Workflow permissions 中选择 Read and write permissions，保存。',
      'intro.step3Title': '把作品放进 pages/',
      'intro.step3Body': '单个 HTML 直接丢进去；多文件项目放进自己的文件夹并确保入口叫 index.html；想归类就建一个没有 index.html 的分组文件夹，文件夹名就是分组标题。',
      'intro.step3Note1': '# 根目录页面 → 一张卡片',
      'intro.step3Note2': '# 分组：games',
      'intro.step3Note3': '# 项目文件夹 → 一张卡片',
      'intro.step4Title': '推送',
      'intro.step4Body': 'Action 自动运行，生成导航页并提交回仓库，GitHub Pages 自动部署。稍等片刻刷新即可看到新卡片。',

      // ---- 介绍页：图标映射 ----
      'intro.iconTitle': '自动图标映射',
      'intro.iconIntro': '生成脚本会根据文件名或分组名自动匹配图标，无需手动配置。',
      'intro.thKeyword': '关键词',
      'intro.thIcon': '图标',
      'intro.thDesc': '说明',
      'intro.rowGame': '游戏类页面',
      'intro.rowTool': '实用工具',
      'intro.rowPicture': '图片处理',
      'intro.rowMap': '地图 / 空间类',
      'intro.rowDemo': '演示页面',
      'intro.rowBlog': '文章页面',
      'intro.rowAi': 'AI 相关',
      'intro.rowInfo': '介绍 / 说明页',
      'intro.rowDefault': '默认图标',
      'intro.iconTip': '想加新图标，只需在 generate-index.js 的 iconMap 里加一条映射，值使用 Font Awesome 的类名。',

      // ---- 介绍页：工作流 ----
      'intro.flowTitle': '工作流程',
      'intro.flowComment': '# 你只需要做第一步',
      'intro.flowStep1': '把 HTML 放入',
      'intro.flowStep2': '触发 GitHub Actions',
      'intro.flowStep3': '运行生成脚本，递归扫描并生成导航页',
      'intro.flowStep4': '提交并推送回仓库',
      'intro.flowStep5': 'GitHub Pages 自动部署',
      'intro.flowStep6': '导航页更新，新卡片 / 新分组出现',

      // ---- 介绍页：常见问题 ----
      'intro.faqTitle': '常见问题',
      'intro.faq1Q': 'Action 报错 ENOENT: no such file or directory, scandir \'pages\'',
      'intro.faq1A': 'pages/ 没有被 Git 跟踪。Git 不跟踪空文件夹，放入至少一个 HTML 文件，或添加 pages/.gitkeep 占位文件后提交。',
      'intro.faq2Q': 'Action 报错 Permission denied 或 403',
      'intro.faq2A': '检查 Workflow permissions 是否为 Read and write，并确认工作流中声明了 permissions: contents: write。',
      'intro.faq3Q': 'Action 报错 remote rejected',
      'intro.faq3A': '通常是 main 分支的保护规则阻止了 bot 推送。到 Settings → Branches 删除或放宽保护规则。',
      'intro.faq4Q': '访问 Pages 地址显示 404',
      'intro.faq4A': '确认 Source 为 Deploy from a branch、分支为 main、文件夹为 / (root)。刚部署完请等待几分钟再刷新。',
      'intro.faq5Q': '分组没有显示出来',
      'intro.faq5A': '确认文件夹（含子目录）里至少有一个 .html 文件，完全空的文件夹会被跳过。',
      'intro.faq6Q': '不是 AI 生成的页面，能放进来吗',
      'intro.faq6A': '能，来源完全不限。手写页面、模板导出、脚手架打包产物（Vite / webpack 的 dist）都行，只要是纯静态、浏览器能直接打开。',
      'intro.faq7Q': '项目里有 css / js / img 等多个文件，怎么放',
      'intro.faq7A': '整个项目放进一个文件夹，主页面命名为 index.html，再把文件夹放进 pages/ 的任意位置。页面内用相对路径引用资源，不需要改路径。',
      'intro.faq8Q': '需要后端或数据库的项目能收吗',
      'intro.faq8A': '不能。GitHub Pages 只做静态托管，服务端代码不会被执行。这类项目请另找托管，等它们能导出成纯静态产物后再放进来。',
      'intro.faq9Q': '页面里有外部依赖怎么办',
      'intro.faq9A': '只要能独立运行即可。CDN 上的 CSS / JS 保持原样；本地资源放进项目文件夹并用相对路径引用。',

      // ---- 介绍页：页脚 ----
      'intro.footBuilt': '基于 GitHub Pages 构建 · MIT License',
      'intro.footDocs': '文档',
    },

    // ============================== English ==============================
    en: {
      // ---- Nav page ----
      'nav.docTitle': '{siteTitle} · Portfolio of {owner}',
      'nav.metaDesc': '{bio}: an auto-generated index for single-file pages and project folders.',
      'nav.home': 'Home',
      'nav.bio': '{bio}',
      'nav.openMenu': 'Open group menu',
      'nav.closeMenu': 'Close group menu',
      'nav.search': 'Search projects',
      'nav.searchHint': 'Search projects (press / to focus)',
      'nav.clearSearch': 'Clear search',
      'nav.collapseAll': 'Collapse all groups',
      'nav.expandAll': 'Expand all groups',
      'nav.backToTop': 'Back to top',
      'nav.toggleLang': 'Switch language',
      'nav.langLabel': '中文',
      'nav.tooltipTheme': 'Toggle theme (D)',
      'nav.pageTitle': 'Works Index',
      'nav.pageSubtitle': 'Everything collected lives below — search, collapse, open. Nothing else.',
      'nav.statProjects': 'Projects',
      'nav.statPages': 'Pages',
      'nav.statGroups': 'Groups',
      'nav.generatedAt': 'Generated at',
      'nav.slogan': 'Drop it in → Push → Ship',
      'nav.noResult': 'No matching projects',
      'nav.noResultHint': 'Try another keyword, or press Esc to clear',
      'nav.projectTag': 'Project',
      'nav.viewMore': 'View full description',
      'nav.introLink': 'About this site',
      'nav.userDocLink': 'User guide',
      'nav.devDocLink': 'Developer docs',
      'common.close': 'Close',
      'nav.kindProject': 'Project folder',
      'nav.kindPage': 'Single-file page',
      'nav.pages': '{n} pages',
      'nav.chars': '{n} chars',
      'nav.noDesc': 'This page has no meta description yet — add one inside <head>.',
      'nav.openPage': 'Open page',
      'nav.copyLink': 'Copy link',
      'nav.copied': 'Copied',
      'nav.copyPrompt': 'Copy this link:',
      'nav.countPages': '{n} pages',
      'nav.hits': '{visible} / {total}',
      'nav.langName': 'English',
      'common.siteTitle': '{siteTitle}',

      // ---- Time ----
      'time.today': 'today',
      'time.yesterday': 'yesterday',
      'time.daysAgo': '{n} days ago',
      'time.monthsAgo': '{n} months ago',
      'time.yearAgo': '1 year ago',
      'time.yearsAgo': '{n} years ago',

      // ---- Intro: hero ----
      'intro.docTitle': '{siteTitle} · Single-page & project-folder index',
      'intro.metaDesc': 'A source-agnostic works index: single HTML files and multi-file project folders — drop them into pages/, push, and the index rebuilds itself.',
      'intro.badge': 'Single pages & project folders',
      'intro.heroSub': 'One HTML file or a whole multi-file project — drop it into pages/, push, and it is online.',
      'intro.source': 'View source',
      'intro.author': '@{owner}',
      'intro.docDev': 'Developer docs',
      'intro.docUser': 'User guide',
      'intro.navHome': 'Back to index',
      'intro.introTitle': 'What is this',
      'intro.introBody': '{siteTitle} is a display-only shelf: put your work into pages/, push to GitHub, and Actions rescans, rebuilds the searchable group index, and GitHub Pages publishes it. Both single HTML files and multi-file project folders are accepted, and there is no manifest, no configuration and no manual registration.',

      // ---- Intro: flow ----
      'intro.flow1': 'Drop it in',
      'intro.flow2': 'Push',
      'intro.flow3': 'Auto generate',
      'intro.flow4': 'Auto deploy',

      // ---- Intro: what it accepts ----
      'intro.supportTitle': 'What it accepts',
      'intro.supportLead': 'One rule decides everything: does the folder contain an index.html? Any origin, any stack — as long as it is static.',
      'intro.form1Tag': 'Single-file page',
      'intro.form1Body': 'One .html holding all its CSS and JS, runnable on double click. Hand-written, AI-generated or exported — all fine.',
      'intro.form2Tag': 'Project folder',
      'intro.form2Body': 'A multi-file project with index.html plus css / js / img. The whole folder becomes one card and relative paths keep working.',
      'intro.form3Tag': 'Group folder',
      'intro.form3Body': 'A folder without index.html is a category. Pages, projects and nested groups inside it are collected recursively, with no depth limit.',
      'intro.supportTip': 'Origin does not matter: hand-written pages, AI output, bundled builds (the dist of Vite / webpack), teaching demos, data visualisations, small games, docs pages — anything that opens directly in a browser.',
      'intro.limitTip': 'The one hard requirement is "purely static". Anything needing a server, a database or a runtime build (Node / PHP backends, SSR) is out of reach — GitHub Pages serves static files only.',

      // ---- Intro: features ----
      'intro.featTitle': 'Key features',
      'intro.feat1Title': 'Files and folders alike',
      'intro.feat1Body': 'Single HTML files and multi-file project folders each get their own card, tagged with which shape they came from.',
      'intro.feat2Title': 'Automatic grouping',
      'intro.feat2Body': 'Any folder without index.html becomes a group, and groups can nest indefinitely.',
      'intro.feat3Title': 'Instant search',
      'intro.feat3Body': 'Filter by title, description, filename and tags; hits are highlighted, empty groups hide themselves.',
      'intro.feat4Title': 'Fully automated',
      'intro.feat4Body': 'GitHub Actions rescans and regenerates the index on every push.',
      'intro.feat5Title': 'Bilingual',
      'intro.feat5Body': 'Chinese / English toggle built into both the index and the intro page, remembered across visits.',
      'intro.feat6Title': 'Responsive',
      'intro.feat6Body': 'Tailored for phone, tablet and desktop: drawer navigation on narrow screens, single column cards on phones.',
      'intro.feat7Title': 'Two themes',
      'intro.feat7Body': 'Dark and light themes, following the OS preference, with your choice remembered.',
      'intro.feat8Title': 'Zero cost',
      'intro.feat8Body': 'Hosted on GitHub Pages — free, with HTTPS and CDN included.',

      // ---- Intro: tree ----
      'intro.treeTitle': 'Directory layout',
      'intro.treeNote1': '# CI workflow',
      'intro.treeNote2': '# every work lives here (file / project / group)',
      'intro.treeNote3': '# root single-file page → one card',
      'intro.treeNote4': '# top-level folder → group',
      'intro.treeNote5': '# project folder → one card',
      'intro.treeNote6': '# index page template',
      'intro.treeNote7': '# index page stylesheet',
      'intro.treeNote8': '# dictionaries + runtime',
      'intro.treeNote9': '# generator script',
      'intro.treeNote10': '# generated, do not edit',
      'intro.treeNote11': '# developer / user docs',
      'intro.treeNote12': '# single-file page inside a group',
      'intro.treeNote13': '# site configuration',

      // ---- Intro: quick start ----
      'intro.quickTitle': 'Quick start',
      'intro.step1Title': 'Enable GitHub Pages',
      'intro.step1Body': 'Open Settings → Pages, pick "Deploy from a branch", choose branch main and folder / (root), then Save.',
      'intro.step2Title': 'Grant Actions write access',
      'intro.step2Body': 'Open Settings → Actions → General and set Workflow permissions to "Read and write permissions".',
      'intro.step3Title': 'Put your work into pages/',
      'intro.step3Body': 'Drop a single HTML straight in. For a multi-file project, give it its own folder and make sure the entry file is named index.html. To categorise, create a folder without index.html — its name becomes the group title.',
      'intro.step3Note1': '# root page → one card',
      'intro.step3Note2': '# group: games',
      'intro.step3Note3': '# project folder → one card',
      'intro.step4Title': 'Push',
      'intro.step4Body': 'The workflow regenerates the index, commits it back, and Pages deploys. Refresh after a moment to see the new card.',

      // ---- Intro: icon map ----
      'intro.iconTitle': 'Automatic icon mapping',
      'intro.iconIntro': 'The generator picks icons from file or group names. Nothing to configure.',
      'intro.thKeyword': 'Keyword',
      'intro.thIcon': 'Icon',
      'intro.thDesc': 'Meaning',
      'intro.rowGame': 'Games',
      'intro.rowTool': 'Utilities',
      'intro.rowPicture': 'Image tools',
      'intro.rowMap': 'Maps / spatial',
      'intro.rowDemo': 'Demos',
      'intro.rowBlog': 'Articles',
      'intro.rowAi': 'AI related',
      'intro.rowInfo': 'Intro / info pages',
      'intro.rowDefault': 'Fallback icon',
      'intro.iconTip': 'To add an icon, append one entry to iconMap in generate-index.js using a Font Awesome class name.',

      // ---- Intro: workflow ----
      'intro.flowTitle': 'How it works',
      'intro.flowComment': '# step one is the only manual step',
      'intro.flowStep1': 'Put HTML into',
      'intro.flowStep2': 'GitHub Actions kicks in',
      'intro.flowStep3': 'Runs the generator, scans recursively, writes the index',
      'intro.flowStep4': 'Commits and pushes it back',
      'intro.flowStep5': 'GitHub Pages deploys',
      'intro.flowStep6': 'Index refreshed, new cards / groups appear',

      // ---- Intro: FAQ ----
      'intro.faqTitle': 'FAQ',
      'intro.faq1Q': 'Action fails with ENOENT: no such file or directory, scandir \'pages\'',
      'intro.faq1A': 'pages/ is not tracked by Git, which ignores empty folders. Add at least one HTML file, or commit a pages/.gitkeep placeholder.',
      'intro.faq2Q': 'Action fails with Permission denied or 403',
      'intro.faq2A': 'Check that Workflow permissions is "Read and write" and the workflow declares permissions: contents: write.',
      'intro.faq3Q': 'Action fails with remote rejected',
      'intro.faq3A': 'Branch protection on main usually blocks the bot. Relax or remove the rule under Settings → Branches.',
      'intro.faq4Q': 'The Pages URL returns 404',
      'intro.faq4A': 'Confirm Source is "Deploy from a branch", branch main, folder / (root). Right after deploy, wait a few minutes and refresh.',
      'intro.faq5Q': 'My group does not show up',
      'intro.faq5A': 'Make sure the folder (including subfolders) contains at least one .html file — completely empty folders are skipped.',
      'intro.faq6Q': 'Can I add work that was not generated by AI',
      'intro.faq6A': 'Yes — the origin is irrelevant. Hand-written pages, exported templates and bundled builds (the dist of Vite / webpack) are all welcome, as long as they are static and open straight in a browser.',
      'intro.faq7Q': 'My project has css / js / img files — how do I add it',
      'intro.faq7A': 'Put the whole project in one folder, name the entry file index.html, then place that folder anywhere under pages/. Reference your assets with relative paths; nothing needs rewriting.',
      'intro.faq8Q': 'Can I host something that needs a backend or a database',
      'intro.faq8A': 'No. GitHub Pages serves static files only, so server-side code never runs. Host those elsewhere, or export a static build first and add that.',
      'intro.faq9Q': 'My page depends on external assets',
      'intro.faq9A': 'As long as it runs standalone you are fine. Keep CDN links as-is; for local assets, put them in the project folder and reference them relatively.',

      // ---- Intro: footer ----
      'intro.footBuilt': 'Built on GitHub Pages · MIT License',
      'intro.footDocs': 'Docs',
    },
  };

  // ---------------------------------------------------------------- 运行时

  function normalize(lang) {
    if (!lang) return '';
    var lower = String(lang).toLowerCase();
    if (lower.indexOf('zh') === 0) return 'zh';
    if (lower.indexOf('en') === 0) return 'en';
    return '';
  }

  function readStore() {
    try {
      return global.localStorage.getItem(STORE_KEY);
    } catch (e) {
      return null;
    }
  }

  function writeStore(value) {
    try {
      if (value) global.localStorage.setItem(STORE_KEY, value);
    } catch (e) {
      /* 隐私模式下忽略 */
    }
  }

  function detectLang() {
    // 1) URL 参数优先级最高，方便直接分享某个语言的链接
    try {
      var fromUrl = normalize(new URLSearchParams(global.location.search).get('lang'));
      if (fromUrl) return fromUrl;
    } catch (e) {
      /* ignore */
    }

    // 2) 已保存的选择
    var saved = normalize(readStore());
    if (saved) return saved;

    // 3) 浏览器偏好
    var nav = global.navigator || {};
    var preferred = normalize(nav.language || (nav.languages && nav.languages[0]));
    if (preferred) return preferred;

    return FALLBACK;
  }

  var listeners = [];
  var current = detectLang();

  function t(key, vars) {
    var table = DICT[current] || DICT[FALLBACK];
    var text = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : '';
    if (text === '') {
      text = (DICT[FALLBACK] || {})[key];
      if (text === undefined) text = key;
    }
    var values = mergeVars(vars);
    return text.replace(/\{(\w+)\}/g, function (all, name) {
      return Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : all;
    });
  }

  function parseVars(attr) {
    if (!attr) return null;
    try {
      return JSON.parse(attr);
    } catch (e) {
      return null;
    }
  }

  /** 把一个 root 下所有带 i18n 标记的节点翻译成当前语言 */
  function apply(root) {
    root = root || document;
    if (!root.querySelectorAll) return;

    var attrs = [
      ['[data-i18n]', 'data-i18n', 'text'],
      ['[data-i18n-html]', 'data-i18n-html', 'html'],
      ['[data-i18n-title]', 'data-i18n-title', 'title'],
      ['[data-i18n-content]', 'data-i18n-content', 'content'],
      ['[data-i18n-placeholder]', 'data-i18n-placeholder', 'placeholder'],
      ['[data-i18n-aria-label]', 'data-i18n-aria-label', 'aria-label'],
    ];

    attrs.forEach(function (item) {
      var nodes = root.querySelectorAll(item[0]);
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var value = t(el.getAttribute(item[1]), parseVars(el.getAttribute('data-i18n-vars')));
        if (item[2] === 'text') el.textContent = value;
        else if (item[2] === 'html') el.innerHTML = value;
        else el.setAttribute(item[2], value);
      }
    });
  }

  function htmlLang(lang) {
    return lang === 'zh' ? 'zh-CN' : 'en';
  }

  function setLang(lang, silent) {
    lang = normalize(lang) || current;
    if (lang === current && silent) return current;
    current = lang;
    writeStore(lang);
    if (document.documentElement) {
      document.documentElement.setAttribute('lang', htmlLang(lang));
    }
    apply(document);
    if (!silent) {
      listeners.slice().forEach(function (fn) {
        try {
          fn(lang);
        } catch (e) {
          /* ignore */
        }
      });
      if (document.dispatchEvent) {
        try {
          document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: lang } }));
        } catch (e) {
          /* 老浏览器忽略 */
        }
      }
    }
    return current;
  }

  function toggle() {
    return setLang(current === 'zh' ? 'en' : 'zh');
  }

  var api = {
    langs: SUPPORTED.slice(),
    get lang() {
      return current;
    },
    get langName() {
      return t('nav.langName');
    },
    /** 站点变量快照：{siteTitle} {owner} {repo} {branch} {docsDir} {bio}，静态页可用来拼链接 */
    get site() {
      return siteVars();
    },
    /** 语言按钮上显示的标签：始终指向「点一下会切到的那种语言」 */
    get nextLabel() {
      return t('nav.langLabel');
    },
    t: t,
    apply: apply,
    set: setLang,
    toggle: toggle,
    onChange: function (fn) {
      if (typeof fn === 'function') listeners.push(fn);
    },
  };

  global.I18N = api;

  // 首屏尽早落地：设置 lang 属性并翻译静态文案
  if (document.documentElement) {
    document.documentElement.setAttribute('lang', htmlLang(current));
  }
  if (document.addEventListener) {
    document.addEventListener('DOMContentLoaded', function () {
      apply(document);
    });
  }
})(window);
