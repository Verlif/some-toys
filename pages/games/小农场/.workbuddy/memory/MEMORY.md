# 项目长期约定 · 西米的农场

纯前端（原生 ESM、零构建、`node server.mjs`），存档 IndexedDB（`sun_farm_v2`），无后端。
游戏正式更名《西米的农场》（原名「阳光牧场 · 文字版」），但 DB_NAME/localStorage key/APP_NAME 保持 sun_farm* 不变（存档兼容）。
局域网联机走 WebRTC P2P（`vendor/webconnect.js`）。267 作物（165 常规 + 102 限定）/ 40 块地 / 8 档土地 / 32 位邻居。

## 工程约定

- 分层 `ui → store → core`，`data` 谁都能读。store 唯一改状态、**禁 DOM 符号**，提示走 `notify()`。
- **不做测试**，只跑 `npm run check`，验证脚本用完即删。中文注释 + JSDoc，主动清死代码。
- 作物/土地/经验/称号由 `tools/gen-data.mjs` 产出，**不手改** `data/{crops,soils,progression}.js`。
- 多表写入同一事务 `commit({ farms, bag, news, relations, dailyRows })`（**动了才带**）。

## 存档

`state = { farm, friends[32], bag, relations, news[], dailyRows }`，玩家与邻居同形状。
七表：`farm` / `plot`([farmId,id]) / `log`([farmId,seq]) / `news` / `relation`([a,b]) / `inventory` / `daily`(date)。
⚠️ 复合主键每段必须有值。日志条目 `{at, emoji, text, by}`：`by`=邻居农场 id（NPC→玩家操作才传）。
新字段在 `normalizePlot/normalizeNpc/normalizePlayerFarm` 里补。

## 数值

- **六种原型** `arch`：速生/丰产/精品/慢生/多茬/常规。售价公式不变，速生每小时最高（用户要严格公式）。
- **地块**：`plot.usable` 落库，开局 6 块，第 N 块 `(已拥有-6)×1000+500`。升级不给地。
- 经验 `expForLevel(n)=100n(n+1)`；售价 `整轮收益=(种子价×1.2+等级×10)×(1+0.05×整轮小时)`。
- **三件省手道具**（洒水器/杀虫剂/采收机）各 200 金币，各有永久版。先查永久再查消耗。
- **种子制造间**（`farm.workshop`）：Lv.5+2000 解锁。份数 `max(1, round(一轮平均产出/2))`，
  工本费 `round(种子价/4)`（第 43 轮由 ÷2 再减半）。升级看**造过的种类数**。
  第 43 轮起**限定作物也能造**（`craftables/craft` 不再挡 `crop.special`，
  `state.js` 的 `workshop.kinds` 规范化也放开 special）。
