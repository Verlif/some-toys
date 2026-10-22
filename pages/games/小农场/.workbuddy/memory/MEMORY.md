# 项目长期约定 · 文字版阳光牧场

纯前端（原生 ESM、零构建、`node server.mjs`），存档 IndexedDB（`sun_farm_v2`），无后端。
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
新字段在 `normalizePlot`/`normalizeNpc`/`normalizePlayerFarm` 里给旧档补。

## 数值

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
  起点 `round((性格A+性格B)/2)`（玩家 0 → 热心 +38、贪心 −22）；打理 +1、偷 `max(1,等级/3)`、
  送 `max(1,等级/2)`；`stealWeightFor` 1.2−rel/200、`helpWeightFor` 1+rel/200、
  `giftChanceFor` <60 为 0 最高 0.3。**权重只决定挑谁，不决定做不做**。

## UI 硬约束

- 浮层统一：上滑进场、下拉关闭（`ui/drag-close.js` >8px 接管、>72px 关闭）、最大宽 640px。
- **拖拽三条铁律**：① `move()` 先查 `tracking` ② 鼠标 move/up 只在按下期间挂 ③ Touch + preventDefault。
- **弹窗**：`openModal()` 把 `.modal-head` 提到 `.modal-body` 前标题才拖得动；关闭图标统一补；从标题/
  把手起手忽略「内容已滚动」。**支持叠层**（整卡快照压栈，close 还原 scrollTop）。
- 地块 = `.plot-main`(flex:1)+`.plot-side`(34px)；列数 手机2/≥720 3/≥960 4；高 152/紧凑 126（图标 47/38px）；
  成熟摇定 `plot.pendingYield`。**`.plot-side` ≤4 按钮**（水/虫/肥/铲）：`4×29+3×3=125≤128`，
  加第 5 个前先重算，`overflow:hidden` 会静默裁掉；铲除用 `.icon-btn.danger`。
- **土地底纹** `soilbg-<id>` 用 `::before` 叠渐变，**不能改 `background`**（状态类各有背景），颜色只声明
  `--soil-tint`。`.npc-plot` 底色/边框/底纹与 `.plot` 一致，状态类只改边框。
- 商店横滚在 `.shop-panel` 自己；筛选条在 `.shop-panels` 之外；重绘先恢复 `scrollLeft` 再同步 tab。
- **记录只有一种长相** `ui/records.js` 的 `recordItemsHTML`：农场日志 / 邻居弹窗 / 邻居卡片 /
  **时报**同一套 `.log-item`，差异只剩 `withDay / limit / compact / relative`。别再为「展示记录」写第二套标记。
  容器层面的差异（时报是白底面板）归外层。
- **行内标签** `ui/inline-tags.js` 的 `inlineTagsHTML`：一次正则同时处理人名（`.who-tag`，人绿）
  与作物名（`.crop-tag`，物黄）。全文匹配、长名优先、同长度人优先、吃掉两侧空格；
  **作物标签连前面的 emoji 一起吃**；文案必须用真实 `${farm.name}`。
  两者都是入口（`data-action="open-farm"` / `"crop-detail"`），由 `ui/inline-actions.js`
  **在 document 上统一委托** —— 新地方渲染出标签就自动可点，视图不用绑事件。
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
`catchChance(rate,sat)=rate×(0.5+0.5×sat/100)`。被抓住按 `crop.sell×5` 罚给被偷者（钱不够倾家荡产）。
偷邻居被逮住 `emit(EVENTS.DOG_CAUGHT,…)` → `ui/dog-caught.js` 全屏闪狗（**不复用 #modal**）。

## 邻居与世界

- 邻居同用 `unlockedPlotCount(level)`；地块按 `rollNpcSoil(level)` 随机，收成吃 `yieldMul`。
- 偷菜每块每轮一次，`stealable()` 要带 `!plot.guarded`；`needsWater/needsPest` 统一从 `data/care.js` 转出，
  必须带 `now < readyAt`（成熟后不再冒按钮）。
- 邻居动作表含 `care`（帮谁看 `helpWeightFor`，玩家/邻居一视同仁）与 `gift`（真东西进玩家背包）；
  `simCtx()` 注入 `rel / relAdjust / receiveGift`，`npc-sim.js` 仍不 import 任何 store。
- NPC 模拟纯计算，落盘 `persistFriends()` 一次提交；远期聚合、近期 7 天逐条；在线时拆动作串演出，
  游标先推进、一步一落盘。`PLAYER_FARM_WEIGHT = 2`。

## 其它

- 时报 7 天/80 条、日志 7 天/60 条，按 `at` 倒序。施肥额度唯一（`plot.fert`），增产与捉虫相乘。
- **时报条目** `{at, emoji, text, who[], crop, cat}`：`crop` 有值时图标换成该作物且可点；
  `cat`（level/steal/dog/adventure）是筛选依据，不传按图标兜底 —— **图标被换掉时必须显式传**。
  冒险挖到限定种子单独上一条（`store/adventure.js` 的 `announceReward`）。
  旧档无 crop/cat 走兜底；`storage.js` 读写两处都要带上这两个字段。
- 图鉴靠标本点亮（一份 50 个产出）；动作属性必须写在 `class` 之外。
- 称号 38 个，手动领、只戴一个、奖励只有道具；**分三类 tab**（吸顶），tab 状态挂模块变量 + 切后 `scrollTop=0`。
- 引导 17 项，每个 key 要有真实调用点。背包展示名走 `itemLabel(id)`。
- 签到不发经验；历史存 `progress.signDays`（90 天）。「其他」已删加工坊/交易行，改放种子制造间。
- **日历空位按「当月 1 号」周几算**（拿今天算会整月平移：21 号跑周二、🎁 跑周五）；下半格只放
  ✓/🎁；读档把 `lastSign` 那天补进 `signDays`。

## 护栏与踩坑

`npm run check` 盲区：抓不到私有函数丢失 → **删/搬函数后必须 `grep -rn` 搜全调用点**。
e2e（真实 Chrome，脚本不入库）：等 `body[data-page]`；**全屏 `.sign-celebrate` 会吞点击**；
跨页选择器要限定活动页；返回 `#subBack`、关模态 `[data-close]`、toast 容器是 `#toasts`。
