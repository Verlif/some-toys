/**
 * 对局主循环：倒计时 → 玩家输入 → AI 更新 → 发声 → 声波推进 → 抓捕判定 → 结算。
 *
 * 这里是唯一的“游戏推进”入口，渲染与 UI 分别由 render / ui 层订阅状态完成。
 */
import { START_COUNTDOWN, SPECTATOR_GRACE, setWorldSize, CATCH_COOLDOWN } from '../core/config.js';
import { gstate, countAliveHiders, allHumanHidersDead } from '../core/state.js';
import { nowSec, beginPause, endPause } from '../core/timer.js';
import { buildEntities } from '../core/entities.js';
import { generateMap, forgetOpenCells } from '../world/map.js';
import { updateSeekerAI } from '../ai/seeker.js';
import { updateHiderAI } from '../ai/hider.js';
import { updateMovementSounds, updateSoundWaves } from '../audio/sound.js';
import { resetStats, setStat, bumpStat, addPlayerCatch } from './stats.js';
import { handlePlayerInput } from './input.js';
import {
  captureReplayFrame, setReplayStart, resetReplay
} from './replay.js';
import { dom } from '../ui/dom.js';
import { setOverlayMode, showToast, showCaughtNotice, clearCaughtNotice, resetTimeWarnings } from '../ui/hud.js';
import { showMenu } from '../ui/settings.js';
import { finishResultScreen, startResultAnimation } from '../ui/panels.js';

/* ============================================================
   暂停
============================================================ */
export function setPaused(p) {
  if (p === gstate.paused) return;
  if (p) {
    gstate.paused = true;
    beginPause();
    dom.pauseOverlay.classList.add('show');
  } else {
    gstate.paused = false;
    endPause();
    dom.pauseOverlay.classList.remove('show');
  }
}

/* ============================================================
   开局
============================================================ */
export function startGame(role) {
  if (gstate.cfgPlayerCount === 2) {
    if (role === 'seeker') gstate.cfgSeekerCount = Math.max(2, gstate.cfgSeekerCount);
    else gstate.cfgHiderCount = Math.max(2, gstate.cfgHiderCount);
  }

  // 地图尺寸必须先生效，generateMap 直接依赖 COLS / ROWS / WALL_COUNT
  setWorldSize(gstate.cfgMapSize);
  gstate.grid = generateMap();
  forgetOpenCells();
  buildEntities(role);

  gstate.soundWaves = [];
  gstate.wallMemoryMap = new Map();
  gstate.pendingGameEnd = null;
  gstate.timeLeft = gstate.cfgGameTime;
  gstate.spectator = false;
  gstate.showGodView = false;
  gstate.frozenRenderTime = null;
  gstate.resultAnimRemain = 0;
  gstate.resultAnimWinner = null;
  gstate.paused = false;
  dom.resultAnimation.classList.remove('show');
  dom.resultAnimation.innerHTML = '';
  dom.pauseOverlay.classList.remove('show');
  setOverlayMode({ mode: 'hidden' });
  dom.toast.classList.remove('show');
  clearCaughtNotice();
  resetTimeWarnings();
  resetReplay();

  resetStats(role, {
    hiderCount: gstate.cfgHiderCount,
    seekerCount: gstate.cfgSeekerCount,
    gameTime: gstate.cfgGameTime,
    playerCount: gstate.cfgPlayerCount
  });

  // 进入开局倒计时
  gstate.state = 'countdown';
  gstate.countdownRemain = START_COUNTDOWN;
  dom.countdownNum.textContent = Math.ceil(gstate.countdownRemain);

  const seekerMsg = gstate.cfgSeekerCount === 1 ? '1 名搜捕者' : `${gstate.cfgSeekerCount} 名搜捕者`;
  const hiderMsg = `${gstate.cfgHiderCount} 名躲藏者`;
  const mapMsg = { small: '小地图', medium: '中地图', large: '大地图' }[gstate.cfgMapSize];
  dom.countdownMsg.textContent = role === 'seeker'
    ? `找出所有躲藏者！(${seekerMsg} · ${hiderMsg} · ${mapMsg})`
    : `藏好，别被抓到！(${seekerMsg} · ${hiderMsg} · ${mapMsg})`;

  dom.countdownOverlay.classList.add('show');
}

