/**
 * 签到页：当月日历 + 连续签到循环。
 *
 * 日历里每一天对应循环中的「第几天」，所以第 8 天会和第 1 天拿到一样的奖励，
 * 这正好把「七天一轮」这件事直接画在日历上。
 */
import { ITEMS } from '../../data/items.js';
import { CYCLE_DAYS } from '../../data/signin.js';
import {
  calendarOf,
  currentStreak,
  leftInCycle,
  signIn,
  signedToday,
  streakBroken,
  todayReward,
  todayStreakDay,
} from '../../store/signin.js';

const DAY_MS = 86_400_000;

/** 一格日历 */
function cellHTML(cell) {
  if (cell.state === 'none') return '<div class="cal-cell blank"></div>';

  const cycleDay = ((cell.day - 1) % CYCLE_DAYS) + 1;
  const isBig = cycleDay === CYCLE_DAYS;
  return `
    <div class="cal-cell ${cell.state} ${isBig ? 'big' : ''}">
      <div class="cal-day">${cell.day}</div>
      <div class="cal-cycle">${isBig ? '🎁' : cycleDay}</div>
    </div>`;
}

/** 连续签到的七天进度条 */
function cycleHTML() {
  const streak = currentStreak();
  const broken = streakBroken();
  const day = todayStreakDay();

  const dots = Array.from({ length: CYCLE_DAYS }, (_, i) => {
    const n = i + 1;
    const cls = broken
      ? (n < day ? 'done' : '')
      : (n < day ? 'done' : n === day ? 'current' : '');
    return `<div class="cycle-dot ${cls}">${n}</div>`;
  }).join('');

  const reward = todayReward();
  const items = Object.entries(reward.items)
    .map(([id, n]) => `${ITEMS[id]?.name || id} ×${n}`)
    .join('、');

  return `
    <div class="cycle">
      <div class="cycle-head">
        <span class="cycle-title">连续签到</span>
        <span class="cycle-streak">${broken ? '已中断 · 从第 1 天重新开始' : `已连续 ${streak} 天`}</span>
      </div>
      <div class="cycle-dots">${dots}</div>
      <div class="cycle-foot">
        <span>${leftInCycle() > 0 ? `本轮还差 ${leftInCycle()} 天` : '本轮已完成'}</span>
        <span>今天 +${reward.coins} 💰 +${reward.exp} 经验${items ? ` · ${items}` : ''}</span>
      </div>
    </div>`;
}

export const signPage = {
  render(body) {
    const cal = calendarOf();
    const done = signedToday();

    const head = `<div class="cal">${cal.head.map((h) => `<div class="cal-cell head">${h}</div>`).join('')}</div>`;
    const cells = `<div class="cal">${cal.cells.map(cellHTML).join('')}</div>`;

    body.innerHTML = `
      ${cycleHTML()}
      <div class="section-title">📅 ${cal.title}</div>
      <div style="padding:0 14px 16px">
        ${head}
        ${cells}
        <div class="cal-legend">
          <span><i class="dot signed"></i>已签到</span>
          <span><i class="dot today"></i>今天</span>
          <span><i class="dot big"></i>大赏日</span>
        </div>
      </div>
      <div style="padding:0 16px 26px">
        <button class="btn ${done ? 'ghost' : ''}" style="width:100%" data-action="sign" ${done ? 'disabled' : ''}>
          ${done ? '今天已经签过啦' : `签 到　+${todayReward().coins} 💰`}
        </button>
        ${done ? '' : `<div style="text-align:center;font-size:11px;color:var(--muted);margin-top:9px">
          连续签到 ${nextStreakHint()}
        </div>`}
      </div>`;
  },

  actions: {
    async sign() {
      await signIn();
    },
  },
};

/** 「明天再签可获得 X」提示 */
function nextStreakHint() {
  const tomorrow = new Date(Date.now() + DAY_MS);
  const cycleDay = (tomorrow.getDate() % CYCLE_DAYS) + 1;
  const text = cycleDay === CYCLE_DAYS ? '🎁 明天是本轮大赏日' : `明天签到可得第 ${cycleDay} 天奖励`;
  return `连签不会清零 · ${text}`;
}