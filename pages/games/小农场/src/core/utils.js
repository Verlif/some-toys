/**
 * 通用工具函数（纯函数，无副作用、无 DOM/存储依赖）
 */

/**
 * 把毫秒时长格式化成中文短文本。
 * 例：45000 → "45秒"，90000 → "1分30秒"，5400000 → "1小时30分"
 *
 * 非有限值（NaN / Infinity）一律显示为「—」，
 * 避免存档里某个字段缺失时界面上冒出 "NaN小时"。
 * @param {number} ms
 * @returns {string}
 */
export function fmtDuration(ms) {
  if (!Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}分${sec ? `${sec}秒` : ''}`;
  const h = Math.floor(m / 60);
  const mi = m % 60;
  return `${h}小时${mi ? `${mi}分` : ''}`;
}

/**
 * 把任意值转成一个有限数字，拿不到就返回兜底值。
 * 用于清洗存档里可能缺失或为 undefined 的字段。
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function safeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * [min, max] 闭区间随机整数
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * 夹取数值到区间内
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 金币数量的短文本：万以内显示原数，再往上用「万 / 亿」缩写，
 * 避免顶栏与列表被长数字撑破。
 * @param {number} n
 * @returns {string}
 */
export function formatCoins(n) {
  if (n < 10_000) return String(n);
  if (n < 100_000_000) return `${(n / 10_000).toFixed(1)}万`;
  return `${(n / 100_000_000).toFixed(2)}亿`;
}

/**
 * 本地日期键 YYYY-M-D（不用 toISOString，避免时区偏移）
 * 0 点切日 —— 签到、日历等按自然日的地方用这个。
 * @param {number} [ts]
 * @returns {string}
 */
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * 排行榜日期键：**按 14:00 切日**（每天下午 2 点结算前一天）。
 *
 * 14:00 之前算「昨天」，14:00 起算「今天」。
 * 实现：把时间往前拨 14 小时再取自然日 —— 13:59 的 3月15日 拨回 3月14日 23:59。
 * @param {number} [ts]
 * @returns {string}
 */
export function boardDayKey(ts = Date.now()) {
  return dayKey(ts - 14 * 3600_000);
}

/**
 * 两个时间戳是否落在同一个自然日
 * @param {number} a
 * @param {number} b
 * @returns {boolean}
 */
export function isSameDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}