/**
 * 农场主页面：地块网格。
 *
 * 渲染采用 key-diff：只有地块的关键状态（作物/是否浇水/土壤/成熟阶段…）
 * 变化时才重建该地块的 DOM，平时只更新进度条与倒计时，
 * 避免 500ms 一次的心跳把整页刷掉。
 */
import { byId, delegate } from '../../core/dom.js';
import { on, EVENTS } from '../../core/bus.js';
import { state } from '../../store/state.js';
import * as farm from '../../store/farm.js';
import { count } from '../../store/inventory.js';
import { CROPS, CROP_IDS } from '../../data/crops.js';
import { SOILS } from '../../data/soils.js';
import { PLOT_UNLOCK_LV } from '../../data/progression.js';
import { seedId } from '../../data/keys.js';
import { SEED_MODAL_FILTERS } from '../../data/navigation.js';
import { stageEmoji, stageName, stageOf } from '../../data/stages.js';
import { fmtDuration } from '../../core/utils.js';
import { closeModal, openModal } from '../modal.js';

/** plotId → { el, key, bar, time } */
const nodes = new Map();

let grid = null;

/* ---------- 单块地的内容 ---------- */

function lockedHTML(plot) {
  return `
    <div class="plot-lock">🔒</div>
    <div class="plot-sub">Lv.${PLOT_UNLOCK_LV[plot.id]} 解锁</div>`;
}

function emptyHTML(plot) {
  const soil = SOILS[plot.soil];
  return `
    <div class="plot-emoji empty">🌱</div>
    <div class="plot-sub">空闲土地</div>
    <span class="soil-tag ${soil.cls}">${soil.tag}</span>
    <button class="btn small" data-action="plant" data-id="${plot.id}">播 种</button>`;
}

function growingHTML(plot) {
  const crop = CROPS[plot.cropId];
  const warn = (plot.weed ? '🌿' : '') + (plot.pest ? '🐛' : '');
  return `
    <div class="plot-emoji" data-role="stage">${crop.emoji}</div>
    <div class="plot-name">${crop.name}</div>
    <div class="plot-sub" data-role="phase"></div>
    ${warn ? '<div class="plot-sub" style="color:var(--danger)">' + warn + ' 需要处理</div>' : ''}
    <div class="bar"><i style="width:0%"></i></div>
    <div class="ptime"></div>
    <div class="plot-acts">
      ${plot.weed ? '<button class="icon-btn" data-action="weed" data-id="' + plot.id + '" title="除草">🌿</button>' : ''}
      ${plot.pest ? '<button class="icon-btn" data-action="pest" data-id="' + plot.id + '" title="除虫">🐛</button>' : ''}
      ${plot.watered ? '' : '<button class="icon-btn" data-action="water" data-id="' + plot.id + '" title="浇水 -30%">💧</button>'}
      ${plot.fert ? '' : '<button class="icon-btn" data-action="fert" data-id="' + plot.id + '" title="普通化肥">🧪</button>'}
      ${plot.organic ? '' : '<button class="icon-btn" data-action="organic" data-id="' + plot.id + '" title="有机化肥">⚗️</button>'}
    </div>`;
}

function ripeHTML(plot) {
  const crop = CROPS[plot.cropId];
  const warn = (plot.weed ? '🌿' : '') + (plot.pest ? '🐛' : '');
  const left = crop.harvests - (plot.harvested || 0);
  return `
    <div class="plot-emoji">${crop.emoji}</div>
    <div class="plot-name">${crop.name} · 成熟</div>
    <div class="plot-sub">${left > 1 ? `还可收获 ${left - 1} 次` : '最后一次收获'}</div>
    ${warn ? '<div class="plot-sub" style="color:var(--danger)">' + warn + ' 有状况</div>' : ''}
    <button class="btn small harvest" data-action="harvest" data-id="${plot.id}">收 获</button>`;
}

function plotInnerHTML(plot, status) {
  if (status === 'locked') return lockedHTML(plot);
  if (status === 'empty') return emptyHTML(plot);
  if (status === 'ripe') return ripeHTML(plot);
  return growingHTML(plot);
}

