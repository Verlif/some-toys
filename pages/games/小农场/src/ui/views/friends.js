/**
 * 好友页：**只有好友**的列表（拜访、筛选、搜索）。
 *
 * 第 57 轮从「邻居页」改成「好友页」：非好友不能偷菜、不能催上线，
 * 把他们铺在这里只会让玩家一路点空。全村名单搬去了村中心的村民总览
 * （见 ui/views/center.js），那里才是「看所有人」的地方。
 *
 * 进入本页时会先跑一次离线结算（见 social.createSettler），
 * 把玩家不在这段时间里邻居们自己发生的事补算出来，
 * 结算过程用等待画面覆盖，不会让页面卡住。
 *
 * 「打开某座邻居农场」的弹窗不在这里 —— 它在 `ui/friend-modal.js`，
 * 因为记录里的人名标签、时报里的人名标签也要用同一个弹窗。
 */
import { byId, delegate, escapeHtml, setHTML } from '../../core/dom.js';
import { on, EVENTS } from '../../core/bus.js';
import { PLAYER_ID, getFriend, state } from '../../store/state.js';
import * as social from '../../store/social.js';
import { formatCoins } from '../../core/utils.js';
import { getRelation, isFriend, relationBadge } from '../../store/relation.js';
import { isNpcOnline } from '../../data/friends.js';
import { recordItemsHTML } from '../records.js';
import { openFriendModal } from '../friend-modal.js';
import { showSimOverlay } from '../sim-overlay.js';
import { showOfflineReport, wantsReport } from '../offline-report.js';
import { showToast } from '../toast.js';
import { keepBarScroll } from '../scroll-keep.js';

let settling = false;

/**
 * 筛选与排序是**两件事**，所以分两份状态：
 *
 *   筛选：全部 / 可偷摘 / 可帮忙 —— 决定「看哪几位」，单选
 *   排序：等级 / 财富 / 好感 —— 决定「按什么排」，再点一次换方向，
 *         第三次取消（回到名单原序）
 *
 * 早先它们挤在一个 `sortMode` 里，于是「可偷摘」被当成一种排序，
 * 点了之后既不能反向也不能取消 —— 玩家想「只看看能偷的、按财富排」
 * 这种组合是做不到的。
 */
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'steal', label: '可偷摘' },
  { key: 'care', label: '可帮忙' },
];

/** 可排序的字段：`value` 取出来直接相减，好感要临时读关系表 */
const SORTS = [
  { key: 'lv', label: '等级', value: (f) => f.level },
  { key: 'coins', label: '财富', value: (f) => f.coins },
  { key: 'rel', label: '好感', value: (f) => getRelation(PLAYER_ID, f.id) },
  // 上线：在线的排前面（1e13 压过任何时间戳），其后按 onlineUntil 越大越近
  { key: 'online', label: '上线', value: (f) => (isNpcOnline(f) ? 1e13 : 0) + (f.onlineUntil || 0) },
];

let filterKey = 'all';
/** 排序：key 为空 = 名单原序；dir = −1 降序 / 1 升序 */
let sortKey = '';
let sortDir = -1;

/** 搜索关键词（按邻居名字过滤，与排序叠加生效） */
let searchQuery = '';

/**
 * 我的好友（只算 NPC —— 联机真人不在好友体系里，他们在「村镇」）。
 * @returns {object[]}
 */
const myFriends = () => state.friends.filter((npc) => isFriend(PLAYER_ID, npc.id));

/* ---------- 卡片 ---------- */

/**
 * 邻居卡片上的三条动态预览。
 *
 * 和农场日志、拜访弹窗里的「最近操作」、时报共用 `ui/records.js` ——
 * 同一个游戏里记录只有一种长相。卡片位置小，所以用 compact（字号小一号）+ 相对时间。
 */
function logHTML(friend, now, limit = 3) {
  if (!friend.log?.length) return '';
  return recordItemsHTML(friend.log, { now, limit, compact: true, relative: true });
}

/**
 * 邻居卡片。村中心的名单也复用它（导出）。
 *
 * @param {object} friend 邻居农场
 * @param {number} now
 * @param {{friendTag?: boolean}} [opts]
 *   `friendTag` = 多挂一枚「好友 / 还没加好友」的标记。
 *   只有村中心的全量名单需要它（好友页里人人都是好友，挂上去只是噪音）。
 */
