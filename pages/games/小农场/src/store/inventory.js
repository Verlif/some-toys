/**
 * 背包领域：种子 / 农产品 / 道具的统一存取。
 * 背包在内存里就是一个 { itemId: count } 普通对象。
 *
 * 注意：这里的函数都是「内存操作」，不落盘。
 * 需要和地块、金币等一起提交的场合，由调用方用 core/storage.js 的
 * commit() 一次性写库，避免开多个事务产生中间态。
 *
 * 例外是 discardItem()：丢弃是玩家在包裹页单方面的操作，
 * 不牵扯别的表，所以它自己负责落盘与广播。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';
import { noteProduce } from './collected.js';

/** 某物品的数量（不存在返回 0） */
export function count(itemId) {
  return state.bag[itemId] || 0;
}

/** 是否持有至少 n 个 */
export const has = (itemId, n = 1) => count(itemId) >= n;

/**
 * 增加数量。
 *
 * 农产品入包时顺手记一笔「图鉴已收集」（`store/collected.js`）——
 * 所有产出入包都走这里，是唯一的埋点处。
 */
export function add(itemId, n) {
  if (n <= 0) return;
  state.bag[itemId] = count(itemId) + n;
  noteProduce(itemId);
}

/** 减少数量，数量不足返回 false 且不改动 */
export function take(itemId, n = 1) {
  if (count(itemId) < n) return false;
  const next = count(itemId) - n;
  if (next > 0) state.bag[itemId] = next;
  else delete state.bag[itemId];
  return true;
}

/**
 * 丢弃背包里的物品（不可恢复）。
 *
 * 与 take() 的区别：这一步会自己落盘并广播 —— 丢弃是玩家在包裹页
 * 单方面的操作，不牵扯地块 / 金币，没必要让调用方凑一次大提交。
 *
 * @param {string} itemId 背包 key（种子 / 农产品 / 道具 / 藏宝图）
 * @param {number} [n] 数量
 * @returns {Promise<boolean>} 是否真的丢掉了
 */
export async function discardItem(itemId, n = 1) {
  if (n <= 0 || !take(itemId, n)) return false;
  await commit({ bag: state.bag });
  emit(EVENTS.INVENTORY);
  return true;
}