/** 决定一块地是否需要重建 DOM 的指纹 */
function plotKey(plot, status) {
  return [
    status, plot.cropId || '', plot.soil, plot.harvested || 0,
    plot.watered ? 1 : 0, plot.fert ? 1 : 0, plot.organic ? 1 : 0,
    plot.weed ? 1 : 0, plot.pest ? 1 : 0,
  ].join('|');
}

/* ---------- 渲染 ---------- */

/** 解锁地块超过这个数量就切紧凑排布 */
const DENSE_THRESHOLD = 15;

/** 折叠行在 nodes 里的哨兵 key */
const FOLD_KEY = '__locked-more';

/**
 * 未解锁地块最多只画第一个，其余全部折叠成一行汇总。
 * 40 块地逐个画锁图标既占地方又没有信息量。
 */
function foldHTML(count, nextLv) {
  return `
    <div class="plot-fold">
      <div class="plot-fold-icon">🔒</div>
      <div class="plot-fold-text">
        还有 <b>${count}</b> 块地待解锁
        ${nextLv ? `· 下一块在 <b>Lv.${nextLv}</b>` : ''}
      </div>
    </div>`;
}

/** 重绘农场（内部按块做 diff） */
export function renderFarm() {
  if (!grid) grid = byId('plots');
  if (!grid) return;

  const unlocked = farm.unlockedPlotCount();
  const lockedCount = state.plots.length - unlocked;
  let firstLocked = null;
  let lastLocked = null;

  for (const plot of state.plots) {
    const status = farm.plotStatus(plot);
    const key = plotKey(plot, status);

    // 锁定的地块只渲染第一个
    if (status === 'locked') {
      if (firstLocked === null) firstLocked = plot.id;
      lastLocked = plot.id;
      if (firstLocked !== plot.id) continue;
    }

    const node = ensureNode(plot.id, key, plot, status);
    updateNode(node, plot, status, key);
  }

  // 折叠行
  const foldNode = ensureNode(FOLD_KEY, `fold-${lockedCount}-${lastLocked}`, null, 'fold');
  if (lockedCount > 1) {
    updateNode(foldNode, { id: FOLD_KEY, count: lockedCount - 1, nextLv: PLOT_UNLOCK_LV[lastLocked] },
      'fold', `fold-${lockedCount}-${lastLocked}`);
  } else {
    foldNode.el.remove();
    nodes.delete(FOLD_KEY);
  }

  grid.classList.toggle('dense', unlocked > DENSE_THRESHOLD);
}

/** 取（或创建）某个地块的 DOM 节点 */
function ensureNode(id, key, plot, status) {
  let node = nodes.get(id);
  if (!node) {
    const el = document.createElement('div');
    grid.appendChild(el);
    node = { el, key: '', bar: null, time: null };
    nodes.set(id, node);
  }
  return node;
}

/** 按需重建节点内容；状态没变就只更新进度条与阶段 */
function updateNode(node, plot, status, key) {
  if (node.key !== key) {
    node.key = key;
    if (status === 'fold') {
      node.el.className = 'plot-fold';
      node.el.innerHTML = foldHTML(plot.count, plot.nextLv);
      return;
    }

    const warn = status !== 'locked' && farm.hasIssue(plot);
    node.el.className = 'plot' + (
      status === 'locked' ? ' locked'
        : warn ? ' warn'
          : status === 'ripe' ? ' ripe'
            : status === 'growing' ? ' growing' : ''
    );
    node.el.innerHTML = plotInnerHTML(plot, status);
    node.bar = node.el.querySelector('.bar > i');
    node.time = node.el.querySelector('.ptime');
    node.stageEl = node.el.querySelector('[data-role="stage"]');
    node.phaseEl = node.el.querySelector('[data-role="phase"]');
  }

  if (status !== 'growing') return;
  const crop = CROPS[plot.cropId];
  const stage = stageOf(plot, crop);
  if (node.stageEl) node.stageEl.textContent = stageEmoji(crop, stage);
  if (node.phaseEl) {
    node.phaseEl.textContent = (plot.harvested ? `第 ${plot.harvested + 1} 轮 · ` : '')
      + stageName(stage);
  }
  if (node.bar) node.bar.style.width = `${farm.growProgress(plot) * 100}%`;
  if (node.time) node.time.textContent = fmtDuration(plot.readyAt - Date.now());
}

