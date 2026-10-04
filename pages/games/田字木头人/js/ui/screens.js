/**
 * 面板：开始页 / 模式选择 / 暂停 / 结算。
 * 只负责「渲染 DOM + 绑定按钮」，真正的流程推进交给 game/ 与 ui/flow.js。
 */
import {
  HUMAN_WOLF_COUNT, WOLF_COUNT_OPTIONS, TOTAL_STROKES, WRITER_MAX_TIME
} from '../core/config.js';
import { initAudio } from '../core/audio.js';
import { hideTouchControls } from '../input/touch.js';
import { startGame } from '../game/match.js';
import { world, setWorld, wolfTotalCount, setWolfTotalCount } from '../game/state.js';
import { panel, showOverlay, hideOverlay } from './overlay.js';

/* ---------- 开始标题页 ---------- */
export function showStartScreen(){
  setWorld(null);
  hideTouchControls();

  panel.className = 'panel start-panel';
  panel.innerHTML = `
    <div class="start-title">木 头 人</div>
    <div class="start-sub">背 后 的 脚 步 声</div>
    <button class="start-btn" id="startGameBtn">开 始 游 戏</button>
    <div class="start-hint">
      按 <b>ESC</b> 暂停 &nbsp;·&nbsp; 开局 <b>3 秒倒计时</b><br>
      写字人总时长 <b>50 秒</b> &nbsp;·&nbsp; 每次回头 <b>-3 秒</b><br>
      木头人可按 <b>W</b> / <b>↑</b> 制造声响，逼写字人回头
    </div>
  `;

  document.getElementById('startGameBtn').addEventListener('click', () => {
    initAudio();
    showModeMenu();
  });

  showOverlay();
}

/* ---------- 更新木头人组成提示 ---------- */
export function updateWolfCompositionLabels(){
  for (const mode in HUMAN_WOLF_COUNT){
    const el = panel.querySelector(`.mode-btn[data-mode="${mode}"] .mode-comp`);
    if (!el) continue;
    const h = HUMAN_WOLF_COUNT[mode];
    const total = Math.max(wolfTotalCount, h);
    const a = total - h;
    if (a > 0){
      el.innerHTML = `木头人 <b>${total}</b> 名 · <b>${h}</b> 人类 + <b>${a}</b> AI`;
    } else {
      el.innerHTML = `木头人 <b>${total}</b> 名 · <b>${h}</b> 人类`;
    }
  }
}

/* ---------- 模式选择页 ---------- */
export function showModeMenu(){
  panel.className = 'panel menu-panel';

  const countLabels = { 1:'独行', 2:'成双', 4:'结队', 8:'成群' };
  let countBtnsHTML = '';
  for (const n of WOLF_COUNT_OPTIONS){
    const active = (n === wolfTotalCount) ? ' active' : '';
    countBtnsHTML += `<button class="count-btn${active}" data-count="${n}">${n}<small>${countLabels[n]}</small></button>`;
  }

  panel.innerHTML = `
    <div class="menu-header">
      <h1>选 择 模 式</h1>
      <div class="sub">游戏中按 <b>ESC</b> 暂停</div>
    </div>

    <div class="menu-scroll">
      <div class="group-label">单 人 模 式</div>

      <button class="mode-btn" data-mode="solo_wolf">
        <div class="mode-icon icon-solo">🙋</div>
        <div class="mode-body">
          <div class="mode-title">你是木头人 · AI 写字</div>
          <div class="mode-desc">用 <span class="hl">A / D</span> 或 <span class="hl">← →</span> 靠近 · <span class="hl">W</span> 制造声响逼 AI 回头</div>
          <div class="mode-comp"></div>
        </div>
      </button>

      <button class="mode-btn" data-mode="solo_writer">
        <div class="mode-icon icon-solo">✍️</div>
        <div class="mode-body">
          <div class="mode-title">你是写字人 · AI 木头人</div>
          <div class="mode-desc">按住 <span class="hl">空格</span> 或 <span class="hl">↑ ↓</span> 写「田」，松开回头抓 AI</div>
          <div class="mode-comp"></div>
        </div>
      </button>

      <div class="group-label">双 人 模 式</div>

      <button class="mode-btn" data-mode="p1w">
        <div class="mode-icon icon-p1">P1</div>
        <div class="mode-body">
          <div class="mode-title">P1 写字人 &nbsp;·&nbsp; P2 木头人</div>
          <div class="mode-desc">P1 按住<span class="hl">空格</span>写「田」 · P2 用<span class="hl">← →</span>靠近、<span class="hl">↑</span>制造声响</div>
          <div class="mode-comp"></div>
        </div>
      </button>

      <button class="mode-btn" data-mode="p2w">
        <div class="mode-icon icon-p2">P2</div>
        <div class="mode-body">
          <div class="mode-title">P1 木头人 &nbsp;·&nbsp; P2 写字人</div>
          <div class="mode-desc">P2 按住<span class="hl">↑ 或 ↓</span>写「田」 · P1 用<span class="hl">A D</span>靠近、<span class="hl">W</span>制造声响</div>
          <div class="mode-comp"></div>
        </div>
      </button>

      <button class="mode-btn" data-mode="twow">
        <div class="mode-icon icon-both">双</div>
        <div class="mode-body">
          <div class="mode-title">P1 + P2 双木头人 vs AI</div>
          <div class="mode-desc">两人同时靠近 AI · P1 <span class="hl">A D</span> + <span class="hl">W</span> · P2 <span class="hl">← →</span> + <span class="hl">↑</span></div>
          <div class="mode-comp"></div>
        </div>
      </button>
    </div>

    <div class="menu-footer">
      <div class="count-selector">
        <span class="cs-label">木 头 人 总 数</span>
        <div class="count-btns">
          ${countBtnsHTML}
        </div>
      </div>
      <button class="back-btn" id="backToStartBtn">← 返 回</button>
    </div>
  `;

  updateWolfCompositionLabels();

  panel.querySelectorAll('.count-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault();
      setWolfTotalCount(parseInt(btn.dataset.count, 10) || 1);
      panel.querySelectorAll('.count-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateWolfCompositionLabels();
    });
  });

  panel.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => startGame(btn.dataset.mode));
  });

  document.getElementById('backToStartBtn').addEventListener('click', showStartScreen);

  showOverlay();
}

