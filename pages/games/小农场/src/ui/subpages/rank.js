/**
 * 每日排行榜子页面。
 *
 * 布局：底部 6 个大类 TAB 切换单榜；冒险王的档位分段条只在冒险王 TAB 下显示（顶部）。
 * 每张榜单卡片下方紧跟「本期实时排名」（含 NPC），bump 防抖后发 EVENTS.STATS，
 * main.js 挂 renderCurrent 自动刷新。
 *
 * 页面顺序（第 44 轮按玩家反馈调过）：**本期实时在上、昨日已发奖的在下**。
 * 玩家打开这一页多半是想知道自己现在第几，实时榜才是主信息；
 * 昨日榜留着是为了看成绩和名次奖励（卡片右上角的「奖励」按钮）。
 *
 * 本页只读 store/daily.js，不发奖、不改数据。
 */
import { escapeHtml } from '../../core/dom.js';
import { PLAYER_ID, state } from '../../store/state.js';
import {
  BOARDS,
  boardRank,
  latestSettled,
  playerStanding,
  rewardText,
  todayRank,
  todayValue,
} from '../../store/daily.js';
import { boardCountdown, boardDayKey, boardPeriodText } from '../../core/utils.js';
import { MAP_TIERS } from '../../data/adventure.js';
import { keepBarScroll } from '../scroll-keep.js';
import { openModal } from '../modal.js';

/* ---------- 倒计时：每 30 秒刷新「距出榜结算」 ---------- */
let countdownTimer = 0;

function startCountdownTicker(body) {
  stopCountdownTicker();
  if (!body) return;
  countdownTimer = setInterval(() => {
    const el = body.querySelector('[data-role="countdown"]');
    if (el && document.contains(el)) el.textContent = boardCountdown().text;
    else stopCountdownTicker();
  }, 30_000);
}
function stopCountdownTicker() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = 0; }
}

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

/** 上期榜单卡（已发奖的那一期） */
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
          <div class="rank-desc">${board.desc} · 统计 ${boardPeriodText(date)}</div>
        </div>
        <button class="rank-reward-btn" data-action="rank-reward"
                data-key="${board.metric}">奖励</button>
      </div>
      <div class="rank-rows">
        ${top.length
          ? top.map((e) => rowHTML(e, board)).join('')
          : '<div class="rank-empty">昨天这项大家都歇了</div>'}
        ${meRow}
      </div>
    </div>`;
}

/**
 * 名次奖励弹窗：这一榜前三名各拿什么。
 *
 * 奖励是「并列都发」的 —— 两个人并列第 1，两个人都拿第 1 名那份，
 * 所以这里按名次列，不按人头列。文案复用 store/daily.js 的 rewardText，
 * 保证与真正发奖时写进农场日志/时报的那句话完全一致。
 */
function openRewardModal(metric) {
  const board = BOARDS.find((b) => b.metric === metric) || currentBoard();
  const rows = (board.rewards || []).map((reward, i) => `
    <div class="rank-prize">
      <span class="rank-prize-medal">${medal(i + 1)}</span>
      <span class="rank-prize-text">${escapeHtml(rewardText(reward)) || '—'}</span>
    </div>`).join('');

  openModal(`
    <div class="modal-head">
      <h3>${board.icon} ${escapeHtml(board.name)} · 名次奖励</h3>
      <button class="close" data-close>✕</button>
    </div>

    <div class="rank-prize-list">
      ${rows || '<div class="rank-empty">这一榜没有设置奖励</div>'}
    </div>

    <div class="rank-prize-note">
      每期按 <b>${escapeHtml(board.desc)}</b> 排名，前三名各拿一份；
      并列同一名次的都发。奖励在每天下午 2 点结算时直接进背包，不用手动领。
    </div>

    <div class="modal-foot">
      <div class="rm-actions">
        <button class="btn ghost" data-close>知道了</button>
      </div>
    </div>
  `);
}

/** 本期实时排名卡（含 NPC，随 bump 实时刷新） */
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
          <div class="rank-name">本期实时 · ${board.name}</div>
          <div class="rank-desc">统计 ${boardPeriodText(boardDayKey())} · 下午 2 点开奖，这里实时更新，不计奖</div>
        </div>
      </div>
      <div class="rank-rows">
        ${top.length
          ? top.map((e) => rowHTML(e, board, 'today')).join('')
          : '<div class="rank-empty">本期这项还没人动手</div>'}
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

/**
 * 顶部 hero：本期这一盘什么时候出榜。
 *
 * 第 44 轮把实时榜挪到上面之后，hero 也跟着改成讲「本期」——
 * 原来这里写「昨日榜单 · 日期」，现在昨日榜在页面下半部分，
 * 顶部再说昨日会让人以为下面那张是实时的。
 */
function heroHTML() {
  const settled = latestSettled();
  const period = boardPeriodText(boardDayKey());
  return `
    <div class="rank-hero">
      <div class="rank-hero-date">⏳ 本期实时榜 · ${period}</div>
      <div class="rank-hero-sub">每天下午 2 点开奖，前三名有奖，并列都发${settled ? ` · 昨日（${settled.date}）成绩在下面` : ''}</div>
      <div class="rank-hero-count">距出榜 <b data-role="countdown">${boardCountdown().text}</b></div>
    </div>`;
}

export const rankPage = {
  render(body, ctx) {
    if (!advTier) advTier = defaultTier();
    const settled = latestSettled();
    const board = currentBoard();
    const isAdv = activeBoard === 'adv';
    startCountdownTicker(body);

    body.innerHTML = `
      ${heroHTML()}
      ${isAdv ? tiersHTML() : ''}
      ${todayHTML(board)}
      ${settled ? yesterdayHTML(settled.date, board) : ''}
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
    /** 看这一榜的名次奖励（昨日榜卡片右上角的「奖励」） */
    'rank-reward'(el) {
      openRewardModal(el.dataset.key || currentMetric());
    },
  },
};
