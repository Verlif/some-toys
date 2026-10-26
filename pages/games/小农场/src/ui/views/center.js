/**
 * 村中心（底部中间的 tab，由原「时报」改造而来）。
 *
 * 页面四块：
 *   - **🏘 村庄建设**（第 48 轮，最上面）：村庄等级、三项升级进度
 *     （金币 / 水晶 / 祈福）、投入资源 / 每日祈福 / 建设日志三个入口。
 *     升级是**自动的**：三项同时达标就当场升，不需要按「升级」按钮 ——
 *     祈福每天只有一次，玩家不需要在某个瞬间守着点；
 *   - **村民总览卡**：在线人数 / 总人数（都含玩家自己）+ 在线头像行。
 *     点它是**弹窗**（全部名单 + 全部 / 在线 筛选），页面本身不再展开名单；
 *   - **两枚入口**：📢 公告栏（时报弹窗）、📋 订单（子页面）。
 *     订单按钮右上角常驻当前订单总数 —— 这是订单唯一入口（「更多」里已移除）；
 *   - **🏆 排行榜卡**：两列 —— 左列 6 个榜单，右列昨日冠军
 *     （并列第一折成「+N」）。点开是排行榜弹窗（`openRankModal`）。
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
import { closeModal, openModal } from '../modal.js';
import { openSubpage } from '../subpage.js';
import { openRankModal, yesterdayBoardSummary } from '../subpages/rank.js';
import { showToast } from '../toast.js';
import { completeGuide } from '../../store/codex.js';
import { formatCoins, dayKey } from '../../core/utils.js';
import { invest, pray, villageLogs, villageSnapshot } from '../../store/village.js';
import {
  VILLAGE_NAME,
  VILLAGE_YIELD_PER_LEVEL,
  crystalEmoji,
  crystalName,
} from '../../data/village.js';
import { notify } from '../../store/notify.js';

/** 公告栏弹窗内的筛选档位与排序方向（true = 最新在前） */
let boardFilter = 'all';
let boardDesc = true;

/**
 * 村民总览弹窗的筛选：all = 全部（含离线），online = 只看在线的。
 *
 * 默认 `online`（第 51 轮）：玩家点开这个总览，想看的是「现在谁在」——
 * 32 个村民全铺出来，一屏里大半是灰的，还得自己往下找绿点。
 * 想翻名单（比如找人送礼）切「全部」即可，选择会记住。
 */
let villagerFilter = 'online';

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
  // 默认档是「在线」，而村里可能一个人都没上线 —— 得说句话，
  // 否则弹窗里只剩「你自己」一张卡，看起来像加载失败
  const empty = list.length || filter === 'all'
    ? ''
    : '<div class="empty-tip">🌙<br>这会儿没有邻居在线<br>切「全部」看看谁在家</div>';
  return meCardHTML() + empty + list.map((f) => friendCardHTML(f, now)).join('');
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

/* ---------- 排行榜卡片 ---------- */

/**
 * 排行榜卡片：**两列**。
 *
 * 左列是 6 个榜单（图标 + 名字），右列是**昨日**那个榜的第一名；
 * 并列第一时只露一位，剩下的折成「+N」。
 * 整张卡是一个按钮 —— 点哪里都开排行榜弹窗（榜单本身那么多内容，
 * 塞进村中心会把下面两块挤没）。
 *
 * 昨日冠军取的是 `latestSettled()` 那一期（每天 14:00 结算完才更新），
 * 和排行榜弹窗里「昨日 · XX」那张卡是同一份数据。
 */
function rankCardHTML() {
  const rows = yesterdayBoardSummary();

  const names = rows.map((r) => `
    <span class="cr-item">
      <i class="cr-ico">${r.icon}</i>${r.label}
    </span>`).join('');

  const champs = rows.map((r) => {
    if (!r.champ) return '<span class="cr-item empty">—</span>';
    return `
      <span class="cr-item champ">
        <i class="cr-ava">${r.champ.avatar}</i>
        <b>${escapeHtml(r.champ.name)}</b>
        ${r.champ.me ? '<i class="cr-me">你</i>' : ''}
        ${r.champ.more > 0 ? `<i class="cr-more">+${r.champ.more}</i>` : ''}
      </span>`;
  }).join('');

  return `
    <div class="center-rank" data-action="center-rank" role="button" tabindex="0">
      <div class="cr-head">
        <span class="cr-title">🏆 排行榜</span>
        <span class="cr-sub">昨日冠军 · 点开看实时名次</span>
        <span class="cr-go">›</span>
      </div>
      <div class="cr-grid">
        <div class="cr-col">${names}</div>
        <div class="cr-col">${champs}</div>
      </div>
    </div>`;
}

