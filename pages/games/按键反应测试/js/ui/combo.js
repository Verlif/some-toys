/**
 * 连击反馈：每次命中让键盘震一下，并在键盘上弹出连击计数。
 * 按错或超过 TIMEOUT 没有按键就断连。
 */

import { el } from '../utils/dom.js';

const TIMEOUT = 1500;
const HOT = 10;
const BLAZE = 20;

/**
 * @param {HTMLElement} board 键盘根元素（需 position: relative）
 */
export function createCombo(board) {
  const valueEl = el('span', { class: 'combo-value', text: '0' });
  const badge = el('div', { class: 'combo-badge' }, [
    el('span', { class: 'combo-label', text: 'COMBO' }),
    valueEl
  ]);
  board.appendChild(badge);

  let combo = 0;
  let best = 0;
  let timer = null;

  function paint() {
    valueEl.textContent = String(combo);
    badge.classList.toggle('is-on', combo > 1);
    badge.classList.toggle('is-hot', combo >= HOT && combo < BLAZE);
    badge.classList.toggle('is-blaze', combo >= BLAZE);
  }

  function breakCombo() {
    clearTimeout(timer);
    timer = null;
    combo = 0;
    paint();
  }

  function hit() {
    combo += 1;
    best = Math.max(best, combo);
    paint();

    badge.classList.remove('is-pop');
    void badge.offsetWidth;
    badge.classList.add('is-pop');

    board.classList.remove('is-hitting');
    void board.offsetWidth;
    board.classList.add('is-hitting');

    clearTimeout(timer);
    timer = setTimeout(breakCombo, TIMEOUT);
  }

  return {
    hit,
    miss: breakCombo,
    get best() { return best; },
    destroy() {
      clearTimeout(timer);
      board.classList.remove('is-hitting');
      badge.remove();
    }
  };
}
