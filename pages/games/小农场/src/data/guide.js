/**
 * 新手引导：一次性、不重置、做完即领。
 *
 * 取代了原先的「每日任务」——每日重置的任务在 145 种作物、200 级的体量下
 * 变成了一种每日负担，而新人真正需要的是一条「接下来该干什么」的路径。
 *
 * 奖励在达成时自动发放并弹提示，不会因为忘记点而损失。
 */
export const GUIDES = [
  { key: 'plant', name: '第一次播种', emoji: '🌱', desc: '在任意一块地上种下作物', coins: 50, exp: 20 },
  { key: 'water', name: '第一次浇水', emoji: '💧', desc: '给缺水的作物浇一次水', coins: 40, exp: 20 },
  { key: 'harvest', name: '第一次收获', emoji: '🌾', desc: '收获一片成熟的作物', coins: 60, exp: 25 },
  { key: 'sell', name: '第一次交易', emoji: '💰', desc: '把农产品卖到仓库换钱', coins: 50, exp: 20 },
  { key: 'steal', name: '第一次串门', emoji: '🥷', desc: '去邻居家顺走一个成熟的作物', coins: 40, exp: 30 },
  { key: 'care', name: '第一次帮忙', emoji: '🤝', desc: '在邻居的地块上浇水或捉虫', coins: 60, exp: 30 },
  { key: 'upgrade', name: '第一块好地', emoji: '🟫', desc: '把一块地升级成更肥沃的土地', coins: 500, exp: 80 },
  { key: 'feed', name: '第一顿饭', emoji: '🦴', desc: '喂一次守护犬', coins: 30, exp: 20 },
];

/** 图鉴与引导共用的统计维度说明，供文档与 UI 复用 */
export const STAT_FIELDS = [
  { key: 'planted', label: '种植', emoji: '🌱' },
  { key: 'harvested', label: '收获', emoji: '🧺' },
];