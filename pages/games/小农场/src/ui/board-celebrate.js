/**
 * 每日榜单出榜的庆祝画面。
 *
 * 榜单在下午 2 点结算（见 store/daily.js 的 checkRollover）。玩家拿到名次时，
 * 这里播一张全屏卡片：**榜单图标 + 名称、名次、成绩、奖励**。
 *
 * 一次可能拿到好几个榜的名次 —— 按结算顺序排队逐张播：
 * 点一下当前这张就淡出消失，队列里还有就接着弹下一张；到点（单张最多 2 秒）
 * 也自动往下走，不会把玩家按在这儿看一长串。
 *
 * 和 sign-celebrate.js / dog-caught.js 一样自己造一层，不占 #modal ——
 * 庆祝是「事件播报」，不该打断玩家正在看的弹窗，也不该占住弹窗的动作分发。
 *
 * 层级压在 toast 之下（195 < 200）：出榜的 toast 与庆祝画面同屏可见。
 */
import { on, EVENTS } from '../core/bus.js';

/** 单张最多停留多久（用户要求最多 2 秒） */
const HOLD_MS = 2000;

/** 淡出动画时长 */
const FADE_MS = 320;

/** 待播队列：{ date, icon, board, rank, value, reward } */
let queue = [];

/** 当前正在播的那一层 */
let layer = null;

/** 当前这层的自动收起定时器 */
let timer = 0;

/** 名次徽章 */
const medal = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `第 ${rank} 名`);

/** '2026-10-22' → '10/22' */
function shortDate(key) {
  const [, m, d] = String(key || '').split('-');
  return m && d ? `${Number(m)}/${Number(d)}` : '';
}

/**
 * 收起当前这张（淡出），队列里还有就接着播下一张。
 * 重复调用安全。
 */
function dismiss() {
  if (!layer) return;
  clearTimeout(timer);
  const el = layer;
  layer = null;
  el.classList.add('out');
  setTimeout(() => {
    el.remove();
    showNext();
  }, FADE_MS);
}

/** 播队列里的下一张；队列空了什么都不做 */
function showNext() {
  if (!queue.length || layer) return;
  const award = queue.shift();

  layer = document.createElement('div');
  layer.className = 'board-celebrate';
  layer.innerHTML = `
    <div class="bc-card">
      <div class="bc-ring"></div>
      <div class="bc-icon">${award.icon || '🏆'}</div>
      <div class="bc-board">${award.board}</div>
      <div class="bc-rank">${medal(award.rank)}</div>
      <div class="bc-value">${award.value}</div>
      <div class="bc-reward">
        <span class="bc-reward-label">获得</span>
        <b>${award.reward}</b>
      </div>
      ${shortDate(award.date) ? `<div class="bc-date">${shortDate(award.date)} 的榜单</div>` : ''}
      ${queue.length ? `<div class="bc-more">还有 ${queue.length} 个名次</div>` : ''}
    </div>`;
  layer.addEventListener('click', dismiss);
  document.body.appendChild(layer);

  timer = setTimeout(dismiss, HOLD_MS);
}

/**
 * 播一次出榜庆祝。
 *
 * 已经在播的时候不打断当前这张，新的获奖排到队尾接着播。
 * @param {Array<{date?:string, icon?:string, board:string, rank:number,
 *                value:string, reward:string}>} awards 玩家获奖清单
 */
export function showBoardCelebrate(awards) {
  if (!awards?.length) return;
  queue.push(...awards);
  showNext();
}

/** 订阅出榜事件 */
export function mountBoardCelebrate() {
  on(EVENTS.BOARD_AWARD, (awards) => {
    if (awards) showBoardCelebrate(awards);
  });
}
