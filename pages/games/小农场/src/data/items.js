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
 * 洒水器 / 杀虫剂 / 采收机是「省手」道具：整座农场一次处理完，只消耗 1 个。
 * 它们不改变单块地的效果，只是把点十几下变成点一下。
 *
 * 三件工具都有**永久版**：价格高得多，但买断之后永远不消耗
 * （`permanent: true`）。判定统一走 store/tools.js —— 手上有永久版时
 * 消耗版一个都不扣，否则玩家背包里的东西会莫名其妙变少。
 *
 * `auto` 是**自动机器**（第 51 轮）：不进背包，买一个往对应类别上叠一天，
 * 时间记在 `farm.progress.auto`，由世界时钟自动执行。
 */

/** 一键浇水道具的 id */
export const SPRINKLER_ID = 'sprinkler';

/** 一键杀虫道具的 id */
export const PESTICIDE_ID = 'pesticide';

/** 一键收获道具的 id */
export const HARVESTER_ID = 'harvester';

/** 三件工具的永久版：买断一次，之后永不吃道具 */
export const SPRINKLER_PRO_ID = 'sprinklerPro';
export const PESTICIDE_PRO_ID = 'pesticidePro';
export const HARVESTER_PRO_ID = 'harvesterPro';

/**
 * 自动机器（第 51 轮）。
 *
 * 与上面那批「点一下」的道具不同，自动机器**不进背包**：
 * 拿到一个就往对应类别上叠 24 小时，时间记在
 * `farm.progress.auto[kind]`（见 store/automation.js）。
 * 有效期内，世界时钟推进到「该浇水 / 该捉虫 / 该收了」的那一刻会自动做掉。
 */
export const AUTO_SPRINKLER_ID = 'autoSprinkler';
export const AUTO_PEST_ID = 'autoPest';
export const AUTO_HARVEST_ID = 'autoHarvest';

/** 自动类别 → 道具 id（`items.js` 与 automation 共用这张表） */
export const AUTO_KINDS = {
  water: AUTO_SPRINKLER_ID,
  pest: AUTO_PEST_ID,
  harvest: AUTO_HARVEST_ID,
};

/** 一个自动机器叠加的有效时长 */
export const AUTO_DAY_MS = 24 * 3600_000;

/**
 * 动作种类 → 消耗版 / 永久版。
 *
 * 自家农场与邻居农场共用这套映射（见 store/tools.js），
 * 所以「买过永久洒水器，帮邻居一键浇水也不扣道具」是自动成立的。
 */
export const TOOL_KINDS = {
  water: { consumable: SPRINKLER_ID, permanent: SPRINKLER_PRO_ID },
  pest: { consumable: PESTICIDE_ID, permanent: PESTICIDE_PRO_ID },
  harvest: { consumable: HARVESTER_ID, permanent: HARVESTER_PRO_ID },
};

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
  dogFood:    { name: '狗粮',          emoji: '🦴', price: 50,   desc: '往共享狗粮槽里添一份，存量 +45', food: 45, fert: false },
  dogFoodPro: { name: '精品狗粮',      emoji: '🍖', price: 100,  desc: '往共享狗粮槽里添一份，存量 +100', food: 100, fert: false },
  [SPRINKLER_ID]: { name: '洒水器', emoji: '🚿', price: 200, desc: '一次性：给整座农场所有缺水的地浇水', fert: false, all: 'water' },
  [PESTICIDE_ID]: { name: '杀虫剂', emoji: '🧴', price: 200, desc: '一次性：给整座农场所有生虫的地捉虫', fert: false, all: 'pest' },
  [HARVESTER_ID]: { name: '采收机', emoji: '🚜', price: 200, desc: '一次性：把整座农场成熟的地一次收完', fert: false, all: 'harvest' },
  // 自动机器：买一个叠一天，不占背包（见 store/automation.js）。
  // 价格刻意定得比消耗版高一个量级 —— 它省的不是一次点击，是「一整天不用惦记」
  [AUTO_SPRINKLER_ID]: {
    name: '自动洒水器', emoji: '🚰', price: 2000, auto: 'water',
    desc: '有效期 +1 天：期间缺水的地自动浇水（不给经验，照记日志）',
  },
  [AUTO_PEST_ID]: {
    name: '自动捉虫机', emoji: '🪤', price: 2000, auto: 'pest',
    desc: '有效期 +1 天：期间生虫的地自动捉虫（不给经验，照记日志）',
  },
  [AUTO_HARVEST_ID]: {
    name: '自动收获机', emoji: '🛻', price: 1000, auto: 'harvest',
    desc: '有效期 +1 天：期间成熟的地自动收掉（不给经验，照记日志）',
  },
  // 永久版排在最后：前三个是「随手买一个应个急」，后面是「终于不用再买了」
  [SPRINKLER_PRO_ID]: {
    name: '洒水器 · 永久', emoji: '🚿', price: 50_000, permanent: true, all: 'water',
    desc: '买断：一键浇水不再消耗道具（自家 / 邻居家通用）',
  },
  [PESTICIDE_PRO_ID]: {
    name: '杀虫剂 · 永久', emoji: '🧴', price: 50_000, permanent: true, all: 'pest',
    desc: '买断：一键杀虫不再消耗道具（自家 / 邻居家通用）',
  },
  [HARVESTER_PRO_ID]: {
    name: '采收机 · 永久', emoji: '🚜', price: 20_000, permanent: true, all: 'harvest',
    desc: '买断：一键收获不再消耗道具',
  },
};

/** 商店道具渲染顺序 */
export const ITEM_IDS = Object.keys(ITEMS);

/** 所有肥料类道具（施肥弹窗按此顺序列） */
export const FERTILIZER_IDS = ITEM_IDS.filter((id) => ITEMS[id].fert);