export function friendCardHTML(friend, now, { friendTag = false } = {}) {
  const ripe = social.stealableCount(friend, now);
  const care = social.careCount(friend, now);
  const rel = relationBadge(getRelation(PLAYER_ID, friend.id));
  // 在线标识：按性格与身份 10~30 分钟的窗口（见 data/friends.js 的 onlineMs）
  const online = isNpcOnline(friend, now);
  const buddy = isFriend(PLAYER_ID, friend.id);
  const tag = friendTag
    ? `<span class="friend-chip ${buddy ? 'buddy' : 'stranger'}">${buddy ? '🤝 好友' : '还没加好友'}</span>`
    : '';

  return `
    <div class="friend-card ${online ? '' : 'offline'}" data-action="visit" data-id="${friend.id}" role="button" tabindex="0">
      <div class="friend-avatar">${friend.avatar}</div>
      <div class="friend-body">
        <div class="friend-name">
          ${escapeHtml(friend.name)}
          <i class="friend-dot ${online ? 'on' : 'off'}" title="${online ? '在线' : '离线'}"></i>
          <span class="lv">Lv.${friend.level}</span>
          <span class="friend-chevron">›</span>
        </div>
        <div class="friend-stats">
          ${tag}
          <span class="friend-chip job">${escapeHtml(friend.profession || '邻居')}</span>
          <span class="friend-chip">💰 ${formatCoins(friend.coins)}</span>
          <span class="friend-chip rel-${rel.key}">${rel.label} ${rel.text}</span>
          ${ripe > 0 ? `<span class="friend-chip ripe">🟡 ${ripe} 块可偷</span>` : ''}
          ${care > 0 ? `<span class="friend-chip care">💧 ${care} 块待照料</span>` : ''}
        </div>
        <div class="friend-log">${logHTML(friend, now, 3)}</div>
      </div>
    </div>`;
}

/**
 * 按当前档位挑出并排序好友
 *
 * 搜索与排序叠加：先按名字过滤，再按档位筛 / 排。
 * @returns {object[]} 新数组，不改动 state.friends
 */
function friendsShown(now) {
  const q = searchQuery.trim();
  const mine = myFriends();
  let list = q ? mine.filter((f) => f.name.includes(q)) : mine;

  if (filterKey === 'steal') list = list.filter((f) => social.stealableCount(f, now) > 0);
  if (filterKey === 'care') list = list.filter((f) => social.needsHelp(f, now));

  const sorter = SORTS.find((s) => s.key === sortKey);
  // 没选排序时保持名单原序 —— 「取消排序」要有可见的效果
  if (sorter) list.sort((a, b) => (sorter.value(a) - sorter.value(b)) * sortDir);
  return list;
}

/**
 * 一条件：筛选芯片 + 一条分隔线 + 排序芯片。
 *
 * 「可偷摘 / 可帮忙」上的数字是**好友人数**（按全部好友统计，不受搜索影响）。
 * 排序芯片选中时带箭头：↓ 降序 / ↑ 升序，取消时不带箭头。
 */
function sortChips(now) {
  const mine = myFriends();
  const counts = {
    steal: mine.filter((f) => social.stealableCount(f, now) > 0).length,
    care: mine.filter((f) => social.needsHelp(f, now)).length,
  };

  const filters = FILTERS.map((f) => `
    <button class="filter-chip ${f.key === filterKey ? 'active' : ''}"
            data-action="filter-friends" data-id="${f.key}">${f.label}${
      counts[f.key] === undefined ? '' : `<i class="chip-num">${counts[f.key]}</i>`
    }</button>`).join('');

  const sorts = SORTS.map((s) => {
    const active = s.key === sortKey;
    const arrow = active ? (sortDir === -1 ? ' ↓' : ' ↑') : '';
    return `
      <button class="filter-chip sort ${active ? 'active' : ''}"
              data-action="sort-friends" data-id="${s.key}">${s.label}${arrow}</button>`;
  }).join('');

  return `${filters}<span class="filter-sep"></span>${sorts}`;
}

/** 列表为空时的提示：区分「一个好友都没有」「筛选没结果」和「搜索没结果」 */
function emptyFriendsHTML() {
  const q = searchQuery.trim();
  if (q) return `<div class="empty-tip">🔍<br>没有名字带「${escapeHtml(q)}」的好友<br>换个关键词试试</div>`;
  // 一个好友都没有：这是**状态**，不是筛选结果，得说清怎么才能有
  if (!myFriends().length) {
    return '<div class="empty-tip">🤝<br>还没有好友<br>去村中心找人递个申请，或等他们来加你</div>';
  }
  if (filterKey === 'steal') return '<div class="empty-tip">🥷<br>好友家的作物都还没熟<br>等他们熟透再来</div>';
  if (filterKey === 'care') return '<div class="empty-tip">💧<br>好友的地都打理得很好<br>没有需要帮忙的</div>';
  return '<div class="empty-tip">🌾<br>这个档位下暂时没有好友<br>换个筛选看看</div>';
}

