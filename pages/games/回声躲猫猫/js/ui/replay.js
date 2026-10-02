/**
 * 回放播放（表现层）。
 *
 * 录制在 sim/replay.js（纯数据），这里只管播放时钟与控制条 DOM。
 * 拆开的好处：将来联机客户端可以录制同一份数据，而服务端不需要 DOM。
 */
import { clamp } from '../core/utils.js';
import { gstate } from '../core/state.js';
import {
  replayDuration, getReplayFrameAt, interpolateReplayEntities, replayFrameCount
} from '../sim/replay.js';
import { setOverlayMode } from './hud.js';
import { dom } from './dom.js';

const playback = {
  elapsed: 0,
  playing: false
};

export function replayElapsed() {
  return playback.elapsed;
}

/** 进入回放模式 */
export function startReplay() {
  if (!replayFrameCount()) return;
  dom.overlay.classList.add('hidden');
  dom.overlay.classList.remove('result');
  dom.overlay.classList.remove('minimized');
  dom.pauseOverlay.classList.remove('show');
  dom.countdownOverlay.classList.remove('show');
  gstate.spectator = true;
  gstate.showGodView = true;
  gstate.state = 'replay';
  playback.elapsed = 0;
  playback.playing = true;
  dom.replayBar.classList.add('show');
  dom.exitReplayHudBtn.style.display = 'inline-flex';
  dom.replayRange.max = String(Math.max(0.01, replayDuration()));
  dom.replayRange.value = '0';
  dom.replayPlayBtn.textContent = '❚❚';
  syncReplayUI();
}

/** 退出回放，回到结算面板 */
export function exitReplay() {
  if (gstate.state !== 'replay') return;
  playback.playing = false;
  gstate.replayPlaying = false;
  gstate.state = 'over';
  gstate.spectator = true;
  gstate.showGodView = true;
  dom.replayBar.classList.remove('show');
  dom.exitReplayHudBtn.style.display = 'none';
  setOverlayMode({ mode: 'result' });
}

/** 推进回放时钟（主循环调用） */
export function replayTick(dt) {
  if (gstate.state !== 'replay' || !playback.playing) return;
  playback.elapsed += dt;
  if (playback.elapsed >= replayDuration()) {
    playback.elapsed = replayDuration();
    playback.playing = false;
    dom.replayPlayBtn.textContent = '▶';
  }
  syncReplayUI();
}

export function replayTogglePlay() {
  if (gstate.state !== 'replay') return;
  if (playback.elapsed >= replayDuration()) playback.elapsed = 0;
  playback.playing = !playback.playing;
  dom.replayPlayBtn.textContent = playback.playing ? '❚❚' : '▶';
  syncReplayUI();
}

/** 拖动进度条 */
export function seekReplay(t) {
  if (gstate.state !== 'replay') return;
  playback.elapsed = clamp(parseFloat(t) || 0, 0, replayDuration());
  playback.playing = false;
  dom.replayPlayBtn.textContent = '▶';
  syncReplayUI();
}

/** 回放当前帧（渲染层用） */
export function currentReplayFrame() {
  return getReplayFrameAt(playback.elapsed);
}

/** 回放实体（插值后，渲染层用） */
export function currentReplayEntities() {
  return interpolateReplayEntities(playback.elapsed);
}

/** 同步进度条与时间文本（顺便把播放进度写回 gstate，供 HUD 读取） */
export function syncReplayUI() {
  gstate.replayElapsed = playback.elapsed;
  gstate.replayPlaying = playback.playing;
  dom.replayRange.value = String(playback.elapsed);
  const fmt = sec => {
    const m = Math.floor(Math.max(0, sec || 0) / 60);
    const s = Math.floor(Math.max(0, sec || 0) % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };
  dom.replayTime.textContent = `${fmt(playback.elapsed)} / ${fmt(replayDuration())}`;
}
