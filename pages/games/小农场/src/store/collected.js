/**
 * 图鉴「收集」记录：某种作物的产出只要进过一次仓库，就算收集到了。
 *
 * 收集与「点亮」是两件事：
 *   - **收集**：见过 / 拿到过 —— 自己收的、偷来的、邻居送的、签到送的都算；
 *   - **点亮**：做过一份标本（花掉 50 个同样的产出）。
 *
 * 记录挂在 `player.progress.collected` 上，结构 `{ 作物id: true }`，**只增不减**：
 * 卖掉、送人、做成标本之后依然算收集过，图鉴墙不会因为清仓又变回剪影。
 *
 * 唯一的写入点是 `inventory.add()` —— 所有产出入包都走那里（收获 / 偷菜 /
 * 收礼 / 签到 / 冒险），不用在每个业务里重复埋点，也不会漏。
 */
import { state } from './state.js';
import { PRODUCE_PREFIX } from '../data/keys.js';
import { CROPS } from '../data/crops.js';

/** 某种作物是否收集过 */
export function isCollected(cropId) {
  return Boolean(state.farm?.progress?.collected?.[cropId]);
}

/**
 * 记账：入包的物品如果是农产品，把对应作物标成已收集。
 *
 * 不是农产品、作物 id 认不出来、存档还没就绪时静默跳过 —— 这里只是记账，
 * 不该因为一个陌生 key 把收货流程打断。
 *
 * @param {string} itemId 背包 key
 */
export function noteProduce(itemId) {
  if (!itemId.startsWith(PRODUCE_PREFIX)) return;
  const cropId = itemId.slice(PRODUCE_PREFIX.length);
  if (!CROPS[cropId]) return;

  const progress = state.farm?.progress;
  if (!progress) return;
  if (!progress.collected) progress.collected = {};
  progress.collected[cropId] = true;
}
