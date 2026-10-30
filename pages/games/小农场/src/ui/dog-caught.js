/**
 * 「被邻居家的守护犬抓住」的全屏提示。
 *
 * 偷菜被狗逮住是玩家**吃瘪**的时刻，只靠一条 toast 很容易看漏 ——
 * 尤其是玩家正盯着邻居的地块点偷的时候。所以这里闪一张全屏的狗：
 * 品种 emoji 从小弹到满屏、一圈光晕扩散，1.7 秒后自己淡出。
 *
 * 不复用 `#modal`：这个提示是「事件播报」，不该占住弹窗的动作分发，
 * 也不该挡住玩家正在看的邻居弹窗（它只是短暂盖一下）。
 * 和 `sign-celebrate.js` 一样自己造一层，播完就整个移除。
 */
import { on, EVENTS } from '../core/bus.js';
import { dogBreed } from '../data/dogs.js';
import { formatCoins } from '../core/utils.js';

/** 停留时长：够看清是谁家的狗，又不至于烦人 */
const HOLD_MS = 1700;
const FADE_MS = 300;

let layer = null;
let timer = 0;

/** 收起（重复调用安全） */
function dismiss() {
  if (!layer) return;
  clearTimeout(timer);
  const el = layer;
  layer = null;
  el.classList.add('out');
  setTimeout(() => el.remove(), FADE_MS);
}

/**
 * 播放一次提示。
 * @param {{breed?: string, owner?: string, fine?: number}} payload
 */
export function showDogCaught({ breed, owner = '邻居', fine = 0 } = {}) {
  dismiss();

  const dog = dogBreed(breed);
  // 认不出品种就用一条普通的狗，别让画面空着
  const emoji = dog?.emoji || '🐕';
  const name = dog?.name || '守护犬';

  layer = document.createElement('div');
  layer.className = 'dog-caught';
  layer.innerHTML = `
    <div class="dc-glow"></div>
    <div class="dc-emoji">${emoji}</div>
    <div class="dc-title">被守护犬抓住了！</div>
    <div class="dc-sub">${owner} 家的${name}${dog ? `（拦截 ${Math.round(dog.rate * 100)}%）` : ''}</div>
    ${fine > 0 ? `<div class="dc-fine">罚款 ${formatCoins(fine)} 💰</div>` : ''}
  `;
  layer.addEventListener('click', dismiss);
  document.body.appendChild(layer);

  timer = setTimeout(dismiss, HOLD_MS);
}

/** 订阅事件 */
export function mountDogCaught() {
  on(EVENTS.DOG_CAUGHT, (payload) => {
    if (payload) showDogCaught(payload);
  });
}
