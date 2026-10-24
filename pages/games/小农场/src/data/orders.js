/**
 * 订单系统常量与纯函数。
 *
 * 玩法（2026-10-24 用户需求）：
 *   - NPC 上线后张榜收购产出，赏金按 **1.2 倍**结算，当场从 NPC 金币托管；
 *   - 订单时长 1~3 天，每个 NPC 同时最多 1 条；玩家一次最多发布 5 条；
 *   - 需求只认**产出**：NPC 仓库里只存产出（他们不存种子），种子订单没人交得了；
 *   - 玩家发布与 NPC 收购**统一倍率**，不做特殊处理（用户拍板）；
 *   - NPC 上线时会挑接得下的订单交货（包括其他 NPC 的），完成一笔双方好感 +5。
 */

import { CROPS } from './crops.js';

/** 统一倍率：赏金 = 售价 × 1.2 × 数量 */
export const ORDER_MULT = 1.2;

/** NPC 张榜时一次收多少份 */
export const ORDER_QTY_RANGE = [3, 12];

/**
 * 需求池的上浮级数：从 **1 级**到（NPC 自己等级 + 5）之间随机抽。
 * 不看玩家等级 —— 高阶邻居就该开出高阶单，接不了是玩家自己的取舍
 * （2026-10-24 用户明确要求）。
 */
export const ORDER_LEVEL_FLOAT = 5;

/** 订单时长（天） */
export const ORDER_DAYS_RANGE = [1, 3];

/** 每次上线尝试发订单的概率（手里没有进行中订单时才掷） */
export const ORDER_CHANCE = 0.3;

/** 生意人 / 场面人更爱张榜：发订单概率的乘数 */
export const ORDER_CHANCE_BONUS = { merchant: 1.6, boss: 1.4 };

/** 每个 NPC 同时最多几条订单（作为下单方） */
export const NPC_ORDER_LIMIT = 1;

/** 玩家同时最多发布几条 */
export const PLAYER_ORDER_LIMIT = 5;

/** NPC 仓库总件数上限：收获保留时放不下就卖掉，别让存档无限膨胀 */
export const NPC_BAG_CAP = 60;

/**
 * 收获时按性格保留入库的比例。
 *
 * 不是全卖（那样 NPC 没有金币收入，喂狗、寻宝都停摆），
 * 也不是全留（那样接不了别人的订单）—— 各人按性子来。
 */
export const KEEP_RATIO = {
  merchant: 0.10,
  boss: 0.20,
  diligent: 0.30,
  friendly: 0.35,
  scholar: 0.35,
  leisurely: 0.45,
  thrifty: 0.60,
  greedy: 0.70,
};

/** 完成一笔订单（接单方 ↔ 下单方）加的好感 */
export const ORDER_REL_GAIN = 5;

/**
 * 一笔订单的赏金：单价 × 倍率 × 数量（至少 1）。
 * @param {number} sell 产出单价
 * @param {number} qty 数量
 * @returns {number}
 */
export function orderReward(sell, qty) {
  return Math.max(1, Math.round(sell * ORDER_MULT * qty));
}
