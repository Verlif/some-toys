/**
 * 村中心（底部中间的 tab，由原「时报」改造而来）。
 *
 * 页面四块：
 *   - **🏘 村庄建设**（第 48 轮，最上面）：村庄等级、三项升级进度
 *     （金币 / 水晶 / 祈福）、投入资源 / 每日祈福 / 建设日志三个入口。
 *     升级是**自动的**：三项同时达标就当场升，不需要按「升级」按钮 ——
 *     祈福每天只有一次，玩家不需要在某个瞬间守着点；
 *   - **村民总览卡 + 🏆 排行榜卡 同一行**（1fr / 2fr）：总览是在线人数 / 总人数
 *     （都含玩家自己）+ 单行在线头像，点它弹窗看全部名单；排行榜两列 ——
 *     左列 6 个榜单、右列昨日冠军（并列第一折成「+N」）；
 *   - **第二块**（第 61 轮，用户选定的方案）：左 1/3 是 📢 公告栏（上）与
 *     📋 订单（下）两格竖排，右 2/3 是 🏞 公共用地 —— 它跨两行，是一块
 *     大方格，右下角常驻 💧/🐛/🧺 三个数。订单按钮右上角常驻当前订单总数，
 *     这是订单唯一入口（「更多」里已移除）。
 *
 * ⚠️ 公共用地方格**不能被内容撑开**：内部元素全部绝对定位，
 * 高度由 `min-height` 定死，文字多了裁掉 —— 它一长高，左边两格也跟着长，
 * 整页就被这一块推下去了。
 *
 * 「在线」是 NPC 的挂机窗口（见 data/friends.js 的 onlineMs）：总览计数、
 * 头像行、名单里的圆点与灰度都跟着它走 —— 分钟 TICK 与邻居上线事件都会刷，
 * 且只做 targeted 更新（不重建名单，滚动位置不能丢）。
 */
import { byId, delegate, escapeHtml, setHTML } from '../../core/dom.js';
import { on, EVENTS } from '../../core/bus.js';
import { PLAYER_ID, state } from '../../store/state.js';
import { isFriend } from '../../store/relation.js';
import { isNpcOnline } from '../../data/friends.js';
import { filterNews, NEWS_FILTERS, newsList } from '../../store/news.js';
import { myOrders, npcOrders } from '../../store/orders.js';
import { recordItemsHTML } from '../records.js';
import { friendCardHTML, refreshOnline } from './friends.js';
import { openFriendModal } from '../friend-modal.js';
import { closeModal, openModal } from '../modal.js';
import { openSubpage } from '../subpage.js';
import { openRankModal, yesterdayBoardSummary } from '../subpages/rank.js';
import { showToast } from '../toast.js';
import { completeGuide } from '../../store/codex.js';
import { formatCoins, dayKey } from '../../core/utils.js';
import { invest, pray, villageLogs, villageSnapshot } from '../../store/village.js';
import { commonsSnapshot } from '../../store/commons.js';
import { openCommonsModal } from '../commons-modal.js';
import {
  VILLAGE_NAME,
  VILLAGE_YIELD_PER_LEVEL,
  crystalEmoji,
  crystalName,
} from '../../data/village.js';
import { notify } from '../../store/notify.js';

/** 公告栏弹窗内的筛选档位与排序方向（true = 最新在前） */
let boardFilter = 'all';
let boardDesc = true;

/**
 * 村民总览弹窗的筛选：all = 全部（含离线），online = 只看在线的，
 * friend = 只看已经是好友的。
 *
 * 默认 `online`（第 51 轮）：玩家点开这个总览，想看的是「现在谁在」——
 * 32 个村民全铺出来，一屏里大半是灰的，还得自己往下找绿点。
 * 想翻名单（比如找人递好友申请）切「全部」即可，选择会记住。
 *
 * 第 57 轮起这里是**唯一**的全量名单：底部「好友」页只列好友。
 */
let villagerFilter = 'online';

/**
 * 村民总览的搜索词（第 61 轮）：按名字过滤，纯前端不做模糊匹配。
 *
 * 存在模块变量而不是 DOM 上 —— 打一个字就重绘一次列表，状态挂在 input 里
 * 会被 `innerHTML` 冲掉；而且从邻居农场关回来时快照里的 input 是空值，
 * 得靠这个变量把搜索框的内容和列表的过滤条件重新对齐。
 */
let villagerQuery = '';

/* ---------- 数字 ---------- */

/** 进行中的订单总数：邻居张榜 + 我发布的 */
const orderCount = (now = Date.now()) => npcOrders(now).length + myOrders(now).length;

