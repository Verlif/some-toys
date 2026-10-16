/**
 * 预览键盘自适应：按容器可用宽度等比缩放键帽尺寸。
 * 宽度对 unit 是线性的，所以直接解一次方程即可，无需反复测量 DOM。
 */

import { estimateWidth } from '../core/layouts.js';

const MAX_UNIT = 28;   // 与 .keyboard--mini 的默认 --u 对齐
const MIN_UNIT = 12;   // 下限，再窄就让容器横向滚动
const GAP_RATIO = 0.2; // 键间距与键宽的比例
const MIN_GAP = 2;
const FALLBACK_FRAME = 20;

function frameSize(el) {
  const style = getComputedStyle(el);
  const px = (value) => parseFloat(value) || 0;
  return px(style.paddingLeft) + px(style.paddingRight)
    + px(style.borderLeftWidth) + px(style.borderRightWidth);
}

/**
 * @param {HTMLElement} container  可用空间来源（预览框）
 * @param {HTMLElement} board      键盘根元素
 * @param {Array} rows             当前布局行数据
 */
export function fitPreview(container, board, rows) {
  const available = container?.clientWidth || 0;
  if (!available || !rows?.length) return;

  const frame = frameSize(board) || FALLBACK_FRAME;
  let unit = MAX_UNIT;

  if (estimateWidth(rows, unit, unit * GAP_RATIO, frame) > available) {
    const factor = estimateWidth(rows, 1, GAP_RATIO, 0); // 宽度 = unit * factor + frame
    unit = Math.max(MIN_UNIT, (available - frame) / factor);
  }

  unit = Math.floor(unit * 10) / 10;
  const gap = Math.max(MIN_GAP, Math.round(unit * GAP_RATIO * 10) / 10);
  board.style.setProperty('--u', `${unit}px`);
  board.style.setProperty('--gap', `${gap}px`);
}

/**
 * 监听容器尺寸（含从隐藏变为显示），自动重新适配。
 * @returns {{ setRows(rows:Array):void, destroy():void }}
 */
export function createPreviewFitter(container, board) {
  let rows = [];
  const apply = () => fitPreview(container, board, rows);
  const observer = new ResizeObserver(apply);
  observer.observe(container);

  return {
    setRows(next) {
      rows = next;
      apply();
    },
    destroy() {
      observer.disconnect();
    }
  };
}
