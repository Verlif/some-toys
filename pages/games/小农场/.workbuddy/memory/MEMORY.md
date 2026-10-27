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

## 排行榜
11榜，每天14:00结算；前三递减、并列都发；实时榜上/昨日在下。

## 自动机器
`autoSprinkler`🚰/`autoPest`🪤/`autoHarvest`🛻 各 2000；时效存 `farm.progress.auto={water,pest,harvest}`（到期时间戳）。
⚠️ **不写 `permanent`**（会让商店按钮变禁用）；`addAuto` 从 `max(now,旧)` 起+days（连买叠加）。
执行在 `world.js tick()` 第⑤步，离线上线同一套；**刻意不给经验/不 bump 榜/不 completeGuide**。
⚠️ 三处发奖特判 `ITEMS[id]?.auto`：adventure.applyReward / titles.claimTitle / daily.grantReward。

## 称号
57条（等级26+图鉴26+金币5）；数据源 `TITLES` 改完重跑 `gen-data.mjs`。
`attachTitleSeeds()` 按难度进度自动配限定种子（须定义在 `specialCrops` 之后、校验之前）；奖励只有道具无金币。

## UI 硬约束
- 四 tab：农场/邻居/**村中心🏡**(≠村镇🏘联机)/商店。村中心：村庄卡→总览→📢公告+📋订单(唯一入口带徽标)→🏆排行。
- `.farm-bar` 首位：上排狗+日志/中排三键/下排 `#farmAuto`(仅买过出现)；**不堆 fixed 浮层**。
- 村中心村民总览默认只看在线(`villagerFilter='online'`)。
- 弹窗四段式 handle/head/body/foot，**别用 sticky 替 foot**；`.modal-sub` 不许负上边距。
- ⚠️ `store/codex.js` 须同时 import `produceId` 与 `seedId`，少 `seedId` 会让 `makeSpecimen` 抛 ReferenceError（点不刷新三连）。
- 图鉴双进度条（收集≠点亮）；点亮先 `closeModal()` 再播 `codex-celebrate`。
- 设置页 `<input type=file>` 挂 `document.body`；拖拽先判 `#subpage.show [data-role=save-drop]`。

## 村镇联机
一村一房间(localStorage)；`state.peers` 仅内存，真人≠NPC；硬前提 https/localhost。主人权威；送礼 `peer-gift` 三段握手；报文>48KB丢、`cleanText()` 按码点截断。

## 其它
- 时报 30天/240条；农场日志与邻居动态纯 7天无条数上限。
- 签到 `signDays` 唯一源；改玩法同步手册 `subpages/manual.js`（数值最易漂）。
- PWA `sw.js` 网络优先；改图标同步 manifest/index.html/VERSION；开发用 `?nosw`。
