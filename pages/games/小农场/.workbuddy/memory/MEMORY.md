# 项目长期约定 · 西米的农场

纯前端原生 ESM、零构建，`node server.mjs`（默认 5173），IndexedDB `sun_farm_v2`，无后端。
DB_NAME / localStorage key / APP_NAME 保持 `sun_farm*`（存档兼容）。267 作物（165 常规 + 102 限定）/
40 块地 / 8 档土地 / 32 邻居 / 11 张榜。细则看 `docs/01~14`。

## 工程

- 分层 `ui → store → core`，`data` 谁都能读；store 唯一改状态、**禁 DOM**，提示走 `notify()`。
- 不做测试，只跑 `npm run check`；验证脚本用完即删。中文注释 + JSDoc，主动清死代码。
- `data/{crops,soils,progression}.js` 由 `tools/gen-data.mjs` 生成，**不手改**。
- 多表同事务 `commit({ farms, bag, news, relations, dailyRows })`，**动了才带**。
- ⚠️ `data-action` 必须写字面量（`check.mjs` 扫不到模板拼接）；删/搬函数后 `grep` 全调用点。
- ⚠️ `check.mjs` 盲区：news/shop 模板里有 `` `}` `` 序列，Edit 易失败。

## 存档

`state = { farm, friends[32], peers, bag, relations, news, dailyRows }`，玩家与邻居同形状。
七表：farm / plot([farmId,id]) / log([farmId,seq]) / news / relation([a,b]) / inventory / daily(date)。
⚠️ 复合主键每段必须有值；日志 `{ at, emoji, text, by }`，`by` = 邻居 id。新字段在
`normalizePlot / normalizeNpc / normalizePlayerFarm` 补。

备份（⚙️ 设置页）：`core/zip.js` 自写 zip + `core/backup.js` 四件套，导入五步校验全过才弹确认。
⚠️ 导出前 `flushDaily()`；导入成功后 `suspendPersist()` + `freezeWrites()` 双闸挡旧 state 回写；必须整页 reload。

## 世界时钟（核心）

`advanceWorld({ from, to, ctx, deferFrom, onVisit, onProgress, report })` 逐段推进，每段：
⓪下线 ①到点上线（按 `nextVisitAt` 升序）①'在线空闲 ②订单过期 ③跨 14:00 结算榜单 ④收炉
⑤自动机器（第 51 轮）。

- `stepMsFor`：≤7 天 1 分钟，之后每翻倍 ×2 封顶 60 分钟；动作时刻写真实时间戳。
- `VISIT_BUDGET=30000` 超预算：最早那段 `bulkAdvance`，最近仍逐分钟。
- ⚠️ 补算期跨表动作一律 quiet（`expireOrders`/`claimJobs`/`checkRollover`），结束 `flushAwards()`；
  循环里 commit 是最大性能陷阱（365 天 18s → 0.4s）。
- `from = min(worldCursor, lastSeen())`；`lastSeen()` 读 `progress.lastSeenAt`（**新档必须 `Date.now()`**）。
- **报告起点 ≠ 模拟起点**；`deferFrom = sessionStart` 才演出，间隔 >2 分钟直接算完。
- 落盘条件 `visits.length || report.idles`（在线空闲也改了内存，漏了白做）。
- 上线 `EVENTS.ARRIVAL` 在 `enqueueVisit` **当场发**（不许攒队列）；
  下线 `EVENTS.DEPARTURE` 由 `world.js noteDepartures()` 在每段**开头**（上线之前）发，
  且 `until >= deferFrom` 才发 —— 补算期弹一串「XX 下线了」毫无意义。
- 离线时间轴 >2 小时才弹，按自然日分桶（每天 ≤6 条），等出榜庆祝播完。

### NPC 行动框架

`ACTIONS` 注册表 `{ label, main, sweep, can, run }`：main 占性格权重，sweep 每趟顺路补跑，can 只过滤 main 候选。
加行为只加一条，不动 `planVisit` / `runStep` / 演出队列。
⚠️ sweep 动作**不能写 `can`**；`harvest` / `tend` 必须同时挂 main 与 sweep（否则没抽到那趟就整趟不管自家地）。
在线空闲：`npc.idleAt` + `planIdle` = harvest → tend → plant → 35% 抽 `IDLE_SOCIAL`；
⚠️ 刚上线 90 秒不做（`IDLE_AFTER_VISIT_MS`，否则抢跑演出）；只有动到玩家农场/送礼才 toast。

## 数值

