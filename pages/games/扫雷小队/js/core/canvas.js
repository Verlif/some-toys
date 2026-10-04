/**
 * 画布句柄 + 分辨率管理。
 *
 * ── 两套尺寸
 *   逻辑尺寸：恒为 CW × CH，所有绘制代码按逻辑坐标书写，不关心屏幕多大。
 *   位图尺寸：canvas.width/height，= 显示尺寸 × DPR。
 *
 * ── 为什么不能只靠 CSS 放大
 *   位图保持 912×432、让 CSS 拉到 1896 宽，本质是把小图插值放大 → 糊。
 *   正确做法是把位图分辨率提到「显示尺寸 × DPR」，绘制时用 setTransform 把逻辑坐标
 *   映射到设备像素：矩形、圆弧、文字全部按高分辨率重新栅格化，放大后依然锐利。
 */
import { CW, CH, MAX_DPR, MAX_BACKING_PX } from './config.js';

export const canvas = document.getElementById('gameCanvas');
export const ctx = canvas.getContext('2d');

canvas.width = CW;
canvas.height = CH;

export function dpr() {
  return Math.min(window.devicePixelRatio || 1, MAX_DPR);
}

/**
 * 让位图分辨率跟上元素的显示宽度。
 * 高度按 CW:CH 原始比例推出来，所以 CSS 里的 height:auto 不会改变比例。
 * @returns {boolean} 是否真的重建了位图（重建会清空画布，下一帧会整体重绘，无影响）
 */
export function syncResolution(cv) {
  const rect = cv.getBoundingClientRect ? cv.getBoundingClientRect().width : 0;
  const cssW = rect > 0 ? rect : CW;

  let bw = Math.max(CW, Math.round(cssW * dpr()));
  let bh = Math.round(bw * CH / CW);

  // 超大屏上限制总像素：宁可略微降采样，也不要让每帧填充量拖垮帧率
  const total = bw * bh;
  if (total > MAX_BACKING_PX) {
    const k = Math.sqrt(MAX_BACKING_PX / total);
    bw = Math.max(CW, Math.round(bw * k));
    bh = Math.round(bw * CH / CW);
  }

  if (cv.width === bw && cv.height === bh) return false;
  cv.width = bw;
  cv.height = bh;
  return true;
}

/** 按给定倍率重建位图（菜单背景画布拉满屏幕用，不依赖布局宽度） */
export function setResolutionScale(cv, scale) {
  const bw = Math.max(CW, Math.round(CW * scale));
  const bh = Math.round(bw * CH / CW);
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
}

/** 绘制缩放 = 位图宽 / 逻辑宽，render() 用它做 setTransform */
export function drawScale(cv) {
  return cv.width / CW;
}
