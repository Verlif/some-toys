/**
 * 时报：全镇的大新闻。
 *
 * 存在 player.news 里（不另开一张表，也就不需要升数据库版本），
 * 只保留最近 7 天、最多 80 条 —— 时报是「最近发生了什么」，不是编年史。
 *
 * 事件有两个来源：
 *   - 玩家自己的动作（升级、被狗抓、寻宝大赚）直接调用 addNews；
 *   - 邻居离线模拟里的故事，通过传给 simulateNpc 的 farm.news 回调写进来。
 */
import { emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';

/** 超过这么多天就不再展示 */
const KEEP_DAYS = 7;

/** 最多保留多少条，避免存档无限膨胀 */
const CAP = 80;

/**
 * 记一条新闻。
 *
 * @param {string} emoji
 * @param {string} text 完整句子，调用方负责带上人名
 * @param {number} [at] 事件发生时间：邻居离线结算补写的是过去的时间点
 */
export function addNews(emoji, text, at = Date.now()) {
  const list = state.player.news ?? (state.player.news = []);
  list.push({ at, emoji, text });

  // 邻居补写的时间可能比现有条目更早，所以这里统一按时间倒序整理，
  // 不能假设数组本身就是有序的
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const kept = list
    .filter((entry) => entry.at >= cutoff)
    .sort((a, b) => b.at - a.at)
    .slice(0, CAP);

  list.length = 0;
  list.push(...kept);
  emit(EVENTS.NEWS);
}

/** 时报内容（已按时间倒序） */
export function newsList() {
  return state.player.news || [];
}
