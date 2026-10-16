# 键盘反应测试 · 项目长期约定

## 技术栈与结构
- 原生 HTML/CSS/JS（ES Modules），零依赖、零构建；`package.json` 设 `"type": "module"`
- `index.html` 主页面 / `pages/test.html` 测试页 / `pages/about.html` 关于页
- `js/` 下分 `core`（布局、键盘渲染、统计、模式元数据）、`modes`（四种玩法实现）、`ui`（选择菜单、组件、结算浮层、主题、背景碰撞）、`utils`
- 用 `node tools/serve.mjs`（或 `npm start`）起本地静态服务器，端口 5173。**ES Modules 不能 file:// 直接打开**
- 原单文件版本归档在 `legacy/`，不再维护

## 主题
- 所有颜色必须走 CSS 变量，禁止在组件里写死颜色。`:root` = 亮色，`:root[data-theme="dark"]` = 暗色，集中定义在 `css/base.css`
- 键盘用变量族：`--board-*` / `--key-*` / `--key-mod-*` / `--key-press-*` / `--key-target-*` / `--key-wrong-*`；背景漂浮键帽用 `--fx-key-*`
- 主题默认跟随系统，手动切换后存 `keyboard-lab:theme`；每页 `<head>` 有内联脚本提前写 `data-theme` 防闪白
- 主题变化时 `document` 上派发 `themechange` 事件，Canvas 类绘制监听它重新取色
- 背景碰撞层的键帽 = **当前布局全部按键**（QWERTY 60% 为 61 个，与物理键一一对应），尺寸按 `sqrt(视口面积 * 8% / 键数)` 自适应并夹在 [18, 48]px

## 键盘渲染
- 物理键位统一用 `KeyboardEvent.code`，切换布局只换键帽 label
- `Keyboard` 只负责 DOM 与状态类：`is-pressed` / `is-target` / `is-wrong`；玩法逻辑一律不碰 DOM
- **键宽公式统一**：所有项（含占位）都是 `calc(var(--u) * w + var(--gap) * (w - 1))`，占位用 `sp(2/3)` 表示 F 键区分段（等价于 (2u-g)/3）。`layouts.js` 的 `estimateWidth()` 据此估算总宽，预览自适应依赖它，改动公式必须同步改 `estimateWidth`
- 尺寸走 `--kb-u` / `--kb-gap`：`:root` 定义并做媒体查询，`.keyboard` 派生 `--u`/`--gap`，预览键盘由 `js/ui/preview.js` 用内联 `--u`/`--gap` 覆盖（**[12, 28]px**，配置页两栏等宽以留出足够宽度）
- 挑战出题只用字母与数字（`buildCharPool`），并且**键盘底部的连击徽标也放在 bottom 以避开这些键**
- 三种键盘（主页面 hero、配置阶段预览、运行阶段主键盘）都应响应真实按键高亮；仅运行阶段拦截默认行为

## 玩法调度
- 入口 `js/test.js`：`body[data-phase="setup"|"play"]` 切换阶段；模式实现统一返回 `{ id, onKey(code, event), stop() }`
- 模式元数据在 `js/core/modes.js`（`MODE_META`），选择菜单与关于页共用，实现按 id 从 `FACTORY` 取
- 全局 keydown 只在 `phase === 'play'` 且焦点不在输入控件时生效；拦截 Space/Tab/Enter/Backspace/方向键
- 需要吃掉剩余高度的模式给 `dom.modeStage` 加 `is-fill`（`teardown()` 负责移除）
- runtime 对象提供 `keyboard / pool / labelOf / setStatus / top / bar / stage / restart() / exit()`

## 布局要点
- 运行阶段锁一屏（`body[data-phase="play"] { height:100vh; overflow:hidden }`），整页不出现滚动条；冗余数据用内部滚动容器承接
- **连续挑战的序列条 `.seq-strip` 要隐藏滚动条外观**（`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`），保持单排横向滚动
- 配置阶段两栏**等宽**铺满（`.setup-view` 1fr : 1fr），`开始` 按钮吸底（`margin-top: auto`）；预览键盘垂直居中
- `.app { min-height: 100vh }` 保证三页都撑满视口；`.app--test` 上限 1140px 给预览留宽度

## 编码约定
- 使用框架提供的 `el()` 构造 DOM（`js/utils/dom.js`），不写 innerHTML 拼字符串（除静态提示文案）
- 键盘输入统一走 `isEditable(event.target)` 判焦点，避免抢输入框的按键
- 结算数据统一用 `core/stats.js`：`describe()` 描述一组毫秒值，`keyRanking()` + `barRows()` 出按键排行与柱状图行
- 版本号同时出现在 `package.json`、`index.html` 页脚与关于页

## 用户偏好
- 只做静态验证（`node --check` + 脚本检查引用一致性），不需要跑运行时测试
- 收到需求先梳理并确认，再动手
- 喜欢组件化、Canvas 渲染、确定性输出；强调代码精简，移除冗余属性与样式
