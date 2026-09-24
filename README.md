# someToys - HTML 页面导航站

一个用于集中管理和展示独立 HTML 页面的静态站点。你只需要把 HTML 文件丢进 `pages/` 文件夹，推送到 GitHub，剩下的交给 GitHub Actions 和 GitHub Pages——自动生成带搜索功能的卡片式导航页，并发布到网上。

## 项目作用

- **集中托管**：所有独立 HTML 页面放在同一个仓库，无需为每个页面单独建仓库。
- **自动导航**：每次向 `pages/` 添加新 HTML，Action 自动扫描并更新导航页。
- **搜索过滤**：导航页顶部有搜索框，可按标题和描述实时过滤卡片。
- **现代化 UI**：深色玻璃态风格、卡片布局、悬停高亮、响应式设计。
- **GitHub 信息展示**：导航页展示 GitHub 头像、用户名和快捷入口。
- **零成本发布**：基于 GitHub Pages，完全免费。

## 项目结构

```text
someToys/
├─ .github/
│  └─ workflows/
│     └─ generate-nav.yml      # GitHub Actions 工作流
├─ pages/                      # 所有 HTML 页面放这里
│  ├─ page1.html
│  └─ page2.html
├─ templates/
│  └─ nav-template.html        # 导航页 HTML 模板
├─ assets/
│  └─ nav.css                  # 导航页样式
├─ generate-index.js           # 生成导航页的脚本
├─ index.html                  # 自动生成，请勿手动修改
├─ .nojekyll                   # 告诉 GitHub Pages 不要用 Jekyll
└─ README.md
```

## 如何使用

### 1. 创建仓库并启用 GitHub Pages

将本项目 Fork 或克隆到你自己的账号下，然后：

1. 打开仓库 **Settings → Pages**。
2. **Source** 选择 `Deploy from a branch`。
3. **Branch** 选择 `main`，文件夹选择 `/ (root)`。
4. 点击 **Save**。

稍等几分钟，访问 `https://你的用户名.github.io/仓库名/` 即可看到导航页。

### 2. 配置 GitHub Actions 权限

为了让 Action 能够把生成的 `index.html` 推回仓库，需要开启写权限：

1. 打开仓库 **Settings → Actions → General**。
2. 滚动到 **Workflow permissions**。
3. 选择 **Read and write permissions**。
4. 勾选 **Allow GitHub Actions to create and approve pull requests**（可选但建议）。
5. 点击 **Save**。

同时，确保 `.github/workflows/generate-nav.yml` 中已声明：

```yaml
permissions:
  contents: write
```

如果推送时遇到 `remote: Permission to ... denied` 或 `remote rejected`，请检查：

- **Settings → Branches** 中是否有针对 `main` 的分支保护规则。如果有，删除或放宽规则，允许 `github-actions[bot]` 推送。
- **Settings → Actions → General → Workflow permissions** 是否为 `Read and write`。

### 3. 添加新页面

在 `pages/` 文件夹中放入你的 HTML 文件，例如 `pages/my-page.html`。

建议在每个 HTML 的 `<head>` 中加上标题和描述，导航页会自动读取：

```html
<head>
  <meta charset="UTF-8">
  <title>我的页面标题</title>
  <meta name="description" content="这是页面的简短描述">
</head>
```

提交并推送到 `main` 分支：

```bash
git add pages/my-page.html
git commit -m "add my-page"
git push
```

GitHub Actions 会自动运行，重新生成 `index.html` 并提交回仓库。稍等片刻，刷新导航页就能看到新卡片。

### 4. 自定义导航页

- **改样式**：编辑 `assets/nav.css`，推送后立即生效，无需重新生成 `index.html`。
- **改结构**：编辑 `templates/nav-template.html`，推送后 Action 会重新生成 `index.html`。
- **改生成逻辑**：编辑 `generate-index.js`，例如调整排序、图标映射、标题覆盖等。
- **改 GitHub 信息**：在 `templates/nav-template.html` 中把 `Verlif` 替换成你的 GitHub 用户名。

### 5. 手动触发 Action

如果只想重新生成导航页而不添加新文件，可以在仓库 **Actions** 页面选择 `Generate Navigation Page`，点击 **Run workflow**。

## 工作流程

```text
添加/修改 pages/ 中的 HTML
        ↓
push 到 main 分支
        ↓
GitHub Actions 触发
        ↓
运行 generate-index.js，扫描 pages/ 并生成 index.html
        ↓
提交并 push index.html 回仓库
        ↓
GitHub Pages 自动部署
        ↓
导航页更新，新卡片出现
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

## 技术栈

- GitHub Actions
- GitHub Pages
- Node.js（生成脚本）
- 原生 HTML / CSS / JavaScript
- Deepseek V4.1-flash

## License

MIT