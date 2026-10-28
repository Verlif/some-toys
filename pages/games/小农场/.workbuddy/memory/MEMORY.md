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
- `.farm-bar` 首位：上排狗 + 📬信箱 + 📔日志（`.farm-log` **34×34 / emoji 17px**）/中排三键/下排 `#farmAuto`(仅买过出现)；**不堆 fixed 浮层**。
- 村中心村民总览默认只看在线(`villagerFilter='online'`)。
- 弹窗四段式 handle/head/body/foot，**别用 sticky 替 foot**；`.modal-sub` 不许负上边距。
- ⚠️ `store/codex.js` 须同时 import `produceId` 与 `seedId`，少 `seedId` 会让 `makeSpecimen` 抛 ReferenceError（点不刷新三连）。
- 图鉴双进度条（收集≠点亮）；点亮先 `closeModal()` 再播 `codex-celebrate`。
- 设置页 `<input type=file>` 挂 `document.body`；拖拽先判 `#subpage.show [data-role=save-drop]`。
- **产出堆叠** `data/yield-pile.js`：`floor(n/2)+1` 张（**不是 ceil**，偶数产量偷 1 个才看得出少一张）、封顶 10；黄金角螺旋+LCG 定种（心跳 500ms 不能 random）；坐标全 em（紧凑只改 font-size）；邻居 key 带 `friend.id`；散落 `RADIUS_X=1.62/RADIUS_Y=0.66/MAX_ROT=±24°`（1.7 以上会被卡片裁角）；每图带白描边 + 双层 drop-shadow；⚠️ `.plot-art/.np-art` 要 `width:100%` + `padding:0 .5em` 否则最外侧图边缘点不动。
- **地块骨架**（玩家与 NPC 同一套）：单列 `.plot-main` 铺满整格 + `.plot-hang` 悬挂底边（`bottom:0` + `translate(-50%, calc(25% + 1px))`，3/4 在内 1/4 在外）。⚠️ 绝对定位所以不动邻格行高；那个 **+1px 不能省**（包含块是 padding box，`bottom:0` 在 border 内侧，否则只露 5/24）。底部统一留 padding（23/22/22）。
- ⚠️ **地块高度必须锁在 `.plot-main` 上**（`min-height:141px`，紧凑 `113px`），**别锁 `.plot`** —— 四种状态内容行数 3~6 行不等，外层 min-height 只是地板、内容一多照样顶穿。病根不是悬挂按钮（摘光全部 `.plot-hang` 高度变化 0.0px），是「💧 缺水」那行警示文字：点掉 💧 时它同时消失 → 矮 15px → grid 整行缩回。连带约束：`ripeHTML` 的「照料不周」**不能单独占一行**（成熟是 4.4em 堆叠图，多一行 156px 比生长中 6 行 137px 还高），要和「还可收获」挤一行、压缩成 `照料 −40% · 最后一茬`。验证口径：同一 `top` 上高度集合只能有一个值。
- **铲除 / 施肥在作物详情弹窗**，不在土地上：`plotActionsHTML` 用 `minmax(0,1fr) auto`（施肥吃剩余 + 铲除 36×34 方框），`.pa-row{max-width:300px;margin:auto}` 上限居中；成熟后只剩铲除→改胶囊。`.plot-side` / `.np-acts` 已整块删除。
- **地块 aura**：`inset:-1px` 对齐 border box；环向内收 N px 则半径 −N px；金边 4px 靠 `padding` 不给 border。⚠️ 贴外沿会在圆角抗锯齿处漏底色。
- **长按连发** `ui/hold.js`：`.qty-btn` 委托，只在 `modal.js`/`subpage.js` 各挂一次，业务零改动。⚠️ `touch-action` 只能写一条。

## 村镇联机
一村一房间(localStorage)；`state.peers` 仅内存，真人≠NPC；硬前提 https/localhost。主人权威；送礼 `peer-gift` 三段握手；报文>48KB丢、`cleanText()` 按码点截断。

## 其它
- 时报 30天/240条；农场日志与邻居动态纯 7天无条数上限。
- 签到 `signDays` 唯一源；改玩法同步手册 `subpages/manual.js`（数值最易漂）。
- PWA `sw.js` 网络优先；改图标同步 manifest/index.html/VERSION；开发用 `?nosw`。
