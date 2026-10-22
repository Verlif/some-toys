/**
 * 玩家之间的送礼（联机）：包裹道具与仓库产出都能送。
 *
 * 与邻居送礼的区别：对方是真人，可能不收 —— 所以是一个**要约**：
 *
 *   送方 → gift:offer  → 收方弹出「小绿想送你 🌾小麦 ×3，收吗？」
 *   收方「接收」→ gift:accept → 送方核对东西还在 → gift:ack{ok:true}
 *   收方收到 ok 才真正入包，并向全村广播一条 toast
 *   收方「拒收」→ gift:decline → 送方立刻把东西退回去
 *
 * 送方在发要约时就**先扣货**（不然对方点接收时可能已经花掉了），
 * 拒收 / 超时自动退回。收方必须等到 ack 才入包，避免「送方已退回、
 * 收方还白拿一份」这种双花。
 */
import { commit } from '../core/storage.js';
import { on, emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';
import { notify } from './notify.js';
import * as player from './player.js';
import { add, count, take } from './inventory.js';
import { isItemKey, itemLabel } from '../data/keys.js';
import { MSG, giftOfferOf, readGiftOffer } from '../net/protocol.js';
import { broadcastToast, peerList, sendToPeer } from './peers.js';

/** 送方等回执的上限：超过就当对方没看见，把东西退回来 */
const OFFER_TIMEOUT_MS = 90_000;

/** 收方点了「接收」之后等 ack 的时间 */
const ACK_TIMEOUT_MS = 5000;

/** 发出去的要约：req → { itemId, n, peerId, timer } */
const offers = new Map();

/** 同一个人的要约最短间隔：防止脚本连发把别人的弹窗刷爆 */
const OFFER_GAP_MS = 3000;

/** 同时挂着的要约上限 */
const OFFERS_MAX = 10;

/** peerId → 上次要约时间 */
const lastOfferAt = new Map();

/** 收方点了接收、正在等送方确认：req → { resolve, timer } */
const waits = new Map();

let seq = 0;
let inited = false;

/** 接上联机报文。启动时调一次 */
export function initPeerGift() {
  if (inited) return;
  inited = true;
  on(EVENTS.PEER_MSG, ({ msg, peerId }) => {
    if (!msg || !peerId) return;
    if (msg.t === MSG.GIFT_OFFER) handleOffer(msg, peerId);
    else if (msg.t === MSG.GIFT_ACCEPT) handleAccept(msg, peerId);
    else if (msg.t === MSG.GIFT_DECLINE) handleDecline(msg, peerId);
    else if (msg.t === MSG.GIFT_ACK) handleAck(msg);
  });
}

/** 这位玩家能不能送、能送多少 */
export function giftableCount(itemId) {
  return isItemKey(itemId) ? count(itemId) : 0;
}

/**
 * 发起送礼：先扣货，再把要约发出去。
 * @param {string} peerId 对方的 connectId
 * @param {string} itemId 背包 key
 * @param {number} n
 * @returns {boolean} 是否发出
 */
export function sendGiftToPeer(peerId, itemId, n) {
  const peer = peerList().find((item) => item.connectId === peerId);
  if (!peer) {
    notify('对方已经不在村镇里了');
    return false;
  }
  // 先看上限再扣货：不然「扣了又退」要多一次落盘，还容易出现中间态
  if (offers.size >= OFFERS_MAX) {
    notify('礼物还没回音，先等对方确认一下');
    return false;
  }
  if (!isItemKey(itemId)) {
    notify('这个东西送不出去');
    return false;
  }
  const have = count(itemId);
  const qty = Math.max(1, Math.min(have, Math.round(n) || 1));
  if (qty <= 0) {
    notify('背包里已经没有了');
    return false;
  }
  if (!take(itemId, qty)) {
    notify('背包里已经没有了');
    return false;
  }

  seq += 1;
  const req = `${state.farm.id}:${seq}:${Date.now()}`;
  const sent = sendToPeer(peerId, giftOfferOf(itemId, qty, req));
  if (!sent) {
    add(itemId, qty);   // 没发出去就退回来
    notify('送礼失败，东西已退回');
    return false;
  }

  commit({ bag: state.bag }).catch((error) => console.error(error));
  emit(EVENTS.INVENTORY);

  const timer = setTimeout(() => refund(req, '对方没有回应，礼物已退回'), OFFER_TIMEOUT_MS);
  offers.set(req, { itemId, n: qty, peerId, timer });
  notify(`🎁 已把 ${itemLabel(itemId)} ×${qty} 送给 ${peer.name}，等他确认`);
  return true;
}

/** 超时 / 拒收：把东西还给送方 */
function refund(req, reason) {
  const offer = offers.get(req);
  if (!offer) return;
  clearTimeout(offer.timer);
  offers.delete(req);
  add(offer.itemId, offer.n);
  commit({ bag: state.bag }).catch((error) => console.error(error));
  emit(EVENTS.INVENTORY);
  notify(reason);
}

/**
 * 收方点「接收」。等到送方 ack 之后才入包 —— 没等到就什么都不做。
 * @param {{peerId: string, req: string, itemId: string, n: number, name: string}} offer
 * @returns {Promise<boolean>}
 */
export async function acceptPeerGift(offer) {
  if (!offer || !isItemKey(offer.itemId)) return false;

  const ok = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      waits.delete(offer.req);
      resolve(false);
    }, ACK_TIMEOUT_MS);
    waits.set(offer.req, { resolve, timer });
    sendToPeer(offer.peerId, { t: MSG.GIFT_ACCEPT, req: offer.req });
  });

  if (!ok) {
    notify('对方已经走开了，礼物没有收到');
    return false;
  }

  add(offer.itemId, offer.n);
  player.addLog('🎁', `收下了 ${offer.name} 送来的 ${itemLabel(offer.itemId)} ×${offer.n}`);
  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.INVENTORY);
  emit(EVENTS.FARM);
  notify(`🎁 收到 ${offer.name} 的 ${itemLabel(offer.itemId)} ×${offer.n}`, 'gold');
  // 全村广播：谁送了什么，写清楚
  broadcastToast(`🎁 ${offer.name} 送给 ${state.farm.name} ${itemLabel(offer.itemId)} ×${offer.n}`);
  return true;
}

