/**
 * 键盘输入：拦截会滚动页面的按键，记录按键状态供模拟层查询。
 * ESC 不写入 keys，而是通过回调交给 ui/flow 处理暂停。
 */
import { BLOCKED_KEYS } from '../core/config.js';
import { game } from '../core/state.js';

export function initKeyboard({ onEscape }) {
  window.addEventListener('keydown', e => {
    if (BLOCKED_KEYS.includes(e.code)) e.preventDefault();

    if (e.code === 'Escape') {
      onEscape();
      return;
    }

    game.keys[e.code] = true;
  });

  window.addEventListener('keyup', e => { game.keys[e.code] = false; });
  window.addEventListener('blur', () => { game.keys = {}; });
}
