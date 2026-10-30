# 项目长期约定 · 西米的农场

纯前端原生 ESM、零构建，`node server.mjs`（5173），IndexedDB `sun_farm_v2`，无后端。DB/key/APP 名保持 `sun_farm*`。
**271 作物**（165 常规+102 限定+4 荣耀）/40 地/8 档土/52 邻居（开局 32）/11 榜。**详细设计一律见 `docs/01~09`，本文件只留踩过的坑。**

## 工程
- 分层 `ui→store→core`，`data` 只读；store 唯一改状态、**禁 DOM**，提示走 `notify()`。
- 不写测试，只跑 `npm run check`（9 项）；中文注释+JSDoc，勤清死代码。
- `data/{crops,soils,progression}.js` 由 `tools/gen-data.mjs` 生成，**不手改**（改完重跑）。
- 多表事务 `commit({…})` **动了才带**；`data-action` 必须字面量（`check.mjs` 扫不到模板拼接）；删/搬函数后 `grep` 全调用点。

## 存档
七表：farm/plot/log/news/relation/inventory/daily。`state={farm,friends,peers,bag,relations,news,dailyRows}`，玩家邻居同形。
⚠️ 复合主键每段必有值；日志 `{at,emoji,text,by}`（`by`=邻居id）；新字段须在 `normalizePlot/normalizeNpc/normalizePlayerFarm` 补。
备份 `core/zip.js`+`core/backup.js`：导出前 `flushDaily()`，导入五步校验→`suspendPersist()+freezeWrites()` 双闸→整页 reload。

## 世界时钟
`advanceWorld` 逐段：⓪下线→①上线→①'空闲→②订单过期→③跨14:00结算→④收炉→⑤自动机器→⑥公共用地。
`stepMsFor` ≤7天1分、翻倍×2封顶60分；`VISIT_BUDGET=30000` 超则 bulkAdvance。
⚠️ 补算期跨表动作 quiet，结束 `flushAwards()`；**循环里 commit 是性能陷阱**（365天18s→0.4s）。
`from=min(worldCursor,lastSeen())`；`deferFrom=sessionStart` 才演出，>2分直接算完。下线通知在段开头发且 `until>=deferFrom`。
**NPC 行动框架**：`ACTIONS` 注册表，加行为只加一条；sweep 不写 `can`；`harvest/tend` 须同时挂 main+sweep；上线 90 秒内不 idle。
⚠️ `run()` 返回的 `{emoji,text}` 由 `runStep` 统一 `log(npc,…)` —— **动作里别再给自己写一条**（会重复）。但**改了别的 NPC** 就必须在返回里带 `farms:[那位id]`：在线演出只提交「玩家+发起人」，不带就丢（同 `npc-sim.js` 接单带 `order.ownerId`）。

## 数值
- `expForLevel(n)=100n(n+1)`；整轮收益 `(种子价×1.2+等级×10)×(1+0.05×整轮小时)`。
- **照料经验 `careExp(lv)=max(1,round(lv/10))`**（自家/邻居同口径）；欠水−15%、欠虫−40%。
- **产量×1.2/售价÷1.2**（只改 `gen-data.mjs` 的 `YIELD_SCALE`，`sell` 守恒倒推）。
- 地块开局 6，第 N 块 `(已拥有-6)×1000+500`；三件省手道具各 200（永久采收机2万/另两5万）。
- 制造间 Lv5+2000：`craft()` 只入队、`claimJobs()` 到点收；⚠️ **限定作物不能制种**（`crop.special` 挡）。
- 好感 −200~200：打理+1/偷0/被逮`round(售价/10)`/送礼`round(等级/2)`/交易`round(等级×份/2)`/催−10；≥100 优先打理+送礼。
- ⚠️ 玩家偷被抓时**其他所有邻居各 −1**（`CAUGHT_RIPPLE_REL_LOSS`）：固定值不乘在线双倍、被偷那家不重复扣、不含 peers、NPC 互偷不触发；日志 + `.dc-ripple` 都要说。
- ⚠️ `SOILS` 按 id 索引且条目**无 id 字段**，取出自补。
- **开局礼包**（仅新档）：6 颗「≤玩家等级最高档里同档最快」种子+洒水器/杀虫剂/采收机各3+狗粮3，直接写 `state.bag`。

