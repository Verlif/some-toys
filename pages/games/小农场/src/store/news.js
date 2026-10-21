/**
 * 时报：全镇的大新闻。
 *
 * 存在 state.news 里，落盘时整张 news 表重写（见 core/storage.js）——
 * 时报是「最近发生了什么」，不是编年史：只保留最近 7 天、最多 80 条。
 *
 * 事件有两个来源：
 *   - 玩家自己的动作（升级、被狗抓、寻宝大赚）直接调用 addNews；
 *   - 邻居模拟里的故事，通过传给 simulateNpc 的 farm.news 回调写进来，
 *     这时会带上涉及的人（who）。
 *
 * who 是**涉及的人**的农场 id 数组：一条「X 从 Y 家顺走了菜」里
 * 小偷与被偷的农场主都算，界面上给他们都带头像。
 */
import { emit, EVENTS } from '../core/bus.js';
import { idList } from '../core/utils.js';
import { state } from './state.js';

/** 超过这么多天就不再展示 */
const KEEP_DAYS = 7;

/** 最多保留多少条，避免存档无限膨胀 */
const CAP = 80;

/**
 * 记一条新闻。
 *
 * @param {string} emoji 事件图标，也是类型筛选的分类依据
 * @param {string} text 完整句子，调用方负责带上人名
 * @param {number} [at] 事件发生时间：邻居离线结算补写的是过去的时间点
 * @param {string|string[]} [who] 涉及的人（农场 id）；留空表示与具体农场无关
 */
export function addNews(emoji, text, at = Date.now(), who = '') {
  state.news.push({ at, emoji, text, who: idList(who) });

  // 邻居补写的时间可能比现有条目更早，所以这里统一按时间倒序整理，
  // 不能假设数组本身就是有序的
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const kept = state.news
    .filter((entry) => entry.at >= cutoff)
    .sort((a, b) => b.at - a.at)
    .slice(0, CAP);

  state.news.length = 0;
  state.news.push(...kept);
  emit(EVENTS.NEWS);
}

/** 时报内容（已按时间倒序） */
export function newsList() {
  return state.news;
}

/**
 * 时报筛选档位：按事件图标归类。
 *
 * 图标即类型 —— 每条新闻本来就带 emoji，不用另存一个分类字段。
 * 「全部」没有 emojis 字段，过滤时原样返回。
 */
export const NEWS_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'level', label: '成长', emojis: ['🎉'] },
  { key: 'steal', label: '偷菜', emojis: ['🥷'] },
  { key: 'dog', label: '守护犬', emojis: ['🐕'] },
  { key: 'adventure', label: '寻宝', emojis: ['💰'] },
];

/**
 * 按类型过滤时报
 * @param {object[]} list newsList() 的结果
 * @param {string} key NEWS_FILTERS 里的档位 key
 * @returns {object[]} 新数组
 */
export function filterNews(list, key) {
  const filter = NEWS_FILTERS.find((f) => f.key === key);
  if (!filter?.emojis) return [...list];
  return list.filter((entry) => filter.emojis.includes(entry.emoji));
}
