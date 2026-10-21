/**
 * 时报：把镇上发生的大事按时间倒序摆出来。
 *
 * 数据全部来自 store/news.js（存在 state.news 里），
 * 这里只负责渲染，不产生任何状态。
 *
 * 顶部一排类型筛选（成长 / 偷菜 / 守护犬 / 寻宝）按条目的图标归类，
 * 芯片上的数字是该类型当前的条数；
 * 每条左侧是「涉及的人」的头像 + 名字胶囊（`ui/who-chip.js`）——
 * 一条偷菜新闻里小偷和受害者都带，不用读全文也能看出是谁和谁。
 * 正文里若已经写了这个人的名字，渲染时会削掉，避免和胶囊重复。
 */
import { byId, delegate, escapeHtml, setHTML } from '../../core/dom.js';
import { on, EVENTS } from '../../core/bus.js';
import { stripWhoName, whoChipHTML } from '../who-chip.js';
import { completeGuide } from '../../store/codex.js';
import { filterNews, NEWS_FILTERS, newsList } from '../../store/news.js';

/** 当前选中的类型筛选 */
let filter = 'all';

/** 时间戳 → 「3 分钟前」 */
function relativeTime(at, now) {
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function filterChips(list) {
  return NEWS_FILTERS.map((f) => {
    const n = filterNews(list, f.key).length;
    return `
      <button class="filter-chip ${f.key === filter ? 'active' : ''}"
              data-action="news-filter" data-id="${f.key}">${f.label}<i class="chip-num">${n}</i></button>`;
  }).join('');
}

export function renderNews() {
  const root = byId('news');
  if (!root) return;

  const now = Date.now();
  const all = newsList();
  const list = filterNews(all, filter);

  const rows = list.map((entry) => `
    <div class="news-item">
      <span class="news-emoji">${entry.emoji}</span>
      <div class="news-body">
        <div class="news-head">
          ${whoChipHTML(entry.who)}
          <span class="news-when">${relativeTime(entry.at, now)}</span>
        </div>
        <div class="news-text">${escapeHtml(stripWhoName(entry.text, entry.who))}</div>
      </div>
    </div>`).join('');

  const empty = filter === 'all'
    ? '📰<br>镇上还风平浪静<br>去闯点事出来吧'
    : '🔍<br>这个类型下暂时没有新闻<br>换个筛选看看';

  setHTML(root, `
    <div class="section-title">📰 时报</div>
    <div class="filter-bar">
      ${filterChips(all)}
    </div>
    ${list.length
      ? `<div class="news-list">${rows}</div><div class="news-foot">只保留最近 7 天的大新闻</div>`
      : `<div class="empty-tip">${empty}</div>`}`);
}

/** 筛选芯片动作 */
const NEWS_ACTIONS = {
  'news-filter': (el) => {
    filter = el.dataset.id;
    renderNews();
  },
};

/**
 * 进入时报页：先结算「第一次看时报」的引导，再渲染。
 * 由 tabs.js 的页面入口调用，和邻居页的 enterFriendsPage 一个路子。
 */
export async function enterNewsPage() {
  await completeGuide('news');
  renderNews();
}

export function mountNews() {
  const root = byId('news');
  // 芯片在每次重绘里重建，用委托挂在根节点上
  delegate(root, 'click', '[data-action]', (el) => {
    NEWS_ACTIONS[el.dataset.action]?.(el);
  });

  on(EVENTS.NEWS, renderNews);
}
