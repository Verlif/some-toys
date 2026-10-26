/**
 * 组合根：负责启动顺序与跨模块的订阅接线。
 *
 * 启动流程：
 *   打开数据库 → 读档 → 挂载各 UI 模块 → 首帧渲染 → 世界时钟补算 → 启动心跳
 *
 * 补算这一步（第 46 轮起）走**世界时钟**：从存档里的「上次在线」逐段推进到现在，
 * 邻居上线、订单到期、榜单翻日、收炉都按时间顺序发生，离线一个月回来
 * 看到的是真的过程，不再是聚合公式抹出来的结果。这一步要花时间，
 * 所以整个流程用启动画面裹起来，并把「补算到哪一刻」写在画面上。
 */
import { openDatabase } from './core/db.js';
import { on, EVENTS } from './core/bus.js';
import { clockText } from './core/utils.js';
import { initState } from './store/state.js';
import { autoSignIn, reconcileSignHistory } from './store/signin.js';
import { settleDogDig } from './store/dogs.js';
import { compensateLitSeeds } from './store/codex.js';
import { resumeCraftTimers } from './store/workshop.js';

import { bootDone, bootFail, bootProgress, bootStage } from './ui/boot.js';
import { mountToast } from './ui/toast.js';
import { mountModal } from './ui/modal.js';
import { mountInlineActions } from './ui/inline-actions.js';
import { mountSignCelebrate } from './ui/sign-celebrate.js';
import { mountCodexCelebrate } from './ui/codex-celebrate.js';
import { mountDogCaught } from './ui/dog-caught.js';
import { mountBoardCelebrate, celebratePending } from './ui/board-celebrate.js';
import { showOfflineReport, wantsReport } from './ui/offline-report.js';
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
import { markSessionStart, pollOnline, takeOfflineSummary, touchLastSeen } from './store/social.js';
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
  mountCodexCelebrate();
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

  /* ④ 世界时钟：从「上次在线」逐段推进到现在，邻居们干的每一件事都在这时发生 */
  bootStage('正在进入农场', '看看邻居们干了什么…', 44);
  markSessionStart();
  let settleResult = null;
  try {
    settleResult = await pollOnline((progress) => {
      if (!progress) return;
      // 按时间比例画进度：会话数是掷出来的，做不得准
      bootProgress(
        44 + Math.round((progress.percent / 100) * 50),
        `正在补算到 ${clockText(progress.at)}…`,
      );
    });
  } catch (error) {
    console.error(error);
  }

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

  // 老档的连续签到天数只存了个计数器、没有逐日记录（signDays 是后加的）：
  // 先按计数器把历史补齐，之后连签一律从历史现算，顶部与日历不会再对不上
  try {
    await reconcileSignHistory();
  } catch (error) {
    console.error(error);
  }

  // 种子制造间：离线期间做好的那几炉在这里收掉，剩下的接着排队等
  try {
    resumeCraftTimers();
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
  // 这个轮次本身就是世界时钟的「在线一档」—— 每 60 秒把世界往前推一分钟，
  // 离线补算与在线推进走的是同一个 advanceWorld，只是步长与是否演出不同。
  // 跨天的事（榜单、签到、挖宝）在时钟里已经按时间点处理过，
  // 这里再调一次是兜底：万一页面错过了一整段（比如被完全冻结）。
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
      // 记账是防抖落盘的，藏进后台前把排队的那次写掉；
      // 同时记下「我刚才还在」，下次开机才知道世界该从哪一刻接着转
      flushDaily();
      touchLastSeen().catch(() => {});
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

  // 离线时间轴：离开超过 2 小时才弹（见 data/world.js 的 REPORT_MIN_SPAN）。
  // 等出榜庆祝播完再弹 —— 两个全屏层叠在一起谁也看不清。
  if (settleResult && wantsReport(settleResult)) {
    await waitBoardCelebrate();
    showOfflineReport(settleResult.report);
    // 时间轴已经把「被顺走 / 被照料 / 狗拦下」讲全了，
    // 别再让邻居页那句「你不在时：…」重复一次
    takeOfflineSummary();
  }
}

/**
 * 等出榜庆祝队列播空（最多等 20 秒）。
 *
 * 离线补算可能连着结算好几天的榜，名次卡片是一张一张播的；
 * 离线时间轴叠在它上面会互相盖住。
 */
async function waitBoardCelebrate() {
  for (let i = 0; i < 40 && celebratePending() > 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
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
