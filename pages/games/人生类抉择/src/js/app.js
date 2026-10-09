/**
 * app.js —— 应用控制器
 *
 * 职责：持有当前局状态，串联「引擎计算 → UI 渲染 → 用户输入」。
 * 这一层不写任何业务规则，规则全部在 core/ 里；也不直接拼 HTML，渲染交给 ui/。
 *
 * ⚠️ 必须在 loadAll() 之后调用 boot()，否则 db 里还没有数据。
 */

import { $, on } from './ui/dom.js';
import { ICON_SOUND_ON, ICON_MUTED } from './ui/icons.js';
import * as audio from './ui/audio.js';
import { toast } from './ui/toast.js';
import { renderHeader, renderMeters, showDeltas, narrate, narrateChoice, narrateIdle, narrateBirth } from './ui/statusBar.js';
import { renderCard, flyOut, resetCard, initSwipe, previewPeek } from './ui/card.js';
import { openDrawer, closeDrawers, isAnyOpen, renderLog, renderArch } from './ui/drawers.js';
import { showView, showEndOverlay, isEndOverlayOpen, renderStart, bindAspirationGrid, renderSideInfo } from './ui/views.js';
import { renderEnding } from './ui/ending.js';

import {
  db, CARD_FLY_MS,
  newGame, pickEvent, choose, saveGame, loadGame, clearSave
} from './core/engine.js';

/** 当前局状态；cur 为当前卡牌事件；busy 防止动画期间重复提交 */
let S = null;
let cur = null;
let busy = false;
let selAsp = null;   // 延迟到 boot() 时从 db 取默认值

const hasGame = () => !!S && !S.ended;
const isPlaying = () => !!S && !S.ended && !busy;

/* ---------------- 渲染组合 ---------------- */

/** 已播报过的大事记条数，避免同一条反复播报 */
let narratedMs = 0;

function renderAll() {
  renderHeader(S);
  renderMeters(S);
  renderSideInfo(S);
  renderCard(cur);
}

function renderProgress() {
  renderHeader(S);
  renderMeters(S);
  renderSideInfo(S);
}

/* ---------------- 流程 ---------------- */

function enterGame(continued = false) {
  showEndOverlay(false);
  showView('game');
  closeDrawers();
  busy = false;
  narratedMs = S.milestones.length;

  if (S.ended) {
    renderProgress();
    narrate({ kind: 'danger', tag: '落幕', text: S.ended.t });
    renderEnding(S);
  } else {
    cur = pickEvent(S);
    renderAll();
    if (continued || S.turn === 0) narrateBirth(S, continued);
    else narrateIdle(S);
  }
}

function goHome() {
  S = null;
  cur = null;
  busy = false;
  narratedMs = 0;
  showEndOverlay(false);
  closeDrawers();
  renderStart(selAsp);
  showView('start');
}

function startNew(aspiration) {
  audio.init();
  selAsp = aspiration || selAsp;
  S = newGame(selAsp);
  saveGame(S);
  enterGame(false);
}

function continueGame() {
  audio.init();
  const saved = loadGame();
  if (!saved) { toast('没有找到存档'); return; }
  S = saved;
  selAsp = S.aspiration || selAsp;
  enterGame(true);
}

/** 大事记播报（只报新增的那条，避免刷屏）@returns {boolean} 本次是否播报了 */
function reportMilestones() {
  if (S.milestones.length > narratedMs) {
    const last = S.milestones[S.milestones.length - 1];
    narratedMs = S.milestones.length;
    narrate({ kind: 'milestone', tag: '大事记', text: `${last.age}岁 · ${last.text}` });
    toast(last.text);
    audio.milestone();
    return true;
  }
  return false;
}

