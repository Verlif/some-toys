/**
 * 联机玩家名册：把「房间里的陌生人」变成「可以访问的农场」。
 *
 * 与 NPC 的分工很清楚：
 *   - **NPC** 存在 `state.friends` 里，会落库、会被 `npc-sim` 推进；
 *   - **真人** 存在 `state.peers` 里，**只活在内存**，关页面就没了，
 *     所有状态以对方浏览器为准，我们只拿一份只读快照。
 *
 * 这也是「不在线就不显示」的实现方式：没有快照 = 不在名册里。
 *
 * 消息流（P1 只读阶段）：
 *   连上 → 双方互发 hello → 互相拉一次 snap → 名册里有他 + 农场可看
 *   断开 → 立刻从名册里删掉
 */
import { state } from './state.js';
import { emit, on, EVENTS } from '../core/bus.js';
import { notify } from './notify.js';
import * as link from '../net/link.js';
import { DATA_VERSION, MSG, helloOf, readMessage, readSnapshot, snapshotOf, toastOf } from '../net/protocol.js';

/** 村镇配置存在 localStorage：它是「这台设备的联机设置」，不该跟着存档走 */
const CONFIG_KEY = 'sun_farm_village';

/** 快照请求超时：同网段正常是几十毫秒，4 秒没回就是真的不在 */
const SNAP_TIMEOUT_MS = 4000;

/** connectId → 我们自己的农场 id，避免和 npc01 / player 撞 */
const farmIdOf = (peerId) => `peer:${peerId}`;

/** 发出去还没回的快照请求 */
const pending = new Map();
let seq = 0;
let inited = false;

/** 读本机保存的村镇配置 */
export function villageConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
    return {
      name: typeof raw.name === 'string' ? raw.name : '',
      password: typeof raw.password === 'string' ? raw.password : '',
      /** 上次是不是「进了村镇」的状态：下次打自动回去，退出了就不打扰 */
      auto: raw.auto === true,
    };
  } catch {
    return { name: '', password: '', auto: false };
  }
}

/**
 * 保存村镇配置。
 * `auto` 记的是「下次打开游戏要不要自动进村镇」—— 加入时置 true，主动退出置 false。
 * @param {string} name
 * @param {string} password
 * @param {boolean} auto
 */
function saveVillageConfig(name, password, auto) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ name, password, auto }));
  } catch (error) {
    console.error(error);
  }
}

/** 当前名册里的真人玩家（形状与 NPC 一致，多了 net / connectId） */
export function peerList() {
  return state.peers;
}

/** 联机现状，给 UI 用（不要把 net/link 直接塞进 UI 层） */
export function linkInfo() {
  return {
    status: link.linkStatus(),
    peerId: link.myConnectId(),
    village: link.currentVillage(),
  };
}

/** 一句人话说明当前联机状态 */
export function linkStatusText() {
  const info = linkInfo();
  if (info.status === link.LINK_STATUS.ONLINE) {
    const id = info.peerId ? ` · 我的连接号 ${info.peerId.slice(0, 6)}` : '';
    return `已进入「${info.village}」${id}`;
  }
  if (info.status === link.LINK_STATUS.CONNECTING) return '正在进入村镇…';
  if (info.status === link.LINK_STATUS.ERROR) return '连接失败 · 正处在孤岛中';
  return '🏝 孤岛模式 · 没进村镇';
}

/** 大声喊一次自我介绍：改完昵称之后要让房间里的人立刻看到 */
export function announce() {
  if (!link.isLinked()) return false;
  return link.broadcast(helloOf(state.farm));
}

/** 这位 id 是不是真人玩家 */
export function isPeer(farmId) {
  return state.peers.some((peer) => peer.id === farmId);
}

/**
 * 把所有外来消息接起来。启动时调一次即可。
 */
