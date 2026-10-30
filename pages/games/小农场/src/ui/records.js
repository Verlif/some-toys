/**
 * 记录条目渲染 —— 全游戏只有这一套「记录」长相。
 *
 * 用到它的地方：
 *   - 农场日志浮窗（`ui/log-sheet.js`）
 *   - 拜访邻居弹窗里的「最近操作」（`ui/friend-modal.js`）
 *   - 邻居卡片上的三条动态预览（`ui/views/friends.js`）
 *   - 时报（`ui/views/news.js`）
 *
 * 以前玩家日志、邻居日志、时报各写一套标记，同一个游戏里三种排版 ——
 * 一边是「时间 / 图标方块 / 正文（人名带标签）」，一边是卡片式的
 * 「大图标 + 标题 + 右下角相对时间」。读起来像三个产品。
 * 现在统一成同一套 DOM 与同一套样式：
 *
 * ```
 * 08:15  [🥷]  王大爷偷[石头🧒]家被守护犬赶了出来
 * ```
 *
 * 差异只留五个可选开关：`withDay`（插日期分组标题）、`limit`（只取最近 N 条）、
 * `since`（只看某个时刻之后的）、`compact`（卡片里的预览，字号更小）、
 * `relative`（时间写「3 分钟前」）。
 *
 * `entry.crop` 存在时，左侧那枚图标就是这个作物本身，点一下打开作物信息
 * （时报里「挖到某某种子」这类条目就是这样）；
 * 正文里的人名与作物名由 `ui/inline-tags.js` 变成可点标签。
 */
import { escapeHtml } from '../core/dom.js';
import { inlineTagsHTML } from './inline-tags.js';

const DAY_MS = 86_400_000;

/** 当天 0 点的时间戳，用来算「今天 / 昨天 / 几号」 */
function dayStart(at) {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 日期分组标题
 * @param {number} at
 * @param {number} now
 */
function dayLabel(at, now) {
  const diff = Math.round((dayStart(now) - dayStart(at)) / DAY_MS);
  if (diff <= 0) return '今天';
  if (diff === 1) return '昨天';
  const d = new Date(at);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/** 时分 */
function clockLabel(at) {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 相对时间：刚刚 / 3 分钟前 / 2 小时前 / 1 天前 */
function relLabel(at, now) {
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < DAY_MS) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / DAY_MS)} 天前`;
}

/**
 * 左侧那枚事件图标。
 * 带 `crop` 的条目图标就是作物本身，做成可点的（打开作物信息）。
 * @param {object} entry
 */
function emojiHTML(entry) {
  if (!entry.crop) return `<span class="log-emoji">${entry.emoji}</span>`;
  return `<span class="log-emoji tappable" data-action="crop-detail"
    data-crop="${escapeHtml(entry.crop)}" title="查看作物详情">${entry.emoji}</span>`;
}

/**
 * 单条记录。
 *
 * @param {{at:number, emoji:string, text:string, crop?:string}} entry
 * @param {object} [options]
 * @param {number} [options.now]
 * @param {boolean} [options.compact] 卡片里的预览（字号小一号）
 * @param {boolean} [options.relative] 时间写相对时间而不是时分
 * @returns {string}
 */
function recordItemHTML(entry, { now = Date.now(), compact = false, relative = false } = {}) {
  const time = relative ? relLabel(entry.at, now) : clockLabel(entry.at);
  return `
    <div class="log-item${compact ? ' compact' : ''}">
      <span class="log-time">${time}</span>
      ${emojiHTML(entry)}
      <span class="log-text">${inlineTagsHTML(entry.text)}</span>
    </div>`;
}

/**
 * 把一批记录渲染成 HTML（按时间倒序）。
 *
 * @param {object[]} entries 原文案（未转义）
 * @param {object} [options]
 * @param {number} [options.now]
 * @param {number} [options.limit] 只取最近 N 条；0 = 全部
 * @param {number} [options.since] 只要这个时刻之后的记录；0 = 不限
 * @param {boolean} [options.withDay] 是否插日期分组标题
 * @param {boolean} [options.compact] 卡片里的预览（字号小一号）
 * @param {boolean} [options.relative] 时间写相对时间而不是时分
 * @returns {string}
 */
export function recordItemsHTML(entries, {
  now = Date.now(),
  limit = 0,
  since = 0,
  withDay = false,
  compact = false,
  relative = false,
} = {}) {
  const list = [...(entries || [])]
    // 邻居结算是补写过去的，数组本身不保证有序，展示前统一排一次
    .sort((a, b) => b.at - a.at);
  // 先按时间窗过滤，再截条数 —— 顺序反了会「先截 10 条再筛掉 6 条」
  const inRange = since > 0 ? list.filter((entry) => entry.at >= since) : list;
  const rows = limit > 0 ? inRange.slice(0, limit) : inRange;
  if (!rows.length) return '';

  let currentDay = '';
  return rows.map((entry) => {
    let head = '';
    if (withDay) {
      const day = dayLabel(entry.at, now);
      if (day !== currentDay) {
        head = `<div class="log-day">${day}</div>`;
        currentDay = day;
      }
    }
    return head + recordItemHTML(entry, { now, compact, relative });
  }).join('');
}
