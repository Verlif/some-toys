/**
 * 邻居页：拜访邻居农场、偷成熟作物、帮忙打理。
 *
 * 进入本页时会先跑一次离线结算（见 social.createSettler），
 * 把玩家不在这段时间里邻居们自己发生的事补算出来，
 * 结算过程用等待画面覆盖，不会让页面卡住。
 */
import { byId, delegate, setHTML } from '../../core/dom.js';
import { on, EVENTS } from '../../core/bus.js';
import { getFriend, state } from '../../store/state.js';
import * as social from '../../store/social.js';
import { formatCoins } from '../../store/npc-sim.js';
import { CROPS } from '../../data/crops.js';
import { PERSONALITIES, STEAL_LABELS } from '../../data/friends.js';
import { stageEmoji, stageName, stageOf } from '../../data/stages.js';
import { fmtDuration } from '../../core/utils.js';
import { openModal } from '../modal.js';
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

/* ---------- 卡片 ---------- */

/** 动态里的时间戳 → 「3 分钟前」这样的相对时间 */
function relativeTime(at, now) {
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}小时前`;
  return `${Math.floor(diff / 86_400_000)}天前`;
}

function logHTML(friend, now, limit = 3) {
  if (!friend.log?.length) return '';
  return friend.log.slice(0, limit).map((entry) => `
    <div class="friend-log-item">
      <span class="when">${relativeTime(entry.at, now)}</span>
      <span>${entry.emoji} ${escapeText(entry.text)}</span>
    </div>`).join('');
}

/** 动态文案里混着邻居名，这里做一次转义，避免名字里的符号破坏结构 */
function escapeText(text) {
  return String(text).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
}

function cardHTML(friend, now) {
  const ripe = social.stealableCount(friend, now);
  const care = social.careCount(friend, now);

  return `
    <div class="friend-card" data-action="visit" data-id="${friend.id}" role="button" tabindex="0">
      <div class="friend-avatar">${friend.avatar}</div>
      <div class="friend-body">
        <div class="friend-name">
          ${escapeText(friend.name)}
          <span class="lv">Lv.${friend.level}</span>
          <span class="friend-chevron">›</span>
        </div>
        <div class="friend-stats">
          <span class="friend-chip job">${escapeText(friend.profession || '邻居')}</span>
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
 * @returns {object[]} 新数组，不改动 state.friends
 */
