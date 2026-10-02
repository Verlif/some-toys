/**
 * HUD 更新与提示条。
 * 元素引用来自 ui/dom.js，不在这里做 getElementById。
 */
import { NOISE_COOLDOWN, CATCH_COOLDOWN } from '../core/config.js';
import { gstate, countAliveHiders } from '../core/state.js';
import { visualNowSec } from '../core/timer.js';
import { fmtTime } from '../core/utils.js';
import { frozenRemain, hasteRemain, revealRemain } from '../core/status.js';
import { getReplayFrameAt, replayDuration } from '../sim/replay.js';
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

export function hideToast() {
  clearTimeout(toastTimer);
  dom.toast.classList.remove('show');
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

/* ---------- 躲藏者被抓的提示横幅 ---------- */
let noticeTimer = null;

/**
 * 低透明度提示：谁被抓了、还剩几个躲藏者。
 * 所有躲藏者（含 AI 队友）被抓都会提示，玩家随时知道剩余人数。
 */
export function showCaughtNotice(text, remain) {
  // 结构可能被上游改动，取不到子节点时退回按需查询，避免整局崩在这里
  const mainEl = dom.caughtNoticeMain || dom.caughtNotice.querySelector('.cn-main');
  const subEl = dom.caughtNoticeSub || dom.caughtNotice.querySelector('.cn-sub');
  if (mainEl) mainEl.textContent = text;
  if (subEl) subEl.textContent = remain > 0 ? `剩余躲藏者 ${remain} 人` : '所有躲藏者已被抓捕';
  dom.caughtNotice.classList.add('show');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => dom.caughtNotice.classList.remove('show'), 2400);
}

export function clearCaughtNotice() {
  clearTimeout(noticeTimer);
  dom.caughtNotice.classList.remove('show');
}

/* ---------- 技能冷却条 ---------- */
/**
 * 一个玩家的全部技能冷却。
 *
 * 搜捕者有两个技能：抓捕（抓到人后的冷却）与噪声；
 * 躲藏者只有噪声。把技能都列出来，就不会再出现“按了空格却看不到任何变化”
 * 的情况——按哪个键，就一定有对应的一条在动。
 */
function playerSkills(p) {
  const nowT = visualNowSec();
  const noiseCd = Math.max(0, (p.noiseCooldownUntil || 0) - nowT);
  const skills = [];
  if (p.type === 'seeker') {
    const catchCd = Math.max(0, (p.catchCooldownUntil || 0) - nowT);
    skills.push({
      key: 'catch', name: '抓捕',
      cd: catchCd, total: CATCH_COOLDOWN,
      ratio: catchCd <= 0 ? 1 : 1 - catchCd / CATCH_COOLDOWN,
      hint: '抓到人后'
    });
  }
  const noiseTotal = p.isPlayer ? NOISE_COOLDOWN : NOISE_AI_MIN_INTERVAL;
  skills.push({
    key: 'noise', name: '噪声',
    cd: noiseCd, total: noiseTotal,
    ratio: noiseCd <= 0 ? 1 : 1 - noiseCd / noiseTotal,
    hint: p.type === 'seeker' ? '空格 / Enter' : '空格 / Enter'
  });
  return skills;
}

function skillRowHtml(skill) {
  const ready = skill.cd <= 0;
  return `<div class="skill-row ${ready ? 'ready' : ''}">
      <span class="skill-name">${skill.name}</span>
      <span class="skill-timer">${ready ? '就绪' : skill.cd.toFixed(1) + 's'}</span>
      <div class="bar"><div class="fill" style="width:${(skill.ratio * 100).toFixed(1)}%"></div></div>
      <span class="skill-hint">${skill.hint}</span>
    </div>`;
}

function skillBarHtml(p, index) {
  return `<div class="skill-cd p${index + 1}">
      <div class="skill-head"><span class="skill-label">P${index + 1}</span></div>
      ${playerSkills(p).map(skillRowHtml).join('')}
    </div>`;
}

/**
 * 双人模式的左右技能条。
 *
 * 这里刻意不做“值没变就跳过写入”的缓存优化：整块 DOM 只有两个小条，
 * 每帧重建的开销可以忽略，但能保证显示值与状态永远一致——
 * 不会再出现“按了空格却看不到进度条变化”这类缓存不同步的问题。
 */
function updateSkillCooldowns(active) {
  if (!active) {
    if (dom.skillCooldowns.classList.contains('show')) {
      dom.skillCooldowns.classList.remove('show');
      dom.skillCooldowns.innerHTML = '';
    }
    return;
  }

  dom.skillCooldowns.classList.add('show');
  const list = gstate.players.slice(0, 2);
  const html = list.map((p, i) => skillBarHtml(p, i)).join('');
  if (dom.skillCooldowns.innerHTML !== html) dom.skillCooldowns.innerHTML = html;
}

/* ---------- 剩余时间的居中提示 ---------- */
const TIME_WARN_THRESHOLDS = [30, 20, 10];
let firedTimeWarnings = new Set();
let timeWarnTimer = null;

