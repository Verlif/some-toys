/**
 * 冒险界面。
 *
 * 两层：
 *   1. 选图弹窗（openAdventureLauncher）：列出背包里的藏宝图，选中就出发；
 *   2. 全屏卡牌页：像《王权》那样左右滑动选路，顶部可以退出（带二次确认）。
 *
 * 有一点刻意为之：**奖励在哪一边由 store 决定，UI 完全不知道**。
 * 所以这里只负责把卡片飞出去、把结果念出来，不做任何随机。
 */
import { byId } from '../core/dom.js';
import { emit, EVENTS } from '../core/bus.js';
import * as adventure from '../store/adventure.js';
import { describeReward } from '../data/adventure.js';
import { openModal, closeModal } from './modal.js';

/** 卡片滑动多远算一次选择 */
const SWIPE_THRESHOLD = 72;

/** 飞出动画时长，必须与 CSS 的 .adv-card.out 过渡一致 */
const FLY_MS = 190;

let els = null;
/** 手指/鼠标的起点与当前位移 */
let start = null;
let offset = 0;
let dragging = false;
/** 动画进行中或正在结算时，屏蔽新的手势 */
let busy = false;
/** 奖励提示的定时器 */
let toastTimer = 0;

function collect() {
  if (els) return els;
  els = {
    root: byId('adventure'),
    exit: byId('advExit'),
    title: byId('advTitle'),
    steps: byId('advSteps'),
    bar: byId('advBar'),
    card: byId('advCard'),
    scene: byId('advScene'),
    cardTitle: byId('advCardTitle'),
    cardText: byId('advCardText'),
    left: byId('advLeft'),
    right: byId('advRight'),
    toast: byId('advToast'),
  };
  return els;
}

/* ============================================================
   选图弹窗
   ============================================================ */

/**
 * 打开「选择藏宝图」弹窗。
 *
 * 没图的时候不摆一个空面板，直接给一条去商店的路 ——
 * 否则玩家点进来只会看到「什么都没有」。
 */
export function openAdventureLauncher() {
  const maps = adventure.ownedMaps();

  const rows = maps.map((map) => `
    <button class="adv-map" data-action="start-map" data-id="${map.tier}">
      <span class="adv-map-emoji">${map.emoji}</span>
      <span class="adv-map-body">
        <span class="adv-map-name">${map.name}<b>×${map.count}</b></span>
        <span class="adv-map-meta">${map.swipes} 步 · 可挖 Lv.${map.shopSeedCap} 以内的种子</span>
      </span>
      <span class="adv-map-go">出发 ›</span>
    </button>`).join('');

  openModal(`
    <div class="modal-head">
      <h3>🧭 冒险</h3>
      <button class="close" data-close>✕</button>
    </div>
    <p class="adv-intro">
      每次冒险有<b>藏宝图等级 × 5 + 10</b> 次选择机会，
      每张牌只有一边藏着奖励，走到哪边全凭判断。
    </p>
    ${maps.length
      ? `<div class="adv-map-list">${rows}</div>`
      : `<div class="empty-tip">🗺️<br>还没有藏宝图<br>去商店买一张再出发吧</div>`}
    <button class="btn ghost adv-shop-btn" data-action="goto-shop">🏪 去商店看看藏宝图</button>
  `, (action, el) => ADVENTURE_ACTIONS[action]?.(el));
}

/* ============================================================
   卡牌页
   ============================================================ */

/** 让卡片回到原位（不动画） */
function resetCard() {
  const { card, left, right } = collect();
  card.style.transition = 'none';
  card.style.transform = '';
  card.style.opacity = '';
  card.classList.remove('out', 'dragging');
  left.style.opacity = '0';
  right.style.opacity = '0';
  // 强制回流，让下一次 transform 重新带上过渡
  void card.offsetWidth;
  card.style.transition = '';
}

