/**
 * 新手引导：一次性、不重置、做完即领。
 *
 * 取代了原先的「每日任务」——每日重置的任务在 200 种作物、200 级的体量下
 * 变成了一种每日负担，而新人真正需要的是一条「接下来该干什么」的路径。
 *
 * 分三条链 + 一个收集向的收尾，越往后越靠近「这个游戏还有什么」：
 *   把种子种下  农场基本功（播种 → 照料 → 收获 → 卖钱）
 *   走出农场    社交与眼界（串门 → 顺菜 → 帮忙 → 看时报 → 买东西）
 *   安家立业    经营与冒险（签到 → 喂狗 → 升级 → 寻宝 → 称号）
 *   第一份标本  收集向的引子，直接送一张一级藏宝图把玩家领进冒险
 *
 * 奖励在达成时自动发放并弹提示，不会因为忘记点而损失。
 * items 是背包道具 id → 数量；map_1 这种藏宝图 key 也走背包。
 */
import { itemLabel, mapId } from './keys.js';

/** 一级藏宝图的背包 key */
const MAP1 = mapId(1);

export const GUIDES = [
  /* ---- 把种子种下 ---- */
  { key: 'plant', name: '第一次播种', emoji: '🌱', desc: '在任意一块地上种下作物',
    chain: 1,
    coins: 0, exp: 20, items: { fertilizer: 1 } },
  { key: 'water', name: '第一次浇水', emoji: '💧', desc: '给缺水的作物浇水（自家或邻居家的都算）',
    chain: 1,
    coins: 40, exp: 20, items: {} },
  { key: 'pest', name: '第一次捉虫', emoji: '🐛', desc: '给生虫的作物捉虫',
    chain: 1,
    coins: 0, exp: 20, items: { pesticide: 1 } },
  { key: 'fert', name: '第一次施肥', emoji: '🧪', desc: '给作物施一次肥',
    chain: 1,
    coins: 0, exp: 20, items: { fert1h: 1 } },
  { key: 'harvest', name: '第一次收获', emoji: '🌾', desc: '收获一片成熟的作物',
    chain: 1,
    coins: 0, exp: 25, items: { boost10: 1 } },
  { key: 'sell', name: '第一次交易', emoji: '💰', desc: '把农产品卖进仓库换钱',
    chain: 1,
    coins: 60, exp: 20, items: {} },

  /* ---- 走出农场 ---- */
  { key: 'visit', name: '第一次串门', emoji: '🏃', desc: '打开任意一座邻居的农场',
    chain: 2,
    coins: 30, exp: 15, items: {} },
  { key: 'steal', name: '第一次顺菜', emoji: '🥷', desc: '从邻居地里顺走一个成熟的作物',
    chain: 2,
    coins: 40, exp: 30, items: {} },
  { key: 'care', name: '第一次帮忙', emoji: '🤝', desc: '在邻居的地块上浇水或捉虫',
    chain: 2,
    coins: 0, exp: 30, items: { dogFood: 2 } },
  { key: 'news', name: '第一次看时报', emoji: '📰', desc: '翻开全镇时报，看看最近发生了什么',
    chain: 2,
    coins: 20, exp: 10, items: {} },
  { key: 'shop', name: '第一次采购', emoji: '🛒', desc: '在商店买下第一件东西',
    chain: 2,
    coins: 0, exp: 20, items: { sprinkler: 1 } },

  /* ---- 安家立业 ---- */
  { key: 'sign', name: '第一天签到', emoji: '📅', desc: '完成一次每日签到',
    chain: 3,
    coins: 30, exp: 10, items: {} },
  { key: 'feed', name: '第一顿饭', emoji: '🦴', desc: '喂一次守护犬',
    chain: 3,
    coins: 0, exp: 20, items: { dogFood: 3 } },
  { key: 'specimen', name: '第一份标本', emoji: '🧪', desc: '制作第一份标本，点亮图鉴',
    chain: 3,
    coins: 0, exp: 40, items: { [MAP1]: 1 } },
  { key: 'upgrade', name: '第一块好地', emoji: '🟫', desc: '把一块地升级成更肥沃的土地',
    chain: 3,
    coins: 0, exp: 80, items: { organic: 1 } },
  { key: 'map', name: '第一张藏宝图', emoji: '🧭', desc: '买下第一张藏宝图，准备第一次寻宝',
    chain: 3,
    coins: 100, exp: 50, items: { [MAP1]: 1 } },
  { key: 'title', name: '第一个称号', emoji: '🏅', desc: '领取第一个称号',
    chain: 3,
    coins: 80, exp: 30, items: {} },
];

/** 图鉴与引导共用的统计维度说明，供文档与 UI 复用 */
export const STAT_FIELDS = [
  { key: 'planted', label: '种植', emoji: '🌱' },
  { key: 'harvested', label: '收获', emoji: '🧺' },
];

/**
 * 一行奖励文案：「+40 💰 +20 经验 · 🦴 狗粮 ×2」。
 * 只带有的部分，没有道具就不出现道具段。
 * @param {{coins?: number, exp?: number, items?: Record<string, number>}} guide
 * @returns {string}
 */
export function guideRewardText(guide) {
  const parts = [];
  if (guide.coins) parts.push(`+${guide.coins} 💰`);
  if (guide.exp) parts.push(`+${guide.exp} 经验`);
  for (const [id, n] of Object.entries(guide.items || {})) {
    parts.push(`${itemLabel(id)} ×${n}`);
  }
  return parts.join(' · ');
}
