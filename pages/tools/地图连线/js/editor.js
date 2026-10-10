/* =========================================================
   editor.js — 地图编辑器
   放置 / 连线 / 删除 三种模式，支持拖动、双击编辑、缩放、撤回、
   示例、导入导出与本地自动保存。
   暴露到：window.App.Editor
   ========================================================= */
(function (App) {
  'use strict';

  const { $, clamp, edgeKey, roadPath, placeScale, esc } = App.utils;
  const cfg = App.config;

  /* ---------- 编辑器状态 ---------- */
  const editor = {
    places: [],
    edges: [],
    mode: 'place',
    pending: null,
    history: [],
    nextId: 1
  };

  /* ---------- DOM 与视口 ---------- */
  let viewport;
  let edSvg, edWorld, edRoads, edPlaces, placeEditor, editingPlaceId = null;

  /* ---------- 指针 / 手势状态 ---------- */
  const edPointers = new Map();
  let edDragging = false, edDragStart = null, edPinch = null;
  let edPressState = null, edLongPressTimer = null, edMovingId = null;
  let edTapTimer = null, edTapInfo = null;

  /* =========================================================
     变换与坐标（委托给 Viewport）
     ========================================================= */
  function edResetView() {
    const rect = edSvg.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const availH = Math.max(h - 250, 200);
    const fit = Math.min(w / 1600, availH / 1100) * 0.85;
    const scale = clamp(fit, cfg.EDITOR_MIN_SCALE, cfg.EDITOR_MAX_SCALE);
    const tx = (w - 1600 * scale) / 2;
    const ty = (availH - 1100 * scale) / 2 + 20;
    viewport.set(scale, tx, ty);
  }

  /* =========================================================
     渲染
     ========================================================= */
  function edUpdateCount() {
    const p = editor.places.length;
    const e = editor.edges.length;
    const c = $('#edCount');
    if (c) c.textContent = `${p} 地点 · ${e} 道路`;
    const start = $('#edStart');
    if (start) start.disabled = !(p >= cfg.MIN_PLACES && e >= cfg.MIN_EDGES);
  }

  function renderEditor() {
    // 道路
    const edgeEls = editor.edges.map(([a, b]) => {
      const pa = editor.places.find(x => x.id === a);
      const pb = editor.places.find(x => x.id === b);
      if (!pa || !pb) return '';
      const d = roadPath(pa, pb);
      const k = edgeKey(a, b);
      const cls = (editor.mode === 'delete') ? 'road del-mode' : 'road';
      return `<g class="${cls}" data-key="${k}">
        <path class="road-outer" d="${d}"></path>
        <path class="road-inner" d="${d}"></path>
        <path class="road-dash" d="${d}"></path>
        <path class="road-hit" d="${d}"></path>
      </g>`;
    }).join('');
    edRoads.innerHTML = edgeEls;

    // 地点
    const placeEls = editor.places.map((p) => {
      const cls = ['edit-place'];
      if (editor.pending === p.id) cls.push('pending');
      if (p.id === editor.places[0]?.id) cls.push('first');
      return `<g class="${cls.join(' ')}" data-id="${p.id}" data-x="${p.x}" data-y="${p.y}" style="--c:${esc(p.color)}">
        <circle class="place-halo" r="34"></circle>
        <circle class="place-ring" r="22"></circle>
        <circle class="place-bg" r="19"></circle>
        <text class="place-icon" y="1">${esc(p.icon)}</text>
        <text class="place-name" y="48">${esc(p.name)}</text>
      </g>`;
    }).join('');
    edPlaces.innerHTML = placeEls;

    viewport.applyTransform();
    edUpdateCount();
    persist();
  }

  /* =========================================================
     命中测试
     ========================================================= */
  function placeHitTest(x, y) {
    const wpt = viewport.screenToWorld(x, y);
    let best = null, bestD = Infinity;
    for (const p of editor.places) {
      const d = Math.hypot(p.x - wpt.x, p.y - wpt.y);
      if (d < 26 && d < bestD) { best = p; bestD = d; }
    }
    return best;
  }

  /* =========================================================
     编辑操作
     ========================================================= */
  function setMode(mode) {
    editor.mode = mode;
    closePlaceEditor();
    // 清除可能残留的单击/双击延时状态，避免切换模式后误触发
    if (edTapTimer) { clearTimeout(edTapTimer); edTapTimer = null; }
    edTapInfo = null;
    document.querySelectorAll('.et-mode').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    updateTip();
  }

  function addPlace(x, y) {
    const p = { id: editor.nextId++, x, y, icon: '📍', name: '地点' + editor.nextId, color: '#9b8cff' };
    editor.places.push(p);
    pushHistory();
    renderEditor();
    openPlaceEditor(p.id);
  }

  function removePlace(id) {
    pushHistory();
    editor.places = editor.places.filter(p => p.id !== id);
    editor.edges = editor.edges.filter(([a, b]) => a !== id && b !== id);
    if (editor.pending === id) editor.pending = null;
    renderEditor();
  }

  function addEdge(a, b) {
    if (a === b) return;
    const k = edgeKey(a, b);
    if (editor.edges.some(([x, y]) => edgeKey(x, y) === k)) {
      flashTip('这两个地点已经相连');
      return;
    }
    editor.edges.push([a, b]);
    pushHistory();
    renderEditor();
  }

  function removeEdge(a, b) {
    const k = edgeKey(a, b);
    const before = editor.edges.length;
    editor.edges = editor.edges.filter(([x, y]) => edgeKey(x, y) !== k);
    if (editor.edges.length !== before) {
      pushHistory();
      renderEditor();
    }
  }

  function edClearAll() {
    if (!editor.places.length) return;
    pushHistory();
    editor.places = [];
    editor.edges = [];
    editor.pending = null;
    renderEditor();
  }

  function edLoadSample() {
    pushHistory();
    editor.places = cfg.SAMPLE_PLACES.map(p => ({ ...p }));
    editor.edges = cfg.SAMPLE_EDGES.map(e => [...e]);
    editor.nextId = Math.max(0, ...editor.places.map(p => p.id)) + 1;
    editor.pending = null;
    renderEditor();
    edResetView();
    flashTip('已加载示例地图');
  }

  /* ---------- 地点编辑弹框 ---------- */
  function openPlaceEditor(id) {
    const p = editor.places.find(x => x.id === id);
    if (!p) return;
    editingPlaceId = id;
    $('#peIcon').value = p.icon;
    $('#peName').value = p.name;
    placeEditor.classList.add('show');
  }
  function closePlaceEditor() {
    placeEditor.classList.remove('show');
    editingPlaceId = null;
  }
  function savePlaceEdit() {
    const p = editor.places.find(x => x.id === editingPlaceId);
    if (p) {
      const icon = $('#peIcon').value.trim() || '📍';
      const name = $('#peName').value.trim() || '地点';
      p.icon = icon;
      p.name = name;
      pushHistory();
      renderEditor();
    }
    closePlaceEditor();
  }
  function deletePlaceFromEditor() {
    if (editingPlaceId != null) removePlace(editingPlaceId);
    closePlaceEditor();
  }

  /* ---------- 提示条 ---------- */
  let tipTimer = null;
  function flashTip(msg) {
    const tip = $('#edTip');
    if (!tip) return;
    tip.textContent = msg;
    tip.classList.add('flash');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      tip.classList.remove('flash');
      updateTip();
    }, 1600);
  }
  function updateTip() {
    const tip = $('#edTip');
    if (!tip) return;
    if (tip.classList.contains('flash')) return;
    const tips = {
      place: '点击空白处放置地点 · 双击编辑 · 长按拖动',
      road: editor.pending
        ? '点击另一个地点完成连接 · 再次点击起点取消'
        : '先点一个地点作为起点',
      delete: '点击地点或道路即可删除'
    };
    tip.textContent = tips[editor.mode] || '';
  }

  /* =========================================================
     历史（撤回）
     ========================================================= */
  function state() {
    return {
      places: editor.places.map(p => ({ ...p })),
      edges: editor.edges.map(e => [...e]),
      nextId: editor.nextId
    };
  }
  function pushHistory() {
    editor.history.push(state());
    if (editor.history.length > cfg.HISTORY_LIMIT) editor.history.shift();
  }
  function edUndo() {
    if (!editor.history.length) { flashTip('没有可撤回的操作'); return; }
    const s = editor.history.pop();
    editor.places = s.places;
    editor.edges = s.edges;
    editor.nextId = s.nextId;
    if (editor.pending && !editor.places.some(p => p.id === editor.pending)) {
      editor.pending = null;
    }
    renderEditor();
  }

  /* =========================================================
     手势：指针 / 滚轮 / 双击
     ========================================================= */
  function edPointerDown(e) {
    edPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { edSvg.setPointerCapture(e.pointerId); } catch (_) {}

    const wpt = viewport.screenToWorld(e.clientX, e.clientY);

    if (edPointers.size === 1) {
      const element = e.target.closest('.edit-place');
      const hit = placeHitTest(e.clientX, e.clientY);
      if (element && hit) {
        edPressState = { id: Number(element.dataset.id), x0: e.clientX, y0: e.clientY, moved: false, wpt };
      } else {
        edDragging = true;
        edDragStart = { x: e.clientX, y: e.clientY, tx: viewport.tx, ty: viewport.ty, moved: 0 };
      }
    } else if (edPointers.size === 2) {
      if (edLongPressTimer) { clearTimeout(edLongPressTimer); edLongPressTimer = null; }
      edPressState = null;
      const pts = [...edPointers.values()];
      edPinch = {
        d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        scale: viewport.scale,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2
      };
    }
  }

  function edPointerMove(e) {
    if (!edPointers.has(e.pointerId)) return;
    edPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (edMovingId != null) {
      const p = editor.places.find(x => x.id === edMovingId);
      if (p) {
        const wpt = viewport.screenToWorld(e.clientX, e.clientY);
        p.x = wpt.x;
        p.y = wpt.y;
        const el = edPlaces.querySelector(`.edit-place[data-id="${edMovingId}"]`);
        if (el) {
          el.dataset.x = p.x;
          el.dataset.y = p.y;
          el.setAttribute('transform',
            `translate(${p.x} ${p.y}) scale(${placeScale(viewport.scale)})`);
        }
        // 更新相连道路
        edRoads.querySelectorAll('.road').forEach((g) => {
          const [a, b] = g.dataset.key.split('|').map(Number);
          const pa = editor.places.find(x => x.id === a);
          const pb = editor.places.find(x => x.id === b);
          if (!pa || !pb) return;
          const d = roadPath(pa, pb);
          g.querySelectorAll('path').forEach(pp => pp.setAttribute('d', d));
        });
      }
      return;
    }

    if (edPressState && !edPressState.moved) {
      const dx = e.clientX - edPressState.x0;
      const dy = e.clientY - edPressState.y0;
      if (Math.hypot(dx, dy) > cfg.MOVE_THRESHOLD) {
        edPressState.moved = true;
        edDragging = true;
        // 已确认是拖动（非长按），取消长按计时避免之后误触发
        if (edLongPressTimer) { clearTimeout(edLongPressTimer); edLongPressTimer = null; }
        edDragStart = { x: edPressState.x0, y: edPressState.y0, tx: viewport.tx, ty: viewport.ty };
      }
    }

    if (edPinch && edPointers.size === 2) {
      const pts = [...edPointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ns = clamp(edPinch.scale * (d / edPinch.d), cfg.EDITOR_MIN_SCALE, cfg.EDITOR_MAX_SCALE);
      const rect = edSvg.getBoundingClientRect();
      viewport.zoomAround(
        edPinch.cx - rect.left,
        edPinch.cy - rect.top,
        ns / viewport.scale
      );
      return;
    }

    if (edDragging && edDragStart) {
      const dx = e.clientX - edDragStart.x;
      const dy = e.clientY - edDragStart.y;
      edDragStart.moved = Math.max(edDragStart.moved || 0, Math.hypot(dx, dy));
      viewport.panTo(edDragStart.tx + dx, edDragStart.ty + dy);
    }
  }

  function edPointerUp(e) {
    if (!edPointers.has(e.pointerId)) return;
    edPointers.delete(e.pointerId);
    try { edSvg.releasePointerCapture(e.pointerId); } catch (_) {}

    if (edMovingId != null) {
      edMovingId = null;
      const el = edPlaces.querySelector('.edit-place.moving');
      if (el) el.classList.remove('moving');
      pushHistory();
      persist();
      return;
    }

    if (edPointers.size === 0) {
      if (edLongPressTimer) { clearTimeout(edLongPressTimer); edLongPressTimer = null; }
      const ps = edPressState;
      const wasDragging = edDragging;
      const blankMoved = edDragStart ? (edDragStart.moved || 0) : 0;
      edPressState = null;
      edDragging = false;
      edDragStart = null;

      if (ps && !ps.moved) {
        // 地点点击
        if (editor.mode === 'road' || editor.mode === 'delete') {
          // 连线 / 删除模式：立即响应，避免等待双击造成的卡顿
          handlePlaceTap(ps.id);
        } else {
          // place 模式：双击编辑，单击无操作（先等一下看是否双击）
          if (edTapTimer) {
            clearTimeout(edTapTimer);
            edTapTimer = null;
            edDoubleTap(ps.id);
          } else {
            edTapInfo = { id: ps.id };
            edTapTimer = setTimeout(() => {
              edTapTimer = null;
              if (edTapInfo) { handlePlaceTap(edTapInfo.id); edTapInfo = null; }
            }, cfg.DOUBLE_TAP_MS);
          }
        }
      } else if (ps && ps.moved) {
        // 拖动后抬起（无其它操作）
      } else if (wasDragging && blankMoved < 8) {
        // 空白处轻点（非拖动）
        handleBlankTap(e.clientX, e.clientY);
      }
    } else if (edPointers.size === 1) {
      // 从双指变单指：以剩余手指继续平移
      const remaining = [...edPointers.values()][0];
      edDragging = true;
      edDragStart = { x: remaining.x, y: remaining.y, tx: viewport.tx, ty: viewport.ty };
      edPinch = null;
    }
  }

  function handlePlaceTap(id) {
    const p = editor.places.find(x => x.id === id);
    if (!p) return;

    if (editor.mode === 'delete') {
      removePlace(id);
      return;
    }
    if (editor.mode === 'road') {
      if (editor.pending == null) {
        editor.pending = id;
      } else if (editor.pending === id) {
        editor.pending = null;
      } else {
        addEdge(editor.pending, id);
        editor.pending = id;
      }
      renderEditor();
      return;
    }
    // place 模式：单击不处理，等待双击（见 edDoubleTap）
  }

  function handleBlankTap(cx, cy) {
    if (editor.mode === 'place') {
      const wpt = viewport.screenToWorld(cx, cy);
      // 与已有地点过近则忽略
      const tooClose = editor.places.some(p => Math.hypot(p.x - wpt.x, p.y - wpt.y) < cfg.NEW_PLACE_MIN_DIST / viewport.scale);
      if (tooClose) { flashTip('离已有地点太近了'); return; }
      addPlace(wpt.x, wpt.y);
    } else if (editor.mode === 'road' && editor.pending != null) {
      editor.pending = null;
      renderEditor();
    } else if (editor.mode === 'delete') {
      const el = document.elementFromPoint(cx, cy);
      const roadEl = el && el.closest ? el.closest('.road-hit') : null;
      if (roadEl) {
        const key = roadEl.parentElement.dataset.key;
        const [a, b] = key.split('|').map(Number);
        removeEdge(a, b);
      }
    }
  }

  function edWheel(e) {
    e.preventDefault();
    viewport.zoomAtClient(e.clientX, e.clientY,
      e.deltaY < 0 ? cfg.WHEEL_ZOOM : 1 / cfg.WHEEL_ZOOM);
  }

  function edDoubleTap(id) {
    openPlaceEditor(id);
  }

  /* =========================================================
     导入 / 导出
     ========================================================= */
  function exportJSON() {
    if (!editor.places.length) { flashTip('还没有可导出的内容'); return; }
    const data = {
      version: 1,
      places: editor.places.map(p => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), icon: p.icon, name: p.name, color: p.color })),
      edges: editor.edges.map(e => [...e])
    };
    App.storage.downloadJSON(data, `map-${Date.now()}.json`);
    flashTip('已导出 JSON');
  }

  /** 导出地图为 PNG（按所有地点包围盒裁剪，最边上地点留白） */
  function edExportImage() {
    if (!editor.places.length) { App.ExportImage.toast('还没有可导出的内容'); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of editor.places) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const pad = 80; // 最边上地点的内边距留白
    const vbX = minX - pad, vbY = minY - pad;
    const vbW = (maxX - minX) + pad * 2;
    const vbH = (maxY - minY) + pad * 2;
    // 限制最长边，避免导出超大图
    const maxSide = 2400;
    const outScale = Math.min(1, maxSide / Math.max(vbW, vbH));
    const outW = vbW * outScale, outH = vbH * outScale;

    // 克隆道路层与地点层（不含网格底图）
    const roads = edRoads.cloneNode(true);
    const places = edPlaces.cloneNode(true);
    // 归一化地点缩放为 1，导出尺寸统一
    places.querySelectorAll('.edit-place').forEach((g) => {
      const x = g.getAttribute('data-x');
      const y = g.getAttribute('data-y');
      if (x != null && y != null) g.setAttribute('transform', `translate(${x} ${y}) scale(1)`);
    });

    // 用页面真实计算样式内联，确保导出颜色与编辑器显示一致
    const svg = App.ExportImage.buildInlineSvg({
      width: outW,
      height: outH,
      viewBox: `${vbX} ${vbY} ${vbW} ${vbH}`,
      bg: App.ExportImage.BG,
      srcLayers: [edRoads, edPlaces],
      layers: [roads, places]
    });

    App.ExportImage.rasterize(svg, outW, outH)
      .then((canvas) => {
        App.ExportImage.download(canvas, `map-${Date.now()}.png`);
        App.ExportImage.toast('已导出 PNG');
      })
      .catch(() => App.ExportImage.toast('导出失败'));
  }

  function importJSON(file) {
    App.storage.readFileText(file).then((text) => {
      let data;
      try { data = JSON.parse(text); } catch (_) { flashTip('文件格式错误'); return; }
      if (!data || !Array.isArray(data.places)) { flashTip('缺少 places 字段'); return; }
      pushHistory();
      editor.places = data.places.map(p => ({
        id: Number(p.id), x: Number(p.x), y: Number(p.y),
        icon: p.icon || '📍', name: p.name || '地点', color: p.color || '#9b8cff'
      }));
      editor.edges = Array.isArray(data.edges)
        ? data.edges.map(e => [Number(e[0]), Number(e[1])])
        : [];
      editor.nextId = (editor.places.reduce((m, p) => Math.max(m, p.id), 0)) + 1;
      editor.pending = null;
      renderEditor();
      edResetView();
      flashTip('导入成功');
    }).catch(() => flashTip('导入失败'));
  }

  /* =========================================================
     持久化（localStorage）
     ========================================================= */
  function persist() {
    App.storage.saveEditor(state());
  }

  /* =========================================================
     拖拽导入
     ========================================================= */
  function setupDropImport() {
    const overlay = $('#dropOverlay');
    const show = () => overlay && overlay.classList.add('show');
    const hide = () => overlay && overlay.classList.remove('show');

    window.addEventListener('dragover', (e) => { e.preventDefault(); show(); });
    window.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) hide();
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      hide();
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) importJSON(file);
    });
  }

  /* =========================================================
     初始化
     ========================================================= */
  function init() {
    edSvg = $('#editorSvg');
    edWorld = $('#editorWorld');
    edRoads = $('#editorRoads');
    edPlaces = $('#editorPlaces');
    placeEditor = $('#placeEditor');

    viewport = new App.Viewport({
      svg: edSvg,
      world: edWorld,
      placesGroup: edPlaces,
      placeSelector: '.edit-place',
      minScale: cfg.EDITOR_MIN_SCALE,
      maxScale: cfg.EDITOR_MAX_SCALE
    });

    // 模式切换
    document.querySelectorAll('.et-mode').forEach((btn) => {
      btn.addEventListener('click', () => {
        setMode(btn.dataset.mode);
        renderEditor();
      });
    });

    // 底部按钮
    $('#edUndo').addEventListener('click', edUndo);
    $('#edClear').addEventListener('click', edClearAll);
    $('#edSample').addEventListener('click', edLoadSample);
    $('#edExport').addEventListener('click', exportJSON);
    $('#edExportImg').addEventListener('click', edExportImage);
    $('#edImport').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importJSON(f);
      e.target.value = '';
    });

    // 地点编辑弹框
    $('#peClose').addEventListener('click', closePlaceEditor);
    $('#peCancel').addEventListener('click', closePlaceEditor);
    $('#peSave').addEventListener('click', savePlaceEdit);
    $('#peDelete').addEventListener('click', deletePlaceFromEditor);

    // 指针 / 滚轮
    edSvg.addEventListener('pointerdown', edPointerDown);
    edSvg.addEventListener('pointermove', edPointerMove);
    edSvg.addEventListener('pointerup', edPointerUp);
    edSvg.addEventListener('pointercancel', edPointerUp);
    edSvg.addEventListener('wheel', edWheel, { passive: false });

    // 长按移动（按下后延时进入拖动模式）
    edSvg.addEventListener('pointerdown', (e) => {
      // 仅对地点生效，且非删除模式
      if (editor.mode === 'delete') return;
      const element = e.target.closest('.edit-place');
      if (!element) return;
      const id = Number(element.dataset.id);
      clearTimeout(edLongPressTimer);
      edLongPressTimer = setTimeout(() => {
        if (edPressState && !edPressState.moved && edPressState.id === id) {
          edMovingId = id;
          edPressState = null;
          edDragging = false;
          const el = edPlaces.querySelector(`.edit-place[data-id="${id}"]`);
          if (el) el.classList.add('moving');
        }
      }, cfg.LONG_PRESS_MS);
    });

    setupDropImport();

    // 恢复本地数据 或 加载示例
    const saved = App.storage.loadEditor();
    if (saved && saved.places.length) {
      editor.places = saved.places.map(p => ({ ...p }));
      editor.edges = Array.isArray(saved.edges) ? saved.edges.map(e => [...e]) : [];
      editor.nextId = (saved.nextId != null)
        ? saved.nextId
        : Math.max(0, ...editor.places.map(p => p.id)) + 1;
      editor.pending = null;
      renderEditor();
      edResetView();
    } else {
      edLoadSample();
    }
    setMode('place');
  }

  /* 模块对外接口 */
  App.Editor = {
    init,
    resetView: edResetView,
    getMap: () => ({
      places: editor.places.map(p => ({ ...p })),
      edges: editor.edges.map(e => [...e])
    })
  };

})(window.App = window.App || {});
