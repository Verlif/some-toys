/**
 * 社交领域：邻居农场（拜访 / 偷菜 / 帮忙照料）与守护犬。
 *
 * 邻居的成长不在这里算，而是交给 npc-sim.js：玩家每次进入邻居页时，
 * 先跑一次 createSettler() 把离线期间的成长补算完，再展示最新状态。
 * 被偷过的地块用 stolenAt 时间戳标记，时间到了自然恢复，
 * 因此不需要任何后台定时器。
 *
 * 帮忙照料没有「一键打理」：玩家必须在**具体那块地**上点浇水或捉虫，
 * 才能拿到经验。这样邻居的农场才需要一块一块地看，而不是点一下就完事。
 */
import { commit, saveFriend } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state, getFriend } from './state.js';
import * as player from './player.js';
import * as inventory from './inventory.js';
import { estimateWork, npcPresence, simulateNpc } from './npc-sim.js';
import { completeGuide } from './codex.js';
import { CROPS } from '../data/crops.js';
import { produceId } from '../data/keys.js';
import {
  BOOST_CAP,
  DOG_CATCH_CHANCE,
  DOG_GUARD_DURATION,
  PEST_INTERVAL,
  PEST_YIELD_BONUS,
  STEAL_MIN_REMAIN_RATIO,
  WATER_INTERVAL,
} from '../data/friends.js';
import { notify } from './notify.js';

/* ---------- 邻居状态查询 ---------- */

/**
 * 这块地本轮原本能产多少个（不考虑偷菜与虫子）
 */
export function baseYield(plot) {
  if (!plot.cropId) return 0;
  const crop = CROPS[plot.cropId];
  return Math.round(crop.yield[1] * (1 + (plot.boost || 0)));
}

/**
 * 这块地当前还剩多少产量（已被偷走的要扣掉）
 */
export function remainYield(plot) {
  return Math.max(0, baseYield(plot) - (plot.stolenCount || 0));
}

/**
 * 某块邻居的地当前是否可偷。
 *
 * 两条限制：
 *   1. 每块地的每轮作物，玩家最多偷 1 次（作物重新种下后刷新标记）；
 *   2. 剩余产量不足原版一半时就不再可偷。
 */
export function isStealable(plot, now = Date.now()) {
  if (!plot.cropId || now < plot.readyAt) return false;
  if (plot.stolen) return false;
  const base = baseYield(plot);
  if (base <= 0) return false;
  return remainYield(plot) > base * STEAL_MIN_REMAIN_RATIO;
}

/** 邻居当前有几块可偷的成熟地 */
export function stealableCount(friend, now = Date.now()) {
  return friend.plots.filter((p) => isStealable(p, now)).length;
}

/** 邻居的地是否缺水 */
export const needsWater = (plot, now = Date.now()) =>
  Boolean(plot.cropId) && now >= (plot.waterAt || 0);

/** 邻居的地是否生虫 */
export const needsPest = (plot, now = Date.now()) =>
  Boolean(plot.cropId) && now >= (plot.pestAt || 0);

/** 邻居有几块地需要照料（缺水或生虫） */
export const careCount = (friend, now = Date.now()) =>
  friend.plots.filter((p) => needsWater(p, now) || needsPest(p, now)).length;

/** 邻居有没有需要帮忙照料的地 */
export const needsHelp = (friend, now = Date.now()) => careCount(friend, now) > 0;

/** 在线 / 待机状态 */
export const presenceOf = (friend, now) => npcPresence(friend, now);

/* ---------- 离线结算 ---------- */

/**
 * 创建一个结算器，把所有邻居从上次结算点推进到「现在」。
 *
 * 返回的对象由调用方分帧驱动（UI 层会配一个等待画面），
 * 这样即使离线很久也不会把主线程卡死。
 *
 * @returns {{total: number, done: number, finished: boolean, run: (budgetMs?: number) => boolean}}
 */
export function createSettler() {
  const npcs = state.friends;
  const now = Date.now();
  const total = estimateWork(npcs, now);

  let index = 0;
  let done = 0;

  return {
    total,
    get done() { return done; },
    get finished() { return index >= npcs.length; },

    /**
     * 在给定的时间预算内结算一批会话
     * @param {number} [budgetMs] 单帧预算，默认 12ms
     * @returns {boolean} 是否已全部结算完
     */
    run(budgetMs = 12) {
      const until = performance.now() + budgetMs;
      while (index < npcs.length && performance.now() < until) {
        done += simulateNpc(npcs[index], npcs, now);
        index += 1;
      }
      return index >= npcs.length;
    },
  };
}

