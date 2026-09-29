/**
 * 玩家输入。
 *
 * 单人：WASD / 方向键移动，Shift 快步，空格噪声
 * 双人：P1 = WASD + 左 Shift + 空格；P2 = 方向键 + Backspace + Enter
 */
import { BASE_SPEED, WALK_MUL, RUN_MUL, SEEKER_SPEED_MUL } from '../core/config.js';
import { gstate, keys } from '../core/state.js';
import { moveEntity } from '../world/collision.js';
import { tryEmitNoise } from '../audio/sound.js';
import { showToast, hideToast } from '../ui/hud.js';

/** 重开确认：两次 R 之间的最大间隔 */
const RESET_CONFIRM_MS = 1000;
let R_ARMED_UNTIL = 0;

function showResetHint() {
  showToast('再按一次 R 重新开始', RESET_CONFIRM_MS);
}
function hideResetHint() {
  hideToast();
}

export function handlePlayerInput(dt) {
  if (gstate.spectator || !gstate.players.length) return;

  for (const p of gstate.players) {
    if (!p) continue;
    if (p.type === 'hider' && !p.alive) continue;

    let vx = 0, vy = 0;
    if (p.controlScheme === 'p2') {
      if (keys['arrowup']) vy--;
      if (keys['arrowdown']) vy++;
      if (keys['arrowleft']) vx--;
      if (keys['arrowright']) vx++;
      p.speedMode = keys['backspace'] ? 'run' : 'walk';
    } else {
      if (keys['w']) vy--;
      if (keys['s']) vy++;
      if (keys['a']) vx--;
      if (keys['d']) vx++;
      p.speedMode = keys['shift'] ? 'run' : 'walk';
    }

    if (!vx && !vy) continue;

    const l = Math.hypot(vx, vy);
    vx /= l; vy /= l;
    const seekerMul = (p.type === 'seeker') ? SEEKER_SPEED_MUL : 1;
    const mul = (p.speedMode === 'run' ? RUN_MUL : WALK_MUL) * seekerMul;
    moveEntity(p, vx * BASE_SPEED * mul * dt, vy * BASE_SPEED * mul * dt);
  }
}

/**
 * 绑定键盘与窗口事件。
 * @param {object} actions 由 entry.js 注入的流程回调
 *        { setPaused, exitReplay, showMenu, replayTogglePlay }
 */
export function bindInput(actions) {
  const { setPaused, exitReplay, showMenu, replayTogglePlay } = actions;

  // 空格会让「当前获得焦点的按钮」被浏览器当作点击激活。
  // 全屏/暂停菜单按钮点过之后会保留焦点，于是对局中按空格式噪声就会顺带
  // 触发那个按钮 —— 这正是「按空格有一定概率重新开始」的来源。
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
      R_ARMED_UNTIL = 0;   // 暂停/继续会打断重开确认，避免误触
      if (gstate.state === 'playing') setPaused(!gstate.paused);
      else if (gstate.state === 'replay') exitReplay();
      return;
    }

    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'enter', 'backspace'].includes(k)) {
      e.preventDefault();
    }

    // 重开需要按两次 R 确认，避免与 WASD / 空格的连按混在一起误触
    if (k === 'r' && !e.repeat && gstate.state !== 'menu') {
      e.preventDefault();
      const nowT = performance.now();
      if (nowT <= R_ARMED_UNTIL) {
        R_ARMED_UNTIL = 0;
        hideResetHint();
        showMenu();
      } else {
        R_ARMED_UNTIL = nowT + RESET_CONFIRM_MS;
        showResetHint();
      }
    }
    if (k === 'shift' || k === 'backspace') e.preventDefault();

    // P1 噪声
    if ((e.code === 'Space' || e.key === ' ') && !e.repeat) {
      e.preventDefault();
      const p1 = gstate.players[0];
      if (gstate.state === 'playing' && !gstate.spectator && !gstate.paused && p1 && p1.isPlayer) {
        tryEmitNoise(p1);
      }
    }

    // P2 噪声
    if (k === 'enter' && !e.repeat) {
      e.preventDefault();
      const p2 = gstate.players[1];
      if (gstate.state === 'playing' && !gstate.spectator && !gstate.paused && p2 && p2.isPlayer) {
        tryEmitNoise(p2);
      }
    }
  });

  window.addEventListener('keyup', e => {
    keys[e.key.toLowerCase()] = false;
  });

  // 失焦时清空按键，避免切窗口后角色“自己一直走”
  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
  });

  return { replayTogglePlay };
}
