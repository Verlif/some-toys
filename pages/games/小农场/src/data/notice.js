/**
 * 农场通知的数据形状与清洗规则（纯函数，不认识存档也不碰 DOM）。
 *
 * 通知会跟着存档走 30 天，里面可能留着已经下架的道具 id、被改名删掉的邻居；
 * 读档时统一在这里洗一遍，store 与 UI 就不用各自防一遍坏数据。
 *
 * 一条通知：
 * ```
 * { id, at, kind, emoji, title, body, by, from, reward, claimText, read, claimed }
 * ```
 *   - `kind`   gift / award / npc
 *   - `by`     来源邻居 id（点一下能打开那位邻居）
 *   - `reward` `{ coins?, items?, maps? }`，null = 纯消息
 *   - `claimed` 没有 reward 的消息恒为 true（「已读即完成」）
 */
import { isItemKey } from './keys.js';

/** 领过的通知留多少天 */
export const NOTICE_KEEP_DAYS = 30;

/** 最多堆多少条（没领的优先保住） */
export const NOTICE_CAP = 120;

const DAY_MS = 86_400_000;

/**
 * 奖励洗干净：只留认得出来的字段与正数。
 *
 * 认不出来的 key 一律丢掉 —— 老存档里可能存着已下架的道具，
 * 领取时往背包里塞不存在的东西，商店与仓库都会跟着崩。
 *
 * @param {any} raw
 * @returns {?{coins?: number, items?: Record<string, number>, maps?: number[]}}
 */
export function cleanReward(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};

  const coins = Math.max(0, Math.round(Number(raw.coins) || 0));
  if (coins) out.coins = coins;

  const items = {};
  for (const [id, n] of Object.entries(raw.items || {})) {
    const count = Math.max(0, Math.floor(Number(n) || 0));
    // 产出 / 种子 / 藏宝图 / 道具都认（见 data/keys.js 的 isItemKey）
    if (count && isItemKey(id)) items[id] = count;
  }
  if (Object.keys(items).length) out.items = items;

  const maps = (Array.isArray(raw.maps) ? raw.maps : [])
    .map((tier) => Math.floor(Number(tier) || 0))
    .filter((tier) => tier > 0);
  if (maps.length) out.maps = maps;

  return Object.keys(out).length ? out : null;
}

/**
 * 通知列表清洗 + 裁剪。
 *
 * 领过的只留最近 30 天；**没领的一直留着**（最多 NOTICE_CAP 条）——
 * 玩家离线一个月回来，信箱里的东西不该已经被时间清空。
 *
 * @param {any} raw 存档里的原始数组
 * @param {number} [now]
 * @returns {object[]} 按时间倒序
 */
export function cleanNotices(raw, now = Date.now()) {
  const entries = (Array.isArray(raw) ? raw : [])
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') return null;
      const at = Number(entry.at);
      if (!Number.isFinite(at) || at <= 0) return null;
      const title = String(entry.title || '').trim();
      if (!title) return null;
      const reward = cleanReward(entry.reward);
      return {
        id: String(entry.id || `nt-old-${index}-${at}`),
        at,
        kind: String(entry.kind || 'npc'),
        emoji: String(entry.emoji || '📬'),
        title,
        body: String(entry.body || ''),
        by: String(entry.by || ''),
        from: String(entry.from || ''),
        reward,
        claimText: String(entry.claimText || ''),
        read: Boolean(entry.read),
        // 没有奖励的条目「已读即完成」；有奖励的以存档为准
        claimed: reward ? Boolean(entry.claimed) : true,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.at - a.at);

  const cutoff = now - NOTICE_KEEP_DAYS * DAY_MS;
  return entries
    .filter((entry) => !entry.claimed || entry.at >= cutoff)
    .slice(0, NOTICE_CAP);
}
