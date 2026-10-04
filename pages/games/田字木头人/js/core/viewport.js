/**
 * 画布与视口。
 *
 * 游戏内部一律使用逻辑坐标 1440×560（VW / VH），
 * 这里负责把它等比缩放、居中地映射到任意窗口尺寸，并处理高清屏 dpr。
 *
 * dpr / viewScale / viewOx / viewOy / cssW / cssH 是 let，
 * 利用 ES module 的实时绑定，渲染层 import 进来就能读到 resize 后的最新值。
 */
import { VW, VH } from './config.js';

export const canvas = document.getElementById('game');
export const ctx = canvas.getContext('2d');

export let dpr = 1, viewScale = 1, viewOx = 0, viewOy = 0, cssW = 0, cssH = 0;

/** 重算画布像素与视口变换 */
export function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cssW = window.innerWidth;
  cssH = window.innerHeight;

  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';

  /* 等比缩放 + 居中留边 */
  viewScale = Math.min(cssW / VW, cssH / VH);
  viewOx = (cssW - VW * viewScale) / 2;
  viewOy = (cssH - VH * viewScale) / 2;
}

/** 绑定窗口事件并做首次布局 */
export function initViewport() {
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  resize();
}
