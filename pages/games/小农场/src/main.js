/**
 * 组合根：负责启动顺序与跨模块的订阅接线。
 *
 * 启动流程：
 *   打开数据库 → 读档 → 挂载各 UI 模块 → 首次渲染 → 启动心跳
 */
import { openDatabase } from './core/db.js';
import { on, EVENTS } from './core/bus.js';
import { initState } from './store/state.js';

import { mountToast } from './ui/toast.js';
import { mountModal } from './ui/modal.js';
import { mountHud, renderHud } from './ui/hud.js';
import { mountSubpage, renderCurrent, syncCoins } from './ui/subpage.js';
import { mountSheet } from './ui/sheet.js';
import { mountTabs, activatePage, currentPage } from './ui/tabs.js';
import { mountFarm, renderFarm } from './ui/views/farm.js';
import { mountShop, renderShop } from './ui/views/shop.js';
import { mountFriends, renderFriends } from './ui/views/friends.js';

/** 地块倒计时刷新间隔 */
const TICK_MS = 500;

async function boot() {
  await openDatabase();
  await initState();

  // 1. 先挂载，2. 再首帧渲染，顺序反了会漏掉事件
  mountToast();
  mountModal();
  mountHud();
  mountSubpage();
  mountSheet();
  mountFarm();
  mountShop();
  mountFriends();
  mountTabs();

  renderHud();
  renderFarm();
  renderShop();
  renderFriends();
  activatePage('farm');

  // 子页面顶部的金币与内容跟随状态变化
  on(EVENTS.PLAYER, syncCoins);
  on(EVENTS.INVENTORY, renderCurrent);
  on(EVENTS.PETS, renderCurrent);
  on(EVENTS.FRIENDS, renderCurrent);
  on(EVENTS.SIGN, renderCurrent);
  on(EVENTS.CODEX, renderCurrent);

  // 邻居的成长不在这里推进——它只在切到邻居页时结算一次，见 enterFriendsPage。
  // 心跳同样只在农场页可见时刷新地块。
  setInterval(() => {
    if (currentPage() === 'farm') renderFarm();
  }, TICK_MS);

  // 从后台切回来时立刻补一次渲染，避免看到过期的倒计时
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    renderFarm();
    renderCurrent();
  });
}

function showFatal(error) {
  console.error(error);
  document.body.innerHTML = `
    <div style="padding:40px;text-align:center;font-family:sans-serif">
      <h2>😵 初始化失败</h2>
      <p style="color:#888;margin-top:10px">${error.message}</p>
    </div>`;
}

boot().catch(showFatal);