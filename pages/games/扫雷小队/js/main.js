/**
 * 应用入口：装配各层 → 固定上限的可变步长主循环 → 启动。
 *
 * ── 依赖方向（只允许向下依赖，无循环引用）
 *   core/    配置、工具、状态、画布
 *   world/   迷宫、地雷、队伍、实体、碰撞、寻路
 *   sim/     扫描排雷、玩家、AI、危险、特效、视野、录制回放、演示局、统计、每帧推进
 *   render/  地形、角色、特效、渲染主函数（只读 scene）
 *   ui/      界面切换、选项、HUD、回放、结算、对局生命周期
 *   input/   键盘 → 语义化输入
 *   main.js  只做装配与主循环，不写任何游戏规则
 *
 * ── 主循环
 *   dt 夹在 0.05 秒以内：卡顿时宁可「慢放」也不让角色一步穿过墙或雷。
 *   演示局（主菜单背景）与正式对局共用 stepMatch，只是推进入口不同；
 *   结算后由 ui/replay 接管回放画布，主循环只负责喂 dt。
 */
import { game } from './core/state.js';
import { ctx as gameCtx } from './core/canvas.js';
import { CW, CH } from './core/config.js';
import { initKeyboard } from './input/keyboard.js';
import { update } from './sim/simulation.js';
import { updateDemo, startDemo } from './sim/demo.js';
import { record } from './sim/recorder.js';
import { render } from './render/renderer.js';
import { renderHUD } from './ui/hud.js';
import { initOptions } from './ui/options.js';
import { bindButtons, endGame, togglePause } from './ui/flow.js';
import { showScreen } from './ui/screens.js';
import { tickReplay, isReplayOpen } from './ui/replay.js';

/** 菜单背景画布（独立 ctx，避免污染对局画布） */
const menuCanvas = document.getElementById('menuCanvas');
if (menuCanvas) { menuCanvas.width = CW; menuCanvas.height = CH; }
const menuCtx = menuCanvas ? menuCanvas.getContext('2d') : null;

function loop(t) {
  requestAnimationFrame(loop);

  const dt = Math.min((t - game.lastTime) / 1000 || 0, 0.05);
  game.lastTime = t;

  if (game.state === 'demo') {
    // 主菜单背景演示局
    if (updateDemo(dt)) startDemo();
    if (menuCtx && document.body.classList.contains('at-menu')) render(menuCtx);
  } else if (game.state === 'countdown' || game.state === 'playing') {
    if (update(dt)) endGame();
    render(gameCtx);
    renderHUD();
    // 只在真正开打后录制：倒计时阶段 game.elapsed 不动，采样没有意义
    if (game.state === 'playing') record(dt);
  } else if (game.walls && (game.state === 'paused' || game.state === 'ended') && !isReplayOpen()) {
    render(gameCtx);     // 暂停 / 结算时定格最后一帧（回放页打开时没必要再画）
    renderHUD();
  }

  tickReplay(dt);
}

function boot() {
  initKeyboard({ onEscape: togglePause });
  initOptions();
  bindButtons();
  showScreen('menuScreen');
  startDemo();           // 菜单背景：一局全 AI 的演示对局
  requestAnimationFrame(loop);
}

boot();
