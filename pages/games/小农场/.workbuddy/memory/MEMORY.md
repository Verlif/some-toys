# 项目长期约定 · 文字版阳光牧场

纯前端（原生 ESM、零构建、`node server.mjs`），存档 IndexedDB（`sun_farm_v2`），无后端。
局域网联机走 WebRTC P2P（`vendor/webconnect.js`，见下「村镇联机」）。
220 作物（165 商店 + 55 限定）/ 40 块地 / 8 档土地 / 32 位邻居。

## 工程约定

- 分层 `ui → store → core`，`data` 谁都能读。store 唯一改状态、**禁 DOM 符号**，提示走 `notify()` → 总线 → toast。
- **不做测试**，只跑 `npm run check`，验证脚本用完即删。中文注释 + JSDoc，主动清死代码。
- 作物/土地/经验/称号由 `tools/gen-data.mjs` 产出，**不手改** `data/{crops,soils,progression}.js`。
- 多表写入同一事务 `commit({ farms, bag, news, relations })`（后两个可选，**动了才带**）；
  无后台定时器，到点恢复用时间戳判定。

## 存档

`state = { farm, friends[32], bag{itemId:count}, relations{'a|b':v}, news[] }`，玩家与邻居同形状。
六表：`farm`(id) / `plot`([farmId,id]) / `log`([farmId,seq]) / `news`(seq) /
`relation`([a,b]，a<b，一对一条) / `inventory`(itemId)。
`plots`、`log` 只在内存挂农场上，写档拆回子表。⚠️ 复合主键每段必须有值。
日志条目 `{at, emoji, text, by}`：**`by` = 干这件事的邻居农场 id**（邻居对玩家农场的
操作才传），农场日志浮窗靠它分「我的操作 / 邻居动向」两个 tab；`storage.js` 读写两处都要带，
旧档没有这个字段 → 一律算玩家自己的操作。
新字段在 `normalizePlot`/`normalizeNpc`/`normalizePlayerFarm` 里给旧档补。

## 数值

- **六种原型** `arch`（生成器 `ARCHS` / `FORM_ARCHS` / `ARCH_PATTERN` 10 格轮转）：
  速生 `0.5h+lv*25s`、丰产 base×1.5、精品 base×1.9（2 茬）、慢生 base×3（≤4天）、
  多茬（手写名单，regrow **0.16**）、常规。产量倍率 0.45/2.6/0.28/1.35/0.26/1。
  ⚠️ 售价公式没改（整轮收益÷总产量）；**速生按公式每小时最高**（用户明确要严格公式）。
  换图标改 CATALOG 的 emoji，生成器 emoji 上限是 8 次（原先 3 次逼出一堆色块）。
- **地块**：不再按等级送，`plot.usable` 落库存档；开局 6 块，之后第 N 块
  `(已拥有-6)×1000+500`（6→500 … 39→33500，全买 ≈58 万）。`farm.unlockPlot()`
  只能按 id 顺序买，`unlockedPlotCount()` 数 `usable`。**升级不再给地**（`unlockedPlots` 恒 0）。
  老档读档时按「原等级解锁数」折算 usable，不会掉地。
- 经验 `expForLevel(n)=100n(n+1)`（200 级 = Infinity，折算 `expForProgress()`）；只看产出：
  每份 `(作物等级+2) × 土地 expMul`。售价不自由：`整轮收益=(种子价×1.2+等级×10)×(1+0.05×整轮小时)`，
  只该比「每小时金币」。藏宝图：限定种子上限 = 需求等级+10，商店 = 需求等级×2；**`special` 只能挖**。
- **三件省手道具**（`data/items.js` + `store/tools.js`）：洒水器 / 杀虫剂 / **采收机**
  （各 200，用一次扣 1 个，不管处理几块地），各有**永久版**（5万/5万/10万，`permanent:true`）。
  先查永久版再查消耗版（反了会白吃消耗品）；`toolUses` 返回 Infinity（UI 显示 ∞）。
  一键收获 `farm.harvestAll()` 与 `harvest()` 共用 `collectPlot(plot)`。
  ⚠️ 永久版**不进藏宝图奖励池**、包裹里**不给丢弃**。
