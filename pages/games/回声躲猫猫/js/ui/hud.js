/**
 * HUD 更新与提示条。
 * 元素引用来自 ui/dom.js，不在这里做 getElementById。
 */
import { NOISE_COOLDOWN } from '../core/config.js';
import { gstate, countAliveHiders } from '../core/state.js';
import { visualNowSec } from '../core/timer.js';
import { fmtTime } from '../core/utils.js';
import { getReplayFrameAt, getReplayState } from '../game/replay.js';
import { dom } from './dom.js';

/** 遮罩模式：'menu' | 'result' | 'hidden' */
export function setOverlayMode({ mode, minimized = false }) {
  dom.overlay.classList.toggle('hidden', mode === 'hidden');
  dom.overlay.classList.toggle('result', mode === 'result');
  dom.overlay.classList.toggle('minimized', mode === 'result' && minimized);
}

/* ---------- 提示条 ---------- */
let toastTimer = null;
export function showToast(text, duration = 1600) {
  dom.toast.textContent = text;
  dom.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('show'), duration);
}

/* ---------- 全屏 ---------- */
export function fullscreenIsActive() {
  return !!document.fullscreenElement;
}

export async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (err) {
    // 某些 file:// / 浏览器环境禁用 Fullscreen API，布局本身仍会自适应。
  }
}

export function updateFullscreenButton() {
  if (!dom.fullscreenBtn) return;
  dom.fullscreenBtn.textContent = fullscreenIsActive() ? '⛶ 退出全屏' : '⛶ 全屏';
}

/** 切换“上帝视角”角标的文案（观战 / 回放 / 结算）；内容不变时不碰 DOM */
let objectiveTextCache = '';
export function setObjectiveBadgeText(text) {
  if (text === objectiveTextCache) return;
  objectiveTextCache = text;
  dom.objectiveText.textContent = text;
}

/* ---------- HUD ---------- */
export function updateHUD() {
  const replay = getReplayState();
  const fmtReplayTime = sec => fmtTime(Math.max(0, sec || 0));

  dom.timeText.textContent = gstate.state === 'replay'
    ? fmtReplayTime(Math.max(0, replay.duration - replay.elapsed))
    : fmtTime(gstate.timeLeft);

  // 最后 20 秒开始闪烁，最后 10 秒闪烁更快、更醒目
  const inMatch = gstate.state === 'playing' || gstate.state === 'countdown';
  const warn = inMatch && gstate.timeLeft < 20;
  dom.timeText.classList.toggle('warn', warn);
  dom.timeText.classList.toggle('critical', warn && gstate.timeLeft < 10);

  dom.aliveText.textContent = gstate.hiders.length ? countAliveHiders() : gstate.cfgHiderCount;

  if (gstate.state === 'replay') {
    const frame = getReplayFrameAt(replay.elapsed);
    dom.aliveText.textContent = String(frame ? frame.entities.filter(e => e.type === 'hider' && e.alive).length : 0);
    dom.roleText.textContent = '🎞 回放';
    setObjectiveBadgeText('🎞 上帝视角 · 回放');
    dom.objectiveBadge.classList.add('show');
  } else {
    dom.roleText.textContent = gstate.player
      ? (gstate.player.type === 'seeker' ? '🔴 搜捕者' : '🟢 躲藏者') + (gstate.cfgPlayerCount === 2 ? ' · 双人' : '')
      : '—';
    // 观战（上帝视角）：玩家全部被抓后开启，结算阶段也保持显示
    const spectating = (gstate.spectator || gstate.state === 'over' || gstate.state === 'resultAnimation') && gstate.state !== 'menu';
    if (spectating) setObjectiveBadgeText('👁 上帝视角 · 观战中');
    dom.objectiveBadge.classList.toggle('show', spectating);
  }

  const p = gstate.player;
  if ((gstate.state === 'playing' || gstate.state === 'countdown') && p && p.isPlayer && !gstate.spectator) {
    dom.noiseMeter.style.visibility = 'visible';
    const cd = Math.max(0, (p.noiseCooldownUntil || 0) - visualNowSec());
    const ratio = cd <= 0 ? 1 : 1 - cd / NOISE_COOLDOWN;
    dom.noiseFill.style.width = (ratio * 100).toFixed(1) + '%';
    dom.noiseMeter.classList.toggle('ready', cd <= 0);
    dom.noiseMeter.classList.toggle('cooling', cd > 0);
  } else {
    dom.noiseMeter.style.visibility = 'hidden';
  }
}
