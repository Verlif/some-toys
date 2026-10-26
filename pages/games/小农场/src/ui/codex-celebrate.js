/**
 * 图鉴点亮成功的庆祝画面。
 *
 * 在作物详情弹窗里按下「🧪 制作标本」后，弹窗会先关掉，再由这里播一张
 * 居中卡片：金圈扩散 + 作物图标跳动 + 「图鉴点亮」+ 点亮进度与种子奖励，
 * 约 2.4 秒后自动收起，点一下也能提前关掉。
 *
 * 和签到庆祝（ui/sign-celebrate.js）同一套骨架，只是配色偏金绿、内容不同；
 * 同样不占用 #modal 的动作分发，避免和随后打开的弹窗互相打断。
 */
import { on, EVENTS } from '../core/bus.js';

const HOLD_MS = 2400;
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
 * 播放图鉴点亮庆祝
 * @param {{cropId:string, name:string, emoji:string, seed:number,
 *          lit:number, total:number, litPercent:number}} payload
 */
export function showCodexCelebrate({ name, emoji, seed, lit, total, litPercent }) {
  dismiss();

  layer = document.createElement('div');
  layer.className = 'codex-celebrate';
  layer.innerHTML = `
    <div class="cc-card">
      <div class="cc-ring"></div>
      <div class="cc-emoji">${emoji || '📖'}</div>
      <div class="cc-title">图鉴点亮</div>
      <div class="cc-sub">${name || '作物'} · 第 ${lit} / ${total} 种</div>
      <div class="cc-rewards">
        <div class="cc-reward"><span>🌱</span><b data-count="${seed}">0</b><small>颗种子</small></div>
        <div class="cc-reward"><span>📖</span><b data-count="${litPercent}">0</b><small>% 点亮</small></div>
      </div>
    </div>`;
  layer.addEventListener('click', dismiss);
  document.body.appendChild(layer);

  for (const el of layer.querySelectorAll('[data-count]')) {
    countUp(el, Number(el.dataset.count));
  }
  timer = setTimeout(dismiss, HOLD_MS);
}

/** 订阅图鉴点亮事件 */
export function mountCodexCelebrate() {
  on(EVENTS.SPECIMEN, (payload) => {
    if (payload) showCodexCelebrate(payload);
  });
}
