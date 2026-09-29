/**
 * 入口：缓存 DOM、绑定事件、启动主循环。
 *
 * 执行顺序很重要：
 *   1. initDom()  —— 之后所有模块才能安全取用 dom.xxx
 *   2. 绑定事件与初始 UI
 *   3. 显示菜单
 *   4. requestAnimationFrame(loop)
 */
import { initDom, dom } from './ui/dom.js';
import { showMenu } from './ui/settings.js';
import { bindResultMinimize } from './ui/panels.js';
import { updateHUD, updateFullscreenButton, toggleFullscreen } from './ui/hud.js';
import { bindInput } from './game/input.js';
import {
  setPaused, startGame, restartGame, backToMenu,
  update, updateResultAnimation
} from './game/main.js';
import {
  updateReplay, seekReplay, exitReplay, replayTogglePlay, startReplay,
  interpolateReplayEntities, getReplayFrameAt, getReplayState
} from './game/replay.js';
import { resizeCanvas, beginWorldTransform } from './render/sight.js';
import { render, renderReplay } from './render/renderer.js';
import { gstate } from './core/state.js';

/* ============================================================
   初始化
============================================================ */
initDom();

window.addEventListener('resize', resizeCanvas);
document.addEventListener('fullscreenchange', () => {
  resizeCanvas();
  updateFullscreenButton();
});

// 结果面板“收起/展开”
bindResultMinimize();

// 键盘输入与流程回调
bindInput({ setPaused, exitReplay, showMenu, replayTogglePlay });

// 全屏按钮
dom.fullscreenBtn.addEventListener('click', toggleFullscreen);

// 回放控制条
dom.replayPlayBtn.addEventListener('click', replayTogglePlay);
dom.replayRange.addEventListener('input', () => seekReplay(dom.replayRange.value));
dom.replayExitBtn.addEventListener('click', exitReplay);
dom.exitReplayHudBtn.addEventListener('click', exitReplay);

// 暂停菜单
document.getElementById('pauseRestart').addEventListener('click', restartGame);
document.getElementById('pauseMenu').addEventListener('click', backToMenu);

/* ============================================================
   主循环
============================================================ */
function loop(now) {
  requestAnimationFrame(loop);

  let dt = (now - (loop._last || now)) / 1000;
  loop._last = now;
  dt = Math.min(dt, 0.05);

  if ((gstate.state === 'playing' || gstate.state === 'countdown') && !gstate.paused) {
    update(dt);
  } else if (gstate.state === 'replay') {
    updateReplay(dt);
  } else if (gstate.state === 'resultAnimation') {
    updateResultAnimation(dt);
  }

  // 渲染：render() / renderReplay() 内部会自行清屏并建立世界坐标变换
  if (gstate.state === 'replay') {
    const t = getReplayState().elapsed;
    beginWorldTransform();
    renderReplay(t, getReplayFrameAt(t), interpolateReplayEntities(t));
  } else {
    render();
  }

  updateHUD();
}

resizeCanvas();
updateFullscreenButton();
showMenu();
requestAnimationFrame(loop);

export { startReplay, startGame };