- **照料**：`下次 = now + [次数×1h, (次数×2+1)h]`，不排进成熟前 15 分钟。欠水 −15%、欠虫 −40%。
- **每日排行榜**（`store/daily.js`）：`state.dailyRows` 一期一行，表 `daily` 留 8 天。11 张榜。
  **每天下午 2 点结算**（`boardDayKey(ts)=dayKey(ts-14h)`，14:00 切日；签到仍用 `dayKey` 0 点切）。
  ⚠️ **行的 date = 账期开始那天**，一期 = 该日 14:00 → 次日 14:00，次日 14:00 开奖
  （所以上午的活算进「昨天」那一期，这是 14 点切日的必然结果）。界面上必须用
  `boardPeriodText(date)` 把区间写出来，只写「昨日 · 10-22」会被当成自然日。
  旧 0 点账期留下的行与新账期**同键不同义** → 启动时 `migrateBoardRows()` 比对
  `progress.boardVersion`（`BOARD_VERSION=3`），**只丢掉 `start` 对不上的行**。
  ⚠️ 每行都存 `start`（账期起点 ms，`boardPeriodStart(date)`）：`rowOf` 记账时 start 不对
  就重开一行、`currentRow()` 读的时候直接当空行、`checkRollover` 也不结算这类行 ——
  三道闸门保证「本期一定从 14:00 起算」，存档里躺着旧行也不会串味。
  打理王 `manage` 是**当前值不是累计**：实时榜 = `farmMaxBonus(自己农场)`（不靠收获事件，
  地里挂着高加成没收获也上榜），与记账峰值取较大；结算时对**期结束后 2 小时内**的那一期
  再量一次（久远补算不追溯，农场早不是当时模样）。
  `bump` 累加 / `bumpMax` 只留峰值（打理王=全场最高角标）。送礼=产出售价总和。
  settled 冻结；bulkAdvance 不进榜。前三名递减、并列都发，金币 100/50/30。
  ⚠️ 结算 `persistNow(true)` 连 farm/bag/news 一起写。UI `ui/subpages/rank.js`。
  **第 44 轮**：结算时玩家获奖要**同时写时报**（`addNews`，用**农场名**，句式与 NPC 对齐）——
  早年只写农场日志，公告栏里只剩 NPC 的名字。展示名次用 `entry.rank`（并列第一都显示第 1 名），
  奖励仍按名次顺序发（并列都发，各拿各那档）。
  玩家名次随 `EVENTS.BOARD_AWARD` 发给 `ui/board-celebrate.js`：全屏庆祝卡，
  **单张 ≤2s、点一下淡出即接下一张、多个名次按天数从旧到新排队播**；
  该层 **z-index 195**（弹窗 130 之上、toast 200 之下，两者要同屏可见）。
- **好感度**：−200~200，打理 +1、偷菜成功 0、被逮 `dogCaughtRelLoss(售价)=max(1,round(售价/10))`、
  送 `max(1,等级/2)`。**亲近档 ≥100**：NPC 优先打理 ≥100，`closeGiftChanceFor`（100→0.25，200→0.55）
  ×性格系数送礼；<100 `giftChanceFor` 封顶 0.5。概率第 36 轮整体上调约 1.5~2 倍。
- **土地逐级晋升**：`nextSoilId`，`upgradeSoil` 拦跳级。效果：yieldMul/timeMul/expMul 三处生效。
- **仓库卖出**：`.qty` 步进器，默认全量。列表图鉴标记 `.codex-mark` **只在点亮时渲染**（第 32 轮）。

## UI 硬约束

- **四个主页面 tab**：农场 / 邻居 / **村中心 🏡**（第 42 轮由「📰 时报」改造，
  `views/center.js`）/ 商店。⚠️ 村中心 🏡 ≠ 村镇 🏘（联机浮窗，进村才出现），图标刻意区分。
  村中心 = 总览卡（在线/总人数**含玩家**；第 44 轮起占满一行，**点击弹窗看名单**，
  弹窗里「全部 / 在线」筛选）+ 下方并排两枚按钮：📢 公告栏、📋 订单
  （订单徽标常驻总数，**订单唯一入口**，「更多」里已删）。
  公告栏是时报弹窗，**过滤/排序栏在列表下面**（modal-foot 位）；TICK+FRIENDS 实时刷
  计数/头像行/圆点，不重建名单。老 `views/news.js` 已删。

- **农场页顶部操作条**（第 37 轮）：`.farm-bar` 一张白卡放 `#page-farm` 首位、**流内跟着土地列表滚**，
  上排守护犬+日志方块、下排三格一键（图标/名字/橙色待办数/存量）。**不要再往底部堆 fixed 浮层**，
  `--farm-tools-h` 已删；`data-action` 必须写字面量（check.mjs 扫不到模板拼接的名字）。
  **存量只标消耗版 `×N`，永久版不显示数字**（第 38 轮；悬停提示补「永久版，不消耗」，
  邻居农场 🚿/🧴 标题栏同一规则）。`.fa-stock` 只在 **<330px** 才隐藏（第 40 轮从 380px 降的，
  360px 安卓 / 375px iPhone SE 要能看见 ×N）。
