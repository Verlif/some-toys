# 项目长期约定 · 西米的农场

纯前端（原生 ESM、零构建、`node server.mjs`），IndexedDB `sun_farm_v2`，无后端。
DB_NAME / localStorage key / APP_NAME 保持 `sun_farm*`（存档兼容）。联机走 WebRTC P2P（`vendor/webconnect.js`）。
267 作物（165 常规 + 102 限定）/ 40 块地 / 8 档土地 / 32 位邻居。详细规则看 `docs/`（01~14）。

## 工程

- 分层 `ui → store → core`，`data` 谁都能读。store 唯一改状态、**禁 DOM 符号**，提示走 `notify()`。
- **不做测试**，只跑 `npm run check`；验证脚本用完即删。中文注释 + JSDoc，主动清死代码。
- `data/{crops,soils,progression}.js` 由 `tools/gen-data.mjs` 产出，**不手改**。
- 多表同事务 `commit({ farms, bag, news, relations, dailyRows })`（**动了才带**）。
- ⚠️ `data-action` **必须写字面量**：`check.mjs` 扫源码字符串，`${x}` 拼的它看不见。
- ⚠️ `check.mjs` 盲区：删/搬函数后必须 `grep -rn` 搜全调用点；news/shop 的模板里有 `` `}` `` 序列，Edit 易失败。

## 存档

`state = { farm, friends[32], bag, relations, news[], dailyRows }`，玩家与邻居同形状。
七表：`farm` / `plot`([farmId,id]) / `log`([farmId,seq]) / `news` / `relation`([a,b]) / `inventory` / `daily`(date)。
⚠️ 复合主键每段必须有值。日志 `{at, emoji, text, by}`，`by` = 邻居 id（NPC→玩家操作才传）。
新字段在 `normalizePlot / normalizeNpc / normalizePlayerFarm` 补；`writeFarm` 存整行（除 plots/log）。

**导出 / 导入（第 46 轮，⚙️ 设置页）**：`core/zip.js` 自己写的 zip（`writeZip` 优先
`CompressionStream('deflate-raw')`、`readZip` 走 EOCD + 中央目录），`core/backup.js` 四件套
`describeSave / exportSave / readSaveFile / applySave`。zip = `manifest.json` + `save.json` + `README.txt`，
`format='ximi-farm-save'`、`version=1`。导入五步校验（zip → 两 json → format/version → size+crc32 → 结构），
**全过才弹确认框**，`applySave` 是先 `wipeSave()` 再整份写回。
⚠️ 三个坑：① 导出前 `flushDaily()`，否则刚打完的榜单成绩不在 zip 里；
② 写回成功后到重载前的窗口里，任何一次落盘都会拿旧 `state` 盖掉新档 ——
`suspendPersist()`（daily）+ `freezeWrites()`（storage 的 `commit` 空转）两道闸，重载后自动复位；
③ 导入后必须整页 `location.reload()`，`state` 没法热替换。

## 世界时钟（核心）

`store/world.js` 的 `advanceWorld({from,to,ctx,deferFrom,onVisit,onProgress,report})`：从「上次离开」逐段推到「现在」，
每段按序 到点上线（按 `nextVisitAt` 升序）→ 订单过期 → 跨 14:00 结算榜单 → 收炉。**离线与在线同一条路径**。

- 步长 `stepMsFor(span)`：≤7 天 1 分钟，之后每翻倍 ×2，封顶 60 分钟；动作时刻写**真实时间戳**不用步点。
- `VISIT_BUDGET=30_000`：超预算把**最早那段**给 `bulkAdvance` 聚合，最近那段仍逐分钟。
- ⚠️ **补算期间跨表动作一律 quiet**（`expireOrders`/`claimJobs`/`checkRollover`），结束统一 `flushAwards()`。
  早年每条订单过期 commit 一次 → 365 天 18 秒，改后 0.4 秒；循环里 `commit` 是最大的性能陷阱。
