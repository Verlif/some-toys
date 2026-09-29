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

  // 结果导向：标题讲胜负，副标题一句话说清“怎么赢的”
  let title, desc, outcomeCls;
  if (winner === 'seeker') {
    title = playerRole === 'seeker' ? '你赢了' : '搜捕者获胜';
    desc = '躲藏者全部落网';
    outcomeCls = playerWon ? 'win' : 'lose';
  } else {
    title = playerRole === 'hider' ? '你赢了' : '躲藏者获胜';
    desc = '时间结束，仍有人没被找到';
    outcomeCls = playerWon ? 'win' : 'lose';
  }
  if (playerRole === 'hider' && gstate.player && !gstate.player.alive) {
    title = gstate.cfgPlayerCount === 1
      ? '你被抓住了'
      : (winner === 'hiders' ? '你被抓了，队友赢了' : '你们都被抓住了');
    desc = winner === 'hiders' ? '队友坚持到了时间结束' : '躲藏者全部落网';
  }

  const s = gstate.stats;
  const caught = s.hidersCaught;
  const survived = Math.max(0, s.hidersAlive);
  const total = s.totalHiders;

  // 个人高光：把最能说明“你干了什么”的数字放大
  const highlights = [];
  if (playerRole === 'seeker') {
    const catches = s.playerCatchCounts || [];
    if (gstate.cfgPlayerCount === 2) {
      highlights.push({ label: 'P1 抓捕', value: catches[0] || 0 });
      highlights.push({ label: 'P2 抓捕', value: catches[1] || 0 });
    } else {
      highlights.push({ label: '你的抓捕', value: catches[0] || 0 });
    }
    highlights.push({ label: '你探测到躲藏者', value: s.playerDetectedEnemy });
  } else {
    highlights.push({ label: '你的状态', value: playerAlive ? '存活' : '被抓', text: true });
    highlights.push({ label: '被探测次数', value: s.playerDetectedByEnemy });
  }
  highlights.push({ label: '你制造噪声', value: s.playerNoiseCount });

  const rows = [
    { key: '游戏时长', val: fmtTime(s.gameTimeTotal), cls: '' },
    { key: '玩家模式', val: gstate.cfgPlayerCount === 2 ? '双人同阵营' : '单人', cls: '' },
    { key: '追捕者 / 躲藏者', val: `${s.totalSeekers} / ${s.totalHiders}`, cls: '' },
    { key: '你的身份', val: playerRole === 'seeker' ? '🔴 搜捕者' : '🟢 躲藏者', cls: '' },
    { key: '你发声音波次数', val: `${s.playerSoundCount}`, cls: '' }
  ];

  if (gstate.cfgPlayerCount === 2) {
    const aliveP = p => p && (p.type === 'seeker' || p.alive);
    rows.push({ key: '玩家1状态', val: aliveP(gstate.players[0]) ? '存活' : '被抓', cls: aliveP(gstate.players[0]) ? 'good' : 'bad' });
    rows.push({ key: '玩家2状态', val: aliveP(gstate.players[1]) ? '存活' : '被抓', cls: aliveP(gstate.players[1]) ? 'good' : 'bad' });
  }

  dom.panel.innerHTML = `
    <div class="result-hero ${outcomeCls}">
      <h1 class="result-verdict">${title}</h1>
      <p class="result-desc">${desc}</p>
    </div>

    <div class="result-board">
      <div class="board-col">
        <span class="board-num bad">${caught}<i>/${total}</i></span>
        <span class="board-cap">躲藏者被抓</span>
      </div>
      <div class="board-div"></div>
      <div class="board-col">
        <span class="board-num good">${survived}<i>/${total}</i></span>
        <span class="board-cap">躲藏者存活</span>
      </div>
    </div>

    <div class="result-highlights">
      ${highlights.map(h => `
        <div class="highlight">
          <span class="hl-val">${h.value}</span>
          <span class="hl-cap">${h.label}</span>
        </div>
      `).join('')}
    </div>

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
