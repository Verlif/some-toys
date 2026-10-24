/**
 * 村中心（底部中间的 tab，由原「时报」改造而来）。
 *
 * 页面只有两块：
 *   - **村民总览卡**：在线人数 / 总人数（都含玩家自己）+ 在线头像行。
 *     点它是**弹窗**（全部名单 + 全部 / 在线 筛选），页面本身不再展开名单；
 *   - **两枚入口**：📢 公告栏（时报弹窗）、📋 订单（子页面）。
 *     订单按钮右上角常驻当前订单总数 —— 这是订单唯一入口（「更多」里已移除）。
 *
 * 「在线」是 NPC 的挂机窗口（见 data/friends.js 的 onlineMs）：总览计数、
 * 头像行、名单里的圆点与灰度都跟着它走 —— 分钟 TICK 与邻居上线事件都会刷，
 * 且只做 targeted 更新（不重建名单，滚动位置不能丢）。
 */
import { byId, delegate, escapeHtml, setHTML } from '../../core/dom.js';
import { on, EVENTS } from '../../core/bus.js';
import { PLAYER_ID, state } from '../../store/state.js';
import { isNpcOnline } from '../../data/friends.js';
import { filterNews, NEWS_FILTERS, newsList } from '../../store/news.js';
import { myOrders, npcOrders } from '../../store/orders.js';
import { recordItemsHTML } from '../records.js';
import { friendCardHTML, refreshOnline } from './friends.js';
import { openFriendModal } from '../friend-modal.js';
import { openModal } from '../modal.js';
import { openSubpage } from '../subpage.js';
import { showToast } from '../toast.js';
import { completeGuide } from '../../store/codex.js';
import { formatCoins } from '../../core/utils.js';

/** 公告栏弹窗内的筛选档位与排序方向（true = 最新在前） */
let boardFilter = 'all';
let boardDesc = true;

/** 村民总览弹窗的筛选：all = 全部（含离线），online = 只看在线的 */
let villagerFilter = 'all';

/* ---------- 数字 ---------- */

/** 进行中的订单总数：邻居张榜 + 我发布的 */
const orderCount = (now = Date.now()) => npcOrders(now).length + myOrders(now).length;

/** 在线人数（含玩家）与总人数（含玩家） */
function onlineStats(now = Date.now()) {
  // 玩家自己当然在线：+1
  const online = state.friends.filter((f) => isNpcOnline(f, now)).length + 1;
  return { online, total: state.friends.length + 1 };
}

/** 在线村民的头像行：玩家在最前，最多 10 个，多了折成 +N */
function facesHTML(now, limit = 10) {
  const online = [
    { avatar: state.farm.avatar, name: '你' },
    ...state.friends.filter((f) => isNpcOnline(f, now)),
  ];
  const shown = online.slice(0, limit);
  const more = online.length - shown.length;
  return shown
    .map((v) => `<span class="co-face" title="${escapeHtml(v.name)}">${v.avatar}</span>`)
    .join('') + (more > 0 ? `<span class="co-face more">+${more}</span>` : '');
}

/** 总览卡副标题：你 + N 位邻居 · M 位正在线 */
function subText(online) {
  const neighborsOnline = online - 1;
  return `你 + ${state.friends.length} 位邻居`
    + (neighborsOnline > 0 ? ` · ${neighborsOnline} 位邻居正在线` : ' · 邻居们都不在');
}

/* ---------- 村民总览弹窗 ---------- */

/** 「你自己」那张卡：玩家永远在线 */
const meCardHTML = () => `
  <div class="friend-card me" data-action="center-me" role="button" tabindex="0">
    <div class="friend-avatar">${state.farm.avatar}</div>
    <div class="friend-body">
      <div class="friend-name">
        ${escapeHtml(state.farm.name)}
        <i class="friend-dot on" title="在线"></i>
        <span class="lv">Lv.${state.farm.level}</span>
      </div>
      <div class="friend-stats">
        <span class="friend-chip job">农场主</span>
        <span class="friend-chip">💰 ${formatCoins(state.farm.coins)}</span>
        <span class="friend-chip me-chip">就是你</span>
      </div>
    </div>
  </div>`;

