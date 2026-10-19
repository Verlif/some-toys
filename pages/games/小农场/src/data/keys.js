/**
 * 背包物品 key 命名规则。
 * 所有进入背包的东西（种子、农产品、道具）都共用一张 inventory 表，
 * 用前缀区分类型，避免 id 冲突。
 */

export const SEED_PREFIX = 'seed_';
export const PRODUCE_PREFIX = 'crop_';

/** 种子在背包中的 key，如 seed_wheat */
export const seedId = (cropId) => `${SEED_PREFIX}${cropId}`;

/** 农产品在背包中的 key，如 crop_wheat */
export const produceId = (cropId) => `${PRODUCE_PREFIX}${cropId}`;