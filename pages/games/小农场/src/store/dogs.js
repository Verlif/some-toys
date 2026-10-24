/**
 * 守护犬领域：狗窝（拥有的品种）、上岗（唯一生效的那只）、共享狗粮槽、
 * 狗窝升级与每日挖宝。
 *
 * 四件事分清楚：
 *   - **品种**：这条狗的基础拦截概率（20% ~ 80%），是长期养成的方向；
 *   - **上岗**：同一时刻只有一只狗在看家（`farm.dog.breed`），
 *     也可以一只都不上岗 —— 那就完全不设防；
 *   - **狗粮槽**：整个狗窝共用的存货（`farm.dog.satiety`）。
 *     喂一次所有狗都受益，但槽只在**有狗上岗**时消耗，
 *     没狗上岗时它就停在那里不掉了。容量随狗窝等级长（100+30×级）；
 *   - **狗窝升级**（`farm.dogHouse.level`）：花金币扩容，最高 5 级；
 *   - **每日挖宝**：有狗上岗且槽里有粮时，每天按品种品阶对应的藏宝图
 *     档位掷一份奖励，离线按天补掷（见 settleDogDig）。
 *
 * 邻居的狗用的是同一个 `farm.dog` 结构（没有 owned / 只能有一只），
 * 所以「拦截率」在玩家与邻居两边是同一套公式，见 data/dogs.js。
 * 邻居没有狗窝等级（容量恒 100），也没有挖宝。
 *
 * 品种来源：初始赠送比熊（最低档，20%），
 * 之后只能从冒险的奖励池里挖到（低概率、按藏宝图档位分品阶、不重复）。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';
import * as inventory from './inventory.js';
import * as player from './player.js';
import {
  DOG_BREEDS,
  DOG_DIG_CHANCE,
  DOG_DIG_MAX_CATCHUP,
  DOG_DIG_MIN_SATIETY,
  DOG_FOOD_PRO_SATIETY,
  DOG_FOOD_SATIETY,
  DOG_SATIETY_DECAY,
  KENNEL_MAX_LEVEL,
  KENNEL_UPGRADE_COSTS,
  catchChance,
  dogBreed,
  dogHouseCapacity,
  dogSatietyAt,
} from '../data/dogs.js';
import { describeReward, rollDogDigReward } from '../data/adventure.js';
import { ITEMS } from '../data/items.js';
import { produceId, seedId } from '../data/keys.js';
import { dayIndex, dayKey } from '../core/utils.js';
import { notify } from './notify.js';
import { addNews } from './news.js';
import { completeGuide } from './codex.js';

/** 玩家农场的看家狗槽 */
const dog = () => state.farm.dog;

/** 两种狗粮 → 各补多少点（普通 45 / 精品 100） */
const FOOD_POINTS = { dogFood: DOG_FOOD_SATIETY, dogFoodPro: DOG_FOOD_PRO_SATIETY };

/* ---------- 查询 ---------- */

/** 玩家已拥有的品种（按品阶从低到高） */
export function ownedDogs() {
  const owned = dog().owned || {};
  return DOG_BREEDS.filter((b) => owned[b.id]);
}

/** 已拥有的品种 id 列表（冒险发奖时用来避免重复） */
export function ownedBreedIds() {
  return Object.keys(dog().owned || {});
}

/** 当前上岗的品种；没有则返回 null */
export function activeBreed() {
  return dog().breed ? dogBreed(dog().breed) : null;
}

/** 已收集的品种数 / 总数 */
export function breedProgress() {
  return { owned: ownedDogs().length, total: DOG_BREEDS.length };
}

/* ---------- 狗粮槽 ---------- */

/** 狗窝等级（0~5），旧档补 0 */
export const kennelLevel = () => state.farm.dogHouse?.level || 0;

/** 当前狗粮槽容量：基础 100 + 30 × 狗窝等级 */
export const kennelCapacity = () => dogHouseCapacity(kennelLevel());

/**
 * 狗窝升级还差什么。满级时 `maxed = true`。
 * @returns {{maxed: boolean, next: ?number, cost: number, coinsOk: boolean, ok: boolean}}
 */
export function kennelUpgradeState() {
  const level = kennelLevel();
  if (level >= KENNEL_MAX_LEVEL) {
    return { maxed: true, next: null, cost: 0, coinsOk: false, ok: false };
  }
  const cost = KENNEL_UPGRADE_COSTS[level] || 0;
  return {
    maxed: false,
    next: level + 1,
    cost,
    coinsOk: state.farm.coins >= cost,
    ok: state.farm.coins >= cost,
  };
}

/**
 * 某一时刻的槽内存量。
 *
 * 存档里只存「上次结算时的饱腹度 + 那个时刻」，这里按经过的小时数现算。
 * 好处是不需要任何后台定时器：页面关十天再打开，一读就是停在那儿的值。
 * 没有狗上岗时槽不消耗 —— 狗在窝里睡觉，不掉饥饿。
 *
 * @param {number} [t] 毫秒时间戳
 * @returns {number} 0 ~ 当前容量
 */
