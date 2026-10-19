# 项目长期约定

## 项目：文字版阳光牧场（网页游戏）

参考 3G 时代腾讯网页家园的《阳光牧场》。存档用浏览器 IndexedDB，无后端。
玩法是「文字农场」：种 145 种作物、40 块地、8 档土地、逛 15 座会自己成长的邻居农场。

## 工程约定（用户已确认）

- **零构建**：原生 ESM，`node server.mjs` 起静态服务，`package.json` 不引入任何 dependencies
- **测试策略**：用户明确说「不需要做测试，只用作代码静态验证」。改动后跑 `npm run check` 即可，
  不要擅自引入测试框架或浏览器自动化。需要验证逻辑时用一次性脚本跑完即弃，不要入库
- **分层单向依赖**：`ui → store → core`，`data` 谁都能读
  - core 只跟浏览器打交道，不认识游戏概念
  - store 是唯一允许改状态的地方，纯业务逻辑，禁止出现任何 DOM 符号
  - store 需要提示玩家时走 `store/notify.js` → 事件总线 → `ui/toast.js`
  - ui 只读 state、渲染、把点击转给 store，不保存业务状态
- **数据驱动**：作物 / 土地 / 地块 / 经验 / 称号全部由 `tools/gen-data.mjs` 产出，
  调平衡只改生成器，不手改 `src/data/{crops,soils,progression}.js`（文件头有「勿手改」）
- **单次业务操作的多表改动必须放进同一个 IndexedDB 事务**（`storage.commit()`），
  避免出现中间态
- **不要用后台定时器推进世界状态**：邻居成长只在进入邻居页时结算。
  需要「时间到了自然恢复」这类效果时用时间戳判定（如 `stolenAt`），而不是轮询清理

## 数值平衡方法（重要）

**经验曲线是反推的，不是拍脑袋定的**：

```
每轮经验 = 已解锁地块数 × 作物基础经验 × 土地经验倍率 × 多次收获收益系数
升级所需 = 每轮经验 × 每级需要的轮数
```

改任何一项（土地倍率 / 再生次数 / 地块数 / 作物经验），经验曲线自动跟随。
不要绕过生成器单独手改 `EXP_TABLE`。

刻意保留的两条非对称规则：
- **成熟时间允许非单调** —— 风味会调制时间，相邻作物倒挂是有意的调调剂，
  但相邻不能差出一倍（生成器会断言）
- **售价强制单调** —— `max(本次, 上次+1)`，避免「高等级种子更便宜」

## 代码风格

- 中文注释，JSDoc 标注参数与返回值
- 用户一贯要求：**只做精简优化，不改动既有逻辑，移除多余属性与导出**
  （改动时主动清理死代码，不要留没人调用的 export）
- `node --check` 依赖 package.json 的 `"type": "module"` 才能正确解析 ESM

## 验证手段：静态 + 端到端

- **静态**：`npm run check`（9 项，零依赖）挡低级错误
- **端到端**：真实 Chrome 跑完整交互，脚本**不进仓库**（项目坚持零依赖），
  放托管 node 工作区里借用已有的 `puppeteer-core` 跑。
  详见 `docs/11-端到端校验.md`

端到端才能抓到的典型问题（静态一律抓不到）：
- 页面隐藏时 `clientWidth = 0` → 除法得 NaN → 索引 undefined
- 事件冒泡顺序（点开即关）
- 浮层动画期间的位置错位

### 写拖拽手势的三条铁律（`ui/drag-close.js`）

1. `move()` 必须检查 `tracking`（有没有按下过）——
   否则 window 上的 `mousemove` 会在 `mousedown` 之前触发，
   此时 `startY = 0`，鼠标的绝对 Y 坐标被当成位移，弹窗瞬间被甩飞
2. 鼠标的 move/up 只在按下期间 addEventListener，松开立刻 remove
3. 用 **Touch 事件 + preventDefault**，不要用 Pointer 事件 ——
   `touch-action: pan-y` 下浏览器接管纵向手势并忽略 preventDefault，
   Pointer 方案会收到 pointercancel 而中断。
   对应 CSS：把手/标题栏 `touch-action: none`，滚动容器保持 `pan-y`

## 静态校验护栏（9 项，全部经过反向用例验证）

`npm run check`。新增交互时注意：

- `data-action="x"` 必须在 `actions: {}` 或 `*_ACTIONS = {}` 对象里有同名键，
  或在弹窗回调里用 `=== 'x'` 显式分支，否则第 7 项会失败。
  **注意**：用 `delegate(root, 'click', '[data-action="x"]', fn)` 这种把动作名
  写进选择器的形式是扫不到的，必须补一个 `const XXX_ACTIONS = { x: fn }` 对象
- `byId('x')` 用到的 id 必须在 index.html 里存在，否则第 5 项会失败
- 作物引用的生长阶段必须在 `data/stages.js` 的 `STAGES` 里定义过，否则第 8 项会失败
- 运行时才写入的 CSS 变量也必须在 CSS 里有兜底声明（如 `--hud-h`），
  否则第 6 项会失败
- **`import * as ns` 之后的 `ns.foo()` 调用，foo 必须真的被那个模块导出**，
  否则第 9 项会失败。这条是被真实崩溃逼出来的 —— 删除每日任务时漏删了
  `player.countWater()`，语法/路径/具名导入三项检查全都通过，只有运行才炸。
  **删除任何导出时，必须全量搜一遍调用点**：
  ```bash
  node -e "import('./src/store/player.js').then(m=>console.log(Object.keys(m)))"
  ```

## UI 规范（已统一，改动时不要破坏）

- **三个浮层**（底部浮窗 / 子页面 / 模态弹窗）共用一套：底部上滑、下拉关闭、
  最大宽度 640px 桌面居中、`24px 24px 0 0` 圆角、顶部有 `.sheet-handle`
- **下拉关闭**统一走 `ui/drag-close.js`：只有向下拖且超 8px 才接管，
  `scrollArea.scrollTop > 0` 时不接管，位移 > 72px 关闭
- **商店筛选条必须放在 `.shop-panels` 之外** —— `.shop-panels` 开了
  `overflow-x: auto` 就是滚动容器，里面的 sticky 会相对它定位，横向滚动时会被带走
- **顶栏详情是 absolute 定位**，盖在内容之上，绝不能让它进入布局流挤压土地区域
- **卡片高度对齐**：卡片 `flex-direction: column` + 按钮 `margin-top: auto`，
  这样「某个状态少了按钮」也不会让同一行参差不齐
- **未解锁地块最多只画 1 个**，其余折叠成 `.plot-fold` 汇总行

## 已知的历史包袱（刻意保留，未改）

- 玩家地里杂草 / 害虫永远不会出现（无任何地方置 `weed`/`pest` 为 true）。
  邻居地里已经会真的滋长，因为 NPC 有「打理」行为
- 「初次丰收」成就用 `等级 ≥ 2` 当代理判定，而非真实收获次数

## 架构注意事项

- NPC 模拟（`store/npc-sim.js`）是**纯计算**：不碰存储、不碰 DOM，只负责把 NPC 对象
  从旧状态推到新状态。落盘和分帧调度分别由 `social.js` 和 `ui/views/friends.js` 负责
- 远期离线走聚合公式、近期 7 天逐条精细模拟。改动模拟逻辑时不要破坏这个分层，
  否则离线久的玩家会卡死
- `store/state.js` 的 `normalizePlot` / `normalizeNpc` 负责给旧存档补字段，
  新增 NPC 或地块字段时必须在这里补上