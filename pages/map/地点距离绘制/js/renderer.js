(function (app) {
  'use strict';
  const { CELL_SIZE } = app.config;
  const $ = selector => document.querySelector(selector);
  const canvas = $('#map'), context = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const surface = canvas;
  let colors = {}, dpr = 1, width = 0, height = 0, lastState = null, lastMeters = 100, zoomGesture = null;

  function readColors() {
    const style = getComputedStyle(document.documentElement);
    const get = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    colors = {
      paper: get('--paper', '#f5f7f5'), panel: get('--panel', '#fff'), ink: get('--ink', '#223537'),
      muted: get('--muted', '#718184'), line: get('--line', '#dce5e1'), lineStrong: get('--line-strong', 'rgba(38,75,70,.14)'),
      teal: get('--teal', '#147d78'), tealSoft: get('--teal-soft', '#e4f2ef'), orange: get('--orange', '#e58c55'),
      gridLine: get('--grid-line', '#dfe7e3'), gridDot: get('--grid-dot', '#bdcfca'),
      route: get('--route', '#a9bfba'), routeDash: get('--route-dash', '#fff'), routeLabel: get('--route-label', '#35625e'),
      font: get('--font', 'sans-serif'), mono: get('--mono', 'monospace')
    };
  }
  readColors();
  new MutationObserver(() => { readColors(); if (lastState) render(lastState, lastMeters); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function ensureSize() {
    const rect = canvas.getBoundingClientRect();
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextWidth = Math.max(1, rect.width), nextHeight = Math.max(1, rect.height);
    if (nextDpr !== dpr || nextWidth !== width || nextHeight !== height) {
      dpr = nextDpr; width = nextWidth; height = nextHeight;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    }
  }
  function edgeLabel(distance) {
    return distance >= 1000
      ? `${(distance / 1000).toFixed(distance >= 10000 ? 1 : 2).replace(/0+$/,'').replace(/\.$/,'')} km`
      : `${Math.round(distance)} m`;
  }
  function roundedRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function drawGrid(ctx, view) {
    const left = -view.tx / view.scale, top = -view.ty / view.scale;
    const right = (view.width - view.tx) / view.scale, bottom = (view.height - view.ty) / view.scale;
    const startX = Math.floor(left / CELL_SIZE) * CELL_SIZE, endX = Math.ceil(right / CELL_SIZE) * CELL_SIZE;
    const startY = Math.floor(top / CELL_SIZE) * CELL_SIZE, endY = Math.ceil(bottom / CELL_SIZE) * CELL_SIZE;
    ctx.save();
    ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.dpr * view.tx, view.dpr * view.ty);
    ctx.beginPath();
    for (let x = startX; x <= endX; x += CELL_SIZE) { ctx.moveTo(x, top); ctx.lineTo(x, bottom); }
    for (let y = startY; y <= endY; y += CELL_SIZE) { ctx.moveTo(left, y); ctx.lineTo(right, y); }
    ctx.strokeStyle = colors.gridLine; ctx.lineWidth = 1 / view.scale; ctx.stroke();
    if (CELL_SIZE * view.scale >= 16) {
      ctx.beginPath();
      for (let x = startX; x <= endX; x += CELL_SIZE) for (let y = startY; y <= endY; y += CELL_SIZE) {
        ctx.moveTo(x + 1.3 / view.scale, y);
        ctx.arc(x, y, 1.3 / view.scale, 0, Math.PI * 2);
      }
      ctx.fillStyle = colors.gridDot; ctx.fill();
    }
    ctx.restore();
  }
  function drawEdges(ctx, state, metersPerCell, view, placeById) {
    const active = state.mode !== 'preview' || state.preview == null;
    for (const [aId, bId] of state.edges) {
      const a = placeById.get(aId), b = placeById.get(bId); if (!a || !b) continue;
      const selected = active || aId === state.preview || bId === state.preview;
      ctx.save(); ctx.globalAlpha = selected ? 1 : .16;
      ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = colors.route; ctx.lineWidth = 5; ctx.setLineDash([]); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = colors.routeDash; ctx.lineWidth = 2; ctx.setLineDash([4, 7]); ctx.stroke(); ctx.setLineDash([]);

      const dx = b.x - a.x, dy = b.y - a.y, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      let angle = Math.atan2(dy, dx); if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
      const label = edgeLabel(Math.hypot(dx, dy) / CELL_SIZE * metersPerCell);
      ctx.translate(mx, my); ctx.rotate(angle);
      ctx.font = `700 10px ${colors.mono}`;
      const labelWidth = Math.max(56, ctx.measureText(label).width + 24);
      roundedRect(ctx, -labelWidth / 2, -11, labelWidth, 22, 8);
      ctx.fillStyle = colors.panel; ctx.fill(); ctx.strokeStyle = colors.line; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = colors.routeLabel; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 0, 1);
      ctx.restore();
    }
  }
  function gray(hex) {
    const match = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!match) return hex;
    const value = parseInt(match[1], 16), r = value >> 16, g = (value >> 8) & 255, b = value & 255;
    const v = Math.round(.299 * r + .587 * g + .114 * b);
    return `rgb(${v} ${v} ${v})`;
  }
  function drawPlaces(ctx, state) {
    const neighbors = new Set();
    if (state.mode === 'preview' && state.preview != null) {
      for (const [a, b] of state.edges) { if (a === state.preview) neighbors.add(b); if (b === state.preview) neighbors.add(a); }
    }
    for (const place of state.places) {
      const selected = state.preview === place.id;
      const neighbor = neighbors.has(place.id);
      const dim = state.mode === 'preview' && state.preview != null && !selected && !neighbor;
      const baseColor = dim ? gray(place.color) : place.color;
      ctx.save(); ctx.translate(place.x, place.y); if (dim) ctx.globalAlpha = .25;
      ctx.beginPath(); ctx.arc(0, 0, 19, 0, Math.PI * 2);
      ctx.lineWidth = state.pending === place.id || selected ? 3 : neighbor ? 2.5 : 2;
      ctx.strokeStyle = state.pending === place.id || selected ? colors.orange : neighbor ? colors.teal : baseColor;
      ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fillStyle = neighbor ? colors.tealSoft : colors.panel;
      if (state.pending === place.id || selected) {
        ctx.fillStyle = colors.panel; ctx.fill(); ctx.globalAlpha *= .18; ctx.fillStyle = colors.orange; ctx.fill(); ctx.globalAlpha = dim ? .25 : 1;
      } else ctx.fill();
      ctx.strokeStyle = colors.lineStrong; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = colors.ink; ctx.font = `11px ${colors.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(place.icon, 0, 1);
      ctx.font = `700 10px ${colors.font}`; ctx.textBaseline = 'alphabetic';
      // 基线 32 = 图标底盘(r=16)下缘再留 8px，避免压住下一格地点的图标
      ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = colors.paper; ctx.strokeText(place.name, 0, 32);
      ctx.fillStyle = colors.muted; ctx.fillText(place.name, 0, 32);
      ctx.restore();
    }
  }
  function paint(ctx, state, metersPerCell, view) {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.fillStyle = colors.paper; ctx.fillRect(0, 0, view.width, view.height);
    drawGrid(ctx, view);
    ctx.save(); ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.dpr * view.tx, view.dpr * view.ty);
    const placeById = new Map(state.places.map(place => [place.id, place]));
    drawEdges(ctx, state, metersPerCell, view, placeById);
    drawPlaces(ctx, state);
    ctx.restore();
  }
  function render(state, metersPerCell) {
    zoomGesture = null;
    lastState = state; lastMeters = metersPerCell;
    ensureSize();
    paint(context, state, metersPerCell, { width, height, dpr, scale: state.scale, tx: state.tx, ty: state.ty });
    $('#placeCount').textContent = state.places.length;
    $('#edgeCount').textContent = state.edges.length;
    $('#zoomLabel').textContent = `${Math.round(state.scale * 100)}%`;
    $('#undo').disabled = !state.history.length;
  }
  function applyView(state) { render(state, lastMeters); }
  function resetView(state) {
    const rect = canvas.getBoundingClientRect();
    let minX = -600, maxX = 600, minY = -380, maxY = 380;
    if (state.places.length) {
      minX = Math.min(...state.places.map(p => p.x)); maxX = Math.max(...state.places.map(p => p.x));
      minY = Math.min(...state.places.map(p => p.y)); maxY = Math.max(...state.places.map(p => p.y));
    }
    const contentWidth = maxX - minX + 180, contentHeight = maxY - minY + 150;
    state.scale = Math.max(.2, Math.min((rect.width - 96) / contentWidth, (rect.height - 210) / contentHeight, 1.15));
    state.tx = rect.width / 2 - ((minX + maxX) / 2) * state.scale;
    state.ty = rect.height / 2 - ((minY + maxY) / 2) * state.scale;
    applyView(state);
  }
  function centerMap(state) {
    const rect = canvas.getBoundingClientRect();
    let cx = 0, cy = 0;
    if (state.places.length) {
      const xs = state.places.map(p => p.x), ys = state.places.map(p => p.y);
      cx = (Math.min(...xs) + Math.max(...xs)) / 2; cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    state.tx = rect.width / 2 - cx * state.scale; state.ty = rect.height / 2 - cy * state.scale;
    applyView(state);
  }
  function screenToWorld(clientX, clientY, state) {
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left - state.tx) / state.scale, y: (clientY - rect.top - state.ty) / state.scale };
  }
  function zoom(state, clientX, clientY, factor) {
    const rect = canvas.getBoundingClientRect(), sx = clientX - rect.left, sy = clientY - rect.top;
    const nextScale = Math.max(app.config.MIN_SCALE, Math.min(app.config.MAX_SCALE, state.scale * factor));
    const ratio = nextScale / state.scale;
    state.tx = sx - (sx - state.tx) * ratio; state.ty = sy - (sy - state.ty) * ratio;
    state.scale = nextScale; applyView(state);
  }
  function zoomPreview(state, clientX, clientY, factor) {
    ensureSize();
    if (!zoomGesture) {
      const image = document.createElement('canvas');
      image.width = canvas.width; image.height = canvas.height;
      image.getContext('2d').drawImage(canvas, 0, 0);
      zoomGesture = { image, scale: state.scale, tx: state.tx, ty: state.ty };
    }
    const rect = canvas.getBoundingClientRect(), sx = clientX - rect.left, sy = clientY - rect.top;
    const nextScale = Math.max(app.config.MIN_SCALE, Math.min(app.config.MAX_SCALE, state.scale * factor));
    const ratio = nextScale / state.scale;
    state.tx = sx - (sx - state.tx) * ratio; state.ty = sy - (sy - state.ty) * ratio;
    state.scale = nextScale;

    const base = zoomGesture, totalRatio = state.scale / base.scale;
    const offsetX = state.tx - totalRatio * base.tx, offsetY = state.ty - totalRatio * base.ty;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = colors.paper; context.fillRect(0, 0, width, height);
    context.drawImage(base.image, 0, 0, base.image.width, base.image.height,
      offsetX, offsetY, width * totalRatio, height * totalRatio);
    $('#zoomLabel').textContent = `${Math.round(state.scale * 100)}%`;
  }
  function finishZoom(state) {
    if (!zoomGesture) return;
    render(state, lastMeters);
  }
  function zoomCenter(state, factor) {
    const rect = canvas.getBoundingClientRect();
    zoom(state, rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }
  function movePlace(state, id, x, y, metersPerCell) {
    const place = state.places.find(item => item.id === id); if (!place) return;
    place.x = x; place.y = y; render(state, metersPerCell);
  }
  function segmentDistance(x, y, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
  }
  function hitTest(clientX, clientY, state) {
    const point = screenToWorld(clientX, clientY, state), radius = Math.max(22, 18 / state.scale);
    for (let i = state.places.length - 1; i >= 0; i--) {
      const place = state.places[i]; if (Math.hypot(point.x - place.x, point.y - place.y) <= radius) return { placeId: place.id };
    }
    for (let i = state.edges.length - 1; i >= 0; i--) {
      const [aId, bId] = state.edges[i], a = state.places.find(p => p.id === aId), b = state.places.find(p => p.id === bId);
      if (!a || !b) continue;
      let angle = Math.atan2(b.y - a.y, b.x - a.x); if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
      const dx = point.x - (a.x + b.x) / 2, dy = point.y - (a.y + b.y) / 2;
      const localX = dx * Math.cos(angle) + dy * Math.sin(angle), localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
      const distance = Math.hypot(b.x - a.x, b.y - a.y) / CELL_SIZE * state.cellDistance;
      const label = edgeLabel(distance), labelWidth = Math.max(56, label.length * 6.8 + 24);
      if (Math.abs(localX) <= labelWidth / 2 && Math.abs(localY) <= 11) return { edgeKey: aId < bId ? `${aId}|${bId}` : `${bId}|${aId}` };
      if (segmentDistance(point.x, point.y, a.x, a.y, b.x, b.y) <= 10) return { edgeKey: aId < bId ? `${aId}|${bId}` : `${bId}|${aId}` };
    }
    return null;
  }
  function createExportCanvas(state) {
    if (!state.places.length) throw new Error('还没有可导出的地点');
    const padding = 84;
    const minX = Math.min(...state.places.map(p => p.x)) - padding, maxX = Math.max(...state.places.map(p => p.x)) + padding;
    const minY = Math.min(...state.places.map(p => p.y)) - padding, maxY = Math.max(...state.places.map(p => p.y)) + padding;
    const scale = Math.min(2, 3000 / Math.max(maxX - minX, maxY - minY));
    const output = document.createElement('canvas');
    output.width = Math.max(1, Math.round((maxX - minX) * scale)); output.height = Math.max(1, Math.round((maxY - minY) * scale));
    paint(output.getContext('2d'), state, state.cellDistance, { width: output.width, height: output.height, dpr: 1, scale, tx: -minX * scale, ty: -minY * scale });
    return output;
  }
  window.addEventListener('resize', () => { if (lastState) render(lastState, lastMeters); });
  app.renderer = { applyView, resetView, centerMap, screenToWorld, zoom, zoomPreview, finishZoom, zoomCenter, render, movePlace, hitTest, createExportCanvas, svg: surface };
})(window.DistanceDrawing = window.DistanceDrawing || {});