/**
 * 公共用地方格右下角的三行统计（第 60 轮）。
 *
 * 一行一个：可浇水 / 可捉虫 / 已成熟。三个数都是「现在能做几件事」，
 * 所以为 0 的那行只压灰、**不隐藏** —— 三行位置固定，数字忽隐忽现
 * 反而看不出变化。
 *
 * @param {{water: number, pest: number, ready: number}} snap
 */
const commonsStatsHTML = (snap) => `
  <span class="ca-stats">
    <i class="${snap.water ? '' : 'zero'}" data-role="commons-water">💧 ${snap.water}</i>
    <i class="${snap.pest ? '' : 'zero'}" data-role="commons-pest">🐛 ${snap.pest}</i>
    <i class="${snap.ready ? '' : 'zero'}" data-role="commons-ripe">🧺 ${snap.ready}</i>
  </span>`;

/** 在线人数（含玩家）与总人数（含玩家） */
function onlineStats(now = Date.now()) {
  // 玩家自己当然在线：+1
  const online = state.friends.filter((f) => isNpcOnline(f, now)).length + 1;
  return { online, total: state.friends.length + 1 };
}

/**
 * 在线村民的头像行：玩家在最前，**一行排开**。
 *
 * 不在 JS 里定死「最多几个」—— 这张卡只占 1/3 宽，能放几个完全取决于屏幕，
 * 所以全量渲染，交给 `fitFaces()` 实测裁剪；末尾那颗同尺寸圆框里写「…」。
 */
function facesHTML(now) {
  const online = [
    { avatar: state.farm.avatar, name: '你' },
    ...state.friends.filter((f) => isNpcOnline(f, now)),
  ];
  return online
    .map((v) => `<span class="co-face" title="${escapeHtml(v.name)}">${v.avatar}</span>`)
    .join('') + '<span class="co-face more">…</span>';
}

/**
 * 头像行排几排（第 61 轮）：总览卡跟排行榜卡等高，下面本来空着一截，
 * 排成两排能多露一倍的在线邻居。
 */
const FACE_ROWS = 2;

/**
 * 把头像行裁到「正好放得下」。
 *
 * 量一颗头像的宽度 + 间距，一次算出每排能放几个，乘排数得到总容量，
 * 然后一次性挂 `.off` —— 不要「收一个量一次」：32 位邻居在线时会连续
 * 强制重排三十多次，切到村中心那一下能明显卡一下。
 *
 * 放不下时**留一格给省略号**：末尾那颗同尺寸圆框，视觉上占的宽度和头像一样，
 * 所以能放 N 个就只显示 N−1 个头像。玩家永远在最前，不会被收掉。
 *
 * @param {HTMLElement} [root] 村中心根节点
 */
function fitFaces(root = byId('center')) {
  const box = root?.querySelector('[data-role="faces"]');
  if (!box) return;
  const more = box.querySelector('.co-face.more');
  const faces = [...box.querySelectorAll('.co-face:not(.more)')];
  if (!faces.length) return;

  const width = faces[0].offsetWidth || 22;
  const gap = Number.parseFloat(getComputedStyle(box).columnGap) || 0;
  const room = box.clientWidth;
  // 每排占「宽 + 间距」，最后一个不用留间距；再乘排数
  const perRow = Math.floor((room + gap) / (width + gap));
  const capacity = Math.max(1, perRow * FACE_ROWS);
  const show = faces.length <= capacity ? faces.length : Math.max(1, capacity - 1);

  faces.forEach((face, i) => face.classList.toggle('off', i >= show));
  more?.classList.toggle('show', show < faces.length);
}

/**
 * 冠军名字放不下时，让它像通知横幅那样来回横滚（第 61 轮）。
 *
 * 为什么是「量一次 + CSS 动画」而不是 JS 逐帧：
 *   - 位移量在渲染后算一次 `scrollWidth - clientWidth` 就定了，不用每帧读；
 *   - 动画交给 `transform`（合成层，既不触发布局也不触发绘制），主线程零负担；
 *   - 6 条同时跑也只是 6 个合成层。换成 requestAnimationFrame 里读
 *     `scrollLeft`/`offsetWidth`，每帧都要强制同步重排，6 条就够掉帧了。
 *
 * ⚠️ 不写 `will-change`：`.yield-pile` 那次的教训 —— 静态定位的小元素
 * 挂上它是白占显存，这里的位移本来就走合成层。
 *
 * ⚠️ 放得下就什么都不加（连类都不挂）：短名字来回滚反而像界面坏了。
 * 每轮先 `remove('marquee')` 再判，所以窗口拉宽之后会自动停下来。
 *
 * @param {HTMLElement} [root] 村中心根节点
 */
