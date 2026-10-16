/**
 * core/connection.js — WebRTC 连接建立（手动信令的三个动作）
 *   1) 发起方 createOfferCode()   -> 生成邀请码
 *   2) 接收方 createAnswerCode()  -> 生成应答码
 *   3) 发起方 completeConnection() -> 粘贴应答码完成连接
 * 连接建立后由本模块绑定 DataChannel，并广播 PEER_ONLINE 事件。
 */
import { CHANNEL_LABEL, ICE_CONFIG } from '../config.js';
import { getPeer, state } from '../state.js';
import { EV, emit } from '../utils/bus.js';
import { handleIncoming } from './inbound.js';
import { appendMessage, createPeer, createPeerId, hasPeer, markConnected } from './peers.js';
import { decodePayload, encodePayload, waitForIceGathering } from './signaling.js';

/** 发起方在等待应答码期间持有的数据通道 */
let pendingChannel = null;
/** 接收方已生成应答码、但对方尚未完成连接时的 PC */
let pendingAnswerPc = null;

/* ============================================================
 *  发起方
 * ============================================================ */

/**
 * 创建 offer 并编码为邀请码
 * @returns {Promise<string>} 邀请码
 */
export async function createOfferCode() {
  discardPendingOffer();

  const pc = new RTCPeerConnection(ICE_CONFIG);
  state.pendingOfferPc = pc;

  const channel = pc.createDataChannel(CHANNEL_LABEL, { ordered: true });
  pendingChannel = channel;

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGathering(pc);

  return encodePayload({
    type: 'offer',
    name: state.myName,
    sdp: pc.localDescription.sdp
  });
}

/**
 * 用应答码完成连接
 * @param {string} code 应答码
 */
export async function completeConnection(code) {
  const data = await decodePayload(code);

  if (data.type !== 'answer') throw new Error('这不是应答码，请检查是否粘错');

  const pc = state.pendingOfferPc;
  if (!pc) throw new Error('会话已过期，请重新生成邀请码');

  await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });

  attachPeer(createPeerId(), pc, pendingChannel, data.name || '对方');

  state.pendingOfferPc = null;
  pendingChannel = null;
}

/** 丢弃尚未协商完成的 offer（关闭 / 重新生成邀请码时调用） */
export function discardPendingOffer() {
  if (state.pendingOfferPc) {
    try {
      state.pendingOfferPc.close();
    } catch (e) {
      /* 忽略 */
    }
    state.pendingOfferPc = null;
  }
  pendingChannel = null;
}

/* ============================================================
 *  接收方
 * ============================================================ */

/**
 * 用邀请码生成应答码
 * @param {string} offerCode 邀请码
 * @returns {Promise<string>} 应答码
 */
export async function createAnswerCode(offerCode) {
  const data = await decodePayload(offerCode);

  if (data.type !== 'offer') throw new Error('这不是邀请码，请检查是否粘错');

  const pc = new RTCPeerConnection(ICE_CONFIG);
  const peerName = data.name || '对方';
  const peerId = createPeerId();

  pendingAnswerPc = pc;

  // 接收方通过 ondatachannel 拿到通道
  pc.ondatachannel = (event) => {
    attachPeer(peerId, pc, event.channel, peerName);
    pendingAnswerPc = null;
  };

  await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGathering(pc);

  return encodePayload({
    type: 'answer',
    name: state.myName,
    sdp: pc.localDescription.sdp
  });
}

/** 丢弃已生成应答码但对方迟迟未完成的连接（关闭向导时调用） */
export function discardPendingAnswer() {
  if (pendingAnswerPc) {
    try {
      pendingAnswerPc.close();
    } catch (e) {
      /* 忽略 */
    }
    pendingAnswerPc = null;
  }
}

/* ============================================================
 *  内部：注册 peer 并绑定事件
 * ============================================================ */

function attachPeer(peerId, pc, channel, name) {
  if (hasPeer(peerId)) return getPeer(peerId);

  const peer = createPeer(peerId, pc, channel, name);

  bindChannel(peer, channel);
  bindConnection(peer, pc);

  return peer;
}

function bindChannel(peer, channel) {
  if (!channel) return;

  const onOpen = () => {
    markConnected(peer, true);
    appendMessage(peer.id, {
      type: 'system',
      text: `与 ${peer.name} 的连接已建立`,
      time: Date.now()
    });
    emit(EV.PEER_ONLINE, { peerId: peer.id });

    // 握手时对一次昵称：覆盖「生成邀请码之后、连接建立之前对方改了名」的情况
    try {
      channel.send(JSON.stringify({ type: 'name', name: state.myName }));
    } catch (e) {
      /* 通道异常时忽略，不影响连接本身 */
    }
  };

  channel.onopen = onOpen;

  channel.onclose = () => {
    markConnected(peer, false);
    appendMessage(peer.id, {
      type: 'system',
      text: '对方已断开连接',
      time: Date.now()
    });
  };

  channel.onmessage = (event) => {
    try {
      handleIncoming(peer.id, JSON.parse(event.data));
    } catch (e) {
      console.error('消息解析失败', e);
    }
  };

  // 接收方的通道可能到手时已经 open
  if (channel.readyState === 'open') onOpen();
}

function bindConnection(peer, pc) {
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'disconnected' || s === 'failed' || s === 'closed') {
      markConnected(peer, false);
    }
  };
}