/**
 * 重绘邻居列表。
 *
 * 只重绘 #friendsBody（排序条 + 列表）—— 顶部的标题与搜索框是静态结构，
 * 不参与重绘：中文输入法拼拼音时重建输入框元素会打断候选过程。
 *
 * 排序条本身会被整块换掉，新元素的 scrollLeft 归零 —— 手机上点了右边那颗
 * 「好感」之后一刷新，标签条会自己滚回最前面。所以重绘前后手动接力一次横向位置
 * （走 ui/scroll-keep.js 的 keepBarScroll，和商店页恢复面板位置同一个套路）。
 * 同步赋值，不会闪一下再跳回来。
 */
export function renderFriends() {
  const now = Date.now();
  const list = friendsShown(now);
  const total = myFriends().length;
  const body = byId('friendsBody');

  // 标题后面那枚好友总数（第 61 轮）：它在静态标题里、不参与列表重绘，
  // 所以每次重绘都要自己补一次 —— 加好友、被自动解除都会走到这里
  const count = byId('friendCount');
  if (count) count.textContent = String(total);

  keepBarScroll(body, '.filter-bar', () => {
    setHTML(body, `
      <div class="filter-bar">
        ${sortChips(now)}
        <span class="shop-filter-count">${list.length} / ${total}</span>
      </div>
      <div class="friend-list">${list.length
        ? list.map((friend) => friendCardHTML(friend, now)).join('')
        : emptyFriendsHTML()}</div>`);
  });

  // 清空按钮只在有关键词时出现
  const clear = byId('friends')?.querySelector('.friend-search-clear');
  if (clear) clear.hidden = !searchQuery.trim();
}

/* ---------- 结算与上线提醒 ---------- */

/**
 * 进入邻居页：先补算离线期间的成长，再渲染。
 *
 * 结算用 requestAnimationFrame 分帧驱动；离线太久时远期部分走聚合公式，
 * 所以无论多久没上线都是常数级开销。
 */
export async function enterFriendsPage() {
  if (settling) return;
  settling = true;

  try {
    // 还有积压没算（比如刚从后台切回来）就显示等待画面
    const span = social.pendingSpan();
    const overlay = span > 60_000 ? showSimOverlay() : null;

    await social.settleWorld((progress) => overlay?.update(progress));
    if (overlay) await overlay.close();

    // 离线期间的事：合并成一条提示，逐条弹的话离线久了会连弹十几条
    const offline = social.takeOfflineSummary();
    if (offline.count > 0) {
      const parts = [];
      if (offline.stolen) parts.push(`被顺走 ${offline.stolen} 个作物`);
      if (offline.cared) parts.push(`邻居帮你照料了 ${offline.cared} 块地`);
      if (offline.caught) parts.push(`守护犬赶走了 ${offline.caught} 次`);
      if (parts.length) showToast(`🏡 你不在时：${parts.join('，')}`);
    }

    renderFriends();
  } finally {
    settling = false;
  }
}

/* ---------- 上线提醒 ---------- */

/**
 * 上线提示的合并缓冲。
 *
 * 事件是**当场**发的（见 store/social.js 的 enqueueVisit）：动作 3~7 秒后
 * 就开始演了，通知必须排在它前面 —— 早先通知要等 60 秒后那次轮询，
 * 玩家先看到「金链哥收了一茬菜」，过一会儿才被告知「金链哥上线了」。
 *
 * 但同一刻可能有几位一起上线（补算跨过一个整点），所以用 400ms 的窗口
 * 把它们合成一条，别一次弹五个 toast。
 */
let arrivalBuf = [];
let arrivalTimer = 0;

function flushArrivals() {
  arrivalTimer = 0;
  const list = arrivalBuf;
  arrivalBuf = [];
  if (!list.length) return;

  if (list.length === 1) {
    showToast(`${list[0].avatar} ${list[0].name} 上线了`, 'gold');
    return;
  }
  const names = list.slice(0, 3).map((o) => o.name).join('、');
  const more = list.length > 3 ? ` 等 ${list.length} 位` : '';
  showToast(`👋 ${names}${more} 上线了`, 'gold');
}

/** 收到一位邻居上线的通知（订阅 EVENTS.ARRIVAL） */
export function noteArrival(payload) {
  if (!payload) return;
  arrivalBuf.push(payload);
  if (arrivalTimer) return;
  arrivalTimer = setTimeout(flushArrivals, 400);
}

/**
 * 下线提醒：与上线同一套合并逻辑，只有配色不同。
 *
 * 用普通样式而不是金色 —— 金色在这是「好事发生了」，而一个人的离开
 * 不该抢走玩家的注意力；数量与文案格式保持一致，一眼能认出是同一类消息。
 */
