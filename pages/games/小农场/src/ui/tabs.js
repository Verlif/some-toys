/**
 * 底部主导航：农场 / 邻居 / 商店，以及打开「更多功能」浮窗。
 */
import { byId, delegate } from '../core/dom.js';
import { on, EVENTS } from '../core/bus.js';
import { renderFarm } from './views/farm.js';
import { renderShop } from './views/shop.js';
import { enterFriendsPage } from './views/friends.js';
import { openSheet } from './sheet.js';

/** 页面 id → 进入该页时要做的事。邻居页特殊一些：进入时要先补算离线结算。 */
const PAGE_ENTER = {
  farm: renderFarm,
  friends: enterFriendsPage,
  shop: renderShop,
};

let current = 'farm';

/** 当前所在的主页面 */
export const currentPage = () => current;

/** 切换到某个主页面 */
export function activatePage(name) {
  const enter = PAGE_ENTER[name];
  if (!enter) return;
  current = name;

  for (const btn of document.querySelectorAll('#tabbar button')) {
    btn.classList.toggle('active', btn.dataset.page === name);
  }
  for (const section of document.querySelectorAll('.page')) {
    section.classList.toggle('active', section.id === `page-${name}`);
  }

  enter();
}

/** 绑定导航点击 */
export function mountTabs() {
  delegate(byId('tabbar'), 'click', 'button', (btn) => {
    if (btn.dataset.sheet !== undefined) {
      openSheet();
      return;
    }
    activatePage(btn.dataset.page);
  });

  // 别处（比如播种弹窗里的「商店」按钮）可以通过事件总线请求切页，
  // 这样视图之间不必互相 import，也就不会绕出循环依赖
  on(EVENTS.NAVIGATE, (page) => activatePage(page));
}