# someToys - AI 作品导航站

一个专门为 **AI 生成的前端作品** 设计的导航站。

把作品丢进 `pages/`，推送到 GitHub，剩下的交给 GitHub Actions 和 GitHub Pages——自动生成带搜索、分组索引和卡片信息的导航页，并发布到网上。

**核心理念：放文件 → 推送 → 自动上线。** 不需要改配置，不需要手动登记，不需要手动更新导航页。

## 项目作用

- **两种作品形态都支持**：
  - **单文件页面**：一个 HTML 文件包含全部 CSS/JS，直接放进 `pages/`。
  - **项目文件夹**：资源拆成多个文件的完整项目，放进一个文件夹，用其中的 `index.html` 当主页面，**文件夹名就是项目名**。
- **分组自动生成**：没有 `index.html` 的文件夹会被当作分组，分组可以任意层级嵌套。
- **集中托管**：所有作品放在同一个仓库，无需为每个页面单独建仓库。
- **自动导航**：每次向 `pages/` 推送内容，Action 自动扫描并重新生成导航页。
- **信息完整的卡片**：自动读取标题、描述、体积、更新时间和页面数量。
- **好用的检索**：实时搜索 + 命中高亮，分组折叠、分组索引、回到顶部、深/浅色主题。
- **零成本发布**：基于 GitHub Pages，完全免费。

## 核心概念

`pages/` 里只有两种东西，靠 **有没有 `index.html`** 区分：

| 目录形态 | 判定 | 在导航页里的表现 |
| :--- | :--- | :--- |
| `pages/xxx.html` | 单文件页面 | 一张卡片，直接打开这个 HTML |
| `pages/项目名/index.html` | **项目文件夹** | 一张卡片，卡片名 = `index.html` 的 `<title>`（没有就用文件夹名），点击进入 `index.html` |
| `pages/分组名/`（没有 `index.html`） | **分组文件夹** | 一个可折叠分组，里面的页面和子分组递归收录 |

> 只要文件夹里有 `index.html`，它就只算「一个项目」，不会再被当成分组展开。

## 目录结构

```text
someToys/
├─ .github/
│  └─ workflows/
│     └─ generate-nav.yml      # GitHub Actions 工作流
├─ pages/                      # 所有作品放这里
│  ├─ 介绍.html                 # 单文件页面
│  ├─ games/                   # 没有 index.html → 分组
│  │  ├─ 回声躲猫猫.html
│  │  └─ 新游戏/                # 嵌套项目文件夹 → 一张项目卡片
│  │     ├─ index.html
│  │     └─ assets/…
│  └─ tools/                   # 分组
│     └─ 随机抽奖.html
├─ templates/
│  └─ nav-template.html        # 导航页 HTML 模板
├─ assets/
│  └─ nav.css                  # 导航页样式
├─ generate-index.js           # 生成导航页的脚本
├─ index.html                  # 自动生成，请勿手动修改
├─ .nojekyll                   # 告诉 GitHub Pages 不要用 Jekyll
└─ README.md
```

## 快速开始

### 1. 创建仓库并启用 GitHub Pages

将本项目 Fork 或克隆到你自己的账号下，然后：

1. 打开仓库 **Settings → Pages**。
2. **Source** 选择 `Deploy from a branch`。
3. **Branch** 选择 `main`，文件夹选择 `/ (root)`。
4. 点击 **Save**。

稍等几分钟，访问 `https://你的用户名.github.io/仓库名/` 即可看到导航页。

### 2. 配置 GitHub Actions 权限

为了让 Action 能把生成的 `index.html` 推回仓库，需要开启写权限：

1. 打开仓库 **Settings → Actions → General**。
2. 滚动到 **Workflow permissions**。
3. 选择 **Read and write permissions**。
4. 勾选 **Allow GitHub Actions to create and approve pull requests**（可选但建议）。
5. 点击 **Save**。

`.github/workflows/generate-nav.yml` 中已声明：

```yaml
permissions:
  contents: write
```

如果推送时遇到 `remote: Permission to ... denied` 或 `remote rejected`，请检查：

- **Settings → Branches** 中是否有针对 `main` 的分支保护规则。如果有，删除或放宽规则，允许 `github-actions[bot]` 推送。
- **Settings → Actions → General → Workflow permissions** 是否为 `Read and write`。

## 添加作品（核心用法）

### 方式一：单文件页面

把 AI 生成的 HTML 直接放进 `pages/`，也可以放进任意分组文件夹：

```text
pages/我的工具.html
pages/小游戏/贪吃蛇.html
```

导航页会为每个文件生成一张卡片。

### 方式二：项目文件夹（推荐给多文件项目）

在任意位置建一个文件夹，把项目主页面命名为 `index.html`，其它资源随便放：

