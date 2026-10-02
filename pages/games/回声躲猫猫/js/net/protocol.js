/**
 * 联机协议（消息定义与编解码）。
 *
 * 现在只有单机，但**协议先定下来**：之后写 WebSocket 服务器时，
 * 服务端只需要按这里的字段转发 / 校验，客户端代码不用动。
 *
 * 消息一律 JSON（可读、好调试、够用；将来要压带宽再换二进制编码，
 * 只要保持 type / payload 结构不变即可）。
 */

/** 协议版本：任何字段变化都要 +1，避免新旧客户端互相解析出错 */
export const PROTOCOL_VERSION = 1;

/** 消息类型 */
export const MSG = {
  /* 握手 */
  HELLO: 'hello',        // 客户端 → 房主：请求加入
  WELCOME: 'welcome',    // 房主 → 客户端：你的玩家序号 + 种子 + 配置
  REJECT: 'reject',      // 房主 → 客户端：拒绝（满员 / 版本不符）
  BYE: 'bye',

  /* 对局 */
  START: 'start',        // 房主 → 全体：开始（带上种子与配置，客户端据此本地生成同一张地图）
  INPUT: 'input',        // 客户端 → 房主：我的指令（core/command.js 的结构）
  SNAPSHOT: 'snap',      // 房主 → 全体：世界快照（权威状态）
  EVENT: 'event',        // 房主 → 全体：对局事件（被抓 / 道具 / 发声……）
  SOUND: 'sound',        // 房主 → 全体：一次发声的简短描述（客户端本地重建声波）

  /* 保活 */
  PING: 'ping',
  PONG: 'pong'
};

export function makeMessage(type, payload = null, seq = 0) {
  return { v: PROTOCOL_VERSION, type, seq, payload };
}

export function encodeMessage(msg) {
  try {
    return JSON.stringify(msg);
  } catch (err) {
    return null;
  }
}

/** 解码并做基本校验；不是合法消息就返回 null（绝不能让坏包进模拟） */
export function decodeMessage(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  return validateMessage(obj) ? obj : null;
}

/** 结构校验：版本、类型、payload 容器 */
export function validateMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (typeof msg.type !== 'string') return false;
  if (!Object.values(MSG).includes(msg.type)) return false;
  if (msg.v !== undefined && msg.v !== PROTOCOL_VERSION) return false;
  if (msg.payload !== undefined && msg.payload !== null && typeof msg.payload !== 'object') return false;
  return true;
}

/** 版本不符时的原因描述（用于 UI 提示） */
export function versionMismatchReason(msg) {
  if (!msg || typeof msg !== 'object') return '消息格式错误';
  if (msg.v !== PROTOCOL_VERSION) return `协议版本不一致（本地 v${PROTOCOL_VERSION}，对方 v${msg.v}）`;
  return '未知消息类型';
}
