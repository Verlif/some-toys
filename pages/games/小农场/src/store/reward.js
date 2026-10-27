/**
 * 发奖：金币 / 道具 / 藏宝图，全游戏只有这一个入口。
 *
 * 第 54 轮从 daily.js 搬出来 —— 排行榜的奖励不再当场入账，而是先进「农场通知」
 * 等玩家手动领取；送礼也走同一条路。两边都要发同一份东西，
 * 各写一份迟早会不一样（漏了自动机器的特判、漏了藏宝图的 key）。
 *
 * 自动机器（洒水器 / 捉虫机 / 采收机）不占背包，直接叠到有效期上，
 * 和商店购买、称号奖励、藏宝图掉落保持同一套口径。
 */
import * as player from './player.js';
import * as inventory from './inventory.js';
import { ITEMS } from '../data/items.js';
import { mapId } from '../data/keys.js';
import { addAuto } from './automation.js';

/**
 * 把一份奖励发到玩家身上。
 *
 * 形状与排行榜的 `board.rewards[i]` 一致：
 * `{ coins?: number, items?: Record<string, number>, maps?: number[] }`。
 * 调用前应先用 data/notice.js 的 `cleanReward` 洗过；这里再兜一次类型，
 * 认不出来的部分直接跳过，不抛错。
 *
 * @param {?object} reward
 * @param {number} [now] 发奖时刻（自动机器的时效从这里起算）
 * @returns {boolean} 有没有真的发出东西
 */
export function grantReward(reward, now = Date.now()) {
  if (!reward || typeof reward !== 'object') return false;
  let given = false;

  const coins = Math.max(0, Math.round(Number(reward.coins) || 0));
  if (coins) {
    player.addCoins(coins);
    given = true;
  }

  for (const [id, n] of Object.entries(reward.items || {})) {
    const count = Math.max(0, Math.floor(Number(n) || 0));
    if (!count) continue;
    const auto = ITEMS[id]?.auto;
    if (auto) addAuto(auto, now, count);
    else inventory.add(id, count);
    given = true;
  }

  for (const tier of reward.maps || []) {
    const n = Math.floor(Number(tier) || 0);
    if (n > 0) {
      inventory.add(mapId(n), 1);
      given = true;
    }
  }
  return given;
}