## 邻居与世界
- `interactChance(c)=1-(1-c)²`（**不能 `c×2`**）；`actCare` 每趟≤2 块；玩家 care 权重3/偷2。
- 在线窗口 `npc.onlineUntil=at+onlineMs(npc)`（5~15分）控绿点/灰度/排序。
- 订单只认产出、1.2倍托管；NPC 单挂 `npc.order`、玩家 `state.farm.orders`(≤5)。
- ⚠️ **村民随村庄升级变多**（20新住户）：`initState` 按 `village.level` 过滤；`admitVillageNeighbours` 把新住户 `lastVisitAt/nextVisitAt/dog.at` 按到 now。

## 守护犬
10档20%~80%；`catchChance=rate×(0.5+0.5×sat/max)`。
⚠️ **逮到不罚款**（第 61 轮用户定死）：只掉好感（被偷那家）＋当日进不去他家，`DOG_FINE_MULTIPLE` 已废弃。
⚠️ 饱腹度=值+`dog.at`，写须成对；容量 `100+30×狗窝级`，界面是点数。狗窝升级前 `settleSatiety(now)`；挖宝每天30%、只掷已过完的天。

## 村庄
`village={level(1~5),coins,crystals,pray,stock,prayDay,giveDay,logs[]}` 挂 farm 行零改表。全村产量+2%/级，每级多5人。
升级自动（投入/祈福后 `checkUpgrade`）：金币20k/72k/260k/920k + 水晶20/48/88/144 + 祈福120/400/940/1540。
⚠️ 拆同步 `prayCore`(邻居)+`pray`(玩家补commit)；`prayDay/giveDay` 只留今天。
⚠️ `invest()` 夹到「还差的那点」；金币水晶都满则按钮禁用；投入图标用 **🚧** 不用 🧱（老字体渲染成方框）。
⚠️ 升阶 `grantHonorSeeds`：玩家 `add`、邻居 `npc.bag[seedId]+=1`；`cleanNpcBag()` 须放行 `seed_` 前缀。

## 水晶（可卖）
`CRYSTAL_SELL={1:500,2:1_000,3:2_000,4:5_000}`；`sellCrystal(tier,n)` **只 commit farms 一张表**（水晶挂 `farm.village.stock`）。
⚠️ 建设日志只由 `invest`/`contributeCore` 写 —— **`addCrystal` 不写**；纯卖水晶不写（`if (coins||crystals)` 包住）。
⚠️ `CONTRIB_STYLE` 的 `crystalInvest` **0.3 是硬下限**（能卖之后推到 0，村民一拿到就卖光）。投量 `max(1,floor(mine×ratio))`。
村民岔路：非当前档**一律卖掉折现**；当前档 `mine>=2` 才掷，卖时**留 1 枚**。
⚠️ `sellCrystal` 必须补 `emit(EVENTS.INVENTORY)`（仓库靠它重绘）。

## 公共用地
`state.commons` = `farm` 表里 `id:'commons'`/`kind:'commons'` 的**无主农场** → 存储层/备份/导入零改动，**不升 `DB_VERSION`**。
块数 `2×村庄等级`；作物池 `[(级−1)×10, 级×20]`，限定作物不进池。
⚠️ `initState()` 两处顺序死穴：`rows` 过滤必须**排除 `COMMONS_ID`**；`villageLevel` 必须**先于** `normalizeCommons`。
`advanceCommons`：补地块→**摇产量**→清空该换种的→补种，返回 true 置 `report.dirty`，**循环里不 commit**。
⚠️ 摇产量必须**先于**清空判断（`commonsRemain=pendingYield−taken`，没摇过两者都是 0，先判会铲掉刚熟的）。
**熟了摆 1 天就换种**：`COMMONS_RIPE_HOURS=24`、`commonsRipeDeadline(plot)=plot.readyAt+24h`，**不另存字段**。该换种=拿光 **或** 过期；系统补种**不写日志**。
先到先得账本 `plot.taken`+`plot.takers`，`commonsCanTake(plot,who)` 同时判「还剩」与「这人没拿过」。
照料给经验（`careExp`），**收获不给经验**；村民走 `ACTIONS.commons`(sweep)+`ctx.commonsTick`，先抢收 65% 再照料 50%。
⚠️ **落盘**：`persistFriends`/`flushAwards`/`runLiveStep` 走 `state.js` 的 **`farmRows(...)`**（自动补 commons、去重、滤空值）；`store/commons.js` 的 `persist()` 反过来必须带 `state.farm`。玩家主动操作邻居的单点提交**刻意不带**。
⚠️ 弹窗顶部 `data-role` 用 **`commons-board`** 不用 `board`（邻居弹窗全局查 `[data-role="board"]`，撞名互相覆盖）。
`commonsSnapshot()` **不播种**；播种只在 `advanceCommons` 与 `openCommonsModal`。返回 `ripe`（我能拿）/`mine`/`ready`/`water`/`pest`/`total`。
⚠️ `water`/`pest` 只统计**还在长**的地。公共地照料**不记任何榜**、不补算历史。
村中心入口是**左半格大方格**：内部**全绝对定位**（`display:block`，flex 居中会把右下角统计顶上去）。右半格留白。

