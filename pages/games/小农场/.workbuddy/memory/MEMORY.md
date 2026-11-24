# 项目长期约定 · 西米的农场

纯前端原生 ESM、零构建，`node server.mjs`（5173），IndexedDB `sun_farm_v2`，无后端；DB/key/APP 名保持 `sun_farm*`。
**271 作物 / 40 地 / 8 档土 / 52 邻居（开局 32）/ 11 榜 / 57 称号**。
**设计与数值细节一律看 `docs/01~14`（数值 04、存储 05、领域 06、邻居 07、视图 08、UI 09）；本文件只是一张「会踩的坑」速查卡。**

## 工程
- 分层 `ui→store→core`，`data` 只读；store 唯一改状态、**禁 DOM**（提示走 `notify()`）。
- 不写测试，只跑 `npm run check`；中文注释 + JSDoc，勤清死代码。
- `data/{crops,soils,progression}.js` 由 `tools/gen-data.mjs` 生成，**不手改**，改完重跑。
- `data-action` 必须字面量（`check.mjs` 扫不到模板拼接）；删/搬函数后 `grep` 全调用点。
- `commit({…})` **动了才带**，没动的表别塞进去。

## 存档
七表 farm / plot / log / news / relation / inventory / daily；`state={farm,friends,peers,bag,relations,news,dailyRows}`，玩家与邻居同形。
⚠️ 复合主键每段必有值；日志 `{at,emoji,text,by}`（`by`=邻居 id）；**新字段必须补进 `normalizePlot/normalizeNpc/normalizePlayerFarm`**，否则读档即丢。
备份 `core/zip.js`+`core/backup.js`：导出前 `flushDaily()`；导入五步校验 → `suspendPersist()+freezeWrites()` 双闸 → 整页 reload。

## 世界时钟
分段：⓪下线 ①上线 ①'空闲 ②订单过期 ③跨 14:00 结算 ④收炉 ⑤自动机器 ⑥公共用地 ⑦承包地摇产量。
`from = min(worldCursor, lastSeen())`；`deferFrom=sessionStart` 才演出，隔 >2 分直接算完。
⚠️ **循环里 `commit` 是性能陷阱**（365 天 18s → 0.4s）：补算期跨表动作全 quiet，结束一次性 `flushAwards()`。
**NPC 行动框架**：`ACTIONS` 注册表，加行为只加一条；sweep 不写 `can`；`harvest/tend` 须同时挂 main+sweep；上线 90 秒内不 idle。
⚠️ `run()` 返回的 `{emoji,text}` 由 `runStep` 统一 `log(npc,…)` —— **动作里别再给自己写一条**（会重复）。
⚠️ 改了**别的** NPC 必须在返回里带 `farms:[那位 id]`：在线演出只提交「玩家 + 发起人」，不带就丢（`npc-sim.js` 接单同理带 `order.ownerId`）。

## 数值（口径，手算时看这条）
- `expForLevel(n)=100n(n+1)`；整轮收益 `(种子价×1.2 + 等级×10) × (1 + 0.05×整轮小时)`。
- 照料经验 `careExp(lv)=max(1,round(lv/10))`（自家 / 邻居同口径）；欠水 −15%、欠虫 −40%。
- 产量 / 售价的 1.2 系数只改 `gen-data.mjs` 的 `YIELD_SCALE`，`sell` 守恒倒推。
- 地块开局 6，第 N 块 `(已拥有−6)×1000+500`；三件省手道具各 200（永久采收机 2 万 / 另两 5 万）。
- 制造间需 Lv5 + 2000：`craft()` 只入队、`claimJobs()` 到点收；**限定作物不能制种**（`crop.special` 挡）。
- 好感 −200~200：打理 +1 / 偷 0 / 被逮 `round(售价/10)` / 送礼 `round(等级/2)` / 交易 `round(等级×份/2)` / 催 −10；≥100 优先打理+送礼。
- ⚠️ 公共地照料一次 → **全村各 +1**（不封顶）：`bumpVillageRelations()` 遍历 `state.friends`；`persist()` 按需带 `relations`（`withRelations`），带了才 `emit(RELATION)`。节流靠 `needsWater`/`needsPest`。
- ⚠️ 玩家偷菜被逮时**其他邻居各 −1**（`CAUGHT_RIPPLE_REL_LOSS`）：固定值不乘在线双倍、被偷那家不重复扣、不含 peers、NPC 互偷不触发；日志与 `.dc-ripple` 都要说。
- ⚠️ `SOILS` 按 id 索引且条目**没有 id 字段**，取出后自补。
- 开局礼包（仅新档）：6 颗「≤ 玩家等级最高档里同档最快」种子 + 三件省手道具各 3 + 狗粮 3，直接写 `state.bag`。