- `from = min(worldCursor, lastSeen())`；`lastSeen()` 读 `progress.lastSeenAt`，老档退回「最早的待办上线」兜底 8 小时。
- **报告起点 ≠ 模拟起点**：报告从 `lastSeenAt` 算（新档不误弹「你不在的 16 小时」），模拟要覆盖开局那批旧上线。
- `deferFrom = sessionStart` 只给「刚刚这一分钟」到点的上线演出；间隔 >2 分钟（页面冻结）直接算完。
- 心跳：`main.js` 每 60 秒 `checkOnlineVisits()`；页面隐藏时 `touchLastSeen()`。
- 落盘条件 `visits.length || report.idles`：**在线空闲动作也改了内存**，漏了白做。
- `enqueueVisit` 里 **`emit(EVENTS.ARRIVAL)` 当场发上线通知**，不许再攒进队列等轮询 ——
  演出 3~7 秒后就开演，攒着会「先看到动作、过一会才被告知他上线了」。
- 离线时间轴 `ui/offline-report.js`：**>2 小时才弹**，四格总账 + 按自然日分桶（每天 ≤6 条、最多 10 天），
  要等出榜庆祝播完；不足一天按小时说，天数按 elapsed 不按桶数。

### NPC 行动框架（注册表）

`npc-sim.js` 的 `ACTIONS`：`{ label, main, sweep, can, run }`。`main` = 占性格权重名额（键对 `PERSONALITIES.weights`）；
`sweep` = 每趟顺路再试一次；`can` **只过滤 main 候选池**；`run(npc,at,ctx)` 返回 `{emoji,text,…}|null`。
加新行为 = 加一条，不动 planVisit / runStep / 演出队列。
⚠️ `sweep` 动作**不能写 `can`**（can 规划时算，收获途中才腾空地，补种要看那之后）。
⚠️ `harvest` / `tend` 必须**同时**挂 `main` 与 `sweep`，否则没抽到那趟就整趟不管自家地。

## 数值

- `expForLevel(n)=100n(n+1)`；售价 `整轮收益=(种子价×1.2+等级×10)×(1+0.05×整轮小时)`。
- 地块 `plot.usable` 落库，开局 6 块，第 N 块 `(已拥有-6)×1000+500`，升级不给地。
- 三件省手道具各 200 金币，各有永久版（采收机 20,000，另两件 50,000）。种子制造间 Lv.5+2000 解锁，
  排队制造 `jobs={id,cropId,need,fee,startAt,doneAt}`，`craftMs=max(1,lv)×10s`，栏位 = 等级，
  `craft()` 只入队、`claimJobs()` 到点加种子；⚠️ 时间戳落库离线照样走，读档要清洗 jobs。
- 照料：`下次 = now + [次数×1h, (次数×2+1)h]`，不排进成熟前 15 分钟。欠水 −15%、欠虫 −40%。
- 好感 −200~200：打理 +1、偷菜成功 0、被逮 `max(1,round(售价/10))`、送礼 `max(1,round(等级/2))`、
  交易 `max(1,round(等级×份数/2))`、**催上线 −20**。亲近档 ≥100 优先打理 + `closeGiftChanceFor`（.25→.55）×性格系数。
- 土地逐级晋升 `nextSoilId`，`upgradeSoil` 拦跳级。⚠️ `SOILS` 按 id 索引、**条目里没有 `id`**，取出来要自己补。

## 邻居与世界

- NPC 模拟纯计算，`simCtx()` 注入 rel/receiveGift/daily/orders，npc-sim 不 import store。
- **互动概率（第 47 轮整体翻倍）**：`interactChance(c) = 1 - (1-c)²`（掷两次算一次），套在 顺菜 / 串门 / 送礼 / 喂狗。
  ⚠️ 不能用 `c×2`：会把 often(.65) 与 always(.95) 一起顶到 0.99。`actCare` 每次 ≤2 块地；
  玩家农场 care 权重 3、偷菜权重 2。
- 在线窗口 `beginVisit` 写 `npc.onlineUntil = at + onlineMs(npc)`（5~15 分钟），下游：绿点 / 灰度头像 /
  偷在线 NPC 双倍惩罚 / 排序「上线」档。NPC 升级经验 ×2（`NPC_EXP_MUL` 见 npc-sim）。
- **在线空闲**（`npc.idleAt` + `planIdle`）：在线期间每 1~3 分钟做一件事，优先级
  harvest → tend → plant → 掷 `IDLE_SOCIAL_CHANCE(.35)` 抽社交动作。`actHarvest`/`actTend`
  一次处理**全部**地，所以两次空闲就干净。⚠️ **刚上线 90 秒不做**
  （`IDLE_AFTER_VISIT_MS`，否则抢跑演出队列）；⚠️ 只有动到玩家农场的才 toast。
