# 项目长期约定 · 西米的农场

纯前端（原生 ESM、零构建、`node server.mjs`），存档 IndexedDB（`sun_farm_v2`），无后端。
游戏正式更名《西米的农场》，但 DB_NAME/localStorage key/APP_NAME 保持 sun_farm* 不变（存档兼容）。
局域网联机走 WebRTC P2P（`vendor/webconnect.js`）。267 作物（165 常规 + 102 限定）/ 40 块地 / 8 档土地 / 32 位邻居。

## 工程约定

- 分层 `ui → store → core`，`data` 谁都能读。store 唯一改状态、**禁 DOM 符号**，提示走 `notify()`。
- **不做测试**，只跑 `npm run check`（语法/import/id/CSS 变量/data-action/数据一致性），验证脚本用完即删。
- 中文注释 + JSDoc，主动清死代码。作物/土地/经验/称号由 `tools/gen-data.mjs` 产出，**不手改** `data/{crops,soils,progression}.js`。
- 多表写入同一事务 `commit({ farms, bag, news, relations, dailyRows })`（**动了才带**）。

## 存档

`state = { farm, friends[32], bag, relations, news[], dailyRows }`，玩家与邻居同形状。
七表：`farm` / `plot`([farmId,id]) / `log`([farmId,seq]) / `news` / `relation`([a,b]) / `inventory` / `daily`(date)。
⚠️ 复合主键每段必须有值。日志 `{at, emoji, text, by}`：`by`=邻居 id（NPC→玩家操作才传）。
新字段在 `normalizePlot/normalizeNpc/normalizePlayerFarm` 里补。`writeFarm` 存整行（除 plots/log），progress 随行落盘。

## 数值

- **六种原型** `arch`：速生/丰产/精品/慢生/多茬/常规。经验 `expForLevel(n)=100n(n+1)`；
  售价 `整轮收益=(种子价×1.2+等级×10)×(1+0.05×整轮小时)`。
- **地块**：`plot.usable` 落库，开局 6 块，第 N 块 `(已拥有-6)×1000+500`。升级不给地。
- **三件省手道具**（洒水器/杀虫剂/采收机）各 200 金币，各有永久版，先查永久再查消耗。
  **永久采收机 20,000**（另两件永久版 50,000）—— 一键收获玩家最先想要。
- **种子制造间**（`farm.workshop = {level, kinds, jobs}`）：Lv.5+2000 解锁，份数 `max(1, round(一轮平均产出/2))`，
  工本费 `round(种子价/4)`，升级看**造过的种类数**，限定作物也能造。
  第 44 轮起**排队制造**：`jobs` 一炉 `{id,cropId,need,fee,startAt,doneAt}`，`craftMs=max(1,lv)×10s`，
  **栏位数 = 等级**；`craft()` 只入队，`claimJobs()` 到点才加种子 + `kinds++`（`scheduleClaim` 挂 setTimeout）。
  ⚠️ 时间戳落库，离线照样走；读档清洗 jobs（认不得的 cropId / `doneAt<=startAt` 丢掉，上限 10）。
- **照料**：`下次 = now + [次数×1h, (次数×2+1)h]`，不排进成熟前 15 分钟。欠水 −15%、欠虫 −40%。
- **好感度**：−200~200，打理 +1、偷菜成功 0、被逮 `max(1,round(售价/10))`、送 `max(1,等级/2)`。
  亲近档 ≥100：NPC 优先打理，`closeGiftChanceFor`（100→0.25，200→0.55）×性格系数；<100 封顶 0.5。
- **土地逐级晋升** `nextSoilId`，`upgradeSoil` 拦跳级；yieldMul/timeMul/expMul 三处生效。
- **仓库卖出**：`.qty` 步进器默认全量；`.codex-mark` **只在点亮时渲染**。

## 世界时钟（第 46 轮，核心）

**唯一驱动是时间**：`store/world.js` 的 `advanceWorld({from,to,ctx,deferFrom,onVisit,onProgress,report})`
从「上次离开」逐段推到「现在」，每段按顺序：到点上线（按 `nextVisitAt` 升序）→ 订单过期 →
跨 14:00 结算榜单（`checkRollover(now,{quiet:true})`）→ 制造间收炉。离线与在线**同一条路径**。

- 步长自适应：`stepMsFor(span)`，≤7 天 1 分钟，之后每翻倍时长步长翻倍，封顶 60 分钟。
  动作时刻用**真实时间戳**不用步点（粗步长不会把上午的活记成下午）。
- `VISIT_BUDGET=30_000`：超预算把**最早那段**交给 `bulkAdvance` 聚合，最近那段仍逐分钟走，
  时间轴标「更早的部分按汇总补算」。30 天约 6000 次上线，正常永远碰不到。