- **种子制造间**（`farm.workshop={level,kinds}`，0=未开张）：Lv.5+2000 解锁，1~10 级。
  ⚠️ 升级看**造过的作物种类数**（3/6/10/15/21/28/36/45/55）不是次数（按次数刷小麦就行）。
  `kinds` 记每种造几次（UI 标「已造过」）但**只数 key 个数**；旧档 `uses` 丢弃、等级保留。
  份数 `max(5, ceil(seed×0.2÷sell))` + **工本费=一颗种子价** → 低级亏、Lv6 起转正、满级 +64%。
  限定作物不能造；金币与份数**都在扣之前查**；制造要二次确认。
- **照料**（`data/care.js`，玩家/邻居共用）：不是固定周期。每次处理完重排
  `下次 = now + [次数×1h, (次数×2+1)h]` 随机到分钟（**下限跟着次数走**，避免刚浇完又缺水），
  **不排进成熟前 15 分钟**；下限顶到线上 → 返回 0 = 本轮不再需要、也不扣产量。
  `waterNext/pestNext` + `waterTimes/pestTimes`。成熟时欠一条 **−15%**、欠两条 **−40%**（不是 30%）。
- **好感度**（`data/relation.js` 规则 + `store/relation.js` 读写）：−200~200，六档，
  起点 `round((性格A+性格B)/2)`（玩家 0 → 热心 +38、贪心 −22）；打理 +1、
  **偷菜成功 0（不掉好感）**、**被守护犬抓住 `dogCaughtRelLoss(售价)=max(1,round(售价/10))`**、
  送 `max(1,等级/2)`；`stealWeightFor` 1.2−rel/200、`helpWeightFor` 1+rel/200、
  `giftChanceFor` <60 为 0 最高 0.3。**权重只决定挑谁，不决定做不做**。
  `stealRelLoss`（按等级）已删除，别复活。
- **土地逐级晋升**（用户明确要求）：生成器给每档加 `prev`（普通地空串，红→normal、黑→red…），
  产物导出 `SOIL_ORDER` 与 `nextSoilId(soilId)`。`farm.upgradeablePlots(soilId)` = 空闲且
  **下一档正好是 soilId** 的地；`upgradeSoil` 拦跳级（toast「先把它升成X」）。顶档是神话。
  效果三处确认生效：`yieldMul`→`rollYield`、`timeMul`→播种/再生、`expMul`→收获经验。
- **仓库卖出**（`subpages/bag.js`）：确认框每种作物一行 + `.qty` 步进器，**默认全量**、
  可减到 0（合计为 0 时确认禁用）、「全卖」回填，合计实时重算。
  `sellProduce(cropId, n?)` 缺省全卖、数量夹在持有量内；`sellAllProduce` 已删（无调用方）。
  列表名称后挂图鉴标记 `.codex-mark`：**只有点亮（有标本）才渲染**（第 32 轮改）——
  图标本身是白色，置灰和全彩几乎分不出来，未点亮索性不放；`.codex-mark.off` 规则已删。

## UI 硬约束

- 浮层统一：上滑进场、下拉关闭（`ui/drag-close.js` >8px 接管、>72px 关闭）、最大宽 640px。
- **拖拽三条铁律**：① `move()` 先查 `tracking` ② 鼠标 move/up 只在按下期间挂 ③ Touch + preventDefault。
- **弹窗**：`openModal()` 把 `.modal-head` 提到 `.modal-body` 前标题才拖得动；关闭图标统一补；从标题/
  把手起手忽略「内容已滚动」。**支持叠层**（整卡快照压栈，close 还原 scrollTop）。
  **四段式**：handle / head / body / **foot** —— 模板里的 `.modal-foot` 也会被提出滚动区，
  切换条与主操作按钮一律放这里面。⚠️ **别用 `position: sticky` 代替**：
  `.modal-body` 底部 18px 渐隐会把 sticky 底条削掉一截；有底栏时 `body.has-foot`
  要关掉 mask，否则滚到底的最后一行被永久淡掉。还原叠层时 `has-foot` 要补回来。
- 地块 = `.plot-main`(flex:1)+`.plot-side`(34px)；列数 手机2/≥720 3/≥960 4；高 152/紧凑 126（图标 47/38px）；
  成熟摇定 `plot.pendingYield`。**`.plot-side` ≤4 按钮**（水/虫/肥/铲）：`4×29+3×3=125≤128`，
  加第 5 个前先重算，`overflow:hidden` 会静默裁掉；铲除用 `.icon-btn.danger`。
  **锁定地块不显示图标**（`lockedHTML` 去掉 🔒），`.plot-lock` 是与 `.plot-emoji` 同尺寸的
  空占位盒（47/38px），只留「Lv.X 解锁」—— 占位是为了网格和已播种地块等高（152px）。
