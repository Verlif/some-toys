/**
 * 公共用地弹窗（第 58 轮）。
 *
 * 骨架与「拜访邻居」那张弹窗**同一套**（`.npc-board` + `.npc-plots`），
 * 因为它就是一座没有主人的农场：地块一样、照料按钮一样、连成熟后摞出来的
 * 产出图都一样。玩家不需要再学一套新界面。
 *
 * 三处不同：
 *   - 顶部没有主人信息，换成「村庄等级 / 块数 / 现在能收几块」；
 *   - 成熟的地是「拿 1 个」而不是「偷 1 个」—— 先到先得，每人每块地一个；
 *   - 底栏多一颗 📜，看公共地日志（村民也写，所以能看出「谁来过」）。
 */
import { PLAYER_ID } from '../store/state.js';
import { CROPS } from '../data/crops.js';
import { SOILS } from '../data/soils.js';
import { needsPest, needsWater } from '../data/care.js';
import { stageEmoji, stageName, stageOf } from '../data/stages.js';
import {
  commonsCanTake,
  commonsCropRange,
  commonsRemain,
} from '../data/commons.js';
import {
  commonsLogs,
  commonsSnapshot,
  flushCommons,
  pestCommons,
  sowCommons,
  takeCommons,
  waterCommons,
} from '../store/commons.js';
import { fmtDuration } from '../core/utils.js';
import { pileHTML } from '../data/yield-pile.js';
import { notify } from '../store/notify.js';
import { openModal } from './modal.js';
import { recordItemsHTML } from './records.js';

/**
 * 一块公共地的卡片。
 *
 * 与 `ui/friend-modal.js` 的 `plotCardHTML` 同骨架：`.plot-head` 放图、
 * `.plot-body` 放文字（超出裁掉、不滚），`.plot-hang` 把按钮挂在底边框上。
 * 这里只保留公共地用得上的那几样，不去背邻居那套「偷 / 施肥 / 狗」的分支。
 *
 * @param {object} plot
 * @param {number} index
 * @param {number} now
 */
function plotCardHTML(plot, index, now) {
  const soil = plot.soil && plot.soil !== 'normal' ? ` soilbg-${plot.soil}` : '';
  const hang = (html) => {
    const body = String(html || '').trim();
    return body ? `<div class="plot-hang">${body}</div>` : '';
  };
  const base = (extra) => `<div class="npc-plot ${extra.cls || ''}${soil}" data-slot="${index}">
    ${extra.corner || ''}
    <div class="plot-head">${extra.head || ''}</div>
    <div class="plot-body">${extra.body || ''}</div>${hang(extra.hang || '')}</div>`;

  if (!plot.cropId) {
    const info = SOILS[plot.soil] || SOILS.normal;
    return base({
      cls: 'empty',
      head: `<div class="np-emoji">${info.emoji}</div>`,
      body: `<div class="np-name">空地</div><div class="np-meta">村里马上补种</div>`,
    });
  }

  const crop = CROPS[plot.cropId];
  const wantWater = needsWater(plot, now);
  const wantPest = needsPest(plot, now);
  const care = [
    wantWater ? `<button class="icon-btn warn" data-action="commons-water"
      data-plot="${index}" title="浇水（+经验）">💧</button>` : '',
    wantPest ? `<button class="icon-btn warn" data-action="commons-pest"
      data-plot="${index}" title="捉虫（+经验）">🐛</button>` : '',
  ].join('');

  // 产量加成角标：10~30% 绿、40~60% 橙、70~100% 金红（与邻居弹窗同一口径）
  const pct = Math.round((plot.boost || 0) * 100);
  const boost = pct
    ? `<span class="np-corner np-boost b${Math.min(3, Math.ceil(pct / 30))}"
        title="捉虫带来的产量加成">+${pct}%</span>`
    : '';

  // 熟了：先到先得，每人每块地一个
  if (now >= plot.readyAt) {
    const remain = commonsRemain(plot);
    const mine = (plot.takers || []).includes(PLAYER_ID);
    const note = mine
      ? '这一轮你拿过了'
      : remain > 0 ? `还剩 ${remain} 份 · 先到先得` : '已经被拿光了';
    return base({
      cls: remain > 0 && !mine ? 'ripe' : 'stolen',
      corner: boost,
      head: `<div class="np-art">${pileHTML(crop.emoji, Math.max(1, remain), `commons-${plot.id ?? index}`)}</div>`,
      body: `<div class="np-name">${crop.name}</div><div class="np-meta${remain > 0 && !mine ? ' ripe-meta' : ''}">${note}</div>`,
      hang: commonsCanTake(plot, PLAYER_ID)
        ? `<button class="btn small harvest" data-action="commons-take" data-plot="${index}">拿 1 个</button>${care}`
        : care,
    });
  }

  const stage = stageOf(plot, crop, now);
  return base({
    cls: wantWater || wantPest ? 'care' : '',
    corner: boost,
    head: `<div class="np-emoji">${stageEmoji(crop, stage)}</div>`,
    body: `
      <div class="np-name">${crop.name}</div>
      <div class="np-meta">${stageName(stage)}</div>
      <div class="np-time">${fmtDuration(plot.readyAt - now)}</div>`,
    hang: care,
  });
}