let departBuf = [];
let departTimer = 0;

function flushDepartures() {
  departTimer = 0;
  const list = departBuf;
  departBuf = [];
  if (!list.length) return;

  if (list.length === 1) {
    showToast(`💤 ${list[0].avatar} ${list[0].name} 下线了`);
    return;
  }
  const names = list.slice(0, 3).map((o) => o.name).join('、');
  const more = list.length > 3 ? ` 等 ${list.length} 位` : '';
  showToast(`💤 ${names}${more} 下线了`);
}

/** 收到一位邻居下线的通知（订阅 EVENTS.DEPARTURE） */
export function noteDeparture(payload) {
  if (!payload) return;
  departBuf.push(payload);
  if (departTimer) return;
  departTimer = setTimeout(flushDepartures, 400);
}

/**
 * 在线期间的邻居上线提醒（每分钟的心跳里跑一次）。
 *
 * 上线 toast 已经由 `noteArrival` 当场发掉了，这里只负责推进世界、
 * 必要时弹离线时间轴、重绘名单。
 *
 * @returns {Promise<number>} 这一轮排进演出队列的邻居数量
 */
export async function checkOnlineVisits() {
  if (settling) return 0;
  settling = true;

  try {
    const result = await social.pollOnline();

    // 切后台很久（手机锁屏、挂了一夜）再回来：世界其实已经暂停了一大段。
    // 和开机一样给一份时间轴，但只在玩家没开着别的弹窗时才弹
    if (wantsReport(result) && !byId('modal')?.classList.contains('show')) {
      showOfflineReport(result.report);
      social.takeOfflineSummary();   // 时间轴讲过了，别再重复一句汇总
    }

    if (!result.deferred) return 0;
    renderFriends();
    return result.deferred;
  } finally {
    settling = false;
  }
}

/* ---------- 挂载 ---------- */

/** 列表项动作。整行可点，所以用委托而不是给每张卡塞按钮 */
const FRIEND_ACTIONS = {
  visit: (el) => openFriendModal(el.dataset.id),
  'filter-friends': (el) => {
    filterKey = el.dataset.id;
    renderFriends();
  },
  'sort-friends': (el) => {
    // 三态循环：降序 → 升序 → 取消（回到名单原序）
    const key = el.dataset.id;
    if (sortKey !== key) {
      sortKey = key;
      sortDir = -1;
    } else if (sortDir === -1) {
      sortDir = 1;
    } else {
      sortKey = '';
      sortDir = -1;
    }
    renderFriends();
  },
  'clear-search': () => {
    searchQuery = '';
    const search = byId('friendSearch');
    if (search) search.value = '';
    renderFriends();
  },
};

export function mountFriends() {
  const root = byId('friends');

  delegate(root, 'click', '[data-action]', (el) => {
    FRIEND_ACTIONS[el.dataset.action]?.(el);
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('[data-action="visit"]');
    if (!card) return;
    event.preventDefault();
    FRIEND_ACTIONS.visit(card);
  });

  // 搜索框是静态的，直接绑一次：输入即时过滤，不重建输入框本身
  const search = byId('friendSearch');
  search?.addEventListener('input', () => {
    searchQuery = search.value;
    renderFriends();
  });

  on(EVENTS.FRIENDS, renderFriends);
  // 上线通知：事件当场发的（见 store/social.js），这里合并 400ms 内的一批
  on(EVENTS.ARRIVAL, noteArrival);
  // 下线：在线窗口走到头时由世界时钟发（见 store/world.js），同样合并成一条
  on(EVENTS.DEPARTURE, noteDeparture);
  // 在线窗口（5~15 分钟）会自己走到头：每分钟只改圆点与灰度类，
  // 不重绘列表 —— 整列表重建会把玩家的滚动位置打回原型
  on(EVENTS.TICK, refreshOnline);
}

/**
 * 在线状态随时间翻：只改卡片上的类，不动 DOM 结构。
 * 选择器是文档级的 —— 邻居页与村中心名单不会同时出现，谁开著刷谁。
 */
export function refreshOnline() {
  if (document.hidden) return;
  const now = Date.now();
  for (const card of document.querySelectorAll('.friend-card[data-id]')) {
    const friend = getFriend(card.dataset.id);
    if (!friend) continue;
    const on = isNpcOnline(friend, now);
    card.classList.toggle('offline', !on);
    const dot = card.querySelector('.friend-dot');
    if (!dot) continue;
    dot.classList.toggle('on', on);
    dot.classList.toggle('off', !on);
    dot.title = on ? '在线' : '离线';
  }
}
