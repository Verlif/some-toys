/**
 * 时报：把镇上发生的大事按时间倒序摆出来。
 *
 * 数据全部来自 store/news.js（存在 player.news 里），
 * 这里只负责渲染，不产生任何状态。
 */
import { byId, escapeHtml, setHTML } from '../../core/dom.js';
import { on, EVENTS } from '../../core/bus.js';
import { newsList } from '../../store/news.js';

/** 时间戳 → 「3 分钟前」 */
function relativeTime(at, now) {
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function renderNews() {
  const root = byId('news');
  if (!root) return;

  const now = Date.now();
  const list = newsList();

  const rows = list.map((entry) => `
    <div class="news-item">
      <span class="news-emoji">${entry.emoji}</span>
      <div class="news-body">
        <div class="news-text">${escapeHtml(entry.text)}</div>
        <div class="news-when">${relativeTime(entry.at, now)}</div>
      </div>
    </div>`).join('');

  setHTML(root, `
    <div class="section-title">📰 时报</div>
    ${list.length
      ? `<div class="news-list">${rows}</div><div class="news-foot">只保留最近 7 天的大新闻</div>`
      : '<div class="empty-tip">📰<br>镇上还风平浪静<br>去闯点事出来吧</div>'}`);
}

export function mountNews() {
  on(EVENTS.NEWS, renderNews);
}