/** 名单：你自己 + 按筛选取的邻居（卡片与邻居页同一套，离线自带灰度） */
function villagerRowsHTML(filter = villagerFilter, now = Date.now()) {
  const list = state.friends.filter((f) => filter === 'all' || isNpcOnline(f, now));
  return meCardHTML() + list.map((f) => friendCardHTML(f, now)).join('');
}

/** 筛选芯片：全部 / 在线 */
function villagerBarHTML(now = Date.now()) {
  const { online, total } = onlineStats(now);
  const chip = (key, label, n) => `
    <button class="filter-chip ${villagerFilter === key ? 'active' : ''}"
            data-action="villager-filter" data-id="${key}">${label}<i class="chip-num">${n}</i></button>`;
  return chip('all', '全部', total) + chip('online', '在线', online);
}

/** 打开村民总览：筛选只重刷芯片与名单，不重建弹窗 */
function openVillagers() {
  const now = Date.now();
  const { online, total } = onlineStats(now);

  openModal(`
    <div class="modal-head">
      <h3>🏡 村民总览</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub" data-role="villager-sub">${total} 位村民 · ${online} 位正在线</div>
    <div class="board-bar villager-bar" data-role="villager-bar">${villagerBarHTML(now)}</div>
    <div class="friend-list" data-role="villager-list">${villagerRowsHTML(villagerFilter, now)}</div>
  `, (action, el) => {
    if (action === 'villager-filter') {
      villagerFilter = el.dataset.id;
      paintVillagers();
      return;
    }
    if (action === 'visit') {
      openFriendModal(el.dataset.id);
      return;
    }
    if (action === 'center-me') showToast('这就是你自己的农场，回去种地吧');
  });

  // 卡片自带 offline 类；再跑一次把「刚刚上线/下线」的圆点也对齐
  refreshOnline();
}

/** 重刷村民总览弹窗（栈顶那一张） */
function paintVillagers() {
  const card = document.querySelector('#modal .modal-card');
  if (!card) return;
  const now = Date.now();
  const { online, total } = onlineStats(now);

  const sub = card.querySelector('[data-role="villager-sub"]');
  if (sub) sub.textContent = `${total} 位村民 · ${online} 位正在线`;
  const bar = card.querySelector('[data-role="villager-bar"]');
  if (bar) bar.innerHTML = villagerBarHTML(now);
  const list = card.querySelector('[data-role="villager-list"]');
  if (list) list.innerHTML = villagerRowsHTML(villagerFilter, now);
  refreshOnline();
}

/* ---------- 公告栏（时报弹窗） ---------- */

/** 当前筛选 + 排序下的时报列表 HTML */
function boardListHTML() {
  const now = Date.now();
  const all = filterNews(newsList(), boardFilter);
  const list = boardDesc ? all : [...all].reverse();
  return list.length
    ? recordItemsHTML(list, { now, withDay: true })
    : '<div class="empty-tip">📭<br>公告栏还空着<br>去闯点事出来吧</div>';
}

/** 过滤 / 排序栏（放在列表下面） */
function boardBarHTML() {
  const all = newsList();
  const chips = NEWS_FILTERS.map((f) => {
    const n = filterNews(all, f.key).length;
    return `
      <button class="filter-chip ${f.key === boardFilter ? 'active' : ''}"
              data-action="board-filter" data-id="${f.key}">${f.label}<i class="chip-num">${n}</i></button>`;
  }).join('');
  return `${chips}<button class="filter-chip sort" data-action="board-sort">${boardDesc ? '最新 ↓' : '最早 ↑'}</button>`;
}

/** 打开公告栏：过滤 / 排序在列表下面，改选只重刷列表与栏，不重建弹窗 */
function openBoard() {
  // 第一次翻开公告栏 = 「第一次看时报」的引导目标（时报从页面变成弹窗了）
  completeGuide('news');

  openModal(`
    <div class="modal-head">
      <h3>📢 公告栏</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">村镇日报 · 只保留最近 7 天的大新闻</div>

    <div class="news-list" data-role="board-list">${boardListHTML()}</div>

    <div class="modal-foot">
      <div class="board-bar" data-role="board-bar">${boardBarHTML()}</div>
    </div>
  `, (action, el) => {
    if (action === 'board-filter') {
      boardFilter = el.dataset.id;
      paintBoard();
      return;
    }
    if (action === 'board-sort') {
      boardDesc = !boardDesc;
      paintBoard();
    }
  }, 'board-modal');

  function paintBoard() {
    // 叠层只留一张 .modal-card（下层是 HTML 快照），这一张就是栈顶
    const card = document.querySelector('#modal .modal-card');
    if (!card) return;
    card.querySelector('[data-role="board-list"]').innerHTML = boardListHTML();
    card.querySelector('[data-role="board-bar"]').innerHTML = boardBarHTML();
  }
}

