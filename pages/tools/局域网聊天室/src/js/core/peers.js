/**
 * core/peers.js — 联系人注册表与消息仓库
 * 只负责数据与事件广播，不碰 DOM；渠道（DataChannel）的绑定在 connection.js
 */
import { NAME_MAX_LENGTH } from '../config.js';
import { setName, state } from '../state.js';
import { EV, emit } from '../utils/bus.js';

/** 生成一个唯一的 peerId */
export function createPeerId() {
  return 'peer-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

/** 是否已存在该 peer */
export function hasPeer(peerId) {
  return state.peers.has(peerId);
}

/**
 * 建立 peer 对象并入库
 * @returns {object} peer
 */
export function createPeer(peerId, pc, channel, name) {
  const peer = {
    id: peerId,
    pc,
    channel,
    name,
    connected: false,
    /** 该会话的消息列表 */
    messages: [],
    /** fileId -> { name, size, totalChunks, chunks, received } 接收中的文件 */
    receivingFiles: {}
  };

  state.peers.set(peerId, peer);
  emit(EV.PEERS_CHANGED);

  // 第一个连接自动选中
  if (!state.currentPeerId) selectPeer(peerId);

  return peer;
}

/** 更新在线状态（仅在变化时广播） */
export function markConnected(peer, connected) {
  if (!peer || peer.connected === connected) return;
  peer.connected = connected;
  emit(EV.PEERS_CHANGED);
  emit(EV.CHAT_REFRESH, { peerId: peer.id });
}

/** 切换当前聊天对象 */
export function selectPeer(peerId) {
  state.currentPeerId = peerId || null;
  emit(EV.PEERS_CHANGED);
  emit(EV.SELECTION_CHANGED, { peerId: state.currentPeerId });
}

/** 追加一条消息并触发重绘 */
export function appendMessage(peerId, message) {
  const peer = state.peers.get(peerId);
  if (!peer) return null;
  peer.messages.push(message);
  emit(EV.CHAT_REFRESH, { peerId });
  return message;
}

/** 请求重绘某个会话（用于进度、状态等原地变更） */
export function refreshChat(peerId) {
  emit(EV.CHAT_REFRESH, { peerId });
}

/** 数据通道是否可用 */
export function isChannelOpen(peer) {
  return !!(
    peer &&
    peer.channel &&
    peer.channel.readyState === 'open'
  );
}

/* ============================================================
 *  昵称同步
 * ============================================================ */

/**
 * 给所有已连接的 peer 广播一条消息
 * @returns {number} 实际发出去了几份
 */
export function broadcast(payload) {
  const text = JSON.stringify(payload);
  let sent = 0;

  state.peers.forEach((peer) => {
    if (!isChannelOpen(peer)) return;
    try {
      peer.channel.send(text);
      sent++;
    } catch (e) {
      console.error('[peers] 广播失败', e);
    }
  });

  return sent;
}

/**
 * 对方修改了昵称
 * @returns {boolean} 是否真的发生了变化
 */
export function updatePeerName(peer, rawName) {
  if (!peer) return false;

  const next = String(rawName == null ? '' : rawName).trim().slice(0, NAME_MAX_LENGTH);
  if (!next || next === peer.name) return false;

  const prev = peer.name;
  peer.name = next;

  emit(EV.PEERS_CHANGED);
  emit(EV.CHAT_REFRESH, { peerId: peer.id });
  appendMessage(peer.id, {
    type: 'system',
    text: prev + ' 改名为 ' + next,
    time: Date.now()
  });

  return true;
}

/** 我改了昵称：通知所有已连接的对方 */
export function syncMyName(name) {
  return broadcast({ type: 'name', name });
}

/**
 * 修改自己的昵称并同步给所有已连接的对方
 * 把「本地保存 + 对外广播」合成一个原子动作，避免调用方漏掉同步
 * @returns {{ok: boolean, synced: number}}
 */
export function changeMyName(rawName) {
  if (!setName(rawName)) return { ok: false, synced: 0 };
  return { ok: true, synced: syncMyName(state.myName) };
}
