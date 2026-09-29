/**
 * 菜单与设置面板。
 *
 * 面板内容直接写进 #panel，按钮用事件委托绑定，
 * 每次渲染都重建，因此不需要额外的状态同步逻辑。
 */
import {
  DEFAULT_GAME_TIME, DEFAULT_SEEKER_COUNT, DEFAULT_HIDER_COUNT,
  DEFAULT_PLAYER_COUNT, DEFAULT_MAP_SIZE, DEFAULT_ROLE
} from '../core/config.js';
import { gstate } from '../core/state.js';
import { resetTimeBase } from '../core/timer.js';
import { fmtTime } from '../core/utils.js';
import { resetReplay } from '../game/replay.js';
import { startGame } from '../game/main.js';
import { setOverlayMode, clearCaughtNotice, resetTimeWarnings } from './hud.js';
import { dom } from './dom.js';

const MAP_LABELS = { small: '小', medium: '中', large: '大' };

const TIME_OPTIONS = [
  { v: 30,  label: '30秒' },
  { v: 60,  label: '1分' },
  { v: 120, label: '2分' },
  { v: 180, label: '3分' },
  { v: 300, label: '5分' }
];

/* ============================================================
   主菜单
============================================================ */
export function showMenu() {
  gstate.state = 'menu';
  gstate.spectator = false;
  gstate.showGodView = false;
  gstate.timeLeft = gstate.cfgGameTime;
  gstate.grid = null;
  gstate.openCells = null;
  gstate.entities = [];
  gstate.seekers = [];
  gstate.hiders = [];
  gstate.player = null;
  gstate.players = [];
  gstate.soundWaves = [];
  gstate.wallMemoryMap = new Map();
  gstate.pendingGameEnd = null;
  gstate.frozenRenderTime = null;
  gstate.resultAnimRemain = 0;
  gstate.resultAnimWinner = null;
  dom.resultAnimation.classList.remove('show');
  dom.resultAnimation.innerHTML = '';
  resetReplay();

  if (gstate.paused) { gstate.paused = false; dom.pauseOverlay.classList.remove('show'); }
  dom.countdownOverlay.classList.remove('show');
  clearCaughtNotice();
  resetTimeWarnings();
  resetTimeBase();

  dom.panel.innerHTML = `
    <h1>回 声 躲 猫 猫</h1>
    <p class="sub">全黑世界 · 只靠声波感知 · 智能 AI 对手</p>
    <button class="btn seeker" data-role="seeker">🔴 &nbsp;我要当搜捕者</button>
    <button class="btn hider"  data-role="hider">🟢 &nbsp;我要当躲藏者</button>
    <p class="hint">
      <b>WASD</b> / <b>方向键</b> 移动 &nbsp;·&nbsp; 按住 <b>Shift</b> 快步<br>
      <b>空格</b> 制造噪声（双倍射线·1.5倍距离·冷却4s）<br>
      <b>Enter</b> 双人模式玩家2制造噪声（方向键移动）<br>
      <b>Backspace</b> 双人模式玩家2快步<br>
      <b>ESC</b> 暂停 &nbsp;·&nbsp; <b>R R</b>（连按两次）重开<br>
      <span style="color:#7fd3ff">你只能看到自己阵营的声波</span><br>
      <span style="color:#ff9a70">声波接触到其他角色会闪橙红色</span><br>
      <span style="color:#a8c4f0">墙壁轮廓只被自己的声波点亮</span>
    </p>
  `;
  setOverlayMode({ mode: 'menu' });

  dom.panel.querySelectorAll('[data-role]').forEach(btn => {
    btn.addEventListener('click', () => showSettings(btn.dataset.role));
  });
}

/* ============================================================
   设置面板
============================================================ */
export function showSettings(role) {
  gstate.selectedRole = role;
  gstate.cfgSeekerCount = DEFAULT_SEEKER_COUNT;
  gstate.cfgHiderCount = DEFAULT_HIDER_COUNT;
  gstate.cfgPlayerCount = DEFAULT_PLAYER_COUNT;
  gstate.cfgMapSize = DEFAULT_MAP_SIZE;
  gstate.cfgGameTime = DEFAULT_GAME_TIME;
  renderSettingsPanel();
}

