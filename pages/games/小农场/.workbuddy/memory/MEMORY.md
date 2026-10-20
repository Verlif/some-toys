# 项目长期约定 · 文字版阳光牧场

参考 3G 时代腾讯网页《阳光牧场》。纯前端，存档在 IndexedDB，无后端。
玩法：145 种作物、40 块地、8 档土地、32 位会自动成长的邻居。

## 工程约定（用户已确认）

- **零构建**：原生 ESM，`node server.mjs` 起静态服务，`package.json` 无 dependencies
- **不做测试**（用户明确）：改动后只跑 `npm run check`；一次性验证脚本跑完即弃、不入库
- **分层单向依赖** `ui → store → core`，`data` 谁都能读
  - core 只碰浏览器，不认识游戏概念
  - store 是唯一改状态的地方，纯业务逻辑，**禁止任何 DOM 符号**
  - store 提示玩家走 `store/notify.js` → 事件总线 → `ui/toast.js`
  - ui 只读 state、渲染、把点击转给 store，不保存业务状态
- **数据驱动**：作物/土地/地块/经验/称号由 `tools/gen-data.mjs` 产出。
  调平衡只改生成器，不手改 `src/data/{crops,soils,progression}.js`（文件头有「勿手改」）
- **单次业务操作的多表改动必须同一个 IndexedDB 事务**（`storage.commit()`，见「存档结构」）
- **不用后台定时器推进世界状态**；需要「到点自然恢复」用时间戳判定（如 `stolenAt`）
- 代码风格：中文注释 + JSDoc；只做精简优化，主动清理死代码与没人用的 export
- `node --check` 依赖 package.json 的 `"type": "module"` 才能解析 ESM

## 存档结构（第 17 轮重构，库名 `sun_farm_v2`）

**状态的基本单位是「农场」**，玩家和邻居是同一形状：

```js
state = {
  farm:    玩家农场（含 plots / log / dog / progress）,
  friends: 32 座邻居农场（同形状，dog 里没有 owned）,
  bag:     { itemId: count },
  news:    [{ at, emoji, text, farmId }],
}
```

五张表，**没有任何「只有一条记录」的表**：

| 表 | keyPath | 说明 |
| --- | --- | --- |
| `farm` | `id` | 每座农场一行：经济 / dog / progress（玩家）+ 性格日程（邻居） |
| `plot` | `[farmId, id]` | 所有农场的地块 |
| `log` | `[farmId, seq]` | 所有农场的日志，seq 0 = 最新 |
| `news` | `seq` | 全镇时报，farmId 只标来源 |
| `inventory` | `itemId` | 玩家背包 |

`plots` / `log` 只在内存里挂在农场上，写档时拆回子表：

```js
await commit({ farms: [state.farm, friend], bag: state.bag, news: state.news });
// farms 里每座农场 = 行 + 全部地块 + 整段日志（先按 [farmId,0]~[farmId,1e9] 删再重写）
```

坑：复合主键**每一段都必须有值**。新建邻居地块漏了 `id` 就报
`DataError: key path did not yield a value`（`generateNpcPlots` 已补 id）。
`initState()` 每次启动都会把补齐结果整体写回一次，这是有意的。

## 数值平衡

经验曲线**累加、与作物/土地完全解耦**（第 14 轮用户指定）：

```
expForLevel(n) = 100 × n × (n+1)   // Lv1→2 要 200，满级累计 2.67 亿
```

`expForLevel(200)` 返回 `Infinity`，按等级折算一律走 `expForProgress()`。
经验只看产出：每份 = `作物等级 + 2`，再乘土地 `expMul`。
刻意保留的非对称：成熟时间允许非单调（风味调制），但相邻不得差出一倍（生成器断言）。

## 经济与冒险

- **售价不是自由变量**：`整轮收益 = (种子价×1.2 + 等级×10) × (1 + 0.05×整轮小时)`，
  单价 = 整轮收益 ÷ 总产量。改经济只改这条公式或 `seedPrice`。风味/分类不乘价值系数
- 单价与整轮收入都不强制单调；唯一该比的指标是「每小时金币」
- 时长倍率刻意不封顶（用户决定）：后期想降速只能调小那个 5%
- **藏宝图**：限定种子上限 = 需求等级+10，商店种子 = 需求等级×2（`MAP_TIERS.shopSeedCap`，UI 也读）
- 奖励构成 金币2 : 商店种子4 : 道具1；带奖励的牌占三成（`REWARD_CARD_RATIO`）。
  改牌数只改「每份多肥」，不改总产出 —— 真降要动 `POOL_VALUE_RATIO`
