# 项目长期约定 · 西米的农场

纯前端（原生 ESM、零构建、`node server.mjs`），存档 IndexedDB（`sun_farm_v2`），无后端。
游戏正式更名《西米的农场》（原名「阳光牧场 · 文字版」），但 DB_NAME/localStorage key/APP_NAME 保持 sun_farm* 不变（存档兼容）。
局域网联机走 WebRTC P2P（`vendor/webconnect.js`）。220 作物 / 40 块地 / 8 档土地 / 32 位邻居。

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
  工本费 `round(种子价/2)`（第 34 轮改，原来是市价折算+全价工本费）。升级看**造过的种类数**。
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
- **好感度**：−200~200，打理 +1、偷菜成功 0、被逮 `dogCaughtRelLoss(售价)=max(1,round(售价/10))`、
  送 `max(1,等级/2)`。**亲近档 ≥100**：NPC 优先打理 ≥100，`closeGiftChanceFor`（100→0.25，200→0.55）
  ×性格系数送礼；<100 `giftChanceFor` 封顶 0.5。概率第 36 轮整体上调约 1.5~2 倍。
- **土地逐级晋升**：`nextSoilId`，`upgradeSoil` 拦跳级。效果：yieldMul/timeMul/expMul 三处生效。
- **仓库卖出**：`.qty` 步进器，默认全量。列表图鉴标记 `.codex-mark` **只在点亮时渲染**（第 32 轮）。

## UI 硬约束

- 浮层统一：上滑进场、下拉关闭（`drag-close.js`）。**拖拽三条铁律**：①move 先查 tracking ②鼠标事件只在按下期间挂 ③Touch+preventDefault。
- **弹窗四段式**：handle/head/body/foot。别用 sticky 代替 foot。支持叠层。
- 地块 `.plot-main`+`.plot-side`(34px)；`.plot-side` ≤4 按钮。锁定地块 `.plot-lock` 空占位盒(47/38px)。
- **土地底纹** `soilbg-<id>` 用 `::before` 叠渐变，**不能改 `background`**，只声明 `--soil-tint`（135deg，alpha .52~.66）。
- **横滚芯片条接力** `ui/scroll-keep.js` 的 `keepBarScroll(root, sel, render)`：friends/news/shop 三处。
- **图鉴**：卡片只有图标+名称；三档筛选；点得开 = `unlocked||collected`；收集≠点亮。
  **双重进度条**（第 34 轮）：两条重叠同基线，下层绿=已收集(10px)，上层金=已点亮(5px)。
- **邻居页**筛选与排序两条独立状态；筛选只认点击（滑动手势已删）。
- **记录只有一种长相** `recordItemsHTML`；行内标签 `inlineTagsHTML`（人名+作物名一次正则）。
- **作物详情只有一个弹窗** `openCropModal`；**邻居农场弹窗只有一个** `openFriendModal`。
- **农场日志双 tab**：「我的操作」= `!entry.by`，「邻居动向」= `entry.by`。tab 在面板底部。
- **送礼三层**：清单→确认框→发送。赠礼层 `ui/gift.js` 不做 opacity 动画。

## 守护犬

10 档（比熊 20%→龙犬 80%），只有一只能上岗。`catchChance(rate,sat)=rate×(0.5+0.5×sat/100)`。
被抓住按 `crop.sell×5` 罚款 + 掉好感 `max(1,round(售价/10))`。
⚠️ 饱腹度是「基准值 + 基准时刻 `dog.at`」两件套，`dogSatietyAt()` **只认 `at`**。
写存量时必须 `dog.satiety = 新值; dog.at = now;` 成对写，只写 satiety 会把
「从上次结算到现在」的衰减重算一遍，喂了等于没喂（NPC/联机喂狗粮踩过，
当时错写成了不存在的 `fedAt`）。满槽（≥99）要拒收并退回狗粮，别白花一份。

## 邻居与世界

- 邻居同用 `unlockedPlotCount`；偷菜 `stealable()` 要 `!plot.guarded`。
- NPC 模拟纯计算，`simCtx()` 注入 rel/receiveGift/daily，npc-sim 不 import store。
- **NPC 概率**（第 36 轮上调约 1.5~2 倍）：喂狗 `min(0.95, tend×0.40)`、打理 `min(0.85, tend×0.22)`、
  偷菜 `{rare:0.18, often:0.65, always:0.95}`、冒险 0.20。NPC→玩家动作逻辑一直都有。

## 村镇联机

- 一个村镇=一个房间，配置 localStorage。四层：link→protocol→peers→village UI。
- **真人 ≠ NPC**：`state.peers` 只在内存。两个硬前提：https/localhost + 两端能上外网。
- **真人农场可动手**：`peer-actions.js` 的 act/act:res/act:pay，主人权威。
- **入口**：底部 tab「村镇」进村后才出现。浮窗 `village-sheet.js` 用**通用 `.sheet-panel`**（第 34 轮），
  挂 `dragToClose`，与「更多」「农场日志」同一套下拉关闭手势。
- **玩家送礼**：`peer-gift.js` 三段握手，送方先扣货，收方 ack 才入包。
- 安全：丢 >48KB 报文、`cleanText()` 按码点截断、`isItemKey` 用 `hasOwnProperty`。

## 其它

- 时报 7 天/80 条、日志 7 天/60 条。时报条目 `{at, emoji, text, crop, cat}`。
- 称号 38 个分三类 tab；引导 17 项；签到不发经验，历史 90 天。
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
- **游戏手册**（`subpages/manual.js`）：「更多→📘 手册」，float:left 图标网格（25% 宽），
  点图标弹 `openModal` 详情（平铺 `.manual-list`）。12 个分类。
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
