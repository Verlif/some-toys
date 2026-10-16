/**
 * utils/format.js — 展示格式化
 */

/** 字节数 -> 人类可读体积 */
export function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

/** 百分比取整 */
export function toPercent(ratio) {
  return Math.round((ratio || 0) * 100);
}
