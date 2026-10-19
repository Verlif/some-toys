/**
 * 社交领域：邻居农场（拜访 / 偷菜 / 帮忙）与守护犬。
 *
 * 邻居的成长不在这里算，而是交给 npc-sim.js：玩家每次进入邻居页时，
 * 先跑一次 settle() 把离线期间的成长补算完，再展示最新状态。
 * 被偷过的地块用 stolenAt 时间戳标记，时间到了自然恢复，
 * 因此不需要任何后台定时器。
 */
import { commit, saveFriend } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state, getFriend } from './state.js';
import * as player from './player.js';
import * as inventory from './inventory.js';
import { estimateWork, npcPresence, simulateNpc } from './npc-sim.js';
import { CROPS } from '../data/crops.js';
import { produceId } from '../data/keys.js';
import {
  DOG_CATCH_CHANCE,
  DOG_GUARD_DURATION,
  HELP_EXP,
  STEAL_COOLDOWN,
  STEAL_EXP,
} from '../data/friends.js';
import { completeGuide } from './codex.js';
import { notify } from './notify.js';

/* ---------- 邻居状态查询 ---------- */

/** 某块邻居的地当前是否可偷 */
export function isStealable(plot, now = Date.now()) {
  if (!plot.cropId || now < plot.readyAt) return false;
  return !plot.stolenAt || now - plot.stolenAt > STEAL_COOLDOWN;
}

/** 邻居当前有几块可偷的成熟地 */
export function stealableCount(friend, now = Date.now()) {
  return friend.plots.filter((p) => isStealable(p, now)).length;
}

/** 邻居有没有需要帮忙打理的地 */
export function needsHelp(friend) {
  return friend.plots.some((p) => p.cropId);
}

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
 * 偷一块成熟的作物
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

  target.stolenAt = now;
  const crop = CROPS[target.cropId];
  inventory.add(produceId(target.cropId), 1);
  player.addExpRaw(STEAL_EXP);

  await commit({ player: state.player }, { bag: state.bag, friends: [friend] });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.INVENTORY);
  emit(EVENTS.PLAYER);

  await completeGuide('steal');
  notify(`偷到 ${crop.emoji}${crop.name} ×1（经验 +${STEAL_EXP}）`, 'gold');
  return { ok: true, cropId: target.cropId };
}

/**
 * 帮忙打理邻居农场，换经验
 * @returns {Promise<boolean>} 是否真的帮上了忙
 */
export async function helpTend(friendId) {
  const friend = getFriend(friendId);
  if (!friend) return false;

  if (!needsHelp(friend)) {
    notify('这位邻居的农场暂时不需要帮忙');
    return false;
  }

  player.addExpRaw(HELP_EXP);
  await commit({ player: state.player });
  emit(EVENTS.PLAYER);

  notify(`🤝 帮邻居打理了农场（经验 +${HELP_EXP}）`);
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