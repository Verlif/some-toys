/**
 * 画布句柄：逻辑尺寸固定为 CW × CH，由 CSS 负责等比缩放。
 */
import { CW, CH } from './config.js';

export const canvas = document.getElementById('gameCanvas');
export const ctx = canvas.getContext('2d');

canvas.width = CW;
canvas.height = CH;
