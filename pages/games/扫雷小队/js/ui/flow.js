/**
 * 对局生命周期：开局装配、暂停 / 继续、结算、按钮绑定、菜单演示局。
 * 这一层负责「把各层拼起来」，本身不写任何规则。
 */
import { W, H, COUNTDOWN_TIME } from '../core/config.js';
import { game } from '../core/state.js';
import { generateMaze } from '../world/maze.js';
import { placeMines } from '../world/mines.js';
import { createTeams } from '../world/teams.js';
import { placeFlags } from '../world/flags.js';
import { createEntities } from '../world/entities.js';
import { startRecording, stopRecording } from '../sim/recorder.js';
import { startDemo } from '../sim/demo.js';
import { collectResults } from '../sim/scoring.js';
import { showScreen, showOverlay, hideOverlay, backToMenu as backToMenuScreen } from './screens.js';
import { showResults } from './result.js';
import { openReplay, closeReplay } from './replay.js';
import { requestFit } from './fit.js';

/** 装配一局：迷宫 → 地雷 → 队伍 → 实体 → 3 秒倒计时 → 开始录像 */
export function startGame() {
  closeReplay();
  showScreen('gameScreen');
  hideOverlay('pauseOverlay');
  hideOverlay('resultOverlay');

  const maze = generateMaze();
  game.walls = maze.walls;
  game.entranceYs = maze.entranceYs;
  game.exitX = maze.exitX;
  game.exitY = maze.exitY;

  game.mines = placeMines();
  game.teams = createTeams();
  game.flags = placeFlags(game.teams.length);   // 旗帜数量 = 队伍数量

  game.entities = [];
  game.explosions = [];
  game.ripples = [];
  game.particles = [];
  game.unionKnown = new Uint8Array(W * H);
  game.displayFog = new Float32Array(W * H).fill(1);
  game.displayTrail = new Int8Array(W * H).fill(-1);
  game.teamTrails = game.teams.map(() => new Uint8Array(W * H));

  game.elapsed = 0;
  game.countdown = COUNTDOWN_TIME;
  game.endCountdown = null;
  game.exitFlash = 0;
  game.screenShake = 0;
  game.keys = {};
  game.demo = false;
  game.lastTime = performance.now();

  createEntities();
  startRecording();
  game.state = 'countdown';
  requestFit();          // 等第一帧 HUD 渲染完再由主循环测量并适配尺寸
}

export function pauseGame() {
  if (game.state !== 'playing' && game.state !== 'countdown') return;
  game.state = 'paused';
  showOverlay('pauseOverlay');
}

export function resumeGame() {
  if (game.state !== 'paused') return;
  game.state = game.countdown > 0 ? 'countdown' : 'playing';
  game.lastTime = performance.now();
  hideOverlay('pauseOverlay');
}

/** ESC 与暂停面板共用 */
export function togglePause() {
  if (game.state === 'playing' || game.state === 'countdown') pauseGame();
  else if (game.state === 'paused') resumeGame();
}

export function endGame() {
  if (game.state === 'ended') return;
  game.state = 'ended';
  stopRecording();

  const { data, teamStats, overview } = collectResults();
  showResults(data, teamStats, overview, {
    onRestart: startGame,
    onMenu: backToMenu,
    onReplay: openReplayScreen
  });
}

/**
 * 进入独立回放页：先收起结算层，退出时再放回来。
 * 三个退出去向（返回结算 / 再来一局 / 回主菜单）都在这里决定，回放页本身不知情。
 */
function openReplayScreen(caption) {
  hideOverlay('resultOverlay');
  const ok = openReplay({
    caption,
    onBack: () => {
      closeReplay();
      showScreen('gameScreen');
      showOverlay('resultOverlay');
    },
    onRestart: () => { closeReplay(); startGame(); },
    onMenu:    () => { closeReplay(); backToMenu(); }
  });
  if (!ok) showOverlay('resultOverlay');   // 极端情况：没有录像数据
}

/** 回主菜单：顺手重启背景演示局 */
export function backToMenu() {
  closeReplay();
  backToMenuScreen();
  startDemo();
}

export function bindButtons() {
  document.getElementById('btnToOptions').onclick = () => showScreen('optionsScreen');
  document.getElementById('btnBackMenu').onclick  = () => showScreen('menuScreen');
  document.getElementById('btnStart').onclick     = () => startGame();

  document.getElementById('btnResume').onclick    = () => resumeGame();
  document.getElementById('btnRestart').onclick   = () => startGame();
  document.getElementById('btnToMenu').onclick    = () => backToMenu();
}
