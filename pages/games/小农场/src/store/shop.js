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
import { produceId, seedId } from '../data/keys.js';
import { completeGuide } from './codex.js';
import { notify } from './notify.js';

async function persist() {
  await commit({ player: state.player }, { bag: state.bag });
  emit(EVENTS.PLAYER);
  emit(EVENTS.INVENTORY);
}

/** 该作物对当前等级是否已解锁 */
export const isSeedUnlocked = (cropId) => state.player.level >= CROPS[cropId].lv;

/**
 * 购买种子
 * @returns {Promise<boolean>}
 */
export async function buySeed(cropId) {
  const crop = CROPS[cropId];
  if (!crop) return false;
  if (!isSeedUnlocked(cropId)) {
    notify(`需要 Lv.${crop.lv} 才能种植${crop.name}`);
    return false;
  }
  if (!player.spendCoins(crop.seed)) {
    notify('金币不足 😥');
    return false;
  }

  inventory.add(seedId(cropId), 1);
  await persist();
  notify(`购买 ${crop.emoji}${crop.name}种子 ×1`);
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
  await persist();
  notify(`购买 ${item.emoji}${item.name} ×1`);
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
  await persist();
  notify(`全部卖出，+${income} 💰`, 'gold');
  return income;
}