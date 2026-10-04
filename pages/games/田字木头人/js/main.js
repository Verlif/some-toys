/**
 * 应用入口：装配各层 → 固定上限的可变步长主循环 → 启动。
 *
 * ── 依赖方向（只允许向下依赖，无循环引用）
 *   core/    配置、工具、视口、音效
 *   input/   键盘 / 触屏 → 语义化输入
 *   game/    状态、实体、写字人、木头人、对局生命周期、每帧推进
 *   render/  背景、粉笔字、角色、HUD、渲染主函数（只读 world）
 *   ui/      覆盖层、面板、流程
 *   main.js  只做装配与主循环，不写任何游戏规则
 *
 * ── 主循环
 *   dt 夹在 0.05 秒以内：卡顿时宁可「慢放」也不让物理一步跨过头，
 *   避免木头人瞬间穿到写字人身上。
 */
import { initViewport } from './core/viewport.js';
import { initKeyboard } from './input/keyboard.js';
import { initTouch } from './input/touch.js';
import { update } from './game/simulation.js';
import { render } from './render/renderer.js';
import { showStartScreen } from './ui/screens.js';
import { togglePause } from './ui/flow.js';

let lastTime = performance.now();

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

function boot() {
  initViewport();
  initKeyboard({ onEscape: togglePause });
  initTouch();
  showStartScreen();
  requestAnimationFrame(loop);
}

boot();
