/**
 * 核心处理：按主色 + 容差替换像素，输出到预览画布
 */
window.App = window.App || {};

App.processor = (function () {
  'use strict';

  const $ = App.utils.$;
  const isChanged = App.utils.isChanged;

  let timer = null;

  function process() {
    const st = App.state;
    if (!st.srcData) return;

    const t0 = performance.now();

    const sd = st.srcData.data;
    const w = st.width, h = st.height;

    if (!st.outData || st.outData.width !== w || st.outData.height !== h) {
      st.outData = new ImageData(w, h);
    }
    const od = st.outData.data;

    const cols = st.colors;
    const n = cols.length;
    const tol = st.tol;

    // 扁平化属性，减少热循环中的对象访问
    const pr = new Float64Array(n), pg = new Float64Array(n), pb = new Float64Array(n);
    const tr = new Uint8Array(n), tg = new Uint8Array(n), tb = new Uint8Array(n);
    const hasT = new Uint8Array(n);
    const off = new Uint8Array(n);

    for (let i = 0; i < n; i++) {
      const c = cols[i];
      pr[i] = c.r;
      pg[i] = c.g;
      pb[i] = c.b;
      tr[i] = c.tr;
      tg[i] = c.tg;
      tb[i] = c.tb;
      hasT[i] = isChanged(c) ? 1 : 0;
      off[i] = c.off ? 1 : 0;
    }

    const cache = new Map();
    const len = sd.length;

    for (let i = 0; i < len; i += 4) {
      const a = sd[i + 3];
      if (a === 0) { od[i + 3] = 0; continue; }

      const r = sd[i], g = sd[i + 1], b = sd[i + 2];
      const key = (r << 16) | (g << 8) | b;

      let packed = cache.get(key);

      if (packed === undefined) {
        let bi = -1, bd = Infinity;
        for (let k = 0; k < n; k++) {
          const dr = r - pr[k], dg = g - pg[k], db = b - pb[k];
          if (dr > tol || dr < -tol) continue;
          if (dg > tol || dg < -tol) continue;
          if (db > tol || db < -tol) continue;
          const d2 = dr * dr + dg * dg + db * db;
          if (d2 < bd) { bd = d2; bi = k; }
        }
        packed = (bi >= 0 && hasT[bi] && !off[bi])
          ? ((tr[bi] << 16) | (tg[bi] << 8) | tb[bi])
          : key;
        cache.set(key, packed);
      }

      od[i] = (packed >> 16) & 255;
      od[i + 1] = (packed >> 8) & 255;
      od[i + 2] = packed & 255;
      od[i + 3] = a;
    }

    $('outCanvas').getContext('2d').putImageData(st.outData, 0, 0);

    const ms = performance.now() - t0;
    $('msVal').textContent = ms < 1 ? '<1ms' : Math.round(ms) + 'ms';
  }

  /** 防抖调度 */
  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(process, delay || 40);
  }

  return {
    process: process,
    schedule: schedule
  };
})();
