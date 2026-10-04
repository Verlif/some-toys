/**
 * 回放播放：把录像数据还原成渲染层能直接消费的 scene。
 *
 * 只做数据，不碰 DOM——画布与控制条在 ui/replay.js。
 * 播放支持暂停、0.5×~4× 倍速、进度拖拽，播完自动循环。
 */
import { game } from '../core/state.js';
import { replay } from './recorder.js';

export const playback = {
  active: false,
  playing: true,
  speed: 1,
  time: 0,
  duration: 0
};

export function startPlayback() {
  playback.duration = replay.duration;
  playback.time = 0;
  playback.playing = true;
  playback.speed = 1;
  playback.active = playback.duration > 0 && replay.frames.length > 0;
  return playback.active;
}

export function stopPlayback() {
  playback.active = false;
  playback.playing = false;
}

export function togglePlay() {
  playback.playing = !playback.playing;
  return playback.playing;
}

export function setSpeed(s) {
  playback.speed = s;
}

export function seek(t) {
  playback.time = Math.max(0, Math.min(playback.duration, t));
}

/** 推进播放头；返回是否发生了跳变（用于刷新进度条） */
export function advance(dt) {
  if (!playback.active || !playback.playing || playback.duration <= 0) return false;
  playback.time += dt * playback.speed;
  if (playback.time >= playback.duration) playback.time = 0;   // 循环播放
  return true;
}

/** 二分定位：返回 [前一帧, 后一帧, 插值系数] */
function frameAt(t) {
  const frames = replay.frames;
  if (!frames.length) return null;

  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const i = Math.max(0, lo - 1);
  const a = frames[i];
  const b = frames[Math.min(i + 1, frames.length - 1)] || a;
  const span = b.t - a.t;
  const alpha = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0;
  return { a, b, alpha };
}

/** 定位不超过 t 的最后一个地形快照 */
function terrainAt(t) {
  const arr = replay.terrain;
  if (!arr.length) return null;
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return arr[lo];
}

const lerp = (a, b, k) => a + (b - a) * k;

/** 构造回放场景：字段与 game 对齐，render 层无需区分实时 / 回放 */
export function buildScene(t) {
  const f = frameAt(t);
  if (!f) return null;
  const { a, b, alpha } = f;
  const snap = terrainAt(t);

  const entities = a.ents.map((ea, i) => {
    const eb = b.ents[i] || ea;
    return {
      teamId: ea.team,
      isPlayer: ea.pl >= 0,
      playerIndex: ea.pl,
      x: lerp(ea.x, eb.x, alpha),
      y: lerp(ea.y, eb.y, alpha),
      faceX: lerp(ea.fx, eb.fx, alpha),
      faceY: lerp(ea.fy, eb.fy, alpha),
      bob: lerp(ea.bob, eb.bob, alpha),
      downed: !!ea.down,
      arrived: !!ea.arr,
      respawnTimer: ea.rt,
      invuln: ea.inv,
      scanTimer: lerp(ea.st, eb.st, alpha),
      scanMax: ea.sm,
      scanRadius: ea.sr,
      defuseTimer: lerp(ea.dft, eb.dft, alpha),
      defuseMax: ea.dfm,
      defuseTarget: ea.tx >= 0 ? { x: ea.tx, y: ea.ty } : null,
      thinkTimer: ea.th,
      pendingExplosions: ea.pe || [],
      stats: {},
      radius: 5
    };
  });

  return {
    walls: game.walls,
    mines: game.mines,
    entranceYs: game.entranceYs,
    exitX: game.exitX,
    exitY: game.exitY,
    // 旗帜位置固定，归属随录像帧走
    flags: (game.flags || []).map((f, i) => ({
      x: f.x, y: f.y,
      takenBy: a.fg ? a.fg[i] : f.takenBy
    })),
    elapsed: t,
    state: 'playing',
    screenShake: 0,
    exitFlash: 0,
    unionKnown: snap ? snap.known : game.unionKnown,
    displayFog: snap ? snap.fog : game.displayFog,
    displayTrail: snap ? snap.trail : game.displayTrail,
    teamTrails: game.teamTrails,
    entities,
    explosions: a.booms || [],
    ripples: a.rips || [],
    particles: []
  };
}
