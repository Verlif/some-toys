/**
 * 守护犬领域：狗窝（拥有的品种）、上岗（唯一生效的那只）、共享狗粮槽。
 *
 * 三件事分清楚：
 *   - **品种**：这条狗的基础拦截概率（20% ~ 80%），是长期养成的方向；
 *   - **上岗**：同一时刻只有一只狗在看家（`farm.dog.breed`），
 *     也可以一只都不上岗 —— 那就完全不设防；
 *   - **狗粮槽**：整个狗窝共用的存货（`farm.dog.satiety`）。
 *     喂一次所有狗都受益，但槽只在**有狗上岗**时消耗，
 *     没狗上岗时它就停在那里不掉了。
 *
 * 邻居的狗用的是同一个 `farm.dog` 结构（没有 owned / 只能有一只），
 * 所以「拦截率」在玩家与邻居两边是同一套公式，见 data/dogs.js。
 *
 * 品种来源：初始赠送田园犬（最低档，20%），
 * 之后只能从冒险的奖励池里挖到（低概率、按藏宝图档位分品阶、不重复）。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';
import * as inventory from './inventory.js';
import * as player from './player.js';
import {
  DOG_BREEDS,
  DOG_FOOD_SATIETY,
  DOG_SATIETY_DECAY,
  DOG_SATIETY_MAX,
  catchChance,
  dogBreed,
  dogSatietyAt,
} from '../data/dogs.js';
import { notify } from './notify.js';
import { addNews } from './news.js';
import { completeGuide } from './codex.js';

/** 玩家农场的看家狗槽 */
const dog = () => state.farm.dog;

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

/**
 * 某一时刻的槽内存量。
 *
 * 存档里只存「上次结算时的饱腹度 + 那个时刻」，这里按经过的小时数现算。
 * 好处是不需要任何后台定时器：页面关十天再打开，一读就是停在那儿的值。
 * 没有狗上岗时槽不消耗 —— 狗在窝里睡觉，不掉饥饿。
 *
 * @param {number} [t] 毫秒时间戳
 * @returns {number} 0~100
 */
export function dogSatiety(t = Date.now()) {
  return dogSatietyAt(dog(), t);
}

/**
 * 把当前槽内存量写回存档基准（换狗、下狗时调用）。
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
  return catchChance(breed.rate, dogSatiety(at));
}

/** 当前的实际拦截概率（狗窝里显示的那个数） */
export const guardChanceNow = () => guardChance(Date.now());

/* ---------- 变更 ---------- */

/**
 * 喂狗：消耗 1 份狗粮，共享槽 +45。
 * @returns {Promise<boolean>}
 */
export async function feedDog() {
  if (dogSatiety() >= DOG_SATIETY_MAX - 1) {
    notify('🐕 槽子已经满啦，粮食都溢出来了');
    return false;
  }
  if (!inventory.take('dogFood', 1)) {
    notify('没有狗粮，去商店买吧');
    return false;
  }

  const now = Date.now();
  // 先把「到此刻为止」的消耗结算掉，再往上加，避免叠加时把过期的时间也算进去
  const next = Math.min(DOG_SATIETY_MAX, dogSatiety(now) + DOG_FOOD_SATIETY);
  dog().satiety = next;
  dog().at = now;

  player.addLog('🦴', `添了狗粮，槽内存量 ${Math.round(next)}%`);
  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.PETS);
  emit(EVENTS.INVENTORY);

  await completeGuide('feed');

  notify(`🐕 狗粮槽 ${Math.round(next)}%`, 'gold');
  return true;
}

/**
 * 换一只狗上岗（或全部下岗）。
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
    : '让所有守护犬下岗，农场暂时不设防');

  await commit({ farms: [state.farm] });
  emit(EVENTS.PETS);
  emit(EVENTS.PLAYER);

  notify(breed
    ? `🐕 ${breed.name}上岗了（基础拦截 ${Math.round(breed.rate * 100)}%）`
    : '🐕 所有守护犬都下岗了', breed ? 'gold' : '');
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
