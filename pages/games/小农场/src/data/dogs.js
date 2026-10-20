/**
 * 守护犬：品种表、狗粮槽（饱腹度）、拦截概率。
 *
 * 早期只有一条狗，拦截概率全由饱腹度决定。现在拆成两层：
 *   - **品种**决定「这只狗能有多灵」：田园犬 20% … 龙犬 80%；
 *   - **狗粮槽**决定「它现在有没有力气」：满槽时按品种的基础率生效，
 *     饿了按比例打折，空槽则完全不设防。
 *
 * 狗粮槽是**整个狗窝共用**的一份存货：喂一次所有狗都受益，
 * 但同一时刻只有一只狗「上岗」（active）。没有狗上岗时槽不会消耗 ——
 * 狗在窝里睡觉，不掉饥饿。
 *
 * 品种来源：
 *   - 初始赠送最低品种（田园犬）；
 *   - 冒险的低概率奖励：按藏宝图档位决定品阶上限，且不会重复获得。
 */
import { ITEMS } from './items.js';

/* ---------- 狗粮槽 ---------- */

/** 槽的上限 */
export const DOG_SATIETY_MAX = 100;

/** 每份狗粮恢复的饱腹度 */
export const DOG_FOOD_SATIETY = 45;

/** 每小时掉多少饱腹度：喂满一次大约守护 16 小时 */
export const DOG_SATIETY_DECAY = 6.25;

/** 邻居给狗添一次食要花的钱：和玩家买一份狗粮同价 */
export const DOG_FOOD_PRICE = ITEMS.dogFood.price;

/* ---------- 品种表 ---------- */

/**
 * 十个品种，按品阶（tier）从低到高排。
 *
 * rate 是**满槽时**的拦截概率。名字取的都是常见犬种，
 * 越靠后越少见 —— 冒险里能挖到龙犬，得跑不少趟高等级图。
 */
export const DOG_BREEDS = [
  { id: 'tuyuan', name: '田园犬', emoji: '🐕', tier: 1, rate: 0.20 },
  { id: 'chai', name: '柴犬', emoji: '🐶', tier: 2, rate: 0.28 },
  { id: 'guibin', name: '贵宾犬', emoji: '🐩', tier: 3, rate: 0.34 },
  { id: 'bianmu', name: '边牧', emoji: '🐕‍🦺', tier: 4, rate: 0.40 },
  { id: 'daobian', name: '导盲犬', emoji: '🦮', tier: 5, rate: 0.46 },
  { id: 'xuelang', name: '雪狼犬', emoji: '🐺', tier: 6, rate: 0.52 },
  { id: 'huli', name: '狐狸犬', emoji: '🦊', tier: 7, rate: 0.58 },
  { id: 'liebao', name: '猎豹犬', emoji: '🐯', tier: 8, rate: 0.64 },
  { id: 'shizong', name: '狮鬃犬', emoji: '🦁', tier: 9, rate: 0.72 },
  { id: 'longquan', name: '龙犬', emoji: '🐉', tier: 10, rate: 0.80 },
];

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
 * @returns {number} 0~1
 */
export function catchChance(baseRate, satiety) {
  if (satiety <= 0) return 0;
  const ratio = Math.min(1, satiety / DOG_SATIETY_MAX);
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
 * @returns {number} 0~100
 */
export function dogSatietyAt(dog, at) {
  const raw = Math.max(0, Number(dog?.satiety) || 0);
  if (!dog?.breed) return Math.min(DOG_SATIETY_MAX, raw);
  const hours = Math.max(0, (at - (Number(dog.at) || 0)) / 3600_000);
  return Math.max(0, Math.min(DOG_SATIETY_MAX, raw - hours * DOG_SATIETY_DECAY));
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
