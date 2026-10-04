/**
 * 回放页：独立的全屏页面（从结算面板进入，ESC 或「返回结算」退出）。
 *
 * 只负责「把录像放出来」：画布挂载、控制条（播放暂停 / 倍速 / 快进退 / 进度拖拽）、
 * 快捷键，以及退出去向（由 ui/flow 注入回调）。播放数据来自 sim/replay.js。
 */
import { CW, CH } from '../core/config.js';
import { render } from '../render/renderer.js';
import {
  playback, startPlayback, stopPlayback,
  togglePlay, setSpeed, seek, advance, buildScene
} from '../sim/replay.js';
import { showScreen } from './screens.js';

const STEP = 2;          // 快进 / 快退步长（秒）
const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

let ui = null;           // 挂载中的 DOM 引用集合，非空即代表回放页处于打开状态

/**
 * 打开回放页。
 * @param {object} o caption 顶部说明文案；onBack / onRestart / onMenu 三个退出去向
 * @returns {boolean} false 表示没有可回放的录像
 */
export function openReplay({ caption = '', onBack, onRestart, onMenu } = {}) {
  closeReplay();
  if (!startPlayback()) return false;

  const q = id => document.getElementById(id);
  const cv = q('replayCanvas');
  if (!cv) { stopPlayback(); return false; }

  cv.width = CW;
  cv.height = CH;

  ui = {
    cv,
    ctx: cv.getContext('2d'),
    play: q('rpPlay'),
    range: q('rpRange'),
    time: q('rpTime'),
    onBack: onBack || (() => {}),
    keydown: null
  };

  const capEl = q('rpCaption');
  if (capEl) capEl.textContent = caption;

  /* ── 控制条 ── */
  ui.play.onclick = () => syncPlayBtn(togglePlay());

  q('rpStepBack').onclick = () => jump(-STEP);
  q('rpStepFwd').onclick  = () => jump(STEP);

  document.querySelectorAll('#rpSpeed [data-speed]').forEach(b => {
    b.onclick = () => {
      setSpeed(parseFloat(b.dataset.speed));
      document.querySelectorAll('#rpSpeed [data-speed]').forEach(x => {
        x.classList.toggle('active', x === b);
      });
    };
  });

  ui.range.oninput = () => {
    seek((ui.range.value / 1000) * playback.duration);
    syncTime();
    draw();
  };

  q('rpBack').onclick    = () => ui.onBack();
  q('rpRestart').onclick = () => (onRestart || ui.onBack)();
  q('rpMenu').onclick    = () => (onMenu || ui.onBack)();

  cv.onclick = () => ui.play.onclick();

  /* ── 快捷键：空格播放暂停、左右快进退、ESC 返回 ── */
  ui.keydown = e => {
    if (e.code === 'Space') { e.preventDefault(); ui.play.onclick(); }
    else if (e.code === 'ArrowLeft')  { e.preventDefault(); jump(-STEP); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); jump(STEP); }
    else if (e.code === 'Escape')     { e.preventDefault(); ui.onBack(); }
  };
  window.addEventListener('keydown', ui.keydown);

  // 复位到上一次的播放状态
  document.querySelectorAll('#rpSpeed [data-speed]').forEach(x => {
    x.classList.toggle('active', parseFloat(x.dataset.speed) === playback.speed);
  });
  syncPlayBtn(playback.playing);
  syncTime();
  draw();

  showScreen('replayScreen');
  return true;
}

/** 关闭回放页：停止播放、解绑事件、清空引用 */
export function closeReplay() {
  if (ui && ui.keydown) window.removeEventListener('keydown', ui.keydown);
  stopPlayback();
  ui = null;
}

/** 回放页是否处于打开状态（主循环据此跳过对局画布的绘制） */
export function isReplayOpen() {
  return !!ui;
}

/** 每帧调用：推进播放头 → 刷新进度条 → 重绘 */
export function tickReplay(dt) {
  if (!ui || !playback.active) return;
  if (advance(dt)) syncRange();
  draw();
}

/* ── 内部 ── */

function jump(delta) {
  seek(playback.time + delta);
  syncRange();
  syncTime();
  draw();
}

function syncPlayBtn(playing) {
  if (!ui) return;
  ui.play.textContent = playing ? '⏸' : '▶';
  ui.play.classList.toggle('paused', !playing);
}

function syncRange() {
  if (!ui || playback.duration <= 0) return;
  ui.range.value = Math.round((playback.time / playback.duration) * 1000);
}

function syncTime() {
  if (ui) ui.time.textContent = `${fmt(playback.time)} / ${fmt(playback.duration)}`;
}

function draw() {
  if (!ui) return;
  const scene = buildScene(playback.time);
  if (scene) render(ui.ctx, scene);
}
