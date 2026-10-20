/**
 * 农场主页面：地块网格。
 *
 * 渲染采用 key-diff：只有地块的关键状态（作物/是否浇水/土壤/成熟阶段…）
 * 变化时才重建该地块的 DOM，平时只更新进度条与倒计时，
 * 避免 500ms 一次的心跳把整页刷掉。
 */
import { byId, delegate } from '../../core/dom.js';
import { emit, on, EVENTS } from '../../core/bus.js';
import { state } from '../../store/state.js';
import * as farm from '../../store/farm.js';
import { count } from '../../store/inventory.js';
import { CROPS, CROP_IDS, KIND_LABELS, totalCycleExp, totalCycleSeconds } from '../../data/crops.js';
import { FERTILIZER_IDS, ITEMS, PESTICIDE_ID, SPRINKLER_ID } from '../../data/items.js';
import { SOILS } from '../../data/soils.js';
import { PLOT_UNLOCK_LV } from '../../data/progression.js';
import { seedId } from '../../data/keys.js';
import { stageEmoji, stageName, stageOf } from '../../data/stages.js';
import { fmtDuration } from '../../core/utils.js';
import { stackClass, yieldClass } from '../meta-tags.js';
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

/** 缺水 / 生虫的提示条 */
function careWarnHTML(plot) {
  const parts = [];
  if (farm.needsWater(plot)) parts.push('💧 缺水');
  if (farm.needsPest(plot)) parts.push('🐛 生虫');
  if (!parts.length) return '';
  return `<div class="plot-sub warn-text">${parts.join('　')}</div>`;
}

/** 缺水 / 生虫的操作按钮（红底警示） */
function careButtonsHTML(plot) {
  const out = [];
  if (farm.needsWater(plot)) {
    out.push(`<button class="icon-btn warn" data-action="water" data-id="${plot.id}"
      title="浇水：当前生长阶段缩短 10%">💧</button>`);
  }
  if (farm.needsPest(plot)) {
    out.push(`<button class="icon-btn warn" data-action="pest" data-id="${plot.id}"
      title="捉虫：这块地的产量 +10%">🐛</button>`);
  }
  return out.join('');
}

/**
 * 产量加成角标：钉在地块左上角，不占正文的流。
 * 10~30% 绿、40~60% 橙、70~100% 金红 —— 一眼看出这块地攒了多少加成。
 */
function boostHTML(plot) {
  if (!plot.boost) return '';
  const pct = Math.round(plot.boost * 100);
  const tier = Math.min(3, Math.ceil(pct / 30));
  return `<span class="plot-corner b${tier}" title="捉虫带来的产量加成">+${pct}%</span>`;
}

function growingHTML(plot) {
  const crop = CROPS[plot.cropId];
  return `
    ${boostHTML(plot)}
    <div class="plot-emoji" data-role="stage">${crop.emoji}</div>
    <div class="plot-name">${crop.name}</div>
    <div class="plot-sub" data-role="phase"></div>
    ${careWarnHTML(plot)}
    <div class="bar"><i style="width:0%"></i></div>
    <div class="ptime"></div>
    <div class="plot-acts">
      ${careButtonsHTML(plot)}
      ${plot.fert ? '' : '<button class="icon-btn" data-action="fert" data-id="' + plot.id + '" title="施肥">🧪</button>'}
    </div>`;
}

