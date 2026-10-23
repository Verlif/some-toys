# 项目长期约定 · 文字版阳光牧场

纯前端（原生 ESM、零构建、`node server.mjs`），存档 IndexedDB（`sun_farm_v2`），无后端。
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
- **每日排行榜**（`store/daily.js`）：`state.dailyRows` 一天一行，表 `daily` 留 8 天。11 张榜。
  `bump(actor, metric, n, at)` 按 `dayKey(at)` 记账；settled 冻结；bulkAdvance 不进榜。
  结算 `checkRollover()`：启动+每分钟 tick+visibilitychange。前三名递减、并列都发，金币 100/50/30。
  ⚠️ 结算 `persistNow(true)` 连 farm/bag/news 一起写。UI `ui/subpages/rank.js`。
- **好感度**：−200~200，打理 +1、偷菜成功 0、被逮 `dogCaughtRelLoss(售价)=max(1,round(售价/10))`、
  送 `max(1,等级/2)`。**亲近档 ≥100**：NPC 优先打理 ≥100，送礼按 `closeGiftChanceFor×性格系数`。
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

## 邻居与世界

- 邻居同用 `unlockedPlotCount`；偷菜 `stealable()` 要 `!plot.guarded`。
- NPC 模拟纯计算，`simCtx()` 注入 rel/receiveGift/daily，npc-sim 不 import store。
- **NPC 喂狗** `min(0.85, tend×0.28)`；NPC→玩家动作逻辑一直都有（被 60 条日志上限冲掉，已分 tab）。

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
- **PWA**（第 35 轮）：manifest.json + sw.js（cache-first）+ icons/（192/512 PNG + SVG）。
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
