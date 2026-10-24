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
import { settleDogDig } from './store/dogs.js';
import { compensateLitSeeds } from './store/codex.js';

import { bootDone, bootFail, bootProgress, bootStage } from './ui/boot.js';
import { mountToast } from './ui/toast.js';
import { mountModal } from './ui/modal.js';
import { mountInlineActions } from './ui/inline-actions.js';
import { mountSignCelebrate } from './ui/sign-celebrate.js';
import { mountDogCaught } from './ui/dog-caught.js';
import { mountBoardCelebrate } from './ui/board-celebrate.js';
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
import { mountCenter, renderCenter } from './ui/views/center.js';
import { markSessionStart, pollOnline } from './store/social.js';
import { checkRollover, flushDaily, migrateBoardRows } from './store/daily.js';
import { initPeers, joinVillage, villageConfig } from './store/peers.js';
import { initPeerGift } from './store/peer-gift.js';
import { initPeerActions } from './store/peer-actions.js';
import { notify } from './store/notify.js';

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
  mountBoardCelebrate();
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
  mountCenter();
  mountTabs();

  renderHud();
  renderFarm();
  renderShop();
  renderFriends();
  renderCenter();
  activatePage('farm');

  // 子页面顶部的金币与内容跟随状态变化
  on(EVENTS.PLAYER, syncCoins);
  on(EVENTS.INVENTORY, renderCurrent);
  on(EVENTS.PETS, renderCurrent);
  on(EVENTS.FRIENDS, renderCurrent);
  on(EVENTS.SIGN, renderCurrent);
  on(EVENTS.CODEX, renderCurrent);
  on(EVENTS.TITLES, renderCurrent);
  on(EVENTS.DAILY, renderCurrent);
  on(EVENTS.STATS, renderCurrent);

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

  mountServiceWorker();

  // iOS Safari 的 IndexedDB 7 天清理风险：两层防护
  // ① 申请持久化存储（Chrome/Safari 都支持）
  // ② iOS 且未添加到主屏时提示玩家添加（独立应用模式下 Safari 不会清存档）
  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (isIOS && !isStandalone && !localStorage.getItem('ximi_a2hs_hint')) {
    localStorage.setItem('ximi_a2hs_hint', '1');
    // 延迟 3 秒再弹，等首页渲染稳定
    setTimeout(() => {
      notify('💡 把本页「添加到主屏幕」可防止 Safari 清理存档（7 天不访问会被清）', 'gold');
    }, 3000);
  }

  // 离线期间邻居送的礼：启动画面收起来之后再整屏补播
  flushOfflineGifts();

  // 每日榜单：先确认账期版本（旧版 0 点账期的行与新账期同键不同义，整表清一次），
  // 再补算跨越了几天、已经到期的期次 —— 必须在 settleWorld 之后，
  // 补算出来的邻居行为才会记进正确的期次
  try {
    await migrateBoardRows();
  } catch (error) {
    console.error(error);
  }
  checkRollover();

  // 守护犬每日挖宝：离线期间按天补掷（最多 7 天），启动时先结一次
  try {
    await settleDogDig();
  } catch (error) {
    console.error(error);
  }

  // 图鉴点亮奖种子是第 43 轮新增的：老档已点亮的图鉴在这里一次性补发
  try {
    await compensateLitSeeds();
  } catch (error) {
    console.error(error);
  }

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
  // 之后每做一件事（顺菜、照料）都隔几秒才发生，见 store/social.js。
  // 同一个轮次上还挂着三件「跨天」的事：
  //   - 每日排行榜：0 点那一刻正好在线上，分钟级发现翻日就当场结算并发 toast；
  //   - 自动签到：翻日也自动把今天的签到领了（已签过则什么都不做），
  //     庆祝画面照播，与开机时那次一致；
  //   - 守护犬挖宝：翻日把「昨天」的挖宝掷了（离线补掷在启动时做）。
  setInterval(() => {
    if (document.hidden) return;
    checkOnlineVisits();
    checkRollover();
    autoSignIn().catch((error) => console.error(error));
    settleDogDig().catch((error) => console.error(error));
    // 时间驱动的界面刷新：邻居的在线圆点、订单页的时限倒计时
    emit(EVENTS.TICK);
  }, VISIT_POLL_MS);

  // 从后台切回来时立刻补一次渲染，避免看到过期的倒计时
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // 记账是防抖落盘的，藏进后台前把排队的那次写掉
      flushDaily();
      return;
    }
    renderFarm();
    renderCurrent();
    // 切回来时可能已经过了邻居的上线点，立刻查一次；
    // 也可能正好跨过了 0 点，顺手把昨日榜单与今天的签到都结算了
    checkOnlineVisits();
    checkRollover();
    autoSignIn().catch((error) => console.error(error));
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

/**
 * 注册 Service Worker。
 *
 * 只有一件事必须做对：`updateViaCache: 'none'` —— 别让浏览器用 HTTP 缓存里的
 * sw.js 判断「有没有新版本」，否则新 SW 永远装不上，缓存策略会一直停在老版本。
 *
 * 新版本接管后的刷新由 sw.js 自己负责（它在 activate 里发现旧缓存就让页面重载），
 * 这里**不要**再监听 controllerchange 去 reload —— 两处都做会白刷一次。
 *
 * 地址后面加 `?nosw` 是开发开关：注销 SW 并清空所有缓存，
 * 适合「改了 CSS 死活不生效」的时候一次性把环境擦干净。
 */
function mountServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  if (new URLSearchParams(location.search).has('nosw')) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
      .then(() => (caches ? caches.keys() : []))
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => console.info('[sw] 已注销 Service Worker 并清空缓存，之后每次都是最新文件'))
      .catch((error) => console.error(error));
    return;
  }

  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    // 注册后立刻查一次更新：不然要等浏览器自己想到（可能几十分钟后）
    .then((reg) => reg.update())
    .catch(() => {});
}
