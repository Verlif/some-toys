/**
 * 临时：AI 卡墙晃动测量。
 * 用 DOM/时间桩把整局跑完，逐帧采样 AI 位置，
 * 以「0.6 秒窗口内振幅 > 4px 且几乎没有净推进」判定一次可见晃动（episode）。
 * 用法：node --experimental-default-type=module .tmp-jitter.mjs [局数] [每局秒数] [轨迹条数]
 */

/* ---------- 时间桩 ---------- */
let clock = 0;
Object.defineProperty(globalThis, 'performance', {
  configurable: true, writable: true, value: { now: () => clock }
});

/* ---------- DOM 桩 ---------- */
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

const ENTRY = process.env.GAME_ENTRY || '../js/main.js';
const { startGame } = await import(ENTRY);
const { gstate } = await import('../js/core/state.js');
const { circleHitsWall } = await import('../js/world/collision.js');

function frame(ms = 1000 / 60) {
  clock += ms;
  const cb = pendingFrame;
  pendingFrame = null;
  if (cb) cb(clock);
}

const WINDOW = 36;          // 0.6s
const AMP_MIN = 4;          // 振幅阈值（px）
const RUNS = Number(process.argv[2] || 3);
const MATCH_SECONDS = Number(process.argv[3] || 40);
const TRACE = Number(process.argv[4] || 0);
const traces = [];

function analyze(matchSeconds) {
  const per = new Map();
  const start = gstate.entities.filter(e => !e.isPlayer);
  for (const e of start) {
    per.set(e.id, {
      win: [], episodes: 0, byState: {}, nearWall: 0, lastCountAt: -99, t: 0,
      stuckFrames: 0, stuckEpisodes: 0, stuckRun: 0, movingFrames: 0
    });
  }

  let steps = 0;
  const maxSteps = Math.round(matchSeconds * 60);
  while (steps < maxSteps && gstate.state !== 'over' && gstate.state !== 'resultAnimation') {
    frame();
    steps++;
    if (gstate.state === 'countdown') continue;
    for (const e of gstate.entities) {
      if (e.isPlayer) continue;
      if (e.type === 'hider' && !e.alive) continue;
      const rec = per.get(e.id);
      if (!rec) continue;
      rec.t += 1 / 60;

      // 卡住统计：有路可走、却没有按预期推进
      const hasPath = !!(e.waypoints && e.wpIdx < e.waypoints.length);
      const frozen = (e.frozenUntil || 0) > 0;
      const prevPos = rec.win[rec.win.length - 1];
      const stepMoved = prevPos ? Math.hypot(e.x - prevPos.x, e.y - prevPos.y) : 0;
      if (hasPath && !frozen && prevPos) {
        rec.movingFrames++;
        const want = 130 * (e.speedMode === 'run' ? 1 : 0.5) * (1 / 60);
        if (stepMoved < want * 0.3) {
          rec.stuckFrames++;
          rec.stuckRun++;
          if (rec.stuckRun === 60) rec.stuckEpisodes++;
        } else {
          rec.stuckRun = 0;
        }
      } else {
        rec.stuckRun = 0;
      }

      rec.win.push({ x: e.x, y: e.y });
      if (rec.win.length > WINDOW) rec.win.shift();
      if (rec.win.length < WINDOW) continue;

      const w = rec.win;
      let cx = 0, cy = 0, pathLen = 0;
      for (let i = 0; i < w.length; i++) { cx += w[i].x; cy += w[i].y; }
      cx /= w.length; cy /= w.length;
      let amp = 0;
      for (let i = 0; i < w.length; i++) {
        const d = Math.hypot(w[i].x - cx, w[i].y - cy);
        if (d > amp) amp = d;
      }
      for (let i = 1; i < w.length; i++) pathLen += Math.hypot(w[i].x - w[i - 1].x, w[i].y - w[i - 1].y);
      const net = Math.hypot(w[w.length - 1].x - w[0].x, w[w.length - 1].y - w[0].y);

      const oscillating = amp > AMP_MIN && pathLen > amp * 2.5 && net < amp * 0.8;
      if (oscillating && rec.t - rec.lastCountAt > 0.5) {
        rec.lastCountAt = rec.t;
        rec.episodes++;
        const st = e.type === 'seeker' ? (e.ai?.state || '-') : (e.ai?.state || '-');
        rec.byState[st] = (rec.byState[st] || 0) + 1;
        if (circleHitsWall(e.x, e.y, e.r + 6)) rec.nearWall++;
        if (TRACE && traces.length < TRACE) {
          traces.push({
            id: e.id, type: e.type, state: st, amp: amp.toFixed(1), net: net.toFixed(1),
            pathLen: pathLen.toFixed(1),
            stuck: +(e.stuckTimer || 0).toFixed(2),
            path: e.path ? `${e.pathIdx}/${e.path.length}` : 'null',
            goal: e.goal ? `${(e.goal.x / 24).toFixed(1)},${(e.goal.y / 24).toFixed(1)}` : '-',
            track: w.filter((_, i) => i % 3 === 0).map(p => `${(p.x / 24).toFixed(2)},${(p.y / 24).toFixed(2)}`).join(' → ')
          });
        }
      }
    }
  }
  return { per, steps };
}

let episodes = 0, nearWall = 0, aiSeconds = 0, directedFrames = 0;
let stuckFrames = 0, stuckEpisodes = 0, movingFrames = 0;
const stateTotals = {};
let played = 0;

for (let r = 0; r < RUNS; r++) {
  clock = 0;
  startGame('hider');
  for (let i = 0; i < 240 && gstate.state === 'countdown'; i++) frame();
  const { per, steps } = analyze(MATCH_SECONDS);
  played += steps / 60;
  for (const [, rec] of per) {
    episodes += rec.episodes;
    nearWall += rec.nearWall;
    stuckFrames += rec.stuckFrames;
    stuckEpisodes += rec.stuckEpisodes;
    movingFrames += rec.movingFrames;
    for (const k in rec.byState) stateTotals[k] = (stateTotals[k] || 0) + rec.byState[k];
  }
  aiSeconds += (per.size * steps) / 60;
  directedFrames += per.size * steps;
}

const minutes = Math.max(0.001, aiSeconds / 60);
console.log(`样本：${RUNS} 局 × ${MATCH_SECONDS}s（实际对局 ${played.toFixed(1)}s，AI 累计 ${aiSeconds.toFixed(0)} AI·秒）`);
console.log(`可见晃动事件 : ${episodes}  (${(episodes / minutes).toFixed(1)} 次/AI·分钟)`);
console.log(`  贴墙(<=6px): ${nearWall}  (${(nearWall / minutes).toFixed(1)} 次/AI·分钟)`);
console.log(`卡顿帧占比   : ${(100 * stuckFrames / Math.max(1, movingFrames)).toFixed(2)}% 的有路帧`);
console.log(`卡死 episode : ${stuckEpisodes}  (${(stuckEpisodes / minutes).toFixed(2)} 次/AI·分钟，连续1秒走不动)`);
console.log('按状态归因   :', Object.entries(stateTotals).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ') || '-');

for (const t of traces) {
  console.log(`\n[${t.type}#${t.id} ${t.state}] 振幅=${t.amp}px 净位移=${t.net}px 路径长=${t.pathLen}px stuck=${t.stuck} path=${t.path} goal=${t.goal}`);
  console.log(`  ${t.track}`);
}