- `expForLevel(n)=100n(n+1)`；售价 `整轮收益=(种子价×1.2+等级×10)×(1+0.05×整轮小时)`。
- **照料经验 `careExp(lv)=max(1, round(lv/10))`**：浇水/捉虫，自家与邻居同一口径（早年是等于等级）。
- 照料排程 `下次 = now + [次数×1h, (次数×2+1)h]`，不排进成熟前 15 分钟；欠水 −15%、欠虫 −40%。
- 地块 `plot.usable` 落库，开局 6 块，第 N 块 `(已拥有-6)×1000+500`，升级不给地。
- 三件省手道具各 200（永久版：采收机 20,000、另两 50,000）；制造间 Lv.5+2000 解锁，排队 `jobs`，
  `craftMs=max(1,lv)×10s`，栏位 = 等级，`craft()` 只入队、`claimJobs()` 到点收；⚠️ 时间戳落库离线照走。
- 好感 −200~200：打理 +1、偷成功 0、被逮 `max(1,round(售价/10))`、送礼 `max(1,round(等级/2))`、
  交易 `max(1,round(等级×份数/2))`、催上线 −20；亲近 ≥100 优先打理 + `closeGiftChanceFor`。
- 土地逐级晋升 `nextSoilId`；⚠️ `SOILS` 按 id 索引且条目**无 `id` 字段**，取出来要自己补。
- **开局礼包**（只有新档，`data/starter.js` + `ui/starter-gift.js`）：6 颗「等级 ≤ 玩家等级里最高档、
  同档长得最快」的种子 + 洒水器/杀虫剂/采收机各 3 + 狗粮 3；直接写 `state.bag`
  （**不走 `inventory.add`**，那是图鉴埋点）；弹窗凭 `takeStarterGift()` 取过即清，同时写一条农场日志。

## 邻居与世界

- NPC 模拟纯计算，`simCtx()` 注入 rel/receiveGift/daily/orders；npc-sim 不 import store。
- 互动概率翻倍用 `interactChance(c)=1-(1-c)²`（**不能 `c×2`**）；`actCare` 每趟 ≤2 块；
  玩家 care 权重 3、偷菜 2。NPC 升级经验 ×2 只放大 `gainExp` 的阈值，不动 `expForLevel`。
- 在线窗口 `npc.onlineUntil = at + onlineMs(npc)`（5~15 分钟）：绿点 / 灰度 / 偷在线双倍惩罚 /
  排序「上线」档 / 下线 toast 全看它。
- 订单只认产出、1.2 倍托管；NPC 单挂 `npc.order`、玩家单 `state.farm.orders`(≤5)，步骤 `order`/`fill`；
  `KEEP_RATIO` 允许全留（`NPC_BAG_CAP=60` 兜底）；`actPlant` 看榜种地。交易原价、对方必须在线。
- `normalizeNpc` 的 `schedule` **只认名单**。

## 守护犬

10 档 20%~80%，一只能上岗。`catchChance=rate×(0.5+0.5×sat/max)`；罚款 `售价×5` + 掉好感。
⚠️ 饱腹度 = 值 + 基准时刻 `dog.at`，写必须成对（`satiety=新值; at=now`）；满槽拒收并退粮。
容量 `100+30×狗窝级`，玩家侧必须传 `kennelCapacity()`，界面是**点数**不是百分比。
狗窝升级前先 `settleSatiety(now)`；挖宝每天 30%、只掷已过完的天，`digDay` 无论中没中都推进并落盘。

## 村庄

`state.farm.village = { level(1~5), coins, crystals, pray, stock{1..4}, prayDay, giveDay, logs[] }`，挂 farm 行零改表。

- 升级自动（每次投入/祈福后 `checkUpgrade`），三项同时达标即升并清零：
  金币 10k/36k/130k/460k + 水晶 5/12/22/36（1~4 级）+ 祈福 60/200/470/770（总量 1,500 ≈ 45 天）。
- 全村产量 +2%/级（玩家 `rollYield` 与 NPC `actHarvest` 共用 `villageYield()`）。
- 祈福每人每天 1 次、5% 抽对应等级藏宝图奖励池；NPC 奖励**折金币**（`npcPrayValue`）。
  ⚠️ 拆同步 `prayCore`（邻居走它，时钟里 await 会拖垮补算）+ `pray`（玩家补 commit）；
  ⚠️ `prayDay` 只留今天，否则长成 33×N 的表。
