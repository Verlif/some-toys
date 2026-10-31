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
  /** 农场通知有新消息 / 被领取（角标与信箱列表都靠它刷） */
  NOTICE: 'state:notice',
  /** 好感度变化（偷菜掉、打理涨、送礼涨） */
  RELATION: 'state:relation',
  /** 联机好友的农场有新快照，payload 为对方农场 id（`peer:xxx`） */
  PEER: 'state:peer',
  /** 收到联机好友的送礼请求，payload 为请求详情（ui/peer-gift.js 消费） */
  GIFT_OFFER: 'ui:gift-offer',
  /** 其它联机报文（送礼回执等），payload 为 { msg, peerId }，由 store/peer-gift.js 消费 */
  PEER_MSG: 'net:peer-msg',
  /** 每日排行榜跨天结算完成（换了新的一天、奖励已寄进通知），payload 为结算结果 */
  DAILY: 'state:daily',
  /** 每日统计数值变化（bump 防抖后发），排行榜页靠它实时刷新 */
  STATS: 'state:stats',
  /** 领域层请求弹一条提示，由 UI 层的 toast 组件消费 */
  NOTIFY: 'ui:notify',
  /** 请求播放「被守护犬抓住」的全屏提示，payload 为 { breed, owner, fine } */
  DOG_CAUGHT: 'ui:dog-caught',
  /** 每日榜单出榜，payload 为玩家拿到的名次清单（ui/board-celebrate.js 消费） */
  BOARD_AWARD: 'ui:board-award',
  /** 图鉴点亮成功，payload 为 { cropId, name, emoji, seed, lit, total, litPercent }（ui/codex-celebrate.js 消费） */
  SPECIMEN: 'ui:specimen',
  /** 请求切换主页面，payload 为页面名（farm / friends / news / shop） */
  NAVIGATE: 'ui:navigate',
  /**
   * 弹窗叠层关掉一层，**下面那张卡原样还原了**。
   *
   * 还原出来的是「打开那一瞬间的 innerHTML 快照」，上面那层要是改过数据
   * （在邻居农场浇了水、偷了菜），这里还原的就是过期内容。持卡的模块
   * 收到这条事件后自己决定要不要重绘 —— 注意重绘时别动 `.modal-body`
   * 的 scrollTop，玩家刚滑到第 20 位，回来不该被弹回顶端。
   */
  MODAL_RESTORE: 'ui:modal-restore',
  /** 每分钟一跳（挂在主轮询上）：在线标识、订单倒计时等时间驱动的刷新 */
  TICK: 'ui:tick',
  /** 村庄建设变化：投入 / 祈福 / 升级（村中心与建设日志都靠它刷） */
  VILLAGE: 'state:village',
  /** 公共用地变化：玩家照料 / 拿走 / 村民顺手来一趟（公共地弹窗靠它刷） */
  COMMONS: 'state:commons',
  /**
   * 邻居「刚刚上线」。
   *
   * 必须**当场发**（见 social.js 的 enqueueVisit）：上线提示排在动作之前，
   * 玩家才不会看到「他先收了菜，过一会儿才告诉你他来了」。
   * payload 为 { name, avatar, text }
   */
  ARRIVAL: 'ui:arrival',
  /**
   * 邻居「刚刚下线」：在线窗口（5~15 分钟）走到头了。
   *
   * 与 ARRIVAL 对称 —— 上线有提示，下线也该有一句，否则绿点无声无息地灭掉，
   * 玩家会以为「他是不是还在，只是没动静」。补算期间不弹（玩家不在场）。
   * payload 为 { name, avatar, text }
   */
  DEPARTURE: 'ui:departure',
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