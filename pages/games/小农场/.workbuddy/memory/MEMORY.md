# 项目长期约定 · 文字版阳光牧场

纯前端（原生 ESM、零构建、`node server.mjs`），存档 IndexedDB（`sun_farm_v2`），无后端。
220 作物（165 商店 + 55 限定）/ 40 块地 / 8 档土地 / 32 位邻居。

## 工程约定

- 分层 `ui → store → core`，`data` 谁都能读。store 是唯一改状态的地方、**禁止 DOM 符号**，
  提示走 `notify()` → 事件总线 → toast。ui 只渲染、只转交点击。
- **不做测试**：改动后只跑 `npm run check`，一次性验证脚本用完即删。
- 作物/土地/经验/称号由 `tools/gen-data.mjs` 产出，**不手改** `data/{crops,soils,progression}.js`。
- 多表写入必须同一事务：`commit({ farms, bag, news })`。无后台定时器，到点恢复用时间戳判定。
- 中文注释 + JSDoc，主动清死代码。

## 存档

`state = { farm, friends[32], bag{itemId:count}, news[] }`，玩家与邻居同形状。
五张表：`farm`(id) / `plot`([farmId,id]) / `log`([farmId,seq]) / `news`(seq) / `inventory`(itemId)。
`plots`、`log` 只在内存挂在农场上，写档拆回子表。⚠️ 复合主键每段必须有值。
新字段在 `normalizePlot`/`normalizeNpc`/`normalizePlayerFarm` 里给旧档补。

## 数值

- 经验：`expForLevel(n) = 100n(n+1)`（200 级 = `Infinity`，折算走 `expForProgress()`）；
  只看产出：每份 `(作物等级 + 2) × 土地 expMul`。
- 售价不自由：`整轮收益 = (种子价×1.2 + 等级×10) × (1 + 0.05×整轮小时)`；只该比「每小时金币」。
- 藏宝图：限定种子上限 = 需求等级+10，商店种子 = 需求等级×2。
- **限定作物**（`special`）不进商店与 `cropsNearLevel`，只能挖；茬数 2~5 都带 `multi`；
  整轮收益 = 同级商店种子 × 2.0~3.0。
- **种子制造间**（`farm.workshop = { level, uses }`，0 = 未开张）：Lv.5 + 2000 解锁，1~10 级，
  升级看累计次数 + 金币（满级 350 次 / 63.9 万），期望 1.22 → 2.00。
  份数**按市价折算** `max(5, ceil(seed × 0.6 ÷ sell))`（固定 5 份在 Lv200 是 12 倍利润）；
  限定作物不能造；先扣产出再摇数量，同一事务落盘。

## UI 硬约束

- 浮层统一：上滑进场、下拉关闭（`ui/drag-close.js`，>8px 接管、>72px 关闭）、最大宽 640px。
- **拖拽三条铁律**：① `move()` 先查 `tracking` ② 鼠标 move/up 只在按下期间挂 ③ Touch + preventDefault。
- **弹窗**：`openModal()` 把 `.modal-head` 提到 `.modal-body` 前（滚动区外）标题才拖得动；
  关闭图标由它统一补；`canStart(target)` 从标题/把手起手时忽略「内容已滚动」。
- 地块 = `.plot-main`(flex:1) + `.plot-side`(34px)；列数 手机2 / ≥720 3 / ≥960 4；
  高度 152 / 紧凑 126（图标 47 / 38px，gap 收到 2px 才不撑破）。成熟摇定 `plot.pendingYield`。
- **土地底纹**：`soilbg-<id>` 用 `::before` 叠横向渐变（左土地色 → 右普通色），**不能改 `background`**
  （`.ripe/.warn/.growing` 各有状态背景）；颜色只声明 `--soil-tint`。顶栏 `.hud-cell.wide` 显示构成。
- **`.npc-plot` 底色/边框/底纹与 `.plot` 完全一致**；状态类**只改边框不改 `background`**
  —— `.npc-plot.care` 曾写死 `#fffaf9`，缺水地一多整窗变白粉。
- 商店滚动落在 `.shop-panel` 自己；筛选条在 `.shop-panels` 之外；重绘先恢复 `scrollLeft` 再同步 tab。
  `.filter-bar` 邻居页与时报页共用（时报按 emoji 分类，不另存字段）。
- 日志/时报 `who` 是农场 id 数组 → `ui/who-chip.js` 的 `.who-chip`（头像 + 名字共用一个胶囊，底色
  `#e5f2da` 要比页面底深一档）；`stripWhoName()` 削掉正文里重复的名字与紧跟的「的」。
  时报图标固定最左、胶囊 + 时间放 `.news-head`。邻居搜索框必须是 index.html 静态结构。
- 弹窗内操作只替换受影响那一格，绝不整窗重开。

## 守护犬

10 档（**比熊 20%** → 龙犬 80%，田园犬第 7 档 58%），只有一只能上岗（空串 = 不设防）。
改名用 `LEGACY_BREED_MAP` **只迁一次**（写 `dog.migrated='r18'`），否则正经收集的田园犬会被降成比熊。
狗粮槽全窝共享，只在上岗时按 `6.25`/小时消耗；`catchChance(rate, sat) = rate × (0.5 + 0.5×sat/100)`。
被抓住（偷谁都算）按 `crop.sell × 5` 罚给被偷者，钱不够倾家荡产、不记负债。

## 邻居与世界

- 邻居同用 `unlockedPlotCount(level)`；地块土地按 `rollNpcSoil(level)` 随机，收成吃 `yieldMul`。
- 偷菜只减 1 个，每块每轮一次，`stealable()` 要带 `!plot.guarded`。
- 成熟的地不再需要照料：`needsWater`/`needsPest` 必须带 `now < readyAt`。
- NPC 模拟是纯计算，落盘由 `persistFriends()` 一次提交；远期聚合、近期 7 天逐条；
  在线时上线拆成动作串演出，游标先推进、一步一落盘。`PLAYER_FARM_WEIGHT = 2`。

## 其它

- 时报 7 天 / 80 条、日志 7 天 / 60 条，按 `at` 倒序。施肥额度唯一（`plot.fert`），增产与捉虫相乘。
- 图鉴靠标本点亮（一份 50 个产出）；已解锁卡片可点开详情——动作属性必须写在 `class` 之外。
- 称号 38 个（26 等级 + 7 图鉴 + 5 金币），手动领、只戴一个、奖励只有道具。
  **按三类分 tab**（`.title-tabs` 吸顶）：tab 状态挂模块变量 + 切 tab 后 `scrollTop = 0`。
- 引导 17 项，达成即自动发奖；每个 key 都要有真实调用点。背包展示名走 `itemLabel(id)`。
- 签到不发经验；历史存 `progress.signDays`（90 天）。「其他」已删加工坊/交易行，改放种子制造间。

## 护栏与踩坑

`npm run check` 盲区：抓不到私有函数丢失 → **删/搬函数后必须 `grep -rn` 搜全调用点**。
e2e（真实 Chrome，脚本不入库）：等 `body[data-page]`；**全屏 `.sign-celebrate` 会吞点击**；
多页面 DOM 并存要限定活动页；返回 `#subBack`、关模态 `[data-close]`。