- **特殊作物**（`special: true`）不进商店、不进 `cropsNearLevel`，只能藏宝图挖；有种就能越级种
- **冒险是第 4 层页面**：`#adventure` z-index 105，必须低于模态弹窗 130（退出确认用 openModal）；
  奖励即时落盘，牌堆只存内存
- 卡牌手势 Touch+鼠标双通道，`touch-action: none`，阈值用绝对像素；结算后清 `dragging/offset`

## UI 规范

- **三个浮层**（底部浮窗/子页面/模态弹窗）共用一套：底部上滑、下拉关闭、
  最大宽 640px 居中、`24px 24px 0 0` 圆角、顶部 `.sheet-handle`
- **下拉关闭**统一 `ui/drag-close.js`：只有向下拖且超 8px 才接管，
  `scrollArea.scrollTop > 0` 不接管，位移 > 72px 关闭
- **拖拽三条铁律**：① `move()` 必须检查 `tracking`（否则 window 的 mousemove 先于 mousedown 触发，
  startY=0，绝对 Y 被当位移，弹窗瞬间被甩飞）② 鼠标 move/up 只在按下期间挂载，松手立刻移除
  ③ 用 **Touch 事件 + preventDefault**，不要 Pointer（`touch-action: pan-y` 下浏览器接管纵向手势、
  忽略 preventDefault，会收到 pointercancel）。CSS：把手/标题栏 `touch-action: none`，滚动容器 `pan-y`
- **商店筛选条必须放在 `.shop-panels` 之外**（`.shop-panels` 有 `overflow-x:auto`，内部 sticky 会随横滚被带走）
- **顶栏详情 absolute 定位**，盖在内容之上，绝不可进入布局流挤压土地区域
- **卡片高度对齐**：`flex-direction: column` + 按钮 `margin-top: auto`
- **未解锁地块最多画 1 个**，其余折叠成 `.plot-fold` 汇总行
- 地块角标 `.plot-corner` / `.np-corner` 绝对定位不占流。⚠️ 是 `np-corner` 不是 `npc-corner`
- `.meta-tag` 修饰类**不要用 `cycle`**（签到卡片占用全局 `.cycle`）；标签高度写死 18px，
  避免 emoji 回退字体撑行高；种子标签分档统一走 `ui/meta-tags.js`
- 顶栏/导航**不用渐变、不用毛玻璃**（纯色更耐看，也不会透出灰色像阴影）
- 商店是固定高度页：`#page-shop` 上贴 `--hud-h` 下贴 `--tab-h`，纵向滚动落在 `.shop-panel` 自己；
  新 tab 必须是 `.shop-panel[data-panel]`，否则退回「共用一个滚动条」
- **商店重绘顺序是硬约束**：先 `nextPanels.scrollLeft = keepLeft`，**再** `syncTabFromScroll`。
  反过来 sync 读到的 `scrollLeft = 0` 会把 activeTab 误判成第一个。面板 key 用局部 `tabAtRender`
- **`filterHTML()` 必须无条件渲染**：内部已用 `hidden` 控显隐，`switchTab()` 靠 `filter.hidden`。
  模板里写 `${activeTab==='seed' ? filterHTML() : ''}` 会在别的 tab 重绘时把筛选条从 DOM 删掉
- 跳转带 tab：`EVENTS.NAVIGATE` payload 可为 `{ page, tab }`，`activatePage` 对 shop 调 `setShopTab(tab)`

## 弹窗与邻居

- **弹窗内操作绝不整窗重开**：只替换受影响的那一格（`data-slot`）与角标/提示/日志区，
  否则滚动位置被冲回顶部。日志区固定 `max-height` 自己滚
- **成熟的地不再需要照料**：`needsWater`/`needsPest` 必须带 `now < readyAt`，farm 与 social 两边一致
- **偷菜只减 1 个**：按 `stolenCount` 扣产量；每块每轮最多被顺 1 次
- **邻居有日程模型**：`schedule`（固定钟点/随机间隔）+ `steal` 四档倾向 + `profession`。
  新增 NPC 只在 `NPCS` 加一条，`initState` 按 id 差集补建（孤儿农场由 `dropFarms()` 清掉）。名单不写 level/coins，
  `createNpc` 现掷 1~56（低等级更多），成长上限 56
- **NPC 动玩家农场**通过传给 `simulateNpcUntil` 的 `farm` 对象（plots/计数/log 回调），
  npc-sim 不认识 store；落盘由 `persistFriends()` 一次提交「玩家农场 + 全部邻居农场」
