/**
 * 每日排行榜子页面。
 *
 * 布局：底部 6 个大类 TAB 切换单榜；冒险王的档位分段条只在冒险王 TAB 下显示（顶部）。
 * 每张榜单卡片下方紧跟「今日实时排名」（含 NPC），bump 防抖后发 EVENTS.STATS，
 * main.js 挂 renderCurrent 自动刷新。
 *
 * 展示**昨天**的榜单（下午 2 点结算，前三名递减发奖，并列都发）；
 * 本页只读 store/daily.js，不发奖、不改数据。
 */
import { escapeHtml } from '../../core/dom.js';
import { PLAYER_ID, state } from '../../store/state.js';
import {
  BOARDS,
  boardRank,
  latestSettled,
  playerStanding,
  todayRank,
  todayValue,
} from '../../store/daily.js';
import { MAP_TIERS } from '../../data/adventure.js';
import { keepBarScroll } from '../scroll-keep.js';

/** 底部 6 个大类 TAB */
const TABS = [
  { key: 'care', label: '最友善' },
  { key: 'dog', label: '狗狗王' },
  { key: 'manage', label: '打理王' },
  { key: 'gift', label: '送礼达人' },
  { key: 'work', label: '农事劳模' },
  { key: 'adv', label: '冒险王' },
];

/** 当前选中的大类（'care' / 'dog' / 'manage' / 'gift' / 'work' / 'adv'） */
let activeBoard = 'care';
/** 冒险王当前看的档位（0 = 未定，进页按等级定默认） */
let advTier = 0;

function defaultTier() {
  const ok = MAP_TIERS.filter((m) => state.farm.level >= m.unlock);
  return ok.length ? ok[ok.length - 1].tier : 1;
}

/** 当前 TAB 对应的 metric（冒险王带档位后缀） */
function currentMetric() {
  return activeBoard === 'adv' ? `adv${advTier || defaultTier()}` : activeBoard;
}

/** 从 BOARDS 里找当前 metric 对应的那张榜 */
function currentBoard() {
  const metric = currentMetric();
  return BOARDS.find((b) => b.metric === metric) || BOARDS[0];
}