/** 执行一次抉择 */
function resolve(side) {
  if (!isPlaying() || !cur) return;
  busy = true;

  const aspBefore = S.aspirationDone;

  const result = choose(S, cur, side);
  saveGame(S);
  audio.swipe(side);
  narrateChoice(result);
  flyOut(side);

  setTimeout(() => {
    renderProgress();
    showDeltas(result.deltas);
    const justMilestone = reportMilestones();

    if (S.ended) {
      setTimeout(() => {
        const { isWin } = renderEnding(S);
        if (isWin) audio.win(); else audio.death();
        busy = false;
      }, 720);
      return;
    }

    if (!aspBefore && S.aspirationDone) {
      const asp = db.aspirations[S.aspiration];
      setTimeout(() => {
        narrate({ kind: 'milestone', tag: '心愿达成', text: '「' + (asp ? asp.name : '') + '」—— 这辈子没白活。' });
        toast('心愿达成 · ' + (asp ? asp.name : ''));
      }, 900);
      audio.milestone();
    }

    resetCard();
    cur = pickEvent(S);
    renderCard(cur);
    if (!S.aspirationDone && !justMilestone) narrateIdle(S);
    busy = false;
  }, CARD_FLY_MS);
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  // 开始页
  bindAspirationGrid(id => { selAsp = id; renderStart(selAsp); });
  on('btnNew', 'click', () => startNew(selAsp));
  on('btnContinue', 'click', continueGame);

  // 结局页
  on('btnAgain', 'click', () => startNew(S ? S.aspiration : selAsp));
  on('btnHome', 'click', goHome);

  // 游戏页：两个选择按钮
  on('btnL', 'click', () => resolve('left'));
  on('btnR', 'click', () => resolve('right'));
  // 悬停 / 按下时预览对应侧的浮窗，让鼠标用户也能看到选项文本
  on('btnL', 'pointerenter', () => { if (isPlaying()) previewPeek('left'); });
  on('btnR', 'pointerenter', () => { if (isPlaying()) previewPeek('right'); });
  on('btnL', 'pointerleave', () => previewPeek(null));
  on('btnR', 'pointerleave', () => previewPeek(null));
  on('btnRestart', 'click', () => {
    if (!S) return;
    if (confirm('确定重新开始吗？当前进度将被覆盖。')) {
      clearSave();
      goHome();
    }
  });
  on('btnArch', 'click', () => { if (S) { renderArch(S); openDrawer('drawerArch'); } });
  on('btnLog',  'click', () => { if (S) { renderLog(S);  openDrawer('drawerLog');  } });

  // 抽屉
  on('closeLog', 'click', closeDrawers);
  on('closeArch', 'click', closeDrawers);
  on('backdrop', 'click', closeDrawers);

  // 声音开关
  on('btnSound', 'click', () => {
    const muted = audio.toggleMute();
    $('btnSound').classList.toggle('on', muted);
    $('icSound').innerHTML = muted ? ICON_MUTED : ICON_SOUND_ON;
  });

  // 滑动手势
  initSwipe({ canDrag: isPlaying, onSwipe: resolve });

  // 键盘 ← →（按住时预览浮窗，松开执行）
  document.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const inGame = $('view-game').classList.contains('active');
    if (!inGame || isEndOverlayOpen() || isAnyOpen()) return;
    e.preventDefault();
    if (e.repeat) return;
    if (isPlaying()) previewPeek(e.key === 'ArrowLeft' ? 'left' : 'right');
  });
  document.addEventListener('keyup', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const inGame = $('view-game').classList.contains('active');
    if (!inGame || isEndOverlayOpen() || isAnyOpen()) return;
    previewPeek(null);
    resolve(e.key === 'ArrowLeft' ? 'left' : 'right');
  });

  // 首次交互时激活音频上下文（浏览器 autoplay 策略要求）
  document.addEventListener('pointerdown', () => audio.init(), { once: true });
}

/* ---------------- 启动 ---------------- */

export function boot() {
  if (!db.ready) throw new Error('boot() 被调用时剧本尚未加载，请先 await loadAll()');
  selAsp = db.aspirationIds[0];
  bindEvents();
  renderStart(selAsp);
  showView('start');
}

/**
 * 供调试用的直达入口（main.js 中由 URL hash 触发）
 * @param {'new'|'win'|'dead'} kind
 */
export function debugEnter(kind) {
  if (kind === 'new') {
    startNew(selAsp);
    return;
  }
  S = newGame(db.aspirationIds.includes('family') ? 'family' : db.aspirationIds[0]);
  S.age = 80;
  S.turn = 60;
  S.stats  = { health: 42, mood: 38, money: 55, energy: 31, social: 47, career: 66 };
  S.flags  = { metLove: true, married: true, hasChild: true, house: true, pet: true, degree: true, peaked: true, retired: true, biz: false };
  S.traits = db.traitIds.slice(0, 2);
  S.aspiration = 'family';
  S.aspirationDone = true;
  S.rel    = { family: 72, friends: 55, love: 68 };
  S.skills = { knowledge: 55, cooking: 40, fitness: 45, charm: 38, craft: 33 };
  S.milestones = [
    { age: 6,  text: '入学 · 人生第一章' }, { age: 14, text: '情窦初开' },
    { age: 21, text: '遇见心动的人' },      { age: 26, text: '第一份正经工作' },
    { age: 28, text: '步入婚姻' },          { age: 30, text: '有了自己的房子' },
    { age: 32, text: '为人父母' },          { age: 38, text: '职场巅峰 · 站稳了' },
    { age: 46, text: '家庭美满 · 心愿达成' }, { age: 60, text: '退休 · 慢下来的人生' },
    { age: 70, text: '金婚 · 相伴半生' }
  ];

  if (kind === 'win') {
    S.ended = db.endings.win;
    S.endDetail = { kind: 'win' };
  } else {
    S.ended = db.endings.energy.low;
    S.endDetail = { meter: 'energy', kind: 'low' };
  }
  enterGame();
}

export const __debug = {
  get state() { return S; },
  get current() { return cur; },
  resolve,
  startNew
};