- **土地底纹** `soilbg-<id>` 用 `::before` 叠渐变，**不能改 `background`**（状态类各有背景），颜色只声明
  `--soil-tint`：**135deg 对角**（左上=土地色 → 右下=普通色，76% 处淡完），档位越高越浓
  （第 29 轮再提一档：.52/.48/.56/.60/.60/.66，彩虹多色 .54/.50/.48/.48）。
  `.npc-plot` 底色/边框/底纹与 `.plot` 一致，状态类只改边框；`.npc-plots` 列数与 `.grid`
  同一套断点（2/3/4），圆角 `var(--radius)`、压边 24px 全部对齐；NPC 空地块位名。
- **商店种子排序**（`views/shop.js` 的 `SEED_SORTS`：等级/价格/首次成熟 `grow`/整轮时间
  `totalCycleSeconds`）：芯片排在筛选芯片后、`.filter-sep` 分隔，三态循环 降序→升序→取消。
  ⚠️ `delegate` 传给 action 的是 `dataset.id` **字符串**，不是元素（当成 el 用会炸）。
- 商店横滚在 `.shop-panel` 自己；筛选条在 `.shop-panels` 之外；重绘先恢复 `scrollLeft` 再同步 tab。
- **横滚芯片条接力** `ui/scroll-keep.js` 的 `keepBarScroll(root, sel, render)`（第 32 轮新增）：
  排序/筛选芯片条整块重绘后 `scrollLeft` 归零，手机上点右边的芯片会让标签条滚回最前面。
  用法 = 把重绘体包进回调；helper 重绘前读、重绘后同步赋值（不闪）。`display:none` 的条
  （商店非种子 tab 下收起的 `.shop-filter`）`scrollLeft` 恒为 0 读不到，helper 内部用
  WeakMap 记上一次可见时的值兜底。三处调用：`renderFriends` / `renderNews` / `renderShop`。
  `.codex-filters`（wrap）、`.title-tabs`/`.shop-tab`（flex:1 均分）不横滚，不用管。
- **图鉴**（`subpages/codex.js`）卡片**只有图标 + 名称**，数据全在点开的作物弹窗里；
  三档筛选 全部 / 可点亮 / 已收集（`entry.canMake = !specimen && owned>=50`）；
  未解锁 ❔+??? 不可点，已解锁未收集 ❔+未收集 可点。
  **点得开的条件 = `unlocked || collected`**（送礼/偷菜不看等级，低级玩家可能有高级产出，
  这种灰卡必须能点开做标本 —— 曾按 `unlocked` 一门，灰卡点了没反应）。
  **收集 ≠ 点亮**：收集 = 产出进过仓库（`progress.collected`，`inventory.add` →
  `store/collected.js` 记账，只增不减，偷的/送的都算）；
  点亮 = 做过标本（`progress.specimens`），出现在详情弹窗与图鉴称号。
  卡片三档：点亮 = 彩色、已收集未点亮 = `.dull` 灰图标（grayscale 但**不打码**）、
  未收集 = `.shadow` ❔+「未收集」、未解锁 = ❔+「???」。
  老档按 `specimen || harvested>0 || owned>0` 兜底（标本必须算收集，不然点亮却显示剪影）。
- **邻居页**筛选（全部/可偷摘/可帮忙）与排序（等级/财富/好感）**两条独立状态**：
  排序芯片三态循环 降序→升序→取消（`sortKey`/`sortDir`，取消=名单原序）。
  **筛选条只认点击**：早先「左右滑动切档」的 touch/mouse 手势已整段删除，
  移动端会误切、还跟芯片行横向滚动抢手势（别再加回来）。
  `renderFriends()` 整块换 `#friendsBody`，芯片条横滚位置走 `ui/scroll-keep.js` 的
  `keepBarScroll(root, sel, render)` 接力（见下「横滚芯片条」）。
- **邻居弹窗**：一键浇水/杀虫在「🟫 农场（N 块）」标题行右侧（`.npc-tool` 图标 + 角标），
  底部只剩送礼；记录给**今天+昨天**（`recordItemsHTML` 的 `since`），
  ⚠️ `.npc-log` 上下 padding 必须为 0，否则 sticky 日期标题上方留缝、条目从缝里露出。
