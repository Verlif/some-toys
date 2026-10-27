/**
 * 时报：全镇的大新闻。
 *
 * 存在 state.news 里，落盘时整张 news 表重写（见 core/storage.js）——
 * 时报是「最近发生了什么」，不是编年史：只保留最近 30 天、最多 240 条。
 * （第 52 轮从 7 天 / 80 条放宽：玩家反馈「上周谁偷了我的瓜」翻不到，不够用。）
 *
 * 每条的形状：
 * ```
 * { at, emoji, text, crop: string, cat: string }
 * ```
 *   - `crop` 这条新闻挂在哪种作物上。有值时时报里那枚图标就是该作物本身，
 *            点一下打开作物信息弹窗（「挖到某某种子」这类条目就是这样）；
 *   - `cat`  顶部筛选用的分类；不传时按图标推断，老存档也能归类。
 *
 * 事件有两个来源：
 *   - 玩家自己的动作（升级、被狗抓、寻宝挖到限定种子）直接调用 addNews；
 *   - 邻居模拟里的故事，通过传给 simulateNpc 的 farm.news 回调写进来。
 */
import { emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';

/** 超过这么多天就不再展示（第 52 轮：7 → 30） */
const KEEP_DAYS = 30;

/** 最多保留多少条，避免存档无限膨胀（第 52 轮：80 → 240） */
const CAP = 240;

/**
 * 图标 → 分类。没有显式传 cat 时用它兜底，
 * 老存档（没有 cat 字段）读进来也照样能筛选。
 */
const CAT_BY_EMOJI = {
  '🎉': 'level',
  '🥷': 'steal',
  '🐕': 'dog',
  '💰': 'adventure',
};

/**
 * 记一条新闻。
 *
 * @param {string} emoji 事件图标，也是分类的兜底依据
 * @param {string} text 完整句子，调用方负责带上人名
 * @param {object} [options]
 * @param {number} [options.at] 事件发生时间：邻居离线结算补写的是过去的时间点
 * @param {string} [options.crop] 相关作物 id（图标换成它，并变成可点）
 * @param {string} [options.cat] 分类档位（寻宝类的非金币图标要显式传）
 */
export function addNews(emoji, text, { at = Date.now(), crop = '', cat = '' } = {}) {
  state.news.push({
    at,
    emoji,
    text,
    crop,
    cat: cat || CAT_BY_EMOJI[emoji] || '',
  });

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
 * 时报筛选档位。
 *
 * `cat` 是分类键；「全部」没有 cat，过滤时原样返回。
 * 分类在写入时就定下来（见 addNews），所以图标换成作物之后
 * 「寻宝」这一档也不会有漏网的条目。
 */
export const NEWS_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'level', label: '成长', cat: 'level' },
  { key: 'steal', label: '偷菜', cat: 'steal' },
  { key: 'dog', label: '守护犬', cat: 'dog' },
  { key: 'adventure', label: '寻宝', cat: 'adventure' },
];

/** 某条新闻属于哪一档 */
const newsCat = (entry) => entry.cat || CAT_BY_EMOJI[entry.emoji] || '';

/**
 * 按类型过滤时报
 * @param {object[]} list newsList() 的结果
 * @param {string} key NEWS_FILTERS 里的档位 key
 * @returns {object[]} 新数组
 */
export function filterNews(list, key) {
  const filter = NEWS_FILTERS.find((f) => f.key === key);
  if (!filter?.cat) return [...list];
  return list.filter((entry) => newsCat(entry) === filter.cat);
}
