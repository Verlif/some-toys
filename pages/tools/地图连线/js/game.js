/* =========================================================
   game.js — 路线游戏
   从起点出发，依次点选相邻地点，绕回起点即可完成闭环。
   暴露到：window.App.Game
   ========================================================= */
(function (App) {
  'use strict';

  const { $, edgeKey, roadPath, esc } = App.utils;
  const cfg = App.config;

  /* ---------- 游戏状态 ---------- */
  const game = {
    places: [],
    edges: [],
    placeMap: {},
    adj: {},          // { [id]: Set<id> }
    startId: null,
    path: [],
    finished: false
  };

  /* ---------- DOM 与视口 ---------- */
  let viewport;
  let gmSvg, gmWorld, gmRoads, gmPlaces, gmScreen;
  let errorTimer = null;

  /* ---------- 指针 / 手势状态 ---------- */
  const gmPointers = new Map();
  let gmDragging = false, gmDragStart = null, gmPinch = null;

  /* =========================================================
     载入与构建
     ========================================================= */
  function loadFrom(map) {
    game.places = map.places.map(p => ({ ...p }));
    game.edges = map.edges.map(e => [Number(e[0]), Number(e[1])]);
    game.placeMap = {};
    game.places.forEach(p => { game.placeMap[p.id] = p; });
    game.adj = {};
    game.places.forEach(p => { game.adj[p.id] = new Set(); });
    game.edges.forEach(([a, b]) => {
      if (game.adj[a]) game.adj[a].add(b);
      if (game.adj[b]) game.adj[b].add(a);
    });
    game.startId = game.places[0] ? game.places[0].id : null;
    game.path = game.startId ? [game.startId] : [];
    game.finished = false;

    buildGameMap();
    renderRoute();
    resetView();
  }

  function buildGameMap() {
    gmRoads.innerHTML = game.edges.map(([a, b]) => {
      const pa = game.placeMap[a], pb = game.placeMap[b];
      if (!pa || !pb) return '';
      const d = roadPath(pa, pb);
      return `<g class="road" data-key="${edgeKey(a, b)}">
        <path class="road-outer" d="${d}"></path>
        <path class="road-inner" d="${d}"></path>
        <path class="road-dash" d="${d}"></path>
      </g>`;
    }).join('');

    gmPlaces.innerHTML = game.places.map(p => `
      <g class="place" data-id="${p.id}" data-x="${p.x}" data-y="${p.y}" style="--c:${esc(p.color)}" transform="translate(${p.x} ${p.y})">
        <circle class="place-halo" r="34"></circle>
        <circle class="place-bg" r="23"></circle>
        <circle class="place-ring" r="23"></circle>
        <text class="place-icon" y="1">${esc(p.icon)}</text>
        <text class="place-name" y="48">${esc(p.name)}</text>
      </g>
    `).join('');
  }

  /* =========================================================
     自适应视图
     ========================================================= */
  function resetView() {
    const rect = gmSvg.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const availH = Math.max(h - 168, 200);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (!game.places.length) {
      minX = 0; minY = 0; maxX = 800; maxY = 600;
    } else {
      game.places.forEach(p => {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      });
    }
    viewport.resetView({ minX, minY, maxX, maxY, pad: 160, availHeight: availH, minScale: 0.18, maxScale: 2.6, topOffset: 8 });
  }

  /* =========================================================
     连接规则与操作
     ========================================================= */
  /* 可连性：相邻即可走；回到起点需要已走过至少 3 个不同地点 */
  function canConnect(id) {
    if (game.finished || !game.startId) return false;
    const path = game.path;
    const last = path[path.length - 1];
    if (id === last) return false;
    if (!game.adj[last] || !game.adj[last].has(id)) return false;

    if (id === game.startId) {
      const uniqueCount = new Set(path).size;
      return uniqueCount >= 3;
    }
    return true;
  }

  function tryConnect(id) {
    if (!game.startId) return;
    if (game.finished) { showError('路线已完成 · 点击「清空重来」重新规划'); return; }

    const path = game.path;
    const last = path[path.length - 1];

    if (id === last) { showError('你已经在这里了'); return; }
    if (!game.adj[last] || !game.adj[last].has(id)) {
      const a = game.placeMap[last], b = game.placeMap[id];
      showError(`「${a ? a.name : ''}」与「${b ? b.name : ''}」之间没有道路`);
      return;
    }
    if (id === game.startId) {
      const uniqueCount = new Set(path).size;
      if (uniqueCount < 3) {
        showError('至少走过 3 个不同地点才能回到起点');
        return;
      }
      path.push(game.startId);
      game.finished = true;
      renderRoute();
      return;
    }
    path.push(id);
    renderRoute();
  }

  /* =========================================================
     渲染：路线、路径链、提示
     ========================================================= */
  function renderRoute() {
    // 高亮已走过的道路
    const activeEdges = new Set();
    for (let i = 0; i < game.path.length - 1; i++) {
      activeEdges.add(edgeKey(game.path[i], game.path[i + 1]));
    }
    gmRoads.querySelectorAll('.road').forEach(g => {
      g.classList.toggle('active', activeEdges.has(g.dataset.key));
    });

    // 地点状态
    const pathSet = new Set(game.path);
    const last = game.path[game.path.length - 1];
    const prev = game.path.length >= 2 ? game.path[game.path.length - 2] : null;

    gmPlaces.querySelectorAll('.place').forEach(g => {
      const id = Number(g.dataset.id);
      const isOn = pathSet.has(id);
      const isCur = id === last;
      const isBack = id === prev;
      const isAvail = canConnect(id) && !isCur && !isBack;
      g.classList.toggle('on-path', isOn);
      g.classList.toggle('current', isCur);
      g.classList.toggle('back', isBack);
      g.classList.toggle('available', isAvail);
    });

    gmScreen.classList.toggle('completed', game.finished);

    renderChain();
    updateHint();
  }

  function renderChain() {
    const chain = $('#rpChain');
    chain.innerHTML = game.path.map((id, i) => {
      const p = game.placeMap[id];
      if (!p) return '';
      const cls = ['chip'];
      if (i === 0) cls.push('home');
      if (game.finished) cls.push('done');
      else if (i === game.path.length - 1) cls.push('current');
      return `<div class="${cls.join(' ')}">
        <span class="num">${String(i + 1).padStart(2, '0')}</span>
        <span class="ico">${esc(p.icon)}</span>
        <span class="name">${esc(p.name)}</span>
      </div>`;
    }).join('<div class="chip-arrow">›</div>');

    $('#rpCount').textContent = game.path.length;
    requestAnimationFrame(() => { chain.scrollLeft = chain.scrollWidth; });
  }

  function updateHint() {
    const hint = $('#rpHint');
    const status = $('#rpStatus');

    if (game.finished) {
      status.textContent = '闭环完成';
      status.className = 'rp-status done';
      hint.textContent = '✓ 路线闭合，回到了起点';
      hint.className = 'rp-hint done';
      return;
    }
    status.textContent = '进行中';
    status.className = 'rp-status';

    const last = game.path[game.path.length - 1];
    const prev = game.path.length >= 2 ? game.path[game.path.length - 2] : null;
    const name = game.placeMap[last] ? game.placeMap[last].name : '';
    const uniqueCount = new Set(game.path).size;

    if (prev) {
      const prevName = game.placeMap[prev] ? game.placeMap[prev].name : '';
      if (uniqueCount < 3) {
        const need = 3 - uniqueCount;
        hint.innerHTML = `点相邻地点前进 · 点「${esc(prevName)}」可<b>回到上一步</b> · 还需走过 ${need} 个地点`;
      } else {
        hint.innerHTML = `点相邻地点前进 · 点「${esc(prevName)}」可<b>回到上一步</b> · 或点起点完成闭环`;
      }
    } else {
      if (uniqueCount < 3) {
        const need = 3 - uniqueCount;
        hint.textContent = `点击与「${name}」相连的地点 · 还需走过 ${need} 个地点`;
      } else {
        hint.textContent = `点击与「${name}」相连的地点 · 或点击起点完成闭环`;
      }
    }
    hint.className = 'rp-hint';
  }

  function showError(msg) {
    const hint = $('#rpHint');
    hint.textContent = msg;
    hint.className = 'rp-hint error';
    clearTimeout(errorTimer);
    errorTimer = setTimeout(updateHint, 1700);
  }

  /* =========================================================
     手势：平移 / 缩放 / 点击连接
     ========================================================= */
  function gmPointerDown(e) {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    gmPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { gmSvg.setPointerCapture(e.pointerId); } catch (_) {}

    if (gmPointers.size === 1) {
      gmDragging = true;
      gmDragStart = { x: e.clientX, y: e.clientY, tx: viewport.tx, ty: viewport.ty, moved: 0 };
      gmSvg.classList.add('dragging');
    } else if (gmPointers.size === 2) {
      gmDragging = false;
      gmSvg.classList.remove('dragging');
      const pts = [...gmPointers.values()];
      gmPinch = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
        center: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
        scale: viewport.scale, tx: viewport.tx, ty: viewport.ty
      };
      gmDragStart = null;
    }
  }

  function gmPointerMove(e) {
    if (!gmPointers.has(e.pointerId)) return;
    gmPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (gmPointers.size === 1 && gmDragging && gmDragStart) {
      const dx = e.clientX - gmDragStart.x;
      const dy = e.clientY - gmDragStart.y;
      gmDragStart.moved = Math.max(gmDragStart.moved, Math.hypot(dx, dy));
      viewport.panTo(gmDragStart.tx + dx, gmDragStart.ty + dy);
    } else if (gmPointers.size === 2 && gmPinch) {
      const pts = [...gmPointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const center = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const factor = dist / gmPinch.dist;
      const ns = clampNum(gmPinch.scale * factor, cfg.GAME_MIN_SCALE, 3);
      const rect = gmSvg.getBoundingClientRect();
      const sx = gmPinch.center.x - rect.left;
      const sy = gmPinch.center.y - rect.top;
      const cx = center.x - rect.left;
      const cy = center.y - rect.top;
      const px = (sx - gmPinch.tx) / gmPinch.scale;
      const py = (sy - gmPinch.ty) / gmPinch.scale;
      viewport.set(ns, cx - px * ns, cy - py * ns);
    }
  }

  function gmPointerUp(e) {
    if (!gmPointers.has(e.pointerId)) return;
    gmPointers.delete(e.pointerId);

    if (gmPointers.size === 0) {
      if (gmDragging && gmDragStart && gmDragStart.moved < 6) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const placeEl = el && el.closest ? el.closest('.place') : null;
        if (placeEl) tryConnect(Number(placeEl.dataset.id));
      }
      gmDragging = false;
      gmDragStart = null;
      gmPinch = null;
      gmSvg.classList.remove('dragging');
    } else if (gmPointers.size === 1) {
      const p = [...gmPointers.values()][0];
      gmDragging = true;
      gmDragStart = { x: p.x, y: p.y, tx: viewport.tx, ty: viewport.ty, moved: 0 };
      gmPinch = null;
    }
  }

  function gmWheel(e) {
    e.preventDefault();
    viewport.zoomAtClient(e.clientX, e.clientY, e.deltaY < 0 ? cfg.WHEEL_ZOOM : 1 / cfg.WHEEL_ZOOM);
  }

  /* =========================================================
     缩放按钮 / 清空
     ========================================================= */
  function clearRoute() {
    if (!game.startId) return;
    game.path = [game.startId];
    game.finished = false;
    clearTimeout(errorTimer);
    renderRoute();
  }

  /* =========================================================
     初始化
     ========================================================= */
  function clampNum(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function init() {
    gmSvg = $('#gameSvg');
    gmWorld = $('#gameWorld');
    gmRoads = $('#gameRoads');
    gmPlaces = $('#gamePlaces');
    gmScreen = $('#gameScreen');

    viewport = new App.Viewport({
      svg: gmSvg,
      world: gmWorld,
      placesGroup: gmPlaces,
      placeSelector: '.place',
      zoomLabel: $('#zoomLabel'),
      hideLabelsBelow: 0.42,
      minScale: cfg.GAME_MIN_SCALE,
      maxScale: cfg.GAME_MAX_SCALE
    });

    gmSvg.addEventListener('pointerdown', gmPointerDown);
    gmSvg.addEventListener('pointermove', gmPointerMove);
    gmSvg.addEventListener('pointerup', gmPointerUp);
    gmSvg.addEventListener('pointercancel', gmPointerUp);
    gmSvg.addEventListener('wheel', gmWheel, { passive: false });

    $('#zoomIn').addEventListener('click', () => viewport.zoomCenter(cfg.BTN_ZOOM));
    $('#zoomOut').addEventListener('click', () => viewport.zoomCenter(1 / cfg.BTN_ZOOM));
    $('#zoomReset').addEventListener('click', resetView);
    $('#rpClear').addEventListener('click', clearRoute);
    $('#gmExportImg').addEventListener('click', gmExportImage);
  }

  /** 导出当前画布为 PNG（所见即所得，导出当前视图） */
  function gmExportImage() {
    if (!game.placeMap || !Object.keys(game.placeMap).length) {
      App.ExportImage.toast('还没有可导出的内容');
      return;
    }
    const rect = gmSvg.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    if (!W || !H) { App.ExportImage.toast('画布尺寸异常'); return; }
    const world = gmWorld.cloneNode(true);
    // 用页面真实计算样式内联（removeGrid 会去掉网格底图），所见即所得
    const svg = App.ExportImage.buildInlineSvg({
      width: W,
      height: H,
      viewBox: `0 0 ${W} ${H}`,
      bg: App.ExportImage.BG,
      srcLayers: [gmWorld],
      layers: [world],
      removeGrid: true
    });
    App.ExportImage.rasterize(svg, W, H)
      .then((canvas) => {
        App.ExportImage.download(canvas, `route-${Date.now()}.png`);
        App.ExportImage.toast('已导出 PNG');
      })
      .catch(() => App.ExportImage.toast('导出失败'));
  }

  App.Game = {
    init,
    loadFrom,
    resetView
  };

})(window.App = window.App || {});