- 水晶 `stock` **不进 `ITEMS`**；冒险 50% 额外掉同档 1 枚（玩家 `finishRun`、NPC `actAdventure`）。
- **村民也投入**（第 49 轮，`ACTIONS.contribute` → `ctx.contributeNpc` → `contributeCore`）：
  每人每天一次（`giveDay`，同 `prayDay` 只留今天）；金币 `min(还差, 800, (身家-1200)×0.35)`，
  水晶 `min(还差, 库存÷2)`（库存 <2 不投）；需求为 0 直接返回 null。
- ⚠️ 因为别人也会把进度条推满，`invest()` 必须**夹到「还差的那点」**（多投升级时清零＝白扔）；
  金币+水晶都满 → 投入按钮变禁用「资源已齐」，`openInvest` 在两项都没得投时只 toast 不开弹窗。
- **投入多少看性格**（第 51 轮，`CONTRIB_STYLE` + `contribStyle(npc)`）：热心/勤勉/场面人
  积极参与（ratio 与 cap 上浮、水晶几乎必投），悠闲/爱占便宜/生意人「意思意思」（大幅下调、
  常常只投一点点甚至不投）；`CONTRIB_DEFAULT` 兜住未知性格。时报文案跟着换口吻
  （`（很上心）` / `（意思意思）`）—— 否则玩家只会觉得「赵六怎么才投这么点」，
  看不出这是设定而不是 bug。
- ⚠️ 村庄的「投入」图标用 **🚧** 不用 🧱：U+1F9F1 是 Emoji 11，老字体（含无头 Chrome）直接渲染成方框。

## 排行榜

11 张榜，每天 **14:00** 结算（`boardDayKey = dayKey(ts-14h)`），行 `date` = 账期开始日、行内带 `start`
（`BOARD_VERSION=3`）。打理王是当前值（`farmMaxBonus` 与峰值取大）。`bump` 累加 / `bumpMax` 峰值；
settled 冻结；前三名递减、并列都发；玩家获奖同时写时报，名次用 `entry.rank`；庆祝层 z-index 195。
实时榜在上、昨日在下；`rewardText()` 与发奖文案同源。埋点矩阵见 `docs/06`。

## 自动机器（第 51 轮）

三件不进背包的道具：`autoSprinkler` 🚰 2000 / `autoPest` 🪤 2000 / `autoHarvest` 🛻 1000。

- 时效记在 **`farm.progress.auto = { water, pest, harvest }`**（到期时间戳，不是剩余毫秒）。
  ⚠️ **不要写 `permanent`** —— 那个字段会让商店按钮变「已拥有」并禁用，而机器要能重复买叠加。
- `addAuto(kind, at, days)` 是「从 `max(now, 旧到期)` 起 +days 天」，所以连买两个是 2 天、不是覆盖。
  `ITEMS[id].auto` 就是类别名，`AUTO_KINDS` 是反查表。
- 执行在 `world.js` 的 `tick()` 第 ⑤ 步（`runAutoStep(prev, next)`），所以**离线补算和上线是同一套**：
  玩家不在时机器照转，回来一次性把日志补上。改动返回非空 → `report.dirty = true` 让调用方额外落盘。
- **刻意不给经验、不 `bump` 榜单、不 `completeGuide`** —— 花钱省的是「惦记」，不是成长。
  复用 `water`/`catchPest`/`collectPlot` 的**效果**（缩短成熟、增产、收进仓库），跳过它们的成长部分。
- 日志走 `player.addLog('🚰'|'🪤'|'🛻', …)`，toast 只在 `at >= deferFrom` 时弹（补算期别刷屏）。
- 三处发奖要特判 `ITEMS[id]?.auto`：`store/adventure.js applyReward`、`store/titles.js claimTitle`、
  `store/daily.js grantReward`。漏一处就是背包里躺一堆永远用不掉的 `autoSprinkler ×3`。
- 农场控制栏第二行 `#farmAuto`（`renderFarmAuto()`），只有买过的机器才出 chip；文案
  `autoTimeText(remain)`：> 23:59:59 显示「X天X时X分」，否则「X时X分X秒」。

## 称号

57 条：等级 26 + 图鉴 26（**每 10 个图鉴一档，10→260**）+ 金币 5。

- 数据源是 `tools/gen-data.mjs` 的 `TITLES`，**改完必须 `node tools/gen-data.mjs`** 重生成
  `src/data/progression.js`（那份文件头写着「请勿手改」）。
