/**
 * 离线时间轴。
 *
 * 世界时钟补算完「你不在的这段时间」之后，把过程讲给玩家听：
 * 哪天谁来过、被顺走几个、邻居帮了多少忙、狗拦下几次、谁升级了、
 * 你拿了几个榜名次。
 *
 * 只在离开超过 2 小时（data/world.js 的 REPORT_MIN_SPAN）时才弹 ——
 * 切个后台、吃个饭回来还弹一层报告，那是打扰。
 */
import { openModal, closeModal } from './modal.js';
import { escapeHtml } from '../core/dom.js';
import { clockText, dayText } from '../core/utils.js';
import { reportDays } from '../store/world.js';
import { REPORT_MIN_SPAN } from '../data/world.js';

/** 最多展开这么多天，更早的只给一行汇总（离线一个月别刷成一条长卷轴） */
const MAX_DAYS = 10;

/**
 * 是否值得弹报告。
 * @param {{span: number, report: ?object}} result settleWorld 的结果
 */
export function wantsReport(result) {
  return Boolean(result?.report) && result.span >= REPORT_MIN_SPAN;
}

/**
 * 弹一层「你不在的 N 天」。
 *
 * @param {object} report world.createReport() 的产物
 */
export function showOfflineReport(report) {
  const days = reportDays(report);

  // 「不在的几天」按**实际经过的时间**算，不按自然日桶数 ——
  // 23 号 16:37 到 26 号 16:37 只隔了 3 天，桶却有 4 个。
  // 不到一天就按小时说：「你不在的 3 小时」比「1 天」诚实
  const spanMs = Math.max(0, report.to - report.from);
  const away = spanMs >= 86_400_000
    ? `你不在的 ${Math.round(spanMs / 86_400_000)} 天`
    : `你不在的 ${Math.max(1, Math.round(spanMs / 3_600_000))} 小时`;
  const spanText = `${clockText(report.from)} → ${clockText(report.to)}`;

  const head = `
    <div class="modal-head or-head">
      <div class="or-ico">🌙</div>
      <div class="or-id">
        <div class="or-title">${away}</div>
        <div class="modal-sub">${spanText}${report.degraded ? ' · 更早的部分按汇总补算' : ''}</div>
      </div>
    </div>`;

  const stat = (emoji, value, label) => `
    <div class="or-stat">
      <div class="or-stat-v">${emoji} ${value}</div>
      <div class="or-stat-k">${label}</div>
    </div>`;
  const stats = `
    <div class="or-stats">
      ${stat('👋', report.visits, '邻居来访')}
      ${stat('🥷', report.stolen, '被顺走')}
      ${stat('🤝', report.cared, '被照料')}
      ${stat('🐕', report.caught, '狗拦下')}
    </div>`;

  const list = days.slice(-MAX_DAYS).reverse().map((day) => {
    const bits = [];
    if (day.visits) bits.push(`${day.visits} 位来访`);
    if (day.stolen) bits.push(`被顺走 ${day.stolen}`);
    if (day.cared) bits.push(`照料 ${day.cared} 块`);
    if (day.caught) bits.push(`狗拦 ${day.caught} 次`);
    if (day.levelUps.length) bits.push(`${day.levelUps.length} 人升级`);
    const notes = day.notes.length
      ? `<ul class="or-notes">${day.notes.map((n) => `<li><span>${n.emoji}</span>${escapeHtml(n.text)}</li>`).join('')}</ul>`
      : '';
    const awards = day.awards.length
      ? `<div class="or-awards">${day.awards.map((a) => `<span>${a.icon} ${escapeHtml(a.board)} 第 ${a.rank} 名</span>`).join('')}</div>`
      : '';
    return `
      <div class="or-day">
        <div class="or-day-head">
          <b>${dayText(day.date)}</b>
          <span>${bits.join(' · ') || '安安静静'}</span>
        </div>
        ${notes}
        ${awards}
      </div>`;
  }).join('');

  const empty = days.length ? '' : '<div class="or-quiet">世界很安静，什么都没发生</div>';

  const older = days.length > MAX_DAYS
    ? `<div class="or-older">更早的 ${days.length - MAX_DAYS} 天还有 ${days
      .slice(0, days.length - MAX_DAYS)
      .reduce((sum, day) => sum + day.visits, 0)} 次来访，就不一一展开了</div>`
    : '';

  openModal(`
    ${head}
    ${stats}
    <div class="or-days">${list || empty}</div>
    ${older}
    <div class="modal-foot">
      <button class="btn primary" data-action="offline-close">回到农场</button>
    </div>
  `, (action) => {
    if (action === 'offline-close') closeModal();
  }, 'offline-modal');
}
