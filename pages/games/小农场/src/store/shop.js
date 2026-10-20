/**
 * 商店与交易：买种子 / 买道具 / 卖农产品。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';
import * as player from './player.js';
import * as inventory from './inventory.js';
import { CROPS } from '../data/crops.js';
import { ITEMS } from '../data/items.js';
import { mapTier } from '../data/adventure.js';
import { mapId, produceId, seedId } from '../data/keys.js';
import { completeGuide } from './codex.js';
import { notify } from './notify.js';

async function persist() {
  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.PLAYER);
  emit(EVENTS.INVENTORY);
}

/** 该作物对当前等级是否已解锁 */
export const isSeedUnlocked = (cropId) => state.farm.level >= CROPS[cropId].lv;

/**
 * 购买种子
 * @param {string} cropId
 * @param {number} [n] 数量，默认 1
 * @returns {Promise<boolean>}
 */
export async function buySeed(cropId, n = 1) {
  const crop = CROPS[cropId];
  const qty = Math.max(1, Math.floor(n));
  if (!crop) return false;
  // 限定作物只能从藏宝图挖到，这里兜一道，避免被别的入口绕过去
  if (crop.special) {
    notify('限定种子商店不卖，去藏宝图里碰碰运气吧');
    return false;
  }
  if (!isSeedUnlocked(cropId)) {
    notify(`需要 Lv.${crop.lv} 才能种植${crop.name}`);
    return false;
  }
  if (!player.spendCoins(crop.seed * qty)) {
    notify('金币不足 😥');
    return false;
  }

  inventory.add(seedId(cropId), qty);
  player.addLog('🛒', `买入 ${crop.name}种子 ×${qty}，-${crop.seed * qty} 💰`);
  await persist();
  notify(`购买 ${crop.emoji}${crop.name}种子 ×${qty}`);
  return true;
}

/**
 * 购买道具
 * @returns {Promise<boolean>}
 */
export async function buyItem(itemId) {
  const item = ITEMS[itemId];
  if (!item) return false;
  if (!player.spendCoins(item.price)) {
    notify('金币不足 😥');
    return false;
  }

  inventory.add(itemId, 1);
  player.addLog('🛒', `买入 ${item.name} ×1，-${item.price} 💰`);
  await persist();
  notify(`购买 ${item.emoji}${item.name} ×1`);
  return true;
}

/**
 * 购买藏宝图
 *
 * 档位越高越贵，但要求「10 倍的农场等级」—— 1 级图要 Lv10、5 级图要 Lv50。
 * 买到的是背包里的 map_1 ~ map_5，去「其他 → 冒险」里用掉。
 * @param {number} tier
 * @returns {Promise<boolean>}
 */
export async function buyMap(tier) {
  const map = mapTier(tier);
  if (!map) return false;
  if (state.farm.level < map.unlock) {
    notify(`需要 Lv.${map.unlock} 才能购买 ${map.name}`);
    return false;
  }
  if (!player.spendCoins(map.price)) {
    notify('金币不足 😥');
    return false;
  }

  inventory.add(mapId(map.tier), 1);
  player.addLog('🗺️', `买入 ${map.name}，-${map.price} 💰`);
  await persist();
  notify(`购买 ${map.name} ×1（去「其他 → 冒险」出发）`);
  return true;
}

/**
 * 卖掉全部某一种农产品
 * @returns {Promise<number>} 实际获得的金币
 */
export async function sellProduce(cropId) {
  const crop = CROPS[cropId];
  const id = produceId(cropId);
  const n = inventory.count(id);
  if (!crop || n <= 0) return 0;

  const income = n * crop.sell;
  inventory.take(id, n);
  player.addCoins(income);
  player.addLog('💰', `卖出 ${crop.emoji}${crop.name} ×${n}，+${income} 💰`);
  await persist();
  await completeGuide('sell');
  notify(`卖出 ${crop.emoji}${crop.name} ×${n}，+${income} 💰`);
  return income;
}

/**
 * 一键卖掉背包里所有农产品
 * @returns {Promise<number>} 实际获得的金币
 */
export async function sellAllProduce() {
  let income = 0;
  for (const cropId of Object.keys(CROPS)) {
    const n = inventory.count(produceId(cropId));
    if (n > 0) {
      inventory.take(produceId(cropId), n);
      income += n * CROPS[cropId].sell;
    }
  }
  if (income <= 0) return 0;

  player.addCoins(income);
  player.addLog('💰', `卖出全部农产品，+${income} 💰`);
  await persist();
  notify(`全部卖出，+${income} 💰`, 'gold');
  return income;
}