- ⚠️ **补算期间所有跨表动作必须 quiet**（`expireOrders` / `claimJobs` / `checkRollover`），
  改内存不写库，结束统一 `flushAwards()`。早年每条订单过期 commit 一次 → 365 天要 18 秒，改完 0.4 秒。
- 起点 `from = min(worldCursor, lastSeen())`；`lastSeen()` 读 `progress.lastSeenAt`，
  老档没有就退回「最早的待办上线」，兜底 8 小时。
- **报告起点 ≠ 模拟起点**：报告从 `lastSeenAt` 算（新档就是建号时刻，不会误弹「你不在的 16 小时」），
  模拟仍要覆盖那批排在十几小时前的开局上线。
- `deferFrom`：只有「刚刚这一分钟」到点的上线才演给玩家（`deferFrom = sessionStart`）；
  间隔 >2 分钟（页面被冻结）说明事已过去，直接算完。
- 在线心跳 `main.js` 每 60 秒 `checkOnlineVisits()` = 时钟推一分钟；页面隐藏时 `touchLastSeen()`。
- 离线时间轴 `ui/offline-report.js`：**>2 小时才弹**（`REPORT_MIN_SPAN`），四个总账格子 + 按天
  （自然日，0 点切）列表，每天最多 6 条事件、最多展开最近 10 天。要等 `celebratePending()` 清零再弹。
  不足一天按小时说（「你不在的 3 小时」），天数按 elapsed 算不按桶数。

### NPC 行动框架（注册表）

`npc-sim.js` 的 `ACTIONS`：`{ label, main, sweep, can, run }`。
`main` = 占性格权重名额（`PERSONALITIES.weights` 同名键）；`sweep` = 每趟顺路再试一次；
`can` **只过滤 main 候选池**（必须便宜、无副作用）；`run(npc, at, ctx)` 返回 `{emoji,text,...}|null`。

- 加新行为 = 往表里加一条，不动 planVisit / runStep / 演出队列。
- ⚠️ `sweep` 的动作**不能写 `can`**：can 在规划时算，而收获途中才腾出空地，补种得看那之后。
- ⚠️ `harvest` / `tend` 必须同时挂 `main` 和 `sweep`，否则没抽到那趟就整趟不管自家地。

## UI 硬约束

- **四个主页面 tab**：农场 / 邻居 / **村中心 🏡**（`views/center.js`）/ 商店。
  ⚠️ 村中心 🏡 ≠ 村镇 🏘（联机浮窗，进村才出现）。
  村中心 = 总览卡（在线/总人数**含玩家**，占满一行、**点击弹窗看名单**，弹窗「全部/在线」筛选）
  + 下方并排两枚按钮：📢 公告栏（时报弹窗，过滤/排序栏在列表下面）、📋 订单（**唯一入口**）。
- **农场页顶部操作条**：`.farm-bar` 一张白卡放 `#page-farm` 首位、**流内跟着土地列表滚**，
  上排守护犬（整格可点 → 狗窝）+ 日志方块、下排三格一键（图标/名字/橙色待办数/存量）。
  **不要再往底部堆 fixed 浮层**；`data-action` 必须写字面量（check.mjs 扫不到模板拼接的名字）。
  存量只标消耗版 `×N`，永久版不显示数字；`.fa-stock` 只在 **<330px** 隐藏。
- **土地列表顺序**：已解锁地块 → 荒地卡（未解锁只画第一张，🔓价格）→ `.plot-fold` 汇总行垫底。
  开垦后新建卡会 append 到汇总行后面，`renderFarm` 末尾必须把汇总行挪回末尾。
- **toast**：背景 .75 alpha（`rgba(34,48,31,.75)`），文字纯白 —— 用背景 alpha 不用 `opacity`。
- 浮层统一上滑进场、下拉关闭（`drag-close.js`）。**拖拽三条铁律**：①move 先查 tracking ②鼠标事件只在按下期间挂 ③Touch+preventDefault。
- **弹窗四段式**：handle/head/body/foot。别用 sticky 代替 foot（body 底部 18px 渐隐会削掉）。
  支持叠层，动作只派栈顶。`.modal-sub` **不许负上边距**（body 是 overflow，顶出去会被裁）。
  `openModal(html, fn, cardClass)` 第三参挂整卡类名（每次打开重置，快照栈也存/还原 className）。