- **每个称号至少一颗限定种子**：手写 57 条里的种子既啰嗦又容易和档位错位，所以
  `attachTitleSeeds()` 按「同组内难度进度」自动配 —— 进度映射到 Lv2~Lv200 的目标等级，
  在 `specialCrops` 里取最接近的那种；进度 ≥0.8 给 2 颗。金币称号手写了种子，跳过不覆盖。
  ⚠️ 这个函数**必须在 `specialCrops` 定义之后调用**（它读 `specialCrops`），
  且在校验块之前（校验会逐条核对 `seed_名字` 是否真的存在）。
- 自动机器从 lv22 起逐档穿插，高档位给 2~3 天；图鉴称号 160 档以上必带 `map_5`。
- 奖励仍然**只有道具没有金币**（第 20 轮的口径），加量靠数量与种类，不靠塞钱。

## UI 硬约束

- 四 tab：农场 / 邻居 / **村中心 🏡**（≠ 村镇 🏘 联机浮窗）/ 商店。村中心顺序：村庄卡 → 总览
  （含玩家、点开弹窗看名单）→ 并排 📢公告栏 + 📋订单（**唯一入口**带徽标）→ 🏆排行卡（两列，
  并列 `+N`）。村庄卡数字用千分位，不用 `formatCoins`。
- 农场页 `.farm-bar` 在 `#page-farm` 首位、流内跟列表滚：上排守护犬（整格点开狗窝）+ 日志，
  中排三格一键（`#farmActions`），**下排自动机器时效 `#farmAuto`**（第 51 轮，只有买过才出现）。
  **不再往底部堆 fixed 浮层**；存量只标消耗版 `×N`；`.fa-stock` 只在 <330px 隐藏。
- 村中心的村民总览**默认只看在线**（`villagerFilter='online'`）：离线的人不是不在名单里，
  只是默认不占屏；切到「全部」才铺开。
- 土地列表：已解锁 → 荒地卡（未解锁只画第一张）→ `.plot-fold` 垫底；
  `renderFarm` 末尾必须把汇总行挪回末尾。
- toast 用背景 alpha(.75) 不用 `opacity`。浮层统一上滑 + 下拉关闭；拖拽三铁律：
  move 先查 tracking / 鼠标事件只在按下期间挂 / Touch + preventDefault。
- 弹窗四段式 handle/head/body/foot，**别用 sticky 替 foot**（18px 渐隐会削）；支持叠层、动作只派栈顶。
  `.modal-sub` **不许负上边距**；`openModal(html, fn, cardClass)` 第三参挂整卡类名。
- 地块 `.plot-main` + `.plot-side`(34px，≤4 按钮)；底纹 `soilbg-<id>` 用 `::before`，**不能改 background**；
  限定作物 `.plot-aura` 旋转金边，缺水/生虫/成熟 = 同层 `::after` 外扩环。
- 邻居弹窗：头部 → 2×2 数据卡 → `.npc-board`（农场 N 块 + 📜 + 🚿🧴 + 行尾 `💬 互动`；次行狗粮 + 🦴）
  → 地块 → 提示。控制台**故意不 sticky**；日志走叠层。互动弹窗收送礼 / 交易 / 催上线。
- 图鉴双进度条（收集 ≠ 点亮）；点亮先 `closeModal()` 再播 `codex-celebrate`。
- 记录只有 `recordItemsHTML` + `inlineTagsHTML`；农场日志双 tab 按 `entry.by` 分。
- 设置页 `<input type="file">` 必须挂 `document.body`；拖拽要挡 `document` 默认行为但先判
  `#subpage.show [data-role="save-drop"]`；`dragleave` 要判 `relatedTarget`。

## 村镇联机

一村一房间（配置存 localStorage）；`state.peers` 只在内存，真人 ≠ NPC。硬前提 https/localhost。
真人农场可动手（主人权威），送礼走 `peer-gift` 三段握手。
安全：丢 >48KB 报文、`cleanText()` 按码点截断、`isItemKey` 用 `hasOwnProperty`。

## 其它

- 时报 7 天 / 80 条；农场日志与邻居动态纯 7 天、**不设条数上限**（`trimLog`）。
- 签到 `signDays` 唯一数据源、`streakOf(now)` 现算；改玩法记得同步游戏手册 `subpages/manual.js`
  （手册里的数值最容易漂）。
- PWA `sw.js` 网络优先（只有图标/manifest 缓存优先）；改图标同步 manifest / index.html / VERSION；
  开发用 `?nosw`。headless 里 `requestAnimationFrame` 慢，但 `setTimeout(0)` 更慢。
