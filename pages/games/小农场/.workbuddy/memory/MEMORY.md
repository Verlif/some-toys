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

**经验曲线是累加的，与作物/土地/地块完全解耦**（第 14 轮起，用户指定）：

```
expForLevel(n) = 200 × n + expForLevel(n-1)      // 即 100 × n × (n+1)
```

Lv1→2 要 200，Lv199→200 要 398 万，满级累计 2.67 亿。
调作物经验公式（每份 = 等级+2）不会影响升级门槛，反之亦然。
`expForLevel(200)` 返回 `Infinity`（满级），按等级折算一律用 `expForProgress()`。

刻意保留的一条非对称规则：
- **成熟时间允许非单调** —— 风味会调制时间，相邻作物倒挂是有意的调调剂，
  但相邻不能差出一倍（生成器会断言）

其余经济规则见「经济与冒险」节。

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

### 写 e2e 脚本的三个坑（第 14 轮实测）

1. **切页必须等 `body[data-page]` 落地** —— 各页内容启动时就渲染过，
   光 `waitForFunction` 等「元素存在」会瞬间通过，点到的是隐藏页面里 0×0 的元素
2. **邻居页进入有 ≥650ms 的离线结算浮层**（`#simOverlay`），点击会被它吞掉
3. **所有浮层都有 0.25~0.3s 位移动画**，元素一存在就点会点在动画中途。
   通用解法：等元素及祖先的 `getAnimations()` 全部 finished 再点

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
## 第十、十一轮之后的约定（弹窗与邻居）

- **弹窗里的操作绝不整窗重开**：只替换受影响的那一格（`data-slot`）与相关角标 /
  提示 / 日志区，否则滚动位置会被冲回顶部。日志区是固定 `max-height` 自己滚的容器，
  新增一条不会把下面的内容顶下去
- **成熟的地不再需要照料**：`needsWater` / `needsPest` 必须带 `now < readyAt`，
  两边（farm / social）保持一致
- **偷菜只减 1 个**：按 `stolenCount` 扣产量，不做「减半」；每块每轮最多被顺 1 次
- **邻居有日程模型**：`schedule`（固定钟点 / 随机间隔）+ `steal` 倾向四档 +
  `profession`。新增 NPC 只需在 `NPCS` 里加一条，`initState` 会按 id 差集补建
- **NPC 动玩家农场**通过传给 `simulateNpc` 的 `farm` 对象（plots / 计数 / log 回调），
  npc-sim 仍然不认识 store；落盘由 `social.persistFriends()` 一次提交 player+plots+friends
- 玩家日志 `player.log`：7 天 / 60 条上限，展示时按 `at` 倒序（邻居补写的是过去时间）

## 经济与冒险（第十二轮之后的约定）

- **售价不是自由变量**：`整轮收益 = (种子价 × 1.2 + 等级 × 10) × (1 + 0.05 × 整轮小时)`，
  单价 = 整轮收益 ÷ 总产量。改经济只改这条公式或 `seedPrice`；
  风味 / 分类**不再乘价值系数**，只剩成熟时间倍率
- **单价与整轮收入都不再强制单调**：长周期作物等得久，整轮收入天然更高。
  唯一该比的指标是「每小时金币」
- **时长倍率刻意不封顶**（用户决定）：Lv120 以上每小时收益会比旧版高 46~81%；
  后期还想降速，只能把那个 5% 调小
- **藏宝图两种种子上限**：限定种子仍是 `需求等级 + 10`，商店种子是 `需求等级 × 2`
  （`MAP_TIERS.shopSeedCap`，UI 也读这个字段）
- **藏宝图奖励构成**：金币 2 : 商店种子 4 : 道具 1；带奖励的牌只占三成
  （`REWARD_CARD_RATIO`）。改牌数只改「每份多肥」，**不改总产出** ——
  要真降总产出必须动 `POOL_VALUE_RATIO`
- **特殊作物**（`special: true`）不进商店、不进 `cropsNearLevel`，
  只能从藏宝图挖；种子可以越级种（有种子就能种）
- **邻居等级**：名单里不写 level/coins，`createNpc` 现掷 1~56（低等级更多），
  成长上限 56；新增 NPC 只加 id/name/avatar/personality/profession/schedule/steal
- **冒险是第 4 层页面**：`#adventure` z-index 105，必须低于模态弹窗（130），
  因为退出确认用的是 openModal。奖励每次即时落盘，牌堆只存内存