/* ============================================================
   每帧推进
============================================================ */
export function update(dt) {
  if (gstate.state === 'countdown') {
    gstate.countdownRemain -= dt;
    if (gstate.countdownRemain <= 0) {
      gstate.state = 'playing';
      // 必须先记录对局起点：captureReplayFrame 以 replayGameStartSec 为基准
      setReplayStart(nowSec());
      captureReplayFrame(true);
      dom.countdownOverlay.classList.remove('show');
    } else {
      const n = Math.ceil(gstate.countdownRemain);
      if (dom.countdownNum.textContent !== String(n)) {
        dom.countdownNum.textContent = n;
      }
    }
    return;
  }

  gstate.timeLeft -= dt;
  const timeUp = gstate.timeLeft <= 0;
  if (timeUp) gstate.timeLeft = 0;

  if (!gstate.spectator && gstate.players.length) handlePlayerInput(dt);

  for (const e of gstate.entities) {
    if (e.isPlayer && !gstate.spectator) continue;
    if (e.type === 'seeker') updateSeekerAI(e, dt);
    else if (e.alive) updateHiderAI(e, dt);
  }

  updateMovementSounds(dt);
  updateSoundWaves(dt);
  resolveCatches();

  const aliveCount = countAliveHiders();
  setStat('hidersAlive', aliveCount);
  captureReplayFrame(false);

  if (aliveCount === 0) {
    if (!gstate.pendingGameEnd) {
      const grace = gstate.spectator ? SPECTATOR_GRACE : 0;
      gstate.pendingGameEnd = { winner: 'seeker', at: nowSec() + grace };
    }
  } else if (timeUp) {
    endGame('hiders');
    return;
  }

  if (gstate.pendingGameEnd && nowSec() >= gstate.pendingGameEnd.at) {
    const w = gstate.pendingGameEnd.winner;
    gstate.pendingGameEnd = null;
    endGame(w);
  }
}

/**
 * 搜捕者碰到躲藏者即淘汰。
 *
 * 刚抓到人的搜捕者会进入短暂「抓捕冷却」，冷却期间不能再抓下一个人；
 * 冷却进度条只对搜捕者阵营显示（见 ui/hud.js）。
 *
 * 玩家侧（单人 1 名 / 双人 2 名，均属同一阵营）只要**所有**玩家都被抓，
 * 立即转入上帝视角观战，继续看 AI 打完剩下的对局。
 */
function resolveCatches() {
  const nowT = nowSec();
  const caughtThisFrame = new Set();

  for (const h of gstate.hiders) {
    if (!h.alive) continue;
    for (const s of gstate.seekers) {
      if (s.catchCooldownUntil > nowT) continue;              // 冷却中，抓不到人
      if (Math.hypot(s.x - h.x, s.y - h.y) >= s.r + h.r + 2) continue;

      h.alive = false;
      caughtThisFrame.add(h);
      s.catchCooldownUntil = nowT + CATCH_COOLDOWN;
      bumpStat('hidersCaught');
      // 记录是「哪位玩家」抓到的（AI 得手时不记）
      const catcherIndex = gstate.players.indexOf(s);
      if (catcherIndex >= 0) addPlayerCatch(catcherIndex);
      notifyHiderCaught(h);
      break;
    }
  }

  // 同一帧内可能有多人被淘汰（多个搜捕者同时得手），人数统计在结算前统一刷新
  if (caughtThisFrame.size > 0) setStat('hidersAlive', countAliveHiders());
}

/**
 * 躲藏者被淘汰时的画面提示。
 * 所有躲藏者（含 AI 队友）被抓都会提示，让玩家随时知道还剩几个人。
 */
function notifyHiderCaught(h) {
  const total = gstate.cfgHiderCount;
  const remain = countAliveHiders();

  // 低透明度横幅，不遮挡也基本不干扰对局
  showCaughtNotice(remain > 0 ? `躲藏者被抓捕 · 剩余 ${remain} 人` : '躲藏者已被全部抓捕', remain, total);

  if (h.isPlayer && !gstate.spectator) {
    const aliveHumanHiders = gstate.players.filter(p => p.type === 'hider' && p.alive).length;
    if (aliveHumanHiders === 0) gstate.spectator = true;
    if (gstate.cfgPlayerCount === 1) showToast('你被抓住了！');
    else showToast(aliveHumanHiders === 0 ? '你们都被抓住了！' : '一名玩家被抓住了！');
  }
}

/* ============================================================
   结算入口
============================================================ */
export function endGame(winner) {
  startResultAnimation(winner);
}

export function updateResultAnimation(dt) {
  if (gstate.state !== 'resultAnimation') return;
  gstate.resultAnimRemain -= dt;
  if (gstate.resultAnimRemain <= 0) finishResultScreen(gstate.resultAnimWinner);
}

/* ============================================================
   重开 / 返回菜单
============================================================ */
export function restartGame() {
  setPaused(false);
  startGame(gstate.selectedRole);
}

export function backToMenu() {
  setPaused(false);
  showMenu();
}

export { allHumanHidersDead };