function renderTop() {
  const { title, steps, bar } = collect();
  const run = adventure.currentRun();
  if (!run) return;
  const total = run.cards.length;
  const left = Math.max(0, total - run.index);
  title.textContent = `${run.map.emoji} ${run.map.name}`;
  steps.textContent = `剩余 ${left} / ${total} 步`;
  bar.style.width = `${(run.index / total) * 100}%`;
}

function renderCard() {
  const card = adventure.currentCard();
  if (!card) return;
  const e = collect();
  e.scene.textContent = card.scene;
  e.cardTitle.textContent = card.title;
  e.cardText.textContent = card.text;
  e.left.textContent = `← ${card.left}`;
  e.right.textContent = `${card.right} →`;

  resetCard();
  // 重新触发入场动画：连着两张牌都是同一个类名时，浏览器不会重播
  e.card.classList.remove('in');
  void e.card.offsetWidth;
  e.card.classList.add('in');
}

/** 拖动时实时反馈：拉向哪边，哪边的高亮就亮起来 */
function setDrag(dx) {
  const e = collect();
  offset = dx;
  e.card.style.transform = `translateX(${dx}px) rotate(${dx / 24}deg)`;
  const power = Math.min(1, Math.abs(dx) / 90);
  e.left.style.opacity = dx < 0 ? String(power) : '0';
  e.right.style.opacity = dx > 0 ? String(power) : '0';
}

function onDown(x, y) {
  if (busy) return;
  start = { x, y };
  dragging = false;
  collect().card.classList.add('dragging');
}

function onMove(x, y, event) {
  if (!start || busy) return;
  const dx = x - start.x;
  const dy = y - start.y;

  if (!dragging) {
    // 先判方向：竖向划动不该被当成选路
    if (Math.abs(dx) < 6) return;
    if (Math.abs(dy) > Math.abs(dx) * 1.4) return;
    dragging = true;
  }
  event?.preventDefault?.();
  setDrag(dx);
}

function onUp() {
  if (!start) return;
  const dx = offset;
  start = null;
  collect().card.classList.remove('dragging');

  if (dragging && Math.abs(dx) >= SWIPE_THRESHOLD) {
    // 结算后要把手势状态清干净，否则下一次「轻点」会拿上一次的位移再选一次
    dragging = false;
    offset = 0;
    chooseSide(dx < 0 ? 'left' : 'right');
    return;
  }

  dragging = false;
  offset = 0;
  // 没到阈值就弹回去，用 transition 走
  resetCard();
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** 把奖励 / 空手的结果念出来 */
function showReward(reward) {
  const { toast } = collect();
  toast.innerHTML = reward
    ? `<span class="adv-toast-hit">${describeReward(reward)}</span>`
    : '<span class="adv-toast-miss">这条路什么都没有</span>';
  toast.hidden = false;
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1100);
}

/** 选一边：先把卡片甩出去，再交给 store 结算 */
async function chooseSide(side) {
  if (busy) return;
  busy = true;

  const { card } = collect();
  card.style.transform = `translateX(${side === 'left' ? -130 : 130}%) rotate(${side === 'left' ? -18 : 18}deg)`;
  card.style.opacity = '0';
  card.classList.add('out');

  await wait(FLY_MS);
  const result = await adventure.choose(side);
  if (result) showReward(result.reward);
  card.style.opacity = '';
  renderTop();

  if (result?.done) {
    busy = false;
    await endRun();
    return;
  }

  renderCard();
  busy = false;
}

/** 正常走完一趟 */
async function endRun() {
  const summary = await adventure.finishRun();
  closePage();
  if (summary) showSummary(summary);
}