- **送礼三层**：清单 → 确认框（左下角 `.qty` 步进器 + 全送，好感 = 单份 × 份数）。
- **记录只有一种长相** `ui/records.js` 的 `recordItemsHTML`：农场日志 / 邻居弹窗 / 邻居卡片 /
  **时报**同一套 `.log-item`，差异只剩 `withDay / limit / compact / relative`。别再为「展示记录」写第二套标记。
  容器层面的差异（时报是白底面板）归外层。
- **农场日志双 tab**（`ui/log-sheet.js`，芯片静态写在 index.html 的 `.log-tabs`，复用 `.filter-chip`）：
  「我的操作」= `!entry.by`，「邻居动向」= `entry.by` 有值（NPC 主动对玩家农场的操作：
  顺菜 / 被守护犬逮住 / 顺手浇水捉虫 / 送礼）。tab 状态挂模块变量 `logTab`，空列表两个 tab
  各有各的 empty-tip。⚠️ NPC→玩家日志的统一漏斗是 `social.js` 的 `farmView().log(at, emoji, text, by)`
  与 `receiveGift`；新加一种 NPC 动作也要记得传 `npc.id`。
  **tab 在面板底部**（第 32 轮从头部移下来）：DOM 顺序 `#logBody` 在前、`.log-tabs` 在后，
  CSS `padding: 10px 16px 0`（上 10px 拉开、下 0 靠 `.log-panel` 自带 12px 底 padding）。
  ⚠️ news.js/shop.js 的模板字面量里有 `` `}` `` 闭合序列，Edit 匹配老失败 —— 字节级确认后再改。
- **行内标签** `ui/inline-tags.js` 的 `inlineTagsHTML`：一次正则同时处理人名（`.who-tag`，人绿）
  与作物名（`.crop-tag`，物黄）。全文匹配、长名优先、同长度人优先、吃掉两侧空格；
  **作物标签连前面的 emoji 一起吃**；文案必须用真实 `${farm.name}`。
  **头像在名称左侧、与名称共用同一个胶囊背景**（`.ava` 圆形白底，玩家 `.me` 更深一档）。
  日志/时报条目**不存 `who` 字段**（第 28 轮整条删除）——「是谁」全靠文案里的人名扫描匹配，
  存了也没人读。两者都是入口（`data-action="open-farm"` / `"crop-detail"`），
  由 `ui/inline-actions.js` **在 document 上统一委托** —— 新地方渲染出标签就自动可点，视图不用绑事件。
  **基线：`vertical-align: baseline` + `line-height: normal` + `margin: 0 4px`**（写死 1.15 会高 1px）。
- **作物详情只有一个弹窗** `ui/crop-detail.js` 的 `openCropModal(cropId, {title,status,extra,foot,actions,onAction})`：
  六处入口（自家地块、邻居地块、制造间产出、仓库农产品、图鉴卡片、记录里的作物标签/时报图标）。
  想加新入口只写这四块，不要另拼卡片。`status` 是一串 `.sd-chip`。
- **邻居农场弹窗只有一个** `ui/friend-modal.js`（邻居卡片 / 记录人名 / 时报人名共用）。
  弹窗内操作只替换受影响那一格。列表拼接必须 `join('')`。
  信息格**两列**，守护犬/偷菜各 `.npc-stat.wide` 占满一行（四列时狗的那句被省略号吃掉）。
  好感度一律「标签+数值」（`.rel-tag` 六档，`plain` 要淡描边）。
- **送礼三层**：邻居弹窗 → 清单（`gift-ask`）→ 确认框（`gift-send`）。成功后 `closeModal()` **两次**。
- **赠礼层** `ui/gift.js`：在线 toast、离线攒着上线整屏补播；**不做 opacity 动画**（合成层会把
  半透明底渲染成一片浅色），`flushOfflineGifts()` 必须在 `bootDone()` 之后。
  种子详情只一份 `ui/seed-detail.js`（`{buy:true}` 下单 / `false` 只读）。

## 守护犬

10 档（**比熊 20%** → 龙犬 80%，田园犬第 7 档 58%），只有一只能上岗（空串=不设防）。改名用
`LEGACY_BREED_MAP` **只迁一次**（`dog.migrated='r18'`）。狗粮槽全窝共享，只在上岗时按 `6.25`/小时消耗；
`catchChance(rate,sat)=rate×(0.5+0.5×sat/100)`。被抓住按 `crop.sell×5` 罚给被偷者（钱不够倾家荡产），
**另外掉好感 `max(1,round(售价/10))`**（第 29 轮起：偷菜成功不掉，只有被逮才掉）。
偷邻居被逮住 `emit(EVENTS.DOG_CAUGHT,…)` → `ui/dog-caught.js` 全屏闪狗（**不复用 #modal**）。

