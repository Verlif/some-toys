/**
 * 事件总线：模拟层 → 表现层 / 网络层 的单向通知。
 *
 * 为什么要它：
 *   · 模拟层（sim/）不应该 import 任何 DOM / UI 模块，否则没法在服务端、测试或联机房主里跑；
 *   · UI 只订阅自己关心的事件（被抓、道具刷新、道具生效、对局结束……），不再被模拟层直接调用；
 *   · 未来联机时，房主把这些事件原样广播给客户端即可。
 *
 * 用法：
 *   emit(EVT.HIDER_CAUGHT, { remain, total, isPlayer });
 *   const off = on(EVT.HIDER_CAUGHT, payload => showCaughtNotice(...));
 */

/** 事件名集中定义，避免各处写字符串写错 */
export const EVT = {
  /* 对局流程 */
  MATCH_START: 'match:start',
  MATCH_END: 'match:end',
  COUNTDOWN_END: 'match:countdownEnd',

  /* 角色 */
  HIDER_CAUGHT: 'hider:caught',
  NOISE_EMITTED: 'sound:noise',
  SOUND_EMITTED: 'sound:emitted',   // 供网络层转发（见 net/session.js）

  /* 道具 */
  ITEM_SPAWN: 'item:spawn',
  ITEM_EXPIRE: 'item:expire',
  ITEM_PICKUP: 'item:pickup',
  ITEM_EFFECT: 'item:effect',

  /* 网络 */
  NET_STATE: 'net:state',
  NET_ERROR: 'net:error'
};

const handlers = new Map();

/**
 * 订阅事件。
 * @returns {() => void} 取消订阅函数
 */
export function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
  return () => off(type, fn);
}

export function off(type, fn) {
  const set = handlers.get(type);
  if (set) set.delete(fn);
}

/**
 * 派发事件。
 * 单个订阅者抛错不会影响其他订阅者，更不会打断模拟推进。
 */
export function emit(type, payload) {
  const set = handlers.get(type);
  if (!set || set.size === 0) return;
  for (const fn of Array.from(set)) {
    try {
      fn(payload, type);
    } catch (err) {
      // 表现层的问题不该让对局崩掉
      console.error(`[events] handler for "${type}" failed:`, err);
    }
  }
}

/** 清空所有订阅（重开/卸载时用） */
export function clearEvents() {
  handlers.clear();
}