function fitMarquees(root = byId('center')) {
  for (const box of root?.querySelectorAll('.cr-name') || []) {
    const track = box.firstElementChild;
    if (!track) continue;
    box.classList.remove('marquee');

    const over = track.scrollWidth - box.clientWidth;
    if (over <= 2) continue;
    // 速度按「滚多远」给：每 12px 约 1 秒，夹在 5~12 秒之间（再快就晃眼）
    const dur = Math.min(12, Math.max(5, Math.round(over / 12) + 4));
    box.style.setProperty('--cr-shift', `-${over}px`);
    box.style.setProperty('--cr-dur', `${dur}s`);
    box.classList.add('marquee');
  }
}

/* ---------- 村民总览弹窗 ---------- */

/** 「你自己」那张卡：玩家永远在线 */
const meCardHTML = () => `
  <div class="friend-card me" data-action="center-me" role="button" tabindex="0">
    <div class="friend-avatar">${state.farm.avatar}</div>
    <div class="friend-body">
      <div class="friend-name">
        ${escapeHtml(state.farm.name)}
        <i class="friend-dot on" title="在线"></i>
        <span class="lv">Lv.${state.farm.level}</span>
      </div>
      <div class="friend-stats">
        <span class="friend-chip job">农场主</span>
        <span class="friend-chip">💰 ${formatCoins(state.farm.coins)}</span>
        <span class="friend-chip me-chip">就是你</span>
      </div>
    </div>
  </div>`;

/**
 * 名单：你自己 + 按筛选取的邻居（卡片与邻居页同一套，离线自带灰度）。
 *
 * @param {string} filter
 * @param {number} now
 * @param {string} query 名字搜索词（空串 = 不过滤）
 */
function villagerRowsHTML(filter = villagerFilter, now = Date.now(), query = villagerQuery) {
  const q = query.trim().toLowerCase();
  const list = state.friends.filter((f) => {
    if (q && !f.name.toLowerCase().includes(q)) return false;
    if (filter === 'online') return isNpcOnline(f, now);
    if (filter === 'friend') return isFriend(PLAYER_ID, f.id);
    return true;
  });
  // 空态要分两种：搜不到（换个字试试）和真的没人上线（切「全部」看看）。
  // 混成一句的话，玩家搜错一个字会以为村里一个人都没有。
  let empty = '';
  if (!list.length) {
    if (q) {
      empty = `<div class="empty-tip">🔍<br>没有叫「${escapeHtml(query.trim())}」的村民<br>换个字试试</div>`;
    } else if (filter !== 'all') {
      empty = `<div class="empty-tip">🌙<br>${filter === 'friend' ? '这会儿没有好友在线' : '这会儿没有邻居在线'}<br>切「全部」看看谁在家</div>`;
    }
  }
  // friendTag：这里是**全量名单**，得标出谁已经是好友 ——
  // 非好友的地偷不了、人也催不动，玩家得先知道这件事
  return meCardHTML() + empty + list.map((f) => friendCardHTML(f, now, { friendTag: true })).join('');
}

/** 筛选芯片：全部 / 在线 / 好友 */
function villagerBarHTML(now = Date.now()) {
  const { online, total } = onlineStats(now);
  const buddies = state.friends.filter((f) => isFriend(PLAYER_ID, f.id)).length;
  const chip = (key, label, n) => `
    <button class="filter-chip ${villagerFilter === key ? 'active' : ''}"
            data-action="villager-filter" data-id="${key}">${label}<i class="chip-num">${n}</i></button>`;
  return chip('all', '全部', total) + chip('online', '在线', online) + chip('friend', '好友', buddies);
}

/**
 * 打开村民总览。
 *
 * 结构（第 61 轮）：搜索框放在标题栏右侧，筛选芯片挪到**底栏** ——
 * 芯片原来在列表上方，手机上翻到第 20 位想换个档位得一路滑回顶端；
 * 放到底栏后拇指随时够得着，也不跟着列表滚。
 */
