/**
 * 界面切换：主菜单 / 选项 / 对局三块 screen，以及暂停、结算两个覆盖层。
 * 处于主菜单时给 body 加 at-menu 类，用来点亮背景演示画布。
 */
import { game } from '../core/state.js';

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('active', s.id === id);
  });
  document.body.classList.toggle('at-menu', id === 'menuScreen');
}

export function hideOverlay(id) {
  document.getElementById(id).classList.add('hidden');
}

export function showOverlay(id) {
  document.getElementById(id).classList.remove('hidden');
}

/** 回到主菜单：清掉所有覆盖层，状态归位 */
export function backToMenu() {
  game.state = 'menu';
  showScreen('menuScreen');
  hideOverlay('pauseOverlay');
  hideOverlay('resultOverlay');
}
