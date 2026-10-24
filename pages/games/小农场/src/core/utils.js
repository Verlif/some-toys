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
 * 把「省下来的毫秒数」说成人话，用于浇水 / 施肥的提示文案。
 * 例：45000 → "45 秒"，5400000 → "1.5 小时"
 * @param {number} ms
 * @returns {string}
 */
export function fmtSaved(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0 秒';
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)} 分钟`;
  return `${(ms / 3600_000).toFixed(1)} 小时`;
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
 * 本地日期序号（0 点切日）：同一天相等，相差几天直接相减。
 *
 * dayKey 是字符串，算「隔了几天」得先拆年月日；比较跨度用这个。
 * 也接受 'YYYY-M-D' 日期键（读档里的存的就是这个）。
 * @param {number|string} [ts] 时间戳或日期键
 * @returns {number}
 */
export function dayIndex(ts = Date.now()) {
  let y;
  let m;
  let d;
  if (typeof ts === 'string') {
    [y, m, d] = ts.split('-').map(Number);
    if (!y || !m || !d) return 0;
  } else {
    const dt = new Date(ts);
    y = dt.getFullYear();
    m = dt.getMonth() + 1;
    d = dt.getDate();
  }
  return Math.floor(new Date(y, m - 1, d).getTime() / 86_400_000);
}

/**
 * 排行榜日期键：**按 14:00 切日**（每天下午 2 点结算前一天）。
 *
 * 14:00 之前算「昨天」，14:00 起算「今天」。
 * 实现：把时间往前拨 14 小时再取自然日 —— 13:59 的 3月15日 拨回 3月14日 23:59。
 * 全部用本地时间（getFullYear/getMonth/getDate），不是 UTC。
 * @param {number} [ts]
 * @returns {string}
 */
export function boardDayKey(ts = Date.now()) {
  return dayKey(ts - 14 * 3600_000);
}

/**
 * 某一期的起点时间戳：`date` 那天的 14:00（本地时间）。
 *
 * 行里存一份 `start` 就是为了防「同键不同义」——旧账期的行可能和现在用同一把日期键，
 * 但时间窗完全不同，靠它一眼就能认出来（见 store/daily.js 的 rowOf）。
 * @param {string} dateKey
 * @returns {number}
 */
export function boardPeriodStart(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d, 14, 0, 0, 0).getTime();
}

/**
 * 某一期榜单的统计区间文本，形如「10/22 14:00 → 10/23 14:00」。
 *
 * 行的 `date` 是**账期开始那天**（见 boardDayKey），所以区间是 date 14:00 到次日 14:00。
 * 界面上必须把它写出来 —— 只写「昨日 · 10-22」的话，玩家会以为统计的是
 * 10-22 的 0 点到 24 点（见 docs/04-数值平衡.md 的「每日排行榜」）。
 * @param {string} dateKey
 * @returns {string}
 */
export function boardPeriodText(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  if (!y || !m || !d) return '';
  const start = new Date(y, m - 1, d, 14, 0);
  const end = new Date(y, m - 1, d + 1, 14, 0);
  const fmt = (dt) => `${dt.getMonth() + 1}/${dt.getDate()} 14:00`;
  return `${fmt(start)} → ${fmt(end)}`;
}

/**
 * 距离下一次「下午 2 点出榜」还剩多久。
 * @param {number} [ts] 当前时刻
 * @returns {{ms: number, text: string}} text 形如「3 小时 24 分」或「23 小时 59 分」
 */
export function boardCountdown(ts = Date.now()) {
  const now = new Date(ts);
  const target = new Date(now);
  target.setHours(14, 0, 0, 0);
  if (now >= target) target.setDate(target.getDate() + 1);
  const ms = target - now;
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return { ms, text: h > 0 ? `${h} 小时 ${m} 分` : `${m} 分` };
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