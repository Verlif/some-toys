/**
 * utils/bus.js — 极简事件总线
 * 让 core 层（纯逻辑）通过事件通知 ui 层，避免双向依赖
 */

const handlers = new Map();

/** 事件名常量表，防止拼写错误 */
export const EV = {
  /** 联系人列表发生变化（新增 / 在线状态变化） */
  PEERS_CHANGED: 'peers:changed',
  /** 当前选中的联系人发生变化 */
  SELECTION_CHANGED: 'selection:changed',
  /** 当前聊天会话需要重绘 */
  CHAT_REFRESH: 'chat:refresh',
  /** 某个 peer 的连接已建立（可用于自动关闭模态框） */
  PEER_ONLINE: 'peer:online',
  /** 昵称变化 */
  NAME_CHANGED: 'name:changed'
};

export function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
  return () => off(type, fn);
}

export function off(type, fn) {
  const set = handlers.get(type);
  if (set) set.delete(fn);
}

export function emit(type, payload) {
  const set = handlers.get(type);
  if (!set) return;
  // 复制一份，避免回调里增删监听导致遍历异常
  for (const fn of Array.from(set)) {
    try {
      fn(payload);
    } catch (e) {
      console.error(`[bus] 事件 ${type} 的处理器抛出异常`, e);
    }
  }
}