function openVillagers() {
  const now = Date.now();
  const { online, total } = onlineStats(now);
  // 每次新打开都从干净状态起：搜索词不跨次留存（筛选档位保留，见 villagerFilter）
  villagerQuery = '';

  openModal(`
    <div class="modal-head">
      <h3>🏡 村民总览</h3>
      <label class="v-search">
        <i>🔍</i>
        <input type="search" data-role="villager-search" placeholder="搜名字"
               autocomplete="off" enterkeyhint="search" aria-label="按名字搜索村民">
      </label>
      <button class="close" data-close aria-label="关闭">✕</button>
    </div>
    <div class="modal-sub" data-role="villager-sub">${total} 位村民 · ${online} 位正在线</div>
    <div class="friend-list" data-role="villager-list">${villagerRowsHTML()}</div>
    <div class="modal-foot">
      <div class="board-bar villager-bar" data-role="villager-bar">${villagerBarHTML(now)}</div>
    </div>
  `, (action, el) => {
    if (action === 'villager-filter') {
      villagerFilter = el.dataset.id;
      paintVillagers();
      return;
    }
    if (action === 'visit') {
      openFriendModal(el.dataset.id);
      return;
    }
    if (action === 'center-me') showToast('这就是你自己的农场，回去种地吧');
  });

  // 卡片自带 offline 类；再跑一次把「刚刚上线/下线」的圆点也对齐
  refreshOnline();
}

/**
 * 重刷村民总览弹窗（只在当前弹窗里真有这份名单时才动手）。
 *
 * 三块一起刷：计数、底栏芯片、名单。
 *
 * ⚠️ 滚动位置必须手动接力。`.modal-body` 是这张弹窗唯一的滚动容器，
 * 换掉 list 的 innerHTML 会让内容高度先塌一下，浏览器当场把 scrollTop
 * 夹到 0 —— 玩家刚滑到第 20 位村民，回来就被弹回顶端。存一下、写完再放回去。
 *
 * ⚠️ 搜索框也要回填。从邻居农场关回来时还原的是**打开那一刻的 innerHTML**，
 * 而 input 的 value 不进 innerHTML —— 回来会是个空框，列表却还是过滤过的。
 */
function paintVillagers() {
  const card = document.querySelector('#modal .modal-card');
  const list = card?.querySelector('[data-role="villager-list"]');
  if (!list) return;

  const body = card.querySelector('.modal-body');
  const keepTop = body?.scrollTop || 0;

  const now = Date.now();
  const { online, total } = onlineStats(now);

  const sub = card.querySelector('[data-role="villager-sub"]');
  if (sub) sub.textContent = `${total} 位村民 · ${online} 位正在线`;
  const bar = card.querySelector('[data-role="villager-bar"]');
  if (bar) bar.innerHTML = villagerBarHTML(now);
  list.innerHTML = villagerRowsHTML(villagerFilter, now, villagerQuery);

  const search = card.querySelector('[data-role="villager-search"]');
  if (search && search.value !== villagerQuery) search.value = villagerQuery;

  if (body) body.scrollTop = keepTop;
  refreshOnline();
}

/* ---------- 公告栏（时报弹窗） ---------- */

/** 当前筛选 + 排序下的时报列表 HTML */
function boardListHTML() {
  const now = Date.now();
  const all = filterNews(newsList(), boardFilter);
  const list = boardDesc ? all : [...all].reverse();
  return list.length
    ? recordItemsHTML(list, { now, withDay: true })
    : '<div class="empty-tip">📭<br>公告栏还空着<br>去闯点事出来吧</div>';
}

/** 过滤 / 排序栏（放在列表下面） */
function boardBarHTML() {
  const all = newsList();
  const chips = NEWS_FILTERS.map((f) => {
    const n = filterNews(all, f.key).length;
    return `
      <button class="filter-chip ${f.key === boardFilter ? 'active' : ''}"
              data-action="board-filter" data-id="${f.key}">${f.label}<i class="chip-num">${n}</i></button>`;
  }).join('');
  return `${chips}<button class="filter-chip sort" data-action="board-sort">${boardDesc ? '最新 ↓' : '最早 ↑'}</button>`;
}

/** 打开公告栏：过滤 / 排序在列表下面，改选只重刷列表与栏，不重建弹窗 */
function openBoard() {
  // 第一次翻开公告栏 = 「第一次看时报」的引导目标（时报从页面变成弹窗了）
  completeGuide('news');

  openModal(`
    <div class="modal-head">
      <h3>📢 公告栏</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">村镇日报 · 只保留最近 30 天的大新闻</div>

    <div class="news-list" data-role="board-list">${boardListHTML()}</div>

    <div class="modal-foot">
      <div class="board-bar" data-role="board-bar">${boardBarHTML()}</div>
    </div>
  `, (action, el) => {
    if (action === 'board-filter') {
      boardFilter = el.dataset.id;
      paintBoard();
      return;
    }
    if (action === 'board-sort') {
      boardDesc = !boardDesc;
      paintBoard();
    }
  }, 'board-modal');

  function paintBoard() {
    // 叠层只留一张 .modal-card（下层是 HTML 快照），这一张就是栈顶
    const card = document.querySelector('#modal .modal-card');
    if (!card) return;
    card.querySelector('[data-role="board-list"]').innerHTML = boardListHTML();
    card.querySelector('[data-role="board-bar"]').innerHTML = boardBarHTML();
  }
}