- 订单：只认产出、1.2 倍赏金创建即托管；NPC 单挂 `npc.order`（1 条），玩家单 `state.farm.orders`（≤5）；
  步骤 `order` / `fill`（每次上线 1 条）。`KEEP_RATIO` **允许全留**（精打细算/爱占便宜 1.00，靠 `NPC_BAG_CAP=60` 兜底）；
  `actPlant` **看榜种地**（榜上有人收的优先种）——否则 267 种作物永远凑不齐单。
- 交易：原价 `crop.sell`，邻居必须在线（UI 与 store 各挡一次）。`normalizeNpc` 的 `schedule` **只认名单**。

## 守护犬

10 档（20%→80%），只有一只能上岗。`catchChance(rate,sat,max)=rate×(0.5+0.5×sat/max)`；
被逮罚 `售价×5` + 掉好感；偷在线 NPC 双倍。
⚠️ 饱腹度 = 「基准值 + 基准时刻 `dog.at`」，`dogSatietyAt()` **只认 `at`**，写存量必须
`dog.satiety = 新值; dog.at = now;` 成对写（曾错写 `fedAt`，喂了等于没喂）。满槽拒收并退狗粮。
容量随狗窝等级（`100+30×级`），玩家侧必须传 `kennelCapacity()`，界面是**点数**不是百分比。
狗窝升级前必须 `settleSatiety(now)`；挖宝每天 30%、只掷已过完的天、`digDay` 记账（**无论中没中都推进并落盘**）。

## UI 硬约束

- **四个主页面 tab**：农场 / 邻居 / **村中心 🏡** / 商店。村中心 🏡 ≠ 村镇 🏘（联机浮窗）。
  村中心五块：**🏘 村庄建设卡**（三项进度 + 投入/祈福/建设日志）→ 总览卡（**含玩家**、
  点开弹窗看名单）→ 并排 📢 公告栏 + 📋 订单（**唯一入口**，带徽标）→ 🏆 排行榜卡
  （两列：榜单 / 昨日冠军，并列 `+N`，点开弹窗）。村庄卡的数字**用千分位不用 `formatCoins`**
  （「0 / 1.0万」这种混搭读不懂）。
- 农场页顶部 `.farm-bar`：`#page-farm` 首位、**流内跟列表滚**，上排守护犬（整格可点→狗窝）+ 日志方块，
  下排三格一键。**不要再往底部堆 fixed 浮层**；存量只标消耗版 `×N`；`.fa-stock` 只在 <330px 隐藏。
- 土地列表顺序：已解锁 → 荒地卡（未解锁只画第一张）→ `.plot-fold` 汇总行垫底；
  `renderFarm` 末尾必须把汇总行挪回末尾。
- toast 用背景 alpha（.75）不用 `opacity`，文字纯白。浮层统一上滑 + 下拉关闭（`drag-close.js`）。
  **拖拽三条铁律**：①move 先查 tracking ②鼠标事件只在按下期间挂 ③Touch+preventDefault。
- **弹窗四段式** handle/head/body/foot，别用 sticky 代替 foot（body 底部 18px 渐隐会削掉）；支持叠层、动作只派栈顶。
  `.modal-sub` **不许负上边距**（body 是 overflow，顶出去会被裁）。`openModal(html, fn, cardClass)` 第三参挂整卡类名。
- 地块 `.plot-main` + `.plot-side`(34px，≤4 按钮)；`.plot-lock` 空占位盒。底纹 `soilbg-<id>` 用 `::before`，
  **不能改 `background`**。两圈动效：限定作物 = `.plot-aura` 旋转金边；缺水/生虫/成熟 = 同层 `::after` 外扩环。
- **邻居弹窗 `openFriendModal`**：头部 → 数据卡 2×2 → `.npc-board`（首行 农场 N 块 + 📜 + 🚿🧴 + 行尾 `💬 互动` 大按钮；
  次行 狗粮槽 + 🦴）→ 地块 → 提示。控制台**故意不 sticky**；日志走 `openFriendLog()` 叠层。
  **互动弹窗** `openInteract` / `.ia-list` 收 送礼 / 交易 / 催促上线，联机好友只有送礼。
- 横滚芯片条接力 `keepBarScroll`（friends/news/shop/rank 底栏）。图鉴：卡片只有图标+名称，三档筛选，
  点得开 = `unlocked||collected`，收集≠点亮，双进度条；点亮先 `closeModal()` 再播 `codex-celebrate`。