```text
pages/桌面宠物/
├─ index.html        ← 项目主页面，必须是这个名字
├─ css/style.css
├─ js/main.js
└─ img/cat.png
```

- **文件夹名 = 项目名**（如果 `index.html` 里写了 `<title>`，优先用 `<title>`）。
- 卡片上的「共 N 页」统计这个文件夹里的全部 HTML 文件数，体积统计整个文件夹。
- 卡片点击后打开 `pages/桌面宠物/index.html`。页面内用相对路径引用 `css/`、`js/`、`img/` 即可，不需要改路径。

### 方式三：分组与嵌套

没有 `index.html` 的文件夹就是分组文件夹，里面可以继续放页面、项目文件夹，甚至更多分组：

```text
pages/
├─ 介绍.html                      → 第一层卡片
├─ games/                        → 分组：games
│  ├─ 回声躲猫猫.html
│  └─ 解谜/                       → 子分组：解谜
│     └─ 数独/index.html          → 项目卡片
└─ tools/                        → 分组：tools
   └─ 随机抽奖.html
```

分组在导航页里可折叠，同时在左侧（窄屏为顶部横向条）生成分组索引；搜索时没有命中的分组自动隐藏，命中的分组自动展开。

## 元数据约定

在页面的 `<head>` 里写上这些标签，导航页会自动读取：

```html
<head>
  <meta charset="UTF-8">
  <title>桌面宠物</title>
  <meta name="description" content="一只会在桌面上乱跑的像素猫，支持喂食和换装。">
  <meta name="date" content="2025-03-08">
  <meta name="tags" content="像素, 桌宠">
</head>
```

| 标签 | 用途 | 缺失时的行为 |
| :--- | :--- | :--- |
| `<title>` | 卡片标题 | 单文件页面用文件名；项目文件夹用文件夹名 |
| `description` | 卡片描述（卡片显示 2 行，点卡片右下角 `…` 看全文） | 从正文头部尝试提取一句；提取不到就不显示描述 |
| `date` | 卡片上的更新时间 | 取该文件/文件夹最近一次 git 提交日期，再退回文件修改时间 |
| `tags` / `keywords` | 参与搜索匹配 | 只匹配标题、描述、文件名 |

`description` 也支持 `og:description`，`date` 也支持 `article:modified_time`。

### 推送

```bash
git add pages/
git commit -m "add new project"
git push
```

GitHub Actions 会自动运行，重新生成 `index.html` 并提交回仓库。稍等片刻，刷新导航页就能看到新卡片。

**这就是全部操作。** 不需要改导航页，不需要改配置，不需要手动注册。

## 本地预览

仓库根目录就是站点根目录，用任意静态服务器打开即可（**不要**直接双击 `index.html`，`file://` 下相对路径和剪贴板 API 会受限）：

```bash
node generate-index.js      # 扫描 pages/ 重新生成导航页
npx serve .                 # 或 python -m http.server 8000
```

## 自定义导航页

| 想改什么 | 改哪里 | 需要重新生成吗 |
| :--- | :--- | :--- |
| 颜色、间距、动效 | `assets/nav.css` | 不需要，推送后刷新即生效（导航页直接引用该文件） |
| 页面结构、脚本 | `templates/nav-template.html` | 需要（Action 会自动跑） |
| 扫描规则、排序、图标、卡片内容 | `generate-index.js` | 需要 |
| 站点标题、作者、简介 | `generate-index.js` 顶部的 `site` 配置 | 需要 |
| 图标映射 | `generate-index.js` 里的 `iconMap` | 需要 |

`site` 配置：

```js
const site = {
  owner: 'Verlif',              // GitHub 用户名，用于头像和链接
  siteTitle: 'someToys',        // 站点标题
  bio: 'AI 单页面作品集',        // 副标题
};
```

### 图标映射

`iconMap` 根据分组名、项目名或文件名里的关键词自动挑图标（按顺序匹配，命中即停）：

| 关键词 | 图标 |
| :--- | :--- |
| `game` / `小游戏` / `游戏` | `fa-gamepad` |
| `tool` / `工具` / `实用` | `fa-wrench` |
| `picture` / `image` / `图片` / `图像` | `fa-image` |
| `demo` | `fa-flask` |
| `blog` / `博客` | `fa-pen-fancy` |
| `ai` | `fa-robot` |
| `介绍` / `about` | `fa-circle-info` |
| 其他 | `fa-cube` |

想加新图标，在 `iconMap` 里加一条即可，值是 Font Awesome 6 Free 的类名。

## 导航页功能