- 玩家日志：7 天 / 60 条上限，展示按 `at` 倒序（邻居补写的是过去时间）
- **NPC 模拟是纯计算**：不碰存储、不碰 DOM，只把 NPC 从旧状态推到新状态。
  远期离线走聚合公式、近期 7 天逐条精细模拟 —— 改动时不要破坏这个分层
- `store/state.js` 的 `normalizePlot`/`normalizeNpc` 给旧存档补字段；新增字段必须在这里补

## 守护犬三层模型

- **品种**（`data/dogs.js` `DOG_BREEDS`，10 个 tier1~10）：田园犬 20% → 龙犬 80%。
  玩家初始送最低档，其余只能冒险获得（`DOG_TIER_BY_MAP` 定上限、`DOG_REWARD_CHANCE` 定概率、
  已收集的不再给、狗奖励 `value: 0` 不折算金币）
- **上岗** `farm.dog.breed`：同时只有一只，也可一只都不上岗（空串 = 完全不设防）。
  点已上岗的 = 全部下岗。换狗前必须 `settleSatiety()` 把存量写回基准
- **狗粮槽** `farm.dog.satiety`：**全窝共享一份**，喂一次所有狗受益；只在有狗上岗时按
  `DOG_SATIETY_DECAY = 6.25`/小时消耗
- 实际拦截率 `catchChance(rate, sat) = rate × (0.5 + 0.5×sat/100)`；离线结算传
  `farm.dogGuardChanceAt(at)` 还原那一刻的概率
- 玩家与邻居**共用** `data/dogs.js` 的 `dogSatietyAt(dog, at)`（原 `npcDogSatietyAt` 已并入），
  结构都是 `{ breed, satiety, at }`，玩家多一个 `owned`
- NPC 狗品阶上限 `min(8, max(3, 3 + lv/12))`，**下限钉在 3 是刻意的**（太弱则「被抓住封锁全场」形同虚设）
- 领域层在 `store/dogs.js`，品种与 NPC 狗分配在 `data/dogs.js`

## 其它系统速记

- **时报** `store/news.js` 写 `state.news`（7 天/80 条，落 `news` 表）。里程碑直接 `addNews`；
  邻居故事由 `simulateNpc` 的 `farm.news` 回调补过去时间点，内部按 `at` 倒序重排后截断
- **一键道具** `sprinkler`/`pesticide`（各 200），`ITEMS[].all = 'water'|'pest'`；
  玩家农场出 `#farmTools`，NPC 弹窗出 `.npc-quick`
- **农场页底部条与道具无关**：`.farm-dog-row`（品种+拦截率+饱腹条）常驻，不能因没道具整条隐藏
- **日志按钮的底距按实测高度抬**：`renderFarmTools()` 把 `el.offsetHeight + 8` 写进
  `--farm-tools-h`（CSS 兜底 `0px`），`.log-fab` 用
  `calc(74px + env(safe-area-inset-bottom) + var(--farm-tools-h))`。
  ⚠️ 旧做法 `body.has-farm-tools` 只在有工具按钮时才抬、且写死 158px ——
  没道具时只有狗那一行，日志按钮正好被狗牌压住（两者都水平居中、同一底距）
- **农场页 `.app` 的底距也吃 `--farm-tools-h`**：
  `calc(118px + env(...) + var(--farm-tools-h))`（74 导航 + 34 日志 + 10 余量），
  否则滚到底时最后一排地块 / 折叠行被工具条压住
- **施肥额度唯一**：普通化肥/增产剂/有机化肥共用 `plot.fert`，一轮只能施一次；
  增产记 `plot.yieldBonus`，收获时与捉虫加成**相乘**。老存档 `plot.organic` 读档并入 `fert`
- **图鉴靠标本点亮**：`state.farm.progress.specimens = { cropId: true }`，一份标本 50 个产出；
  `codexEntries().lit` 是「有标本」而不是「收获过」；库存不够/已做过不显示按钮
- **称号全手动领取**：33 个（26 等级+7 图鉴），数据由生成器产出（`progression.js` 的 `TITLES`）；
  `state.farm.progress.titles = { claimed:{}, equipped }`，同时只戴一个。
  ⚠️ `titleOf(level)` 已删，改用 `titleById(id)`/`titleAt(type, value)`
- **签到不发经验**：每天 = 普通化肥(30分) + 随机商店种子 + 少量金币；
  **周六大奖日**（`isBigDay`）额外从该等级最高档藏宝图奖励池抽一份
- **已知历史包袱（刻意保留）**：玩家里杂草/害虫永不出现；「初次丰收」成就用 `等级 ≥ 2` 代理判定

## 世界在线持续推进

- `npc-sim.simulateNpcUntil(npc, npcs, now, farm, onVisit)` 逐条跑会话，
  回调 `(at, entries, delta)`，`delta` 是这次上线对玩家农场的影响
