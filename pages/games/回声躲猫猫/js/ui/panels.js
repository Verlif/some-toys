/**
 * 结算面板与结果动画。
 *
 * 流程：endGame(winner) → 结果动画（1.9s，冻结画面）→ 结算面板（可最小化）。
 */
import { fmtTime } from '../core/utils.js';
import { gstate } from '../core/state.js';
import { nowSec } from '../core/timer.js';
import { captureReplayFrame, startReplay } from '../game/replay.js';
import { startGame } from '../game/main.js';
import { showMenu } from './settings.js';
import { setOverlayMode } from './hud.js';
import { dom } from './dom.js';

/* ============================================================
   结果动画
============================================================ */
export function startResultAnimation(winner) {
  if (gstate.state === 'over' || gstate.state === 'replay' || gstate.state === 'resultAnimation') return;
  captureReplayFrame(true);
  gstate.frozenRenderTime = nowSec();
  gstate.pendingGameEnd = null;
  gstate.showGodView = true;
  gstate.spectator = true;
  if (gstate.paused) { gstate.paused = false; dom.pauseOverlay.classList.remove('show'); }
  dom.countdownOverlay.classList.remove('show');
  gstate.state = 'resultAnimation';
  gstate.resultAnimWinner = winner;
  gstate.resultAnimRemain = 1.9;

  const playerRole = gstate.player ? gstate.player.type : 'hider';
  const playerAlive = playerRole === 'seeker' ? true : !!gstate.player?.alive;
  const playerWon = (playerRole === 'seeker' && winner === 'seeker') || (playerRole === 'hider' && winner === 'hiders');
  let title = playerWon ? '你赢了' : '你输了';
  if (gstate.cfgPlayerCount === 2 && !playerAlive && winner === 'hiders') title = '你被抓了';
  let icon = playerWon ? '✦' : '✕';
  if (gstate.cfgPlayerCount === 1 && playerRole === 'hider' && !playerAlive) { title = '你被抓住了'; icon = '☠'; }
  const sub = winner === 'seeker' ? '搜捕者锁定目标，游戏结束' : '倒计时结束，躲藏者成功生存';

  dom.resultAnimation.innerHTML = `
    <div class="result-burst ${playerWon ? 'win' : 'lose'}">
      <div class="ring"></div><div class="ring r2"></div><div class="ring r3"></div>
      <div class="glyph">${icon}</div>
      <h2>${title}</h2>
      <p>${sub}</p>
    </div>`;
  setOverlayMode({ mode: 'hidden' });
  dom.resultAnimation.classList.add('show');
}

/* ============================================================
   结算面板
============================================================ */
export function finishResultScreen(winner) {
  gstate.state = 'over';
  gstate.pendingGameEnd = null;
  gstate.showGodView = true;
  dom.resultAnimation.classList.remove('show');
  dom.resultAnimation.innerHTML = '';

  const playerRole = gstate.player ? gstate.player.type : 'hider';
  const playerAlive = playerRole === 'seeker' ? true : !!gstate.player?.alive;
  const playerWon =
    (playerRole === 'seeker' && winner === 'seeker') ||
    (playerRole === 'hider' && winner === 'hiders');

  let title, desc;
  if (winner === 'seeker') {
    title = playerRole === 'seeker' ? '🎉 你赢了！' : '💀 搜捕者获胜';
    desc  = '所有躲藏者都被抓住了';
  } else {
    title = playerRole === 'hider' ? '🎉 躲藏者胜利！' : '⏰ 时间到';
    desc  = '时间耗尽，仍有躲藏者没被找到';
  }
  if (playerRole === 'hider' && gstate.player && !gstate.player.alive) {
    title = (gstate.cfgPlayerCount === 1)
      ? '💀 你被抓住了'
      : (winner === 'hiders' ? '😅 你被抓了，但队友赢了' : '💀 你们被抓住了');
    desc = winner === 'hiders' ? '时间耗尽，其他躲藏者成功逃脱' : '搜捕者抓住了所有躲藏者';
  }

  const s = gstate.stats;
  const rows = [
    { key: '游戏时长', val: fmtTime(s.gameTimeTotal), cls: '' },
    { key: '玩家模式', val: gstate.cfgPlayerCount === 2 ? '双人同阵营' : '单人', cls: '' },
    { key: '追捕者 / 躲藏者', val: `${s.totalSeekers} / ${s.totalHiders}`, cls: '' },
    { key: '你的身份', val: playerRole === 'seeker' ? '🔴 搜捕者' : '🟢 躲藏者', cls: '' },
    { key: '你的状态', val: playerAlive ? '存活' : '被抓', cls: playerAlive ? 'good' : 'bad' },
    { key: '躲藏者被抓', val: `${s.hidersCaught} / ${s.totalHiders}`, cls: 'bad' },
    { key: '躲藏者存活', val: `${s.hidersAlive} / ${s.totalHiders}`, cls: 'good' },
    { key: '你发声音波次数', val: `${s.playerSoundCount}`, cls: '' },
    { key: '你使用噪声次数', val: `${s.playerNoiseCount}`, cls: '' }
  ];

  if (playerRole === 'seeker') {
    rows.push({ key: '你探测到躲藏者', val: `${s.playerDetectedEnemy} 次`, cls: 'good' });
  } else {
    rows.push({ key: '你被追捕者探测', val: `${s.playerDetectedByEnemy} 次`, cls: s.playerDetectedByEnemy > 0 ? 'bad' : 'good' });
  }

  if (gstate.cfgPlayerCount === 2) {
    const aliveP = p => p && (p.type === 'seeker' || p.alive);
    rows.push({ key: '玩家1状态', val: aliveP(gstate.players[0]) ? '存活' : '被抓', cls: aliveP(gstate.players[0]) ? 'good' : 'bad' });
    rows.push({ key: '玩家2状态', val: aliveP(gstate.players[1]) ? '存活' : '被抓', cls: aliveP(gstate.players[1]) ? 'good' : 'bad' });
  }

  const color = playerWon ? '#7fffc4' : '#ff8fa3';
  dom.panel.innerHTML = `
    <h1 style="background:linear-gradient(120deg,${color},#a98bff);-webkit-background-clip:text;background-clip:text;color:transparent;font-size: clamp(20px,3.2vw,34px);">${title}</h1>
    <p class="sub">${desc}</p>
    <div class="result-stats">
      ${rows.map(r => `
        <div class="stat-row">
          <span class="stat-key">${r.key}</span>
          <span class="stat-val ${r.cls}">${r.val}</span>
        </div>
      `).join('')}
    </div>
    <button class="btn again" id="replayBtn">🎞 &nbsp;观看整场回放</button>
    <button class="btn again" id="againBtn">再来一局</button>
    <button class="btn secondary" id="menuBtn">返回菜单</button>
  `;
  setOverlayMode({ mode: 'result' });
  dom.resultMinBtn.textContent = '— 收起结算';

  document.getElementById('replayBtn').addEventListener('click', () => startReplay());
  document.getElementById('againBtn').addEventListener('click', () => startGame(gstate.selectedRole));
  document.getElementById('menuBtn').addEventListener('click', showMenu);
}

/* ============================================================
   结算面板最小化
============================================================ */
export function bindResultMinimize() {
  dom.resultMinBtn.addEventListener('click', () => {
    if (gstate.state !== 'over') return;
    const minimized = dom.overlay.classList.toggle('minimized');
    dom.resultMinBtn.textContent = minimized ? '+ 显示结算' : '— 收起结算';
  });
}