/* ---------- 页面 ---------- */

export function renderCenter() {
  const root = byId('center');
  if (!root) return;
  const now = Date.now();
  const { online, total } = onlineStats(now);
  const orders = orderCount(now);

  setHTML(root, `
    <div class="center-head">
      <div class="center-overview" data-action="center-villagers" role="button" tabindex="0">
        <div class="co-title">🏡 村民总览</div>
        <div class="co-count"><b data-role="online">${online}</b> <span>/ ${total} 在线</span></div>
        <div class="co-sub" data-role="sub">${subText(online)}</div>
        <div class="co-faces" data-role="faces">${facesHTML(now)}</div>
      </div>
    </div>
    <div class="center-acts">
      <button class="center-act board" data-action="center-board">
        <span class="ca-ico">📢</span>
        <span class="ca-body"><b>公告栏</b><i data-role="news-n">${newsList().length} 条村镇动态</i></span>
      </button>
      <button class="center-act orders" data-action="center-orders">
        <span class="ca-ico">📋</span>
        <span class="ca-body"><b>订单</b><i data-role="order-hint">${orders ? '有活干了' : '暂时没有单'}</i></span>
        <i class="ca-badge ${orders ? '' : 'zero'}" data-role="orders-n">${orders}</i>
      </button>
    </div>
  `);
}

/**
 * 实时刷新：在线计数、副标题、头像行、两枚入口上的数字、名单里的圆点与灰度。
 * 只改文字与类，不重建名单 —— 弹窗开着的时候滚动位置不能丢。
 */
function refreshMarks() {
  const root = byId('center');
  if (!root || !root.innerHTML) return;
  const now = Date.now();
  const { online } = onlineStats(now);

  const count = root.querySelector('[data-role="online"]');
  if (count) count.textContent = String(online);
  const sub = root.querySelector('[data-role="sub"]');
  if (sub) sub.textContent = subText(online);
  const faces = root.querySelector('[data-role="faces"]');
  if (faces) faces.innerHTML = facesHTML(now);

  const newsN = root.querySelector('[data-role="news-n"]');
  if (newsN) newsN.textContent = `${newsList().length} 条村镇动态`;

  // 订单数会随 NPC 上线 / 别人接单变化，徽标常驻跟着它走
  const orders = orderCount(now);
  const badge = root.querySelector('[data-role="orders-n"]');
  if (badge) {
    badge.textContent = String(orders);
    badge.classList.toggle('zero', !orders);
  }
  const hint = root.querySelector('[data-role="order-hint"]');
  if (hint) hint.textContent = orders ? '有活干了' : '暂时没有单';

  // 名单里的圆点 / 灰度（弹窗开着的时候才有节点）：与邻居页共用一套
  refreshOnline();
}

const CENTER_ACTIONS = {
  // 总览卡：弹窗看名单（页面里不再展开）
  'center-villagers'() {
    openVillagers();
  },
  'center-board'() {
    openBoard();
  },
  'center-orders'() {
    openSubpage('orders');
  },
};

/** 进入村中心：渲染（引导在公告栏弹窗里才结） */
export function enterCenterPage() {
  renderCenter();
}

export function mountCenter() {
  const root = byId('center');
  // 卡片与按钮在每次重绘里重建，用委托挂在根节点上
  delegate(root, 'click', '[data-action]', (el) => {
    CENTER_ACTIONS[el.dataset.action]?.(el);
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('[data-action]');
    if (!card) return;
    event.preventDefault();
    CENTER_ACTIONS[card.dataset.action]?.(card);
  });

  // 邻居上线 / 下线、在线窗口走到头：实时刷总览与入口数字
  on(EVENTS.FRIENDS, refreshMarks);
  on(EVENTS.TICK, refreshMarks);
}