/**
 * 顶部那一行：等级 / 块数 / 能收几块 / 📜 日志。
 *
 * `data-role` 刻意不叫 `board` —— 邻居弹窗（friend-modal.js）用
 * `document.querySelector('#modal [data-role="board"]')` 整块重绘它的控制台，
 * 撞名的话两边谁先刷就把对方那行换成自己的内容。
 */
function boardHTML(snap) {
  const [lo, hi] = commonsCropRange(snap.level);
  return `
    <div class="npc-board" data-role="commons-board">
      <div class="npc-board-top">
        <span class="npc-board-title">🏞 公共地 <b>${snap.total}</b> 块</span>
        <span class="friend-chip">Lv.${snap.level} 村 · 作物 ${lo}~${hi} 级</span>
        <button class="npc-chip icon" data-action="commons-log" title="公共地日志（最近 7 天）">📜</button>
      </div>
      <div class="npc-board-bot">
        <div class="npc-board-acts">
          <span class="friend-chip ${snap.ripe ? 'buddy' : ''}">${
  snap.ripe ? `🧺 现在能收 ${snap.ripe} 块` : '🌱 还没有能收的'
}</span>
          ${snap.mine ? `<span class="friend-chip">这一轮你已拿 ${snap.mine} 份</span>` : ''}
        </div>
      </div>
    </div>`;
}

/** 公共地日志：独立叠层，关掉回到地块列表 */
function openCommonsLog() {
  const list = commonsLogs();
  openModal(`
    <div class="modal-head">
      <h3>📜 公共地日志</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">最近 7 天 · 你和村民在这片地上做的事都记在这儿</div>
    <div class="news-list">
      ${list.length
        ? recordItemsHTML(list, { withDay: true })
        : '<div class="empty-tip">📭<br>这片地还很安静<br>去浇浇水、拿一份菜吧</div>'}
    </div>
  `, null, 'board-modal');
}

/** 打开公共用地 */
export function openCommonsModal() {
  // 先补种再渲染：世界时钟可能一步都没走（刚开新档 / 页面停了一会儿），
  // 不补种第一屏就是一片「空地 · 村里马上补种」。
  // 种下了就顺手落一次盘 —— 否则玩家看两分钟关掉页面再回来，
  // 地里换成了另一种作物，像是出了 bug
  if (sowCommons()) flushCommons().catch(() => {});

  const snap = commonsSnapshot();

  /** 整片地块重绘（拿一份之后状态会变） */
  function paintPlots() {
    const card = document.querySelector('#modal .modal-card');
    if (!card) return;
    const at = Date.now();
    const fresh = commonsSnapshot(at);
    const grid = card.querySelector('[data-role="commons-plots"]');
    if (grid) grid.innerHTML = fresh.plots.map((p, i) => plotCardHTML(p, i, at)).join('');
    const board = card.querySelector('[data-role="commons-board"]');
    if (board) board.outerHTML = boardHTML(fresh);
  }

  openModal(`
    <div class="modal-head">
      <h3>🏞 公共用地</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">村里的地 · 系统播种 · 谁都能照料，熟了先到先得（每块地每人 1 份）</div>

    ${boardHTML(snap)}
    <div class="npc-plots" data-role="commons-plots">
      ${snap.plots.map((plot, i) => plotCardHTML(plot, i, Date.now())).join('')}
    </div>

    <p class="npc-tip">浇水捉虫照常给经验；收东西不给经验 —— 这块地没花谁的种子，白拿还给经验就成了刷分。</p>
  `, async (action, el) => {
    const plotId = Number(el.dataset.plot);
    if (action === 'commons-log') {
      openCommonsLog();
      return;
    }
    if (action === 'commons-water') {
      if (await waterCommons(plotId)) paintPlots();
      return;
    }
    if (action === 'commons-pest') {
      if (await pestCommons(plotId)) paintPlots();
      return;
    }
    if (action === 'commons-take') {
      const res = await takeCommons(plotId);
      if (!res.ok) notify(res.reason || '拿不了');
      paintPlots();
    }
  });
}