/* ---------- 排行榜卡片 ---------- */

/**
 * 排行榜卡片：**两列**。
 *
 * 左列是 6 个榜单（图标 + 名字），右列是**昨日**那个榜的第一名；
 * 并列第一时只露一位，剩下的折成「+N」。
 * 整张卡是一个按钮 —— 点哪里都开排行榜弹窗（榜单本身那么多内容，
 * 塞进村中心会把下面两块挤没）。
 *
 * 昨日冠军取的是 `latestSettled()` 那一期（每天 14:00 结算完才更新），
 * 和排行榜弹窗里「昨日 · XX」那张卡是同一份数据。
 */
function rankCardHTML() {
  const rows = yesterdayBoardSummary();

  const names = rows.map((r) => `
    <span class="cr-item">
      <i class="cr-ico">${r.icon}</i>${r.label}
    </span>`).join('');

  // 右列：头像 + 名字（第 61 轮把名字加回来了 —— 卡片现在只占半宽，
  // 六个头像孤零零挂着认不出是谁）。名字放不下时由 fitMarquees() 让它
  // 来回横滚，而不是截成「西…」；「是不是你」仍然靠绿边，不占宽度
  const champs = rows.map((r) => {
    if (!r.champ) return '<span class="cr-item empty">—</span>';
    return `
      <span class="cr-item champ">
        <i class="cr-ava${r.champ.me ? ' me' : ''}">${r.champ.avatar}</i>
        <span class="cr-name"><b>${escapeHtml(r.champ.name)}</b></span>
        ${r.champ.more > 0 ? `<i class="cr-more">+${r.champ.more}</i>` : ''}
      </span>`;
  }).join('');

  return `
    <div class="center-rank" data-action="center-rank" role="button" tabindex="0">
      <div class="cr-head">
        <span class="cr-title">🏆 排行榜</span>
        <span class="cr-go">›</span>
      </div>
      <div class="cr-grid">
        <div class="cr-col">${names}</div>
        <div class="cr-col">${champs}</div>
      </div>
    </div>`;
}

/* ---------- 村庄建设 ---------- */

/**
 * 村庄里的数字一律用千分位，不用 `formatCoins`。
 *
 * `formatCoins` 是给 HUD 与日志用的紧凑写法（10,000 → 「1.0万」），
 * 但这里是「进度 X / 门槛 Y」—— 两边必须同量级才读得懂，
 * 「0 / 1.0万」这种混搭会让人一愣（2026-10-26 实测截图）。
 */
const num = (n) => Number(n || 0).toLocaleString('en-US');

/**
 * 村庄建设卡（村中心最上面那一块，第 48 轮）。
 *
 * 一张卡说清三件事：**村庄几级、还差什么、今天能做什么**。
 * 三项门槛各一行（金币 / 水晶 / 祈福），共用一套进度条底色 ——
 * 玩家一眼就能看出瓶颈在哪（通常永远是祈福：33 人一天一次，花钱买不到）。
 *
 * 满级之后进度区换成一句「已经满级」，但祈福与建设日志照旧可用：
 * 满级不代表没有日常。
 *
 * @param {number} [now]
 */
