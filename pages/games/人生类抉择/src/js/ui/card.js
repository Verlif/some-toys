/**
 * 抉择卡牌：渲染 + 滑动手势 + 滑动浮窗
 *
 * 卡面不含任何外部图片，头部是纯 CSS + 内联 SVG 的人物标识。
 * 滑动时两侧浮出选项文本（peek），透明度与缩放随拖动距离线性增长，
 * 达到触发阈值时整块高亮并提示「松手即选」。
 */

import { $, svg, setText, reflow } from './dom.js';
import { ICONS } from './icons.js';
import { tuning } from '../core/engine.js';

/** 把一条事件画到卡面上 */
export function renderCard(ev) {
  if (!ev) return;
  $('cardAvatar').innerHTML = svg(ICONS.people);
  setText('cardSpeaker', ev.name);
  setText('cardText', ev.text);
  setText('lblL', ev.left.label);
  setText('lblR', ev.right.label);

  // 浮窗文本与按钮保持一致
  setText('peekLblL', ev.left.label);
  setText('peekLblR', ev.right.label);

  const card = $('card');
  card.classList.remove('out-left', 'out-right');
  reflow(card);
  card.classList.add('enter');
  setTimeout(() => card.classList.remove('enter'), 460);
}

/** 卡牌飞出动画 */
export function flyOut(side) {
  $('card').classList.add(side === 'left' ? 'out-left' : 'out-right');
}

/** 复位卡牌（用于下一张入场前） */
export function resetCard() {
  const card = $('card');
  card.classList.remove('out-left', 'out-right', 'enter');
  card.style.transform = '';
  hidePeeks();
}

/* ---------------- 滑动浮窗 ---------------- */

/**
 * 单侧浮窗的显隐
 * @param {HTMLElement} el 浮窗节点
 * @param {number} t       0~1 的进度（|dx| / 阈值）
 */
function applyPeek(el, t) {
  if (!el) return;
  if (t <= 0.02) {
    el.classList.remove('on', 'hot');
    el.style.opacity = '0';
    el.style.transform = 'scale(.9)';
    return;
  }
  const capped = Math.min(1, t);
  el.classList.add('on');
  el.classList.toggle('hot', capped >= 1);
  el.style.opacity = (0.15 + 0.85 * capped).toFixed(3);
  el.style.transform = `scale(${(0.9 + 0.12 * capped).toFixed(3)})`;
}

/** 拖动中：按位移同时驱动两侧（未激活的一侧自动收起） */
function setPeek(dx, threshold) {
  const t = Math.abs(dx) / threshold;
  applyPeek($('peekL'), dx < 0 ? t : 0);
  applyPeek($('peekR'), dx > 0 ? t : 0);
}

function hidePeeks() {
  applyPeek($('peekL'), 0);
  applyPeek($('peekR'), 0);
}

/**
 * 预览某一侧（鼠标悬停按钮 / 键盘按住方向键时用）
 * @param {'left'|'right'|null} side
 */
export function previewPeek(side) {
  if (!side) { hidePeeks(); return; }
  const el = side === 'left' ? $('peekL') : $('peekR');
  const other = side === 'left' ? $('peekR') : $('peekL');
  applyPeek(other, 0);
  applyPeek(el, 0.62);
}

/**
 * 绑定指针拖拽手势
 * @param {{canDrag: () => boolean, onSwipe: (side:'left'|'right') => void}} ctx
 */
export function initSwipe({ canDrag, onSwipe }) {
  const card = $('card');
  let sx = 0, sy = 0, dx = 0, dragging = false;

  card.addEventListener('pointerdown', e => {
    if (!canDrag()) return;
    dragging = true;
    sx = e.clientX; sy = e.clientY; dx = 0;
    card.classList.add('dragging');
    try { card.setPointerCapture(e.pointerId); } catch (err) { /* 老浏览器忽略 */ }
  });

  card.addEventListener('pointermove', e => {
    if (!dragging) return;
    dx = e.clientX - sx;
    const dy = e.clientY - sy;
    // 纵向滑动为主时让位给页面滚动
    if (Math.abs(dx) < 6 && Math.abs(dy) > 14) return;
    card.style.transform = `translateX(${dx}px) rotate(${dx * 0.05}deg)`;
    setPeek(dx, tuning().swipeThreshold);
  });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove('dragging');
    card.style.transform = '';
    hidePeeks();
    if (Math.abs(dx) > tuning().swipeThreshold) onSwipe(dx < 0 ? 'left' : 'right');
  };

  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', () => {
    dragging = false;
    card.classList.remove('dragging');
    card.style.transform = '';
    hidePeeks();
  });
}
