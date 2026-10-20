/**
 * 签到成功的庆祝画面。
 *
 * 进入游戏时会自动签到（见 store/signin.js 的 autoSignIn），
 * 这里订阅 SIGN 事件，把「第几天 / 拿到什么」播成一张居中卡片：
 * 金圈扩散 + 数字滚动，约 2.2 秒后自动收起，点一下也能提前关掉。
 *
 * 不复用模态弹窗容器：这个画面在启动阶段播放，不应该占用 #modal 的
 * 动作分发与下拉手势，否则会和随后打开的弹窗互相打断。
 */
import { on, EVENTS } from '../core/bus.js';
import { ITEMS } from '../data/items.js';
import { describeBoxReward } from '../store/signin.js';

const HOLD_MS = 2200;
const FADE_MS = 320;
const COUNT_MS = 700;

let layer = null;
let timer = 0;

/** 数字从 0 滚到目标值，先快后慢 */
function countUp(el, target) {
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / COUNT_MS);
    el.textContent = Math.round(target * (1 - (1 - t) ** 3)).toLocaleString();
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** 收起画面（重复调用安全） */
function dismiss() {
  if (!layer) return;
  clearTimeout(timer);
  const el = layer;
  layer = null;
  el.classList.add('out');
  setTimeout(() => el.remove(), FADE_MS);
}

/**
 * 播放签到庆祝
 * @param {{day:number, streak:number, coins:number, items:object,
 *          seed:?object, box:?object}} payload
 */
export function showSignCelebrate({ day, streak, coins, items = {}, seed, box }) {
  dismiss();

  const itemsHTML = Object.entries(items)
    .map(([id, n]) => `<span class="sc-item">${ITEMS[id]?.emoji || '🎁'} ${ITEMS[id]?.name || id} ×${n}</span>`)
    .join('');

  const seedHTML = seed
    ? `<span class="sc-item">🌱 ${seed.emoji} ${seed.name}种子 ×1</span>`
    : '';

  // 周六的盲盒：抽到什么全看运气，直接把结果摆出来
  const boxHTML = box
    ? `<div class="sc-box">
         <div class="sc-box-title">🎰 盲盒 · ${box.map ? box.map.name : '安慰奖'}</div>
         <div class="sc-box-item">${box.reward ? describeBoxReward(box.reward) : '💰 额外金币与化肥'}</div>
       </div>`
    : '';

  layer = document.createElement('div');
  layer.className = 'sign-celebrate';
  layer.innerHTML = `
    <div class="sc-card">
      <div class="sc-ring"></div>
      <div class="sc-emoji">🎁</div>
      <div class="sc-title">签到成功</div>
      <div class="sc-sub">第 ${day} 天 · 连续签到 ${streak} 天</div>
      <div class="sc-rewards">
        <div class="sc-reward"><span>💰</span><b data-count="${coins}">0</b></div>
      </div>
      ${(itemsHTML || seedHTML) ? `<div class="sc-items">${itemsHTML}${seedHTML}</div>` : ''}
      ${boxHTML}
    </div>`;
  layer.addEventListener('click', dismiss);
  document.body.appendChild(layer);

  for (const el of layer.querySelectorAll('[data-count]')) {
    countUp(el, Number(el.dataset.count));
  }
  timer = setTimeout(dismiss, HOLD_MS);
}

/** 订阅签到事件 */
export function mountSignCelebrate() {
  on(EVENTS.SIGN, (payload) => {
    if (payload) showSignCelebrate(payload);
  });
}
