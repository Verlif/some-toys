/**
 * 结算等待画面。
 *
 * 进入邻居页时，离线期间发生的成长需要被补算一遍。这件事是分帧做的，
 * 所以用这张卡把它包起来：告诉玩家「邻居们正在farm」，而不是让页面突然卡住。
 */
import { byId } from '../core/dom.js';

const MIN_DISPLAY_MS = 650;

let root = null;
let bar = null;
let label = null;
let detail = null;
let shownAt = 0;

/**
 * 打开等待画面
 * @returns {{update: (done: number, total: number) => void, close: () => Promise<void>}}
 */
export function showSimOverlay() {
  root = root || byId('simOverlay');
  root.hidden = false;
  shownAt = performance.now();

  bar = root.querySelector('.sim-bar > i');
  label = root.querySelector('.sim-label');
  detail = root.querySelector('.sim-detail');

  return {
    update(done, total) {
      const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 100;
      bar.style.width = `${pct}%`;
      label.textContent = pct >= 100 ? '结算完成' : `${pct}%`;
      detail.textContent = total > 0
        ? `正在推演 ${total} 次上线活动…`
        : '邻居们最近很清闲，一切安好';
    },

    /** 结算完再关闭，并保证画面至少停留 MIN_DISPLAY_MS，避免一闪而过 */
    async close() {
      const wait = MIN_DISPLAY_MS - (performance.now() - shownAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      root.hidden = true;
    },
  };
}