# 随机抽奖工具 · 项目长期记忆

## 技术约定
- 纯静态项目，无构建步骤。JS 使用原生 ES Module（`type="module"`），**必须通过 HTTP 访问**，不支持 file:// 直接双击打开。
- CSS 用 `css/main.css` 作为唯一 `@import` 入口，按 base → layout → components → responsive 分层；浏览器只需一个 `<link>`。
- 主题机制：`<html data-theme="light|dark">` + `css/base/theme.css` 中的双套 CSS 变量令牌。**组件样式一律只消费变量，不写死颜色**，新增配色请加到令牌表而非组件里。
- 状态集中在 `js/core/state.js`；所有 localStorage 读写收口在 `js/core/storage.js`。
- 依赖方向为单向 DAG：`main → modules → core/utils`。`history` 可依赖 `result`，`result` 只依赖 `utils/stats`，避免环。

## 模块职责
| 文件 | 职责 |
| --- | --- |
| `js/main.js` | 装配、事件绑定、启动 |
| `js/core/{state,dom,storage}.js` | 状态 / DOM 引用 / 持久化 |
| `js/modules/theme.js` | 亮暗主题切换与偏好持久化 |
| `js/modules/modal.js` | 模态框栈、Esc/遮罩关闭、提示与二次确认 |
| `js/modules/items.js` | 项目增删、权重编辑、权重条渲染 |
| `js/modules/scroll.js` | 滚动抽奖动画与中奖判定 |
| `js/modules/history.js` | 历史写入与两种排序渲染 |
| `js/modules/result.js` | 结果区渲染 |
| `js/modules/config-panel.js` | 命名配置的存/读/删 |
| `js/utils/*` | 防抖、洗牌与 gcd、统计 |

## 关键常量
- `.scroll-item` 高度 50px；全局 `box-sizing: border-box`，所以 `offsetHeight` 就是 50。
- 抽奖池重复铺 20 遍（`REPEAT_COUNT`）。
- 权重长按连击间隔 150ms。
- 抽奖池按数组 gcd 等比缩小后再展开。
- 权重文案 `.item__label` 高 100%（=进度条 26px），纯文字无底色无阴影压在进度条上，颜色用 `--text-1`（绿色填充区上级差灰对比度不足）；`.item__label-value` 与 `.item__label-input` 统一 34px 宽居中，改宽度时两处要同步，否则显示态与编辑态会错位。

## 交互约定
- 权重就地编辑：只把 `.item__label-value` 换成 `.item__label-input`，其余文案不重绘；编辑期间让出 `role`/`tabindex` 给输入框。
- 任何挂在容器上的键盘监听都要加 `event.target === 自身` 守卫，否则内层输入框的回车会冒泡回来重复触发。

## 视觉禁区（用户明确要求过）
- **压在进度条上的权重文案不得设 `background` / `box-shadow` / `text-shadow`**——前两者挡住进度条，text-shadow 的反色描边被用户评价为"太丑"，均已明确否掉。可读性靠文字颜色（`--text-1`）与字重层级（前缀/百分比 500、数值 700）解决。
- 权重条填充色保持饱和，不要为了迁就文字对比度而调淡。

## 代码规范（用户明确要求）
- 只做精简与重组，不改变既有业务逻辑；移除冗余属性与样式。
- 不做运行时测试，只做静态校验：`node --check` + css-tree 解析 + jsdom 加载。
- jsdom 校验用 **Node 原生 ESM `await import(pathToFileURL(...))`**：import 前把 jsdom 的 `window`/`document`/`localStorage`/事件类注入 `globalThis`（Node 22 的 `navigator` 只读，需 `Object.defineProperty`）。不要用"剥 import/export 拼 bundle"的方式——`items.js` 与 `result.js` 都有顶层 `createRow`，拼接会互相覆盖造成假象失败。
- 校验脚本一次一删，不留存在项目里。