- **搜索**：匹配标题、描述、文件名、标签；命中的文字高亮，分组计数显示为 `命中/总数`。
- **快捷键**：`/` 或 `Ctrl/Cmd + K` 聚焦搜索框，`Esc` 关闭弹窗 / 清空搜索，`D` 切换主题。
- **分组折叠**：点分组标题折叠，右上角按钮一键折叠/展开全部，折叠状态记在浏览器里。
- **分组索引**：左侧栏（窄屏为顶部横向条）列出所有分组，滚动时高亮当前分组，点击跳转；目标被折叠或被搜索隐藏时会自动展开。
- **卡片信息**：图标、标题、2 行描述、体积、更新时间（近期显示「3 天前」）、项目页面数。
- **详情弹窗**：卡片右下角 `…` 查看完整描述，可一键打开页面或复制链接。
- **主题**：深色 / 浅色，跟随系统偏好，手动切换后记忆。
- **回到顶部**：滚动后出现浮动按钮。
- **响应式**：宽屏左右分栏，窄屏自动变成上下布局与单列卡片。

## 手动触发 Action

如果只想重新生成导航页而不添加新文件，可以在仓库 **Actions** 页面选择 `Generate Navigation Page`，点击 **Run workflow**。

## 工作流程

```text
把作品放入 pages/（单文件、项目文件夹或分组文件夹）
        ↓
push 到 main 分支
        ↓
GitHub Actions 触发
        ↓
运行 generate-index.js，递归扫描 pages/ 并生成 index.html
        ↓
提交并 push index.html 回仓库
        ↓
GitHub Pages 自动部署
        ↓
导航页更新，新卡片 / 新分组出现
```

## 常见问题

**Q：Action 报错 `ENOENT: no such file or directory, scandir 'pages'`**

A：`pages/` 文件夹没有被 Git 跟踪。Git 不跟踪空文件夹，请放入至少一个 HTML 文件，或添加 `pages/.gitkeep` 占位文件后提交。

**Q：Action 报错 `remote: Permission to ... denied` 或 `403`**

A：检查仓库的 Workflow permissions 是否为 `Read and write`，并确认工作流中声明了 `permissions: contents: write`。

**Q：Action 报错 `remote rejected ... (failure)` 或 `fatal error in commit_refs`**

A：通常是因为 `main` 分支有保护规则，阻止了 bot 推送。请到 **Settings → Branches** 删除或放宽保护规则。

**Q：访问 Pages 地址显示 404**

A：确认 Pages 的 Source 设置为 `Deploy from a branch`，分支为 `main`，文件夹为 `/ (root)`。如果刚部署完，等待几分钟再刷新。

**Q：导航页没有更新**

A：检查 Action 是否成功运行，以及 `index.html` 是否被提交。可以手动触发一次 `Generate Navigation Page`。

**Q：我的项目文件夹被当成分组展开了**

A：确认主页面文件名就是小写的 `index.html`（`Index.html`、`main.html` 都不算）。也可以本地运行 `node generate-index.js`，看输出的项目数量是否正确。

**Q：我建了子文件夹，但分组没显示出来**

A：确认文件夹里（包括所有子目录）至少有一个 `.html` 文件。完全没有 HTML 的文件夹会被跳过，脚本会打印 `跳过空文件夹`。

**Q：能嵌套多少层分组？**

A：不限层数。分组索引会按层级缩进显示，窄屏同样可以逐层展开。

**Q：项目卡片上的「共 N 页」怎么算的？**

A：统计项目文件夹里所有 HTML 文件（含子目录），所以只放一个 `index.html` 的项目就是「共 1 页」。卡片上的体积统计文件夹里所有文件的总大小。

**Q：更新时间看起来不对**

A：优先读 `date` 元数据，其次取该文件/文件夹最近一次 git 提交日期。注意 GitHub Actions 是全新 checkout，取不到提交时间时会退回当前日期，所以想固定展示日期就写 `<meta name="date" content="2025-03-08">`。

**Q：卡片右上角的「项目」标签是什么意思？**

A：代表这张卡片来自项目文件夹，而不是单个 HTML 文件。

**Q：AI 生成的 HTML 里有外部依赖怎么办？**

A：只要页面本身能独立运行即可。依赖 CDN 的 CSS/JS 保持原样；有本地图片等资源时，单文件页面建议把资源一起放进 `pages/` 并保持相对路径，项目文件夹则把资源放在文件夹内、让 `index.html` 用相对路径引用。

**Q：卡片点击后是新标签页打开还是当前页跳转？**

A：新标签页打开（`target="_blank"`），方便同时打开多个作品对比，也不会离开导航页。

## 技术栈

- GitHub Actions
- GitHub Pages
- Node.js（生成脚本，无第三方依赖）
- 原生 HTML / CSS / JavaScript（导航页零框架、零构建）
- Deepseek V4.1-flash

## License

MIT
