/**
 * 键盘输入：只负责记录「哪些键正被按住」，不含任何游戏语义。
 *
 * ESC 的处理由调用方注入（onEscape），这样输入层不需要反向依赖游戏流程，
 * 也避免了 input → game → input 的循环引用。
 */

/** 键名（小写）→ 是否按下 */
export const keyState = {};

/** 清空按键状态：开局、暂停、窗口失焦时调用 */
export function clearKeys() {
  for (const k in keyState) keyState[k] = false;
}

/**
 * @param {{ onEscape?: () => void }} handlers ESC 回调（暂停 / 继续）
 */
export function initKeyboard({ onEscape } = {}) {
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      e.preventDefault();
      if (onEscape) onEscape();
      return;
    }
    if (!keyState[k]) keyState[k] = true;
    /* 阻止空格滚动页面、方向键滚动页面 */
    if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    keyState[k] = false;
    if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
  });

  /* 切走窗口时松开所有键，避免回来还在「一直前进」 */
  window.addEventListener('blur', clearKeys);
}
