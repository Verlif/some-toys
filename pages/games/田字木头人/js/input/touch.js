/**
 * 触屏输入：三个虚拟按钮 → 布尔状态。
 *
 * 桌面端不显示触屏区；触屏设备上由 setTouchLayout() 在对局开始时按模式显示
 * 需要的按钮（谁是人类玩家就显示谁的按钮）。
 */
import { MODE } from '../core/config.js';
import { initAudio } from '../core/audio.js';

/** 是否为触屏设备：决定要不要显示虚拟按钮区 */
const touchEnabled = 'ontouchstart' in window;

/** P1 / P2 是否在按「前进」「制造声响」，写字人是否在按「写字」 */
export const touch = { p1: false, p2: false, write: false, noise1: false, noise2: false };

const touchArea = document.getElementById('touchArea');
const btnP1 = document.getElementById('btnP1');
const btnP2 = document.getElementById('btnP2');
const btnWrite = document.getElementById('btnWrite');
const btnNoise1 = document.getElementById('btnNoise1');
const btnNoise2 = document.getElementById('btnNoise2');

function bindTouch(btn, key) {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    touch[key] = true;
    btn.classList.add('on');
    initAudio();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => {
    btn.addEventListener(ev, () => {
      touch[key] = false;
      btn.classList.remove('on');
    });
  });
}

export function initTouch() {
  bindTouch(btnP1, 'p1');
  bindTouch(btnP2, 'p2');
  bindTouch(btnWrite, 'write');
  bindTouch(btnNoise1, 'noise1');
  bindTouch(btnNoise2, 'noise2');
}

/** 松开全部虚拟按钮并去掉高亮 */
export function clearTouch() {
  touch.p1 = touch.p2 = touch.write = false;
  touch.noise1 = touch.noise2 = false;
  btnP1.classList.remove('on');
  btnP2.classList.remove('on');
  btnWrite.classList.remove('on');
  btnNoise1.classList.remove('on');
  btnNoise2.classList.remove('on');
}

/** 按模式决定显示哪些虚拟按钮 */
export function setTouchLayout(mode) {
  let showArea = false;

  btnWrite.style.display = 'none';
  btnNoise1.style.display = 'none';
  btnNoise2.style.display = 'none';

  const wolfNoise = { 1: false, 2: false };   // 哪个玩家是「人类木头人」

  if (mode === MODE.SOLO_WOLF) {
    btnP1.style.display = 'flex'; btnP2.style.display = 'none'; showArea = true;
    wolfNoise[1] = true;
  } else if (mode === MODE.P1W) {
    btnP1.style.display = 'none'; btnP2.style.display = 'flex'; showArea = true;
    wolfNoise[2] = true;
  } else if (mode === MODE.P2W) {
    btnP1.style.display = 'flex'; btnP2.style.display = 'none'; showArea = true;
    wolfNoise[1] = true;
  } else if (mode === MODE.TWOW) {
    btnP1.style.display = 'flex'; btnP2.style.display = 'flex'; showArea = true;
    wolfNoise[1] = true; wolfNoise[2] = true;
  } else if (mode === MODE.SOLO_WRITER) {
    btnP1.style.display = 'none'; btnP2.style.display = 'none';
    btnWrite.style.display = 'flex'; showArea = true;
  } else {
    btnP1.style.display = 'none'; btnP2.style.display = 'none';
  }

  /* 「制造声响」只给人类木头人 */
  if (wolfNoise[1]) btnNoise1.style.display = 'flex';
  if (wolfNoise[2]) btnNoise2.style.display = 'flex';

  if (touchEnabled) touchArea.style.display = showArea ? 'block' : 'none';
}

/** 回到菜单：整个触屏区收起 */
export function hideTouchControls() {
  touchArea.style.display = 'none';
  btnWrite.style.display = 'none';
  btnNoise1.style.display = 'none';
  btnNoise2.style.display = 'none';
}
