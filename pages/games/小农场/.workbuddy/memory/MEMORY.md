# 项目长期约定 · 西米的农场

纯前端原生 ESM、零构建，`node server.mjs`（5173），IndexedDB `sun_farm_v2`，无后端。
DB/key/APP 名保持 `sun_farm*`。**271 作物**（165 常规+102 限定+4 荣耀）/40 地/8 档土/52 邻居（开局 32）/11 榜。

## 工程
- 分层 `ui→store→core`，`data` 只读；store 唯一改状态、**禁 DOM**，提示走 `notify()`。
- 不写测试，只跑 `npm run check`；中文注释+JSDoc，勤清死代码。
- `data/{crops,soils,progression}.js` 由 `tools/gen-data.mjs` 生成，**不手改**（改完重跑）。
- 多表事务 `commit({…})` **动了才带**；`data-action` 必须字面量（`check.mjs` 扫不到模板拼接）；删/搬函数后 `grep` 全调用点。

## 存档
`state={farm,friends[32~52],peers,bag,relations,news,dailyRows}`，玩家邻居同形。七表：farm/plot/log/news/relation/inventory/daily。
⚠️ 复合主键每段必有值；日志 `{at,emoji,text,by}`（`by`=邻居id）；新字段在 `normalizePlot/normalizeNpc/normalizePlayerFarm` 补。
备份：`core/zip.js`+`core/backup.js`，导入五步校验过才弹确认；导出前 `flushDaily()`，导入后 `suspendPersist()+freezeWrites()` 双闸 + 整页 reload。

## 世界时钟
`advanceWorld` 逐段：⓪下线→①上线→①'空闲→②订单过期→③跨14:00结算→④收炉→⑤自动机器。
`stepMsFor` ≤7天1分，翻倍×2封顶60分；`VISIT_BUDGET=30000` 超则最早段 bulkAdvance。
⚠️ 补算期跨表动作 quiet，结束 `flushAwards()`；循环里 commit 是性能陷阱（365天18s→0.4s）。
`from=min(worldCursor,lastSeen())`；`deferFrom=sessionStart` 才演出，>2分直接算完。
上线 `EVENTS.ARRIVAL` 当场发；下线 `noteDepartures()` 在段开头发且 `until>=deferFrom` 才发。
**NPC 行动框架**：`ACTIONS` 注册表，加行为只加一条；sweep 不写 `can`；`harvest/tend` 须同时挂 main+sweep；上线 90 秒内不 idle（`IDLE_AFTER_VISIT_MS`）。

## 数值
- `expForLevel(n)=100n(n+1)`；整轮收益 `(种子价×1.2+等级×10)×(1+0.05×整轮小时)`。
- **照料经验 `careExp(lv)=max(1,round(lv/10))`**（自家/邻居同口径）；欠水−15%、欠虫−40%。
- **产量×1.2/售价÷1.2**（仅改 `gen-data.mjs` 的 `YIELD_SCALE`，`sell` 守恒倒推）。
- 地块开局 6，第 N 块 `(已拥有-6)×1000+500`；三件省手道具各 200（永久采收机2万/另两5万）。
- 制造间 Lv5+2000：`craft()` 只入队、`claimJobs()` 到点收；⚠️ **限定作物不能制种**（`crop.special` 挡）。
- 村庄荣耀 4 种（`HONOR_CROP_IDS`，藏宝图挖不到）：5茬、慢长(≤3.6天)、整轮收入1.5倍。
- 好感 −200~200：打理+1/偷0/被逮`round(售价/10)`/送礼`round(等级/2)`/交易`round(等级×份/2)`/催−10；≥100 优先打理+送礼。
- ⚠️ 玩家偷被抓时**其他所有邻居各 −1**（`CAUGHT_RIPPLE_REL_LOSS`）：固定值不乘在线双倍、被偷那家不重复扣、不含 peers、NPC 互偷不触发；日志 + `.dc-ripple` 都要说。
- 土地 `nextSoilId` 晋升；⚠️ `SOILS` 按 id 索引且条目**无 id 字段**，取出自补。
- **开局礼包**（仅新档）：6 颗「≤玩家等级最高档里同档最快」种子+洒水器/杀虫剂/采收机各3+狗粮3，直接写 `state.bag`（不走 `inventory.add`）。

