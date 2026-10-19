/**
 * 背包领域：种子 / 农产品 / 道具的统一存取。
 * 背包在内存里就是一个 { itemId: count } 普通对象。
 *
 * 注意：这里的函数都是「内存操作」，不落盘。
 * 需要和地块、金币等一起提交的场合，由调用方用 core/storage.js 的
 * commit() 一次性写库，避免开多个事务产生中间态。
 */
import { state } from './state.js';

/** 某物品的数量（不存在返回 0） */
export function count(itemId) {
  return state.bag[itemId] || 0;
}

/** 是否持有至少 n 个 */
export const has = (itemId, n = 1) => count(itemId) >= n;

/** 增加数量 */
export function add(itemId, n) {
  if (n <= 0) return;
  state.bag[itemId] = count(itemId) + n;
}

/** 减少数量，数量不足返回 false 且不改动 */
export function take(itemId, n = 1) {
  if (count(itemId) < n) return false;
  const next = count(itemId) - n;
  if (next > 0) state.bag[itemId] = next;
  else delete state.bag[itemId];
  return true;
}