/**
 * 时间系统。
 *
 * 全部游戏逻辑都用 nowSec()（暂停时不前进）；
 * 渲染使用 visualNowSec()，结算/结果动画阶段会停在冻结的那一帧，
 * 这样墙壁残留与探测闪烁会保留最后一帧而不是继续淡出。
 */
import { gstate } from './state.js';

let totalPausedMs = 0;
let pauseStartMs = 0;

/** 游戏逻辑时间（秒），暂停期间不前进 */
export function nowSec() {
  return (performance.now() - totalPausedMs) / 1000;
}

/** 表现层时间：结算阶段冻结 */
export function visualNowSec() {
  if ((gstate.state === 'over' || gstate.state === 'resultAnimation') && gstate.frozenRenderTime !== null) {
    return gstate.frozenRenderTime;
  }
  return nowSec();
}

export function beginPause() {
  pauseStartMs = performance.now();
}

export function endPause() {
  totalPausedMs += performance.now() - pauseStartMs;
}

/** 重置计时基准（重开 / 返回菜单时调用，避免暂停累计量污染新对局） */
export function resetTimeBase() {
  totalPausedMs = 0;
  pauseStartMs = 0;
}
