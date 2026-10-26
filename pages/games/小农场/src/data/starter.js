/**
 * 新手礼包 —— 第一次进游戏时塞进仓库的那点家当。
 *
 * 为什么要给：
 *   - 开局 300 金币刚好够买几颗种子，但**不知道买什么**才是新人卡住的地方；
 *   - 三件省手道具（洒水器 / 杀虫剂 / 采收机）各 200 金币，新人不会主动买，
 *     而它们恰好是「地多了以后不会烦」的关键，先给他用几次最有效；
 *   - 狗粮同理：第一只守护犬上岗时槽是空的，没有狗粮就永远尝不到「狗拦贼」。
 *
 * 尺度：6 颗种子（够占满开局 6 块地里的 6 块，正好一轮）、
 * 三件道具各 3 个（够他把「一键」点顺手，又不至于以后都不去商店）、
 * 3 袋狗粮（1 袋 = 存量 +45，三袋够喂满一整个槽）。
 *
 * 种子挑「当前等级能种的最快那一种」：开局 6 块地要能在一轮内看见收获，
 * 玩家才留得下来 —— 挑最贵的反而要等一小时。
 */
import { CROPS } from './crops.js';
import { seedId } from './keys.js';
import { HARVESTER_ID, PESTICIDE_ID, SPRINKLER_ID } from './items.js';

/** 开局送几颗种子 */
export const STARTER_SEEDS = 6;

/** 三件省手道具各送几个 */
export const STARTER_TOOL_COUNT = 3;

/** 送几袋狗粮（1 袋 = 狗粮槽 +45，见 data/items.js） */
export const STARTER_DOG_FOOD = 3;

/**
 * 「当前等级的种子」是哪一种。
 *
 * 取**等级不超过玩家等级**里最高的那一档（作物等级是 1、2、3…这样跳着排的，
 * 很多等级没有对应作物），同一档里挑长得最快的，再平手就挑种子便宜的。
 * 这样 1 级玩家拿到的是胡萝卜（30 分钟一熟），而不是同样 1 级的小麦（90 分钟）。
 *
 * @param {number} level 玩家当前等级
 * @returns {?string} 作物 id；认不出来（数据坏了）返回 null
 */
export function starterCropId(level) {
  const usable = Object.entries(CROPS)
    .filter(([, crop]) => !crop.special && crop.lv <= Math.max(1, level));
  if (!usable.length) return null;

  const topLv = usable.reduce((max, [, crop]) => Math.max(max, crop.lv), 1);
  const top = usable.filter(([, crop]) => crop.lv === topLv);
  top.sort((a, b) => (a[1].grow - b[1].grow) || (a[1].seed - b[1].seed));
  return top[0][0];
}

/**
 * 一份新手礼包的内容（背包 key + 数量 + 展示用的图标与名字）。
 *
 * 纯数据、不写存档：调用方拿 `entries` 直接往背包里加，
 * 界面拿同一份画清单 —— 两边不会说不一致的话。
 *
 * @param {number} level 玩家当前等级
 * @returns {{cropId: ?string, entries: {id: string, n: number, emoji: string, name: string}[]}}
 */
export function starterPack(level) {
  const cropId = starterCropId(level);
  const crop = cropId ? CROPS[cropId] : null;

  const entries = [];
  if (crop) {
    entries.push({
      id: seedId(cropId),
      n: STARTER_SEEDS,
      emoji: crop.emoji,
      name: `${crop.name}种子`,
    });
  }
  entries.push(
    { id: SPRINKLER_ID, n: STARTER_TOOL_COUNT, emoji: '🚿', name: '洒水器' },
    { id: PESTICIDE_ID, n: STARTER_TOOL_COUNT, emoji: '🧴', name: '杀虫剂' },
    { id: HARVESTER_ID, n: STARTER_TOOL_COUNT, emoji: '🚜', name: '采收机' },
    { id: 'dogFood', n: STARTER_DOG_FOOD, emoji: '🦴', name: '狗粮' },
  );
  return { cropId, entries };
}