## 邻居与世界
- `interactChance(c)=1-(1-c)²`（**不能 `c×2`**）；`actCare` 每趟≤2 块；玩家 care 权重3/偷2。
- 在线窗口 `npc.onlineUntil=at+onlineMs(npc)`（5~15分）控绿点/灰度/偷双倍惩罚/排序。
- 订单只认产出、1.2倍托管；NPC 单挂 `npc.order`、玩家 `state.farm.orders`(≤5)。
- ⚠️ **村民随村庄升级变多**（20新住户 `arrive`2~5）：`initState` 按 `village.level` 过滤；`admitVillageNeighbours` 把新住户 `lastVisitAt/nextVisitAt/dog.at` 按到 now；`invest/pray` 的 commit 必须带 `...state.friends`。

## 守护犬
10档20%~80%；`catchChance=rate×(0.5+0.5×sat/max)`；罚款 `售价×5`+掉好感。
⚠️ 饱腹度=值+`dog.at`，写须成对(`satiety=新;at=now`)；容量 `100+30×狗窝级`，界面是点数。
狗窝升级前 `settleSatiety(now)`；挖宝每天30%、只掷已过完的天。

## 村庄
`village={level(1~5),coins,crystals,pray,stock{1..4},prayDay,giveDay,logs[]}` 挂 farm 行零改表。
升级自动（投入/祈福后 `checkUpgrade`）：金币20k/72k/260k/920k + 水晶20/48/88/144 + 祈福120/400/940/1540；每升一级多5人。全村产量+2%/级。
⚠️ 拆同步 `prayCore`(邻居)+`pray`(玩家补commit)；`prayDay/giveDay` 只留今天。
⚠️ `invest()` 夹到「还差的那点」（多投清零=白扔）；金币水晶都满则按钮禁用。
⚠️ 投入图标用 **🚧** 不用 🧱（U+1F9F1 老字体渲染成方框）。
⚠️ 升阶 `grantHonorSeeds`：玩家 `add`、邻居 `npc.bag[seedId]+=1`；`cleanNpcBag()` 须放行 `seed_` 前缀。

## 水晶（第 55 轮：可卖）
`CRYSTAL_SELL={1:500,2:1_000,3:2_000,4:5_000}`（`data/village.js`，`crystalSellPrice`）；入口 `sellCrystal(tier,n)`，**只 commit farms 一张表**（水晶挂 `farm.village.stock`，不进 `state.bag`）。
⚠️ 建设日志只由 `invest`/`contributeCore` 写 —— **`addCrystal` 不写**（捡到不算建设）。`contributeCore` 的 `note` 用 `if (coins || crystals)` 包住，纯卖水晶不写。
⚠️ `CONTRIB_STYLE` 每档多一个 `crystalInvest`（.3~.85），**0.3 是硬下限**：能卖之后推到 0，村民一拿到就卖光，村庄进度反而更慢。
⚠️ 投水晶量必须 `max(1, floor(mine × ratio))`（`floor(2×0.15)=0` = 愿意投却投不出）。
村民岔路：`tier.crystal` 之外的档位**一律卖掉折现**（堵「99 枚 1 级永远用不上」）；当前档 `mine>=2` 才掷，卖时**留 1 枚**。
⚠️ `sellCrystal` 必须补 `emit(EVENTS.INVENTORY)` —— 仓库靠它重绘，只发 `VILLAGE` 列表停在卖之前。

## 子页面标签分类（第 55 轮）
仓库 `bag.js`：🌾农产品 / 💠其他（水晶在这档）。包裹 `package.js`：🌱种子 / 🧭藏宝图 / 🧪道具（删掉了原来的 `section()` 分区标题）。
⚠️ **tab 状态只能挂模块变量 `activeTab`**：每个动作后 `renderCurrent()` 整页重绘，状态进 DOM 会丢。
芯片复用商店 `.filter-chip` + `.chip-num`（带计数），外壳 `.sub-tabs` 只管排布：横滚、不换行、无滚动条。⚠️ **不能 `position: sticky`**（子页面本身是滚动容器，会压住标题）。
`confirmSell(rows)` 已泛化成行数据 `{key,name,unit,have,doSell}`，作物与水晶共用一套确认框。

