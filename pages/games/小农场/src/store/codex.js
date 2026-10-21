/**
 * 图鉴领域：记录每种作物的种植与收获次数，以及做好的标本。
 *
 * 统计存在 player.cropStats 上，结构是 { 作物id: { planted, harvested } }。
 * **点亮**的判定是「有标本」—— 制作一份标本要花掉仓库里 50 个同样的产出，
 * 所以收集本身就是目标；收获数只是展示用的参考资料。
 *
 * 标本存在 player.specimens 上，结构是 { 作物id: true }。
 *
 * 老存档没有 cropStats，统计从接入那一刻开始累积，不追溯历史。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';
import { CROP_IDS, CROPS } from '../data/crops.js';
import { MAX_LEVEL } from '../data/progression.js';
import { GUIDES, guideRewardText } from '../data/guide.js';
import { produceId } from '../data/keys.js';
import { add, count, take } from './inventory.js';
import { addCoins, addExpRaw } from './player.js';
import { notify } from './notify.js';

/** 制作一份标本要消耗多少个产出 */
export const SPECIMEN_COST = 50;

/** 补齐后来新增的字段 */
export function ensureStats() {
  if (!state.farm.progress.cropStats) state.farm.progress.cropStats = {};
  if (!state.farm.progress.specimens) state.farm.progress.specimens = {};
  if (!state.farm.progress.guide) state.farm.progress.guide = {};
}

/** 取某种作物的统计，没有记录时返回零值 */
export function statOf(cropId) {
  return state.farm.progress.cropStats?.[cropId] || { planted: 0, harvested: 0 };
}

/** 累加一次统计（内存操作，由调用方决定何时落盘） */
function bump(cropId, field, delta) {
  ensureStats();
  const entry = state.farm.progress.cropStats[cropId] || { planted: 0, harvested: 0 };
  entry[field] = (entry[field] || 0) + delta;
  state.farm.progress.cropStats[cropId] = entry;
}

/** 记一次播种 */
export const recordPlanted = (cropId) => bump(cropId, 'planted', 1);

/** 记一次收获（按产量累加） */
export const recordHarvested = (cropId, amount) => bump(cropId, 'harvested', amount);

/** 触发一次图鉴更新事件 */
export const touchCodex = () => emit(EVENTS.CODEX);

/* ---------- 新手引导 ---------- */

/**
 * 标记某个引导项完成并**立即发放**奖励。
 * 已经在业务动作里埋好点，玩家不需要记得回来领，奖励不会因为忘记点而损失。
 *
 * 奖励 = 零头金币 + 经验 + 道具（化肥 / 狗粮 / 藏宝图…）。
 * @param {string} key 引导项 key
 * @returns {Promise<boolean>} 是否是新完成的引导项
 */
export async function completeGuide(key) {
  ensureStats();
  if (state.farm.progress.guide[key]) return false;

  const guide = GUIDES.find((g) => g.key === key);
  if (!guide) return false;

  state.farm.progress.guide[key] = true;
  addCoins(guide.coins || 0);
  addExpRaw(guide.exp);
  for (const [itemId, n] of Object.entries(guide.items || {})) add(itemId, n);

  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.CODEX);
  emit(EVENTS.PLAYER);
  emit(EVENTS.INVENTORY);

  notify(`🏅 ${guide.emoji} ${guide.name}　${guideRewardText(guide)}`, 'gold');
  return true;
}

/** 引导进度列表 */
export function guideStates() {
  const done = state.farm.progress.guide || {};
  return GUIDES.map((g) => ({ ...g, done: Boolean(done[g.key]) }));
}

/** 引导完成数 */
export function guideProgress() {
  const done = state.farm.progress.guide || {};
  return {
    done: GUIDES.filter((g) => done[g.key]).length,
    total: GUIDES.length,
  };
}

/* ---------- 图鉴 ---------- */

/** 是否已经做好标本 */
export function hasSpecimen(cropId) {
  ensureStats();
  return Boolean(state.farm.progress.specimens[cropId]);
}

/** 仓库里够不够做一份标本 */
export function specimenReady(cropId) {
  return count(produceId(cropId)) >= SPECIMEN_COST;
}

/**
 * 制作一份标本：扣掉仓库里 50 个同样的产出，点亮该图鉴。
 *
 * @param {string} cropId
 * @returns {Promise<boolean>} 是否制作成功
 */
export async function makeSpecimen(cropId) {
  ensureStats();
  const crop = CROPS[cropId];
  if (!crop) return false;
  if (hasSpecimen(cropId)) {
    notify('这份标本已经做好了');
    return false;
  }
  if (!specimenReady(cropId)) {
    notify(`仓库里不够 ${SPECIMEN_COST} 个${crop.name}`);
    return false;
  }

  take(produceId(cropId), SPECIMEN_COST);
  state.farm.progress.specimens[cropId] = true;

  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.CODEX);
  emit(EVENTS.INVENTORY);

  await completeGuide('specimen');
  notify(`${crop.emoji} 做好了${crop.name}的标本，图鉴已点亮`, 'gold');
  return true;
}

/**
 * 图鉴条目列表。全部作物都返回，由调用方决定怎么展示未解锁的。
 * @returns {Array<{id, name, emoji, lv, stages, sell, yield, grow, harvests,
 *                 planted, harvested, lit, unlocked, unlockedPlots,
 *                 specimen, canMake, owned}>}
 */
export function codexEntries() {
  const level = state.farm.level;
  ensureStats();

  return CROP_IDS.map((id) => {
    const crop = CROPS[id];
    const stat = statOf(id);
    const specimen = hasSpecimen(id);
    const owned = count(produceId(id));
    return {
      id,
      name: crop.name,
      emoji: crop.emoji,
      lv: crop.lv,
      stages: crop.stages,
      grow: crop.grow,
      harvests: crop.harvests,
      yield: crop.yield,
      sell: crop.sell,
      seed: crop.seed,
      /** 限定作物：商店不卖，只能从藏宝图挖到 */
      special: Boolean(crop.special),
      planted: stat.planted,
      harvested: stat.harvested,
      /** 点亮：做好了一份标本 */
      lit: specimen,
      /** 已经做好标本 */
      specimen,
      /** 仓库里现有的产出数量 */
      owned,
      /** 能不能做标本：没做过且仓库里够 50 个 */
      canMake: !specimen && owned >= SPECIMEN_COST,
      /** 解锁：等级足够 */
      unlocked: level >= crop.lv,
    };
  });
}

/** 图鉴总览 */
export function codexSummary() {
  const entries = codexEntries();
  const unlocked = entries.filter((e) => e.unlocked).length;
  const lit = entries.filter((e) => e.lit).length;
  return {
    total: entries.length,
    unlocked,
    lit,
    /** 0~100 的收集进度 */
    percent: entries.length ? Math.round((lit / entries.length) * 100) : 0,
    /** 距离满级还有多少作物没解锁 */
    remainingToMaxLevel: entries.filter((e) => !e.unlocked && e.lv === MAX_LEVEL).length,
  };
}