function villageCardHTML(now = Date.now()) {
  const snap = villageSnapshot(now);
  const yieldPct = Math.round(snap.level * VILLAGE_YIELD_PER_LEVEL * 100);

  const head = `
    <div class="cv-head">
      <span class="cv-name">🏘 ${VILLAGE_NAME}</span>
      <span class="cv-lv">Lv.${snap.level}</span>
      <span class="cv-yield">全村产量 +${yieldPct}%</span>
    </div>`;

  let body = '';
  if (snap.max) {
    body = '<div class="cv-done">🏆 村庄已经满级 —— 该有的都有了</div>';
  } else {
    const t = snap.tier;
    const rows = [
      ['💰', '金币', snap.coins, t.coins],
      [crystalEmoji(t.crystal), '水晶', snap.crystals, t.crystals],
      ['🙏', '祈福', snap.pray, t.prayers],
    ];
    const left = rows.filter(([, , have, need]) => have < need).length;

    body = `
      <div class="cv-go">升到 Lv.${snap.level + 1} 还差 ${left} 项</div>
      <div class="cv-rows">
        ${rows.map(([icon, label, have, need]) => {
          const pct = Math.min(100, Math.round((have / Math.max(1, need)) * 100));
          return `
            <div class="cv-row${have >= need ? ' done' : ''}">
              <span class="cv-k">${icon} ${label}</span>
              <i class="cv-bar"><b style="width:${pct}%"></b></i>
              <span class="cv-v">${num(have)}<em>/${num(need)}</em></span>
            </div>`;
        }).join('')}
      </div>`;
  }

  const prayLabel = snap.prayedToday ? '今天已祈福' : '🙏 祈福';
  // 金币与水晶都满了（村民也会投，很容易先满）：这时「投入」点了也什么都投不进去，
  // 按钮直接改成「资源已齐」并禁用 —— 剩下只等祈福的那几项
  const resFull = !snap.max
    && snap.coins >= snap.tier.coins && snap.crystals >= snap.tier.crystals;

  return `
    <div class="center-village" data-role="village-card">
      ${head}
      ${body}
      <div class="cv-acts">
        <button class="cv-btn" data-action="village-invest" ${snap.max || resFull ? 'disabled' : ''}>
          ${resFull ? '🚧 资源已齐' : '🚧 投入资源'}
        </button>
        <button class="cv-btn pray" data-action="village-pray" ${snap.prayedToday ? 'disabled' : ''}>
          ${prayLabel}
        </button>
        <button class="cv-btn ghost" data-action="village-log">📜 建设日志</button>
      </div>
    </div>`;
}

/** 上一次渲染村庄卡时的自然日：跨 0 点要把「今天已祈福」放出来 */
let villageDay = '';

/** 只重绘村庄卡（升级 / 祈福 / 投入之后），不重建整页 */
function paintVillage() {
  const root = byId('center');
  const card = root?.querySelector('[data-role="village-card"]');
  if (!card) return;
  villageDay = dayKey(Date.now());
  card.outerHTML = villageCardHTML();
}

/** 投入资源的弹窗：两个输入框，默认填「还差的量」与「手上有的」取小 */
function openInvest() {
  const snap = villageSnapshot();
  if (snap.max) {
    showToast('村庄已经满级了，没什么可投的');
    return;
  }
  const t = snap.tier;
  const coinMax = Math.min(Math.max(0, t.coins - snap.coins), state.farm.coins);
  const crysMax = Math.min(Math.max(0, t.crystals - snap.crystals), snap.crystalStock);
  // 一项都投不进去（还差的部分村里已经有了 / 手上没有这一档水晶）：别开一个空弹窗
  if (!coinMax && !crysMax) {
    showToast('现在没什么可投的 —— 这部分村里已经有了，或者你手上还没有这一档水晶');
    return;
  }

  openModal(`
    <div class="modal-head">
      <h3>🚧 投入村庄建设</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">升到 Lv.${snap.level + 1} 要 ${num(t.coins)} 金币、${t.crystals} 枚${crystalName(t.crystal)}、${t.prayers} 次祈福</div>

    <div class="cvi-list">
      <div class="cvi-row">
        <span class="cvi-k">💰 金币</span>
        <input class="cvi-input" data-role="coins" type="number" inputmode="numeric"
               min="0" max="${coinMax}" step="100" value="${coinMax}">
        <button class="cvi-max" data-action="village-fill" data-id="coins"
                data-max="${coinMax}">投 ${num(coinMax)}</button>
      </div>
      <div class="cvi-row">
        <span class="cvi-k">${crystalEmoji(t.crystal)} ${crystalName(t.crystal)}</span>
        <input class="cvi-input" data-role="crystals" type="number" inputmode="numeric"
               min="0" max="${crysMax}" step="1" value="${crysMax}">
        <button class="cvi-max" data-action="village-fill" data-id="crystals"
                data-max="${crysMax}">投 ${crysMax}</button>
      </div>
    </div>

    <div class="modal-sub cvi-tip">投入的金币与水晶在升级那一刻一起清零，投多了也不会退还 —— 所以这里只让你投「还差的那部分」。水晶只能投当前等级要用的这一档；邻居也会往村里投，进度条可能一不留神就满了。</div>

    <div class="modal-foot">
      <button class="btn primary cvi-ok" data-action="village-invest-ok">确认投入</button>
    </div>
  `, (action, el) => {
    const card = el.closest('.modal-card');

    if (action === 'village-fill') {
      const input = card?.querySelector(`[data-role="${el.dataset.id}"]`);
      if (input) input.value = el.dataset.max;
      return;
    }

    if (action === 'village-invest-ok') {
      const coins = Number(card?.querySelector('[data-role="coins"]')?.value || 0);
      const crystals = Number(card?.querySelector('[data-role="crystals"]')?.value || 0);
      invest({ coins, crystals }).then((res) => {
        if (!res.ok) {
          notify(res.reason || '投入失败');
          return;
        }
        closeModal();
        paintVillage();
      });
    }
  }, 'village-modal');
}