/* ---------- 村庄建设 ---------- */

/**
 * 村庄里的数字一律用千分位，不用 `formatCoins`。
 *
 * `formatCoins` 是给 HUD 与日志用的紧凑写法（10,000 → 「1.0万」），
 * 但这里是「进度 X / 门槛 Y」—— 两边必须同量级才读得懂，
 * 「0 / 1.0万」这种混搭会让人一愣（2026-10-26 实测截图）。
 */
const num = (n) => Number(n || 0).toLocaleString('en-US');

/**
 * 村庄建设卡（村中心最上面那一块，第 48 轮）。
 *
 * 一张卡说清三件事：**村庄几级、还差什么、今天能做什么**。
 * 三项门槛各一行（金币 / 水晶 / 祈福），共用一套进度条底色 ——
 * 玩家一眼就能看出瓶颈在哪（通常永远是祈福：33 人一天一次，花钱买不到）。
 *
 * 满级之后进度区换成一句「已经满级」，但祈福与建设日志照旧可用：
 * 满级不代表没有日常。
 *
 * @param {number} [now]
 */
function villageCardHTML(now = Date.now()) {
  const snap = villageSnapshot(now);
  const yieldPct = Math.round(snap.level * VILLAGE_YIELD_PER_LEVEL * 100);

  const head = `
    <div class="cv-head">
      <span class="cv-name">🏘 ${VILLAGE_NAME}</span>
      <span class="cv-lv">Lv.${snap.level}</span>
      <span class="cv-yield">全村产量 +${yieldPct}%</span>
    </div>`;

  let body = '';
  if (snap.max) {
    body = '<div class="cv-done">🏆 村庄已经满级 —— 该有的都有了</div>';
  } else {
    const t = snap.tier;
    const rows = [
      ['💰', '金币', snap.coins, t.coins],
      [crystalEmoji(t.crystal), '水晶', snap.crystals, t.crystals],
      ['🙏', '祈福', snap.pray, t.prayers],
    ];
    const left = rows.filter(([, , have, need]) => have < need).length;

    body = `
      <div class="cv-go">升到 Lv.${snap.level + 1} 还差 ${left} 项</div>
      <div class="cv-rows">
        ${rows.map(([icon, label, have, need]) => {
          const pct = Math.min(100, Math.round((have / Math.max(1, need)) * 100));
          return `
            <div class="cv-row${have >= need ? ' done' : ''}">
              <span class="cv-k">${icon} ${label}</span>
              <i class="cv-bar"><b style="width:${pct}%"></b></i>
              <span class="cv-v">${num(have)}<em>/${num(need)}</em></span>
            </div>`;
        }).join('')}
      </div>`;
  }

  const prayLabel = snap.prayedToday ? '今天已祈福' : '🙏 祈福';
  // 金币与水晶都满了（村民也会投，很容易先满）：这时「投入」点了也什么都投不进去，
  // 按钮直接改成「资源已齐」并禁用 —— 剩下只等祈福的那几项
  const resFull = !snap.max
    && snap.coins >= snap.tier.coins && snap.crystals >= snap.tier.crystals;

  return `
    <div class="center-village" data-role="village-card">
      ${head}
      ${body}
      <div class="cv-acts">
        <button class="cv-btn" data-action="village-invest" ${snap.max || resFull ? 'disabled' : ''}>
          ${resFull ? '🚧 资源已齐' : '🚧 投入资源'}
        </button>
        <button class="cv-btn pray" data-action="village-pray" ${snap.prayedToday ? 'disabled' : ''}>
          ${prayLabel}
        </button>
        <button class="cv-btn ghost" data-action="village-log">📜 建设日志</button>
      </div>
    </div>`;
}

/** 上一次渲染村庄卡时的自然日：跨 0 点要把「今天已祈福」放出来 */
let villageDay = '';

/** 只重绘村庄卡（升级 / 祈福 / 投入之后），不重建整页 */
function paintVillage() {
  const root = byId('center');
  const card = root?.querySelector('[data-role="village-card"]');
  if (!card) return;
  villageDay = dayKey(Date.now());
  card.outerHTML = villageCardHTML();
}

