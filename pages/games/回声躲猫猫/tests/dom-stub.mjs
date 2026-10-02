/**
 * 临时：无头运行游戏用的 DOM / 时间桩（被其他临时脚本 import）。
 * 用法：import './dom-stub.mjs' 之前不要 import 任何 js/ 模块。
 */
let clock = 0;
Object.defineProperty(globalThis, 'performance', {
  configurable: true, writable: true, value: { now: () => clock }
});
export function advanceClock(ms) { clock += ms; }
export function nowMs() { return clock; }

const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k === 'measureText') return () => ({ width: 10 });
    if (!(k in t)) t[k] = () => {};
    return t[k];
  },
  set(t, k, v) { t[k] = v; return true; }
});

class El {
  constructor(id = '') {
    this.id = id; this.textContent = ''; this.innerHTML = ''; this.value = '';
    this.width = 960; this.height = 600; this.dataset = {}; this.style = {};
    this.children = []; this.parentNode = null; this._classes = new Set();
    this.classList = {
      add: (...c) => c.forEach(x => this._classes.add(x)),
      remove: (...c) => c.forEach(x => this._classes.delete(x)),
      contains: c => this._classes.has(c),
      toggle: c => (this._classes.has(c) ? this._classes.delete(c) : this._classes.add(c))
    };
  }
  getContext() { return ctxStub; }
  getBoundingClientRect() { return { width: 960, height: 600, left: 0, top: 0, right: 960, bottom: 600 }; }
  querySelector() { return new El('q'); }
  querySelectorAll() { return []; }
  addEventListener() {}
  removeEventListener() {}
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { return c; }
  remove() {}
  setAttribute() {}
  getAttribute() { return null; }
  blur() {}
  focus() {}
  click() {}
}

const elCache = new Map();
globalThis.document = {
  fullscreenElement: null, activeElement: null,
  documentElement: new El('html'), body: new El('body'),
  getElementById(id) { if (!elCache.has(id)) elCache.set(id, new El(id)); return elCache.get(id); },
  createElement(tag) { return new El(tag); },
  addEventListener() {},
  exitFullscreen: async () => {}
};
globalThis.window = {
  devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800,
  addEventListener() {}, removeEventListener() {},
  document: globalThis.document, location: { href: '' }
};
let pendingFrame = null;
globalThis.requestAnimationFrame = cb => { pendingFrame = cb; return 1; };
globalThis.cancelAnimationFrame = () => {};

/** 推进一帧（16.67ms） */
export function frame(ms = 1000 / 60) {
  advanceClock(ms);
  const cb = pendingFrame;
  pendingFrame = null;
  if (cb) cb(clock);
}
