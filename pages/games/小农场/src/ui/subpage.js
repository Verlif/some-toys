/**
 * 子页面容器：全屏右滑面板，负责标题、金币同步、内容渲染与动作分发。
 * 具体页面由 subpages/ 下的模块注册进来。
 */
import { byId, delegate } from '../core/dom.js';
import { SUBPAGE_TITLES } from '../data/navigation.js';
import { state } from '../store/state.js';
import { subpages } from './subpages/index.js';
import { dragToClose } from './drag-close.js';

let root = null;
let titleEl = null;
let coinsEl = null;
let body = null;
let footEl = null;
let current = null;

/** 子页面是否处于打开状态 */
const isOpen = () => Boolean(root?.classList.contains('show'));

/** 同步子页面顶部的金币显示 */
export function syncCoins() {
  if (coinsEl) coinsEl.textContent = state.player.coins;
}

/**
 * 重绘当前子页面（数据变化时调用）
 * 底栏（固定在底部、不随内容滚动）由页面通过 setFoot 声明。
 */
export function renderCurrent() {
  if (!current || !isOpen()) return;
  const page = subpages[current];
  page?.render(body, { syncCoins, setFoot });
}

/**
 * 设置子页面底栏。内容不参与滚动，固定在底部。
 * @param {string} html
 */
export function setFoot(html) {
  if (!footEl) return;
  footEl.innerHTML = html || '';
  footEl.hidden = !html;
}

/**
 * 打开子页面
 * @param {string} key 子页面注册 key
 */
export function openSubpage(key) {
  if (!subpages[key]) return;
  current = key;
  titleEl.textContent = SUBPAGE_TITLES[key] || '功能';
  syncCoins();
  body.scrollTop = 0;
  setFoot('');
  // 必须先加 .show 再渲染：renderCurrent 内部有 isOpen() 判断，
  // 顺序反了的话内容永远不会被渲染出来。
  root.classList.add('show');
  renderCurrent();
}

/** 关闭子页面 */
export function closeSubpage() {
  root?.classList.remove('show');
  current = null;
}

/** 绑定关闭按钮、页面内动作分发与下拉关闭手势 */
export function mountSubpage() {
  root = byId('subpage');
  titleEl = byId('subpageTitle');
  coinsEl = byId('subCoins');
  body = byId('subpageBody');
  footEl = byId('subpageFoot');

  byId('subBack').addEventListener('click', closeSubpage);
  dragToClose(root, { onClose: closeSubpage, scrollArea: body });

  delegate(body, 'click', '[data-action]', (el, event) => {
    const page = subpages[current];
    const handler = page?.actions?.[el.dataset.action];
    if (!handler) return;
    event.preventDefault();
    Promise.resolve(handler(el, { closeSubpage, renderCurrent, syncCoins, setFoot })).then(renderCurrent);
  });

  // 底栏里的按钮同样走动作分发
  delegate(footEl, 'click', '[data-action]', (el, event) => {
    const page = subpages[current];
    const handler = page?.actions?.[el.dataset.action];
    if (!handler) return;
    event.preventDefault();
    Promise.resolve(handler(el, { closeSubpage, renderCurrent, syncCoins, setFoot })).then(renderCurrent);
  });
}