- `social.settleWorld(onProgress)` 单例 Promise 去重，**分帧**推进（每帧 12ms + rAF）；
  `visits.length > 0` 才落盘
- `social.pollOnline()` 按 `v.at >= sessionStart` 分进两个**暂存桶**
  （`pendingOffline`/`pendingArrivals`），UI 用 `takeOfflineSummary()`/`takeArrivals()`
  **取走式消费**，取过即清，避免「谁先轮询谁先拿到」的竞态
- 分层红线：store 只算数据，**提示由 UI 发**（`friends.js` 的 `showToast`）
- `main.js` 每 60s 轮询（`document.hidden` 跳过），`visibilitychange` 切回立刻查；
  boot 首轮只补离线、不弹上线提示

## 在线演出（第 17 轮）

玩家在线时邻居上线**不瞬完成**：一趟上线拆成动作串，每步隔 `LIVE_STEP_MS = [3000, 7000]`。

- `npc-sim` 拆成 `planVisit(npc)`（纯数据）/ `beginVisit(npc, at)`（结算狗+推游标）/ `runStep(...)`
- `simulateNpcUntil(..., deferFrom)` 遇到 `at >= sessionStart` 的上线**只推进游标**，
  回调 `deferred: true`，由 `social.js` 的 `liveQueue` 串行演出
- **一步一落盘**（玩家农场 + 该邻居 + 时报），队列串行、游标先推进（否则下一轮重演）
- 邻居动作的 toast 由 store 的 `notify()` 发；「谁上线了」仍由 UI 发

## 邻居规模与偷菜危机感

- 32 位邻居（原 20）。**光加人不会更危险**：偷菜先挑农场再挑地块，
  加人只会稀释玩家被偷的概率；所以玩家农场权重 `PLAYER_FARM_WEIGHT = 2`，
  32 位时对玩家的偷窃量约为 20 位的 2.4 倍
- 实测 32 位、离线 7 天：743 次会话 / 12ms（分两段结算，离线时长几乎不影响耗时）

## `npm run check`（9 项静态护栏，均经反向用例验证）

- `data-action="x"` 必须在 `actions:{}` 或 `*_ACTIONS = {}` 有同名键，或 `=== 'x'` 显式分支。
  用 `delegate(root,'click','[data-action="x"]',fn)` 把动作名写进选择器的形式**扫不到**，
  必须补 `const XXX_ACTIONS = { x: fn }`
- `byId('x')` 的 id 必须在 index.html 存在
- 作物引用的生长阶段必须在 `data/stages.js` 的 `STAGES` 定义过
- 运行时写入的 CSS 变量必须在 CSS 有兜底声明（如 `--hud-h`）
- `import * as ns` 后的 `ns.foo()`，foo 必须真被导出。查调用点：
  `node -e "import('./src/store/player.js').then(m=>console.log(Object.keys(m)))"`

**已知盲区**：抓不到「本文件私有函数/常量丢失」（`node --check` 只查语法，
具名导入只覆盖跨模块绑定）。第 16 轮因此丢过 `social.js` 的 `logFriend()`。
**删除或搬走任何函数后必须 `grep -rn "\b函数名\b" src/` 全量搜调用点**。
从 `store/` 迁走函数后，老 e2e 脚本里的旧导入路径会静默变 `undefined`。

## e2e（真实 Chrome，脚本不入库）

托管 node 工作区借用已有 `puppeteer-core`，详见 `docs/11-端到端校验.md`。实测的坑：

1. **切页必须等 `body[data-page]` 落地** —— 各页启动时就渲染过，
   只等「元素存在」会瞬间通过，点到隐藏页里 0×0 的元素
2. **邻居页进入有 ≥650ms 离线结算浮层**（`#simOverlay`），点击会被吞
3. **所有浮层有 0.25~0.3s 位移动画**：等元素及祖先 `getAnimations()` 全 finished 再点
4. **商店切 tab 是 smooth 滚动（约 1s）**：轮询 `.shop-panels` 的 `scrollLeft` 到连续两次相同
5. `el?.click() || fallback.click()` **会两个都点**（`?.click()` 返回 undefined），
   必须 `const t = a || b; t?.click()`
6. 验证滚动位置先确认面板真可滚（`scrollHeight - clientHeight > 100`），
   再手动 `scrollTop = row.offsetTop - 200` 滚到中间，否则恒为 0 测不出
7. 商店「现在能种」默认只有 3 行；测种子面板先切「全部」并拉高 `player.level`
8. 断言别写死基础率（还要乘饱腹系数）；概率断言要么重复到成立，要么确定性注入
