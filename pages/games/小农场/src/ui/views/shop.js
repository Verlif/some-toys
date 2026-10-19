/**
 * 商店页：按售卖类型分三个 tab。
 *
 * 交互要点：
 *  - tab 与筛选条放在 sticky 容器里，始终吸附在顶栏下方，不跟列表滚走；
 *  - 三个面板横向排列，支持原生左右滑动，点击 tab 则平滑滚动到对应面板；
 *  - 重绘（买东西之后）会保留当前的横向滚动位置，不会跳回第一个 tab。
 */
import { byId, delegate, setHTML } from '../../core/dom.js';
import { on, EVENTS } from '../../core/bus.js';
import { state } from '../../store/state.js';
import * as farm from '../../store/farm.js';
import * as shop from '../../store/shop.js';
import { count } from '../../store/inventory.js';
import { CROPS, CROP_IDS } from '../../data/crops.js';
import { ITEMS, ITEM_IDS } from '../../data/items.js';
import { SOILS, UPGRADEABLE_SOIL_IDS } from '../../data/soils.js';
import { SEED_FILTERS } from '../../data/navigation.js';
import { seedId } from '../../data/keys.js';
import { fmtDuration } from '../../core/utils.js';
import { openModal } from '../modal.js';

/** 当前选中的 tab */
let activeTab = 'seed';
/** 种子区的筛选档位 */
let seedFilter = 'plantable';

/** tab 定义，放在 data 层更合适，但只有商店用得到，先留在视图里 */
const TABS = [
  { key: 'seed', label: '种子', icon: '🌱' },
  { key: 'item', label: '道具', icon: '🧪' },
  { key: 'soil', label: '土地', icon: '🟫' },
];

/** 右侧数量角标 */
function owned(id) {
  return count(id) ? `<span class="si-own">· 拥有 ${count(id)}</span>` : '';
}

function matchFilter(id) {
  const crop = CROPS[id];
  if (seedFilter === 'all') return true;
  if (seedFilter === 'affordable') return state.player.coins >= crop.seed;
  return shop.isSeedUnlocked(id);
}

/* ---------- 三个面板 ---------- */

function filterHTML() {
  // 三个面板共用一个筛选条容器，非种子 tab 时用 hidden 收起。
  // 始终存在是为了避免「切换 tab → 补渲染 → 再次切 tab」的递归。
  return `<div class="shop-filter" ${activeTab === 'seed' ? '' : 'hidden'}>
    ${SEED_FILTERS.map((f) => `
      <button class="filter-chip ${f.key === seedFilter ? 'active' : ''}"
              data-action="filter-seeds" data-id="${f.key}">${f.label}</button>`).join('')}
    <span class="shop-filter-count">${CROP_IDS.filter(matchFilter).length} / ${CROP_IDS.length}</span>
  </div>`;
}

function seedPanel() {
  const shown = CROP_IDS.filter(matchFilter);
  if (!shown.length) {
    return '<div class="empty-tip">💸<br>暂时没有符合条件的种子<br>把地里的菜卖掉再来吧</div>';
  }

  const rows = shown.map((id) => {
    const crop = CROPS[id];
    const locked = state.player.level < crop.lv;
    const harvests = crop.harvests > 1 ? ` · 共${crop.harvests}茬` : '';
    return `
      <div class="shop-item ${locked ? 'locked' : ''}">
        <div class="si-emoji">${crop.emoji}</div>
        <div class="si-body">
          <div class="si-name">${crop.name}种子 ${owned(seedId(id))}</div>
          <div class="si-meta">Lv.${crop.lv} · ${fmtDuration(crop.grow * 1000)} · 收 ${crop.yield[0]}-${crop.yield[1]}${harvests} · 单价 ${crop.sell}</div>
        </div>
        <button class="btn small ${locked ? '' : 'ghost'}" ${locked ? 'disabled' : ''}
                data-action="buy-seed" data-id="${id}">
          ${locked ? 'Lv.' + crop.lv : '💰 ' + crop.seed}
        </button>
      </div>`;
  }).join('');

  return `<div class="list">${rows}</div>`;
}

function itemPanel() {
  const rows = ITEM_IDS.map((id) => {
    const item = ITEMS[id];
    return `
      <div class="shop-item">
        <div class="si-emoji">${item.emoji}</div>
        <div class="si-body">
          <div class="si-name">${item.name} ${owned(id)}</div>
          <div class="si-meta">${item.desc}</div>
        </div>
        <button class="btn small ghost" data-action="buy-item" data-id="${id}">💰 ${item.price}</button>
      </div>`;
  }).join('');
  return `<div class="list">${rows}</div>`;
}

function soilPanel() {
  const rows = UPGRADEABLE_SOIL_IDS.map((id) => {
    const soil = SOILS[id];
    const locked = state.player.level < soil.unlock;
    return `
      <div class="shop-item ${locked ? 'locked' : ''}">
        <div class="si-emoji">${soil.emoji}</div>
        <div class="si-body">
          <div class="si-name">${soil.name}</div>
          <div class="si-meta">产量 ×${soil.yieldMul} · 时间 ×${soil.timeMul}${soil.expMul !== 1 ? ` · 经验 ×${soil.expMul}` : ''}</div>
        </div>
        <button class="btn small ${locked ? '' : 'ghost'}" ${locked ? 'disabled' : ''}
                data-action="upgrade-soil" data-id="${id}">
          ${locked ? 'Lv.' + soil.unlock : '💰 ' + soil.cost}
        </button>
      </div>`;
  }).join('');
  return `<div class="list">${rows}</div>`;
}

