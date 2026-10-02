/**
 * 应用入口：装 DOM → 装配各层 → 固定步长主循环。
 *
 * ── 层次与依赖方向（只允许向下依赖）
 *   core/    基础设施与领域规则（配置、状态、随机、事件、阵营、显形、指令）
 *   world/   地图与空间（地图、碰撞、寻路、角色工厂、道具）
 *   sim/     对局模拟（移动、声波、效果、统计、导航、主模拟 simulation.js、回放录制）
 *   ai/      AI 决策（搜捕者 / 躲藏者）
 *   net/     网络抽象（协议、传输、快照、会话）
 *   input/   键盘 → 指令
 *   render/  渲染
 *   ui/      DOM / 面板 / HUD / 回放播放 / 流程
 *   main.js  只做装配与主循环，不写任何游戏规则
 *
 * ── 主循环为什么是固定步长
 *   模拟层固定 SIM_HZ 推进，渲染按剩余时间插值（gstate.renderAlpha）。
 *   这样：帧率变化不影响对局结果、回放能复现、将来联机（快照 / 锁步）也有基础。
 *
 * ── 联机入口
 *   现在用 offline 会话（单机 + 本地双人）。将来接服务器时只需要把
 *   createSession({ mode: MODE.GUEST, transport: createWebSocketTransport(url) })
 *   换进来，其余代码（输入 → 指令、事件 → UI）完全不用改。
 */
import { SIM_HZ, SIM_MAX_STEPS_PER_FRAME } from './core/config.js';
import { gstate, inMatch } from './core/state.js';
import { clamp } from './core/utils.js';
import { initDom, dom } from './ui/dom.js';
import { showMenu } from './ui/settings.js';
import { updateHUD, updateFullscreenButton, toggleFullscreen, showToast, hideToast } from './ui/hud.js';
import { bindResultMinimize } from './ui/panels.js';
import {
  bindFlow, updateFlow, startGame, restartGame, togglePause, backToMenu
} from './ui/flow.js';
import {
  exitReplay, replayTick, replayTogglePlay, seekReplay,
  currentReplayFrame, currentReplayEntities
} from './ui/replay.js';
import { bindKeyboard, readCommands } from './input/keyboard.js';
import { resizeCanvas, beginWorldTransform } from './render/sight.js';
import { render, renderReplay } from './render/renderer.js';
import { createSession, MODE } from './net/session.js';

const SIM_DT = 1 / SIM_HZ;
const MAX_FRAME_DT = 0.25;

/* ============================================================
   初始化
   ============================================================ */
initDom();

/** 当前会话：单机为 offline；联机时换成 host / guest（见 net/session.js） */
const session = createSession({ mode: MODE.OFFLINE });

// 流程层：订阅模拟事件（被抓、道具、结算）+ 注册 UI 动作
bindFlow();

// 键盘：只产生指令与全局快捷键，不碰 UI
bindKeyboard({
  togglePause,
  openMenu: backToMenu,
  onResetHint: ms => showToast('再按一次 R 重新开始', ms),
  onResetCancel: hideToast
});

// 全屏与回放控制条
dom.fullscreenBtn.addEventListener('click', toggleFullscreen);
dom.replayPlayBtn.addEventListener('click', replayTogglePlay);
dom.replayRange.addEventListener('input', () => seekReplay(dom.replayRange.value));
dom.replayExitBtn.addEventListener('click', exitReplay);
dom.exitReplayHudBtn.addEventListener('click', exitReplay);

document.getElementById('pauseRestart').addEventListener('click', restartGame);
document.getElementById('pauseMenu').addEventListener('click', backToMenu);

window.addEventListener('resize', resizeCanvas);
document.addEventListener('fullscreenchange', () => {
  resizeCanvas();
  updateFullscreenButton();
});
bindResultMinimize();

/* ============================================================
   主循环
   ============================================================ */
let lastTime = 0;
let accumulator = 0;

function stepSimulation() {
  // 输入 → 指令 → 会话（联机时 session 会把指令发出去 / 合并远端指令）
  for (const cmd of readCommands()) session.submitCommand(cmd);
  session.step(SIM_DT);
}

function loop(now) {
  requestAnimationFrame(loop);

  let dt = (now - (lastTime || now)) / 1000;
  lastTime = now;
  dt = Math.min(dt, MAX_FRAME_DT);

  const worldLive = inMatch() && !gstate.paused && !gstate.matchOver;

  if (worldLive) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= SIM_DT && steps < SIM_MAX_STEPS_PER_FRAME) {
      stepSimulation();
      accumulator -= SIM_DT;
      steps++;
    }
    // 掉帧太狠时丢掉积压，避免“追帧”把一次卡顿放大成连续卡顿
    if (steps >= SIM_MAX_STEPS_PER_FRAME) accumulator = 0;
    if (session.mode !== MODE.GUEST) {
      gstate.renderAlpha = clamp(accumulator / SIM_DT, 0, 1);
    }
  } else {
    accumulator = 0;
    if (gstate.state === 'replay') replayTick(dt);
  }

  // 表现层：倒计时数字、结果动画推进
  updateFlow(dt);

  // 渲染：回放走单独路径（从快照重建上帝视角）
  if (gstate.state === 'replay') {
    const t = gstate.replayElapsed || 0;
    beginWorldTransform();
    renderReplay(t, currentReplayFrame(), currentReplayEntities());
  } else {
    render();
  }

  updateHUD();
}

/* ============================================================
   启动
   ============================================================ */
resizeCanvas();
updateFullscreenButton();
showMenu();
requestAnimationFrame(loop);

export { session, startGame };
