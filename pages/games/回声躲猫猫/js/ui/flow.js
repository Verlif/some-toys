/**
 * 对局流程的表现层：遮罩、提示、结算。
 *
 * 模拟层（sim/simulation.js）只发事件，这里负责把事件变成画面：
 *   MATCH_START   → 开局倒计时遮罩
 *   HIDER_CAUGHT  → 低透明度横幅 + 玩家 toast
 *   ITEM_PICKUP   → 道具提示
 *   MATCH_END     → 结果动画 → 结算面板
 *
 * 这样将来联机时，客户端收到的广播事件走的是同一批处理逻辑。
 */
import { START_COUNTDOWN, ITEM_TYPES } from '../core/config.js';
import { gstate } from '../core/state.js';
import { on, EVT } from '../core/events.js';
import { setSimPaused, startMatch } from '../sim/simulation.js';
import { resetTimeBase, nowSec } from '../core/timer.js';
import { dom } from './dom.js';
import {
  setOverlayMode, showToast, showCaughtNotice, clearCaughtNotice, resetTimeWarnings
} from './hud.js';
import { startResultAnimation, finishResultScreen, setResultActions } from './panels.js';
import { showMenu } from './settings.js';
import { startReplay, exitReplay, replayTick } from './replay.js';
import { registerActions } from './actions.js';

let bound = false;

/* ============================================================
   暂停
   ============================================================ */
export function setPaused(paused) {
  if (paused === gstate.paused) return;
  setSimPaused(paused);
  dom.pauseOverlay.classList.toggle('show', paused);
}

export function togglePause() {
  if (gstate.state === 'playing') setPaused(!gstate.paused);
  else if (gstate.state === 'replay') exitReplay();
}

/* ============================================================
   开局 / 重开 / 返回菜单
   ============================================================ */
export function startGame(role) {
  setPaused(false);
  resetTimeBase();

  // 先把界面恢复干净，再让模拟层开局（MATCH_START 事件会亮起倒计时）
  dom.resultAnimation.classList.remove('show');
  dom.resultAnimation.innerHTML = '';
  dom.pauseOverlay.classList.remove('show');
  dom.toast.classList.remove('show');
  clearCaughtNotice();
  resetTimeWarnings();
  dom.replayBar.classList.remove('show');
  dom.exitReplayHudBtn.style.display = 'none';
  setOverlayMode({ mode: 'hidden' });

  startMatch(role);

  const seekerMsg = gstate.cfgSeekerCount === 1 ? '1 名搜捕者' : `${gstate.cfgSeekerCount} 名搜捕者`;
  const hiderMsg = `${gstate.cfgHiderCount} 名躲藏者`;
  const mapMsg = { small: '小地图', medium: '中地图', large: '大地图' }[gstate.cfgMapSize];
  dom.countdownMsg.textContent = role === 'seeker'
    ? `找出所有躲藏者！(${seekerMsg} · ${hiderMsg} · ${mapMsg})`
    : `藏好，别被抓到！(${seekerMsg} · ${hiderMsg} · ${mapMsg})`;
  dom.countdownNum.textContent = Math.ceil(START_COUNTDOWN);
  dom.countdownOverlay.classList.add('show');
}

export function restartGame() {
  startGame(gstate.selectedRole);
}

export function backToMenu() {
  setPaused(false);
  showMenu();
}

/* ============================================================
   每帧表现更新
   ============================================================ */
export function updateFlow(dt) {
  // 倒计时数字
  if (gstate.state === 'countdown') {
    const n = Math.ceil(gstate.countdownRemain);
    const text = String(Math.max(0, n));
    if (dom.countdownNum.textContent !== text) dom.countdownNum.textContent = text;
  }

  // 结果动画 → 结算面板
  if (gstate.state === 'resultAnimation') {
    gstate.resultAnimRemain -= dt;
    if (gstate.resultAnimRemain <= 0) finishResultScreen(gstate.resultAnimWinner);
  }
}

/* ============================================================
   事件绑定
   ============================================================ */
export function bindFlow() {
  if (bound) return;
  bound = true;

  registerActions({
    startGame,
    openMenu: backToMenu,
    togglePause,
    startReplay,
    exitReplay
  });

  setResultActions({
    onReplay: startReplay,
    onRestart: () => startGame(gstate.selectedRole),
    onMenu: showMenu
  });

  on(EVT.COUNTDOWN_END, () => {
    dom.countdownOverlay.classList.remove('show');
  });

  on(EVT.HIDER_CAUGHT, ({ remain, total, hider, isPlayer }) => {
    showCaughtNotice(
      remain > 0 ? `躲藏者被抓捕 · 剩余 ${remain} 人` : '躲藏者已被全部抓捕',
      remain
    );
    if (!isPlayer) return;
    const aliveHumanHiders = gstate.players.filter(p => p.type === 'hider' && p.alive).length;
    if (gstate.cfgPlayerCount === 1) showToast('你被抓住了！');
    else showToast(aliveHumanHiders === 0 ? '你们都被抓住了！' : '一名玩家被抓住了！');
    void total; void hider;
  });

  on(EVT.ITEM_PICKUP, ({ item, holder, type }) => {
    if (!holder?.isPlayer) return;
    const t = type || ITEM_TYPES[item.type];
    showToast(`${t.icon} 你捡到了「${t.name}」 · ${t.desc}`, 2000);
  });

  on(EVT.ITEM_EFFECT, ({ holder, type }) => {
    // 敌方道具生效时提示玩家（自己捡的已经在 ITEM_PICKUP 提示过）
    if (holder?.isPlayer) return;
    if (!gstate.player) return;
    if (holder && holder.type === gstate.player.type) return;   // 队友捡的，不打扰
    const t = type || ITEM_TYPES[type?.id];
    if (t) showToast(`⚠ 对手发动了「${t.name}」`, 1800);
  });

  on(EVT.MATCH_END, ({ winner }) => {
    startResultAnimation(winner);
  });

  on(EVT.NET_STATE, ({ message }) => {
    if (message) showToast(message, 2200);
  });
}

export { replayTick, nowSec };