function renderSettingsPanel() {
  const { cfgPlayerCount, cfgSeekerCount, cfgHiderCount, cfgMapSize, cfgGameTime, selectedRole } = gstate;

  dom.panel.innerHTML = `
    <h1 style="font-size: clamp(20px,3vw,32px)">游 戏 设 置</h1>
    <p class="sub">${selectedRole === 'seeker' ? '🔴 搜捕者' : '🟢 躲藏者'}</p>

    <div class="setting-group">
      <div class="setting-label"><span>本地玩家</span><span class="val" id="valPlayers">${cfgPlayerCount}P</span></div>
      <div class="option-row" id="optPlayers">
        <button data-val="1" class="${cfgPlayerCount === 1 ? 'active' : ''}">单人</button>
        <button data-val="2" class="${cfgPlayerCount === 2 ? 'active' : ''}">双人</button>
      </div>
    </div>

    <div class="setting-group">
      <div class="setting-label"><span>追捕者数量</span><span class="val" id="valSeekers">${cfgSeekerCount}</span></div>
      <div class="option-row" id="optSeekers">
        ${[1, 2, 3].map(n => `<button data-val="${n}" class="${cfgSeekerCount === n ? 'active' : ''}">${n}</button>`).join('')}
      </div>
    </div>

    <div class="setting-group">
      <div class="setting-label"><span>躲藏者数量</span><span class="val" id="valHiders">${cfgHiderCount}</span></div>
      <div class="option-row" id="optHiders">
        ${[3, 5, 6, 8, 10].map(n => `<button data-val="${n}" class="${cfgHiderCount === n ? 'active' : ''}">${n}</button>`).join('')}
      </div>
    </div>

    <div class="setting-group">
      <div class="setting-label"><span>地图大小</span><span class="val" id="valMap">${MAP_LABELS[cfgMapSize]}</span></div>
      <div class="option-row" id="optMap">
        <button data-val="small"  class="${cfgMapSize === 'small'  ? 'active' : ''}">小</button>
        <button data-val="medium" class="${cfgMapSize === 'medium' ? 'active' : ''}">中</button>
        <button data-val="large"  class="${cfgMapSize === 'large'  ? 'active' : ''}">大</button>
      </div>
    </div>

    <div class="setting-group">
      <div class="setting-label"><span>游戏时长</span><span class="val" id="valTime">${fmtTime(cfgGameTime)}</span></div>
      <div class="option-row" id="optTime" style="flex-wrap: wrap;">
        ${TIME_OPTIONS.map(o => `<button data-val="${o.v}" class="${cfgGameTime === o.v ? 'active' : ''}" style="min-width: 60px;">${o.label}</button>`).join('')}
      </div>
    </div>

    <button class="btn again" id="startBtn" style="margin-top:14px">开 始 游 戏</button>
    <button class="btn secondary" id="backBtn">返回</button>
    <p class="hint" style="margin-top:10px">双人模式：两名玩家必须属于同一阵营。P1：WASD / Shift / Space；P2：方向键 / Enter。</p>
  `;

  const updateValLabels = () => {
    dom.panel.querySelector('#valPlayers').textContent = `${gstate.cfgPlayerCount}P`;
    dom.panel.querySelector('#valSeekers').textContent = gstate.cfgSeekerCount;
    dom.panel.querySelector('#valHiders').textContent = gstate.cfgHiderCount;
    dom.panel.querySelector('#valMap').textContent = MAP_LABELS[gstate.cfgMapSize];
    dom.panel.querySelector('#valTime').textContent = fmtTime(gstate.cfgGameTime);
  };

  // 双人模式下，自己阵营的数量至少为 2
  const syncModeCounts = () => {
    const minForPlayers = gstate.cfgPlayerCount === 2 ? 2 : 1;
    if (gstate.selectedRole === 'seeker') gstate.cfgSeekerCount = Math.max(minForPlayers, gstate.cfgSeekerCount);
    else gstate.cfgHiderCount = Math.max(minForPlayers, gstate.cfgHiderCount);
    dom.panel.querySelectorAll('#optSeekers button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.val) === gstate.cfgSeekerCount));
    dom.panel.querySelectorAll('#optHiders button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.val) === gstate.cfgHiderCount));
  };

  const bindRow = (row, apply) => {
    row.addEventListener('click', ev => {
      const btn = ev.target.closest('button[data-val]');
      if (!btn) return;
      apply(btn.dataset.val);
      syncModeCounts();
      row.querySelectorAll('button').forEach(b => b.classList.toggle(
        'active',
        b === btn || (row.id === 'optPlayers' && parseInt(b.dataset.val) === gstate.cfgPlayerCount)
      ));
      updateValLabels();
    });
  };

  bindRow(dom.panel.querySelector('#optPlayers'), v => gstate.cfgPlayerCount = parseInt(v));
  bindRow(dom.panel.querySelector('#optSeekers'), v => gstate.cfgSeekerCount = parseInt(v));
  bindRow(dom.panel.querySelector('#optHiders'),  v => gstate.cfgHiderCount  = parseInt(v));
  bindRow(dom.panel.querySelector('#optMap'),     v => gstate.cfgMapSize     = v);
  bindRow(dom.panel.querySelector('#optTime'),    v => gstate.cfgGameTime    = parseInt(v));
  syncModeCounts();
  updateValLabels();

  dom.panel.querySelector('#startBtn').addEventListener('click', () => startGame(gstate.selectedRole));
  dom.panel.querySelector('#backBtn').addEventListener('click', showMenu);
}
