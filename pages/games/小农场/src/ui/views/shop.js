/**
 * 商店页：按售卖类型分四个 tab（种子 / 道具 / 土地 / 藏宝图）。
 *
 * 交互要点：
 *  - tab 与筛选条放在 sticky 容器里，始终吸附在顶栏下方，不跟列表滚走；
 *  - 四个面板横向排列，支持原生左右滑动，点击 tab 则平滑滚动到对应面板；
 *  - 重绘（买东西之后）会同时保留横向位置与当前面板的纵向滚动位置。
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
import { MAP_TIERS } from '../../data/adventure.js';
import { SEED_FILTERS } from '../../data/navigation.js';
import { mapId, seedId } from '../../data/keys.js';
import { fmtDuration, formatCoins } from '../../core/utils.js';
import { stackClass, yieldClass } from '../meta-tags.js';
import { openModal } from '../modal.js';
import { openSeedModal } from '../seed-detail.js';

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
  if (seedFilter === 'affordable') return state.farm.coins >= crop.seed;
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
    const locked = state.farm.level < crop.lv;
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
    // 永久版买断一次就够：已经有了就把按钮钉成「已拥有」，
    // 免得玩家再点一次（store 那边也拦，但界面不该给出这个暗示）
    const bought = Boolean(item.permanent) && count(id) > 0;
    const tail = bought
      ? '<span class="si-own">· 已拥有</span>'
      : owned(id);
    return `
      <div class="shop-item${bought ? ' locked' : ''}">
        <div class="si-emoji">${item.emoji}</div>
        <div class="si-body">
          <div class="si-name">${item.name} ${tail}</div>
          <div class="si-meta">${item.desc}</div>
        </div>
        <button class="btn small ghost" data-action="buy-item" data-id="${id}" ${bought ? 'disabled' : ''}>
          ${bought ? '已拥有' : `💰 ${formatCoins(item.price)}`}
        </button>
      </div>`;
  }).join('');
  return `<div class="list">${rows}</div>`;
}

function soilPanel() {
  const rows = UPGRADEABLE_SOIL_IDS.map((id) => {
    const soil = SOILS[id];
    const locked = state.farm.level < soil.unlock;
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
 * 五档图的价格与等级门槛写死在 data/adventure.js。
 * 两个等级标签必须区分清楚，之前只写一个「Lv.10」很容易被读成「可挖到 Lv.10」：
 *   🏡 农场≥Lv.10  → 买这张图需要的农场等级
 *   🌱 种子≤Lv.20  → 挖到的种子上限
 */
function mapPanel() {
  const rows = MAP_TIERS.map((map) => {
    const locked = state.farm.level < map.unlock;
    const owned = count(mapId(map.tier));
    return `
      <div class="shop-item ${locked ? 'locked' : ''}">
        <div class="si-emoji">${map.emoji}</div>
        <div class="si-body">
          <div class="si-name">${map.name} ${owned ? `<span class="si-own">· 拥有 ${owned}</span>` : ''}</div>
          <div class="si-meta seed-meta">
            <span class="meta-tag steps">👣 ${map.swipes} 步</span>
            <span class="meta-tag lv">🏡 农场≥Lv${map.unlock}</span>
            <span class="meta-tag yield">🌱 种子≤Lv${map.shopSeedCap}</span>
            <span class="meta-tag special">✨ 限定×3</span>
          </div>
        </div>
        <button class="btn small ${locked ? '' : 'ghost'}" ${locked ? 'disabled' : ''}
                data-action="map-buy" data-id="${map.tier}">
          ${locked ? `需 Lv.${map.unlock}` : `💰 ${map.price}`}
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
  // 记下重绘时所在的面板：下面的重建过程会改写 activeTab，不能拿它当 key
  const tabAtRender = activeTab;
  const activePanel = panels?.querySelector(`.shop-panel[data-panel="${tabAtRender}"]`);
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
      ${filterHTML()}
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
  // 顺序很要紧：先恢复横向位置，再同步 tab。
  // 反过来的话 syncTabFromScroll 读到的是 scrollLeft = 0，
  // 会把 activeTab 误判成第一个 tab，纵向滚动就恢复到了错误的面板上。
  if (keepLeft) nextPanels.scrollLeft = keepLeft;
  syncTabFromScroll(nextPanels);
  if (keepTop) {
    const panel = nextPanels.querySelector(`.shop-panel[data-panel="${tabAtRender}"]`);
    if (panel) panel.scrollTop = keepTop;
  }
}

/**
 * 横向滚动 → 更新 tab 高亮。
 *
 * 必须**等滚动停下**再同步：一次快速滑动会连续发出几十个 scroll 事件，
 * 每个都同步的话，高亮会在一帧里连跳好几个 tab —— 玩家看到的就是
 * 「左右滑一下，却一次切换了好几个类型标签」。所以等 140ms
 * 没有新事件，才认最终停下来的那一页。
 */
let ticking = false;
let syncTimer = 0;
function onPanelScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTabFromScroll(byId('shop').querySelector('.shop-panels'));
    }, 140);
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
function switchTab(key) {  const root = byId('shop');
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

/**
 * 外部跳转入口：先记住要打开哪个 tab，再让 activatePage 触发渲染。
 * 播种弹窗要「去买种子」、冒险页要「去买藏宝图」，都走这里，
 * 不用把 activeTab 暴露出去。
 * @param {string} key seed / item / soil / map
 */
export function setShopTab(key) {
  if (!TABS.some((t) => t.key === key)) return;
  activeTab = key;
  // 换了 tab 就该从该面板顶部看起
  keepPanelScroll = false;
}

/* ---------- 土地升级：先选地块 ---------- */

function openSoilModal(soilId) {
  const soil = SOILS[soilId];
  if (state.farm.level < soil.unlock) {
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
  'seed-detail': (id) => openSeedModal(id, { buy: true }),
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