function friendsShown(now) {
  const list = [...state.friends];
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

/** 重绘邻居列表 */
export function renderFriends() {
  const now = Date.now();
  const list = friendsShown(now);
  const chips = SORTS.map((s) => `
    <button class="filter-chip ${s.key === sortMode ? 'active' : ''}"
            data-action="sort-friends" data-id="${s.key}">${s.label}</button>`).join('');

  setHTML(byId('friends'), `
    <div class="section-title">👥 邻居农场</div>
    <div class="friend-sort">
      ${chips}
      <span class="shop-filter-count">${list.length} / ${state.friends.length}</span>
    </div>
    <div class="friend-list">${list.length
      ? list.map((friend) => cardHTML(friend, now)).join('')
      : '<div class="empty-tip">🌾<br>这个档位下暂时没有邻居<br>换个筛选看看</div>'}</div>`);
}

/* ---------- 离线结算 ---------- */

/**
 * 进入邻居页：先补算离线期间的成长，再渲染。
 * 结算用 requestAnimationFrame 分帧驱动；离线太久时远期部分走聚合公式，
 * 所以无论多久没上线都是常数级开销。
 */
export async function enterFriendsPage() {
  if (settling) return;
  settling = true;

  try {
    const settler = social.createSettler();
    const overlay = settler.total > 0 ? showSimOverlay() : null;

    if (overlay) {
      await new Promise((resolve) => {
        const frame = () => {
          const finished = settler.run();
          overlay.update(settler.done, settler.total);
          if (finished) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      await social.persistFriends();
      await overlay.close();

      // 邻居这段时间在玩家农场上的动作，合并成一条提示；
      // 逐条弹的话离线久了会连弹十几条
      const { stolen, cared, caught } = settler.summary;
      const parts = [];
      if (stolen) parts.push(`被顺走 ${stolen} 个作物`);
      if (cared) parts.push(`邻居帮你照料了 ${cared} 块地`);
      if (caught) parts.push(`守护犬赶走了 ${caught} 次`);
      if (parts.length) showToast(`🏡 你不在时：${parts.join('，')}`);
    }

    renderFriends();
  } finally {
    settling = false;
  }
}

/* ---------- 拜访弹窗 ---------- */

/**
 * 弹窗里一块地的卡片。
 *
 * 缺水 / 生虫的地会多出对应的操作按钮 —— 玩家必须在**具体那块地**上
 * 点一下才能拿到经验，没有「一键打理」这种捷径。
 */
function plotCardHTML(friend, index, now) {
  const plot = friend.plots[index];
  // data-slot 让操作之后能只替换这一格，而不是整窗重开（滚动位置也就不会丢）
  const base = (extra) => `<div class="npc-plot ${extra.cls || ''}" data-slot="${index}">${extra.body}</div>`;

  if (!plot.cropId) {
    return base({ cls: 'empty', body: `<div class="np-emoji">🟫</div><div class="np-name">空地</div><div class="np-meta">闲置中</div>` });
  }

  const crop = CROPS[plot.cropId];
  const wantWater = social.needsWater(plot, now);
  const wantPest = social.needsPest(plot, now);
  const boost = plot.boost ? `<div class="np-meta">产量 +${Math.round(plot.boost * 100)}%</div>` : '';

  // 照料按钮：只有真的缺水 / 生虫时才出现
  // 做成小图标按钮，这样一格里能同时放下「偷」和两个照料按钮，格子高度才统一
  const care = [
    wantWater ? `<button class="icon-btn warn" data-action="npc-water" data-id="${friend.id}"
      data-plot="${index}" title="帮忙浇水（+经验）">💧</button>` : '',
    wantPest ? `<button class="icon-btn warn" data-action="npc-pest" data-id="${friend.id}"
      data-plot="${index}" title="帮忙捉虫（+经验）">🐛</button>` : '',
  ].join('');

  if (social.isStealable(plot, now)) {
    const left = crop.harvests - (plot.harvested || 0);
    return base({
      cls: 'ripe',
      body: `
        <div class="np-emoji">${crop.emoji}</div>
        <div class="np-name">${crop.name}</div>
        <div class="np-meta ripe-meta">可偷取${left > 1 ? ` · 还剩 ${left - 1} 茬` : ''}</div>
        ${boost}
        <div class="np-acts">
          <button class="btn small harvest" data-action="steal" data-id="${friend.id}" data-plot="${index}">偷 1 个</button>
          ${care}
        </div>`,
    });
  }

  if (now >= plot.readyAt) {
    const stolen = plot.stolenCount || 0;
    return base({
      cls: 'stolen',
      body: `
        <div class="np-emoji">${crop.emoji}</div>
        <div class="np-name">${crop.name}</div>
        <div class="np-meta">${stolen ? `已被顺走 ${stolen} 个` : '这块刚被顺过'}</div>
        ${boost}
        <div class="np-acts">${care}</div>`,
    });
  }

  const stage = stageOf(plot, crop, now);
  return base({
    cls: wantWater || wantPest ? 'care' : '',
    body: `
      <div class="np-emoji">${stageEmoji(crop, stage)}</div>
      <div class="np-name">${crop.name}</div>
      <div class="np-meta">${stageName(stage)}</div>
      <div class="np-time">${fmtDuration(plot.readyAt - now)}</div>
      ${boost}
      ${care ? `<div class="np-acts">${care}</div>` : ''}`,
  });
}

/** 弹窗底部那句提示，状态变了要跟着换 */
function tipText(friend, now) {
  return social.needsHelp(friend, now)
    ? '有地缺水或生虫了 —— 在对应的地块上点 💧 或 🐛 帮忙，能拿到经验。'
    : '偷菜会让邻居不高兴，但也是一种社交方式。';
}

/** 弹窗里的操作记录：最多 10 条，放在固定高度的滚动区里 */
function logBoxHTML(friend, now) {
  const items = logHTML(friend, now, 10);
  return items
    ? `<div class="friend-log npc-log" data-role="log">${items}</div>`
    : '<div class="npc-log empty" data-role="log">还没有值得记下的事</div>';
}

/**
 * 拜访弹窗。顶部的信息区拆成独立的卡片，而不是把一堆文字挤在一行里。
 * 地块格子统一高度：按钮用 margin-top:auto 顶到底部，
 * 这样「偷完之后少了按钮」也不会让同一行看起来参差不齐。
 *
 * 操作之后**不重开弹窗**：只替换那一格地块卡、角标和底部提示，
 * 滚动位置与日志区的视口都保持不变。
 */
function openFriendModal(friendId) {
  const friend = getFriend(friendId);
  if (!friend) return;
  const now = Date.now();
  const stealable = social.stealableCount(friend, now);

  const stats = [
    { k: '等级', v: `Lv.${friend.level}` },
    { k: '身家', v: `${formatCoins(friend.coins)} 💰` },
    { k: '地块', v: `${friend.plots.length} 块` },
    { k: '偷菜', v: STEAL_LABELS[friend.steal] || '偶尔顺菜' },
  ];

  /** 只刷新受影响的这一格，以及需要跟着变的角标 / 提示 / 日志 */
  function refreshPlot(index) {
    const current = getFriend(friendId);
    if (!current) return;
    const at = Date.now();

    const slot = document.querySelector(`#modal .npc-plot[data-slot="${index}"]`);
    if (slot) slot.outerHTML = plotCardHTML(current, index, at);

    const badge = document.querySelector('#modal [data-role="badge"]');
    const left = social.stealableCount(current, at);
    if (badge) {
      badge.textContent = left > 0 ? `可偷 ${left}` : '暂无可偷';
      badge.classList.toggle('ripe', left > 0);
    }

    const tip = document.querySelector('#modal [data-role="tip"]');
    if (tip) tip.textContent = tipText(current, at);

    const logBox = document.querySelector('#modal [data-role="log"]');
    if (logBox) {
      // 记录区自己也有滚动位置，重绘后要还回去
      const keep = logBox.scrollTop;
      logBox.outerHTML = logBoxHTML(current, at);
      const next = document.querySelector('#modal [data-role="log"]');
      if (next) next.scrollTop = keep;
    }
  }

  openModal(`
    <div class="npc-head">
      <div class="npc-avatar">${friend.avatar}</div>
      <div class="npc-id">
        <div class="npc-name">${escapeText(friend.name)}</div>
        <div class="npc-sub">
          ${escapeText(PERSONALITIES[friend.personality]?.name || '邻居')}
          · ${escapeText(friend.profession || '农户')}
        </div>
      </div>
      <div class="npc-badge ${stealable > 0 ? 'ripe' : ''}" data-role="badge">
        ${stealable > 0 ? `可偷 ${stealable}` : '暂无可偷'}
      </div>
    </div>

    <div class="npc-stats">
      ${stats.map((s) => `<div class="npc-stat"><span>${s.k}</span><b>${s.v}</b></div>`).join('')}
    </div>

    <div class="npc-section-title">📜 最近操作</div>
    ${logBoxHTML(friend, now)}

    <div class="npc-section-title">🟫 农场（${friend.plots.length} 块）</div>
    <div class="npc-plots">
      ${friend.plots.map((_, i) => plotCardHTML(friend, i, now)).join('')}
    </div>

    <p class="npc-tip" data-role="tip">${tipText(friend, now)}</p>
  `, async (action, el) => {
    const index = Number(el.dataset.plot);
    if (action === 'steal') {
      await social.steal(el.dataset.id, index);
      refreshPlot(index);
      return;
    }
    if (action === 'npc-water') {
      await social.waterNeighborPlot(el.dataset.id, index);
      refreshPlot(index);
      return;
    }
    if (action === 'npc-pest') {
      await social.catchPestNeighborPlot(el.dataset.id, index);
      refreshPlot(index);
    }
  });
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

  on(EVENTS.FRIENDS, renderFriends);
}