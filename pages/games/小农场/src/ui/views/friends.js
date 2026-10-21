/**
 * 邻居页：邻居列表（拜访、筛选、搜索）。
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
import { state } from '../../store/state.js';
import * as social from '../../store/social.js';
import { formatCoins } from '../../core/utils.js';
import { recordItemsHTML } from '../records.js';
import { openFriendModal } from '../friend-modal.js';
import { showSimOverlay } from '../sim-overlay.js';
import { showToast } from '../toast.js';

let settling = false;

/**
 * 排序 / 筛选档位。
 * 「可偷摘」「可帮忙」是**筛选**而不是排序 —— 玩家点这两个，想要的是
 * 「只看现在有事可做的」，而不是把它们排到前面。再点一次回到等级正序。
 */
const SORTS = [
  { key: 'lv-asc', label: '等级 ↑' },
  { key: 'lv-desc', label: '等级 ↓' },
  { key: 'steal', label: '可偷摘' },
  { key: 'care', label: '可帮忙' },
];

let sortMode = 'lv-asc';

/** 搜索关键词（按邻居名字过滤，与排序叠加生效） */
let searchQuery = '';

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

function cardHTML(friend, now) {
  const ripe = social.stealableCount(friend, now);
  const care = social.careCount(friend, now);

  return `
    <div class="friend-card" data-action="visit" data-id="${friend.id}" role="button" tabindex="0">
      <div class="friend-avatar">${friend.avatar}</div>
      <div class="friend-body">
        <div class="friend-name">
          ${escapeHtml(friend.name)}
          <span class="lv">Lv.${friend.level}</span>
          <span class="friend-chevron">›</span>
        </div>
        <div class="friend-stats">
          <span class="friend-chip job">${escapeHtml(friend.profession || '邻居')}</span>
          <span class="friend-chip">💰 ${formatCoins(friend.coins)}</span>
          ${ripe > 0 ? `<span class="friend-chip ripe">🟡 ${ripe} 块可偷</span>` : ''}
          ${care > 0 ? `<span class="friend-chip care">💧 ${care} 块待照料</span>` : ''}
        </div>
        <div class="friend-log">${logHTML(friend, now, 3)}</div>
      </div>
    </div>`;
}

/**
 * 按当前档位挑出并排序邻居
 *
 * 搜索与排序叠加：先按名字过滤，再按档位筛 / 排。
 * @returns {object[]} 新数组，不改动 state.friends
 */
function friendsShown(now) {
  const q = searchQuery.trim();
  const list = q
    ? state.friends.filter((f) => f.name.includes(q))
    : [...state.friends];
  if (sortMode === 'steal') {
    return list
      .filter((f) => social.stealableCount(f, now) > 0)
      .sort((a, b) => b.level - a.level);
  }
  if (sortMode === 'care') {
    return list
      .filter((f) => social.needsHelp(f, now))
      .sort((a, b) => b.level - a.level);
  }
  return sortMode === 'lv-desc'
    ? list.sort((a, b) => b.level - a.level)
    : list.sort((a, b) => a.level - b.level);
}

/**
 * 排序芯片（带数量角标）。
 * 「可偷摘 / 可帮忙」上的数字是**邻居人数** —— 与筛选语义一致：
 * 点它筛出来的就是这些邻居。数量按全部邻居统计，不受搜索影响。
 */
function sortChips(now) {
  const counts = {
    steal: state.friends.filter((f) => social.stealableCount(f, now) > 0).length,
    care: state.friends.filter((f) => social.needsHelp(f, now)).length,
  };
  return SORTS.map((s) => `
    <button class="filter-chip ${s.key === sortMode ? 'active' : ''}"
            data-action="sort-friends" data-id="${s.key}">${s.label}${
      counts[s.key] === undefined ? '' : `<i class="chip-num">${counts[s.key]}</i>`
    }</button>`).join('');
}

/** 列表为空时的提示：区分「筛选没结果」和「搜索没结果」 */
function emptyFriendsHTML() {
  const q = searchQuery.trim();
  if (q) return `<div class="empty-tip">🔍<br>没有名字带「${escapeHtml(q)}」的邻居<br>换个关键词试试</div>`;
  if (sortMode === 'steal') return '<div class="empty-tip">🥷<br>现在没有能顺的作物<br>等谁家的菜熟了再来</div>';
  if (sortMode === 'care') return '<div class="empty-tip">💧<br>大家的地都打理得很好<br>没有需要帮忙的</div>';
  return '<div class="empty-tip">🌾<br>这个档位下暂时没有邻居<br>换个筛选看看</div>';
}

