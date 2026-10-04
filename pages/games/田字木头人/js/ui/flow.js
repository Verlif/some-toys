/**
 * 流程控制：对局中与菜单之间的状态切换。
 *
 * 目前只有暂停 / 继续——按下 ESC 时冻结世界并弹出暂停面板。
 * 放在这里而不是 game/ 里，是为了让 game 层不依赖 DOM。
 */
import { world } from '../game/state.js';
import { clearKeys } from '../input/keyboard.js';
import { clearTouch } from '../input/touch.js';
import { hideOverlay } from './overlay.js';
import { showPauseMenu } from './screens.js';

export function togglePause() {
  if (!world || world.over) return;

  world.paused = !world.paused;

  if (world.paused) {
    /* 松开所有键，避免暂停期间「攒着」一个前进指令 */
    clearKeys();
    clearTouch();
    showPauseMenu();
  } else {
    hideOverlay();
  }
}