## 排行榜
11榜，每天14:00结算；前三递减、并列都发；实时榜上/昨日在下。

## 农场通知（信箱）
`state.farm.progress.notices`（随 farm 行落盘，**不新开表**）；形状 `{id,at,kind,emoji,title,body,by,from,reward,claimText,read,claimed}`，清洗在 `data/notice.js`。
送礼 + 排行榜奖励都改**寄信**，`claimNotice` 才入账（发奖唯一入口 `store/reward.js` 的 `grantReward`）。`ui/gift.js` 与 `#giftLayer` 已整块删除。
⚠️ 保留规则「领过的留 30 天、**未领的永不过期**」上限 120 条；无 `reward` 的消息 `claimed` 恒 true。
⚠️ 角标两档：未领取→**数字**，仅未读→**纯红点**(`.fn-badge.dot`)，都没有→`hidden`。两种都是绝对定位，**不参与布局**（不许改成 flex 占位）。
⚠️ 打开列表 = `markNoticesRead()`，但列表**先渲染再标已读**：这一帧还看得见 `.nt-item.unread` 的红点与加粗标题。

## 自动机器
`autoSprinkler`🚰/`autoPest`🪤/`autoHarvest`🛻 各 2000；时效存 `farm.progress.auto={water,pest,harvest}`（到期时间戳）。
⚠️ **不写 `permanent`**（会让商店按钮变禁用）；`addAuto` 从 `max(now,旧)` 起+days（连买叠加）。
执行在 `world.js tick()` 第⑤步，离线上线同一套；**刻意不给经验/不 bump 榜/不 completeGuide**。
⚠️ 三处发奖特判 `ITEMS[id]?.auto`：adventure.applyReward / titles.claimTitle / `store/reward.js` 的 `grantReward`（第 54 轮从 daily 搬出，唯一发奖入口）。

## 称号
57条（等级26+图鉴26+金币5）；数据源 `TITLES` 改完重跑 `gen-data.mjs`。
`attachTitleSeeds()` 按难度进度自动配限定种子（须定义在 `specialCrops` 之后、校验之前）；奖励只有道具无金币。

