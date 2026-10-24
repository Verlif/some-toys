/**
 * 图鉴领域：记录每种作物的种植与收获次数、是否收集过、以及做好的标本。
 *
 * 统计存在 player.cropStats 上，结构是 { 作物id: { planted, harvested } }。
 *
 * **收集**的判定是「产出进过一次仓库」（`store/collected.js` 在 `inventory.add()`
 * 处记账，只增不减）—— 收的、偷的、邻居送的都算。图鉴墙据此显示真图标。
 * **点亮**的判定更严：做一份标本要花掉仓库里 50 个同样的产出，所以它是成就
 * （第 43 轮起点亮还奖 1 颗同种种子，见 CODEX_SEED_REWARD）。
 *
 * 标本存在 player.specimens 上，结构是 { 作物id: true }。
 *
 * 老存档没有 cropStats / collected，收集状态会按「收获过或仓库里还有」兜底补算，
 * 之后从入包那一刻开始精确累积。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';
import { CROP_IDS, CROPS } from '../data/crops.js';
import { MAX_LEVEL } from '../data/progression.js';
import { GUIDES, guideRewardText } from '../data/guide.js';
import { produceId } from '../data/keys.js';
import { add, count, take } from './inventory.js';
import { isCollected } from './collected.js';
import { addCoins, addExpRaw } from './player.js';
import { notify } from './notify.js';

/** 制作一份标本要消耗多少个产出 */
export const SPECIMEN_COST = 50;

/**
 * 点亮一个图鉴奖励的种子数（第 43 轮新增）。
 *
 * 点亮要花掉 50 个产出，奖 1 颗同种种子算是「纪念品 + 复种的火种」——
 * 种子价随等级自然缩放，高级图鉴一颗就值几万，不会失衡。
 */
export const CODEX_SEED_REWARD = 1;

/** 补齐后来新增的字段 */
export function ensureStats() {
  if (!state.farm.progress.cropStats) state.farm.progress.cropStats = {};
  if (!state.farm.progress.specimens) state.farm.progress.specimens = {};
  if (!state.farm.progress.collected) state.farm.progress.collected = {};
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
 * 点亮同时奖励 1 颗同种作物的种子（见 CODEX_SEED_REWARD）。
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
  // 点亮的纪念：1 颗同种种子，让这份图鉴不只是个记号
  add(seedId(cropId), CODEX_SEED_REWARD);

  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.CODEX);
  emit(EVENTS.INVENTORY);

  await completeGuide('specimen');
  notify(`${crop.emoji} 做好了${crop.name}的标本，图鉴已点亮 · 奖励 ${crop.name}种子 ×${CODEX_SEED_REWARD}`, 'gold');
  return true;
}

/**
 * 老档补偿：此前已经点亮的图鉴，各补发 1 颗种子（一次性）。
 *
 * 2026-10-24 新增「点亮奖种子」之前的存档里，点亮是只有荣誉没有实物的，
 * 这里在启动时按 `progress.codexSeeds` 标记补发一次，之后不再触发。
 *
 * @returns {Promise<number>} 补发的种数（0 = 无需补偿或已补过）
 */
export async function compensateLitSeeds() {
  ensureStats();
  if (state.farm.progress.codexSeeds) return 0;
  state.farm.progress.codexSeeds = true;

  const lit = Object.keys(state.farm.progress.specimens).filter((id) => CROPS[id]);
  if (!lit.length) return 0;

  for (const id of lit) add(seedId(id), CODEX_SEED_REWARD);
  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.CODEX);
  emit(EVENTS.INVENTORY);

  notify(`📖 图鉴补偿：已点亮的 ${lit.length} 种作物，各补发 1 颗种子`, 'gold');
  return lit.length;
}

/**
 * 图鉴条目列表。全部作物都返回，由调用方决定怎么展示未解锁的。
 * @returns {Array<{id, name, emoji, lv, stages, sell, yield, grow, harvests,
 *                 planted, harvested, collected, lit, unlocked, unlockedPlots,
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
    /* 老存档没有 collected 记录：收获过、仓库里还有货、已经做过标本，都算收集过
       （标本是收集的子集，这里兜一下，避免出现「点亮了却显示没见过」） */
    const collected = specimen || isCollected(id) || stat.harvested > 0 || owned > 0;
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
      /** 收集：产出进过一次仓库（只增不减） */
      collected,
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
  const collected = entries.filter((e) => e.collected).length;
  const lit = entries.filter((e) => e.lit).length;
  return {
    total: entries.length,
    unlocked,
    /** 收集到的作物数：产出进过仓库就算 */
    collected,
    /** 点亮数：做过标本才算 */
    lit,
    /** 0~100 的收集进度 */
    percent: entries.length ? Math.round((collected / entries.length) * 100) : 0,
    /** 0~100 的点亮进度（做过标本） */
    litPercent: entries.length ? Math.round((lit / entries.length) * 100) : 0,
    /** 距离满级还有多少作物没解锁 */
    remainingToMaxLevel: entries.filter((e) => !e.unlocked && e.lv === MAX_LEVEL).length,
  };
}