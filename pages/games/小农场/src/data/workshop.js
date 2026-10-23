/**
 * 种子制造间：把仓库里的农产品换回同种作物的种子。
 *
 * 数值上最要紧的一条：**一次制造吃掉多少产出**。
 *
 * 口径是「半轮产量」：一轮（种一次到全部收完）的平均产出 ÷ 2，最低 1 份。
 * 收获半轮就能造一次种子 —— 好记、好算，玩家站在仓库前就能心算。
 * 多茬作物按整轮算（平均产量 × 收获次数），谁让它一轮本来就收得多。
 * 因为直接引用 yield / harvests，不需要单独维护「哪个作物要几个」的表，
 * 生成器一调产量这里自动跟着变。
 *
 * 金币侧是**半价工本费**（一颗种子价钱 ÷ 2）：制造不该是免费午餐，
 * 但也不该比去商店买还贵。半价之后「自己造」的定位变成
 * **用富余产出换种子、只付一点手续费** —— 产出便宜的作物（低等级）
 * 造一次划算，产出昂贵的作物（高等级）倒贴，抉择留给玩家。
 *
 * 于是每次制造的总投入 = 半轮产出 + 半颗种子，产出期望 1.22~2.00 颗：
 * 小麦（Lv1）−25% → 满级 +25%；碧波瓜（Lv80）满级约 +14%。
 * 制造间的等级因此有了存在感（光加概率的话，玩家没动力升）。
 */
import { CROPS } from './crops.js';

/** 解锁条件：农场等级 + 一次性金币 */
export const WORKSHOP_UNLOCK = { level: 5, cost: 2000 };

/** 最高等级 */
export const WORKSHOP_MAX_LEVEL = 10;

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
 * 制造一份种子要吃多少农产品 = **半轮产量**（最低 1 份）。
 *
 * 「一轮」= 种一次到全部收完：单次收获的平均产量 × 收获次数。
 * 除以 2 就是「收获半轮换一次制造」—— 玩家刚收完一轮地，
 * 手里的产出差不多够造两次，节奏刚好。
 *
 * @param {{yield: [number, number], harvests?: number}} crop
 * @returns {number} 份数（≥ 1）
 */
export function produceCost(crop) {
  if (!crop?.yield) return 1;
  const avg = (crop.yield[0] + crop.yield[1]) / 2;
  const perRound = avg * Math.max(1, crop.harvests || 1);
  return Math.max(1, Math.round(perRound / 2));
}

/** 某个作物 id 的消耗份数；不认识的作物返回 0 */
export function costOf(cropId) {
  return CROPS[cropId] ? produceCost(CROPS[cropId]) : 0;
}

/**
 * 一次制造的工本费 = **一颗同种作物种子价钱 ÷ 2**。
 *
 * 半价是刻意的：全价会让「自己造」在任何等级都输给商店（买种子只要花金币，
 * 自己造还要赔上半轮产出）；半价则把制造间定位成「用富余产出换种子」——
 * 金币照付一点，换的是不用去商店排队、也不占用那笔买地的大钱。
 *
 * @param {{seed: number}} crop
 * @returns {number} 金币
 */
export function craftFee(crop) {
  return Math.max(0, Math.round((crop?.seed || 0) / 2));
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
