/**
 * 结算等待画面。
 *
 * 世界时钟要一段一段把「你不在的这段时间」走完，这件事是分帧做的，
 * 所以用这张卡把它包起来：告诉玩家正补算到哪一刻，而不是让页面突然卡住。
 *
 * 进度按**时间比例**算，不按会话数 —— 会话数是掷出来的，做不得准。
 */
import { byId } from '../core/dom.js';
import { clockText } from '../core/utils.js';

const MIN_DISPLAY_MS = 650;

let root = null;
let bar = null;
let label = null;
let detail = null;
let shownAt = 0;

/**
 * 打开等待画面
 * @returns {{update: (progress: {at: number, percent: number}) => void, close: () => Promise<void>}}
 */
export function showSimOverlay() {
  root = root || byId('simOverlay');
  root.hidden = false;
  shownAt = performance.now();

  bar = root.querySelector('.sim-bar > i');
  label = root.querySelector('.sim-label');
  detail = root.querySelector('.sim-detail');

  return {
    update(progress) {
      const pct = Math.max(0, Math.min(100, progress?.percent ?? 100));
      bar.style.width = `${pct}%`;
      label.textContent = pct >= 100 ? '结算完成' : `${pct}%`;
      detail.textContent = progress?.at
        ? `正在补算到 ${clockText(progress.at)}…`
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