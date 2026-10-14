/**
 * 颜色列表：渲染 / 交互 / 点击找色定位
 */
window.App = window.App || {};

App.colorList = (function () {
  'use strict';

  const $ = App.utils.$;
  const hexStr = App.utils.hexStr;
  const rgbStr = App.utils.rgbStr;
  const fmtPct = App.utils.fmtPct;
  const fmtCount = App.utils.fmtCount;
  const isChanged = App.utils.isChanged;
  const clamp = App.utils.clamp;

  /** 颜色索引 -> 行元素（点击找色定位用） */
  const rowMap = new Map();

  /* ================= 渲染 ================= */

  function render() {
    const st = App.state;
    const midList = $('midList');
    const prevScroll = midList.scrollTop; // 记录滚动位置，重建后恢复，减少跳动

    const colorList = $('colorList');
    colorList.innerHTML = '';
    rowMap.clear();

    if (st.merge) {
      const groups = App.palette.computeGroups(st.colors, st.tol);

      // 组内所有颜色统一使用 lead 的目标色
      for (const g of groups) {
        const lead = st.colors[g.lead];
        for (const m of g.members) {
          const c = st.colors[m];
          c.tr = lead.tr;
          c.tg = lead.tg;
          c.tb = lead.tb;
        }
      }

      st.lastGroupSig = App.palette.groupSignature(groups);
      $('colorCount').textContent = App.i18n.t('color.groups', { count: groups.length });

      for (const g of groups) {
        const row = makeGroupRow(g);
        g.members.forEach(m => rowMap.set(m, row));
        colorList.appendChild(row);
      }
    } else {
      $('colorCount').textContent = App.i18n.t('color.colors', { count: st.colors.length });
      st.colors.forEach((c, i) => {
        const row = makeColorRow(c, i);
        rowMap.set(i, row);
        colorList.appendChild(row);
      });
    }

    updateResetAllState();

    if (prevScroll > 0) {
      midList.scrollTop = Math.min(prevScroll, midList.scrollHeight);
    }
  }

  function makeColorRow(c, i) {
    const row = document.createElement('div');
    row.className = 'crow';
    if (isChanged(c)) row.classList.add('changed');
    if (c.off) row.classList.add('off');

    const pct = (c.count / App.state.totalPx * 100);

    row.innerHTML =
      '<div class="cbox" style="background:' + rgbStr(c.r, c.g, c.b) + '"></div>' +
      '<div class="cinfo">' +
        '<span class="chex">' + hexStr(c.r, c.g, c.b) + '</span>' +
        '<span class="cpct">' + fmtPct(pct) + ' · ' + fmtCount(c.count) + ' px</span>' +
      '</div>' +
      '<span class="carrow">→</span>' +
      '<label class="cbox pick" style="background:' + rgbStr(c.tr, c.tg, c.tb) + '">' +
        '<input type="color" value="' + hexStr(c.tr, c.tg, c.tb) + '" data-targets="' + i + '">' +
      '</label>' +
      '<button type="button" class="creset" data-targets="' + i + '" title="' + App.i18n.t('color.restore') + '"' + (isChanged(c) ? '' : ' disabled') + '>↺</button>' +
      '<button type="button" class="switch" data-i="' + i + '" aria-pressed="' + (c.off ? 'true' : 'false') + '" title="' + App.i18n.t('color.exclude') + '"></button>';

    return row;
  }

  function makeGroupRow(g) {
    const st = App.state;
    const lead = st.colors[g.lead];
    const n = g.members.length;
    const total = g.members.reduce((s, m) => s + st.colors[m].count, 0);
    const pct = total / st.totalPx * 100;
    const targets = g.members.join(',');

    const row = document.createElement('div');
    row.className = 'crow';
    if (isChanged(lead)) row.classList.add('changed');

    row.innerHTML =
      '<div class="cbox" style="background:' + rgbStr(lead.r, lead.g, lead.b) + '"></div>' +
      '<div class="cinfo">' +
        '<span class="chex">' + hexStr(lead.r, lead.g, lead.b) + '</span>' +
        '<span class="cpct">' + fmtPct(pct) + ' · ' + App.i18n.t('color.merged', { count: n }) + '</span>' +
      '</div>' +
      '<span class="carrow">→</span>' +
      '<label class="cbox pick" style="background:' + rgbStr(lead.tr, lead.tg, lead.tb) + '">' +
        '<input type="color" value="' + hexStr(lead.tr, lead.tg, lead.tb) + '" data-targets="' + targets + '">' +
      '</label>' +
      '<button type="button" class="creset" data-targets="' + targets + '" title="' + App.i18n.t('color.restore') + '"' + (isChanged(lead) ? '' : ' disabled') + '>↺</button>';

    return row;
  }

  /* ================= 点击找色 ================= */

  function pickColor(px, py, fromOutput) {
    const st = App.state;
    const data = fromOutput ? st.outData : st.srcData;
    if (!data) return;

    const w = st.width, h = st.height;
    if (px < 0 || py < 0 || px >= w || py >= h) return;

    const i = (py * w + px) * 4;
    const d = data.data;
    if (d[i + 3] === 0) return;

    const idx = findColorIndex(d[i], d[i + 1], d[i + 2], fromOutput);
    if (idx >= 0) highlightColorIndex(idx);
  }

  function findColorIndex(r, g, b, fromOutput) {
    const cols = App.state.colors;
    const n = cols.length;
    if (!n) return -1;

    // 预览图：优先按目标色匹配（严格距离内）
    if (fromOutput) {
      let bi = -1, bd = Infinity;
      for (let i = 0; i < n; i++) {
        const c = cols[i];
        const dr = r - c.tr, dg = g - c.tg, db = b - c.tb;
        const d2 = dr * dr + dg * dg + db * db;
        if (d2 < bd) { bd = d2; bi = i; }
      }
      if (bi >= 0 && bd <= 4) return bi;
    }

    // 原图：按原色就近匹配
    let bi = -1, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const c = cols[i];
      const dr = r - c.r, dg = g - c.g, db = b - c.b;
      const d2 = dr * dr + dg * dg + db * db;
      if (d2 < bd) { bd = d2; bi = i; }
    }
    return bi;
  }

  function highlightColorIndex(idx) {
    const row = rowMap.get(idx);
    if (!row) return;

    const midList = $('midList');
    const listRect = midList.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const delta = (rowRect.top - listRect.top)
                - (midList.clientHeight - rowRect.height) / 2;
    const target = clamp(midList.scrollTop + delta, 0,
                         Math.max(0, midList.scrollHeight - midList.clientHeight));

    midList.scrollTo({ top: target, behavior: 'smooth' });

    row.classList.remove('flash');
    void row.offsetWidth; // 重排以重启动画
    row.classList.add('flash');

    if (row._flashTimer) clearTimeout(row._flashTimer);
    row._flashTimer = setTimeout(() => {
      row.classList.remove('flash');
      row._flashTimer = null;
    }, 1000);
  }

  /* ================= 列表交互 ================= */

  function bindListEvents() {
    const colorList = $('colorList');

    // 换色
    colorList.addEventListener('input', e => {
      const input = e.target;
      if (input.type !== 'color') return;

      const targets = input.dataset.targets.split(',').map(Number);
      const v = input.value;
      const r = parseInt(v.slice(1, 3), 16);
      const g = parseInt(v.slice(3, 5), 16);
      const b = parseInt(v.slice(5, 7), 16);

      targets.forEach(t => {
        const c = App.state.colors[t];
        if (!c) return;
        c.tr = r;
        c.tg = g;
        c.tb = b;
      });

      const label = input.parentElement;
      label.style.background = rgbStr(r, g, b);

      const row = input.closest('.crow');
      const changed = isChanged(App.state.colors[targets[0]]);
      row.classList.toggle('changed', changed);
      const rb = row.querySelector('.creset');
      if (rb) rb.disabled = !changed;

      updateResetAllState();
      App.processor.schedule(24); // 刷新预览
    });

    // 屏蔽 / 恢复单色
    colorList.addEventListener('click', e => {
      const sw = e.target.closest('.switch');
      if (sw) {
        const i = +sw.dataset.i;
        const c = App.state.colors[i];
        if (!c) return;
        c.off = !c.off;
        sw.setAttribute('aria-pressed', c.off ? 'true' : 'false');
        sw.closest('.crow').classList.toggle('off', c.off);
        App.processor.schedule(24); // 刷新预览
        return;
      }

      const btn = e.target.closest('.creset');
      if (!btn || btn.disabled) return;

      const targets = btn.dataset.targets.split(',').map(Number);
      targets.forEach(t => {
        const c = App.state.colors[t];
        if (!c) return;
        c.tr = Math.round(c.r);
        c.tg = Math.round(c.g);
        c.tb = Math.round(c.b);
      });

      const lead = App.state.colors[targets[0]];
      const row = btn.closest('.crow');
      row.classList.remove('changed');
      const label = row.querySelector('.pick');
      label.style.background = rgbStr(lead.tr, lead.tg, lead.tb);
      const picker = row.querySelector('input[type="color"]');
      if (picker) picker.value = hexStr(lead.tr, lead.tg, lead.tb);
      btn.disabled = true;

      updateResetAllState();
      App.processor.schedule(24); // 刷新预览
    });
  }

  function updateResetAllState() {
    $('resetAllBtn').disabled = !App.state.colors.some(isChanged);
  }

  return {
    render: render,
    pickColor: pickColor,
    updateResetAllState: updateResetAllState,
    bindListEvents: bindListEvents
  };
})();