## 邻居与守护犬
- `interactChance(c)=1−(1−c)²`（**不是 `c×2`**）；`actCare` 每趟 ≤2 块；玩家 care 权重 3 / 偷 2。
- 在线窗口 `npc.onlineUntil`（5~15 分）控绿点 / 灰度 / 排序；订单只认产出、1.2 倍托管，NPC 挂 `npc.order`、玩家 `farm.orders`（≤5）。
- ⚠️ 村民随村庄升级变多：`initState` 按 `village.level` 过滤；新增住户的 `lastVisitAt/nextVisitAt/dog.at` 要按到 now。
- 10 档 20%~80%；`catchChance = rate × (0.5 + 0.5×sat/max)`。⚠️ **逮到不罚款**（用户定死）：只掉好感（被偷那家）+ 当日进不去他家。
- ⚠️ 饱腹度 = 值 + `dog.at`，写必须成对；容量 `100+30×狗窝级`；狗窝升级前 `settleSatiety(now)`；挖宝每天 30%，只掷已过完的天。

## 村庄与水晶
`village={level(1~5),coins,crystals,pray,stock,prayDay,giveDay,logs[]}` 挂在 farm 行上，零改表；全村产量 +2%/级、每级多 5 人。
升级自动（`checkUpgrade`）：金币 20k/72k/260k/920k + 水晶 20/48/88/144 + 祈福 120/400/940/1540。
⚠️ 拆同步 `prayCore`(邻居) + `pray`(玩家补 commit)；`prayDay/giveDay` 只留今天。
⚠️ `invest()` 夹到「还差的那点」；金币水晶都满则按钮禁用；投入图标用 **🚧** 不用 🧱（老字体渲染成方框）。
⚠️ 升阶 `grantHonorSeeds`：玩家走 `add`、邻居 `npc.bag[seedId]+=1`；`cleanNpcBag()` 须放行 `seed_` 前缀。
`CRYSTAL_SELL={1:500,2:1000,3:2000,4:5000}`；`sellCrystal(tier,n)` **只 commit farms 一张表**（水晶挂 `farm.village.stock`）。
⚠️ 建设日志只由 `invest`/`contributeCore` 写 —— `addCrystal` 与纯卖水晶都不写（`if (coins||crystals)` 包住）。
⚠️ `CONTRIB_STYLE.crystalInvest` 的 **0.3 是硬下限**（能卖之后推到 0，村民一拿到就卖光）；投量 `max(1, floor(mine×ratio))`；非当前档一律卖掉折现，当前档 `mine>=2` 才掷、卖时留 1 枚。
⚠️ `sellCrystal` 必须补 `emit(EVENTS.INVENTORY)`，仓库靠它重绘。

## 公共用地
`state.commons` = farm 表里 `id:'commons'`/`kind:'commons'` 的**无主农场** → 存储 / 备份 / 导入零改动，**不升 `DB_VERSION`**。块数 `2×村庄等级`；作物池 `[(级−1)×10, 级×20]`，限定作物不进池。
⚠️ `initState()` 两处顺序死穴：`rows` 过滤必须排除 `COMMONS_ID`；`villageLevel` 必须先于 `normalizeCommons`。
⚠️ 摇产量必须**先于**清空判断（`commonsRemain = pendingYield − taken`，没摇过两者都是 0，先判会铲掉刚熟的）；`advanceCommons` 返回 true 置 `report.dirty`，循环里不 commit。
**熟了摆 1 天换种**：`commonsRipeDeadline(plot)=readyAt+24h`，不另存字段；该换种 = 拿光 **或** 过期；系统补种不写日志。
先到先得账本 `plot.taken` + `plot.takers`；`commonsCanTake(plot,who)` 同时判「还剩」与「这人没拿过」。
照料给经验、**收获不给经验**；村民 `ACTIONS.commons`(sweep)，先抢收 65% 再照料 50%；该玩法**不记任何榜**、不补算历史。
⚠️ **落盘**：`persistFriends`/`flushAwards`/`runLiveStep` 走 `state.js` 的 `farmRows(...)`（自动补 commons、去重、滤空值）；`store/commons.js` 的 `persist()` 反过来必须带 `state.farm`；玩家主动操作邻居的单点提交**刻意不带**。
⚠️ 弹窗顶部 `data-role` 用 **`commons-board`** 不用 `board`（邻居弹窗全局查 `[data-role="board"]`，撞名互相覆盖）。
`commonsSnapshot()` **不播种**（播种只在 `advanceCommons` / `openCommonsModal`）；`water`/`pest` 只统计**还在长**的地。