/**
 * 排序条左右滑动：切到上一个 / 下一个排序档。
 * 滑完之后把激活的芯片滚进可见区域。
 * @param {number} delta +1 下一个，-1 上一个
 */
function shiftSort(delta) {
  const index = SORTS.findIndex((s) => s.key === sortMode);
  const next = SORTS[(index + delta + SORTS.length) % SORTS.length];
  if (!next || next.key === sortMode) return;
  sortMode = next.key;
  renderFriends();
  byId('friends')?.querySelector('.filter-chip.active')
    ?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

/**
 * 重绘邻居列表。
 *
 * 只重绘 #friendsBody（排序条 + 列表）—— 顶部的标题与搜索框是静态结构，
 * 不参与重绘：中文输入法拼拼音时重建输入框元素会打断候选过程。
 */
export function renderFriends() {
  const now = Date.now();
  const list = friendsShown(now);

  setHTML(byId('friendsBody'), `
    <div class="filter-bar">
      ${sortChips(now)}
      <span class="shop-filter-count">${list.length} / ${state.friends.length}</span>
    </div>
    <div class="friend-list">${list.length
      ? list.map((friend) => cardHTML(friend, now)).join('')
      : emptyFriendsHTML()}</div>`);

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
    const work = social.pendingWork();
    const overlay = work > 0 ? showSimOverlay() : null;

    await social.settleWorld((done, total) => overlay?.update(done, total));
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

/**
 * 在线期间的邻居上线提醒。
 *
 * 玩家挂在游戏里不动，邻居也会按自己的节奏上线 —— 上线时弹一条提示，
 * 顺便把这次上线在玩家农场上做的事说出来（顺菜、被狗赶走）。
 *
 * @returns {Promise<number>} 本次上线的邻居数量
 */
export async function checkOnlineVisits() {
  if (settling) return 0;
  settling = true;

  try {
    await social.pollOnline();
    const online = social.takeArrivals();
    if (!online.length) return 0;

    if (online.length === 1) {
      const a = online[0];
      showToast(`${a.avatar} ${a.name} 上线了 · ${a.text}`, 'gold');
    } else {
      // 一次来了好几位：只报前几个名字
      const names = online.slice(0, 3).map((o) => o.name).join('、');
      const more = online.length > 3 ? ` 等 ${online.length} 位` : '';
      showToast(`👋 ${names}${more} 上线了`, 'gold');
    }

    renderFriends();
    return online.length;
  } finally {
    settling = false;
  }
}

/* ---------- 挂载 ---------- */

/** 列表项动作。整行可点，所以用委托而不是给每张卡塞按钮 */
const FRIEND_ACTIONS = {
  visit: (el) => openFriendModal(el.dataset.id),
  'sort-friends': (el) => {
    // 再点一次已选中的筛选档就回到等级正序，避免「筛完出不来」
    sortMode = sortMode === el.dataset.id && (sortMode === 'steal' || sortMode === 'care')
      ? 'lv-asc'
      : el.dataset.id;
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

  // 排序条支持左右滑动切换档位（触屏 + 鼠标双通道）。
  // 与 drag-close 同一套纪律：move 里先确认 tracking、横向位移占优才接管、
  // 松手立刻移除 document 上的监听；触屏用 Touch + preventDefault。
  let drag = null;
  const onSortBar = (event) => (
    event.target instanceof Element ? event.target.closest('.filter-bar') : null
  );
  root.addEventListener('touchstart', (event) => {
    if (!onSortBar(event)) return;
    const t = event.touches[0];
    drag = { x: t.clientX, y: t.clientY, used: false };
  }, { passive: true });
  root.addEventListener('touchmove', (event) => {
    if (!drag || drag.used) return;
    const t = event.touches[0];
    const dx = t.clientX - drag.x;
    const dy = t.clientY - drag.y;
    // 横向位移占优且超过阈值才算「滑动切换」，否则让给纵向滚动
    if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
    drag.used = true;
    shiftSort(dx < 0 ? 1 : -1);
    if (event.cancelable) event.preventDefault();
  }, { passive: false });
  root.addEventListener('touchend', () => { drag = null; }, { passive: true });

  root.addEventListener('mousedown', (event) => {
    if (!onSortBar(event)) return;
    drag = { x: event.clientX, y: event.clientY, used: false };
    const onMove = (e) => {
      if (!drag || drag.used) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
      drag.used = true;
      shiftSort(dx < 0 ? 1 : -1);
    };
    const onUp = () => {
      drag = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  on(EVENTS.FRIENDS, renderFriends);
}
