/**
 * 回放录制（模拟层，纯数据，不碰 DOM）。
 *
 * 按固定采样间隔记录整场：实体坐标、声波射线、墙壁记忆、道具、剩余时间。
 * 播放与界面在 ui/replay.js，这里只负责“记”和“取”。
 *
 * 之所以拆开：将来联机时客户端也可以本地录制同一份数据，
 * 而房主/服务端完全不需要 DOM。
 */
import { REPLAY_SAMPLE_INTERVAL } from '../core/config.js';
import { gstate } from '../core/state.js';
import { nowSec } from '../core/timer.js';
import { clamp } from '../core/utils.js';

const replay = {
  frames: [],
  frameIndex: 0,
  duration: 0,
  gameStartSec: null
};

export function setReplayStart(sec) {
  replay.gameStartSec = sec;
}

export function replayDuration() {
  return replay.duration;
}

export function replayFrameCount() {
  return replay.frames.length;
}

export function resetReplayData() {
  replay.frames = [];
  replay.frameIndex = 0;
  replay.duration = 0;
  replay.gameStartSec = null;
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
      speedMode: e.speedMode || 'walk',
      frozen: (e.frozenUntil || 0) > nowSec(),
      revealed: (e.revealedUntil || 0) > nowSec(),
      haste: (e.hasteUntil || 0) > nowSec()
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
    items: gstate.items.map(it => ({ id: it.id, type: it.type, x: it.x, y: it.y })),
    timeLeft: gstate.timeLeft
  };

  // 避免“强制终局快照”与最近一帧完全重复
  const last = replay.frames[replay.frames.length - 1];
  if (last && Math.abs(last.t - frame.t) < 0.001) replay.frames[replay.frames.length - 1] = frame;
  else replay.frames.push(frame);
  replay.duration = frame.t;
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
