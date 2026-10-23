/**
 * 背包物品 key 命名规则。
 * 所有进入背包的东西（种子、农产品、道具）都共用一张 inventory 表，
 * 用前缀区分类型，避免 id 冲突。
 */
import { CROPS } from './crops.js';
import { ITEMS } from './items.js';
import { MAP_TIERS } from './adventure.js';

export const SEED_PREFIX = 'seed_';
export const PRODUCE_PREFIX = 'crop_';
export const MAP_PREFIX = 'map_';

/** 种子在背包中的 key，如 seed_wheat */
export const seedId = (cropId) => `${SEED_PREFIX}${cropId}`;

/** 农产品在背包中的 key，如 crop_wheat */
export const produceId = (cropId) => `${PRODUCE_PREFIX}${cropId}`;

/** 藏宝图在背包中的 key，如 map_3 */
export const mapId = (tier) => `${MAP_PREFIX}${tier}`;

/**
 * 把任意背包 key 翻译成人话，用于奖励提示、称号奖励文案等。
 * 认不出来时原样返回 key，不抛错。
 * @param {string} id
 * @returns {string} 形如「🌾小麦种子」
 */
export function itemLabel(id) {
  if (id.startsWith(SEED_PREFIX)) {
    const crop = CROPS[id.slice(SEED_PREFIX.length)];
    if (crop) return `${crop.emoji}${crop.name}种子`;
  } else if (id.startsWith(PRODUCE_PREFIX)) {
    const crop = CROPS[id.slice(PRODUCE_PREFIX.length)];
    if (crop) return `${crop.emoji}${crop.name}`;
  } else if (id.startsWith(MAP_PREFIX)) {
    const tier = Number(id.slice(MAP_PREFIX.length));
    const map = MAP_TIERS.find((m) => m.tier === tier);
    if (map) return `${map.emoji}${map.name}`;
  }
  const item = ITEMS[id];
  return item ? `${item.emoji}${item.name}` : id;
}
/**
 * 一个背包 key 的「价值」—— 送礼达人榜按它计分。
 *
 * 产出按农产品售价、种子 / 道具按商店价、藏宝图按图价；
 * 认不出来的 key 返回 0（联机收礼时对方可能发任意字符串过来）。
 * @param {string} id
 * @returns {number}
 */
export function itemValue(id) {
  if (typeof id !== 'string' || !id) return 0;
  if (id.startsWith(PRODUCE_PREFIX)) return CROPS[id.slice(PRODUCE_PREFIX.length)]?.sell || 0;
  if (id.startsWith(SEED_PREFIX)) return CROPS[id.slice(SEED_PREFIX.length)]?.seed || 0;
  if (id.startsWith(MAP_PREFIX)) {
    const tier = Number(id.slice(MAP_PREFIX.length));
    return MAP_TIERS.find((m) => m.tier === tier)?.price || 0;
  }
  return ITEMS[id]?.price || 0;
}

/**
 * 这个背包 key 是不是游戏里真实存在的东西。
 *
 * 联机收礼要用：对方可以随便发字符串过来，认不出来的 key 直接丢掉，
 * 不能让「crop_不存在」这种脏数据进背包。
 * @param {string} id
 * @returns {boolean}
 */
export function isItemKey(id) {
  if (typeof id !== 'string' || !id) return false;
  // 用 hasOwn 而不是直接下标：`ITEMS['__proto__']` 会拿到原型对象，是个真值
  const own = (table, key) => Object.prototype.hasOwnProperty.call(table, key);
  if (id.startsWith(SEED_PREFIX)) return own(CROPS, id.slice(SEED_PREFIX.length));
  if (id.startsWith(PRODUCE_PREFIX)) return own(CROPS, id.slice(PRODUCE_PREFIX.length));
  if (id.startsWith(MAP_PREFIX)) {
    const tier = Number(id.slice(MAP_PREFIX.length));
    return MAP_TIERS.some((m) => m.tier === tier);
  }
  return own(ITEMS, id);
}
