/**
 * 道具表。数值 1:1 沿用原版。
 *
 * fert  是否为肥料类道具（作用于地块）
 * acc   作用系数：由 store/farm.js 解释，-1 表示「直接成熟」这类特殊效果
 */
export const ITEMS = {
  fertilizer: { name: '普通化肥', emoji: '🧪', price: 60,  desc: '减少 20% 剩余时间', fert: true,  acc: 0.2 },
  organic:    { name: '有机化肥', emoji: '⚗️', price: 180, desc: '直接成熟（每块地限用1次）', fert: true,  acc: -1 },
  herbicide:  { name: '除草剂',   emoji: '🧴', price: 40,  desc: '清除杂草', fert: false, acc: 0 },
  pesticide:  { name: '杀虫剂',   emoji: '🪲', price: 40,  desc: '清除害虫', fert: false, acc: 0 },
  dogFood:    { name: '狗粮',     emoji: '🦴', price: 50,  desc: '喂养守护犬，恢复守护能力', fert: false, acc: 0 },
};

/** 商店道具渲染顺序 */
export const ITEM_IDS = Object.keys(ITEMS);