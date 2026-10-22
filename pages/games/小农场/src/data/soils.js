/**
 * 本文件由 tools/gen-data.mjs 生成，请勿手改。
 * 调整数值请改生成器后重新运行：node tools/gen-data.mjs
 */
/**
 * 土地表：8 档，从普通到神话。
 *
 * yieldMul 产量倍率   timeMul 成熟时间倍率   expMul 经验倍率
 * unlock    解锁等级   cost     升级一块地所需金币
 * prev      上一档土地 id：必须一级一级升，普通土地为空串
 */
export const SOILS = {
  normal: { name: '普通土地', tag: '普通', cls: 'soil-normal', emoji: '🟫', yieldMul: 1.00, timeMul: 1.00, expMul: 1.00, unlock: 0, cost: 0, prev: '' },
  red: { name: '红土地', tag: '红土', cls: 'soil-red', emoji: '🟥', yieldMul: 1.10, timeMul: 1.00, expMul: 1.00, unlock: 8, cost: 2000, prev: 'normal' },
  black: { name: '黑土地', tag: '黑土', cls: 'soil-black', emoji: '⬛', yieldMul: 1.20, timeMul: 0.80, expMul: 1.00, unlock: 15, cost: 8000, prev: 'red' },
  silver: { name: '白银土地', tag: '银土', cls: 'soil-silver', emoji: '⬜', yieldMul: 1.35, timeMul: 0.75, expMul: 1.10, unlock: 28, cost: 30000, prev: 'black' },
  gold: { name: '黄金土地', tag: '金土', cls: 'soil-gold', emoji: '🟨', yieldMul: 1.50, timeMul: 0.70, expMul: 1.25, unlock: 45, cost: 120000, prev: 'silver' },
  crystal: { name: '水晶土地', tag: '晶土', cls: 'soil-crystal', emoji: '💎', yieldMul: 1.70, timeMul: 0.62, expMul: 1.40, unlock: 70, cost: 500000, prev: 'gold' },
  rainbow: { name: '彩虹土地', tag: '彩土', cls: 'soil-rainbow', emoji: '🌈', yieldMul: 2.00, timeMul: 0.55, expMul: 1.60, unlock: 110, cost: 2000000, prev: 'crystal' },
  myth: { name: '神话土地', tag: '神土', cls: 'soil-myth', emoji: '⭐', yieldMul: 2.40, timeMul: 0.45, expMul: 1.90, unlock: 160, cost: 8000000, prev: 'rainbow' },
};

/** 默认土地，新增地块时使用 */
export const DEFAULT_SOIL = 'normal';

/** 完整档位顺序（含普通土地）：SOIL_ORDER[i + 1] 就是第 i 档的下一档 */
export const SOIL_ORDER = Object.keys(SOILS);

/** 某档土地的下一档（顶档之后没有，返回空串） */
export const nextSoilId = (soilId) => SOIL_ORDER[SOIL_ORDER.indexOf(soilId) + 1] || '';

/** 可购买的土地（不含普通土地），按升级顺序 */
export const UPGRADEABLE_SOIL_IDS = SOIL_ORDER.filter((id) => id !== DEFAULT_SOIL);