- **土地列表顺序**（第 39 轮）：`已解锁地块 → 荒地卡（未解锁只画第一张，🔓价格按钮）
  → .plot-fold 汇总行永远垫底`。开垦后新建的荒地卡节点会 append 到汇总行**后面**，
  `renderFarm` 末尾必须 `grid.appendChild(foldNode.el)` 把汇总行挪回末尾（移动已有节点）。
- **toast**：背景 .75 透明度（深色 `rgba(34,48,31,.75)`、金色渐变两色标同 alpha），
  文字保持纯白 —— 用背景 alpha 不用 `opacity` 属性，别把字一起淡掉（第 39 轮）。
- 浮层统一：上滑进场、下拉关闭（`drag-close.js`）。**拖拽三条铁律**：①move 先查 tracking ②鼠标事件只在按下期间挂 ③Touch+preventDefault。
- **弹窗四段式**：handle/head/body/foot。别用 sticky 代替 foot。支持叠层。
  `.modal-sub` **不许负上边距**（body 是 overflow 容器，顶出去会被裁）；
  `openModal(html, fn, cardClass)` 第三参挂整卡类名（每次打开重置）。
- 地块 `.plot-main`+`.plot-side`(34px)；`.plot-side` ≤4 按钮。锁定地块 `.plot-lock` 空占位盒(47/38px)。
- **土地底纹** `soilbg-<id>` 用 `::before` 叠渐变，**不能改 `background`**，只声明 `--soil-tint`（135deg，alpha .52~.66）。
- **横滚芯片条接力** `ui/scroll-keep.js` 的 `keepBarScroll(root, sel, render)`：friends/news/shop 三处。
- **图鉴**：卡片只有图标+名称；三档筛选；点得开 = `unlocked||collected`；收集≠点亮。
  **双重进度条**（第 34 轮）：两条重叠同基线，下层绿=已收集(10px)，上层金=已点亮(5px)。
- **邻居页**筛选与排序两条独立状态；筛选只认点击（滑动手势已删）。
- **记录只有一种长相** `recordItemsHTML`；行内标签 `inlineTagsHTML`（人名+作物名一次正则）。
- **作物详情只有一个弹窗** `openCropModal`；**邻居农场弹窗只有一个** `openFriendModal`。
  ⚠️ 邻居弹窗结构：头部 → 数据卡 2×2（等级/身家/地块/好感）→ **农场控制台 `.npc-board`**
  （两行：农场 N 块 + 🚿🧴 ｜ 🐕 粮槽进度条 + 🦴 + 📜）→ 地块 → 🎁 送礼 + 提示。
  控制台是**普通文档流，故意不做 sticky**（跟着地块一起滚）。日志**不再常驻**，
  `📜` 走 `openFriendLog()` 开叠层（`.npc-log.tall`）。
  **🦴 添狗粮**（第 38 轮）：走 `confirmFeedDog` 确认叠层 —— 消耗玩家自己包裹 1 份狗粮
  （sd-grid 写狗粮槽 before→after / 包裹现有 / 剩余，NPC 另标好感 +1），
  确认才 `closeModal()` 回弹窗再扣粮；NPC 与联机好友（`feedPeerDog`）同一套。
- **农场日志双 tab**：「我的操作」= `!entry.by`，「邻居动向」= `entry.by`。tab 在面板底部。
- **称号页**：`.title-card > :last-child` 固定 28px 高并居中（佩戴中/佩戴/领取/未达成四种结局
  必须等高，否则点佩戴整行跳）；`.title-hero-badge` 钉 62×62（第 40 轮）。
- **送礼三层**：清单→确认框→发送。赠礼层 `ui/gift.js` 不做 opacity 动画。

## 守护犬

