/**
 * 「更多功能」底部浮窗。入口与标题来自 data/navigation.js，
 * ready=false 的功能点击后提示开发中。
 */
import { byId, delegate, setHTML } from '../core/dom.js';
import { MORE_MENU_ITEMS, NOT_READY_TOAST } from '../data/navigation.js';
import { openSubpage } from './subpage.js';
import { openAdventureLauncher } from './adventure.js';
import { showToast } from './toast.js';
import { dragToClose } from './drag-close.js';

let root = null;

export function openSheet() {
  if (!root) return;
  root.classList.add('show');
}

export function closeSheet() {
  if (!root) return;
  root.classList.remove('show');
}

function renderGrid() {
  const grid = byId('sheetGrid');
  setHTML(grid, MORE_MENU_ITEMS.map((item) => `
    <button class="sheet-item ${item.ready ? '' : 'locked'}" data-sub="${item.key}">
      <span class="ico">${item.icon}</span>
      <span>${item.label}</span>
    </button>
  `).join(''));
}

/** 渲染入口并绑定交互 */
export function mountSheet() {
  root = byId('sheet');
  renderGrid();

  const panel = root.querySelector('.sheet-panel');
  delegate(root, 'click', '[data-close-sheet]', () => closeSheet());
  dragToClose(panel, { onClose: closeSheet, scrollArea: panel });
  delegate(byId('sheetGrid'), 'click', '[data-sub]', (btn) => {
    const item = MORE_MENU_ITEMS.find((i) => i.key === btn.dataset.sub);
    if (!item) return;

    if (!item.ready) {
      showToast(NOT_READY_TOAST);
      return;
    }
    closeSheet();
    // 等浮窗收起动画走完再推开子页面，避免两层位移打架
    setTimeout(() => {
      if (item.action === 'adventure') openAdventureLauncher();
      else openSubpage(item.key);
    }, 130);
  });
}