/** 收方点「拒收」 */
export function declinePeerGift(offer) {
  if (!offer) return;
  sendToPeer(offer.peerId, { t: MSG.GIFT_DECLINE, req: offer.req });
  notify('已拒收，礼物退回去了');
}

/* ---------- 报文处理 ---------- */

/** 收到要约：交给 UI 弹确认（store 不碰 DOM） */
function handleOffer(msg, peerId) {
  const offer = readGiftOffer(msg);
  if (!offer || !isItemKey(offer.itemId)) return;
  const peer = peerList().find((item) => item.connectId === peerId);
  if (!peer) return;

  const now = Date.now();
  if (now - (lastOfferAt.get(peerId) || 0) < OFFER_GAP_MS) return;
  lastOfferAt.set(peerId, now);

  emit(EVENTS.GIFT_OFFER, {
    peerId,
    req: offer.req,
    itemId: offer.itemId,
    n: offer.n,
    name: peer.name,
    avatar: peer.avatar,
  });
}

/** 收方接受了：东西还在就交出去，并回 ack */
function handleAccept(msg, peerId) {
  const req = String(msg.req || '').slice(0, 64);
  const offer = offers.get(req);
  if (!offer || offer.peerId !== peerId) {
    sendToPeer(peerId, { t: MSG.GIFT_ACK, req, ok: false });
    return;
  }
  clearTimeout(offer.timer);
  offers.delete(req);

  const peer = peerList().find((item) => item.connectId === peerId);
  player.addLog('🎁', `送给 ${peer?.name || '邻居'} ${itemLabel(offer.itemId)} ×${offer.n}`);
  commit({ farms: [state.farm] }).catch((error) => console.error(error));
  emit(EVENTS.FARM);

  sendToPeer(peerId, { t: MSG.GIFT_ACK, req, ok: true });
  notify(`🎁 ${peer?.name || '对方'} 收下了你的礼物`);
}

/** 收方拒收：退回 */
function handleDecline(msg, peerId) {
  const req = String(msg.req || '').slice(0, 64);
  const offer = offers.get(req);
  if (!offer || offer.peerId !== peerId) return;
  refund(req, '对方没有收下，礼物已退回');
}

/** 送方的回执 */
function handleAck(msg) {
  const req = String(msg.req || '').slice(0, 64);
  const waiter = waits.get(req);
  if (!waiter) return;
  clearTimeout(waiter.timer);
  waits.delete(req);
  waiter.resolve(Boolean(msg.ok));
}