10 档（比熊 20%→龙犬 80%），只有一只能上岗。`catchChance(rate,sat,max)=rate×(0.5+0.5×sat/max)`。
被抓住按 `crop.sell×5` 罚款 + 掉好感 `max(1,round(售价/10))`。
⚠️ 饱腹度是「基准值 + 基准时刻 `dog.at`」两件套，`dogSatietyAt()` **只认 `at`**。
写存量时必须 `dog.satiety = 新值; dog.at = now;` 成对写，只写 satiety 会把
「从上次结算到现在」的衰减重算一遍，喂了等于没喂（NPC/联机喂狗粮踩过，
当时错写成了不存在的 `fedAt`）。满槽（≥ 容量-1）要拒收并退回狗粮，别白花一份。
⚠️ 第 43 轮起槽容量随**狗窝等级**变（`farm.dogHouse.level` 0~5，容量 `100+30×级`），
`dogSatietyAt` / `catchChance` 都加了 `max` 形参（默认 100，邻居与联机狗不变），
玩家侧必须传 `kennelCapacity()`；界面上存量是**点数 `45/100`**不是百分比。

- **狗窝升级**（第 43 轮）：只花金币，费用 2000/5000/10000/15000/25000（0→5 级），
  每级 +30 容量。升级前必须 `settleSatiety(now)`，否则衰减会按旧基准重算。
- **每日挖宝**（第 43 轮）：**有狗上岗 且 槽里有粮**时每天 30% 掷一次，
  按品阶对应藏宝图档位（`ceil(品阶/2)`：1-2→一级…9-10→五级）从该档奖励池抽一份
  （`rollDogDigReward`，不传 opts.dog）。**只掷已过完的天**，`farm.dogHouse.digDay`
  记账，离线补掷 ≤7 天。⚠️ 掷完无论中没中都要推进 digDay 并落盘（否则每次启动白掷）；
  新档 digDay 初始化成**昨天**（否则漏第一天）。挂启动 + 分钟 tick。
- **狗粮两种**：`dogFood` +45（50 金币）、`dogFoodPro` +100（100 金币），
  点数存在 `ITEMS[id].food`，`feedDog(itemId)` 按道具取。


## 邻居与世界

- 邻居同用 `unlockedPlotCount`；偷菜 `stealable()` 要 `!plot.guarded`。
- NPC 模拟纯计算，`simCtx()` 注入 rel/receiveGift/daily，npc-sim 不 import store。
- **NPC 概率**（第 36 轮上调约 1.5~2 倍，第 40 轮再调照料）：喂狗 `min(0.95, tend×0.40)`、
  串门打理 `min(0.90, tend×0.30)`、偷菜 `{rare:0.18, often:0.65, always:0.95}`、冒险 0.20、
  发订单 0.3（生意人 ×1.6 / 场面人 ×1.4）。
  **actCare 每次上限 2 块地**（`CARE_MAX_PLOTS`）且缺水生虫一起处理；挑农场时玩家农场用
  `CARE_PLAYER_WEIGHT=3`（care 专用，偷菜的 `PLAYER_FARM_WEIGHT=2` 不动）。
  ⚠️ 远期 `bulkAdvance(npc, until, ctx)` 会把玩家农场过期的照料需求聚合结掉并 `cared+=n`
  （32 个 NPC 各跑一次，天然幂等）；落盘靠「bulkAdvance 后必有详细访问」触发 persistFriends。
  **帮邻居浇水与自家同款**：`waterNeighborPlot` / 联机主机侧都 `readyAt −= stageBounds×10%`
  （第 40 轮补，原来只剩好感经验；联机回执带 readyAt，访客就地齐快照）。
- **在线窗口**（第 41 轮）：`beginVisit` 写 `npc.onlineUntil = at + onlineMs(npc)`，
  时长 = 性格表（10~30 分钟）+ 身份关键词微调（退休 +4 / 司机主播 −3 / 师生 −2）±2 浮动，
  `data/friends.js` 的 `ONLINE_MINUTES` / `onlineMs` / `isNpcOnline`。bulkAdvance 不设。
  下游：邻居页绿点/灰度头像（`.friend-dot` + `grayscale(.55)`，TICK 只改 class 不重绘）；
  **偷在线 NPC 被狗抓住双倍惩罚**（罚款与 `dogCaughtRelLoss` ×2，social.steal）；
  邻居列表排序加「上线」档（在线优先 + onlineUntil 降序）；**不在线 = 弹窗与列表卡片
  都浅灰**（`.npc-offline` / `.friend-card.offline`，modal.js 快照栈要存/还原
  card.className，否则关子层会串灰）。
