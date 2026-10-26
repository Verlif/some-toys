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
 * **部分或全部**：精打细算与爱占便宜的**一件都不卖**，全留着等订单上门；
 * 生意人和场面人基本全卖（他们要的是周转的现钱）。
 *
 * 会不会把仓库塞爆：`NPC_BAG_CAP` 是一道硬闸 —— 放不下的部分照样卖成金币，
 * 所以「全留」的邻居到 60 件之后自动回到「收多少卖多少」，
 * 既不会一贫如洗，也不会让存档无限膨胀。
 */
export const KEEP_RATIO = {
  merchant: 0.15,
  boss: 0.30,
  diligent: 0.40,
  friendly: 0.55,
  scholar: 0.65,
  leisurely: 0.85,
  thrifty: 1.00,
  greedy: 1.00,
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