## 承包地比赛
`state.contract` = farm 表 `id:'contract'`/`kind:'contract'` 的**第二座无主农场**（同样不升 `DB_VERSION`）。永远两块地 0=玩家 / 1=对手，序号不能换；五阶段只由 `contractPhase` 算。
⚠️ **谁都不能手收 → 产量必须在成熟那一刻摇定**（`rollContractRipe`，`pendingYield` 非 0 即「已摇」，幂等；`world.js` 第⑦步与 `contractSnapshot` 两处调）—— 等结算再摇，玩家会盯着一块熟透却没数字的地。
⚠️ 拒绝概率 2%~30% 必须有冷却（`cool[id]` 15 分钟），否则连点即绕过上限；读档只留未到期的。
⚠️ 结算 / 认输的 `persist` **必须带 `npcs`**（对手赢的是 `rival.bag`，不带他重开就白赢）；其余入口不带，别 34 座全量重写。
⚠️ 入口行 `live` 高亮判 `phase !== 'done'`（`match` 在 done 阶段还留着结果，拿它当「进行中」会一直挂绿杠）。
⚠️ `normalizeContract(row, save, aliveIds)`：对手已不在村里就**整局作废**（否则永远结算不了），所以 `initState` 的 `defs` 必须先于它算，且 contract 行要在 `rows` 过滤前认领。
平局判玩家赢（`>=`）：产量是掷的、玩家还先付 5 点好感又亲手照料。种子不花玩家的；两地块同刻种下、浇水后才分开 → 结算取**最晚**那块；吃村庄产量倍率、永远普通土。
照料给经验**不给好感**；村民 `ACTIONS.contract`(sweep)，50% 门，两块地谁的都照料。
⚠️ `contractPlotText(plot, now)` 是渲染与秒表的**唯一口径**（`{stage,left,ripe}`）：两处各算一遍，边界那秒就会「倒计时归零但仍写生长」。

## 排行榜
11 榜 / 每天 14:00 结算 / 前三名递减、**并列都发**；实时榜在上、昨日在下。
**前三名都发金币 + 道具**（150/80/50，道具按名次递减，1 名 ⊃ 2 名 ⊃ 3 名）。奖励表就是 `BOARDS[].rewards=[1名,2名,3名]`，弹窗与发奖同读一份 —— 改数据即可，UI / 结算不用动。
⚠️ 冒险王五档的**藏宝图只给第一名一张**（能白嫖产出，按名次发会泛滥），二三名换成有机化肥 + 增产剂。
⚠️ 玩家奖励先进「农场通知」，`claimNotice` 才入账 —— 结算里**不要直接发金币**。

## 农场通知（信箱）
`state.farm.progress.notices`（随 farm 行落盘，**不新开表**）；清洗在 `data/notice.js`；发奖唯一入口 `store/reward.js` 的 `grantReward`。
⚠️ 领过的留 30 天、**未领的永不过期**，上限 120 条；无 `reward` 的消息 `claimed` 恒 true。
⚠️ 角标两档：未领取 → **数字**，仅未读 → **纯红点**，都没有 → `hidden`；都绝对定位、**不参与布局**。
⚠️ 打开列表先渲染**再** `markNoticesRead()`（这一帧还看得见红点与加粗）。
⚠️ **信箱只放玩家自己的事**：NPC 之间的社交写 NPC 日志，不进信箱。