## UI 硬约束
- 四 tab：农场/邻居/**村中心🏡**(≠村镇🏘联机)/商店。村中心：村庄卡→总览→📢公告+📋订单(唯一入口带徽标)→🏆排行。
- ⚠️ **地块列数只有一套**：`.grid` = 2/3/4 列（720/960 断点），`.grid.dense` 与 `.npc-plots` **只改 gap/padding/字号，不改列数**（dense 原来用 auto-fill minmax(102px) 在 430px 算出 3 列，与邻居 2 列对不上）。⚠️ `.grid.dense` 别写 `grid-template-columns`：两个类选择器优先级高于媒体查询里的 `.grid`，会把宽屏 3/4 列顶掉。
- `.farm-bar` 首位：上排狗 + 📬信箱 + 📔日志（`.farm-log` **34×34 / emoji 17px**）/中排三键/下排 `#farmAuto`(仅买过出现)；**不堆 fixed 浮层**。
- 村中心村民总览默认只看在线(`villagerFilter='online'`)。
- 弹窗四段式 handle/head/body/foot，**别用 sticky 替 foot**；`.modal-sub` 不许负上边距。
- ⚠️ `store/codex.js` 须同时 import `produceId` 与 `seedId`，少 `seedId` 会让 `makeSpecimen` 抛 ReferenceError（点不刷新三连）。
- 图鉴双进度条（收集≠点亮）；点亮先 `closeModal()` 再播 `codex-celebrate`。
- 设置页 `<input type=file>` 挂 `document.body`；拖拽先判 `#subpage.show [data-role=save-drop]`。
- **产出堆叠** `data/yield-pile.js`：`floor(n/2)+1` 张（**不是 ceil**，偶数产量偷 1 个才看得出少一张）、封顶 16（≥30 产量）；黄金角螺旋+LCG 定种（心跳 500ms 不能 random）；坐标全 em（紧凑只改 font-size）；邻居 key 带 `friend.id`；散落 `RADIUS_X=1.62/RADIUS_Y=0.66/MAX_ROT=±24°`（1.7 以上会被卡片裁角）；每图带白描边 + 双层 drop-shadow；⚠️ `.plot-art/.np-art` 要 `width:100%` + `padding:0 .5em` 否则最外侧图边缘点不动。
- ⚠️ **`.yield-pile > i` 绝不能加 `will-change: transform`**（一行把农场从满帧拖到 24fps）：40 地 × 16 张 = 640 个元素各自提升合成层。实测 40.8ms→16.4ms、卡顿帧 53~60/70→0/70，而 JS 侧 renderFarm 只要 0.06ms —— **瓶颈在合成不在脚本**。`filter: drop-shadow` 是清白的（单删无收益），换 `text-shadow` 反而更慢（26.5ms）。判断标准：静态定位元素一律不写 `will-change`。
- **地块骨架**（玩家与 NPC 同一套）：`.plot-main` / `.npc-plot` 是**两层**容器 —— `.plot-head`（图，不滚）+ `.plot-body`（文字，超出自己滚），外挂 `.plot-hang` 悬挂底边（`bottom:0` + `translate(-50%, calc(25% + 1px))`，3/4 在内 1/4 在外）。⚠️ 绝对定位所以不动邻格行高；那个 **+1px 不能省**（包含块是 padding box，`bottom:0` 在 border 内侧，否则只露 5/24）。底部统一留 padding（23/22/22）。
- ⚠️ **地块高度是硬锁 `height`（141px / 紧凑 113px），不是 `min-height`**：min-height 只兜「比地板矮」，兜不住「比地板高」（长名字+加成+被偷折行就撑开整行）。现在超出的文字进 `.plot-body` 滚动（`min-height:0` + `overflow-y:auto` + 隐藏滚动条 + `overscroll-behavior:contain`，居中靠首尾 `margin:auto` 不用 `justify-content:center`）。⚠️ **`.plot-main` 不能写 `flex:1`** —— 它是 `flex-basis:0%` 会盖掉 `height`，硬锁当场失效（实测变 127/142 两档）；`min-height` 不受影响所以旧版没暴露。⚠️ `.plot-head` 要给 `width:100%`，否则 `align-items:center` 让它收缩、里面 `.plot-art{width:100%}` 失去参照、堆叠图缩成一坨。验证口径：同一 `top` 上高度集合只能有一个值。
- **铲除 / 施肥在作物详情弹窗**，不在土地上：`plotActionsHTML` 用 `minmax(0,1fr) auto`（施肥吃剩余 + 铲除 36×34 方框），`.pa-row{max-width:300px;margin:auto}` 上限居中；成熟后只剩铲除→改胶囊。`.plot-side` / `.np-acts` 已整块删除。
- **地块 aura**：`inset:-1px` 对齐 border box；环向内收 N px 则半径 −N px；金边 4px 靠 `padding` 不给 border。⚠️ 贴外沿会在圆角抗锯齿处漏底色。
- **长按连发** `ui/hold.js`：`.qty-btn` 委托，只在 `modal.js`/`subpage.js` 各挂一次，业务零改动。⚠️ `touch-action` 只能写一条。

## 村镇联机
一村一房间(localStorage)；`state.peers` 仅内存，真人≠NPC；硬前提 https/localhost。主人权威；送礼 `peer-gift` 三段握手；报文>48KB丢、`cleanText()` 按码点截断。

## 其它
- 时报 30天/240条；农场日志与邻居动态纯 7天无条数上限。
- 签到 `signDays` 唯一源；改玩法同步手册 `subpages/manual.js`（数值最易漂）。
- PWA `sw.js` 网络优先；改图标同步 manifest/index.html/VERSION；开发用 `?nosw`。
