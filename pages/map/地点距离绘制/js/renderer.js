(function (app) {
  'use strict';
  const { CELL_SIZE } = app.config;
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const svg = $('#map'), world = $('#world'), edgesEl = $('#edges'), placesEl = $('#places');

  function applyView(state) {
    world.setAttribute('transform', `translate(${state.tx} ${state.ty}) scale(${state.scale})`);
    $('#zoomLabel').textContent = `${Math.round(state.scale * 100)}%`;
  }
  function resetView(state) {
    const rect = svg.getBoundingClientRect();
    state.scale = Math.max(.28, Math.min(Math.min(rect.width / 1400, (rect.height - 180) / 900) * .86, 1.15));
    state.tx = (rect.width - 1200 * state.scale) / 2;
    state.ty = (rect.height - 760 * state.scale) / 2 + 8;
    applyView(state);
  }
  function centerMap(state) {
    const rect = svg.getBoundingClientRect();
    let cx = 0, cy = 0;
    if (state.places.length) {
      const xs = state.places.map(p => p.x), ys = state.places.map(p => p.y);
      cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    state.tx = rect.width / 2 - cx * state.scale;
    state.ty = rect.height / 2 - cy * state.scale;
    applyView(state);
  }
  function screenToWorld(clientX, clientY, state) {
    const rect = svg.getBoundingClientRect();
    return { x: (clientX - rect.left - state.tx) / state.scale, y: (clientY - rect.top - state.ty) / state.scale };
  }
  function zoom(state, clientX, clientY, factor) {
    const rect = svg.getBoundingClientRect(), sx = clientX - rect.left, sy = clientY - rect.top;
    const nextScale = Math.max(app.config.MIN_SCALE, Math.min(app.config.MAX_SCALE, state.scale * factor));
    const ratio = nextScale / state.scale;
    state.tx = sx - (sx - state.tx) * ratio;
    state.ty = sy - (sy - state.ty) * ratio;
    state.scale = nextScale;
    applyView(state);
  }
  function render(state, metersPerCell) {
    const find = id => state.places.find(p => p.id === id);
    const neighbors = new Set();
    if (state.mode === 'preview' && state.preview != null) {
      state.edges.forEach(([a,b]) => { if (a === state.preview) neighbors.add(b); if (b === state.preview) neighbors.add(a); });
    }
    edgesEl.innerHTML = state.edges.map(([a,b]) => {
      const p = find(a), q = find(b); if (!p || !q) return '';
      const dx = q.x-p.x, dy = q.y-p.y, mx = (p.x+q.x)/2, my = (p.y+q.y)/2;
      let angle = Math.atan2(dy, dx) * 180 / Math.PI; if (angle > 90 || angle < -90) angle += 180;
      const d = Math.hypot(dx,dy) / CELL_SIZE * metersPerCell;
      const label = d >= 1000 ? `${(d/1000).toFixed(d >= 10000 ? 1 : 2).replace(/0+$/,'').replace(/\.$/,'')} km` : `${Math.round(d)} m`;
      const labelWidth = Math.max(56, label.length * 6.8 + 24);
      const active = state.mode !== 'preview' || state.preview == null || a === state.preview || b === state.preview;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      return `<g class="edge ${active ? '' : 'dim'}" data-key="${key}">
        <line class="route" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke-width="5" stroke-linecap="round"/>
        <line class="route-dash" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke-width="2" stroke-dasharray="4 7" stroke-linecap="round"/>
        <line class="edge-hit" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="transparent" stroke-width="20"/>
        <g transform="translate(${mx} ${my}) rotate(${angle})"><rect class="distance-bg" x="${-labelWidth/2}" y="-11" width="${labelWidth}" height="22" rx="8"/><text class="distance-label" y="4" text-anchor="middle" font-family="var(--mono)" font-size="11" font-weight="700">${escapeHtml(label)}</text></g>
      </g>`;
    }).join('');
    placesEl.innerHTML = state.places.map(p => {
      let cls = 'place';
      if (state.pending === p.id) cls += ' pending';
      if (state.mode === 'preview' && state.preview != null) cls += p.id === state.preview ? ' selected' : (neighbors.has(p.id) ? ' neighbor' : ' dim');
      return `<g class="${cls}" data-id="${p.id}" transform="translate(${p.x} ${p.y})" style="--place:${escapeHtml(p.color)}">
        <circle class="halo" r="31"/><circle class="ring" r="19"/><circle class="bg" r="16"/><text class="icon" y="1">${escapeHtml(p.icon)}</text><text class="name" y="39">${escapeHtml(p.name)}</text>
      </g>`;
    }).join('');
    $('#placeCount').textContent = state.places.length;
    $('#edgeCount').textContent = state.edges.length;
    $('#undo').disabled = !state.history.length;
    applyView(state);
  }
  app.renderer = { applyView, resetView, centerMap, screenToWorld, zoom, render, svg };
})(window.DistanceDrawing = window.DistanceDrawing || {});
