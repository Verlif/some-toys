(function (app) {
  'use strict';
  const { STORAGE_KEY, COLORS, CELL_SIZE } = app.config;
  const snap = n => Math.round(n / CELL_SIZE) * CELL_SIZE;
  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (_) { return null; }
  }
  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        places: state.places, edges: state.edges, nextId: state.nextId,
        cellDistance: state.cellDistance
      }));
    } catch (_) { /* Storage may be unavailable in private browsing. */ }
  }
  function normalize(data) {
    if (!data || !Array.isArray(data.places)) throw new Error('文件格式不正确');
    const places = data.places.map((place, index) => {
      const name = String(place.name || '地点').slice(0, 16);
      return {
        id: Number(place.id) || index + 1,
        x: snap(Number(place.x) || 0), y: snap(Number(place.y) || 0),
        icon: String(place.icon || app.firstCharacter(name)).slice(0, 4),
        name,
        color: /^#[0-9a-f]{6}$/i.test(place.color || '') ? place.color : COLORS[index % COLORS.length]
      };
    });
    const ids = new Set(places.map(place => place.id));
    const edges = Array.isArray(data.edges)
      ? data.edges.filter(edge => Array.isArray(edge) && ids.has(Number(edge[0])) && ids.has(Number(edge[1])))
        .map(edge => [Number(edge[0]), Number(edge[1])])
      : [];
    return { places, edges, nextId: Math.max(0, ...places.map(place => place.id)) + 1,
      cellDistance: Math.max(1, Number(data.cellDistance) || 100) };
  }
  function exportJSON(state) {
    const data = { version: 1, cellDistance: state.cellDistance, places: state.places, edges: state.edges };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = '地点距离地图.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  app.storage = { load, save, normalize, exportJSON };
})(window.DistanceDrawing = window.DistanceDrawing || {});
