/**
 * 录像录制：对局进行中按固定频率采样，赛后用于回放。
 *
 *   实体状态   REPLAY_HZ（30Hz）—— 位置、朝向、扫描/排雷进度、倒地与到达等
 *   地形快照   TERRAIN_SNAP_HZ（5Hz）—— 已知信息、迷雾、路径（体积较大，低频采样即可）
 *
 * 采样点必须在 render() 之后写入，此时 unionKnown / displayFog / displayTrail 才是本帧的值。
 */
import { REPLAY_HZ, TERRAIN_SNAP_HZ, REPLAY_MAX_FRAMES } from '../core/config.js';
import { game } from '../core/state.js';

export const replay = {
  frames: [],      // { t, ents, booms, rips }
  terrain: [],     // { t, known, fog, trail }
  duration: 0,
  recording: false,
  acc: 0,
  terrainAcc: 0
};

export function startRecording() {
  replay.frames = [];
  replay.terrain = [];
  replay.duration = 0;
  replay.acc = 0;
  replay.terrainAcc = 0;
  replay.recording = true;
}

export function stopRecording() {
  replay.recording = false;
  const last = replay.frames[replay.frames.length - 1];
  replay.duration = last ? last.t : 0;
}

export function clearRecording() {
  replay.frames = [];
  replay.terrain = [];
  replay.duration = 0;
  replay.recording = false;
}

/** 每帧调用（仅在 playing / countdown 阶段） */
export function record(dt) {
  if (!replay.recording) return;
  const t = game.elapsed;

  replay.acc += dt;
  replay.terrainAcc += dt;

  if (replay.acc >= 1 / REPLAY_HZ) {
    replay.acc = 0;
    if (replay.frames.length < REPLAY_MAX_FRAMES) replay.frames.push(snapshot(t));
  }

  if (replay.terrainAcc >= 1 / TERRAIN_SNAP_HZ) {
    replay.terrainAcc = 0;
    replay.terrain.push({
      t,
      known: game.unionKnown.slice(),
      fog: game.displayFog.slice(),
      trail: game.displayTrail.slice()
    });
  }
}

function snapshot(t) {
  return {
    t,
    ents: game.entities.map(e => ({
      x: e.x, y: e.y,
      fx: e.faceX, fy: e.faceY,
      team: e.teamId,
      pl: e.isPlayer ? e.playerIndex : -1,
      down: e.downed ? 1 : 0,
      arr: e.arrived ? 1 : 0,
      rt: e.respawnTimer,
      inv: e.invuln,
      st: e.scanTimer, sm: e.scanMax, sr: e.scanRadius,
      dft: e.defuseTimer, dfm: e.defuseMax,
      tx: e.defuseTarget ? e.defuseTarget.x : -1,
      ty: e.defuseTarget ? e.defuseTarget.y : -1,
      th: e.thinkTimer,
      bob: e.bob,
      pe: e.pendingExplosions.map(p => ({ x: p.x, y: p.y, timer: p.timer }))
    })),
    booms: game.explosions.map(x => ({ x: x.x, y: x.y, t: x.t, dur: x.dur, cells: x.cells })),
    rips: game.ripples.map(r => ({ x: r.x, y: r.y, t: r.t, dur: r.dur, maxR: r.maxR, color: r.color }))
  };
}
