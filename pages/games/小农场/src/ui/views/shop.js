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
import { CROPS, CROP_IDS, KIND_LABELS, totalCycleExp, totalCycleSeconds } from '../../data/crops.js';
import { ITEMS, ITEM_IDS } from '../../data/items.js';
import { SOILS, UPGRADEABLE_SOIL_IDS } from '../../data/soils.js';
import { MAP_TIERS } from '../../data/adventure.js';
import { SEED_FILTERS } from '../../data/navigation.js';
import { mapId, seedId } from '../../data/keys.js';
import { fmtDuration } from '../../core/utils.js';
import { stackClass, yieldClass } from '../meta-tags.js';
import { closeModal, openModal } from '../modal.js';

/** 当前选中的 tab */
let activeTab = 'seed';
/** 种子区的筛选档位 */
let seedFilter = 'plantable';
/** 下一次重绘是否保留当前面板的滚动位置（改筛选时要回到顶部） */
let keepPanelScroll = true;

/** tab 定义，放在 data 层更合适，但只有商店用得到，先留在视图里 */
const TABS = [
  { key: 'seed', label: '种子', icon: '🌱' },
  { key: 'item', label: '道具', icon: '🧪' },
  { key: 'soil', label: '土地', icon: '🟫' },
  { key: 'map', label: '藏宝图', icon: '🧭' },
];

/** 商店只卖常规种子；限定种子（special）只能从藏宝图里挖到 */
const SHOP_SEED_IDS = CROP_IDS.filter((id) => !CROPS[id].special);

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
    <span class="shop-filter-count">${SHOP_SEED_IDS.filter(matchFilter).length} / ${SHOP_SEED_IDS.length}</span>
  </div>`;
}

function seedPanel() {
  const shown = SHOP_SEED_IDS.filter(matchFilter);
  if (!shown.length) {
    return '<div class="empty-tip">💸<br>暂时没有符合条件的种子<br>把地里的菜卖掉再来吧</div>';
  }

  const rows = shown.map((id) => {
    const crop = CROPS[id];
    const locked = state.player.level < crop.lv;
    return `
      <div class="shop-item seed-item ${locked ? 'locked' : ''}"
           data-action="seed-detail" data-id="${id}" role="button" tabindex="0">
        <div class="si-emoji">${crop.emoji}</div>
        <div class="si-body">
          <div class="si-name">${crop.name}种子 ${owned(seedId(id))}</div>
          <div class="si-meta seed-meta">
            <span class="meta-tag lv">Lv.${crop.lv}</span>
            <span class="meta-tag time">⏱ ${fmtDuration(crop.grow * 1000)}</span>
            <span class="meta-tag stack ${stackClass(crop.harvests)}">🧺 ${crop.harvests} 茬</span>
            <span class="meta-tag yield ${yieldClass(crop.yield[1])}">🌾 ${crop.yield[0]}-${crop.yield[1]}</span>
            ${crop.multi ? '<span class="meta-tag multi">🌿 多茬</span>' : ''}
          </div>
        </div>
        <span class="si-price">${locked ? `Lv.${crop.lv}` : `💰 ${crop.seed}`}</span>
        <span class="si-chevron">›</span>
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

/**
 * 藏宝图面板。
 *
 * 五档图的价格与等级门槛写死在 data/adventure.js，
 * 「种子 ≤ Lv.N」就是挖到的种子上限（要求等级 + 10）。
 */
function mapPanel() {
  const rows = MAP_TIERS.map((map) => {
    const locked = state.player.level < map.unlock;
    const owned = count(mapId(map.tier));
    return `
      <div class="shop-item ${locked ? 'locked' : ''}">
        <div class="si-emoji">${map.emoji}</div>
        <div class="si-body">
          <div class="si-name">${map.name} ${owned ? `<span class="si-own">· 拥有 ${owned}</span>` : ''}</div>
          <div class="si-meta seed-meta">
            <span class="meta-tag steps">👣 ${map.swipes} 步</span>
            <span class="meta-tag yield">🌱 ≤Lv${map.seedCap}</span>
            <span class="meta-tag special">✨ 限定×3</span>
          </div>
        </div>
        <button class="btn small ${locked ? '' : 'ghost'}" ${locked ? 'disabled' : ''}
                data-action="map-buy" data-id="${map.tier}">
          ${locked ? `Lv.${map.unlock}` : `💰 ${map.price}`}
        </button>
      </div>`;
  }).join('');

  return `<div class="list">${rows}</div>
    <p class="map-tip">买好之后去「☰ 其他 → 🧭 冒险」出发。每张图必定能挖到 3 种限定种子，挖到什么全看运气。</p>`;
}