- **订单系统**（第 41 轮，`data/orders.js` + `store/orders.js` + `subpages/orders.js`）：
  订单 = `{id, ownerId, itemId, qty, reward, createdAt, deadline}`，**只认产出**。
  NPC 单挂 `npc.order`（同时 1 条）、玩家单挂 `state.farm.orders`（上限 5 条）——
  都落在农场行上**零改表**。统一 1.2 倍（`ORDER_MULT`），赏金创建即托管、过期/撤销退还。
  **需求池 = 1 级 ~（NPC 自有等级 + `ORDER_LEVEL_FLOAT=5`）随机抽，不看玩家等级**
  （第 42 轮改，原来是取两者较低等级）。
  npc-sim 新步骤 `order`（发单，掏不出钱不发）与 `fill`（接单，每次上线 1 条，
  优先玩家单，完成双方好感 +5，回执带 farms 一起落盘）——
  ⚠️ **STEPS 表注册 + planVisit 尾巴，两边都要加**。
  NPC 仓库 `npc.bag`：`actHarvest` 按 `KEEP_RATIO`（性格）保留入库，`NPC_BAG_CAP=60` 封顶。
  过期清扫 `expireOrders` 挂在 settleWorld 开头。「更多」里 📋 订单（替换掉的牧场/设置已删，
  placeholder.js 已删）。

## 村镇联机

- 一个村镇=一个房间，配置 localStorage。四层：link→protocol→peers→village UI。
- **真人 ≠ NPC**：`state.peers` 只在内存。两个硬前提：https/localhost + 两端能上外网。
- **真人农场可动手**：`peer-actions.js` 的 act/act:res/act:pay，主人权威。
- **入口**：底部 tab「村镇」进村后才出现。浮窗 `village-sheet.js` 用**通用 `.sheet-panel`**（第 34 轮），
  挂 `dragToClose`，与「更多」「农场日志」同一套下拉关闭手势。
- **玩家送礼**：`peer-gift.js` 三段握手，送方先扣货，收方 ack 才入包。
- 安全：丢 >48KB 报文、`cleanText()` 按码点截断、`isItemKey` 用 `hasOwnProperty`。
- **诊断**（浮窗顶部 `.village-status`）：已连接·N人在线·连接号 / 正在连接 / 没连上（可点重连）/
  对方版本不一致。`peers.linkDiag()` + `reconnectVillage()`；版本不一致记在 `versionMismatch`
  （toast 8s 节流 + emit FRIENDS 让浮窗常驻显示）。
  ⚠️ 样式类挂容器上，`statusView()` 只返回文字 —— 别在容器里再套一层 `.village-status`。

## 其它

- 时报 7 天/80 条；**农场日志与邻居动态纯 7 天、不设条数上限**（`data/friends.js` 的
  `trimLog`；第 40 轮改，早先是两个 tab 共用 60 条 + 邻居 log 10 条，会被自家操作挤光）。
- 称号 38 个分三类 tab；引导 17 项；签到不发经验，历史 90 天。
- **签到连签判定必须按自然日**（第 43 轮修）：`streakBroken()` 用
  `dayIndex(now) - dayIndex(lastSign) > 1`（`core/utils.js` 的 `dayIndex` 接受时间戳或
  'YYYY-M-D' 键）。⚠️ 早先拿 24 小时门槛，昨晚 23 点签的今早看就被判「已中断」——
  顶部连签显示与下方日历各说各话。日历读 `signDays`（历史），所以日历一直是对的。
- **图鉴点亮奖 1 颗同种种子**（第 43 轮）：`codex.js CODEX_SEED_REWARD=1`，
  `makeSpecimen` 点亮时发；老档由 `compensateLitSeeds()` 按 `progress.codexSeeds` 标记一次性补发
  （`main.js` 启动调用）。
