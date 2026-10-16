/**
 * core/chat.js — 纯文本消息发送（接收侧见 inbound.js）
 */
import { getPeer } from '../state.js';
import { appendMessage, isChannelOpen } from './peers.js';

/**
 * 发送一条文本消息
 * @returns {{ok: boolean, reason?: string}}
 */
export function sendChat(peerId, rawText) {
  const text = String(rawText == null ? '' : rawText).trim();
  if (!text) return { ok: false, reason: 'empty' };

  const peer = getPeer(peerId);
  if (!peer) return { ok: false, reason: 'no-peer' };
  if (!isChannelOpen(peer)) return { ok: false, reason: 'offline' };

  try {
    peer.channel.send(JSON.stringify({ type: 'chat', text }));
  } catch (e) {
    return { ok: false, reason: 'error', error: e };
  }

  appendMessage(peerId, { type: 'chat', mine: true, text, time: Date.now() });
  return { ok: true };
}