/* ---------- 暂停菜单 ---------- */
export function showPauseMenu(){
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="pause-icon">| |</div>
    <h1 class="pause-title">游 戏 暂 停</h1>
    <button class="primary-btn" id="resumeBtn">继 续 游 戏</button>
    <button class="secondary-btn" id="restartBtn">重 新 开 始</button>
    <button class="secondary-btn" id="menuBtn">返 回 主 菜 单</button>
    <div class="start-hint" style="margin-top:22px;">按 <b>ESC</b> 继续</div>
  `;

  document.getElementById('resumeBtn').addEventListener('click', () => {
    if (!world) return;
    world.paused = false;
    hideOverlay();
  });

  document.getElementById('restartBtn').addEventListener('click', () => {
    if (!world) return;
    const m = world.mode;
    world.paused = false;
    startGame(m);
  });

  document.getElementById('menuBtn').addEventListener('click', () => {
    showStartScreen();
  });

  showOverlay();
}

/* ---------- 结算页 ---------- */
export function showResult(){
  const win = world.winner === 'wolf';

  const titleMap = {
    'wolf'  : '木头人胜利',
    'writer': '写字人胜利'
  };

  let icon, desc;
  if (win){
    icon = '🏃';
    desc = world.reason + '<br>木头人成功摸到了写字人的后背';
  } else {
    icon = '✍️';
    desc = world.reason + '<br>木头人没能在写字人写完「田」字前摸到他';
  }

  const playTime = world.time.toFixed(1);
  const strokesDone = Math.min(world.stats.strokesDone, TOTAL_STROKES);
  const strokesPct = Math.round((world.stats.strokesDone / TOTAL_STROKES) * 100);
  const looks = world.stats.looks;
  const timeLeft = world.writerTimeLeft.toFixed(1);
  const caught = world.stats.wolvesCaught;
  const total = world.stats.wolvesTotal;
  const noises = world.stats.noises || 0;

  const strokeCls = world.stats.strokesDone >= TOTAL_STROKES ? 'good'
                  : world.stats.strokesDone >= 3 ? 'warn' : 'bad';
  const timeCls = world.writerTimeLeft > WRITER_MAX_TIME * 0.5 ? 'good'
                : world.writerTimeLeft > WRITER_MAX_TIME * 0.25 ? 'warn' : 'bad';

  panel.className = 'panel';
  panel.innerHTML = `
    <div class="result-header">
      <div class="result-icon">${icon}</div>
      <div class="result-title ${win ? 'win-c' : 'lose-c'}">${titleMap[world.winner]}</div>
      <div class="result-desc">${desc}</div>
    </div>

    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-value">${playTime}s</div>
        <div class="stat-label">游戏时长</div>
      </div>
      <div class="stat-item">
        <div class="stat-value ${strokeCls}">${strokesDone} / ${TOTAL_STROKES}</div>
        <div class="stat-label">完成笔画 · ${strokesPct}%</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${looks} 次</div>
        <div class="stat-label">回头次数</div>
      </div>
      <div class="stat-item">
        <div class="stat-value ${timeCls}">${timeLeft}s</div>
        <div class="stat-label">剩余时间</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${noises} 次</div>
        <div class="stat-label">制造声响</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${caught} / ${total}</div>
        <div class="stat-label">木头人被抓住 / 总数量</div>
      </div>
    </div>

    <button class="primary-btn" id="againBtn">再 玩 一 次</button>
    <button class="secondary-btn" id="menuBtn">返 回 主 菜 单</button>
  `;

  document.getElementById('againBtn').addEventListener('click', () => {
    startGame(world.mode);
  });

  document.getElementById('menuBtn').addEventListener('click', () => {
    showStartScreen();
  });

  showOverlay();
}