/** 建设日志：近 7 天（与农场日志、时报同一口径） */
function openVillageLog() {
  const list = villageLogs();
  openModal(`
    <div class="modal-head">
      <h3>📜 建设日志</h3>
      <button class="close" data-close>✕</button>
    </div>
    <div class="modal-sub">最近 7 天的资源投入、祈福与产出</div>
    <div class="news-list">
      ${list.length
        ? recordItemsHTML(list, { withDay: true })
        : '<div class="empty-tip">📭<br>村里还很安静<br>去投点东西、祈个福吧</div>'}
    </div>
  `, null, 'board-modal');
}

/* ---------- 页面 ---------- */

export function renderCenter() {
  const root = byId('center');
  if (!root) return;
  const now = Date.now();
  const { online, total } = onlineStats(now);
  const orders = orderCount(now);
  const commons = commonsSnapshot(now);

  setHTML(root, `
    ${villageCardHTML(now)}
    <div class="center-duo">
      <div class="center-overview" data-action="center-villagers" role="button" tabindex="0">
        <div class="co-title">🏡 村民</div>
        <div class="co-count"><b data-role="online">${online}</b><span data-role="total">/${total}</span></div>
        <div class="co-faces" data-role="faces">${facesHTML(now)}</div>
      </div>
      ${rankCardHTML()}
    </div>
    <div class="center-main">
      <button class="center-act board" data-action="center-board">
        <span class="ca-ico">📢</span>
        <span class="ca-body"><b>公告栏</b><i data-role="news-n">${newsList().length} 条村镇动态</i></span>
      </button>
      <button class="center-act orders" data-action="center-orders">
        <span class="ca-ico">📋</span>
        <span class="ca-body"><b>订单</b><i data-role="order-hint">${orders ? '有活干了' : '暂时没有单'}</i></span>
        <i class="ca-badge ${orders ? '' : 'zero'}" data-role="orders-n">${orders}</i>
      </button>
      <button class="center-act commons" data-action="center-commons">
        <span class="ca-ico">🏞</span>
        <span class="ca-body"><b>公共用地</b><i class="ca-hint">先到先得 · 1 天换种</i></span>
        <i class="ca-total">共 ${commons.total} 块</i>
        ${commonsStatsHTML(commons)}
      </button>
    </div>
  `);

  // 头像行与冠军名字都要实测宽度才知道怎么排 —— 必须等节点进 DOM 之后再算
  fitFaces(root);
  fitMarquees(root);
}

/**
 * 实时刷新：在线计数、副标题、头像行、两枚入口上的数字、名单里的圆点与灰度。
 * 只改文字与类，不重建名单 —— 弹窗开着的时候滚动位置不能丢。
 */
function refreshMarks() {
  const root = byId('center');
  if (!root || !root.innerHTML) return;
  const now = Date.now();
  const { online, total } = onlineStats(now);

  const count = root.querySelector('[data-role="online"]');
  if (count) count.textContent = String(online);
  // 总人数会随村庄升级涨（新住户搬来），不是渲染时那一个数就定死了
  const totalEl = root.querySelector('[data-role="total"]');
  if (totalEl) totalEl.textContent = `/${total}`;
  const faces = root.querySelector('[data-role="faces"]');
  if (faces) {
    faces.innerHTML = facesHTML(now);
    fitFaces(root);
  }

  const newsN = root.querySelector('[data-role="news-n"]');
  if (newsN) newsN.textContent = `${newsList().length} 条村镇动态`;

  // 订单数会随 NPC 上线 / 别人接单变化，徽标常驻跟着它走
  const orders = orderCount(now);
  const badge = root.querySelector('[data-role="orders-n"]');
  if (badge) {
    badge.textContent = String(orders);
    badge.classList.toggle('zero', !orders);
  }
  const hint = root.querySelector('[data-role="order-hint"]');
  if (hint) hint.textContent = orders ? '有活干了' : '暂时没有单';

  // 公共用地方格右下角的三行：浇水 / 捉虫 / 已成熟
  const commons = commonsSnapshot(now);
  for (const [role, icon, n] of [
    ['commons-water', '💧', commons.water],
    ['commons-pest', '🐛', commons.pest],
    ['commons-ripe', '🧺', commons.ready],
  ]) {
    const el = root.querySelector(`[data-role="${role}"]`);
    if (!el) continue;
    el.textContent = `${icon} ${n}`;
    el.classList.toggle('zero', !n);
  }

  // 名单里的圆点 / 灰度（弹窗开着的时候才有节点）：与邻居页共用一套
  refreshOnline();

  // 跨过 0 点：把「今天已祈福」放出来（每分钟检查一次，成本只有一次字符串比较）
  if (villageDay && villageDay !== dayKey(now)) paintVillage();
}

