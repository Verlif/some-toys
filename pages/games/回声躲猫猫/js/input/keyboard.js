/**
 * 键盘输入 → 玩家指令。
 *
 * 这一层只做两件事：
 *   1. 读键盘 → 生成 core/command.js 的 PlayerCommand（可序列化，联机时同一条路）；
 *   2. 把全局快捷键（暂停 / 重开 / 返回菜单）交给注入的回调，自己不碰 UI。
 *
 * 单人：WASD / 方向键移动，Shift 快步，空格噪声
 * 双人：P1 = WASD + 左 Shift + 空格；P2 = 方向键 + Backspace + Enter
 */
import { gstate, keys } from '../core/state.js';
import { makeCommand } from '../core/command.js';

/** 重开确认：两次 R 之间的最大间隔 */
const RESET_CONFIRM_MS = 1000;
let resetArmedUntil = 0;

/** 一次性动作（噪声）：按下的瞬间记下来，下一次读指令时消费掉 */
const pendingNoise = [false, false];

/** 读取当前键盘状态，生成每位玩家的指令 */
export function readCommands() {
  const out = [];
  const count = Math.max(1, gstate.players.length);
  for (let i = 0; i < count; i++) {
    const p = gstate.players[i];
    if (!p) continue;
    let mx = 0, my = 0;
    if (p.controlScheme === 'p2') {
      if (keys['arrowup']) my--;
      if (keys['arrowdown']) my++;
      if (keys['arrowleft']) mx--;
      if (keys['arrowright']) mx++;
    } else {
      if (keys['w']) my--;
      if (keys['s']) my++;
      if (keys['a']) mx--;
      if (keys['d']) mx++;
    }
    const run = p.controlScheme === 'p2' ? !!keys['backspace'] : !!keys['shift'];
    const noise = !!pendingNoise[i];
    pendingNoise[i] = false;
    out.push(makeCommand(i, { moveX: mx, moveY: my, run, noise }));
  }
  return out;
}

/**
 * 绑定键盘与窗口事件。
 * @param {object} actions 由 main.js 注入的流程回调
 *        { togglePause, openMenu, onResetHint, onResetCancel }
 */
export function bindKeyboard(actions = {}) {
  const { togglePause, openMenu, onResetHint, onResetCancel } = actions;

  // 空格会让「当前获得焦点的按钮」被浏览器当作点击激活。
  // 在捕获阶段拦掉默认行为（preventDefault 对空格/回车只在捕获阶段有效），
  // 再加上点击后主动失焦，双保险。
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.key === ' ' || e.key === 'Enter') e.preventDefault();
  }, true);

  const blurFocusedButton = () => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function' && /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(el.tagName || '')) {
      el.blur();
    }
  };
  window.addEventListener('click', blurFocusedButton, true);

  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    keys[k] = true;

    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      resetArmedUntil = 0;   // 暂停/继续会打断重开确认，避免误触
      togglePause?.();
      return;
    }

    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'enter', 'backspace'].includes(k)) {
      e.preventDefault();
    }

    // 重开需要按两次 R 确认，避免与 WASD / 空格的连按混在一起误触
    if (k === 'r' && !e.repeat && gstate.state !== 'menu') {
      e.preventDefault();
      const nowT = performance.now();
      if (nowT <= resetArmedUntil) {
        resetArmedUntil = 0;
        onResetCancel?.();
        openMenu?.();
      } else {
        resetArmedUntil = nowT + RESET_CONFIRM_MS;
        onResetHint?.(RESET_CONFIRM_MS);
      }
    }
    if (k === 'shift' || k === 'backspace') e.preventDefault();

    // 噪声是一次性动作：这里只登记，模拟层按固定步长消费
    if ((e.code === 'Space' || e.key === ' ') && !e.repeat) {
      e.preventDefault();
      pendingNoise[0] = true;
    }
    if (k === 'enter' && !e.repeat) {
      e.preventDefault();
      pendingNoise[1] = true;
    }
  });

  window.addEventListener('keyup', e => {
    keys[e.key.toLowerCase()] = false;
  });

  // 失焦时清空按键，避免切窗口后角色“自己一直走”
  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
  });
}
