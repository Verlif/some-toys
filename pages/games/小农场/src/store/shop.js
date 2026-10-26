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
import { addAuto, autoTimeText } from './automation.js';
import { runAutoNow } from './farm.js';
import { clockText } from '../core/utils.js';

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
  await completeGuide('shop');
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
  // 永久版买断一次就够了 —— 不拦的话玩家可能一激动点两下，
  // 多花一份钱却只多出个永远用不到的计数
  if (item.permanent && inventory.has(itemId)) {
    notify(`已经有一台${item.name}了`);
    return false;
  }
  if (!player.spendCoins(item.price)) {
    notify('金币不足 😥');
    return false;
  }

  // 自动机器（第 51 轮）：不进背包，往对应类别上叠一天。
  // 已经开着就在原到期时刻往后加，不会把剩下的时间清零重算
  if (item.auto) {
    const { until } = addAuto(item.auto, Date.now());
    player.addLog(
      '🛒',
      `买入 ${item.name}，有效期延长到 ${clockText(until)}，-${item.price} 💰`,
    );
    await persist();
    // 「买完当即生效」：不等下一次心跳，立刻把手上这一批活干一遍。
    // 顺手让玩家看到机器真的动了，而不是买完什么都没发生
    await runAutoNow();
    await completeGuide('shop');
    notify(`${item.emoji} ${item.name} 已启用：${autoTimeText(until - Date.now())}后到期`, 'gold');
    return true;
  }

  inventory.add(itemId, 1);
  player.addLog('🛒', `买入 ${item.name} ×1，-${item.price} 💰`);
  await persist();
  await completeGuide('shop');
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
  await completeGuide('map');
  notify(`购买 ${map.name} ×1（去「其他 → 冒险」出发）`);
  return true;
}

/**
 * 卖出农产品
 *
 * @param {string} cropId
 * @param {number} [n] 要卖的数量，缺省 = 全部；超出持有量的部分被夹掉
 * @returns {Promise<number>} 实际获得的金币
 */
export async function sellProduce(cropId, n) {
  const crop = CROPS[cropId];
  const id = produceId(cropId);
  const have = inventory.count(id);
  if (!crop || have <= 0) return 0;

  const qty = n === undefined ? have : Math.max(0, Math.min(have, Math.floor(n)));
  if (qty <= 0) return 0;

  const income = qty * crop.sell;
  inventory.take(id, qty);
  player.addCoins(income);
  player.addLog('💰', `卖出 ${crop.emoji}${crop.name} ×${qty}，+${income} 💰`);
  await persist();
  await completeGuide('sell');
  notify(`卖出 ${crop.emoji}${crop.name} ×${qty}，+${income} 💰`);
  return income;
}