## 子页面标签
仓库 `bag.js`：🌾农产品 / 💠其他（水晶）。包裹 `package.js`：🌱种子 / 🧭藏宝图 / 🧪道具。
⚠️ **tab 态只能挂模块变量 `activeTab`**：每动作后整页重绘，状态进 DOM 会丢。芯片复用 `.filter-chip`+`.chip-num`；⚠️ `.sub-tabs` **不能 sticky**（子页面本身是滚动容器）。
`confirmSell(rows)` 泛化成行数据 `{key,name,unit,have,doSell}`，作物与水晶共用。

## 排行榜
11榜，每天14:00结算；前三递减、并列都发；实时榜上/昨日在下。

## 农场通知（信箱）
`state.farm.progress.notices`（随 farm 行落盘，**不新开表**）；清洗在 `data/notice.js`。
发奖唯一入口 `store/reward.js` 的 `grantReward`，`claimNotice` 才入账。`ui/gift.js` 已整块删除。
⚠️ 保留「领过的留 30 天、**未领的永不过期**」上限 120 条；无 `reward` 的消息 `claimed` 恒 true。
⚠️ 角标两档：未领取→**数字**，仅未读→**纯红点**，都没有→`hidden`；两种都绝对定位，**不参与布局**。
⚠️ 打开列表先渲染**再** `markNoticesRead()`（这一帧还看得见红点与加粗）。
⚠️ **信箱只放玩家自己的事**：NPC 之间的社交（如互加好友）写 NPC 日志，不进信箱。

## 自动机器
`autoSprinkler`🚰/`autoPest`🪤/`autoHarvest`🛻 各 2000；时效存 `farm.progress.auto`（到期时间戳）。
⚠️ **不写 `permanent`**（会让商店按钮变禁用）；`addAuto` 从 `max(now,旧)` 起+days。
执行在 `world.js tick()` 第⑤步；**刻意不给经验/不 bump 榜/不 completeGuide**。
⚠️ 三处发奖特判 `ITEMS[id]?.auto`：adventure.applyReward / titles.claimTitle / `store/reward.js` 的 `grantReward`。

## 称号
57条（等级26+图鉴26+金币5）；改 `TITLES` 后重跑 `gen-data.mjs`。`attachTitleSeeds()` 须定义在 `specialCrops` 之后、校验之前；奖励只有道具无金币。

