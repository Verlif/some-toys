(function (app) {
  'use strict';
  const { STORAGE_KEY, COLORS, CELL_SIZE } = app.config;
  const LIBRARY_KEY = 'place-distance-drawing:library:v1';
  let saveTimer = null;
  let pendingSave = null;
  const snap = n => Math.round(n / CELL_SIZE) * CELL_SIZE;

  function normalize(data) {
    if (!data || !Array.isArray(data.places)) throw new Error('地图数据格式不正确');
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
    return {
      places, edges,
      nextId: Math.max(0, ...places.map(place => Number(place.id) || 0)) + 1,
      cellDistance: Math.max(1, Number(data.cellDistance) || 100)
    };
  }

  function newId() {
    return globalThis.crypto?.randomUUID?.() || `map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
  }
  function makeRecord(data, name, id, updatedAt) {
    return {
      id: String(id || newId()),
      name: String(name || '未命名地图').trim().slice(0, 40) || '未命名地图',
      updatedAt: Number(updatedAt) || Date.now(),
      ...normalize(data)
    };
  }
  function writeLibrary(library) {
    library.maps.sort((a,b) => b.updatedAt - a.updatedAt);
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
      return true;
    } catch (_) { return false; }
  }
  function loadLibrary() {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(LIBRARY_KEY) || 'null'); } catch (_) { stored = null; }
    let maps = [];
    if (stored && Array.isArray(stored.maps)) {
      maps = stored.maps.map(record => {
        try { return makeRecord(record, record.name, record.id, record.updatedAt); }
        catch (_) { return null; }
      }).filter(Boolean);
    }

    // Migrate the previous single-map key once, leaving the original intact as a backup.
    if (!stored || !Array.isArray(stored.maps)) {
      try {
        const legacy = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (legacy && Array.isArray(legacy.places)) maps.push(makeRecord(legacy, '我的地图'));
      } catch (_) { /* A malformed legacy entry can be ignored. */ }
    }
    const activeMapId = maps.some(map => map.id === stored?.activeMapId) ? stored.activeMapId : (maps[0]?.id || null);
    const library = { version: 1, activeMapId, maps };
    writeLibrary(library);
    return library;
  }
  function setActiveMap(library, mapId) {
    if (!library.maps.some(map => map.id === mapId)) return false;
    library.activeMapId = mapId;
    return writeLibrary(library);
  }
  function createMap(library, name, data) {
    const record = makeRecord(data || { places: [], edges: [], cellDistance: 100 }, name);
    library.maps.unshift(record);
    library.activeMapId = record.id;
    writeLibrary(library);
    return record;
  }
  function saveMap(library, mapId, data) {
    const record = library.maps.find(map => map.id === mapId);
    if (!record) return false;
    Object.assign(record, normalize(data), { updatedAt: Date.now() });
    return writeLibrary(library);
  }
  function scheduleSave(library, mapId, data) {
    pendingSave = { library, mapId, data };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 220);
  }
  function flushSave() {
    clearTimeout(saveTimer); saveTimer = null;
    if (!pendingSave) return;
    const pending = pendingSave; pendingSave = null;
    saveMap(pending.library, pending.mapId, pending.data);
  }
  function renameMap(library, mapId, name) {
    const record = library.maps.find(map => map.id === mapId);
    if (!record) return false;
    record.name = String(name || '').trim().slice(0, 40) || '未命名地图';
    record.updatedAt = Date.now();
    return writeLibrary(library);
  }
  function deleteMap(library, mapId) {
    const wasActive = library.activeMapId === mapId;
    library.maps = library.maps.filter(map => map.id !== mapId);
    if (wasActive) library.activeMapId = library.maps[0]?.id || null;
    writeLibrary(library);
    return wasActive;
  }
  function exportJSON(state, mapName) {
    const data = { version: 1, name: mapName, cellDistance: state.cellDistance, places: state.places, edges: state.edges };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `${mapName || '地点距离地图'}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  app.storage = { normalize, loadLibrary, setActiveMap, createMap, saveMap, scheduleSave, flushSave, renameMap, deleteMap, exportJSON };
})(window.DistanceDrawing = window.DistanceDrawing || {});