const CENTER_ACTIONS = {
  // 总览卡：弹窗看名单（页面里不再展开）
  'center-villagers'() {
    openVillagers();
  },
  'center-board'() {
    openBoard();
  },
  'center-orders'() {
    openSubpage('orders');
  },
  // 公共用地（第 58 轮）：弹窗里是一张「没有主人的农场」
  'center-commons'() {
    openCommonsModal();
  },
  // 榜单卡片：整张卡可点，开排行榜弹窗（与子页面版同源渲染）
  'center-rank'() {
    openRankModal();
  },
  // ---- 村庄建设 ----
  'village-invest'() {
    openInvest();
  },
  'village-pray'() {
    prayOnce();
  },
  'village-log'() {
    openVillageLog();
  },
};

/**
 * 每日祈福。
 *
 * 奖励直接进背包（金币 / 种子 / 道具 / 产出），抽中时 village.pray 自己会
 * 弹 toast 并发时报 —— 这里只负责挡住「今天已经祈过」的情况。
 */
function prayOnce() {
  const snap = villageSnapshot();
  if (snap.prayedToday) {
    showToast('今天已经祈福过了，明天再来');
    return;
  }
  pray().then((res) => {
    if (!res.ok) {
      notify(res.reason || '祈福失败');
      return;
    }
    paintVillage();
    if (!res.reward) showToast('🙏 祈福完毕，村里安宁');
  });
}

/** 进入村中心：渲染（引导在公告栏弹窗里才结） */
export function enterCenterPage() {
  renderCenter();
}

export function mountCenter() {
  const root = byId('center');
  // 卡片与按钮在每次重绘里重建，用委托挂在根节点上
  delegate(root, 'click', '[data-action]', (el) => {
    CENTER_ACTIONS[el.dataset.action]?.(el);
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('[data-action]');
    if (!card) return;
    event.preventDefault();
    CENTER_ACTIONS[card.dataset.action]?.(card);
  });

  // 邻居上线 / 下线、在线窗口走到头：实时刷总览与入口数字
  on(EVENTS.FRIENDS, refreshMarks);
  on(EVENTS.TICK, refreshMarks);
  // 村庄：投入 / 祈福 / 升级（含邻居祈福把计数推上去）→ 只重绘那一张卡
  on(EVENTS.VILLAGE, paintVillage);
  // 公共用地：玩家照料 / 拿走、村民顺手来一趟 → 方格右下角那三个数跟着变
  on(EVENTS.COMMONS, refreshMarks);

  // 转屏 / 拉窗口：卡片宽度变了，头像行能放几个、名字滚不滚也跟着变。
  // 用一帧合并，拖窗口时 resize 一秒能来几十次，每次都量一遍会抖
  let fitRaf = 0;
  window.addEventListener('resize', () => {
    if (fitRaf) return;
    fitRaf = requestAnimationFrame(() => {
      fitRaf = 0;
      fitFaces();
      fitMarquees();
    });
  });

  // 从叠层（邻居农场 / 作物详情）关回来：还原的是**打开那一刻的快照**，
  // 刚浇过的水、刚涨的好感都还是旧的 —— 玩家会以为这块地还没人打理。
  // 只在当前弹窗里真有这份名单时才重画，别的弹窗关掉不受影响。
  on(EVENTS.MODAL_RESTORE, () => {
    if (document.querySelector('#modal [data-role="villager-list"]')) paintVillagers();
  });

  // 搜索框：委托挂在 #modal 上，不绑在 input 自己身上 —— 弹窗被压栈再还原时
  // 节点是新生成的，绑在旧节点上的监听会跟着一起消失
  byId('modal')?.addEventListener('input', (event) => {
    if (!event.target.matches?.('[data-role="villager-search"]')) return;
    villagerQuery = event.target.value;
    paintVillagers();
  });
}
