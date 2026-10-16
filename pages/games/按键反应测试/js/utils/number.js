/** 数值工具 */

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** 转整数并夹取范围，非法值返回 fallback */
export function clampInt(value, min, max, fallback = min) {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return fallback;
  return clamp(num, min, max);
}
