/**
 * 图鉴领域：记录每种作物的种植与收获次数。
 *
 * 统计存在 player.cropStats 上，结构是 { 作物id: { planted, harvested } }。
 * 「收获数 > 0」即视为点亮，这是图鉴的核心判定。
 *
 * 老存档没有 cropStats，统计从接入那一刻开始累积，不追溯历史。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';
import { CROP_IDS, CROPS } from '../data/crops.js';
import { MAX_LEVEL } from '../data/progression.js';
import { GUIDES } from '../data/guide.js';
import { addCoins, addExpRaw } from './player.js';
import { notify } from './notify.js';

/** 补齐后来新增的字段 */
export function ensureStats() {
  if (!state.player.cropStats) state.player.cropStats = {};
  if (!state.player.guide) state.player.guide = {};
}

/** 取某种作物的统计，没有记录时返回零值 */
export function statOf(cropId) {
  return state.player.cropStats?.[cropId] || { planted: 0, harvested: 0 };
}

/** 累加一次统计（内存操作，由调用方决定何时落盘） */
function bump(cropId, field, delta) {
  ensureStats();
  const entry = state.player.cropStats[cropId] || { planted: 0, harvested: 0 };
  entry[field] = (entry[field] || 0) + delta;
  state.player.cropStats[cropId] = entry;
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
 * @param {string} key 引导项 key
 * @returns {Promise<boolean>} 是否是新完成的引导项
 */
export async function completeGuide(key) {
  ensureStats();
  if (state.player.guide[key]) return false;

  const guide = GUIDES.find((g) => g.key === key);
  if (!guide) return false;

  state.player.guide[key] = true;
  addCoins(guide.coins);
  addExpRaw(guide.exp);

  await commit({ player: state.player });
  emit(EVENTS.CODEX);
  emit(EVENTS.PLAYER);

  notify(`🏅 ${guide.emoji} ${guide.name}　+${guide.coins} 💰 +${guide.exp} 经验`, 'gold');
  return true;
}

/** 引导进度列表 */
export function guideStates() {
  const done = state.player.guide || {};
  return GUIDES.map((g) => ({ ...g, done: Boolean(done[g.key]) }));
}

/** 引导完成数 */
export function guideProgress() {
  const done = state.player.guide || {};
  return {
    done: GUIDES.filter((g) => done[g.key]).length,
    total: GUIDES.length,
  };
}

/* ---------- 图鉴 ---------- */

/**
 * 图鉴条目列表。145 种作物全部返回，由调用方决定怎么展示未解锁的。
 * @returns {Array<{id, name, emoji, lv, stages, sell, yield, grow, harvests,
 *                 planted, harvested, lit, unlocked, unlockedPlots}>}
 */
export function codexEntries() {
  const level = state.player.level;

  return CROP_IDS.map((id) => {
    const crop = CROPS[id];
    const stat = statOf(id);
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
      /** 点亮：收获数量大于 0 */
      lit: stat.harvested > 0,
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