# 项目长期记忆：地点距离绘制

## 架构
- 纯静态多文件页面：`index.html` + `js/{config,renderer,storage,export-image,theme,editor,main}.js` + `css/{theme,layout,map,responsive}.css`。
- **渲染层已由 SVG 改为 Canvas 2D**（`js/renderer.js`）。画布 `#map` 是 `<canvas>`，不再是 `<svg>`。
  - `paint()` → `drawGrid / drawEdges / drawPlaces`；世界坐标经 `ctx.setTransform(dpr*scale, …, dpr*tx, dpr*ty)` 映射。
  - 缩放走"快照"方案：`zoomPreview()` 首帧把当前画布拷进离屏 canvas，手势期间只 `drawImage` 缩放该位图；
    停止滚动 50ms 后 `finishZoom()` → `render()` 回到清晰的矢量重绘。
  - 几何常量：地点底盘 **r=12**、图标字号 14、名称字号 10 且基线 **y=27**。
    彩色外框厚度 `ring` = 5（普通）/ 5.5（相邻）/ 6（选中或待连线），**外沿 = 底盘半径 + ring 厚度**
    （`arc(0,0,disc+ring/2)`）→ 外沿 17/17.5/18。这个公式保证外框永远贴住底盘外沿，缩小底盘时边框自动跟着收、不会露缝 —— 
    **要改大小只需改 `disc` 一个数**，不要再回到"外沿钉死 + 反推半径"的写法（那样改底盘就会露缝）。
    **名称基线必须与 `disc`/`ring` 联动**：口径是"图标区外沿(r = disc+ring)下缘再留 2px，再加 10px 字的顶边偏移 7.5"，
    即 `baseline ≈ disc + ring + 9.5`（disc=12,ring=5 → 27）。只缩图标不动名称，文字和图标之间会明显拉开一段空。
    该口径与"下一格地点图标"无关：往上移只会**减少**与下一格的叠压，不要再用"往上会撞下一格"来阻止上移（曾据此写错过一次）。
  - 地点吸附间距 = `config.CELL_SIZE` = 44。
- 状态集中在 `editor.js` 的 `state`，`render()` 是唯一绘制出口；`storage.js` 负责 localStorage 版本化地图库（`…:library:v1`），支持多地图与旧格式迁移。
- 距离计算：跨点按网格直线 `Math.hypot(dx,dy)/CELL_SIZE * cellDistance`，`>=1000` 显示 km。
- **模式**：`state.mode` ∈ `place`（新增+拖动+双击开面板）/ `arrange`（只拖动+双击开面板，**不新增**）/ `connect` / `preview` / `delete`。
  工具带按钮由 `data-mode` 驱动，`setMode` 与高亮都通用；新增模式只需加按钮 + 补 `updateTip` 文案。
  "排列模式不新增"靠 pointerup 里 `addPlace` 分支只认 `place` 天然隔离，不要再多加判断。
- **地点颜色** = `place.color` = 画布上那圈彩色外框的 `strokeStyle`（即"边框色"）。在「编辑地点」面板用 `<input type="color" id="placeColor">` 改：
  `input` 事件实时预览走 `renderer.render(state,state.cellDistance)`（不落盘、不写撤回栈），`保存` 才提交并写一次撤回（先把颜色还原成
  `state.editingColor` 再 `remember()`），`取消`/`×`/`Esc` 由 `closeEditor` 回滚。新建地点仍由 `COLORS[(id-1)%len]` 自动分配。
- **Ctrl+C 复制地点**（`editor.js`：`bindShortcuts` / `duplicatePlace` / `findFreeSpot` / `copySource`）：
  复制源为编辑面板打开的地点，其次预览高亮的地点；副本沿用 icon/name/color，不连线，置于原地点最近的空吸附位
  （从正右起顺时针含对角，逐圈向外）；输入框内有选区时不劫持快捷键。

## 渲染性能（renderer.js）——两条"手势期间不要整屏重绘"的路线
- **缩放**：`zoomPreview()` 首帧把当前画布拷进离屏 canvas，手势期间只 `drawImage` 缩放该位图；停止滚动 50ms 后 `finishZoom()` 回填清晰重绘。
- **拖拽地点**：`beginDrag()` 在拖拽第一帧把"**除被拖地点及其连线之外**"的整幅画面烘进离屏 canvas（`paint` 的 `mask` 参数实现过滤），
  之后每帧 `movePlace()` 只 `drawImage` 1:1 贴回位图 + 补画被拖地点和它的连线（`{places:p=>p.id===id}` / `{edges:(a,b)=>a===id||b===id}`）。
  1:1 贴图不重采样，所以拖拽期间画面不模糊。