function hideTimeWarning() {
  clearTimeout(timeWarnTimer);
  dom.hudWarn.classList.remove('show');
}

/**
 * 剩余时间跌破 30 / 20 / 10 秒时，在画面中心闪出**纯数字**提示。
 * 每局每个档位只提示一次；重开一局会重置。
 */
function updateTimeWarnings(inMatch) {
  if (!inMatch) return;
  const t = gstate.timeLeft;
  for (const mark of TIME_WARN_THRESHOLDS) {
    if (t > mark || t <= 0 || firedTimeWarnings.has(mark)) continue;
    firedTimeWarnings.add(mark);
    dom.hudWarn.textContent = String(mark);   // 只显示数字
    dom.hudWarn.classList.toggle('ten', mark <= 10);
    dom.hudWarn.classList.add('show');
    clearTimeout(timeWarnTimer);
    // 时间越少，停留越短，避免占着画面中心
    timeWarnTimer = setTimeout(hideTimeWarning, mark <= 10 ? 620 : 800);
  }
}

export function resetTimeWarnings() {
  firedTimeWarnings = new Set();
  hideTimeWarning();
}

/* ---------- 状态条：道具倒计时 + 自身效果 ---------- */
function updateStatusItem(active) {
  if (!dom.statusItem) return;
  if (!active) {
    if (dom.statusItem.style.display !== 'none') dom.statusItem.style.display = 'none';
    return;
  }
  const parts = [];
  if (gstate.items.length) parts.push(`🎁 场上 ${gstate.items.length}`);
  parts.push(`下一个道具 ${Math.max(0, Math.ceil(gstate.itemTimer))}s`);
  const p = gstate.player;
  if (p) {
    const fr = frozenRemain(p);
    if (fr > 0) parts.push(`❄ 定格 ${fr.toFixed(1)}s`);
    const ha = hasteRemain(p);
    if (ha > 0) parts.push(`⚡ 加速 ${ha.toFixed(1)}s`);
    const rv = revealRemain(p);
    if (rv > 0) parts.push(`👁 显形 ${rv.toFixed(1)}s`);
  }
  const text = parts.join(' · ');
  if (dom.statusText.textContent !== text) dom.statusText.textContent = text;
  if (dom.statusItem.style.display === 'none') dom.statusItem.style.display = '';
}

/* ---------- HUD ---------- */
export function updateHUD() {
  const replayElapsed = gstate.replayElapsed || 0;
  const fmtReplayTime = sec => fmtTime(Math.max(0, sec || 0));

  dom.timeText.textContent = gstate.state === 'replay'
    ? fmtReplayTime(Math.max(0, replayDuration() - replayElapsed))
    : fmtTime(gstate.timeLeft);

  // 最后 20 秒开始闪烁，最后 10 秒闪烁更快、更醒目
  const inMatch = gstate.state === 'playing' || gstate.state === 'countdown';
  const warn = inMatch && gstate.timeLeft < 20;
  dom.timeText.classList.toggle('warn', warn);
  dom.timeText.classList.toggle('critical', warn && gstate.timeLeft < 10);

  // 30 / 20 / 10 秒的居中提示
  updateTimeWarnings(inMatch);

  dom.aliveText.textContent = gstate.hiders.length ? countAliveHiders() : gstate.cfgHiderCount;

  if (gstate.state === 'replay') {
    const frame = getReplayFrameAt(replayElapsed);
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
  const clock = visualNowSec();
  const canShowMeters = inMatch && p && p.isPlayer && !gstate.spectator;
  const dual = gstate.cfgPlayerCount === 2;

  // 双人模式下两个玩家各自的技能冷却条显示在画面左右，HUD 里就不再重复
  updateSkillCooldowns(canShowMeters && dual);

  // 道具倒计时 / 自身状态
  updateStatusItem(inMatch && !gstate.spectator);

  // 噪声冷却（P1）
  if (canShowMeters && !dual) {
    dom.noiseMeter.style.visibility = 'visible';
    const cd = Math.max(0, (p.noiseCooldownUntil || 0) - clock);
    const ratio = cd <= 0 ? 1 : 1 - cd / NOISE_COOLDOWN;
    dom.noiseFill.style.width = (ratio * 100).toFixed(1) + '%';
    dom.noiseMeter.classList.toggle('ready', cd <= 0);
    dom.noiseMeter.classList.toggle('cooling', cd > 0);
  } else {
    dom.noiseMeter.style.visibility = 'hidden';
  }

  // 抓捕冷却：只有搜捕者阵营看得见
  if (canShowMeters && p.type === 'seeker' && !dual) {
    dom.catchMeter.style.visibility = 'visible';
    const cd = Math.max(0, (p.catchCooldownUntil || 0) - clock);
    const ratio = cd <= 0 ? 1 : 1 - cd / CATCH_COOLDOWN;
    dom.catchFill.style.width = (ratio * 100).toFixed(1) + '%';
    dom.catchMeter.classList.toggle('ready', cd <= 0);
    dom.catchMeter.classList.toggle('cooling', cd > 0);
  } else {
    dom.catchMeter.style.visibility = 'hidden';
  }
}