- **卡牌手势**用 Touch + 鼠标双通道，`touch-action: none`；阈值用绝对像素；
  结算后必须清 `dragging/offset`，否则下一次轻点会重复选路
- **CSS 类名**：`.meta-tag` 的修饰类不要用 `cycle`（签到卡片占用了全局 `.cycle`）；
  标签高度写死 18px，避免 emoji 回退字体把行高撑开

## 经验 / 多茬 / 守护犬 / 时报 / 一键道具（第十三~十四轮之后的约定）

- **经验只看产出**：每份 = `作物等级 + 2`，再乘土地 `expMul`。
  升级门槛是独立的累加曲线（见「数值平衡方法」节），改公式重跑生成器即可
- **多茬作物是经验流**：`regrow: 0.8` 让总周期变长，整轮收入仍按等级锁定，
  所以金币/小时天然低。给它们加价会触发「同分类整轮收入单调」的连锁抬价，
  所以同等级横向比较里必须排除 `c.multi`
- **守护犬**：`state.pet = { satiety, updatedAt }`，一律用 `dogSatiety()` 现算；
  离线结算要传 `farm.dogSatietyAt(t)` 还原当时饱腹度。
  狗只拦**别人偷自己**，玩家偷别人不再有概率失败。
  ⚠️ `commit` 的第一个参数才是 singles：`commit({ player, pet }, { bag })`，
  把 pet 放进第二个参数会被静默丢弃（第 14 轮修过这个 bug）
- **NPC 也有守护犬**：`npc.dogSatiety + npc.dogAt`，同一套衰减；
  上线按 `min(0.55, tend×0.13)` 概率喂食。玩家偷菜被抓住时，
  给该 NPC 所有带作物地块置 `guarded`（等同「已偷过」），
  `isStealable` 必须一并检查；重种 / 进再生轮时清除
- **时报**：`store/news.js` 写 `player.news`（7 天 / 80 条，不升数据库版本）。
  玩家里程碑直接 `addNews`；邻居的故事由 `simulateNpc` 的 `farm.news` 回调补写过去时间点，
  内部按 `at` 倒序重排后再截断
- **一键道具**：`sprinkler` / `pesticide`（各 200），`ITEMS[].all = 'water'|'pest'`；
  玩家农场出 `#farmTools`（`body.has-farm-tools` 顶开日志按钮），
  NPC 弹窗出 `.npc-quick`。没道具或没需求时按钮不出现
- **施肥额度是唯一的**（第 15 轮）：普通化肥 / 增产剂 / 有机化肥共用 `plot.fert`，
  一株作物一轮只能施一次。增产加成记在 `plot.yieldBonus`，
  收获时与捉虫加成**相乘**（不是相加）。老存档 `plot.organic` 读档时并进 `plot.fert`
- **图鉴靠标本点亮**：`player.specimens = { cropId: true }`，
  一份标本 = 50 个对应产出（`SPECIMEN_COST`）；`codexEntries().lit` 是「有标本」，
  不是「收获过」。库存不够或做过时**不显示**制作按钮
- **称号全部手动领取**（第 15 轮）：33 个（26 等级 + 7 图鉴），
  数据在生成器里产出（`progression.js` 的 `TITLES`，字段 `need/skin/coins/items`）；
  `player.titles = { claimed:{}, equipped }`；同时只能戴一个，佩戴的显示在顶栏。
  ⚠️ `titleOf(level)` 已删，改用 `titleById(id)` / `titleAt(type, value)`
- **签到不再发经验**（第 15 轮）：每天 = 普通化肥(30分) + 随机商店种子 + 少量金币；
  **周六是大奖日**（`isBigDay`），额外从该等级可用最高档藏宝图的奖励池抽一份
- **地块角标**：`.plot-corner` / `.np-corner` 绝对定位不占流。
  ⚠️ 类名是 `np-corner` 不是 `npc-corner`（写错过的坑）
- **商店是固定高度页**：`#page-shop` 上贴 `--hud-h` 下贴 `--tab-h`，
  纵向滚动必须落在 `.shop-panel` 自己身上；任何新的商店 tab 都要是一个
  `.shop-panel[data-panel]`，否则会退回「共用一个滚动条」
- **跳转带 tab**：`EVENTS.NAVIGATE` payload 可以是 `{ page, tab }`，
  `activatePage(name, options)` 里对 shop 调 `setShopTab(options.tab)`
- **顶栏 / 导航不用渐变、不用毛玻璃**：纯色更耐看，也不会透出灰色像阴影
- **种子标签分档**统一走 `ui/meta-tags.js`，不要在两处各写一套
