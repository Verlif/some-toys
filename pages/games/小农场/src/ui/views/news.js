/**
 * 时报：把镇上发生的大事按时间倒序摆出来。
 *
 * 数据全部来自 store/news.js（存在 state.news 里），
 * 这里只负责渲染，不产生任何状态。
 *
 * **长相与农场日志、邻居日志完全一致** —— 都走 `ui/records.js`：
 * 日期分组 + 时分 + 图标方块 + 正文，正文里的人名与作物名是可点标签。
 * 所以这里不再自己拼一套「卡片式」条目。
 *
 * 顶部一排类型筛选（成长 / 偷菜 / 守护犬 / 寻宝）按条目的分类字段归类，
 * 芯片上的数字是该类型当前的条数。
 */
import { byId, delegate, setHTML } from '../../core/dom.js';
import { on, EVENTS } from '../../core/bus.js';
import { completeGuide } from '../../store/codex.js';
import { filterNews, NEWS_FILTERS, newsList } from '../../store/news.js';
import { recordItemsHTML } from '../records.js';
import { keepBarScroll } from '../scroll-keep.js';

/** 当前选中的类型筛选 */
let filter = 'all';

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

  // 类型筛选条是横滚的，重绘后接力 scrollLeft，别让它滚回开头
  keepBarScroll(root, '.filter-bar', () => {
    const now = Date.now();
    const all = newsList();
    const list = filterNews(all, filter);

    const empty = filter === 'all'
      ? '📰<br>镇上还风平浪静<br>去闯点事出来吧'
      : '🔍<br>这个类型下暂时没有新闻<br>换个筛选看看';

    setHTML(root, `
      <div class="section-title">📰 时报</div>
      <div class="filter-bar">
        ${filterChips(all)}
      </div>
      ${list.length
        ? `<div class="news-list">${recordItemsHTML(list, { now, withDay: true })}</div>
           <div class="news-foot">只保留最近 7 天的大新闻</div>`
        : `<div class="empty-tip">${empty}</div>`}`);
  });
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