- 地块 `.plot-main` + `.plot-side`(34px，≤4 按钮)；锁定地块 `.plot-lock` 空占位盒(47/38px)。
- **土地底纹** `soilbg-<id>` 用 `::before` 叠渐变，**不能改 `background`**，只声明 `--soil-tint`。
- **地块两圈动效**：限定作物 = `<i class="plot-aura">` 的 `conic-gradient` 旋转金边（`@property --plot-spin`）；
  缺水/生虫（红）/成熟（橙）在同层 `::after` 做 `scale(1→1.06)` 外扩环。`.plot` 自己的伪元素被底纹与压边占着，**不能动**。
- **横滚芯片条接力** `ui/scroll-keep.js` 的 `keepBarScroll`：friends/news/shop。
- **图鉴**：卡片只有图标+名称；三档筛选；点得开 = `unlocked||collected`；收集≠点亮。
  双重进度条（下层绿=已收集 10px，上层金=已点亮 5px）。点亮后不再显示「制作标本」。
  点亮动画：先 `closeModal()` 再播 `ui/codex-celebrate.js`（订阅 `EVENTS.SPECIMEN`，z-index 210）。
- **邻居页**筛选与排序两条独立状态；筛选只认点击。
- **记录只有一种长相** `recordItemsHTML`；行内标签 `inlineTagsHTML`。
- **作物详情只有一个弹窗** `openCropModal`；**邻居农场弹窗只有一个** `openFriendModal`：
  头部 → 数据卡 2×2 → `.npc-quick`（送礼/交易）→ **控制台 `.npc-board`**（两行：农场 N 块 + 🚿🧴 ｜
  狗粮槽 + 🦴 + 📜）→ 地块 → 提示。控制台普通文档流**故意不 sticky**；日志走 `openFriendLog()` 叠层。
  🦴 添狗粮走 `confirmFeedDog` 确认叠层；NPC 与联机好友同一套。
- **农场日志双 tab**：「我的操作」= `!entry.by`，「邻居动向」= `entry.by`。
- **称号页** `.title-card > :last-child` 固定 28px 高居中（四种结局等高）。
- **送礼三层**：清单→确认框→发送；赠礼层不做 opacity 动画。

## 守护犬

10 档（比熊 20%→龙犬 80%），只有一只能上岗。`catchChance(rate,sat,max)=rate×(0.5+0.5×sat/max)`。
被抓住按 `crop.sell×5` 罚款 + 掉好感 `max(1,round(售价/10))`；偷在线 NPC 双倍惩罚。
⚠️ 饱腹度是「基准值 + 基准时刻 `dog.at`」两件套，`dogSatietyAt()` **只认 `at`**。
写存量必须 `dog.satiety = 新值; dog.at = now;` 成对写（曾错写成不存在的 `fedAt`，喂了等于没喂）。
满槽（≥ 容量-1）拒收并退狗粮。第 43 轮起槽容量随**狗窝等级**（`100+30×级`），玩家侧必须传 `kennelCapacity()`；
界面上是**点数 `45/100`** 不是百分比。

- **狗窝升级**：只花金币 2000/5000/10000/15000/25000，每级 +30 容量；升级前必须 `settleSatiety(now)`。
- **每日挖宝**：有狗上岗且槽里有粮时每天 30% 掷一次，按品阶取藏宝图档位（`ceil(品阶/2)`）。
  只掷已过完的天，`farm.dogHouse.digDay` 记账，离线补掷 ≤7 天；掷完无论中没中都推进并落盘。
- **狗粮两种**：`dogFood` +45（50 金币）、`dogFoodPro` +100（100 金币），点数在 `ITEMS[id].food`。

## 邻居与世界

- 邻居同用 `unlockedPlotCount`；偷菜 `stealable()` 要 `!plot.guarded`。
- NPC 模拟纯计算，`simCtx()` 注入 rel/receiveGift/daily/orders，npc-sim 不 import store。
- **NPC 概率**：喂狗 `min(0.95, tend×0.40)`、串门打理 `min(0.90, tend×0.30)`、
  偷菜 `{rare:0.18, often:0.65, always:0.95}`、冒险 0.20、发订单 0.3（生意人 ×1.6 / 场面人 ×1.4）。
  `actCare` 每次上限 2 块地（缺水生虫一起处理）；玩家农场 care 权重 3、偷菜权重 2。
- **帮邻居浇水与自家同款**：`readyAt −= stageBounds×10%`（联机回执带 readyAt）。
- **在线窗口**：`beginVisit` 写 `npc.onlineUntil = at + onlineMs(npc)`，5~15 分钟（`ONLINE_MINUTES` 全表砍半）。
  下游：邻居页绿点/灰度头像、偷在线 NPC 双倍惩罚、排序「上线」档、不在线弹窗与卡片浅灰。
