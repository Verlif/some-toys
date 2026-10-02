/**
 * 传输层抽象。
 *
 * 目的：让上层（net/session.js）完全不关心“消息是怎么过去的”。
 *   · NullTransport          单机，没有对端（发送即丢弃）
 *   · LoopbackTransport      进程内回环，用来在本地把「房主 + 客户端」跑起来测试
 *   · WebSocketTransport     真正的远程联机（等服务器就绪即可直接用）
 *
 * 统一约定：
 *   transport.send(msg)        发一条（对象，内部自己序列化）
 *   transport.onMessage(fn)    收到一条（已反序列化 + 校验）
 *   transport.onOpen/onClose   连接状态
 *   transport.isOpen           是否可用
 */
import { encodeMessage, decodeMessage, versionMismatchReason } from './protocol.js';

export class Transport {
  constructor() {
    this._msgHandlers = new Set();
    this._openHandlers = new Set();
    this._closeHandlers = new Set();
    this._errorHandlers = new Set();
    this.open = false;
  }

  get isOpen() {
    return this.open;
  }

  onMessage(fn) { this._msgHandlers.add(fn); return () => this._msgHandlers.delete(fn); }
  onOpen(fn) { this._openHandlers.add(fn); return () => this._openHandlers.delete(fn); }
  onClose(fn) { this._closeHandlers.add(fn); return () => this._closeHandlers.delete(fn); }
  onError(fn) { this._errorHandlers.add(fn); return () => this._errorHandlers.delete(fn); }

  /** 子类调用：把收到的原始数据交给上层 */
  emitRaw(raw) {
    const msg = typeof raw === 'string' ? decodeMessage(raw) : raw;
    if (!msg) {
      this.emitError(new Error(versionMismatchReason(typeof raw === 'string' ? safeParse(raw) : raw)));
      return;
    }
    for (const fn of this._msgHandlers) fn(msg);
  }

  emitOpen() { this.open = true; for (const fn of this._openHandlers) fn(); }
  emitClose(reason) { this.open = false; for (const fn of this._closeHandlers) fn(reason); }
  emitError(err) { for (const fn of this._errorHandlers) fn(err); }

  send() { /* 子类实现 */ }
  close() { /* 子类实现 */ }
}

function safeParse(raw) {
  try { return JSON.parse(raw); } catch (err) { return null; }
}

/** 单机：没有对端，发送静默丢弃 */
export class NullTransport extends Transport {
  constructor() {
    super();
    this.open = true;
  }
  send() {}
  close() { this.open = false; }
}

/**
 * 进程内回环：把两个 Transport 接在一起，模拟一条真实链路。
 * @param {object} [opts] opts.latencyMs 模拟延迟；opts.dropRate 模拟丢包
 */
export class LoopbackTransport extends Transport {
  constructor(opts = {}) {
    super();
    this.peer = null;
    this.latencyMs = opts.latencyMs || 0;
    this.dropRate = opts.dropRate || 0;
    this.open = true;
    this.sentCount = 0;
  }

  send(msg) {
    if (!this.open || !this.peer || msg == null) return;
    this.sentCount++;
    if (this.dropRate > 0 && Math.random() < this.dropRate) return;
    const raw = encodeMessage(msg);
    if (raw == null) return;
    const deliver = () => { if (this.peer.open) this.peer.emitRaw(raw); };
    if (this.latencyMs > 0) setTimeout(deliver, this.latencyMs);
    else queueMicrotask(deliver);
  }

  close() {
    this.open = false;
    if (this.peer && this.peer.open) {
      const peer = this.peer;
      queueMicrotask(() => peer.emitClose('peer-closed'));
    }
    this.emitClose('closed');
  }
}

/** 建一对已经互相接好的回环传输 */
export function createLoopbackPair(opts = {}) {
  const a = new LoopbackTransport(opts);
  const b = new LoopbackTransport(opts);
  a.peer = b;
  b.peer = a;
  return { a, b };
}

/**
 * 真实 WebSocket 传输。
 *
 * 服务器还没写，所以这里只保证「一旦有服务器就能用」：
 *   · 自动重连（指数退避）
 *   · 心跳（ping/pong 由 session 层负责发，这里只暴露 latency 供 UI 显示）
 *   · 坏包交给 emitError，不影响主循环
 */
export function createWebSocketTransport(url, opts = {}) {
  const transport = new Transport();
  const reconnectDelay = opts.reconnectDelayMs ?? 1500;
  const maxDelay = opts.maxReconnectDelayMs ?? 10000;
  let socket = null;
  let delay = reconnectDelay;
  let closedByUser = false;

  const connect = () => {
    if (closedByUser) return;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      transport.emitError(err);
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      delay = reconnectDelay;
      transport.emitOpen();
    };
    socket.onmessage = ev => transport.emitRaw(ev.data);
    socket.onerror = () => transport.emitError(new Error('websocket error'));
    socket.onclose = () => {
      transport.emitClose('socket-closed');
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (closedByUser) return;
    const wait = delay;
    delay = Math.min(maxDelay, delay * 1.6);
    setTimeout(connect, wait);
  };

  transport.send = msg => {
    if (!socket || socket.readyState !== 1) return false;
    const raw = encodeMessage(msg);
    if (raw == null) return false;
    socket.send(raw);
    return true;
  };
  transport.close = () => {
    closedByUser = true;
    if (socket) socket.close();
    transport.emitClose('closed-by-user');
  };
  transport.connect = connect;

  connect();
  return transport;
}