/** 玩家点了顶部退出 */
function askExit() {
  // 卡片正在飞出时别抢结算，否则 exit 与 choose 会同时改 run
  if (busy) return;
  const left = adventure.stepsLeft();
  const run = adventure.currentRun();
  if (!run) return;
  const earned = run.earned.length;

  openModal(`
    <div class="modal-head">
      <h3>结束这次冒险？</h3>
      <button class="close" data-close>✕</button>
    </div>
    <p class="adv-intro">
      还剩 <b>${left}</b> 步没走。已经挖到的 <b>${earned}</b> 份奖励会直接留下，
      剩下没走的路就作废了。
    </p>
    <div class="modal-foot">
      <div class="adv-confirm-acts">
        <button class="btn ghost" data-close>继续冒险</button>
        <button class="btn" data-action="adv-exit-confirm">结束冒险</button>
      </div>
    </div>
  `, (action) => ADVENTURE_ACTIONS[action]?.());
}

/** 结算单里右侧那个数：金币写金额，守护犬写「已入窝」 */
function resultAmount(reward) {
  if (reward.kind === 'coin') return `${reward.n} 💰`;
  if (reward.kind === 'dog') return '已入狗窝';
  return `×${reward.n}`;
}

/** 本趟收获的结算单 */
function showSummary(summary) {
  const rows = summary.earned.length
    ? summary.earned.map((r) => `
        <div class="adv-result-row">
          <span class="adv-result-emoji">${r.emoji}</span>
          <span class="adv-result-name">${r.name}</span>
          <span class="adv-result-n">${resultAmount(r)}</span>
        </div>`).join('')
    : '<div class="empty-tip">🕳️<br>这趟什么都没挖到<br>下次换个方向试试</div>';

  openModal(`
    <div class="modal-head">
      <h3>🏁 寻宝结束</h3>
      <button class="close" data-close>✕</button>
    </div>
    <p class="adv-intro">
      带回了 <b>${summary.earned.length}</b> / ${summary.totalRewards} 份奖励，
      按售价估算约值 <b>${summary.value.toLocaleString()} 💰</b>。
    </p>
    <div class="adv-results">${rows}</div>
  `);
}

function closePage() {
  const { root } = collect();
  root.classList.remove('show');
  root.setAttribute('aria-hidden', 'true');
  resetCard();
}

/** 打开一趟冒险：消耗藏宝图 → 渲染第一张牌 */
async function openRun(tier) {
  const run = await adventure.startRun(tier);
  if (!run) return;
  const { root } = collect();
  root.classList.add('show');
  root.setAttribute('aria-hidden', 'false');
  renderTop();
  renderCard();
}

/* ============================================================
   动作与手势绑定
   ============================================================ */

const ADVENTURE_ACTIONS = {
  'start-map': (el) => {
    closeModal();
    openRun(Number(el.dataset.id));
  },
  'goto-shop': () => {
    closeModal();
    // 买藏宝图：直接落在藏宝图 tab
    emit(EVENTS.NAVIGATE, { page: 'shop', tab: 'map' });
  },
  'adv-exit-confirm': async () => {
    closeModal();
    const summary = await adventure.finishRun();
    closePage();
    if (summary) showSummary(summary);
  },
};

/** 绑定手势、退出按钮与键盘操作（只需一次） */
export function mountAdventure() {
  const e = collect();

  e.exit.addEventListener('click', askExit);

  e.card.addEventListener('touchstart', (event) => {
    const t = event.touches[0];
    onDown(t.clientX, t.clientY);
  }, { passive: true });

  e.card.addEventListener('touchmove', (event) => {
    const t = event.touches[0];
    onMove(t.clientX, t.clientY, event);
  }, { passive: false });

  for (const type of ['touchend', 'touchcancel']) {
    e.card.addEventListener(type, onUp);
  }

  // 桌面端：按住拖动
  e.card.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    onDown(event.clientX, event.clientY);

    const move = (ev) => onMove(ev.clientX, ev.clientY, ev);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      onUp();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  // 键盘：← → 直接选路，方便在桌面上玩
  document.addEventListener('keydown', (event) => {
    if (!adventure.currentRun()) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (!byId('modal').classList.contains('show')) {
      chooseSide(event.key === 'ArrowLeft' ? 'left' : 'right');
    }
  });
}
