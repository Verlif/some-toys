/**
 * 签到页：当月日历 + 连续签到循环 + 大奖日。
 *
 * 每天固定发「普通化肥 + 一颗随机种子 + 少量金币」，
 * 连续签到的 7 天循环体现在金币倍数上。
 * 每周六是大奖日：日历上标出来，那天还能开一个盲盒。
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

/**
 * 一格日历。
 *
 * 下半格只放**有意义的状态**：
 *   - 签过 → ✓（这是玩家最想知道的一件事）
 *   - 没签的周六 → 🎁（大奖日）
 *   - 其余留空
 *
 * 以前这里印的是「`(日 - 1) % 7 + 1`」，跟连续签到的天数毫无关系，
 * 每个格子都挂个 1~7 的数字，看着像排班表 —— 已经删掉。
 */
function cellHTML(cell) {
  if (cell.state === 'none') return '<div class="cal-cell blank"></div>';

  const mark = cell.state === 'signed' ? '✓' : cell.big ? '🎁' : '';
  const cls = mark === '✓' ? 'cal-mark ok' : mark ? 'cal-mark gift' : 'cal-mark';
  return `
    <div class="cal-cell ${cell.state} ${cell.big ? 'big' : ''}">
      <div class="cal-day">${cell.day}</div>
      <div class="${cls}">${mark}</div>
    </div>`;
}

/** 连续签到的七天进度条 */
function cycleHTML() {
  const streak = currentStreak();
  const broken = streakBroken();
  const day = todayStreakDay();

  const dots = Array.from({ length: CYCLE_DAYS }, (_, i) => {
    const n = i + 1;
    // 中断时 day 是 1（重新开始的那天），照样标 current ——
    // 玩家一眼看得出「断在这儿，明天从第 1 天重新起」
    const cls = n < day ? 'done' : n === day ? 'current' : '';
    return `<div class="cycle-dot ${cls}">${n}</div>`;
  }).join('');

  // 连签天数由签到历史现算（store/signin.js 的 streakOf），与下方日历同一套数据
  const streakText = broken
    ? '已中断 · 从第 1 天重新开始'
    : streak > 0
      ? `已连续 ${streak} 天`
      : '还没开始 · 今天签就是第 1 天';

  const reward = todayReward();
  const items = Object.entries(reward.items)
    .map(([id, n]) => `${ITEMS[id]?.name || id} ×${n}`)
    .join('、');

  return `
    <div class="cycle">
      <div class="cycle-head">
        <span class="cycle-title">连续签到</span>
        <span class="cycle-streak">${streakText}</span>
      </div>
      <div class="cycle-dots">${dots}</div>
      <div class="cycle-foot">
        <span>${leftInCycle() > 0 ? `本轮还差 ${leftInCycle()} 天` : '本轮已完成'}</span>
        <span>今天 +${reward.coins} 💰${items ? ` · ${items}` : ''} · 随机种子（≤Lv.${reward.seedLv}）${reward.big ? ' · 🎁 盲盒' : ''}</span>
      </div>
    </div>`;
}

export const signPage = {
  render(body) {
    const cal = calendarOf();
    const done = signedToday();
    const reward = todayReward();

    const head = `<div class="cal">${cal.head.map((h) => `<div class="cal-cell head">${h}</div>`).join('')}</div>`;
    const cells = `<div class="cal">${cal.cells.map(cellHTML).join('')}</div>`;

    body.innerHTML = `
      ${cycleHTML()}
      <div class="section-title">📅 ${cal.title}</div>
      <div style="padding:0 14px 16px">
        ${head}
        ${cells}
        <div class="cal-legend">
          <span><i class="dot signed"></i>✓ 已签到</span>
          <span><i class="dot today"></i>今天</span>
          <span><i class="dot big"></i>🎁 周六 · 大奖日</span>
        </div>
      </div>
      <div style="padding:0 16px 26px">
        <button class="btn ${done ? 'ghost' : ''}" style="width:100%" data-action="sign" ${done ? 'disabled' : ''}>
          ${done ? '今天已经签过啦' : `签 到　+${reward.coins} 💰`}
        </button>
        ${done ? '' : `<div style="text-align:center;font-size:11px;color:var(--muted);margin-top:9px">
          ${reward.big ? '🎁 今天是周六，签到还能开一个盲盒！<br>' : ''}
          ${nextStreakHint()}
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
  // 「第几天」是**连续签到的第几天**，不能拿日期去取模 ——
  // 以前写的是 `(明天的号数 % 7) + 1`，跟连签轮次毫无关系
  const today = todayStreakDay();
  const next = today >= CYCLE_DAYS ? 1 : today + 1;
  const big = tomorrow.getDay() === 6;
  const text = big ? '🎁 明天是大奖日，有盲盒' : `明天签到是连签第 ${next} 天`;
  return `连签不会清零 · ${text}`;
}