export function initPeers() {
  if (inited) return;
  inited = true;

  link.setHandlers({
    onStatus: (status, detail) => {
      if (status === link.LINK_STATUS.ERROR) notify(`🏘 ${detail || '联机失败'}`, 'gold');
      emit(EVENTS.FRIENDS);
    },
    onJoin: () => {
      // 库只知道有人进房间，不知道是谁 —— 先自报家门，等对方的 hello
      link.broadcast(helloOf(state.farm));
    },
    onLeave: (peerId) => {
      const index = state.peers.findIndex((peer) => peer.connectId === peerId);
      if (index < 0) return;
      const [gone] = state.peers.splice(index, 1);
      servedAt.delete(peerId);
      notify(`${gone.avatar} ${gone.name} 离开了村镇`);
      emit(EVENTS.FRIENDS);
    },
    onMessage: (text, peerId) => {
      if (!peerId) return;
      const msg = readMessage(text);
      if (!msg) return;
      if (msg.t === MSG.HELLO) handleHello(msg, peerId);
      else if (msg.t === MSG.SNAP_REQ) handleSnapRequest(msg, peerId);
      else if (msg.t === MSG.SNAP_RES) handleSnapResponse(msg, peerId);
      else if (msg.t === MSG.TOAST) handleToast(msg, peerId);
      else emit(EVENTS.PEER_MSG, { msg, peerId });
    },
  });

  // 农场有变化就推一份新快照给村里的人：对方如果正开着我的农场，能立刻看到
  on(EVENTS.FARM, schedulePush);
  on(EVENTS.PLAYER, schedulePush);
  on(EVENTS.INVENTORY, schedulePush);
}

/**
 * 加入村镇。
 * @param {string} name 村镇名（= 房间名）
 * @param {string} [password] 房间口令，留空用村镇名兜底
 * @returns {Promise<boolean>}
 */
export async function joinVillage(name, password = '') {
  const village = name.trim().slice(0, 16);
  if (!village) return false;
  initPeers();
  state.peers.length = 0;
  const ok = await link.joinVillage({ name: village, password });
  if (!ok) {
    // 网络不支持（多半是 http + 局域网 IP，或两端都断网）：退回单机，并说清楚
    notify('🏝 网络不支持联机，你正处在孤岛中（只能玩自己的农场）', 'gold');
    emit(EVENTS.FRIENDS);
    return false;
  }
  saveVillageConfig(village, password, true);
  // 房间是「后来者也能被发现」的，进房先喊一嗓子
  link.broadcast(helloOf(state.farm));
  emit(EVENTS.FRIENDS);
  return true;
}

/**
 * 主动退出村镇：断开连接、清空名册，并把「自动入村」关掉 ——
 * 下次打开游戏就是纯离线环境，不再自己连。
 */
export function quitVillage() {
  const cfg = villageConfig();
  leaveVillage();
  saveVillageConfig(cfg.name, cfg.password, false);
  notify('🏝 已退出村镇，回到孤岛模式');
  emit(EVENTS.FRIENDS);
}

/** 离开村镇：名册清空，连接断开 */
export function leaveVillage() {
  link.leaveVillage();
  state.peers.length = 0;
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.resolve(null);
  }
  pending.clear();
  emit(EVENTS.FRIENDS);
}

/**
 * 给全村广播一条重要动态（升级 / 播种 / 挖到稀有种子…）。
 * 没进村镇时什么都不做 —— 单机玩家不该看到「发送失败」这类噪音。
 * @param {string} text 一句话，40 字以内
 */
export function broadcastToast(text) {
  if (!link.isLinked()) return false;
  return link.broadcast(toastOf(text));
}

/**
 * 直发一条报文（送礼回执这类由 store/peer-gift.js 组装的消息走这里）。
 * @param {string} peerId
 * @param {object} payload
 */
export function sendToPeer(peerId, payload) {
  return link.sendTo(peerId, payload);
}

/* ---------- 农场变化推送 ---------- */

/** 推送节流：一次收获会连着触发好几个事件，攒成一次广播 */
const PUSH_GAP_MS = 1200;
let pushTimer = 0;

/** 排一次推送（相同窗口内的多次变化合并） */
function schedulePush() {
  if (!link.isLinked() || pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = 0;
    pushSnapshot();
  }, PUSH_GAP_MS);
}

/** 把我的农场快照推给全村（没有 req，属于「主动更新」） */
function pushSnapshot() {
  if (!link.isLinked()) return;
  const payload = snapshotOf(state.farm, { id: farmIdOf(link.myConnectId()), net: true });
  payload.push = true;
  link.broadcast(payload);
}

/** 拿到某位玩家的农场快照。已有缓存时直接给 */
export function ensureSnap(peerId) {
  const peer = state.peers.find((item) => item.connectId === peerId);
  if (!peer) return Promise.resolve(null);
  if (peer.plots?.length) return Promise.resolve(peer);
  return requestSnapshot(peerId);
}

