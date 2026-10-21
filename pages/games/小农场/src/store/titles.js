/**
 * 称号领域：领取、佩戴、奖励发放。
 *
 * 称号分三类，条件不同但流程一致：
 *   等级称号  条件是农场等级
 *   图鉴称号  条件是点亮的图鉴数量（做够标本才算点亮）
 *   金币称号  条件是当前持有的金币数量
 *
 * 全部要**手动领取** —— 达成条件只让称号「可领」，
 * 玩家得自己去称号页点一下，奖励才发。
 * 领取后可以佩戴其中任意一个，佩戴的称号显示在顶栏。
 *
 * 奖励**只有道具**（化肥 / 增产剂 / 狗粮 / 特殊种子 / 藏宝图…）——
 * 金币奖励已移除：称号是里程碑，不该变成按等级缩放的自动提款机。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';
import { TITLES, titleById } from '../data/progression.js';
import { itemLabel } from '../data/keys.js';
import { codexSummary, completeGuide } from './codex.js';
import { add } from './inventory.js';
import { notify } from './notify.js';

/** 玩家已领取的称号集合 */
function claimedMap() {
  state.farm.progress.titles ??= { claimed: {}, equipped: '' };
  state.farm.progress.titles.claimed ??= {};
  return state.farm.progress.titles.claimed;
}

/** 称号条件是否已达成 */
export function isUnlocked(title) {
  if (title.need.type === 'level') return state.farm.level >= title.need.value;
  if (title.need.type === 'codex') return codexSummary().lit >= title.need.value;
  if (title.need.type === 'coins') return state.farm.coins >= title.need.value;
  return false;
}

/**
 * 全部称号的状态，供称号页渲染。
 * @returns {Array<{id,name,emoji,skin,need,items,claimed,equipped,unlocked}>}
 */
export function titleStates() {
  const claimed = claimedMap();
  const equipped = state.farm.progress.titles?.equipped || '';
  return TITLES.map((t) => ({
    ...t,
    claimed: Boolean(claimed[t.id]),
    equipped: equipped === t.id,
    unlocked: isUnlocked(t),
  }));
}

/** 当前佩戴的称号（没佩戴过就是 null） */
export function equippedTitle() {
  const id = state.farm.progress.titles?.equipped || '';
  return id ? titleById(id) : null;
}

/** 已达成但还没领的称号数量（顶栏用来提示） */
export function claimableCount() {
  const claimed = claimedMap();
  return TITLES.filter((t) => !claimed[t.id] && isUnlocked(t)).length;
}

/**
 * 领取一个称号：发放道具奖励，并自动佩戴（若尚未佩戴任何称号）。
 *
 * 奖励只有道具 —— 金币倍率已按需求移除，见文件头说明。
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

  const items = title.items || {};

  claimed[id] = true;
  for (const [itemId, n] of Object.entries(items)) add(itemId, n);

  // 还没佩戴过任何称号时，领到的第一个直接戴上
  if (!state.farm.progress.titles.equipped) state.farm.progress.titles.equipped = id;

  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.PLAYER);
  emit(EVENTS.INVENTORY);
  emit(EVENTS.TITLES);

  const itemText = Object.entries(items)
    .map(([itemId, n]) => `${itemLabel(itemId)} ×${n}`)
    .join('、');
  notify(`${title.emoji} 领到了称号「${title.name}」${itemText ? ' · ' + itemText : ''}`, 'gold');
  await completeGuide('title');
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
  if (state.farm.progress.titles.equipped === id) return true;

  state.farm.progress.titles.equipped = id;
  await commit({ farms: [state.farm] });
  emit(EVENTS.PLAYER);
  emit(EVENTS.TITLES);

  notify(`${title.emoji} 已佩戴「${title.name}」`);
  return true;
}
