/**
 * 极简事件总线：store 层用它广播状态变更，UI 层订阅后按需重渲染。
 * 目的：让领域逻辑完全不需要知道「谁在渲染、渲染到哪」。
 */

const listeners = new Map();

/** 事件名常量，避免各模块拼字符串时拼错 */
export const EVENTS = {
  /** 玩家档案变化：等级 / 经验 / 金币 / 称号 */
  PLAYER: 'state:player',
  /** 地块变化：种植 / 照料 / 收获 / 土地升级 */
  FARM: 'state:farm',
  /** 背包变化：种子 / 道具 / 农产品 */
  INVENTORY: 'state:inventory',
  /** 邻居变化：拜访 / 偷菜 / 帮忙 */
  FRIENDS: 'state:friends',
  /** 任务与签到进度变化 */
  QUESTS: 'state:quests',
  /** 每日签到与连续签到变化 */
  SIGN: 'state:sign',
  /** 图鉴统计或新手引导变化 */
  CODEX: 'state:codex',
  /** 称号的领取与佩戴变化 */
  TITLES: 'state:titles',
  /** 守护犬等宠物状态变化 */
  PETS: 'state:pets',
  /** 时报有新的大新闻 */
  NEWS: 'state:news',
  /** 好感度变化（偷菜掉、打理涨、送礼涨） */
  RELATION: 'state:relation',
  /** 收到邻居的赠礼，payload 为 { at, from, avatar, cropId, name, emoji, n, offline } */
  GIFT: 'ui:gift',
  /** 领域层请求弹一条提示，由 UI 层的 toast 组件消费 */
  NOTIFY: 'ui:notify',
  /** 请求播放「被守护犬抓住」的全屏提示，payload 为 { breed, owner, fine } */
  DOG_CAUGHT: 'ui:dog-caught',
  /** 请求切换主页面，payload 为页面名（farm / friends / news / shop） */
  NAVIGATE: 'ui:navigate',
};

/**
 * 订阅事件
 * @param {string} event
 * @param {(payload: any) => void} handler
 * @returns {() => void} 取消订阅的函数
 */
export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => off(event, handler);
}

/**
 * 取消订阅
 * @param {string} event
 * @param {(payload: any) => void} handler
 */
export function off(event, handler) {
  listeners.get(event)?.delete(handler);
}

/**
 * 广播事件
 * @param {string} event
 * @param {any} [payload]
 */
export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const handler of [...set]) handler(payload);
}