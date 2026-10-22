/**
 * 组合根：负责启动顺序与跨模块的订阅接线。
 *
 * 启动流程：
 *   打开数据库 → 读档 → 挂载各 UI 模块 → 首帧渲染 → 补算邻居近况 → 启动心跳
 *
 * 前两步和最后的补算都要花时间，所以整个流程用启动画面裹起来，
 * 并把当前在做的事写在画面上（「正在连接到农场」/「正在进入农场」）。
 */
import { openDatabase } from './core/db.js';
import { on, EVENTS } from './core/bus.js';
import { initState } from './store/state.js';
import { autoSignIn } from './store/signin.js';

import { bootDone, bootFail, bootProgress, bootStage } from './ui/boot.js';
import { mountToast } from './ui/toast.js';
import { mountModal } from './ui/modal.js';
import { mountInlineActions } from './ui/inline-actions.js';
import { mountSignCelebrate } from './ui/sign-celebrate.js';
import { mountDogCaught } from './ui/dog-caught.js';
import { flushOfflineGifts, mountGift } from './ui/gift.js';
import { mountPeerGift } from './ui/peer-gift.js';
import { mountVillage } from './ui/village-sheet.js';
import { mountHud, renderHud } from './ui/hud.js';
import { mountSubpage, renderCurrent, syncCoins } from './ui/subpage.js';
import { mountSheet } from './ui/sheet.js';
import { mountLogSheet } from './ui/log-sheet.js';
import { mountAdventure } from './ui/adventure.js';
import { mountTabs, activatePage, currentPage } from './ui/tabs.js';
import { mountFarm, renderFarm } from './ui/views/farm.js';
import { mountShop, renderShop } from './ui/views/shop.js';
import { mountFriends, renderFriends, checkOnlineVisits } from './ui/views/friends.js';
import { mountNews, renderNews } from './ui/views/news.js';
import { markSessionStart, pollOnline } from './store/social.js';
import { initPeers, joinVillage, villageConfig } from './store/peers.js';
import { initPeerGift } from './store/peer-gift.js';
import { initPeerActions } from './store/peer-actions.js';

/** 地块倒计时刷新间隔 */
const TICK_MS = 500;

/**
 * 邻居上线检查间隔。
 *
 * 邻居的上线节奏是几小时一次，所以一分钟查一次足够；
 * 但也不能太慢 —— 玩家切回标签页时该立刻看到「谁上线了」。
 */
const VISIT_POLL_MS = 60_000;

async function boot() {
  /* ① 连接数据库 */
  bootStage('正在连接到农场', '打开本地存档…', 8);
  await openDatabase();

  /* ② 读档：所有农场、地块、日志、背包一次读全 */
  bootStage('正在进入农场', '读取农场档案…', 22);
  await initState();

  /* ③ 挂载界面，再首帧渲染（顺序反了会漏掉事件） */
  bootStage('正在进入农场', '搭建农场…', 34);
  mountToast();
  mountModal();
  mountInlineActions();
  mountSignCelebrate();
  mountDogCaught();
  mountGift();
  mountPeerGift();
  mountVillage();
  mountHud();
  mountSubpage();
  mountSheet();
  mountLogSheet();
  mountAdventure();
  mountFarm();
  mountShop();
  mountFriends();
  mountNews();
  mountTabs();

  renderHud();
  renderFarm();
  renderShop();
  renderFriends();
  renderNews();
  activatePage('farm');

  // 子页面顶部的金币与内容跟随状态变化
  on(EVENTS.PLAYER, syncCoins);
  on(EVENTS.INVENTORY, renderCurrent);
  on(EVENTS.PETS, renderCurrent);
  on(EVENTS.FRIENDS, renderCurrent);
  on(EVENTS.SIGN, renderCurrent);
  on(EVENTS.CODEX, renderCurrent);
  on(EVENTS.TITLES, renderCurrent);

  /* ④ 补算玩家不在时邻居做的事。离线久了会分很多帧，所以带进度 */
  bootStage('正在进入农场', '看看邻居们干了什么…', 44);
  markSessionStart();
  await pollOnline((done, total) => {
    // total 只是估算（上线间隔带随机），所以夹住比例，别让进度条冲过头
    const ratio = total > 0 ? Math.min(1, done / total) : 1;
    bootProgress(
      44 + Math.round(ratio * 50),
      total > 0 ? '邻居们正在打理农场…' : '邻居们最近很清闲',
    );
  });

  await bootDone();

  // 离线期间邻居送的礼：启动画面收起来之后再整屏补播
  flushOfflineGifts();

  // 联机：上次是「在村镇里」就自动回去；主动退出过的人不再打扰
  initPeers();
  initPeerGift();
  initPeerActions();
  const village = villageConfig();
  if (village.name && village.auto) {
    joinVillage(village.name, village.password).catch((error) => console.error(error));
  }

  /* ⑤ 心跳与轮询 */
  // 心跳只在农场页可见时刷新地块
  setInterval(() => {
    if (currentPage() === 'farm') renderFarm();
  }, TICK_MS);

  // 邻居的成长在玩家在线时持续推进：他们上线时弹一条提示，
  // 之后每做一件事（顺菜、照料）都隔几秒才发生，见 store/social.js
  setInterval(() => {
    if (document.hidden) return;
    checkOnlineVisits();
  }, VISIT_POLL_MS);

  // 从后台切回来时立刻补一次渲染，避免看到过期的倒计时
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    renderFarm();
    renderCurrent();
    // 切回来时可能已经过了邻居的上线点，立刻查一次
    checkOnlineVisits();
  });

  // 打开页面就结算今天的签到：已签过什么都不做，未签则发奖并播庆祝画面。
  // 签到写库失败不该拦住进游戏，下次打开会再试一次
  try {
    await autoSignIn();
  } catch (error) {
    console.error(error);
  }
}

boot().catch((error) => {
  console.error(error);
  bootFail(error?.message || '未知错误，刷新页面再试试');
});