export function dogSatiety(t = Date.now()) {
  return dogSatietyAt(dog(), t, kennelCapacity());
}

/**
 * 把当前槽内存量写回存档基准（换狗、下狗、升级狗窝时调用）。
 * 没有这一步，这段「没有狗上岗」的时间会被当成消耗掉。
 * @param {number} [now]
 */
function settleSatiety(now = Date.now()) {
  dog().satiety = dogSatiety(now);
  dog().at = now;
}

/** 守护犬是否还在看家（有狗上岗且槽里有粮） */
export function isDogGuarding(now = Date.now()) {
  return Boolean(activeBreed()) && dogSatiety(now) > 0.5;
}

/** 还能守多久（毫秒） */
export function guardRemainMs(now = Date.now()) {
  if (!activeBreed()) return 0;
  return Math.round((dogSatiety(now) / DOG_SATIETY_DECAY) * 3600_000);
}

/**
 * 玩家狗在某一时刻的拦截概率（0~1）。
 *
 * 离线结算要用「那一刻」的概率，所以时间点由调用方给。
 *
 * @param {number} [at] 毫秒时间戳
 * @returns {number}
 */
export function guardChance(at = Date.now()) {
  const breed = activeBreed();
  if (!breed) return 0;
  return catchChance(breed.rate, dogSatiety(at), kennelCapacity());
}

/** 当前的实际拦截概率（狗窝里显示的那个数） */
export const guardChanceNow = () => guardChance(Date.now());

/* ---------- 变更 ---------- */

/**
 * 喂狗：消耗 1 份狗粮，共享槽加上对应的点数。
 *
 * 两种粮：普通 🦴 +45、精品 🍖 +100（双倍价），由调用方传 itemId。
 * 存量按**当前容量**封顶 —— 狗窝升过级，槽就装得更多。
 *
 * @param {string} [itemId] 'dogFood' | 'dogFoodPro'
 * @returns {Promise<boolean>}
 */
export async function feedDog(itemId = 'dogFood') {
  const food = ITEMS[itemId];
  const points = FOOD_POINTS[itemId];
  if (!food || !points) {
    notify('这不是狗粮');
    return false;
  }
  const cap = kennelCapacity();
  if (dogSatiety() >= cap - 1) {
    notify('🐕 槽子已经满啦，粮食都溢出来了');
    return false;
  }
  if (!inventory.take(itemId, 1)) {
    notify(`没有${food.name}，去商店买吧`);
    return false;
  }

  const now = Date.now();
  // 先把「到此刻为止」的消耗结算掉，再往上加，避免叠加时把过期的时间也算进去
  const next = Math.min(cap, dogSatiety(now) + points);
  dog().satiety = next;
  dog().at = now;

  player.addLog('🦴', `添了${food.name}，槽内存量 ${Math.round(next)}/${cap}`);
  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.PETS);
  emit(EVENTS.INVENTORY);

  await completeGuide('feed');

  notify(`🐕 狗粮槽 ${Math.round(next)}/${cap}`, 'gold');
  return true;
}

/**
 * 狗窝升一级：只花金币，狗粮槽容量 +30。
 *
 * 升级前先把当前存量写回基准（settleSatiety）—— 不然「从上次结算到现在」
 * 的衰减会按旧基准重算一遍，扩容反而像漏了粮。
 *
 * @returns {Promise<boolean>}
 */
export async function upgradeKennel() {
  const st = kennelUpgradeState();
  if (st.maxed) {
    notify('狗窝已经是最高等级了');
    return false;
  }
  if (!st.coinsOk) {
    notify(`还差 ${st.cost - state.farm.coins} 金币`);
    return false;
  }

  const now = Date.now();
  settleSatiety(now);
  player.spendCoins(st.cost);
  state.farm.dogHouse.level = st.next;

  player.addLog('🏠', `狗窝升到了 Lv.${st.next}（狗粮槽容量 ${kennelCapacity()}）`);
  await commit({ farms: [state.farm] });
  emit(EVENTS.PETS);
  emit(EVENTS.PLAYER);

  notify(`🏠 狗窝升到 Lv.${st.next}，狗粮槽容量 ${kennelCapacity()}`, 'gold');
  return true;
}

/* ---------- 每日挖宝 ---------- */

/** 一份挖宝奖励的发放方式（与冒险结算同口径） */
function grantReward(reward) {
  if (!reward) return;
  if (reward.kind === 'coin') player.addCoins(reward.n);
  else if (reward.kind === 'item') inventory.add(reward.id, reward.n);
  else if (reward.kind === 'produce') inventory.add(produceId(reward.id), reward.n);
  else inventory.add(seedId(reward.id), reward.n);
}