function ripeHTML(plot) {
  const crop = CROPS[plot.cropId];
  const left = crop.harvests - (plot.harvested || 0);
  return `
    ${boostHTML(plot)}
    <div class="plot-emoji">${crop.emoji}</div>
    <div class="plot-name">${crop.name} · 成熟</div>
    <div class="plot-sub">${left > 1 ? `还可收获 ${left - 1} 次` : '最后一次收获'}</div>
    ${careWarnHTML(plot)}
    <div class="plot-acts ripe-acts">${careButtonsHTML(plot)}</div>
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
  const now = Date.now();
  return [
    status, plot.cropId || '', plot.soil, plot.harvested || 0,
    plot.fert ? 1 : 0,
    Math.round(plot.boost || 0),
    // 缺水 / 生虫是随时间出现的，指纹里要带上，否则按钮不会冒出来
    farm.needsWater(plot, now) ? 1 : 0,
    farm.needsPest(plot, now) ? 1 : 0,
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

  for (const plot of state.plots) {
    const status = farm.plotStatus(plot);
    const key = plotKey(plot, status);

    // 锁定的地块只渲染第一个
    if (status === 'locked') {
      if (firstLocked === null) firstLocked = plot.id;
      if (firstLocked !== plot.id) continue;
    }

    const node = ensureNode(plot.id, key, plot, status);
    updateNode(node, plot, status, key);
  }

  // 折叠行
  // 「下一块在 Lv.X 解锁」说的是**紧跟着已解锁部分的那一块**，
  // 也就是 id = 已解锁数量的那块。之前错用了最后一块锁定地，
  // 于是永远显示 Lv200。
  const nextLv = firstLocked === null ? 0 : PLOT_UNLOCK_LV[firstLocked];
  const foldKey = `fold-${lockedCount}-${nextLv}`;
  const foldNode = ensureNode(FOLD_KEY, foldKey, null, 'fold');
  if (lockedCount > 1) {
    updateNode(foldNode, { id: FOLD_KEY, count: lockedCount - 1, nextLv }, 'fold', foldKey);
  } else {
    foldNode.el.remove();
    nodes.delete(FOLD_KEY);
  }

  grid.classList.toggle('dense', unlocked > DENSE_THRESHOLD);
  renderFarmTools();
}

/**
 * 底部的一键照料条。
 *
 * 只有背包里真有洒水器 / 杀虫剂时才出现；按钮上的数字是「待处理块数」，
 * 后面的 ×N 是道具存量。数量或需求数没变就不重建 DOM，
 * 否则 500ms 一次的心跳会把正在按的按钮换掉。
 */
let toolsKey = '';

function renderFarmTools() {
  const el = byId('farmTools');
  if (!el) return;

  const water = count(SPRINKLER_ID);
  const pest = count(PESTICIDE_ID);
  if (!water && !pest) {
    if (toolsKey) {
      toolsKey = '';
      el.hidden = true;
      el.innerHTML = '';
      document.body.classList.remove('has-farm-tools');
    }
    return;
  }

  const now = Date.now();
  const needWater = state.plots.filter((p) => farm.needsWater(p, now)).length;
  const needPest = state.plots.filter((p) => farm.needsPest(p, now)).length;
  const key = `${water}|${pest}|${needWater}|${needPest}`;
  if (key === toolsKey) return;
  toolsKey = key;

  el.hidden = false;
  document.body.classList.add('has-farm-tools');
  el.innerHTML = [
    water ? `<button class="tool-btn" data-action="water-all" ${needWater ? '' : 'disabled'}>
      🚿 一键浇水${needWater ? `（${needWater} 块）` : '· 暂无需求'} <span class="tool-count">×${water}</span></button>` : '',
    pest ? `<button class="tool-btn" data-action="pest-all" ${needPest ? '' : 'disabled'}>
      🧴 一键杀虫${needPest ? `（${needPest} 块）` : '· 暂无需求'} <span class="tool-count">×${pest}</span></button>` : '',
  ].join('');
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

/* ---------- 选择种子弹窗 ---------- */

/**
 * 种子选择用**条状卡片**：145 种作物如果用方格排布，一屏放不下几行，
 * 换成横条才能把「售价 / 总耗时 / 收获次数 / 每次产量 / 预计收益」都摆出来。
 */
function seedCardHTML(cropId) {
  const crop = CROPS[cropId];
  const owned = count(seedId(cropId));

  // 预计收益：一整个周期的总经验与总金币（用平均产量估算）
  const amount = (crop.yield[0] + crop.yield[1]) / 2;
  const cycle = totalCycleSeconds(crop);
  const exp = totalCycleExp(crop, amount);

  return `
    <div class="seed-row">
      <div class="seed-row-emoji">${crop.emoji}</div>
      <div class="seed-row-body">
        <div class="seed-row-top">
          <span class="seed-row-name">${crop.name}</span>
          <span class="seed-row-kind kind-${crop.kind}">${KIND_LABELS[crop.kind]?.label || ''}</span>
          ${crop.multi ? '<span class="seed-row-kind kind-multi">多茬</span>' : ''}
          ${crop.special ? '<span class="seed-row-kind kind-special">限定</span>' : ''}
          ${crop.slow ? '<span class="seed-row-kind kind-slow">厚积薄发</span>' : ''}
        </div>
        <div class="seed-row-meta">
          <span class="meta-tag">🌱 存货 ${owned}</span>
          <span class="meta-tag lv">Lv.${crop.lv}</span>
          <span class="meta-tag time">⏱ ${fmtDuration(cycle * 1000)}</span>
          <span class="meta-tag stack ${stackClass(crop.harvests)}">🧺 ${crop.harvests} 茬</span>
          <span class="meta-tag yield ${yieldClass(crop.yield[1])}">🌾 ${crop.yield[0]}-${crop.yield[1]}</span>
          <span class="meta-tag price">💰 ${crop.sell}</span>
        </div>
        <div class="seed-row-gain">
          预计收益　经验 <b>${exp.toLocaleString()}</b>　售价 <b>${crop.sell}</b>/个
        </div>
      </div>
      <div class="seed-row-act">
        <button class="btn small" data-action="plant" data-crop="${cropId}">种 下</button>
      </div>
    </div>`;
}

/**
 * 打开「选择种子」弹窗。
 *
 * 只列出背包里**真有存货**的种子 —— 没种子就不该出现在这里，
 * 需要买种子的走右上角的「商店」按钮。
 * 少一层筛选，玩家的路径也更短：点地 → 点种子 → 种下。
 */
function openPlantModal(plotId) {
  const plot = state.plots.find((p) => p.id === plotId);
  if (!plot) return;
  const soil = SOILS[plot.soil];
  const owned = CROP_IDS.filter((id) => count(seedId(id)) > 0);

  openModal(`
    <div class="modal-head">
      <h3>播种 · ${soil.name}</h3>
      <div class="modal-head-acts">
        <button class="btn small ghost" data-action="go-shop">🏪 商店</button>
        <button class="close" data-close>✕</button>
      </div>
    </div>
    <div class="modal-sub">该地块加成：产量 ×${soil.yieldMul} · 成熟时间 ×${soil.timeMul}</div>
    ${owned.length
      ? `<div class="seed-list">${owned.map(seedCardHTML).join('')}</div>`
      : `<div class="empty-tip">🌱<br>背包里还没有种子<br>去商店买一点再来吧</div>
         <button class="btn" style="width:100%" data-action="go-shop">去商店买种子</button>`}
  `, async (action, el) => {
    if (action === 'go-shop') {
      closeModal();
      // 买种子：直接落在种子 tab，不用玩家再点一次
      emit(EVENTS.NAVIGATE, { page: 'shop', tab: 'seed' });
      return;
    }
    if (action === 'plant' && await farm.plant(plotId, el.dataset.crop)) closeModal();
  });
}

/* ---------- 施肥弹窗 ---------- */

/**
 * 五档普通化肥 + 有机化肥，按背包存货列出来。
 *
 * 之前每块地上直接摆两个按钮（普通 / 有机），现在肥料的档位多了，
 * 一格根本放不下，改成「点一下 🧪 → 选一档」——
 * 顺便能在同一个面板里把「这块地已经用过什么」讲清楚。
 */
function openFertModal(plotId) {
  const plot = state.plots.find((p) => p.id === plotId);
  if (!plot || !plot.cropId || Date.now() >= plot.readyAt) return;

  const crop = CROPS[plot.cropId];
  const rows = FERTILIZER_IDS.map((id) => {
    const item = ITEMS[id];
    const owned = count(id);
    const used = item.instant ? plot.organic : plot.fert;
    const disabled = !owned || used;
    const note = used
      ? (item.instant ? '这块地已经用过有机化肥了' : '这块地这轮已经施过普通化肥了')
      : item.desc;

    return `
      <div class="shop-item ${disabled ? 'locked' : ''}">
        <div class="si-emoji">${item.emoji}</div>
        <div class="si-body">
          <div class="si-name">${item.name} <span class="si-own">· 拥有 ${owned}</span></div>
          <div class="si-meta">${note}</div>
        </div>
        <button class="btn small ${disabled ? '' : 'ghost'}" ${disabled ? 'disabled' : ''}
                data-action="apply-fert" data-plot="${plotId}" data-item="${id}">使用</button>
      </div>`;
  }).join('');

  openModal(`
    <div class="modal-head">
      <h3>🧪 施肥 · ${crop.emoji}${crop.name}</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">
      还剩 ${fmtDuration(plot.readyAt - Date.now())} · 普通化肥每轮限一次，有机化肥另算一次
    </div>
    <div class="list">${rows}</div>
  `, async (action, el) => {
    if (action === 'apply-fert') {
      const ok = await farm.fertilize(Number(el.dataset.plot), el.dataset.item);
      if (ok) closeModal();
    }
  });
}

/* ---------- 挂载 ---------- */

const PLOT_ACTIONS = {
  plant: (id) => openPlantModal(id),
  water: (id) => farm.water(id),
  pest: (id) => farm.catchPest(id),
  fert: (id) => openFertModal(id),
  harvest: (id) => farm.harvest(id),
};

/** 底部一键照料按钮：与地块上的单块操作是两套入口 */
const FARM_TOOL_ACTIONS = {
  'water-all': () => farm.waterAll(),
  'pest-all': () => farm.catchPestAll(),
};

export function mountFarm() {
  grid = byId('plots');

  delegate(grid, 'click', '[data-action]', (el) => {
    PLOT_ACTIONS[el.dataset.action]?.(Number(el.dataset.id));
  });

  const tools = byId('farmTools');
  if (tools) {
    delegate(tools, 'click', '[data-action]', (el) => {
      FARM_TOOL_ACTIONS[el.dataset.action]?.(el);
    });
  }

  on(EVENTS.PLAYER, renderFarm);
  on(EVENTS.FARM, renderFarm);
  on(EVENTS.INVENTORY, renderFarm);
}