/* ---------- 渲染 ---------- */

/** 重绘商店 */
export function renderShop() {
  const root = byId('shop');
  const panels = root.querySelector('.shop-panels');
  const keepScroll = panels ? panels.scrollLeft : 0;

  setHTML(root, `
    <div class="shop-top">
      <div class="shop-tabs">
        ${TABS.map((t) => `
          <button class="shop-tab ${t.key === activeTab ? 'active' : ''}" data-action="shop-tab" data-id="${t.key}">
            <span>${t.icon}</span>${t.label}
          </button>`).join('')}
      </div>
      ${activeTab === 'seed' ? filterHTML() : ''}
    </div>
    <div class="shop-panels">
      <div class="shop-panel" data-panel="seed">${seedPanel()}</div>
      <div class="shop-panel" data-panel="item">${itemPanel()}</div>
      <div class="shop-panel" data-panel="soil">${soilPanel()}</div>
    </div>`);

  const nextPanels = root.querySelector('.shop-panels');
  // scroll 事件不冒泡，只能直接挂在每次重绘后新建的容器上
  nextPanels.addEventListener('scroll', onPanelScroll, { passive: true });
  syncTabFromScroll(nextPanels);
  if (keepScroll) nextPanels.scrollLeft = keepScroll;
}

/** 横向滚动 → 更新 tab 高亮。用 rAF 合并高频 scroll */
let ticking = false;
function onPanelScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    syncTabFromScroll(byId('shop').querySelector('.shop-panels'));
  });
}

/** 横向滚动位置 → 当前 tab */
function syncTabFromScroll(panels) {
  if (!panels || !panels.clientWidth) return;
  // 页面隐藏时 clientWidth 为 0，scrollLeft / 0 会得到 NaN 或 Infinity
  const index = Math.round(panels.scrollLeft / panels.clientWidth);
  if (!Number.isFinite(index)) return;

  const next = TABS[Math.min(Math.max(index, 0), TABS.length - 1)].key;
  if (next === activeTab) return;

  activeTab = next;
  for (const btn of document.querySelectorAll('.shop-tab')) {
    btn.classList.toggle('active', btn.dataset.id === activeTab);
  }
  const filter = byId('shop').querySelector('.shop-filter');
  if (filter) filter.hidden = activeTab !== 'seed';
}

/** 切到指定 tab */
function switchTab(key) {
  const root = byId('shop');
  const panels = root?.querySelector('.shop-panels');
  if (!panels) return;

  const index = Math.max(0, TABS.findIndex((t) => t.key === key));
  activeTab = key;
  if (panels.clientWidth) {
    panels.scrollTo({ left: index * panels.clientWidth, behavior: 'smooth' });
  }

  for (const btn of root.querySelectorAll('.shop-tab')) {
    btn.classList.toggle('active', btn.dataset.id === activeTab);
  }
  const filter = root.querySelector('.shop-filter');
  if (filter) filter.hidden = activeTab !== 'seed';
}

/* ---------- 土地升级：先选地块 ---------- */

function openSoilModal(soilId) {
  const soil = SOILS[soilId];
  if (state.player.level < soil.unlock) {
    renderShop();
    return;
  }

  const plots = farm.upgradeablePlots(soilId);
  const buttons = plots.length
    ? plots.map((p) => `
        <button class="btn small ghost" data-action="apply-upgrade"
                data-soil="${soilId}" data-plot="${p.id}" style="width:100%">
          地块 ${p.id + 1}
        </button>`).join('')
    : '<p style="font-size:12px;color:var(--muted)">没有可升级的普通土地</p>';

  openModal(`
    <div class="modal-head">
      <h3>🟫 升级土地 · ${soil.name}</h3>
      <button class="close" data-close>✕</button>
    </div>
    <p style="font-size:13px;color:var(--muted);line-height:1.8;margin-bottom:14px">
      将一块<b>普通土地</b>升级为 ${soil.name}，消耗 💰${soil.cost}。<br>
      升级后该地块产量 ×${soil.yieldMul}，成熟时间 ×${soil.timeMul}。
    </p>
    <div class="seed-grid">${buttons}</div>
  `, async (action, el) => {
    if (action === 'apply-upgrade') {
      await farm.upgradeSoil(Number(el.dataset.plot), el.dataset.soil);
    }
  });
}

/* ---------- 挂载 ---------- */

const SHOP_ACTIONS = {
  'buy-seed': (id) => shop.buySeed(id),
  'buy-item': (id) => shop.buyItem(id),
  'upgrade-soil': (id) => openSoilModal(id),
  'shop-tab': (id) => switchTab(id),
  'filter-seeds': (id) => {
    seedFilter = id;
    renderShop();
  },
};

export function mountShop() {
  const root = byId('shop');

  delegate(root, 'click', '[data-action]', (el) => {
    SHOP_ACTIONS[el.dataset.action]?.(el.dataset.id);
  });

  on(EVENTS.PLAYER, renderShop);
  on(EVENTS.INVENTORY, renderShop);
  on(EVENTS.FARM, renderShop);
}