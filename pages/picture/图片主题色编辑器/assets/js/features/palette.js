/**
 * 调色板提取与容差分组
 */
window.App = window.App || {};

App.palette = (function () {
  'use strict';

  /**
   * 从 ImageData 提取主色
   * 4bit 分箱统计 -> 预合并相近色 -> 按像素数排序 -> 取前 maxColors 个
   */
  function extractPalette(imgData, maxColors) {
    const d = imgData.data;
    const len = d.length;
    const bins = new Map();
    let totalPx = 0;

    for (let i = 0; i < len; i += 4) {
      if (d[i + 3] < 16) continue;
      totalPx++;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      let bin = bins.get(key);
      if (!bin) { bin = { n: 0, r: 0, g: 0, b: 0 }; bins.set(key, bin); }
      bin.n++;
      bin.r += r;
      bin.g += g;
      bin.b += b;
    }

    const arr = [];
    for (const bin of bins.values()) {
      arr.push({ n: bin.n, r: bin.r / bin.n, g: bin.g / bin.n, b: bin.b / bin.n });
    }
    arr.sort((a, b) => b.n - a.n);

    const M2 = App.config.MERGE_DIST * App.config.MERGE_DIST;
    const picked = [];
    const SCAN = Math.min(arr.length, 300);

    for (let i = 0; i < SCAN; i++) {
      const c = arr[i];
      let hit = null;
      for (let k = 0; k < picked.length; k++) {
        const p = picked[k];
        const dr = p.r - c.r, dg = p.g - c.g, db = p.b - c.b;
        if (dr * dr + dg * dg + db * db < M2) { hit = p; break; }
      }
      if (hit) {
        const t = hit.n + c.n;
        hit.r = (hit.r * hit.n + c.r * c.n) / t;
        hit.g = (hit.g * hit.n + c.g * c.n) / t;
        hit.b = (hit.b * hit.n + c.b * c.n) / t;
        hit.n = t;
      } else if (picked.length < maxColors * 3) {
        picked.push({ n: c.n, r: c.r, g: c.g, b: c.b });
      }
    }

    picked.sort((a, b) => b.n - a.n);
    return { colors: picked.slice(0, maxColors), totalPx: totalPx || 1 };
  }

  /**
   * 按容差做并查集分组
   * @returns [{ members: [idx...], lead: idx }] lead 为组内像素数最多的颜色
   */
  function computeGroups(colors, tol) {
    const n = colors.length;
    if (!n) return [];

    const parent = Array.from({ length: n }, (_, i) => i);
    function find(x) {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    function union(a, b) {
      a = find(a);
      b = find(b);
      if (a !== b) parent[b] = a;
    }

    for (let i = 0; i < n; i++) {
      const a = colors[i];
      for (let j = i + 1; j < n; j++) {
        const b = colors[j];
        const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
        if (Math.abs(dr) <= tol && Math.abs(dg) <= tol && Math.abs(db) <= tol) union(i, j);
      }
    }

    const map = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!map.has(r)) map.set(r, []);
      map.get(r).push(i);
    }

    return Array.from(map.values()).map(members => {
      let lead = members[0];
      for (const m of members) {
        if (colors[m].count > colors[lead].count) lead = m;
      }
      return { members: members, lead: lead };
    });
  }

  /** 分组结构签名，用于判断分组是否发生变化 */
  function groupSignature(groups) {
    return groups.map(g => g.members.join('.')).join('|');
  }

  return {
    extractPalette: extractPalette,
    computeGroups: computeGroups,
    groupSignature: groupSignature
  };
})();
