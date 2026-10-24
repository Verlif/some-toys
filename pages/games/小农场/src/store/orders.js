/**
 * 订单：NPC 张榜收购产出（1.2 倍，赏金当场托管），玩家发布需求，
 * NPC 上线时按自家仓库存货接单 —— NPC 之间也互通有无。
 *
 * 数据落在现有农场行上（NPC 的订单在 `npc.order`，玩家的在 `farm.orders`），
 * 不新增表；看板是两者的合集。生命周期：
 *   创建（赏金从下单方托管）→ 完成（交货 + 赏金 + 摘单）→ 过期（摘单 + 退还）。
 *
 * NPC 侧的「发订单 / 接订单」在 npc-sim（纯计算，通过 simCtx 注入的
 * orders / removeOrder 回调碰这里的看板）；玩家侧的操作都在本文件。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { PLAYER_ID, state } from './state.js';
import * as player from './player.js';
import * as inventory from './inventory.js';
import { notify } from './notify.js';
import { CROPS } from '../data/crops.js';
import { produceId } from '../data/keys.js';
import { ORDER_DAYS_RANGE, PLAYER_ORDER_LIMIT, orderReward } from '../data/orders.js';
import { randInt } from '../core/utils.js';

/** 发布序号：订单 id 要唯一，同一毫秒内可能连发多条 */
let seq = 0;

/** 赏金 = 售价 ×1.2× 数量（与 NPC 收购统一倍率，用户拍板不做特殊处理） */
const rewardOf = (cropId, qty) => orderReward(CROPS[cropId].sell, qty);

/** 看板：全部订单（含刚过期的 —— 过期清扫要靠它把过期行找出来） */
export function allOrders() {
  const list = [...(state.farm?.orders || [])];
  for (const npc of state.friends) if (npc.order) list.push(npc.order);
  return list;
}

/** 进行中的订单（未过期），按截止时间从近到远 */
export function orderBoard(now = Date.now()) {
  return allOrders().filter((o) => o.deadline > now).sort((a, b) => a.deadline - b.deadline);
}

/** NPC 发来的收购订单（按邻居名单顺序，稳定不跳） */
export function npcOrders(now = Date.now()) {
  return state.friends
    .filter((n) => n.order && n.order.deadline > now)
    .map((n) => n.order);
}

/** 我发布的订单 */
export function myOrders(now = Date.now()) {
  return (state.farm?.orders || []).filter((o) => o.deadline > now);
}

/** 从看板上摘掉一条：玩家数组 / NPC 字段，各自归位 */
export function removeOrder(order) {
  if (!order) return;
  if (order.ownerId === PLAYER_ID) {
    state.farm.orders = (state.farm?.orders || []).filter((o) => o.id !== order.id);
    return;
  }
  const npc = state.friends.find((f) => f.id === order.ownerId);
  if (npc && npc.order?.id === order.id) npc.order = null;
}

/**
 * 玩家提交 NPC 的收购订单：扣产出、领赏金、订单从列表去除。
 * @param {string} orderId
 * @returns {Promise<boolean>}
 */
export async function submitOrder(orderId) {
  const order = orderBoard().find((o) => o.id === orderId);
  if (!order || order.ownerId === PLAYER_ID) return false;
  if (!inventory.take(order.itemId, order.qty)) {
    notify('东西不够，交不了这一单');
    return false;
  }
  player.addCoins(order.reward);
  removeOrder(order);
  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.INVENTORY);
  emit(EVENTS.PLAYER);
  emit(EVENTS.FRIENDS);
  notify(`📦 交单成功，+${order.reward} 💰`, 'gold');
  return true;
}

/**
 * 玩家发布订单：赏金按 1.2 倍**当场托管**（扣钱），
 * NPC 上线时按自家仓库存货接单；过期 / 撤销全额退还。
 * @param {string} cropId 作物 id（需求是它的产出）
 * @param {number} qty
 * @returns {Promise<boolean>}
 */
export async function publishOrder(cropId, qty) {
  const crop = CROPS[cropId];
  if (!crop || crop.special || qty < 1) return false;
  const mine = state.farm?.orders || [];
  if (mine.length >= PLAYER_ORDER_LIMIT) {
    notify(`同时最多发布 ${PLAYER_ORDER_LIMIT} 条订单`);
    return false;
  }
  const reward = rewardOf(cropId, qty);
  if (!player.spendCoins(reward)) {
    notify('金币不足 😥');
    return false;
  }
  seq += 1;
  const now = Date.now();
  state.farm.orders = [...mine, {
    id: `p${now}-${seq}`,
    ownerId: PLAYER_ID,
    itemId: produceId(cropId),
    qty,
    reward,
    createdAt: now,
    deadline: now + randInt(ORDER_DAYS_RANGE[0], ORDER_DAYS_RANGE[1]) * 86_400_000,
  }];
  await commit({ farms: [state.farm] });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.PLAYER);
  notify(`📮 订单已发布：${crop.emoji}${crop.name} ×${qty}，赏金 ${reward} 💰`, 'gold');
  return true;
}

/** 玩家撤销自己发布的订单：赏金全额退还 */
export async function cancelOrder(orderId) {
  const order = (state.farm?.orders || []).find((o) => o.id === orderId);
  if (!order) return false;
  player.addCoins(order.reward);
  removeOrder(order);
  await commit({ farms: [state.farm] });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.PLAYER);
  notify('订单已撤销，赏金已退还');
  return true;
}

/**
 * 过期清扫：移除过期订单，托管赏金退还给下单方。
 * 挂在 settleWorld 上（进邻居页 / 每分钟轮询都会跑一次）。
 * @param {number} [now]
 * @returns {Promise<number>} 清了几条
 */
export async function expireOrders(now = Date.now()) {
  const expired = allOrders().filter((o) => o.deadline <= now);
  if (!expired.length) return 0;
  for (const order of expired) {
    if (order.ownerId === PLAYER_ID) {
      player.addCoins(order.reward);
    } else {
      const npc = state.friends.find((f) => f.id === order.ownerId);
      if (npc) npc.coins += order.reward;
    }
    removeOrder(order);
  }
  await commit({ farms: [state.farm, ...state.friends] });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.PLAYER);
  return expired.length;
}