/** 名次徽章 */
const medal = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`);

/** 一行排名 */
function rowHTML(entry, board, extraClass = '') {
  const me = entry.actor === PLAYER_ID;
  return `
    <div class="rank-row${me ? ' me' : ''}${extraClass ? ` ${extraClass}` : ''}">
      <span class="rank-medal">${medal(entry.rank)}</span>
      <span class="rank-ava">${entry.avatar}</span>
      <span class="rank-who">${escapeHtml(entry.name)}${me ? '（你）' : ''}</span>
      <span class="rank-val">${escapeHtml(board.format(entry.value))}</span>
    </div>`;
}

/** 昨日榜单卡 */
function yesterdayHTML(date, board) {
  const top = boardRank(date, board.metric, 3);
  const inTop = top.some((e) => e.actor === PLAYER_ID);
  const meRow = inTop ? '' : (() => {
    const mine = playerStanding(date, board.metric);
    return `
      <div class="rank-row mine-dim">
        <span class="rank-medal">·</span>
        <span class="rank-ava">${state.farm.avatar}</span>
        <span class="rank-who">${escapeHtml(state.farm.name)}（你）</span>
        <span class="rank-val">${mine.rank
          ? `第 ${mine.rank} 名 · ${escapeHtml(board.format(mine.value))}`
          : '未上榜'}</span>
      </div>`;
  })();

  return `
    <div class="rank-card">
      <div class="rank-head">
        <span class="rank-icon">${board.icon}</span>
        <div class="rank-head-text">
          <div class="rank-name">昨日 · ${board.name}</div>
          <div class="rank-desc">${board.desc}</div>
        </div>
      </div>
      <div class="rank-rows">
        ${top.length
          ? top.map((e) => rowHTML(e, board)).join('')
          : '<div class="rank-empty">昨天这项大家都歇了</div>'}
        ${meRow}
      </div>
    </div>`;
}

/** 今日实时排名卡（含 NPC，随 bump 实时刷新） */
function todayHTML(board) {
  const top = todayRank(board.metric, 5);
  const inTop = top.some((e) => e.actor === PLAYER_ID);
  const meRow = inTop ? '' : (() => {
    const myVal = todayValue(board.metric);
    return myVal > 0
      ? `<div class="rank-row mine-dim">
           <span class="rank-medal">·</span>
           <span class="rank-ava">${state.farm.avatar}</span>
           <span class="rank-who">${escapeHtml(state.farm.name)}（你）</span>
           <span class="rank-val">${escapeHtml(board.format(myVal))}</span>
         </div>`
      : '';
  })();

  return `
    <div class="rank-card today-card">
      <div class="rank-head">
        <span class="rank-icon">⏳</span>
        <div class="rank-head-text">
          <div class="rank-name">今日实时 · ${board.name}</div>
          <div class="rank-desc">今天的数据明天下午 2 点结算，这里实时更新，不计奖</div>
        </div>
      </div>
      <div class="rank-rows">
        ${top.length
          ? top.map((e) => rowHTML(e, board, 'today')).join('')
          : '<div class="rank-empty">今天这项还没人动手</div>'}
        ${meRow}
      </div>
    </div>`;
}

/** 冒险王档位切换条（只在冒险王 TAB 下显示） */
function tiersHTML() {
  return `<div class="rank-tiers">${MAP_TIERS.map((m) => `
    <button class="filter-chip${m.tier === (advTier || defaultTier()) ? ' active' : ''}"
            data-action="rank-tier" data-tier="${m.tier}">${m.name}</button>`).join('')}</div>`;
}

/** 底部大类 TAB 条 */
function tabsHTML() {
  return `<div class="rank-tabs">${TABS.map((t) => `
    <button class="filter-chip${t.key === activeBoard ? ' active' : ''}"
            data-action="rank-tab" data-key="${t.key}">${t.label}</button>`).join('')}</div>`;
}

/** 当前 TAB 对应的 hero 文案 */
function heroHTML() {
  const settled = latestSettled();
  return settled
    ? `<div class="rank-hero">
         <div class="rank-hero-date">📅 昨日榜单 · ${settled.date}</div>
         <div class="rank-hero-sub">每天下午 2 点结算，前三名有奖，并列都发</div>
       </div>`
    : `<div class="rank-hero empty">
         <div class="rank-hero-date">🏆 榜单准备中</div>
         <div class="rank-hero-sub">第一页榜单在明天下午 2 点后产生，今天先努力表现吧</div>
       </div>`;
}

export const rankPage = {
  render(body, ctx) {
    if (!advTier) advTier = defaultTier();
    const settled = latestSettled();
    const board = currentBoard();
    const isAdv = activeBoard === 'adv';

    body.innerHTML = `
      ${heroHTML()}
      ${isAdv ? tiersHTML() : ''}
      ${settled ? yesterdayHTML(settled.date, board) : ''}
      ${todayHTML(board)}
    `;

    // 底部 TAB 用子页面底栏固定；横滚位置接力
    if (ctx?.setFoot) {
      const footEl = document.getElementById('subpageFoot');
      keepBarScroll(footEl, '.rank-tabs', () => {
        ctx.setFoot(tabsHTML());
      });
    }
  },

  actions: {
    /** 切换底部大类 TAB（整页重绘，状态挂模块变量） */
    'rank-tab'(el) {
      activeBoard = el.dataset.key || activeBoard;
      // 切到冒险王时补一个默认档位
      if (activeBoard === 'adv' && !advTier) advTier = defaultTier();
    },
    /** 切换冒险王的档位 */
    'rank-tier'(el) {
      advTier = Number(el.dataset.tier) || advTier || defaultTier();
    },
  },
};