/** 把结算结果落盘 */
export async function persistFriends() {
  await Promise.all(state.friends.map(saveFriend));
  emit(EVENTS.FRIENDS);
}

/* ---------- 玩家与邻居互动 ---------- */

/**
 * 偷一块成熟的作物。
 *
 * 偷菜**不给经验** —— 经验只来自自己的收获和照料邻居，
 * 否则「到处偷」就变成了最优解。
 *
 * @returns {Promise<{ok: boolean, reason?: string, cropId?: string}>}
 */
export async function steal(friendId, index) {
  const friend = getFriend(friendId);
  const target = friend?.plots[index];
  const now = Date.now();

  if (!friend || !target || !isStealable(target, now)) {
    return { ok: false, reason: '这块地现在不能偷' };
  }

  if (isDogGuarding() && Math.random() < DOG_CATCH_CHANCE) {
    notify('🐕 被守护犬发现了！偷菜失败');
    return { ok: false, reason: '被守护犬抓住了' };
  }

  // 标记：这块地这轮只能被偷一次，且邻居之后的收获要减半
  target.stolen = true;
  target.stolenCount = (target.stolenCount || 0) + 1;
  target.stolenAt = now;

  const crop = CROPS[target.cropId];
  inventory.add(produceId(target.cropId), 1);

  await commit({ player: state.player }, { bag: state.bag, friends: [friend] });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.INVENTORY);
  emit(EVENTS.PLAYER);

  notify(`偷到 ${crop.emoji}${crop.name} ×1（这块地这轮只能偷一次）`, 'gold');
  return { ok: true, cropId: target.cropId };
}

/**
 * 帮邻居的地浇水。只能对**具体那块地**操作。
 * @returns {Promise<boolean>} 是否操作成功
 */
export async function waterNeighborPlot(friendId, index) {
  const friend = getFriend(friendId);
  const target = friend?.plots[index];
  const now = Date.now();

  if (!friend || !target || !target.cropId) return false;
  if (!needsWater(target, now)) {
    notify('这块地还不缺水');
    return false;
  }

  target.waterAt = now + WATER_INTERVAL;
  // 经验跟着被照料的作物走：作物几级就给几点，不随玩家等级膨胀
  const exp = CROPS[target.cropId].lv;
  player.addExpRaw(exp);

  await commit({ player: state.player }, { friends: [friend] });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.PLAYER);

  await completeGuide('care');
  notify(`💧 帮 ${friend.name} 浇了水（经验 +${exp}）`);
  return true;
}

/**
 * 帮邻居的地捉虫。每次让那块地的产量 +10%。
 * @returns {Promise<boolean>} 是否操作成功
 */
export async function catchPestNeighborPlot(friendId, index) {
  const friend = getFriend(friendId);
  const target = friend?.plots[index];
  const now = Date.now();

  if (!friend || !target || !target.cropId) return false;
  if (!needsPest(target, now)) {
    notify('这块地没有虫子');
    return false;
  }

  target.boost = Math.min(BOOST_CAP, (target.boost || 0) + PEST_YIELD_BONUS);
  target.pestAt = now + PEST_INTERVAL;
  const exp = CROPS[target.cropId].lv;
  player.addExpRaw(exp);

  await commit({ player: state.player }, { friends: [friend] });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.PLAYER);

  await completeGuide('care');
  notify(`🐛 帮 ${friend.name} 捉了虫（经验 +${exp}）`);
  return true;
}

/* ---------- 守护犬 ---------- */

/** 守护犬是否在守护中 */
export function isDogGuarding() {
  return state.pet.fedUntil > Date.now();
}

/** 守护剩余毫秒数 */
export function guardRemainMs() {
  return Math.max(0, state.pet.fedUntil - Date.now());
}

/**
 * 喂狗：消耗 1 份狗粮，守护 30 分钟
 * @returns {Promise<boolean>}
 */
export async function feedDog() {
  if (!inventory.take('dogFood', 1)) {
    notify('没有狗粮，去商店买吧');
    return false;
  }

  state.pet.fedUntil = Date.now() + DOG_GUARD_DURATION;
  await commit({}, { bag: state.bag, pet: state.pet });
  emit(EVENTS.PETS);
  emit(EVENTS.INVENTORY);

  await completeGuide('feed');
  notify('🐕 守护犬吃饱了，守护农场 30 分钟', 'gold');
  return true;
}
