/**
 * core/file-transfer.js — 文件分块收发
 *
 * 协议（JSON 文本帧，复用同一条 DataChannel）：
 *   { type:'file-start', fileId, name, size, totalChunks, mime }
 *   { type:'file-chunk', fileId, index, data }   data 为 base64
 *   { type:'file-end',   fileId }
 *
 * mime 为后加字段：旧版本不发，接收侧会按扩展名兜底判断能否直接预览图片。
 */
import {
  BUFFER_HIGH_WATER,
  CHUNK_SIZE,
  IMAGE_EXTENSIONS,
  MAX_FILE_WARN,
  PROGRESS_THROTTLE
} from '../config.js';
import { getPeer } from '../state.js';
import { base64ToBytes, bytesToBase64 } from '../utils/binary.js';
import { appendMessage, isChannelOpen, refreshChat } from './peers.js';

/** peerId -> 上次进度重绘时间 */
const lastRenderAt = new Map();

/** 文件体积是否需要提示确认 */
export function needsSizeWarning(size) {
  return size > MAX_FILE_WARN;
}

/** 是否是可以直接预览的图片 */
export function isImageFile(name, mime) {
  const type = String(mime || '').toLowerCase();
  if (type) return type.startsWith('image/'); // 有 MIME 就以它为准

  const ext = String(name || '').toLowerCase().split('.').pop();
  return IMAGE_EXTENSIONS.indexOf(ext) >= 0;
}

/** 进度重绘节流 */
function throttledRefresh(peerId) {
  const now = Date.now();
  const prev = lastRenderAt.get(peerId) || 0;
  if (now - prev < PROGRESS_THROTTLE) return;
  lastRenderAt.set(peerId, now);
  refreshChat(peerId);
}

/** 等待发送缓冲区回落到低水位（简单流控） */
function waitBufferDrained(peer) {
  return new Promise((resolve) => {
    const check = () => {
      if (!isChannelOpen(peer)) return resolve();
      if (peer.channel.bufferedAmount < BUFFER_HIGH_WATER) return resolve();
      setTimeout(check, 30);
    };
    check();
  });
}

/* ============================================================
 *  发送
 * ============================================================ */

/**
 * 发送一个文件
 * @param {string} peerId
 * @param {File} file
 * @returns {Promise<{ok:boolean, reason?:string, fileId?:string, error?:Error}>}
 */
export async function sendFile(peerId, file) {
  const peer = getPeer(peerId);
  if (!peer) return { ok: false, reason: 'no-peer' };
  if (!isChannelOpen(peer)) return { ok: false, reason: 'offline' };

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const fileId = 'f-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  const msg = {
    type: 'file',
    mine: true,
    fileId,
    name: file.name,
    size: file.size,
    mime: file.type || '',
    isImage: isImageFile(file.name, file.type),
    status: 'sending',
    progress: 0
  };
  appendMessage(peerId, msg);

  try {
    // 1. 文件头
    peer.channel.send(JSON.stringify({
      type: 'file-start',
      fileId,
      name: file.name,
      size: file.size,
      mime: file.type || '',
      totalChunks
    }));

    // 2. 逐块发送，最多渲染 50 次进度
    const renderEvery = Math.max(1, Math.floor(totalChunks / 50));

    for (let i = 0; i < totalChunks; i++) {
      if (!isChannelOpen(peer)) throw new Error('连接已断开');

      const chunk = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const buf = await chunk.arrayBuffer();

      peer.channel.send(JSON.stringify({
        type: 'file-chunk',
        fileId,
        index: i,
        data: bytesToBase64(new Uint8Array(buf))
      }));

      msg.progress = (i + 1) / totalChunks;
      if (i % renderEvery === 0 || i === totalChunks - 1) refreshChat(peerId);

      await waitBufferDrained(peer);
    }

    // 3. 结束标志
    peer.channel.send(JSON.stringify({ type: 'file-end', fileId }));

    msg.status = 'done';
    msg.url = URL.createObjectURL(file);
    refreshChat(peerId);
    return { ok: true, fileId };
  } catch (e) {
    console.error(e);
    msg.status = 'failed';
    msg.error = e.message;
    refreshChat(peerId);
    return { ok: false, reason: 'error', fileId, error: e };
  }
}

/* ============================================================
 *  接收
 * ============================================================ */

/** 找到该文件对应的消息对象 */
function findFileMessage(peer, fileId) {
  return peer.messages.find((m) => m.type === 'file' && m.fileId === fileId) || null;
}

export function handleFileStart(peerId, data) {
  const peer = getPeer(peerId);
  if (!peer) return;

  const mime = data.mime || '';

  peer.receivingFiles[data.fileId] = {
    name: data.name,
    size: data.size,
    mime,
    totalChunks: data.totalChunks,
    chunks: new Array(data.totalChunks),
    received: 0
  };

  appendMessage(peerId, {
    type: 'file',
    mine: false,
    fileId: data.fileId,
    name: data.name,
    size: data.size,
    mime,
    isImage: isImageFile(data.name, mime),
    status: 'receiving',
    progress: 0
  });
}

export function handleFileChunk(peerId, data) {
  const peer = getPeer(peerId);
  if (!peer) return;

  const file = peer.receivingFiles[data.fileId];
  if (!file) return;

  file.chunks[data.index] = data.data;
  file.received++;

  const msg = findFileMessage(peer, data.fileId);
  if (!msg) return;

  msg.progress = file.received / file.totalChunks;
  throttledRefresh(peerId);
}

export function handleFileEnd(peerId, data) {
  const peer = getPeer(peerId);
  if (!peer) return;

  const file = peer.receivingFiles[data.fileId];
  if (!file) return;

  // 重组分片
  const parts = [];
  for (let i = 0; i < file.totalChunks; i++) {
    parts.push(base64ToBytes(file.chunks[i] || ''));
  }

  const blob = new Blob(parts);
  const url = URL.createObjectURL(blob);

  const msg = findFileMessage(peer, data.fileId);
  if (msg) {
    msg.status = 'done';
    msg.url = url;
    msg.progress = 1;
    refreshChat(peerId);
  }

  delete peer.receivingFiles[data.fileId];
}
