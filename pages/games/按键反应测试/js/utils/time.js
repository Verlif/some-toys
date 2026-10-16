/** 时间与数值工具 */

export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const now = () => performance.now();

export const randomBetween = (min, max) => min + Math.random() * (max - min);

export const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

/** 毫秒 → "123 ms" */
export function fmtMs(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  return `${Math.round(value)} ms`;
}

/** 毫秒 → "3.4s" / "1:02.5" */
export function fmtClock(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const tenth = Math.floor((total % 1000) / 100);
  if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, '0')}.${tenth}`;
  return `${seconds}.${tenth}s`;
}
