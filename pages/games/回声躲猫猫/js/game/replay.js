/**
 * 回放：按固定采样间隔记录整场状态，结算后从快照重建上帝视角。
 *
 * 记录的是“整场”而不是某一方视角：实体坐标、声波射线、墙壁记忆、剩余时间。
 * 回放不参与游戏逻辑，只读取快照，因此不会影响对局结果。
 */
import { REPLAY_SAMPLE_INTERVAL } from '../core/config.js';
import { gstate } from '../core/state.js';
import { nowSec } from '../core/timer.js';
import { clamp } from '../core/utils.js';
import { dom } from '../ui/dom.js';

const replay = {
  frames: [],
  frameIndex: 0,
  sampleAcc: 0,
  duration: 0,
  elapsed: 0,
  playing: false,
  gameStartSec: null
};

/** 当前对局开始时的 nowSec()，null 表示还没开始记录 */
export function getReplayStart() {
  return replay.gameStartSec;
}

export function setReplayStart(sec) {
  replay.gameStartSec = sec;
}

export function getReplayState() {
  return replay;
}

/** 当前回放进度（秒） */
export function currentReplayElapsed() {
  if (replay.gameStartSec === null) return 0;
  return Math.max(0, nowSec() - replay.gameStartSec);
}

/** 采样一帧；force = true 用于开局首帧与终局末帧 */
export function captureReplayFrame(force = false) {
  if (replay.gameStartSec === null || !gstate.grid || !gstate.entities.length) return;
  const elapsed = Math.max(0, gstate.cfgGameTime - gstate.timeLeft);
  if (!force && elapsed - replay.duration < REPLAY_SAMPLE_INTERVAL) return;

  const frame = {
    t: elapsed,
    entities: gstate.entities.map(e => ({
      id: e.id, type: e.type, x: e.x, y: e.y,
      alive: e.type === 'seeker' ? true : !!e.alive,
      isPlayer: !!e.isPlayer,
      controlScheme: e.controlScheme || 'p1',
      speedMode: e.speedMode || 'walk'
    })),
    waves: gstate.soundWaves.map(w => ({
      x: w.x, y: w.y, maxRadius: w.maxRadius, strength: w.strength,
      emitTime: w.emitTime - replay.gameStartSec,
      rays: w.rays,
      hits: (w.hits || []).map(h => ({
        x: h.x, y: h.y, dist: h.dist,
        targetId: h.target?.id || null,
        emitterId: h.emitter?.id || w.emitter?.id || null
      }))
    })),
    wallMemories: Array.from(gstate.wallMemoryMap.values()).map(wm => ({
      emitterId: wm.emitterId, gx: wm.gx, gy: wm.gy, strength: wm.strength,
      arrivals: wm.arrivals.map(t => t - replay.gameStartSec)
    })),
    timeLeft: gstate.timeLeft
  };

  // 避免“强制终局快照”与最近一帧完全重复
  const last = replay.frames[replay.frames.length - 1];
  if (last && Math.abs(last.t - frame.t) < 0.001) replay.frames[replay.frames.length - 1] = frame;
  else replay.frames.push(frame);
  replay.duration = frame.t;
  replay.sampleAcc = 0;
}

export function resetReplay() {
  replay.frames = [];
  replay.frameIndex = 0;
  replay.sampleAcc = 0;
  replay.duration = 0;
  replay.elapsed = 0;
  replay.playing = false;
  replay.gameStartSec = null;
  dom.replayBar.classList.remove('show');
  dom.exitReplayHudBtn.style.display = 'none';
}

/** 回放中实体位置的线性插值 */
export function interpolateReplayEntities(t) {
  if (!replay.frames.length) return [];
  let i = replay.frameIndex;
  while (i + 1 < replay.frames.length && replay.frames[i + 1].t <= t) i++;
  while (i > 0 && replay.frames[i].t > t) i--;
  replay.frameIndex = i;
  const a = replay.frames[i];
  const b = replay.frames[Math.min(i + 1, replay.frames.length - 1)];
  const span = Math.max(0.0001, b.t - a.t);
  const f = clamp((t - a.t) / span, 0, 1);
  const bMap = new Map(b.entities.map(e => [e.id, e]));
  return a.entities.map(e => {
    const eb = bMap.get(e.id);
    if (!eb || e.alive !== eb.alive) return { ...e };
    return { ...e, x: e.x + (eb.x - e.x) * f, y: e.y + (eb.y - e.y) * f };
  });
}

/** 取 t 时刻的快照帧（不插值） */
export function getReplayFrameAt(t) {
  if (!replay.frames.length) return null;
  let i = replay.frameIndex;
  while (i + 1 < replay.frames.length && replay.frames[i + 1].t <= t) i++;
  while (i > 0 && replay.frames[i].t > t) i--;
  replay.frameIndex = i;
  return replay.frames[i];
}

export function startReplay() {
  if (!replay.frames.length) return;
  dom.overlay.classList.add('hidden');
  dom.overlay.classList.remove('result');
  dom.overlay.classList.remove('minimized');
  dom.pauseOverlay.classList.remove('show');
  dom.countdownOverlay.classList.remove('show');
  gstate.spectator = true;
  gstate.showGodView = true;
  gstate.state = 'replay';
  replay.elapsed = 0;
  replay.frameIndex = 0;
  replay.playing = true;
  dom.replayBar.classList.add('show');
  dom.exitReplayHudBtn.style.display = 'inline-flex';
  dom.replayRange.max = String(Math.max(0.01, replay.duration));
  dom.replayRange.value = '0';
  dom.replayPlayBtn.textContent = '❚❚';
  updateReplayTimeUI();
}

export function exitReplay() {
  if (gstate.state !== 'replay') return;
  replay.playing = false;
  gstate.state = 'over';
  gstate.spectator = true;
  gstate.showGodView = true;
  dom.replayBar.classList.remove('show');
  dom.exitReplayHudBtn.style.display = 'none';
  dom.overlay.classList.remove('hidden');
  dom.overlay.classList.remove('minimized');
  dom.overlay.classList.add('result');
}

export function updateReplay(dt) {
  if (!replay.playing) return;
  replay.elapsed += dt;
  if (replay.elapsed >= replay.duration) {
    replay.elapsed = replay.duration;
    replay.playing = false;
    dom.replayPlayBtn.textContent = '▶';
  }
  dom.replayRange.value = String(replay.elapsed);
  updateReplayTimeUI();
}

export function updateReplayTimeUI() {
  const fmt = sec => {
    const m = Math.floor(Math.max(0, sec || 0) / 60);
    const s = Math.floor(Math.max(0, sec || 0) % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };
  dom.replayTime.textContent = `${fmt(replay.elapsed)} / ${fmt(replay.duration)}`;
}

export function replayTogglePlay() {
  if (gstate.state !== 'replay') return;
  if (replay.elapsed >= replay.duration) replay.elapsed = 0;
  replay.playing = !replay.playing;
  dom.replayPlayBtn.textContent = replay.playing ? '❚❚' : '▶';
}

/** 拖动进度条 */
export function seekReplay(t) {
  if (gstate.state !== 'replay') return;
  replay.elapsed = clamp(parseFloat(t) || 0, 0, replay.duration);
  replay.playing = false;
  dom.replayPlayBtn.textContent = '▶';
  updateReplayTimeUI();
}