## UI 硬约束
- 四 tab：农场/邻居/**村中心🏡**(≠村镇🏘联机)/商店。
- 村中心：村庄卡 → **村民总览(1fr)+🏆排行榜(2fr) 同一行** → **第二块 `.center-main`**：左列上=📢公告栏/下=📋订单，右侧 🏞公共用地 `grid-column:2`+`grid-row:1/span 2` 跨两行。
- ⚠️ `.center-main` 里 commons 有显式 grid 位置会**先于自动放置占位**，前两格不用写 `grid-area`。⚠️ 公共用地内部**全绝对定位** + `min-height:122px` + `overflow:hidden`，`ca-body` 要**同时钉 left 与 right**（shrink-to-fit 会顶出卡片），`b`/`i` 都要 `display:block` 才吃省略号。⚠️ 带徽标的按钮 `.ca-body` 要补 `padding-right`（徽标绝对定位不占布局）。
- ⚠️ 总览只 1/3 宽：头像行 `nowrap`+`overflow:hidden` 一行，`fitFaces()` **量一次算完**（别「收一个量一次」，32 人在线会连续强制重排），末尾同尺寸「…」圆框。`mountCenter` 挂 `resize`（rAF 合并）。
- ⚠️ 排行榜右列**只留头像**，「是不是你」用 `.cr-ava.me` 的 `box-shadow` 绿边，不占宽度。
- 公共用地弹窗成熟卡：名字 / **剩余份数常驻**（`还剩 N 份 · 你拿过了|先到先得`，拿光才写「已经被拿光了」）/ **换种倒计时**（≥1h 静态，<1h `mm:ss`，到点「马上换种」）。1 秒心跳**只改文本**；整块重绘只留给「刚熟」与「该换种」；`lastExpiry` 挡 3 秒防每秒落盘；`#modal` 没 `show` 自 `clearInterval`。⚠️ `plotsSignature` **必须带 `commonsRemain` 与 `takers.length`**（村民随时抢收，不含数量会盯着早就拿光的地看）。
- ⚠️ **地块列数只有一套**：`.grid` = 2/3/4 列（720/960）；`.grid.dense`/`.npc-plots` **只改 gap/padding/字号**。⚠️ 别在 `.dense` 写 `grid-template-columns`（优先级高于媒体查询）。
- `.farm-bar` 首位：上排狗 + 📬信箱 + 📔日志（`.farm-log` **34×34 / emoji 17px**）/中排三键/下排 `#farmAuto`；**不堆 fixed 浮层**。
- 弹窗四段式 handle/head/body/foot，**别用 sticky 替 foot**；`.modal-sub` 不许负上边距。
- ⚠️ `store/codex.js` 须同时 import `produceId` 与 `seedId`（少 `seedId` 抛 ReferenceError）。图鉴双进度条；点亮先 `closeModal()` 再播庆祝。
- 设置页 `<input type=file>` 挂 `document.body`；拖拽先判 `#subpage.show [data-role=save-drop]`。
- **产出堆叠** `data/yield-pile.js`：`floor(n/2)+1` 张（**不是 ceil**）、封顶 16；黄金角螺旋+LCG 定种（心跳不能 random）；坐标全 em；散落 `RADIUS_X=1.62/RADIUS_Y=0.66/MAX_ROT=±24°`（1.7 以上被裁角）。⚠️ `.plot-art/.np-art` 要 `width:100%`+`padding:0 .5em`。
- ⚠️ **`.yield-pile > i` 绝不能加 `will-change: transform`**（40 地×16 张=640 层，满帧→24fps，实测 40.8ms→16.4ms）。静态定位元素一律不写 `will-change`；`filter: drop-shadow` 清白，换 `text-shadow` 更慢。
- **地块骨架**：`.plot-main`/`.npc-plot` 两层 —— `.plot-head`（图不滚）+`.plot-body`（文字超出裁掉）。外挂 `.plot-hang` 悬挂底边（`bottom:0`+`translate(-50%, calc(25% + 1px))`，**+1px 不能省**）。
- ⚠️ **地块高度是硬锁 `height`（141/紧凑113），不是 `min-height`**（兜不住「比地板高」）。⚠️ `.plot-body` 用 `overflow:hidden` **不滚**（内层滚动容器会抢走整页滑动手势）。⚠️ **`.plot-main` 不能写 `flex:1`**（`flex-basis:0%` 盖掉 `height`）。⚠️ `.plot-head` 要 `width:100%`。验证口径：同一 `top` 高度集合只有一个值，`.plot-body` 溢出个数为 0。
- ⚠️ **`.npc-plot` 绝不能写 `overflow:hidden`**（`.plot-hang` 是它直接子元素，一裁就把探出的 1/4 切平）。验证口径：`hang.bottom - card.bottom == 按钮高×1/4`。
- **铲除/施肥在作物详情弹窗**，不在土地上：`plotActionsHTML` 用 `minmax(0,1fr) auto`；`.pa-row{max-width:300px}`；`.plot-side`/`.np-acts` 已删。
- **地块 aura**：`inset:-1px` 对齐 border box；环内收 N px 半径 −N px；金边 4px 靠 `padding`。
- **长按连发** `ui/hold.js`：`.qty-btn` 委托，只在 `modal.js`/`subpage.js` 各挂一次。⚠️ `touch-action` 只能写一条。

## 村镇联机
一村一房间(localStorage)；`state.peers` 仅内存，真人≠NPC；硬前提 https/localhost。主人权威；送礼 `peer-gift` 三段握手；报文>48KB 丢、`cleanText()` 按码点截断。

## 其它
- 时报 30天/240条；农场日志与邻居动态纯 7天无条数上限。
- 签到 `signDays` 唯一源；改玩法同步手册 `subpages/manual.js`（数值最易漂）。
- PWA `sw.js` 网络优先；改图标同步 manifest/index.html/VERSION；开发用 `?nosw`。