/** 投入资源的弹窗：两个输入框，默认填「还差的量」与「手上有的」取小 */
function openInvest() {
  const snap = villageSnapshot();
  if (snap.max) {
    showToast('村庄已经满级了，没什么可投的');
    return;
  }
  const t = snap.tier;
  const coinMax = Math.min(Math.max(0, t.coins - snap.coins), state.farm.coins);
  const crysMax = Math.min(Math.max(0, t.crystals - snap.crystals), snap.crystalStock);
  // 一项都投不进去（还差的部分村里已经有了 / 手上没有这一档水晶）：别开一个空弹窗
  if (!coinMax && !crysMax) {
    showToast('现在没什么可投的 —— 这部分村里已经有了，或者你手上还没有这一档水晶');
    return;
  }

  openModal(`
    <div class="modal-head">
      <h3>🚧 投入村庄建设</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">升到 Lv.${snap.level + 1} 要 ${num(t.coins)} 金币、${t.crystals} 枚${crystalName(t.crystal)}、${t.prayers} 次祈福</div>

    <div class="cvi-list">
      <div class="cvi-row">
        <span class="cvi-k">💰 金币</span>
        <input class="cvi-input" data-role="coins" type="number" inputmode="numeric"
               min="0" max="${coinMax}" step="100" value="${coinMax}">
        <button class="cvi-max" data-action="village-fill" data-id="coins"
                data-max="${coinMax}">投 ${num(coinMax)}</button>
      </div>
      <div class="cvi-row">
        <span class="cvi-k">${crystalEmoji(t.crystal)} ${crystalName(t.crystal)}</span>
        <input class="cvi-input" data-role="crystals" type="number" inputmode="numeric"
               min="0" max="${crysMax}" step="1" value="${crysMax}">
        <button class="cvi-max" data-action="village-fill" data-id="crystals"
                data-max="${crysMax}">投 ${crysMax}</button>
      </div>
    </div>

    <div class="modal-sub cvi-tip">投入的金币与水晶在升级那一刻一起清零，投多了也不会退还 —— 所以这里只让你投「还差的那部分」。水晶只能投当前等级要用的这一档；邻居也会往村里投，进度条可能一不留神就满了。</div>

    <div class="modal-foot">
      <button class="btn primary cvi-ok" data-action="village-invest-ok">确认投入</button>
    </div>
  `, (action, el) => {
    const card = el.closest('.modal-card');

    if (action === 'village-fill') {
      const input = card?.querySelector(`[data-role="${el.dataset.id}"]`);
      if (input) input.value = el.dataset.max;
      return;
    }

    if (action === 'village-invest-ok') {
      const coins = Number(card?.querySelector('[data-role="coins"]')?.value || 0);
      const crystals = Number(card?.querySelector('[data-role="crystals"]')?.value || 0);
      invest({ coins, crystals }).then((res) => {
        if (!res.ok) {
          notify(res.reason || '投入失败');
          return;
        }
        closeModal();
        paintVillage();
      });
    }
  }, 'village-modal');
}

/** 建设日志：近 7 天（与农场日志、时报同一口径） */
function openVillageLog() {
  const list = villageLogs();
  openModal(`
    <div class="modal-head">
      <h3>📜 建设日志</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">最近 7 天的资源投入、祈福与产出</div>
    <div class="news-list">
      ${list.length
        ? recordItemsHTML(list, { withDay: true })
        : '<div class="empty-tip">📭<br>村里还很安静<br>去投点东西、祈个福吧</div>'}
    </div>
  `, null, 'board-modal');
}

/* ---------- 页面 ---------- */

export function renderCenter() {
  const root = byId('center');
  if (!root) return;
  const now = Date.now();
  const { online, total } = onlineStats(now);
  const orders = orderCount(now);

  setHTML(root, `
    ${villageCardHTML(now)}
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
    ${rankCardHTML()}
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

  // 跨过 0 点：把「今天已祈福」放出来（每分钟检查一次，成本只有一次字符串比较）
  if (villageDay && villageDay !== dayKey(now)) paintVillage();
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
  // 榜单卡片：整张卡可点，开排行榜弹窗（与子页面版同源渲染）
  'center-rank'() {
    openRankModal();
  },
  // ---- 村庄建设 ----
  'village-invest'() {
    openInvest();
  },
  'village-pray'() {
    prayOnce();
  },
  'village-log'() {
    openVillageLog();
  },
};

/**
 * 每日祈福。
 *
 * 奖励直接进背包（金币 / 种子 / 道具 / 产出），抽中时 village.pray 自己会
 * 弹 toast 并发时报 —— 这里只负责挡住「今天已经祈过」的情况。
 */
function prayOnce() {
  const snap = villageSnapshot();
  if (snap.prayedToday) {
    showToast('今天已经祈福过了，明天再来');
    return;
  }
  pray().then((res) => {
    if (!res.ok) {
      notify(res.reason || '祈福失败');
      return;
    }
    paintVillage();
    if (!res.reward) showToast('🙏 祈福完毕，村里安宁');
  });
}

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
  // 村庄：投入 / 祈福 / 升级（含邻居祈福把计数推上去）→ 只重绘那一张卡
  on(EVENTS.VILLAGE, paintVillage);
}
