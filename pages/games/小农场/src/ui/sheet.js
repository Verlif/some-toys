/**
 * 「更多功能」底部浮窗。入口与标题来自 data/navigation.js，
 * ready=false 的功能点击后提示开发中。
 */
import { byId, delegate, setHTML } from '../core/dom.js';
import { on, EVENTS } from '../core/bus.js';
import { MORE_MENU_ITEMS, NOT_READY_TOAST } from '../data/navigation.js';
import { openSubpage } from './subpage.js';
import { openAdventureLauncher } from './adventure.js';
import { openVillage } from './village-sheet.js';
import { showToast } from './toast.js';
import { dragToClose } from './drag-close.js';
import { claimableCount } from '../store/titles.js';

let root = null;

export function openSheet() {
  if (!root) return;
  renderGrid();
  root.classList.add('show');
}

export function closeSheet() {
  if (!root) return;
  root.classList.remove('show');
}

function renderGrid() {
  const grid = byId('sheetGrid');
  // 称号有新的可领时挂个红点，别让玩家错过
  const pending = claimableCount();
  setHTML(grid, MORE_MENU_ITEMS.map((item) => `
    <button class="sheet-item ${item.ready ? '' : 'locked'}" data-sub="${item.key}">
      <span class="ico">${item.icon}${item.key === 'titles' && pending ? '<i class="sheet-dot"></i>' : ''}</span>
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
  // 称号可领数量会随等级与图鉴变化，红点要跟着刷新
  on(EVENTS.TITLES, renderGrid);
  on(EVENTS.CODEX, renderGrid);
  on(EVENTS.PLAYER, renderGrid);

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
      else if (item.action === 'village') openVillage();
      else openSubpage(item.key);
    }, 130);
  });
}