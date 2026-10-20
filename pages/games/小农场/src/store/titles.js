/**
 * 称号领域：领取、佩戴、奖励发放。
 *
 * 称号分两类，条件不同但流程一致：
 *   等级称号  条件是农场等级
 *   图鉴称号  条件是点亮的图鉴数量（做够标本才算点亮）
 *
 * 全部要**手动领取** —— 达成条件只让称号「可领」，
 * 玩家得自己去称号页点一下，奖励才发。
 * 领取后可以佩戴其中任意一个，佩戴的称号显示在顶栏。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';
import { TITLES, titleById } from '../data/progression.js';
import { CROPS } from '../data/crops.js';
import { codexSummary } from './codex.js';
import { addCoins } from './player.js';
import { add } from './inventory.js';
import { notify } from './notify.js';

/** 称号奖励金币的下限：等级低的时候一次收获也才值几块钱，太少了不像奖励 */
const MIN_REWARD_COINS = 30;

/** 玩家已领取的称号集合 */
function claimedMap() {
  state.player.titles ??= { claimed: {}, equipped: '' };
  state.player.titles.claimed ??= {};
  return state.player.titles.claimed;
}

/**
 * 奖励金币的基准：当前等级最贵作物的售价 × 3（一次正常收获的量级）。
 * 称号奖励随农场等级缩放，低等级领到的与高等级领到的不是同一个数。
 */
function coinBase() {
  const level = state.player.level;
  const best = Object.values(CROPS)
    .filter((c) => c.lv <= level)
    .reduce((max, c) => Math.max(max, c.sell), 12);
  return Math.max(MIN_REWARD_COINS, Math.round(best * 3));
}

/** 称号条件是否已达成 */
export function isUnlocked(title) {
  if (title.need.type === 'level') return state.player.level >= title.need.value;
  if (title.need.type === 'codex') return codexSummary().lit >= title.need.value;
  return false;
}

/**
 * 全部称号的状态，供称号页渲染。
 * @returns {Array<{id,name,emoji,skin,need,items,claimed,equipped,unlocked}>}
 */
export function titleStates() {
  const claimed = claimedMap();
  const equipped = state.player.titles?.equipped || '';
  return TITLES.map((t) => ({
    ...t,
    claimed: Boolean(claimed[t.id]),
    equipped: equipped === t.id,
    unlocked: isUnlocked(t),
  }));
}

/** 当前佩戴的称号（没佩戴过就是 null） */
export function equippedTitle() {
  const id = state.player.titles?.equipped || '';
  return id ? titleById(id) : null;
}

/** 已达成但还没领的称号数量（顶栏用来提示） */
export function claimableCount() {
  const claimed = claimedMap();
  return TITLES.filter((t) => !claimed[t.id] && isUnlocked(t)).length;
}

/**
 * 领取一个称号：发金币与道具，并自动佩戴（若尚未佩戴任何称号）。
 * @param {string} id
 * @returns {Promise<boolean>} 是否领取成功
 */
export async function claimTitle(id) {
  const title = titleById(id);
  if (!title) return false;

  const claimed = claimedMap();
  if (claimed[id]) {
    notify('这个称号已经领过了');
    return false;
  }
  if (!isUnlocked(title)) {
    notify('还没达成条件');
    return false;
  }

  const coins = Math.max(MIN_REWARD_COINS, Math.round(coinBase() * title.coins));
  const items = title.items || {};

  claimed[id] = true;
  addCoins(coins);
  for (const [itemId, n] of Object.entries(items)) add(itemId, n);

  // 还没佩戴过任何称号时，领到的第一个直接戴上
  if (!state.player.titles.equipped) state.player.titles.equipped = id;

  await commit({ player: state.player }, { bag: state.bag });
  emit(EVENTS.PLAYER);
  emit(EVENTS.INVENTORY);
  emit(EVENTS.TITLES);

  const itemText = Object.entries(items)
    .map(([itemId, n]) => `${itemId} ×${n}`)
    .join('、');
  notify(`${title.emoji} 领到了称号「${title.name}」 +${coins} 💰${itemText ? ' · ' + itemText : ''}`, 'gold');
  return true;
}

/**
 * 佩戴一个称号（必须先领到手）。
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function equipTitle(id) {
  const title = titleById(id);
  if (!title) return false;

  const claimed = claimedMap();
  if (!claimed[id]) {
    notify('这个称号还没领取');
    return false;
  }
  if (state.player.titles.equipped === id) return true;

  state.player.titles.equipped = id;
  await commit({ player: state.player });
  emit(EVENTS.PLAYER);
  emit(EVENTS.TITLES);

  notify(`${title.emoji} 已佩戴「${title.name}」`);
  return true;
}