- **限定作物 102 种铺到 Lv2-200**（第 43 轮，`tools/gen-data.mjs` 的 `SPECIAL_CATALOG`）：
  五档藏宝图种子上限 20/60/120/160/200（用户自己改的 MAP_TIERS）。⚠️ 生成器会拦**重名**与
  **emoji 超 8 次**，加限定作物时要先查名与 emoji。**播种限定种子的地块挂 `.plot.special`**，
  第 44 轮起金边是 `<i class="plot-aura">` 上的 `conic-gradient` **旋转**边（`@property --plot-spin`）；
  缺水/生虫（红）/ 成熟待收（橙）在同层的 `::after` 做 `scale(1→1.06)` 外扩环。
  `.plot` 自己的 `::before/::after` 被底纹与压边占着，**不能动**。
- **游戏手册**（`subpages/manual.js`）：「更多→📘 手册」，float:left 图标网格（25% 宽），
  点图标弹 `openModal` 详情（平铺 `.manual-list`）。13 个分类（第 41 轮加「订单」）。
- **自动签到**（第 34 轮）：开机自动签 + **跨 0 点在线也签**（挂在分钟 tick 的日期检查上），照播庆祝画面。
- **日历空位按「当月 1 号」周几算**。
- **PWA**（第 35 轮）：manifest.json + sw.js + icons/（全 PNG，源图 `sims-farm.png`）。
  图标按用途各裁一版：favicon-32（主体 90%）、icon-192/512（82%）、
  icon-maskable-512（70% + `#f4f8f0` 底，安卓圆形安全区）、apple-touch-icon-180（铺底，iOS 不吃透明）。
  **先裁正方形再缩**（源图主体只占 45%×70%，整缩会变成贴纸）。改图标要同步
  manifest / index.html 两个 link / sw.js 的 CORE，并升 `VERSION`。
  ⚠️ sw.js 是**网络优先**（页面导航 + `/src` `/styles` `/vendor` 有网取新、断网回退缓存），
  图标/manifest 才走缓存优先。**别改回 cache-first** —— v1 那样改完代码刷新永远看不到
  （SW 拦截后压根不走网络）。`updateViaCache:'none'` + 注册后 `reg.update()`；
  activate 里发现「非当前版本缓存」就让受控页面 `client.navigate()` 重载一次
  （旧页面跑的是旧代码，claim 换不掉），首次安装不刷。开发排查用 `?nosw` 注销并清缓存。
  iOS 走 `navigator.storage.persist()` + 添加到主屏提示（toast 一次，localStorage 记已提示）。
- **排行榜底部 TAB**（第 35 轮改版）：6 大类 TAB 放 `setFoot`（横滚 keepBarScroll），
  冒险王档位只在冒险 TAB 下显示；每榜下方挂「今日实时排名」（`todayRank`），
  `EVENTS.STATS`（bump 防抖发）触发 renderCurrent 刷新。
- **给别人狗添粮**：`social.feedFriendDog`（NPC）/ `peer-actions.feedPeerDog`（联机），
  好感 +1 且计 `bump('care')`；按钮在 friend-modal 守护犬行内联。
- **iPhone 售卖底栏**：`.sell-total` 改 flex 基线对齐 + 整数字号 12px + `.sell-total-note`
  独占一行（flex-basis:100%）—— iOS 上 12.5px 小数字号 + 中英混排基线易错乱。

## 护栏与踩坑

`npm run check` 盲区：删/搬函数后必须 `grep -rn` 搜全调用点。
e2e：等 `body[data-page]`；`.sign-celebrate` 吞点击；子页面在 `#subpageBody`。
造数据：`page.evaluate` 里 `await import('/src/store/xxx.js')` 与页面共用模块实例。
⚠️ news.js/shop.js 模板字面量有 `` `}` `` 闭合序列，Edit 匹配易失败 —— 字节级确认后再改。