/* ---------- 渲染 ---------- */

/**
 * 重绘商店。
 *
 * 每个 tab 面板是**各自独立**的滚动容器（CSS 里 .shop-panel 自己 overflow-y），
 * 所以「种子滚到底 → 切到道具」时道具面板仍然是它自己的顶部，
 * 不会因为共用一个滚动条而看起来一片空白。
 * 重绘（买东西）会保留当前面板的滚动位置，不会跳回顶部。
 */
export function renderShop() {
  const root = byId('shop');
  const panels = root.querySelector('.shop-panels');
  const keepLeft = panels ? panels.scrollLeft : 0;
  const activePanel = panels?.querySelector(`.shop-panel[data-panel="${activeTab}"]`);
  const keepTop = keepPanelScroll && activePanel ? activePanel.scrollTop : 0;
  keepPanelScroll = true;

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
      <div class="shop-panel" data-panel="map">${mapPanel()}</div>
    </div>`);

  const nextPanels = root.querySelector('.shop-panels');
  // scroll 事件不冒泡，只能直接挂在每次重绘后新建的容器上
  nextPanels.addEventListener('scroll', onPanelScroll, { passive: true });
  syncTabFromScroll(nextPanels);
  if (keepLeft) nextPanels.scrollLeft = keepLeft;
  if (keepTop) {
    const panel = nextPanels.querySelector(`.shop-panel[data-panel="${activeTab}"]`);
    if (panel) panel.scrollTop = keepTop;
  }
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

/* ---------- 种子详情：数量 + 购买 ---------- */

/** 单次购买的数量上限，防止按住加号一路刷到天价 */
const MAX_QTY = 99;

/**
 * 按住连续触发。
 *
 * 单击仍然走正常的 data-action 分派；按住超过 380ms 才进入连发。
 * 连发状态下松手会再补一次 click，所以用捕获阶段把它吞掉，
 * 否则「按住减到 1」会多减一次。
 */
function bindHold(root, selector, tick) {
  for (const el of root.querySelectorAll(selector)) {
    let delay = 0;
    let repeat = 0;
    let held = false;

    const stop = () => {
      clearTimeout(delay);
      clearInterval(repeat);
      delay = 0;
      repeat = 0;
    };

    el.addEventListener('pointerdown', () => {
      held = false;
      delay = setTimeout(() => {
        held = true;
        repeat = setInterval(tick, 90);
      }, 380);
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
      el.addEventListener(type, stop);
    }
    el.addEventListener('click', (event) => {
      if (!held) return;
      held = false;
      event.stopPropagation();
    }, true);
  }
}

/**
 * 种子详情弹窗。
 *
 * 商店列表上不再直接购买 —— 买种子前玩家通常要看成熟时间、产量和收益，
 * 一屏放不下就把详细信息收进这个弹窗里，数量在底部调整。
 * @param {string} cropId
 */
function openSeedModal(cropId) {
  const crop = CROPS[cropId];
  if (!crop) return;

  const locked = !shop.isSeedUnlocked(cropId);
  const amount = (crop.yield[0] + crop.yield[1]) / 2;
  const cycle = totalCycleSeconds(crop);
  const exp = totalCycleExp(crop, amount);
  const coin = Math.round(amount * crop.sell * crop.harvests);

  let qty = 1;

  openModal(`
    <div class="modal-head">
      <h3>种子详情</h3>
      <button class="close" data-close>✕</button>
    </div>

    <div class="sd-hero">
      <div class="sd-emoji">${crop.emoji}</div>
      <div class="sd-id">
        <div class="sd-name">${crop.name}</div>
        <div class="sd-tags">
          <span class="seed-row-kind kind-${crop.kind}">${KIND_LABELS[crop.kind]?.label || ''}</span>
          ${crop.special ? '<span class="seed-row-kind kind-special">限定</span>' : ''}
          ${crop.slow ? '<span class="seed-row-kind kind-slow">厚积薄发</span>' : ''}
          <span class="sd-lv">Lv.${crop.lv}</span>
        </div>
      </div>
      <div class="sd-owned">已有 <b data-role="owned">${count(seedId(cropId))}</b></div>
    </div>

    <div class="sd-grid">
      <div class="sd-cell"><span>种子单价</span><b>💰 ${crop.seed}</b></div>
      <div class="sd-cell"><span>成熟时间</span><b>${fmtDuration(cycle * 1000)}</b></div>
      <div class="sd-cell"><span>收获茬数</span><b>${crop.harvests} 茬</b></div>
      <div class="sd-cell"><span>每次产量</span><b>${crop.yield[0]}-${crop.yield[1]} 个</b></div>
      <div class="sd-cell"><span>单个售价</span><b>💰 ${crop.sell}</b></div>
      <div class="sd-cell"><span>一轮经验</span><b>${exp.toLocaleString()}</b></div>
    </div>

    <div class="sd-gain">一株完整周期预计收入 <b>${coin.toLocaleString()}</b>（按平均产量估算）</div>

    ${locked
      ? `<div class="sd-lock">还差 ${crop.lv - state.player.level} 级解锁，Lv.${crop.lv} 就能种了</div>`
      : ''}

    <div class="sd-buybar">
      <div class="qty">
        <button class="qty-btn" data-action="qty-minus" aria-label="减少数量" ${locked ? 'disabled' : ''}>−</button>
        <span class="qty-num" data-role="qty">${qty}</span>
        <button class="qty-btn" data-action="qty-plus" aria-label="增加数量" ${locked ? 'disabled' : ''}>+</button>
      </div>
      <button class="btn sd-buy" data-action="seed-buy" ${locked ? 'disabled' : ''}>
        <span data-role="total">购买 · 💰 ${crop.seed}</span>
      </button>
    </div>
    <div class="sd-tip">按住 − / + 可连续调整</div>
  `, (action) => SEED_DETAIL_ACTIONS[action]?.());

  const card = document.querySelector('#modal .modal-card');

  /** 数量变化后只改数字与按钮状态，不重建弹窗 —— 否则连发会被打断 */
  function refresh() {
    const total = crop.seed * qty;
    const affordable = state.player.coins >= total;
    const setText = (role, text) => {
      const el = card.querySelector(`[data-role="${role}"]`);
      if (el) el.textContent = text;
    };

    setText('qty', String(qty));
    setText('owned', String(count(seedId(cropId))));
    setText('total', affordable ? `购买 · 💰 ${total}` : `金币不足 · 需 ${total}`);
    card.querySelector('[data-action="seed-buy"]').disabled = locked || !affordable;
    card.querySelector('[data-action="qty-minus"]').disabled = locked || qty <= 1;
    card.querySelector('[data-action="qty-plus"]').disabled = locked || qty >= MAX_QTY;
  }

  function step(delta) {
    if (locked) return;
    const next = Math.max(1, Math.min(MAX_QTY, qty + delta));
    if (next === qty) return;
    qty = next;
    refresh();
  }

  const SEED_DETAIL_ACTIONS = {
    'qty-minus': () => step(-1),
    'qty-plus': () => step(1),
    'seed-buy': async () => {
      // 买成功就直接收起弹窗：买完还留着弹窗，玩家会以为没买成又点一次
      if (await shop.buySeed(cropId, qty)) closeModal();
    },
  };

  bindHold(card, '[data-action="qty-minus"]', () => step(-1));
  bindHold(card, '[data-action="qty-plus"]', () => step(1));
  refresh();
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
  'seed-detail': (id) => openSeedModal(id),
  'buy-item': (id) => shop.buyItem(id),
  'map-buy': (id) => shop.buyMap(Number(id)),
  'upgrade-soil': (id) => openSoilModal(id),
  'shop-tab': (id) => switchTab(id),
  'filter-seeds': (id) => {
    seedFilter = id;
    // 换了筛选就该从列表顶部看起，不要沿用上一个筛选的滚动位置
    keepPanelScroll = false;
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