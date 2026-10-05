/**
 * 布局适配：把「对局 / 回放」的内容按画布原始比例（CW × CH）等比放大到刚好铺满可视区。
 *
 * ── 为什么不用纯 CSS
 *    只给 canvas 设 max-width / max-height 也能保住比例，但画布会缩在中间、
 *    顶栏与 HUD 仍是整宽，看起来就是「中间一小块」。
 *    这里改成量出「围栏高度」（顶栏 + HUD + 提示 + 间距 / 回放的头 + 控制条），
 *    反算出画布该有的宽度，再把整个 wrap 设成这个宽度——
 *    画布、顶栏、HUD 始终同宽，整体作为一个单元等比缩放，不拉伸也不留大片空白。
 *
 * ── 两遍以上测量
 *    宽度变化会让提示行、队伍卡片换行，围栏高度也跟着变，所以迭代几次收敛。
 */
import { CW, CH } from '../core/config.js';
import { syncResolution } from '../core/canvas.js';

const PAD = 24;        // body 上下左右各 12px 内边距
const MIN_W = 320;     // 再窄也不小于这个宽度，避免极端窗口下缩成一条
const PASSES = 3;

let pending = false;   // 开局后等第一帧 HUD 有内容了再量

export function requestFit() { pending = true; }
export function consumeFit() { const p = pending; pending = false; return p; }

/** 对局：画布 + 顶栏 + HUD + 提示 */
export function fitGameStage() {
  fitStage(
    document.querySelector('#gameScreen .game-wrap'),
    document.getElementById('gameCanvas')
  );
}

/** 回放：画布 + 顶部说明 + 底部控制条 */
export function fitReplayStage() {
  fitStage(
    document.querySelector('#replayScreen .replay-stage'),
    document.getElementById('replayCanvas')
  );
}

export function fitAll() {
  fitGameStage();
  fitReplayStage();
}

function fitStage(wrap, cv) {
  // display:none 时 offsetHeight 恒为 0，量出来的数没有意义
  if (!wrap || !cv || !cv.offsetParent) return;

  for (let i = 0; i < PASSES; i++) {
    if (i === 0) wrap.style.width = '';              // 先按整宽量一次围栏高度
    const chrome = Math.max(0, wrap.offsetHeight - cv.offsetHeight);
    const availH = Math.max(CH * 0.25, window.innerHeight - PAD - chrome);
    const scale = Math.min((window.innerWidth - PAD) / CW, availH / CH);
    wrap.style.width = Math.max(MIN_W, Math.floor(CW * scale)) + 'px';
  }

  // 宽度定完后把位图分辨率对齐到「显示尺寸 × DPR」：
  // 逻辑坐标不变（render 里 setTransform 负责映射），所以放大后是重绘而非拉伸。
  syncResolution(cv);
}