- **NPC 升级经验 ×2**（`NPC_EXP_MULT`，只放大阈值不动 `expForLevel`）。
- **订单**（`data/orders.js` + `store/orders.js` + `subpages/orders.js`）：`{id,ownerId,itemId,qty,reward,createdAt,deadline}`，
  只认产出，1.2 倍赏金创建即托管。NPC 单挂 `npc.order`（同时 1 条），玩家单挂 `state.farm.orders`（上限 5）。
  需求池 = 1 级 ~（NPC 自有等级 + 5）。npc-sim 步骤 `order` / `fill`（每次上线 1 条，完成双方好感 +5）。
  ⚠️ **STEPS→ACTIONS 注册表 + planVisit 的 sweep，两边都要加**。NPC 仓库 `npc.bag`（`KEEP_RATIO`，上限 60）。
- **交易**：`tradeStock/tradeQuote/buyFromFriend`，原价 `crop.sell`，好感消耗 `max(1, round(lv×qty/2))`，
  邻居必须在线才能交易（UI 与 store 各挡一次）。联机好友没有交易入口。
- **上线间隔**已砍半（`[8,16]`→`[4,8]`，fixed 钟点翻倍）。`normalizeNpc` 的 `schedule` **只认名单**，
  否则老档旧区间永远盖住新值。

## 村镇联机

- 一个村镇=一个房间，配置 localStorage。四层：link→protocol→peers→village UI。
- **真人 ≠ NPC**：`state.peers` 只在内存。硬前提：https/localhost + 两端能上外网。
- **真人农场可动手**：`peer-actions.js` 的 act/act:res/act:pay，主人权威。
- **入口**：底部中间「村镇」按钮进村后才出现，浮窗 `village-sheet.js` 用通用 `.sheet-panel` + `dragToClose`。
- **玩家送礼**：`peer-gift.js` 三段握手，送方先扣货，收方 ack 才入包。
- 安全：丢 >48KB 报文、`cleanText()` 按码点截断、`isItemKey` 用 `hasOwnProperty`。
- **诊断** `.village-status`：已连接·N人在线 / 正在连接 / 没连上（可点重连）/ 版本不一致。
  ⚠️ 类挂容器上，`statusView()` 只返回文字。

## 其它

- 时报 7 天/80 条；**农场日志与邻居动态纯 7 天、不设条数上限**（`trimLog`）。
- **签到**：`signDays` 是唯一数据源，`streakOf(now)` 现算；`signStreak` 只是缓存。
  `reconcileSignHistory()` 启动补历史；连签按自然日判定。自动签到挂开机 + 跨 0 点。
- **排行榜**：11 张榜，**每天 14:00 结算**（`boardDayKey=dayKey(ts-14h)`），行 `date` = 账期开始日、
  行内带 `start`（三道闸门保证本期从 14:00 起算，`BOARD_VERSION=3`）。
  打理王是**当前值不是累计**：实时 = `farmMaxBonus(自己农场)`，与记账峰值取大。
  `bump` 累加 / `bumpMax` 只留峰值；settled 冻结；前三名递减、并列都发（100/50/30）。
  玩家获奖同时写时报；名次用 `entry.rank`；庆祝层 z-index 195（弹窗 130 上、toast 200 下）。
  页面顺序：实时榜在上、昨日榜在下；`rewardText()` 与发奖文案同源。
  ⚠️ 埋点矩阵见 `docs/06-领域层.md`，加互动逻辑时逐格对照。
- **游戏手册**（`subpages/manual.js`）：「更多→📘 手册」，float 图标网格，点开弹详情。
- **PWA**：manifest + sw.js（**网络优先**，图标/manifest 才缓存优先，别改回 cache-first）。
  图标全 PNG，源图 `sims-farm.png`，四种用途各裁一版；改图标要同步 manifest / index.html / sw.js 的 CORE 并升 `VERSION`。
  `updateViaCache:'none'` + `reg.update()`；activate 发现旧缓存让页面重载一次；开发用 `?nosw`。
- **给别人狗添粮**：`social.feedFriendDog`（NPC）/ `peer-actions.feedPeerDog`（联机），好感 +1 且 `bump('care')`。
- **iPhone 售卖底栏**：`.sell-total` 基线对齐 + `.sell-total-note` 独占一行。

## 护栏与踩坑

`npm run check` 盲区：删/搬函数后必须 `grep -rn` 搜全调用点。
⚠️ news.js/shop.js 模板字面量有 `` `}` `` 闭合序列，Edit 匹配易失败 —— 字节级确认后再改。
⚠️ 每步都 `commit` 会把补算拖成十几秒（IndexedDB 事务）—— 循环里一律 quiet，最后写一次。
⚠️ `requestAnimationFrame` 在 headless 里慢，但 `setTimeout(0)` 更慢（被夹到 4ms）；真正要治的是 commit 次数。
