/**
 * 村庄建设与祈福。
 *
 * 村庄从 1 级起步、最高 5 级。升一级要**三项同时达标**：
 * 💰 金币 + 💎 对应等级的升级水晶 + 🙏 祈福总次数。
 * 三项在升级那一刻一起清零（金币与水晶是真花掉了，祈福是重新攒）。
 *
 * 三条设计意图：
 *   - **金币只管象征**：40 块地一轮就几万，它从来不是瓶颈，
 *     所以曲线做陡一点（×3.6 / ×3.6 / ×3.5），让「砸钱速通」不成立；
 *   - **水晶必须去冒险挖**：N 级藏宝图的结算有 50% 概率额外掉一个 N 级水晶，
 *     越高级的图出越高级的水晶 —— 想升级就得去打高级图，而不是刷一级图；
 *   - **祈福是唯一的硬闸门**：全村 33 人（你 + 32 位邻居）每人每天只能祈一次，
 *     花钱买不到。这一项决定了村庄等级不可能一夜满级。
 *
 * 这个模块是纯数据：不读写存档、不碰 DOM。
 */
import { randInt } from '../core/utils.js';

/** 村庄最高等级 */
export const VILLAGE_MAX_LEVEL = 5;

/** 村庄名（跟着游戏名走，不开放编辑） */
export const VILLAGE_NAME = '西米村';

/**
 * 升到下一级的门槛，索引 = 当前等级。
 *
 * crystal 是「要用哪一档的水晶」（4→5 用 4 级，因为 5 级村庄已经满级）；
 * prayers 是**本期**要攒的祈福总次数，不是累计。
 *
 * 祈福总量固定 1,500，但曲线做陡：前两级轻、后两级重，
 * 让「刚开村」有成就感、「最后一级」像个长期目标。
 */
export const VILLAGE_TIERS = [
  null,
  { coins: 20_000, crystal: 1, crystals: 20, prayers: 120 },
  { coins: 72_000, crystal: 2, crystals: 48, prayers: 400 },
  { coins: 260_000, crystal: 3, crystals: 88, prayers: 940 },
  { coins: 920_000, crystal: 4, crystals: 144, prayers: 1540 },
];

/**
 * 当前等级升下一级的要求；满级返回 null。
 * @param {number} level
 * @returns {?{coins: number, crystal: number, crystals: number, prayers: number}}
 */
export const villageTier = (level) => VILLAGE_TIERS[level] || null;

/* ---------- 等级回报 ---------- */

/**
 * 全村产量加成：**每级 +4%**。
 *
 * 玩家自己与 32 位邻居的收获都吃这一档（`store/farm.js` 的 rollYield 与
 * `npc-sim.js` 的 actHarvest 各乘一次）—— 村庄是大家的，好处也该是大家的。
 * 1 级就有 4%，5 级 20%：升级的正反馈立刻能在收成上看见。
 */
export const VILLAGE_YIELD_PER_LEVEL = 0.04;

/**
 * 产量倍率。
 * @param {number} level
 * @returns {number} 1.02 ~ 1.10
 */
export const villageYieldMul = (level) => 1 + VILLAGE_YIELD_PER_LEVEL * Math.max(1, Math.min(VILLAGE_MAX_LEVEL, level));

/* ---------- 祈福 ---------- */

/**
 * 每次祈福中奖的概率。
 *
 * 5% 看着低，但全村每天 33 次 × 5% ≈ 1.65 次/天 —— 差不多每天都有一次
 * 「谁祈福抽到了什么」可以看，又不至于把藏宝图奖励变成签到白送。
 */
export const PRAY_CHANCE = 0.05;

/* ---------- 升级水晶 ---------- */

/**
 * 水晶只有 1~4 级：1→2 用 1 级、4→5 用 4 级。
 * 5 级村庄已满级，所以不需要 5 级水晶。
 */
export const CRYSTAL_TIERS = [1, 2, 3, 4];

/** 水晶在图示与文案里的长相 */
export const CRYSTAL_META = {
  1: { emoji: '🔹', name: '1 级升级水晶' },
  2: { emoji: '🔷', name: '2 级升级水晶' },
  3: { emoji: '💠', name: '3 级升级水晶' },
  4: { emoji: '💎', name: '4 级升级水晶' },
};

/** 一档水晶的中文名 */
export const crystalName = (tier) => CRYSTAL_META[tier]?.name || `${tier} 级升级水晶`;

/** 一档水晶的图标 */
export const crystalEmoji = (tier) => CRYSTAL_META[tier]?.emoji || '🔹';

/** 冒险结算时额外掉水晶的概率（玩家与 NPC 同一档规则） */
export const CRYSTAL_DROP_CHANCE = 0.5;

/**
 * 一张 N 级藏宝图走完之后掉什么水晶。
 * @returns {?number} 水晶档位，没掉就是 null
 */
export const rollCrystalDrop = (mapTier) => (Math.random() < CRYSTAL_DROP_CHANCE
  ? Math.min(4, Math.max(1, mapTier))
  : null);

/* ---------- 建设日志 ---------- */

/** 建设日志保留天数（与农场日志、时报同一口径） */
export const VILLAGE_LOG_DAYS = 7;

/** 条数上限：祈福一天 33 条，7 天理论上有 230 条，压到 160 条够看 */
export const VILLAGE_LOG_CAP = 160;

/**
 * 祈福奖励里给 NPC 的那份怎么兑现。
 *
 * NPC 没有种子背包以外的收纳（`bag` 只收产出），把种子/道具塞进去会污染
 * 订单链路，所以直接折成金币 —— 他拿这笔钱去买种子、喂狗、寻宝，
 * 折算的正是奖励池里那份东西的标价，不多不少。
 * @param {object} reward buildRewardPool 的一份奖励
 * @returns {number}
 */
export const npcPrayValue = (reward) => Math.max(1, Math.round(reward?.value || 0));

/**
 * 掷一次祈福奖励：从对应等级藏宝图的奖励池里抽一份。
 *
 * 只抽 `rewards`（池子里真能挖到的东西），不碰「必有 3 种限定种子」那一组 ——
 * 祈福是点缀，不该比一趟冒险还肥。
 *
 * @param {number} level 村庄等级
 * @param {(tier: number) => {rewards: object[]}} buildPool
 * @returns {?object} 奖励对象；池子空了返回 null
 */
export function rollPrayReward(level, buildPool) {
  const pool = buildPool(Math.max(1, Math.min(5, level)));
  const rewards = pool?.rewards || [];
  if (!rewards.length) return null;
  return rewards[randInt(0, rewards.length - 1)];
}