/** 种子弹窗的筛选档位 */
let seedFilter = 'owned';

/* ---------- 选择种子弹窗 ---------- */

function seedCardHTML(cropId) {
  const crop = CROPS[cropId];
  const locked = state.player.level < crop.lv;
  const owned = count(seedId(cropId));

  let action;
  if (locked) {
    action = `<div class="seed-lock">Lv.${crop.lv} 解锁</div>`;
  } else if (owned > 0) {
    action = `<button class="btn small" data-action="plant" data-crop="${cropId}">种植 ×${owned}</button>`;
  } else {
    action = `<button class="btn small ghost" data-action="buy-plant" data-crop="${cropId}">购买 💰${crop.seed}</button>`;
  }

  return `
    <div class="seed-card ${locked ? 'locked' : ''}">
      <div class="seed-emoji">${crop.emoji}</div>
      <div class="seed-name">${crop.name}</div>
      <div class="seed-meta">${fmtDuration(crop.grow * 1000)}成熟<br>收 ${crop.yield[0]}-${crop.yield[1]} 个${
  crop.harvests > 1 ? ` · 共 ${crop.harvests} 茬` : ''
}</div>
      ${action}
    </div>`;
}

/**
 * 打开「选择种子」弹窗。
 *
 * 145 种作物全列出来在手机上要滚很久，所以默认只显示
 * 「有存货」和「当前等级能种」这两类，剩下 145 张卡片要翻全量才看得到。
 *
 * 注意：原版这里漏绑了 plant / buy-plant 两个按钮的事件，
 * 导致播种流程完全走不通，本次重构已修正。
 */
function openPlantModal(plotId) {
  const plot = state.plots.find((p) => p.id === plotId);
  if (!plot) return;
  const soil = SOILS[plot.soil];

  const shown = CROP_IDS.filter((id) => {
    if (seedFilter === 'all') return true;
    if (seedFilter === 'owned') return count(seedId(id)) > 0;
    return state.player.level >= CROPS[id].lv;
  });

  const chips = SEED_MODAL_FILTERS.map((f) => `
    <button class="filter-chip ${f.key === seedFilter ? 'active' : ''}"
            data-action="filter-seeds" data-id="${f.key}">${f.label}</button>`).join('');

  openModal(`
    <div class="modal-head">
      <h3>选择种子 · ${soil.name}</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;padding:0 2px">
      该地块加成：产量 ×${soil.yieldMul} · 成熟时间 ×${soil.timeMul}
    </div>
    <div class="shop-filter" style="padding:0 0 10px">${chips}
      <span class="shop-filter-count">${shown.length} / ${CROP_IDS.length}</span>
    </div>
    ${shown.length
      ? `<div class="seed-grid">${shown.map(seedCardHTML).join('')}</div>`
      : '<div class="empty-tip">🪙<br>这个分类下暂时没有种子<br>换个筛选或去商店买一点吧</div>'}
  `, async (action, el) => {
    if (action === 'filter-seeds') {
      seedFilter = el.dataset.id;
      openPlantModal(plotId);
      return;
    }
    const cropId = el.dataset.crop;
    let ok = false;
    if (action === 'plant') ok = await farm.plant(plotId, cropId);
    else if (action === 'buy-plant') ok = await farm.buyAndPlant(plotId, cropId);
    if (ok) closeModal();
  });
}

/* ---------- 挂载 ---------- */

const PLOT_ACTIONS = {
  plant: (id) => openPlantModal(id),
  water: (id) => farm.water(id),
  fert: (id) => farm.fertilize(id, 'fertilizer'),
  organic: (id) => farm.fertilize(id, 'organic'),
  weed: (id) => farm.clearWeed(id),
  pest: (id) => farm.clearPest(id),
  harvest: (id) => farm.harvest(id),
};

export function mountFarm() {
  grid = byId('plots');

  delegate(grid, 'click', '[data-action]', (el) => {
    PLOT_ACTIONS[el.dataset.action]?.(Number(el.dataset.id));
  });

  on(EVENTS.PLAYER, renderFarm);
  on(EVENTS.FARM, renderFarm);
  on(EVENTS.INVENTORY, renderFarm);
}