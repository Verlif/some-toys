/**
 * 联机传输层：只管「谁在线」和「收发消息」，不懂农场业务。
 *
 * 现在接的是 `vendor/webconnect.js`（WebRTC mesh，信令走公共 tracker / MQTT / Nostr）。
 * 这一层是刻意做薄的：将来换成「局域网 SSE 中继」时只改本文件，
 * 上层（`store/peers.js`）的消息格式与回调一个字都不用动。
 *
 * 三条纪律：
 *   - 房间里传的一律是 **JSON 字符串**，不依赖库的对象序列化细节；
 *   - 连接/断开都只从库的回调驱动，不自己猜在线状态；
 *   - 消息只交给 `handlers.onMessage`，非法消息在 `net/protocol.js` 里拦。
 */

/** 连接状态 */
export const LINK_STATUS = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  ONLINE: 'online',
  ERROR: 'error',
};

/** 房间前缀：同一个 appName 下不同游戏不会串房 */
// 游戏已更名《西米的农场》，APP_NAME 保持 sun-farm 不变 —— 改了新旧版本就无法互联
const APP_NAME = 'sun-farm';

/** 单条报文的字节上限：快照约 10 KB，48 KB 已经宽松到不可能误伤 */
const MAX_MESSAGE_BYTES = 48 * 1024;

/** 每人 5 秒内最多这么多条：正常操作远达不到，刷屏的会被静默丢掉 */
const RATE_WINDOW_MS = 5000;
const RATE_MAX = 60;

/** peerId → { since, count } */
const rate = new Map();

/**
 * 收到消息前的闸门：超大包直接扔，超频的直接扔。
 * 这两条是防「对面写了个脚本」的最低成本手段 —— 不是安全边界，
 * 但足以让恶作剧脚本没法把我们的页面拖死。
 * @param {string} text
 * @param {string} peerId
 */
function accepted(text, peerId) {
  if (text.length > MAX_MESSAGE_BYTES) return false;
  const now = Date.now();
  const slot = rate.get(peerId);
  if (!slot || now - slot.since > RATE_WINDOW_MS) {
    rate.set(peerId, { since: now, count: 1 });
    return true;
  }
  slot.count += 1;
  return slot.count <= RATE_MAX;
}

let conn = null;
let status = LINK_STATUS.IDLE;
let villageName = '';
let selfId = '';
let handlers = {};

/**
 * 注册回调。字段都是可选的：
 *   onStatus(status, detail) / onJoin(peerId) / onLeave(peerId) / onMessage(text, peerId)
 * @param {{onStatus?: Function, onJoin?: Function, onLeave?: Function, onMessage?: Function}} next
 */
export function setHandlers(next) {
  handlers = next || {};
}

export const linkStatus = () => status;
export const myConnectId = () => selfId;
export const currentVillage = () => villageName;
export const isLinked = () => status === LINK_STATUS.ONLINE;

function setStatus(next, detail) {
  status = next;
  handlers.onStatus?.(next, detail);
}

/**
 * 加入村镇（= 进入一个房间）。
 *
 * 库是按房间自动组网的：同名村镇的人会互相发现，不需要谁当房主。
 * `password` 只影响房间密钥（防止陌生人乱入），留空就用村镇名兜底。
 *
 * @param {{name: string, password?: string}} opts
 * @returns {Promise<boolean>} 是否成功加入
 */
export async function joinVillage({ name, password }) {
  if (!name) return false;
  leaveVillage();
  villageName = name;
  setStatus(LINK_STATUS.CONNECTING);

  // 按需加载：不联机的玩家不该为 437 KB 的库买单
  let mod;
  try {
    mod = await import('../../vendor/webconnect.js');
  } catch (error) {
    console.error(error);
    setStatus(LINK_STATUS.ERROR, '联机库加载失败');
    return false;
  }

  const webconnect = mod.default || mod.webconnect;
  let self;
  try {
    self = webconnect({
      appName: APP_NAME,
      channelName: name,
      connectPassword: password || name,
    });
    conn = self;
  } catch (error) {
    // 最常见的原因：页面不是 https / localhost，crypto.subtle 是 undefined
    console.error(error);
    setStatus(LINK_STATUS.ERROR, '无法建立连接（需要 https 或 localhost）');
    return false;
  }

  // 回调里先确认「这条连接还是当前那条」：换村镇时旧连接可能还在发事件，
  // 不挡一下会把已经离开的人重新塞回名册
  const alive = () => conn === self;
  self.onConnect(({ connectId }) => { if (alive()) handlers.onJoin?.(connectId); });
  self.onDisconnect(({ connectId }) => { if (alive()) handlers.onLeave?.(connectId); });
  self.onReceive((data, attr) => {
    const peerId = attr?.connectId;
    if (!alive() || typeof data !== 'string' || !peerId) return;
    if (!accepted(data, peerId)) return;
    handlers.onMessage?.(data, peerId);
  });
  self.getMyId(({ connectId }) => {
    if (alive()) selfId = connectId || '';
  });

  setStatus(LINK_STATUS.ONLINE);
  return true;
}

/** 退出村镇。幂等，没连的时候调用什么都不做 */
export function leaveVillage() {
  const old = conn;
  conn = null;   // 先摘引用：旧连接之后发来的事件会被 alive() 拦掉
  if (old) {
    try {
      old.Disconnect?.();
    } catch (error) {
      console.error(error);
    }
    // 库里 Disconnect() 在「一个 peer 都没有」时什么都不做，
    // 那样会静默留在房间里，所以再按房间补一次 leave()
    for (const room of Object.values(old.room || {})) {
      try {
        room?.leave?.();
      } catch (error) {
        console.error(error);
      }
    }
  }
  selfId = '';
  villageName = '';
  if (status !== LINK_STATUS.IDLE) setStatus(LINK_STATUS.IDLE);
}

/**
 * 发给某一位。
 * @param {string} peerId 库给的 connectId
 * @param {object} payload 会被 JSON 序列化
 */
export function sendTo(peerId, payload) {
  if (!conn || !peerId) return false;
  try {
    conn.Send(JSON.stringify(payload), { connectId: peerId });
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

/**
 * 发给房间里所有人（包括还没自报家门的）。
 * @param {object} payload
 */
export function broadcast(payload) {
  if (!conn) return false;
  try {
    conn.Send(JSON.stringify(payload), { connectId: null });
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}
