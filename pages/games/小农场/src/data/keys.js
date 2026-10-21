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