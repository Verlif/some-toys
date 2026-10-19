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
import { PERSONALITIES } from '../../data/friends.js';
import { stageEmoji, stageName, stageOf } from '../../data/stages.js';
import { fmtDuration } from '../../core/utils.js';
import { closeModal, openModal } from '../modal.js';
import { showSimOverlay } from '../sim-overlay.js';

let settling = false;

/* ---------- 卡片 ---------- */

/** 动态里的时间戳 → 「3 分钟前」这样的相对时间 */
function relativeTime(at, now) {
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}小时前`;
  return `${Math.floor(diff / 86_400_000)}天前`;
}

function logHTML(friend, now) {
  if (!friend.log?.length) return '';
  const items = friend.log.slice(0, 3).map((entry) => `
    <div class="friend-log-item">
      <span class="when">${relativeTime(entry.at, now)}</span>
      <span>${entry.emoji} ${escapeText(entry.text)}</span>
    </div>`).join('');
  return `<div class="friend-log">${items}</div>`;
}

/** 动态文案里混着邻居名，这里做一次转义，避免名字里的符号破坏结构 */
function escapeText(text) {
  return String(text).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
}

function cardHTML(friend, now) {
  const ripe = social.stealableCount(friend, now);
  const { online, inMs } = social.presenceOf(friend, now);

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
          <span class="friend-chip">💰 ${formatCoins(friend.coins)}</span>
          ${ripe > 0 ? `<span class="friend-chip ripe">🟡 ${ripe} 块可偷</span>` : ''}
          <span class="friend-chip ${online ? 'online' : ''}">
            ${online ? '在线' : `${fmtDuration(inMs)}后上线`}
          </span>
        </div>
        ${logHTML(friend, now)}
      </div>
    </div>`;
}

/** 重绘邻居列表 */
export function renderFriends() {
  const now = Date.now();
  const cards = state.friends.map((friend) => cardHTML(friend, now)).join('');

  setHTML(byId('friends'), `
    <div class="section-title">👥 邻居农场</div>
    <div style="padding:0 13px">${cards}</div>`);
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
    }

    renderFriends();
  } finally {
    settling = false;
  }
}

/* ---------- 拜访弹窗 ---------- */

/** 弹窗里一块地的卡片。三种状态共用同一个高度骨架 */
function plotCardHTML(friend, index, now) {
  const plot = friend.plots[index];
  const base = (extra) => `<div class="npc-plot ${extra.cls || ''}">${extra.body}</div>`;

  if (!plot.cropId) {
    return base({ cls: 'empty', body: `<div class="np-emoji">🟫</div><div class="np-name">空地</div><div class="np-meta">闲置中</div>` });
  }

  const crop = CROPS[plot.cropId];

  if (social.isStealable(plot, now)) {
    const left = crop.harvests - (plot.harvested || 0);
    return base({
      cls: 'ripe',
      body: `
        <div class="np-emoji">${crop.emoji}</div>
        <div class="np-name">${crop.name}</div>
        <div class="np-meta">可偷取${left > 1 ? ` · 还剩 ${left - 1} 茬` : ''}</div>
        <button class="btn small harvest" data-action="steal" data-id="${friend.id}" data-plot="${index}">偷 1 个</button>`,
    });
  }

  if (now >= plot.readyAt) {
    return base({
      cls: 'stolen',
      body: `
        <div class="np-emoji">${crop.emoji}</div>
        <div class="np-name">${crop.name}</div>
        <div class="np-meta">刚被顺走过</div>`,
    });
  }

  const stage = stageOf(plot, crop, now);
  return base({
    body: `
      <div class="np-emoji">${stageEmoji(crop, stage)}</div>
      <div class="np-name">${crop.name}</div>
      <div class="np-meta">${stageName(stage)}</div>
      <div class="np-time">${fmtDuration(plot.readyAt - now)}</div>`,
  });
}

/**
 * 拜访弹窗。顶部的信息区拆成独立的卡片，而不是把一堆文字挤在一行里。
 * 地块格子统一高度：按钮用 margin-top:auto 顶到底部，
 * 这样「偷完之后少了按钮」也不会让同一行看起来参差不齐。
 */
function openFriendModal(friendId) {
  const friend = getFriend(friendId);
  if (!friend) return;
  const now = Date.now();
  const { online, inMs } = social.presenceOf(friend, now);
  const stealable = social.stealableCount(friend, now);

  const stats = [
    { k: '等级', v: `Lv.${friend.level}` },
    { k: '身家', v: `${formatCoins(friend.coins)} 💰` },
    { k: '地块', v: `${friend.plots.length} 块` },
    { k: '状态', v: online ? '在线' : `${fmtDuration(inMs)}后上线` },
  ];

  openModal(`
    <div class="npc-head">
      <div class="npc-avatar">${friend.avatar}</div>
      <div class="npc-id">
        <div class="npc-name">${escapeText(friend.name)}</div>
        <div class="npc-sub">${escapeText(PERSONALITIES[friend.personality]?.name || '邻居')}的农场</div>
      </div>
      <div class="npc-badge ${stealable > 0 ? 'ripe' : ''}">${stealable > 0 ? `可偷 ${stealable}` : '暂无可偷'}</div>
    </div>

    <div class="npc-stats">
      ${stats.map((s) => `<div class="npc-stat"><span>${s.k}</span><b>${s.v}</b></div>`).join('')}
    </div>

    ${logHTML(friend, now)}

    <div class="npc-section-title">🟫 农场（${friend.plots.length} 块）</div>
    <div class="npc-plots">
      ${friend.plots.map((_, i) => plotCardHTML(friend, i, now)).join('')}
    </div>

    <div class="npc-foot">
      <button class="btn ghost" data-action="help" data-id="${friend.id}" style="width:100%">
        🤝 帮忙打理（+经验）
      </button>
      <p class="npc-tip">偷菜会让邻居不高兴，但也是一种社交方式。</p>
    </div>
  `, async (action, el) => {
    if (action === 'steal') {
      await social.steal(el.dataset.id, Number(el.dataset.plot));
      // 偷完重开，让「刚被顺走过」立刻可见
      if (getFriend(el.dataset.id)) openFriendModal(el.dataset.id);
      return;
    }
    if (action === 'help') {
      const helped = await social.helpTend(el.dataset.id);
      if (helped) closeModal();
    }
  });
}

/* ---------- 挂载 ---------- */

/** 列表项动作。整行可点，所以用委托而不是给每张卡塞按钮 */
const FRIEND_ACTIONS = {
  visit: (el) => openFriendModal(el.dataset.id),
};

export function mountFriends() {
  const root = byId('friends');

  const enter = (el) => FRIEND_ACTIONS.visit(el);
  delegate(root, 'click', '[data-action="visit"]', enter);
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('[data-action="visit"]');
    if (!card) return;
    event.preventDefault();
    enter(card);
  });

  on(EVENTS.FRIENDS, renderFriends);
}