- `paint(ctx, state, mpc, view, mask)` 的 `mask = { places(place), edges(aId,bId) }`，null 表示全部。**导出 PNG / 缩略图路径不传 mask**。
- `movePlace()` 有"吸附格未变则直接返回"的短路 —— 拖拽时位置以 44px 为步长跳变，绝大多数帧不产生重绘。
- `render()` 里所有 DOM 写入都必须先比对再写（`setText` / `undo.disabled`），否则每帧写 textContent 会让下一帧的
  `ensureSize()` → `getBoundingClientRect()` 触发强制同步布局。
- **`dragLayer` 必须在任何改变视图或整体重绘处失效**（`render()` 与 `zoomPreview()` 开头都置 null），
  否则滚轮缩放后继续拖拽会贴回旧位图。
- 仍未处理：**拖动画布平移**（`applyView` → `render()`）仍是每帧整屏重绘，没有快照方案
  （位图方案需要比视口更大的离屏画布才能避免边缘空白）。

## 易踩的坑
- **地点样式有两处实现**：`renderer.js drawPlaces()`（画布 + 导出 PNG 共用）与 `export-image.js createPreview()`（删除确认弹窗的 SVG 缩略图）。改地点视觉必须两处同步。
- 图层顺序是 `state.places` 数组顺序，后画的压先画的；名称带 4px 纸色描边，压到邻近地点上会明显"糊"掉对方图标。
- **底部/浮动态的层级与遮挡**：`.topbar`(z5)、`.bottom`(z5)、`.floaters`(z7)、`.history-panel`(z7)。
  `.topbar` 故意**不做** `pointer-events:none`，整块区域吃掉点击，避免点顶部时穿透到 canvas 新增地点。
  **浮动按钮绝不要各自单独绝对定位**（会互相压住，且底部按钮排增行后会盖住上方按钮），
  一律放进一个 `.floaters` 之类容器里用 flex 排列，容器位置只在一处维护，移动端适配也只改容器。

## 用户偏好
- 组件化、Canvas 渲染、相同输入下确定性输出。
- 代码风格极简：单行多语句、少注释、不加冗余属性/样式。
- 交付前只做 `node --check` + jsdom 类静态校验，不跑运行时测试。
- 提需求时常一次给多条 UI/UX 修改点，并在发布任务时要求先复述需求并确认，再动手。
- **样式一致性口径**：不要"全局字号阶梯/全局标题统一"那套；要的是**同组元素的和谐**——
  挨在一起的一组（按钮组、控件带、同一张卡片内部）字号、padding、圆角、图标大小必须一致，
  不同上下文（独立按钮 vs 紧凑行内按钮、标题 vs 正文）允许差异。

## 设计令牌（layout.css）
- 圆角四档：`8` 小控件（`.tool`/`.zoom-box button`/`.history-action`/`.history-name-input`）、`10` 按钮（`.action`/顶栏控件/`.floaters > button`/`.fields input`/`.toast`）、`14` 卡片面板弹窗（`.legend`/`.actions`/`.stats`/`.history-panel`/`.place-editor`/`.confirm-dialog`/`.history-item`/`.confirm-preview`）、`999` 胶囊。
- 字号三档为主：`11px` 辅助字与按钮字、`12px` 正文（`.subtitle`/`.history-name`）、`13px` mono 数值（`.scale-box input`/`.stats b`/`#zoomLabel`）+ `13px` 正文段；`18px` 为图标字符档（`.zoom-box button`/`.theme-toggle`/`.floaters > button span`）。
- 顶栏控件带（`.scale-box`/`.tool-switch`/`.zoom-box`/`.theme-toggle`）**统一 44px 高**，改任一控件的高度都要重新核对这一组。
- 底部浮动态层级：`.topbar`(z5)、`.bottom`(z5)、`.floaters`(z7)、`.history-panel`(z7)；`.floaters` 每组高 84px（两个 38px 按钮 + 8px gap），
  `.history-panel` 的 bottom 必须 ≥ 浮动态 top + 14px（桌面 112+84+14=210，移动端 150+84+14=248）。