## 邻居与世界

- 邻居同用 `unlockedPlotCount(level)`；地块按 `rollNpcSoil(level)` 随机，收成吃 `yieldMul`。
- 偷菜每块每轮一次，`stealable()` 要带 `!plot.guarded`；`needsWater/needsPest` 统一从 `data/care.js` 转出，
  必须带 `now < readyAt`（成熟后不再冒按钮）。
- 邻居动作表含 `care`（帮谁看 `helpWeightFor`，玩家/邻居一视同仁）与 `gift`（真东西进玩家背包）；
  `simCtx()` 注入 `rel / relAdjust / receiveGift`，`npc-sim.js` 仍不 import 任何 store。
- NPC 模拟纯计算，落盘 `persistFriends()` 一次提交；远期聚合、近期 7 天逐条；在线时拆动作串演出，
  游标先推进、一步一落盘。`PLAYER_FARM_WEIGHT = 2`。
- **NPC 喂狗概率**（`actFeedDog`）：`min(0.85, tend×0.28)`（第 29 轮从 0.55/0.13 提上来，
  用户明确要「更大概率投喂」）；`bulkAdvance` 的远期饱腹度基线同步提到 `25+tend×16`。
  ⚠️ NPC→玩家农场的动作**逻辑一直都有**，用户「看不到」是因为混在同一个 60 条日志里被
  玩家自己的操作刷掉（现已分 tab），外加送礼要好感 ≥60、照料要有缺水/生虫的未成熟地、
  偷菜要 `STEAL_CHANCE` 掷中 —— 这些是门槛不是 bug。

## 村镇联机

- 一个村镇 = 一个房间（channelName），`appName='sun-farm'`，口令留空则用村镇名。
  配置存 localStorage `sun_farm_village`，进游戏自动回村。
- **四层**：`net/link.js`（连接与收发，全部是 JSON 字符串）→ `net/protocol.js`
  （hello / snap / snap:res + 外来数据清洗）→ `store/peers.js`（`state.peers` 名册）
  → `ui/subpages/village.js`（设置 + 在线名单 + 访问）。
- **真人 ≠ NPC**：`state.peers` 只在内存，**不落库、不进 `npc-sim`**；`getFriend()`
  先 friends 后 peers，所以真人与 NPC 共用同一个邻居弹窗。
- **两个硬前提**：页面必须 https / localhost（库用 `crypto.subtle` 派生房间密钥，
  非安全上下文直接抛错）；两端都要能上外网（信令走公共 tracker/MQTT/Nostr）。
  `server.mjs --https` 用 openssl 自动签证书（`certs/`，已 gitignore）；
  `npm run start:https`。
- 公共 relay 会常驻控制台红字（`tracker.btorrent.xyz` 500、`relay.nostrdice.com` DNS 失败），
  **连接仍然成功**，别当 bug 修。
- 换村镇时旧连接的回调用 `alive()` 拦；库里 `Disconnect()` 在没有 peer 时是空操作，
  所以额外对三个 room 补 `leave()`。
- 快照约 10 KB（40 地块 + 12 条日志），`DATA_VERSION = 作物种类数`，不一致拒绝连接；
  `cleanText()` 按**码点**截断（直接 slice 会劈开 emoji）。
- **真人农场可动手**：`store/peer-actions.js` 的 `act / act:res / act:pay`。
  主人权威：访客发请求 → 主人在自己的地上校验并执行 → 回执 → 访客只做自己这侧记账
  （经验 / 扣化肥 / 拿 1 个产出 / 交罚款）。偷菜每块每轮 1 个（主人 `stolen` 兜底），
  被狗抓住 → 主人把全场地标 `guarded` + 罚款 `售价×5`，访客扣钱后 `act:pay` 给主人入账
  （主人回执时 `fines` 记下金额，回款 ≤ 该值）。施肥用**访客自己的**化肥。
  弹窗地块按 `friend.net` 换 `peer-` 前缀动作；一键照料对真人仍隐藏。
- **安全**：`link.js` 丢 >48KB 报文、每人 5s 最多 60 条；`protocol` 夹取地块/日志/等级/金币/时间，
  文本去 `<> & " '` 并按码点截断；`isItemKey` 与 CROPS/SOILS 查表一律 `hasOwnProperty`
  （`__proto__` 会命中原型对象）；礼物 1~999、同人 3s 一条、最多 10 笔待确认；
  快照请求 1s 一次；toast 1.5s 一条。
