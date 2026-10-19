/**
 * 道具表。
 *
 * fert     是否为肥料类道具（作用于地块）
 * minutes  普通化肥固定缩短的分钟数（有机化肥不用这个字段）
 * instant  直接成熟（每块地每轮限用 1 次）
 *
 * 普通化肥拆成五档：30 分钟 / 1 / 2 / 6 / 18 小时，价格随档位递增。
 * 一小时的档位便宜、随手就能撒，18 小时档贵但能救一株快熟的高价作物。
 * 有机化肥（一键成熟）随之提价 —— 否则它比任何一档都便宜，其余档位就白设计了。
 */
export const ITEMS = {
  fertilizer: { name: '普通化肥 30分', emoji: '🧪', price: 60,   desc: '成熟时间 −30 分钟', fert: true, minutes: 30 },
  fert1h:     { name: '普通化肥 1时',  emoji: '🧪', price: 110,  desc: '成熟时间 −1 小时',  fert: true, minutes: 60 },
  fert2h:     { name: '普通化肥 2时',  emoji: '🧪', price: 200,  desc: '成熟时间 −2 小时',  fert: true, minutes: 120 },
  fert6h:     { name: '普通化肥 6时',  emoji: '🧪', price: 520,  desc: '成熟时间 −6 小时',  fert: true, minutes: 360 },
  fert18h:    { name: '普通化肥 18时', emoji: '🧪', price: 1300, desc: '成熟时间 −18 小时', fert: true, minutes: 1080 },
  organic:    { name: '有机化肥',      emoji: '⚗️', price: 1800, desc: '直接成熟（每块地限用 1 次）', fert: true, instant: true },
  dogFood:    { name: '狗粮',          emoji: '🦴', price: 50,   desc: '喂养守护犬，饱腹度 +45%', fert: false },
};

/** 商店道具渲染顺序 */
export const ITEM_IDS = Object.keys(ITEMS);

/** 所有肥料类道具（施肥弹窗按此顺序列） */
export const FERTILIZER_IDS = ITEM_IDS.filter((id) => ITEMS[id].fert);
