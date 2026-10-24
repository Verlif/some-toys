/**
 * 底部主导航：农场 / 邻居 / 商店，以及打开「更多功能」浮窗。
 */
import { byId, delegate } from '../core/dom.js';
import { on, EVENTS } from '../core/bus.js';
import { renderFarm } from './views/farm.js';
import { renderShop, setShopTab } from './views/shop.js';
import { enterFriendsPage } from './views/friends.js';
import { enterCenterPage } from './views/center.js';
import { openSheet } from './sheet.js';
import { openVillage } from './village-sheet.js';

/** 页面 id → 进入该页时要做的事。邻居页特殊一些：进入时要先补算离线结算。 */
const PAGE_ENTER = {
  farm: renderFarm,
  friends: enterFriendsPage,
  center: enterCenterPage,
  shop: renderShop,
};

let current = 'farm';

/** 当前所在的主页面 */
export const currentPage = () => current;

/**
 * 切换到某个主页面。
 *
 * options.tab 只对商店有意义：外部跳转（买种子 / 买藏宝图）时
 * 要直接落到对应的售卖类型，而不是让玩家自己再点一次 tab。
 *
 * @param {string} name
 * @param {{tab?: string}} [options]
 */
export function activatePage(name, options = {}) {
  const enter = PAGE_ENTER[name];
  if (!enter) return;
  if (name === 'shop' && options.tab) setShopTab(options.tab);

  current = name;
  // 让 CSS 能按页面做显隐（农场页的日志按钮就靠它）
  document.body.dataset.page = name;

  for (const btn of document.querySelectorAll('#tabbar button')) {
    btn.classList.toggle('active', btn.dataset.page === name);
  }
  for (const section of document.querySelectorAll('.page')) {
    section.classList.toggle('active', section.id === `page-${name}`);
  }

  enter();
}

/**
 * 把底部导航的实际高度写进 CSS 变量。
 * 商店页是固定高度的（每个 tab 各自滚动），要给导航条留出准确的高度，
 * 否则刘海屏上最后一行会被压在导航底下。
 */
function syncTabHeight() {
  const bar = byId('tabbar');
  if (bar) document.documentElement.style.setProperty('--tab-h', `${bar.offsetHeight}px`);
}

/** 绑定导航点击 */
export function mountTabs() {
  delegate(byId('tabbar'), 'click', 'button', (btn) => {
    if (btn.dataset.sheet !== undefined) {
      openSheet();
      return;
    }
    // 村镇不是主页面，是一个浮窗（进村后才在中间出现）
    if (btn.dataset.village !== undefined) {
      openVillage();
      return;
    }
    activatePage(btn.dataset.page);
  });

  syncTabHeight();
  window.addEventListener('resize', syncTabHeight);
  window.addEventListener('orientationchange', syncTabHeight);

  // 别处（比如播种弹窗里的「商店」按钮）可以通过事件总线请求切页，
  // 这样视图之间不必互相 import，也就不会绕出循环依赖。
  // payload 可以是页面名，也可以是 { page, tab }
  on(EVENTS.NAVIGATE, (payload) => {
    if (typeof payload === 'string') activatePage(payload);
    else if (payload?.page) activatePage(payload.page, payload);
  });
}