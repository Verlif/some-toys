/**
 * 道具表。
 *
 * fert     是否为肥料类道具（作用于单块地）
 * minutes  普通化肥固定缩短的分钟数（有机化肥不用这个字段）
 * instant  直接成熟（每块地每轮限用 1 次）
 * boost    增产剂：本次收获的产量加成
 * all      'water' / 'pest'：一次作用于整座农场的一次性道具
 *
 * 普通化肥拆成五档：30 分钟 / 1 / 2 / 6 / 18 小时，价格随档位递增。
 * 一小时的档位便宜、随手就能撒，18 小时档贵但能救一株快熟的高价作物。
 * 有机化肥（一键成熟）随之提价 —— 否则它比任何一档都便宜，其余档位就白设计了。
 *
 * 增产剂分三档（+10% / +20% / +30%），只加产量不改时间。
 * **一株作物一轮只能用一次肥** —— 普通化肥、增产剂、有机化肥共用同一个额度，
 * 所以三档增产剂之间也互相排斥。
 *
 * 洒水器 / 杀虫剂是「省手」道具：整座农场一次处理完，只消耗 1 个。
 * 它们不改变单块地的效果，只是把点十几下变成点一下。
 */

/** 一键浇水道具的 id */
export const SPRINKLER_ID = 'sprinkler';

/** 一键杀虫道具的 id */
export const PESTICIDE_ID = 'pesticide';

export const ITEMS = {
  fertilizer: { name: '普通化肥 30分', emoji: '🧪', price: 60,   desc: '成熟时间 −30 分钟', fert: true, minutes: 30 },
  fert1h:     { name: '普通化肥 1时',  emoji: '🧪', price: 110,  desc: '成熟时间 −1 小时',  fert: true, minutes: 60 },
  fert2h:     { name: '普通化肥 2时',  emoji: '🧪', price: 200,  desc: '成熟时间 −2 小时',  fert: true, minutes: 120 },
  fert6h:     { name: '普通化肥 6时',  emoji: '🧪', price: 520,  desc: '成熟时间 −6 小时',  fert: true, minutes: 360 },
  fert18h:    { name: '普通化肥 18时', emoji: '🧪', price: 1300, desc: '成熟时间 −18 小时', fert: true, minutes: 1080 },
  organic:    { name: '有机化肥',      emoji: '⚗️', price: 1800, desc: '直接成熟（每块地限用 1 次）', fert: true, instant: true },
  boost10:    { name: '增产剂 10%',    emoji: '✨', price: 1000, desc: '本轮产量 +10%', fert: true, boost: 0.10 },
  boost20:    { name: '增产剂 20%',    emoji: '🌟', price: 3000, desc: '本轮产量 +20%', fert: true, boost: 0.20 },
  boost30:    { name: '增产剂 30%',    emoji: '💫', price: 8000, desc: '本轮产量 +30%', fert: true, boost: 0.30 },
  dogFood:    { name: '狗粮',          emoji: '🦴', price: 50,   desc: '往共享狗粮槽里添一份，存量 +45%', fert: false },
  [SPRINKLER_ID]: { name: '洒水器', emoji: '🚿', price: 200, desc: '一次性：给整座农场所有缺水的地浇水', fert: false, all: 'water' },
  [PESTICIDE_ID]: { name: '杀虫剂', emoji: '🧴', price: 200, desc: '一次性：给整座农场所有生虫的地捉虫', fert: false, all: 'pest' },
};

/** 商店道具渲染顺序 */
export const ITEM_IDS = Object.keys(ITEMS);

/** 所有肥料类道具（施肥弹窗按此顺序列） */
export const FERTILIZER_IDS = ITEM_IDS.filter((id) => ITEMS[id].fert);
