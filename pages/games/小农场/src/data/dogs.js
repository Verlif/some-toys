/**
 * 守护犬：品种表、狗粮槽（饱腹度）、拦截概率、狗窝升级与每日挖宝。
 *
 * 早期只有一条狗，拦截概率全由饱腹度决定。现在拆成三层：
 *   - **品种**决定「这只狗能有多灵」：比熊 20% … 龙犬 80%；
 *   - **狗粮槽**决定「它现在有没有力气」：满槽时按品种的基础率生效，
 *     饿了按比例打折，空槽则完全不设防。槽的容量随**狗窝等级**长（100+30×级）；
 *   - **每日挖宝**：有狗上岗且槽里有粮时，每天有机会按品种品阶对应的
 *     藏宝图档位挖一份奖励（见 rollDogDigReward，data/adventure.js）。
 *
 * 狗粮槽是**整个狗窝共用**的一份存货：喂一次所有狗都受益，
 * 但同一时刻只有一只狗「上岗」（active）。没有狗上岗时槽不会消耗 ——
 * 狗在窝里睡觉，不掉饥饿。
 *
 * 品种来源：
 *   - 初始赠送最低品种（比熊）；
 *   - 冒险的低概率奖励：按藏宝图档位决定品阶上限，且不会重复获得。
 */
import { ITEMS } from './items.js';

/* ---------- 狗粮槽 ---------- */

/** 槽的基础上限（狗窝 0 级） */
export const DOG_SATIETY_MAX = 100;

/** 每份普通狗粮恢复的饱腹度 */
export const DOG_FOOD_SATIETY = ITEMS.dogFood.food;

/** 每份精品狗粮恢复的饱腹度（双倍价，商店有售） */
export const DOG_FOOD_PRO_SATIETY = ITEMS.dogFoodPro.food;

/** 每小时掉多少饱腹度：喂满一次大约守护 16 小时 */
export const DOG_SATIETY_DECAY = 6.25;

/** 邻居给狗添一次食要花的钱：和玩家买一份狗粮同价 */
export const DOG_FOOD_PRICE = ITEMS.dogFood.price;

/* ---------- 狗窝升级 ---------- */

/** 狗窝最高等级 */
export const KENNEL_MAX_LEVEL = 5;

/** 每升一级，狗粮槽容量 +30 */
export const KENNEL_CAPACITY_STEP = 30;

/**
 * 升到下一级要付的金币，下标 0 = 0 级升 1 级。
 * 五档价格对应五级（0 → 5），容量从 100 一路加到 250。
 */
export const KENNEL_UPGRADE_COSTS = [2_000, 5_000, 10_000, 15_000, 25_000];

/**
 * 狗窝容量 = 基础 100 + 30 × 等级。
 * 邻居的狗不升级（没有狗窝这个概念），恒为 100。
 * @param {number} [level]
 * @returns {number}
 */
export function dogHouseCapacity(level = 0) {
  const lv = Math.min(KENNEL_MAX_LEVEL, Math.max(0, Math.round(Number(level) || 0)));
  return DOG_SATIETY_MAX + KENNEL_CAPACITY_STEP * lv;
}

/* ---------- 守护犬每日挖宝 ---------- */

/** 每天挖到一份奖励的概率（有狗上岗且槽里有粮才掷） */
export const DOG_DIG_CHANCE = 0.30;

/** 「不饿」的阈值：槽里有粮就算（> 0） */
export const DOG_DIG_MIN_SATIETY = 1;

/** 离线期间最多补掷几天（与游戏其他离线窗口一致，防止一次补发几十份） */
export const DOG_DIG_MAX_CATCHUP = 7;

/**
 * 被守护犬抓住的罚款倍数。
 *
 * 偷菜被狗拦截时，除了这一趟白跑，还要按**想偷的那个果实售价 × 这个倍数**
 * 缴纳罚款，罚金归被偷的农场主（玩家或邻居都算）。
 * 小偷钱不够就倾家荡产 —— 有多少罚多少，不记负债。
 */
export const DOG_FINE_MULTIPLE = 5;

/* ---------- 品种表 ---------- */

/**
 * 十个品种，按品阶（tier）从低到高排。
 *
 * rate 是**满槽时**的拦截概率。名字取的都是常见犬种，
 * 越靠后越少见 —— 冒险里能挖到龙犬，得跑不少趟高等级图。
 *
 * 第一名是新手开场就送的那只（比熊，20%）；田园犬排在第 7 档（58%），
 * 属于「老玩家才养得起」的主力。
 */
export const DOG_BREEDS = [
  { id: 'bixiong', name: '比熊', emoji: '🧸', tier: 1, rate: 0.20 },
  { id: 'chai', name: '柴犬', emoji: '🐶', tier: 2, rate: 0.28 },
  { id: 'guibin', name: '贵宾犬', emoji: '🐩', tier: 3, rate: 0.34 },
  { id: 'bianmu', name: '边牧', emoji: '🐕‍🦺', tier: 4, rate: 0.40 },
  { id: 'daobian', name: '导盲犬', emoji: '🦮', tier: 5, rate: 0.46 },
  { id: 'xuelang', name: '雪狼犬', emoji: '🐺', tier: 6, rate: 0.52 },
  { id: 'tuyuan', name: '田园犬', emoji: '🐕', tier: 7, rate: 0.58 },
  { id: 'liebao', name: '猎豹犬', emoji: '🐯', tier: 8, rate: 0.64 },
  { id: 'shizong', name: '狮鬃犬', emoji: '🦁', tier: 9, rate: 0.72 },
  { id: 'longquan', name: '龙犬', emoji: '🐉', tier: 10, rate: 0.80 },
];