- **入口**：底部 tab 栏第 3 位（邻居之后）的「村镇」按钮，**进村后才出现**
  （`[hidden]` 要单独写 `display:none`，否则被 `.tabbar button{display:flex}` 盖掉）；
  没进村时走「☰ 其他 → 村镇」打开的同一个浮窗（内容是加入表单）。
  浮窗 `ui/village-sheet.js`：平铺无卡片，村镇名不可编辑 + 右侧昵称，
  点标题展开（连接号/在线数/昵称/离开），点空白收起且**输入框从 DOM 摘掉**。
- **孤岛**：加入失败 toast「正处在孤岛中」并退回单机；`quitVillage()` 断连 + 清名册 +
  localStorage `auto=false`（下次不自动连）；加入成功置 `auto=true`，重开自动回村。
- **同步**：`peers.js` 监听 `FARM/PLAYER/INVENTORY`，1.2s 节流后广播 `snap:res{push:true}`
  （无 req）；收方更新名册并 `emit(EVENTS.PEER, id)`，`friend-modal` 就地 `refreshAll()`
  （滚动位置不变）。
- **广播**：`broadcastToast(text)`（≤40 字）→ 收方 `avatar 名字：text`。
  挂点：升级（player）、播种（farm.plant）、稀有种子与冒险结算（adventure）、收礼（peer-gift）。
- **玩家送礼**（`store/peer-gift.js` + `ui/peer-gift.js`）：`gift:offer → accept → ack{ok}`
  三段握手。**送方发要约时先扣货**，拒收/90s 超时自动退回；**收方等到 ack 才入包**
  （防双花）。包裹道具与仓库产出都能送（`isItemKey()` 白名单）。收下后全村广播。
- 快照只发 `usable` 的地；`peer-gift` 的 `initPeerGift()` 要在 main 里显式调用
  （它监听 `EVENTS.PEER_MSG`，peers 只负责转发未知报文）。
- **下一期**：远程偷菜/浇水/杀虫（`reqId` 幂等 + 5s 超时）、真人好感度、邻居页展示真人。

## 其它

- 时报 7 天/80 条、日志 7 天/60 条，按 `at` 倒序。施肥额度唯一（`plot.fert`），增产与捉虫相乘。
- **时报条目** `{at, emoji, text, crop, cat}`：`crop` 有值时图标换成该作物且可点；
  `cat`（level/steal/dog/adventure）是筛选依据，不传按图标兜底 —— **图标被换掉时必须显式传**。
  冒险挖到限定种子单独上一条（`store/adventure.js` 的 `announceReward`）。
  旧档无 crop/cat 走兜底；`storage.js` 读写两处都要带上这两个字段。
- 图鉴称号看**点亮**（标本 50 个产出）；动作属性必须写在 `class` 之外。
- 称号 38 个，手动领、只戴一个、奖励只有道具；**分三类 tab**（吸顶），tab 状态挂模块变量 + 切后 `scrollTop=0`。
- 引导 17 项，每个 key 要有真实调用点。背包展示名走 `itemLabel(id)`。
- 签到不发经验；历史存 `progress.signDays`（90 天）。「其他」已删加工坊/交易行，改放种子制造间。
- **日历空位按「当月 1 号」周几算**（拿今天算会整月平移：21 号跑周二、🎁 跑周五）；下半格只放
  ✓/🎁；读档把 `lastSign` 那天补进 `signDays`。

## 护栏与踩坑

`npm run check` 盲区：抓不到私有函数丢失 → **删/搬函数后必须 `grep -rn` 搜全调用点**。
e2e（真实 Chrome，脚本不入库）：等 `body[data-page]`；**全屏 `.sign-celebrate` 会吞点击**；
跨页选择器要限定活动页；返回 `#subBack`、关模态 `[data-close]`、toast 容器是 `#toasts`；
子页面内容在 `#subpageBody`（不是 `#page-xxx`），经「☰ 其他」浮窗的 `.sheet-item[data-sub]` 打开。
**造测试数据**：`page.evaluate` 里 `await import('/src/store/xxx.js')` 与页面共用同一模块实例，
可直接改 `state` 再 `commit` + `emit`；产物的背包 key 前缀是 `crop_`（`produceId`）。