/**
 * 守护犬每日挖宝结算。
 *
 * 规则：**有狗上岗且槽里有粮**（不饿）时，每天掷一次（30%），命中就按
 * **上岗品种的品阶**对应的藏宝图档位抽一份奖励 —— 品阶 1-2→一级图、
 * 3-4→二级……9-10→五级，好狗才带得动好图。
 *
 * 只掷「已经过完的」天：今天的等过了 0 点才算数（和签到一个思路）。
 * 离线期间按天补掷，最多 DOG_DIG_MAX_CATCHUP 天；命中一次性发放，
 * 汇总成一条提示与一条日志，不拿十几条 toast 轰炸玩家。
 *
 * 「不饿」按**当前**槽内存量判定：离线期间的历史饱腹度无法精确还原，
 * 而且狗饿着就该没心情挖宝。
 *
 * @param {number} [now]
 * @returns {Promise<?{days: number, hits: number, rewards: object[]}>}
 */
export async function settleDogDig(now = Date.now()) {
  const house = state.farm.dogHouse;
  if (!house) return null;

  const today = dayIndex(now);
  const last = house.digDay ? dayIndex(house.digDay) : today - 1;
  const days = Math.min(DOG_DIG_MAX_CATCHUP, today - 1 - last);
  // 第一次见到这个字段（新档 / 老档迁移）：记账到「昨天」——
  // 这样下一个自然日就能掷「今天」的，不会白白漏掉一天
  if (days <= 0) {
    if (!house.digDay) house.digDay = dayKey(now - 86_400_000);
    return null;
  }

  const breed = activeBreed();
  const satiety = dogSatiety(now);
  const rewards = [];
  if (breed && satiety >= DOG_DIG_MIN_SATIETY) {
    for (let i = 0; i < days; i += 1) {
      if (Math.random() >= DOG_DIG_CHANCE) continue;
      const r = rollDogDigReward(breed.tier);
      if (r) rewards.push(r);
    }
  }

  // 不管挖没挖到，这些天都算翻篇了 —— 否则下次上线会原样再掷一遍
  house.digDay = dayKey(now - 86_400_000);

  if (!rewards.length) {
    // 只推进了记账，也要落盘（不然每次启动都白掷一遍概率）
    await commit({ farms: [state.farm] });
    return { days, hits: 0, rewards };
  }

  const got = [];
  for (const r of rewards) {
    grantReward(r);
    got.push(describeReward(r));
  }
  // 只隔了一天（跨 0 点还在线上）就说「昨天」，离线多天才说「你不在的 N 天」
  const when = days === 1 ? '昨天' : `你不在的 ${days} 天里`;
  player.addLog('🐕', `守护犬挖宝：${when}挖到 ${rewards.length} 份奖励（${got.join('、')}）`);

  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.PETS);
  emit(EVENTS.INVENTORY);
  emit(EVENTS.PLAYER);

  const head = got.slice(0, 3).join('、');
  notify(`🐕 守护犬${when}挖到了 ${rewards.length} 份奖励：${head}${got.length > 3 ? ' 等' : ''}`, 'gold');
  return { days, hits: rewards.length, rewards };
}

/**
 * 换一只狗上岗（或让所有狗休息）。
 *
 * @param {string|null} breedId 品种 id；传 null 表示一只都不上岗
 * @returns {Promise<boolean>}
 */
export async function setActiveBreed(breedId) {
  const owned = dog().owned || {};
  if (breedId && !owned[breedId]) return false;

  const now = Date.now();
  settleSatiety(now);
  dog().breed = breedId || '';

  const breed = breedId ? dogBreed(breedId) : null;
  player.addLog('🐕', breed
    ? `让${breed.emoji}${breed.name}上岗看家`
    : '让所有守护犬休息，农场暂时不设防');

  await commit({ farms: [state.farm] });
  emit(EVENTS.PETS);
  emit(EVENTS.PLAYER);

  notify(breed
    ? `🐕 ${breed.name}上岗了（基础拦截 ${Math.round(breed.rate * 100)}%）`
    : '🐕 所有守护犬都休息了', breed ? 'gold' : '');
  return true;
}

/**
 * 获得一个新品种（冒险奖励）。
 *
 * 已经拥有的不会再给 —— 冒险奖励池在生成时就排除了已收集的。
 *
 * @param {string} breedId
 * @returns {boolean} 是否真的收入狗窝
 */
export function addDogBreed(breedId) {
  const breed = dogBreed(breedId);
  if (!breed) return false;
  dog().owned ??= {};
  if (dog().owned[breedId]) return false;

  dog().owned[breedId] = true;
  // 一只狗都没有时，新来的这只自动上岗（不然玩家会以为白捡了）
  if (!dog().breed) dog().breed = breedId;

  player.addLog('🐕', `狗窝里多了一只${breed.emoji}${breed.name}`);
  addNews('🐕', `你的狗窝里多了一只${breed.name}（基础拦截 ${Math.round(breed.rate * 100)}%）`);
  return true;
}