/**
 * 第 18 轮改名单时的迁移表：旧品种 → 接替它的新品种。
 *
 * - `huli`（狐狸犬，58%）被删掉，由 `tuyuan`（田园犬，58%）顶上；
 * - 旧的 `tuyuan` 是**开局送的那只**（20%），换成新的开局犬 `bixiong`（比熊）。
 *
 * ⚠️ 这张表只能**一次性**套用（`normalizePlayerFarm` 用 `dog.migrated` 打标记）：
 * 直接每次读档都套，会把玩家后来正经收集到的田园犬又降成比熊。
 */
export const LEGACY_BREED_MAP = { tuyuan: 'bixiong', huli: 'tuyuan' };

/** 品种改名的存档版本标记，写在 `dog.migrated` 上 */
export const BREED_MIGRATION = 'r18';

/** 品种 id 列表 */
export const DOG_BREED_IDS = DOG_BREEDS.map((b) => b.id);

/** 新手起始品种：最低的那只 */
export const FIRST_DOG_ID = DOG_BREEDS[0].id;

/** 按 id 取品种 */
export function dogBreed(id) {
  return DOG_BREEDS.find((b) => b.id === id) || null;
}

/**
 * 藏宝图档位 → 这张图能挖到的最高品种品阶。
 *
 * 档位越高，池子里能滚到的品阶上限越高，但每一档都还留着低品阶 ——
 * 低级图也能开出一只田园犬，只是仅此而已。
 */
export const DOG_TIER_BY_MAP = [0, 2, 3, 5, 7, 10];

/**
 * 从「品阶不超过上限、且玩家还没拥有」的品种里随机挑一只。
 *
 * @param {number} mapTier 藏宝图档位
 * @param {string[]} owned 玩家已经拥有的品种 id
 * @returns {?object} 品种对象；候选为空（已收集齐）时返回 null
 */
export function rollDogBreed(mapTier, owned = []) {
  const cap = DOG_TIER_BY_MAP[Math.min(5, Math.max(1, mapTier))] || 1;
  const ownedSet = new Set(owned);
  const pool = DOG_BREEDS.filter((b) => b.tier <= cap && !ownedSet.has(b.id));
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ---------- 概率 ---------- */

/**
 * 拦截概率 = 品种基础率 × 饱腹度修正。
 *
 * 满槽时就是品种的基础率；饿了打对折；空槽一条也拦不住。
 *
 * @param {number} baseRate 品种基础率（0~1）
 * @param {number} satiety 槽内饱腹度（0~100）
 * @param {number} [max] 槽容量：玩家的狗窝升级后大于 100，邻居恒为 100
 * @returns {number} 0~1
 */
export function catchChance(baseRate, satiety, max = DOG_SATIETY_MAX) {
  if (satiety <= 0) return 0;
  const ratio = Math.min(1, satiety / (max || DOG_SATIETY_MAX));
  return baseRate * (0.5 + 0.5 * ratio);
}

/* ---------- NPC 的狗 ---------- */

/** NPC 的狗开局时的饱腹度：有的刚喂过，有的已经饿了一阵 */
export const rollNpcDogSatiety = () => Math.floor(Math.random() * 71);

/**
 * 某个狗粮槽在 at 时刻的饱腹度。
 *
 * 玩家与邻居共用这一套算法：存档里只存「上次结算时的存量 + 那一刻」，
 * 用的时候按经过的小时数现算 —— 不需要任何后台定时器，
 * 页面关十天再打开，一读就是停在那儿的值。
 *
 * **没有狗上岗时槽不消耗**（狗在窝里睡觉，不掉饥饿）。
 *
 * @param {{satiety?: number, at?: number, breed?: string}} dog
 * @param {number} at 毫秒时间戳
 * @param {number} [max] 槽容量：玩家的狗窝升级后大于 100，邻居恒为 100
 * @returns {number} 0~max
 */
export function dogSatietyAt(dog, at, max = DOG_SATIETY_MAX) {
  const cap = max || DOG_SATIETY_MAX;
  const raw = Math.max(0, Number(dog?.satiety) || 0);
  if (!dog?.breed) return Math.min(cap, raw);
  const hours = Math.max(0, (at - (Number(dog.at) || 0)) / 3600_000);
  return Math.max(0, Math.min(cap, raw - hours * DOG_SATIETY_DECAY));
}

/**
 * 给邻居配一条狗：等级越高，越可能养得起好狗。
 *
 * 品阶下限钉在 3 —— 邻居的狗要是太弱，「被抓住就封锁全场」这个惩罚
 * 就形同虚设，玩家会完全无惧偷菜。
 *
 * @param {number} level 邻居等级
 * @returns {object} 品种对象
 */
export function rollNpcDogBreed(level) {
  const cap = Math.min(8, Math.max(3, 3 + Math.floor(level / 12)));
  const pool = DOG_BREEDS.filter((b) => b.tier <= cap);
  return pool[Math.floor(Math.random() * pool.length)];
}