- 记录只有一种长相 `recordItemsHTML`；行内标签 `inlineTagsHTML`。农场日志双 tab 按 `entry.by` 分。
- 称号页 `.title-card > :last-child` 固定 28px 高居中。送礼三层：清单 → 确认 → 发送，赠礼层不做 opacity 动画。
- **设置页**（`subpages/settings.js`）：`<input type="file">` **必须挂 `document.body`**（子页面每次动作后
  `renderCurrent()` 重绘，挂里面的话 change 落在已摘掉的节点上、静默失效）；拖拽除方块本身还要挡 `document`
  的默认行为（否则掉在方块外浏览器直接打开 zip、把游戏顶掉），**但要用 `#subpage.show [data-role="save-drop"]`
  判页面是否真开着** —— 关子页面只移除 `.show`、DOM 还在，不判就会在别的页面抢文件。
  `dragleave` 要判 `zone.contains(event.relatedTarget)`，否则从方块移到内部文字就闪。

## 村庄（第 48 轮）

`state.farm.village = { level(1~5), coins, crystals, pray, stock{1..4}, prayDay{}, logs[] }`，
挂 farm 行零改表。`data/village.js` 纯数据 + `store/village.js` 逻辑。

- 升级**自动**（`checkUpgrade`，每次投入/祈福后跑），三项同时达标就升、同时清零。
  门槛 10k/36k/130k/460k 金币 + 5/12/22/36 枚 1~4 级水晶 + 60/200/470/770 祈福
  （总量 1,500 ≈ 45 天；祈福是唯一花钱买不到的闸门）。
- **全村产量 +2%/级**：玩家 `rollYield` 与 NPC `actHarvest` 共用 `villageYield()`。
- 祈福每人每天 1 次、5% 抽对应等级藏宝图奖励池；NPC 的奖励**折金币**（`npcPrayValue`）。
  ⚠️ `pray` 必须拆同步 `prayCore`（邻居走它，时钟里 await 会拖垮补算）+ `pray`（玩家补 commit）。
  ⚠️ `prayDay` **只留今天**，否则长成 33×N 的表（`normalizeVillage` 也清一次）。
- 水晶 `stock` **不进 `ITEMS`**（会连累商店 / 包裹 / 图鉴 / 联机校验）。冒险 50% 额外掉
  同档 1 枚：玩家在 `finishRun`、NPC 在 `actAdventure` 调 `ctx.addCrystal`。

## 排行榜

11 张榜，**每天 14:00 结算**（`boardDayKey = dayKey(ts-14h)`），行 `date` = 账期开始日、行内带 `start`
（三道闸门保证从 14:00 起算，`BOARD_VERSION=3`）。打理王是**当前值不是累计**（`farmMaxBonus` 与峰值取大）。
`bump` 累加 / `bumpMax` 留峰值；settled 冻结；前三名递减、并列都发。玩家获奖同时写时报；名次用 `entry.rank`；
庆祝层 z-index 195（弹窗 130 上、toast 200 下）。展示顺序：实时在上、昨日在下；`rewardText()` 与发奖文案同源。
⚠️ 埋点矩阵见 `docs/06-领域层.md`，加互动逻辑逐格对照。

## 村镇联机

一个村镇 = 一个房间（配置存 localStorage）。四层 link → protocol → peers → village UI。
**真人 ≠ NPC**：`state.peers` 只在内存。硬前提 https/localhost + 两端能上外网。
真人农场可动手（`peer-actions` 主人权威）；送礼走 `peer-gift` 三段握手。入口是底部中间「村镇」按钮。
安全：丢 >48KB 报文、`cleanText()` 按码点截断、`isItemKey` 用 `hasOwnProperty`。
`.village-status` 类挂容器、`statusView()` 只返文字。

## 其它

- 时报 7 天 / 80 条；农场日志与邻居动态纯 7 天、**不设条数上限**（`trimLog`）。
- 签到：`signDays` 唯一数据源、`streakOf(now)` 现算、`signStreak` 只是缓存；连签按自然日；
  自动签到挂开机 + 跨 0 点。改玩法记得同步游戏手册 `subpages/manual.js`。
- PWA：`sw.js` **网络优先**（只有图标/manifest 缓存优先，别改回 cache-first）；改图标要同步
  manifest / index.html / `VERSION`；开发用 `?nosw`。`requestAnimationFrame` 在 headless 里慢，
  但 `setTimeout(0)` 更慢（夹到 4ms）。
