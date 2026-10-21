/**
 * 种子制造间：把仓库里的农产品换回同种作物的种子。
 *
 * 数值上最要紧的一条：**消耗多少份产出**。
 *
 * 农产品的单价远低于种子价（`seed = 10 × lv^1.75`，而 `sell` 是整轮收益倒推出来的），
 * 一份小麦只值 1 金币，它的种子却要 10 金币。所以「固定消耗 5 份」在低等级就是 2.4 倍，
 * 到 Lv200 会变成 12 倍 —— 等于白送钱，商店的种子就没人买了。
 *
 * 这里改成按市价折算，并且**每次还要收一笔工本费**（`craftFee`，等于一颗种子的售价）。
 *
 * 于是每次制造的总投入 ≈ `PRODUCE_FACTOR + 1` 个种子的价钱：
 * 1 级（期望 1.22 个）基本持平，满级（期望 2.00 个）约赚 67%。
 * 这也把「工本费」变成除了产出之外的第二个消耗口 —— 金币不会只进不出。
 *
 * 下限钉在 5 份，一是照顾低等级作物，二是别让「刚解锁就无限印种子」。
 */
import { CROPS } from './crops.js';

/** 解锁条件：农场等级 + 一次性金币 */
export const WORKSHOP_UNLOCK = { level: 5, cost: 2000 };

/** 最高等级 */
export const WORKSHOP_MAX_LEVEL = 10;

/**
 * 产出份数按「种子价 × 这个系数 ÷ 农产品单价」折算。
 *
 * 第 21 轮加了工本费（1.0 个种子价）之后从 0.6 降到 0.2 ——
 * 否则总投入 1.6 个种子价，而 1 级只产出 1.22 个，全场都是亏本买卖。
 */
export const PRODUCE_FACTOR = 0.2;

/** 每次制造最少要吃的份数 */
export const PRODUCE_MIN = 5;

/**
 * 等级表。
 *
 * - `kinds` 升到这一级所需的**造过的作物种类数**（不是制造次数）
 * - `cost` 升到这一级要付的金币
 * - `odds` 一次制造出 1 / 2 / 3 个种子的概率，三项和恒为 1
 *
 * 期望 = 1×p1 + 2×p2 + 3×p3，从 1.22 涨到 2.00。
 *
 * ⚠️ **升级口径是「种类」而不是「次数」**：按次数的时代，最简单的最优解是
 * 拿最便宜的小麦反复制造凑数 —— 成本最低、每次算一次，升级跟「经营」无关。
 * 换成种类之后，同一锅小麦造一百次也只算 1 种，想升级就得把仓库里的
 * 产出摊开、什么作物都造一点。门槛因此从「几百次」变成「几十种」。
 */
export const WORKSHOP_LEVELS = [
  { level: 1, kinds: 0, cost: 0, odds: [0.80, 0.18, 0.02] },
  { level: 2, kinds: 3, cost: 2000, odds: [0.75, 0.22, 0.03] },
  { level: 3, kinds: 6, cost: 4000, odds: [0.70, 0.26, 0.04] },
  { level: 4, kinds: 10, cost: 8000, odds: [0.64, 0.30, 0.06] },
  { level: 5, kinds: 15, cost: 15000, odds: [0.58, 0.34, 0.08] },
  { level: 6, kinds: 21, cost: 28000, odds: [0.52, 0.38, 0.10] },
  { level: 7, kinds: 28, cost: 50000, odds: [0.46, 0.42, 0.12] },
  { level: 8, kinds: 36, cost: 90000, odds: [0.40, 0.46, 0.14] },
  { level: 9, kinds: 45, cost: 160000, odds: [0.33, 0.51, 0.16] },
  { level: 10, kinds: 55, cost: 280000, odds: [0.25, 0.50, 0.25] },
];

/** 取某一级的配置（越界自动夹到 1~10） */
export function levelRow(level) {
  const i = Math.min(WORKSHOP_MAX_LEVEL, Math.max(1, Math.round(level || 1))) - 1;
  return WORKSHOP_LEVELS[i];
}

/** 下一级的配置；满级返回 null */
export function nextLevelRow(level) {
  return level >= WORKSHOP_MAX_LEVEL ? null : WORKSHOP_LEVELS[Math.max(0, level)];
}

/** 某一级的期望种子数（保留两位小数） */
export function expectedSeeds(level) {
  const [p1, p2, p3] = levelRow(level).odds;
  return Math.round((p1 + 2 * p2 + 3 * p3) * 100) / 100;
}

/**
 * 制造一份种子要吃多少农产品。
 *
 * 用真实单价折算，所以数值调整作物价格后这里会自动跟着变，
 * 不需要再单独维护一张「哪个作物要几个」的表。
 *
 * @param {{seed: number, sell: number}} crop
 * @returns {number} 份数（≥ PRODUCE_MIN）
 */
export function produceCost(crop) {
  if (!crop || !crop.sell) return PRODUCE_MIN;
  return Math.max(PRODUCE_MIN, Math.ceil((crop.seed * PRODUCE_FACTOR) / crop.sell));
}

/** 某个作物 id 的消耗份数；不认识的作物返回 0 */
export function costOf(cropId) {
  return CROPS[cropId] ? produceCost(CROPS[cropId]) : 0;
}

/**
 * 一次制造的工本费 = **一颗同种作物种子的售价**。
 *
 * 制造不该是「产出换种子」的免费午餐：产出的份数已经按市价折算过，
 * 再收一道与种子等价的工本费，玩家才会在「买种子」和「自己造」之间真的权衡。
 *
 * @param {{seed: number}} crop
 * @returns {number} 金币
 */
export function craftFee(crop) {
  return Math.max(0, Math.round(crop?.seed || 0));
}

/**
 * 摇一次种子数量。
 * @param {number} level 制造间等级
 * @returns {1|2|3}
 */
export function rollSeeds(level) {
  const [p1, p2] = levelRow(level).odds;
  const roll = Math.random();
  if (roll < p1) return 1;
  if (roll < p1 + p2) return 2;
  return 3;
}