/**
 * 向对方要一份快照。
 * @param {string} peerId
 * @returns {Promise<object|null>} 农场对象
 */
export function requestSnapshot(peerId) {
  if (!link.isLinked()) return Promise.resolve(null);
  seq += 1;
  const req = `${seq}:${Date.now()}`;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(req);
      resolve(null);
    }, SNAP_TIMEOUT_MS);
    pending.set(req, { resolve, timer });

    const sent = link.sendTo(peerId, { t: MSG.SNAP_REQ, req });
    if (!sent) {
      clearTimeout(timer);
      pending.delete(req);
      resolve(null);
    }
  });
}

/* ---------- 消息处理 ---------- */

/**
 * 快照是被请求才发的，但不设上限的话，对面写个循环就能让我们
 * 每毫秒序列化一次 10 KB。按人限速 1 秒一次。
 */
const servedAt = new Map();

/** 全村 toast 的显示间隔：防恶作剧刷屏 */
const TOAST_GAP_MS = 1500;
let lastToastAt = 0;

/** 对方的 hello：写进名册（第一次见），顺手把资料刷新一遍 */
function handleHello(msg, peerId) {
  if (msg.v !== DATA_VERSION) {
    notify('🏘 对方的游戏版本不一样，先连不上', 'gold');
    return;
  }
  const profile = msg.profile || {};
  const farmId = farmIdOf(peerId);
  let peer = state.peers.find((item) => item.connectId === peerId);

  if (peer) {
    peer.name = profile.name;
    peer.avatar = profile.avatar;
    peer.level = profile.level;
  } else {
    peer = {
      id: farmId,
      net: true,
      connectId: peerId,
      name: profile.name || '邻居',
      avatar: profile.avatar || '🧑‍🌾',
      level: profile.level || 1,
      coins: 0,
      personality: 'friendly',
      profession: '农场主',
      steal: 'rare',
      dog: { breed: '', satiety: 0, at: 0 },
      plots: [],
      log: [],
      at: 0,
    };
    state.peers.push(peer);
    notify(`${peer.avatar} ${peer.name} 来到了村镇`, 'gold');
  }

  emit(EVENTS.FRIENDS);
  // 对方的 hello 若是「回应」，说明他也有我的资料了；否则回一条，免得他只发不收
  if (!msg.reply) link.sendTo(peerId, helloOf(state.farm, true));
  // 名册里有了他，顺手把农场拉过来（点开就能看，不用等下一次）
  requestSnapshot(peerId);
}

/** 对方要看我的农场 */
function handleSnapRequest(msg, peerId) {
  const now = Date.now();
  if (now - (servedAt.get(peerId) || 0) < 1000) return;
  servedAt.set(peerId, now);
  const payload = snapshotOf(state.farm, { id: farmIdOf(peerId), net: true });
  payload.req = typeof msg.req === 'string' ? msg.req.slice(0, 64) : '';
  link.sendTo(peerId, payload);
}

/** 对方的农场来了：填进名册（点击访问时会用到），并通知可能开着的弹窗 */
function handleSnapResponse(msg, peerId) {
  const farm = readSnapshot(msg, peerId, farmIdOf(peerId));
  if (!farm) return;

  const peer = state.peers.find((item) => item.connectId === peerId);
  if (peer) {
    peer.name = farm.name;
    peer.avatar = farm.avatar;
    peer.level = farm.level;
    peer.coins = farm.coins;
    peer.dog = farm.dog;
    peer.plots = farm.plots;
    peer.log = farm.log;
    peer.at = farm.at;
  }
  emit(EVENTS.FRIENDS);

  // 主动推送（push）没有 req：说明是对方的农场刚变过，开着弹窗就刷一下
  if (peer) emit(EVENTS.PEER, peer.id);

  const item = pending.get(msg.req);
  if (item) {
    clearTimeout(item.timer);
    pending.delete(msg.req);
    item.resolve(peer || farm);
  }
}

/** 村里有人发了条重要动态（限速，别让脚本刷屏） */
function handleToast(msg, peerId) {
  const peer = state.peers.find((item) => item.connectId === peerId);
  if (!peer || typeof msg.text !== 'string') return;
  const now = Date.now();
  if (now - lastToastAt < TOAST_GAP_MS) return;
  lastToastAt = now;
  notify(`${peer.avatar} ${peer.name}：${msg.text.slice(0, 40)}`);
}