## 自动机器与称号
`autoSprinkler`🚰 / `autoPest`🪤 / `autoHarvest`🛻 时效存 `farm.progress.auto`，`addAuto` 从 `max(now,旧)` 起加天数；⚠️ **不写 `permanent`**（会让商店按钮变禁用）。执行在 `tick()` 第⑤步，**刻意不给经验 / 不 bump 榜 / 不 completeGuide**。
⚠️ 发奖要特判 `ITEMS[id]?.auto` 的三处：`adventure.applyReward` / `titles.claimTitle` / `store/reward.js` 的 `grantReward`。
称号 57 条（等级 26 + 图鉴 26 + 金币 5）；改 `TITLES` 后重跑 `gen-data.mjs`；`attachTitleSeeds()` 须定义在 `specialCrops` 之后、校验之前；奖励只有道具无金币。

## UI 必踩点（细节见 docs/09）
- 四 tab：农场 / 邻居 / **村中心🏡**（≠ 村镇🏘 联机）/ 商店。
- 村中心：村庄卡 → 村民总览(1fr)+排行榜(2fr) 一行 → `.center-main`（左 1fr 公告栏/订单，右 1fr 公共用地跨两行）→ `.center-line` 独占一行放承包地。⚠️ 是 **1fr:1fr 不是 1fr:2fr**（给 2fr 公告栏订单会被压成省略号）。
- ⚠️ `.center-act` 是 `<button>`，`width:auto` 对它是 **shrink-to-fit**；放进 `.center-line` 必须补 `.center-line .center-act{width:100%}`。判据：`卡片宽 == 行宽 − 左右 padding`。
- ⚠️ **叠层还原的是快照**：`closeModal()` 用 `innerHTML` 还原上一层，上层改过数据就是过期内容 → `modal.js` 还原后 `emit(EVENTS.MODAL_RESTORE)` 由持卡模块自己重绘，且**必须手动接力 `.modal-body` 的 `scrollTop`**；搜索词存模块变量（`input.value` 不进 innerHTML）。
- ⚠️ 弹窗输入框事件**委托挂 `#modal` 根**，别绑 `<input>` 自己（压栈还原后节点是新的）。
- ⚠️ **地块高度是硬锁 `height`（141 / 紧凑 113），不是 `min-height`**；`.plot-body` 用 `overflow:hidden` **不滚**（内层滚动容器会抢整页滑动）；`.plot-main` **不能写 `flex:1`**（`flex-basis:0%` 会盖掉 height）。
- ⚠️ **`.npc-plot` 绝不能写 `overflow:hidden`**（`.plot-hang` 是直接子元素，一裁就把探出的 1/4 切平）。验证口径：`hang.bottom − card.bottom == 按钮高×1/4`。
- ⚠️ **`.yield-pile > i` 绝不能加 `will-change: transform`**（640 层时满帧 → 24fps）；静态定位元素一律不写 `will-change`。堆叠张数 `floor(n/2)+1`（**不是 ceil**）。
- ⚠️ **地块列数只有一套**：`.grid` 2/3/4 列（720/960）；`.dense`/`.npc-plots` 只改 gap/padding/字号，**别写 `grid-template-columns`**（优先级高于媒体查询）。
- ⚠️ 排行榜名字横滚：渲染后量一次写 `--cr-shift`/`--cr-dur`，走 `transform` 关键帧；**别逐帧读 `scrollLeft`/`offsetWidth`**，也**别加 `will-change`**。
- ⚠️ **tab 态只能挂模块变量 `activeTab`**（每个动作整页重绘，状态进 DOM 会丢）；`.sub-tabs` **不能 sticky**（子页面本身是滚动容器）。
- ⚠️ 承包地入口行 `≤380px` 靠**纯 CSS 媒体查询**藏 `.ca-ico`（别用 JS 切类）；320px 标题截断是已知的，别再当 bug 修。
- ⚠️ `fmtDuration` 对 ≥1 小时**不含秒**（`3小时51分`）：验证「秒表在不在走」要拿 <1 小时的地采样，否则两次读数一样会误判成卡死。
- 长按连发 `ui/hold.js`：`.qty-btn` 委托，只在 `modal.js`/`subpage.js` 各挂一次；⚠️ `touch-action` 只能写一条。

## 村镇联机 / 其它
一村一房间（localStorage）；`state.peers` 仅内存，真人 ≠ NPC；硬前提 https/localhost；主人权威，送礼 `peer-gift` 三段握手，报文 >48KB 丢。
时报 30 天 / 240 条；日志与动态纯 7 天、无条数上限。签到 `signDays` 唯一源。改玩法要同步手册 `subpages/manual.js`（数值最易漂）。PWA `sw.js` 网络优先，开发用 `?nosw`。
