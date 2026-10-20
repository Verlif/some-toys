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
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state, getFriend } from './state.js';
import * as player from './player.js';
import * as inventory from './inventory.js';
import { estimateWork, simulateNpc } from './npc-sim.js';
import { completeGuide } from './codex.js';
import { CROPS } from '../data/crops.js';
import { produceId } from '../data/keys.js';
import {
  BOOST_CAP,
  DOG_FOOD_SATIETY,
  DOG_SATIETY_DECAY,
  DOG_SATIETY_MAX,
  LOG_LIMIT,
  PEST_INTERVAL,
  PEST_YIELD_BONUS,
  WATER_INTERVAL,
  dogCatchChance,
  npcDogSatietyAt,
} from '../data/friends.js';
import { PESTICIDE_ID, SPRINKLER_ID } from '../data/items.js';
import { notify } from './notify.js';
import { addNews } from './news.js';

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
 * 两道限制：
 *   1. 每块地的每轮作物最多被偷 1 个；
 *   2. 被对方的守护犬逮住过一次，整座农场这一轮都不能再偷（guarded）。
 */
export function isStealable(plot, now = Date.now()) {
  if (!plot.cropId || now < plot.readyAt) return false;
  if (plot.stolen || plot.guarded) return false;
  return remainYield(plot) >= 1;
}

/** 邻居当前有几块可偷的成熟地 */
export function stealableCount(friend, now = Date.now()) {
  return friend.plots.filter((p) => isStealable(p, now)).length;
}

/** 邻居的地是否缺水（成熟后就不再需要照料） */
export const needsWater = (plot, now = Date.now()) =>
  Boolean(plot.cropId) && now < plot.readyAt && now >= (plot.waterAt || 0);

/** 邻居的地是否生虫（同上） */
export const needsPest = (plot, now = Date.now()) =>
  Boolean(plot.cropId) && now < plot.readyAt && now >= (plot.pestAt || 0);

/** 邻居有几块地需要照料（缺水或生虫） */
export const careCount = (friend, now = Date.now()) =>
  friend.plots.filter((p) => needsWater(p, now) || needsPest(p, now)).length;

/** 邻居有没有需要帮忙照料的地 */
export const needsHelp = (friend, now = Date.now()) => careCount(friend, now) > 0;

/* ---------- 离线结算 ---------- */

/**
 * 创建一个结算器，把所有邻居从上次结算点推进到「现在」。
 *
 * 返回的对象由调用方分帧驱动（UI 层会配一个等待画面），
 * 这样即使离线很久也不会把主线程卡死。
 *
 * @returns {{total: number, done: number, finished: boolean, summary: {stolen: number, cared: number}, run: (budgetMs?: number) => boolean}}
 */
export function createSettler() {
  const npcs = state.friends;
  const now = Date.now();
  const total = estimateWork(npcs, now);

  /**
   * 交给模拟层的「玩家农场」视图：邻居会顺手偷一块成熟地、
   * 或帮一块缺水/生虫的地浇浇捉捉，改动直接落在 state.plots 上。
   * 用回调写日志，npc-sim 依然不需要认识 store。
   *
   * dogSatietyAt(t) 让模拟能还原「那一刻」的饱腹度：
   * 结算几天的离线时，狗不是一直满饱腹，而是随时间一路掉下去的。
   */
  const satietyNow = dogSatiety();
  const farm = {
    plots: state.plots,
    stolen: 0,
    cared: 0,
    caught: 0,
    log: (at, emoji, text) => player.addLog(emoji, text, at),
    news: (at, emoji, text) => addNews(emoji, text, at),
    dogSatietyAt: (at) => Math.max(
      0,
      satietyNow - ((at - now) / 3600_000) * DOG_SATIETY_DECAY,
    ),
  };

  let index = 0;
  let done = 0;

  return {
    total,
    get done() { return done; },
    get finished() { return index >= npcs.length; },
    /** 这段时间邻居在玩家农场上做了多少事，用于结算后的汇总提示 */
    get summary() { return { stolen: farm.stolen, cared: farm.cared, caught: farm.caught }; },

    /**
     * 在给定的时间预算内结算一批会话
     * @param {number} [budgetMs] 单帧预算，默认 12ms
     * @returns {boolean} 是否已全部结算完
     */
    run(budgetMs = 12) {
      const until = performance.now() + budgetMs;
      while (index < npcs.length && performance.now() < until) {
        done += simulateNpc(npcs[index], npcs, now, farm);
        index += 1;
      }
      return index >= npcs.length;
    },
  };
}

/**
 * 把结算结果落盘。
 *
 * 邻居结算也会动玩家的地块（被顺走 / 被照料）和日志，
 * 所以这里要连 plots + player 一起提交，不能只写 friends。
 */
export async function persistFriends() {
  await commit({ player: state.player }, { plots: state.plots, friends: state.friends });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.FARM);
  emit(EVENTS.PLAYER);
}

/** 往邻居的农场日志里写一条（玩家的操作也记进对方那边） */
function logFriend(friend, at, emoji, text) {
  friend.log ??= [];
  friend.log.unshift({ at, emoji, text });
  if (friend.log.length > LOG_LIMIT) friend.log.length = LOG_LIMIT;
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

  // 邻居的狗也在看家：饱腹度越高，被当场逮住的概率越大。
  // 一旦被逮住，这座农场**当前所有作物**这一轮都进不去了 ——
  // 和「每块地已被偷过」是同一个效果，只是原因不同。
  const satiety = npcDogSatietyAt(friend, now);
  if (satiety > 0 && Math.random() < dogCatchChance(satiety)) {
    for (const plot of friend.plots) {
      if (plot.cropId) plot.guarded = true;
    }
    logFriend(friend, now, '🐕', '守护犬抓住了想偷菜的 农场主，这座农场这一轮都进不去了');
    addNews('🐕', `${friend.name} 的守护犬抓住了前来偷菜的农场主`);

    await commit({ player: state.player }, { friends: [friend] });
    emit(EVENTS.FRIENDS);
    emit(EVENTS.PLAYER);

    notify(`🐕 被 ${friend.name} 家的守护犬抓住了！这一轮他家的作物都不敢碰了`, 'gold');
    return { ok: false, caught: true, reason: '被守护犬抓住了' };
  }

  // 标记：这块地这轮只能被偷一次，邻居之后的收获少 1 个
  target.stolen = true;
  target.stolenCount = (target.stolenCount || 0) + 1;
  target.stolenAt = now;

  const crop = CROPS[target.cropId];
  inventory.add(produceId(target.cropId), 1);
  logFriend(friend, now, '🥷', `被 农场主 顺走了 ${crop.emoji}${crop.name} ×1`);

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
  logFriend(friend, now, '💧', '农场主 来帮忙浇了水');

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
  logFriend(friend, now, '🐛', '农场主 来帮忙捉了虫');

  await commit({ player: state.player }, { friends: [friend] });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.PLAYER);

  await completeGuide('care');
  notify(`🐛 帮 ${friend.name} 捉了虫（经验 +${exp}）`);
  return true;
}

/**
 * 一键帮邻居浇水：消耗 1 个洒水器，把他家所有缺水的地一次浇完。
 * 单块效果与手动浇水一致（waterAt 推到下一个 6 小时），经验按作物等级给。
 * @returns {Promise<boolean>}
 */
export async function waterAllNeighborPlots(friendId) {
  const friend = getFriend(friendId);
  const now = Date.now();
  if (!friend) return false;

  const targets = friend.plots.filter((p) => needsWater(p, now));
  if (!targets.length) {
    notify('他家的地现在都不缺水');
    return false;
  }
  if (!inventory.has(SPRINKLER_ID)) {
    notify('没有洒水器了，去商店买一个吧');
    return false;
  }
  inventory.take(SPRINKLER_ID, 1);

  let exp = 0;
  for (const plot of targets) {
    plot.waterAt = now + WATER_INTERVAL;
    exp += CROPS[plot.cropId].lv;
  }

  player.addExpRaw(exp);
  logFriend(friend, now, '🚿', `农场主 用洒水器帮他给 ${targets.length} 块地浇了水`);

  await commit({ player: state.player }, { bag: state.bag, friends: [friend] });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.PLAYER);
  emit(EVENTS.INVENTORY);

  await completeGuide('care');
  notify(`🚿 帮 ${friend.name} 浇了 ${targets.length} 块地（经验 +${exp}）`, 'gold');
  return true;
}

/**
 * 一键帮邻居杀虫：消耗 1 个杀虫剂，把他家所有生虫的地一次捉完。
 * 每块地产量 +10%，经验按作物等级给。
 * @returns {Promise<boolean>}
 */
export async function catchPestAllNeighborPlots(friendId) {
  const friend = getFriend(friendId);
  const now = Date.now();
  if (!friend) return false;

  const targets = friend.plots.filter((p) => needsPest(p, now));
  if (!targets.length) {
    notify('他家的地现在都没有虫子');
    return false;
  }
  if (!inventory.has(PESTICIDE_ID)) {
    notify('没有杀虫剂了，去商店买一个吧');
    return false;
  }
  inventory.take(PESTICIDE_ID, 1);

  let exp = 0;
  for (const plot of targets) {
    plot.boost = Math.min(BOOST_CAP, (plot.boost || 0) + PEST_YIELD_BONUS);
    plot.pestAt = now + PEST_INTERVAL;
    exp += CROPS[plot.cropId].lv;
  }

  player.addExpRaw(exp);
  logFriend(friend, now, '🧴', `农场主 用杀虫剂帮他给 ${targets.length} 块地除了虫`);

  await commit({ player: state.player }, { bag: state.bag, friends: [friend] });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.PLAYER);
  emit(EVENTS.INVENTORY);

  await completeGuide('care');
  notify(`🧴 帮 ${friend.name} 除了 ${targets.length} 块地的虫（经验 +${exp}）`, 'gold');
  return true;
}

/* ---------- 守护犬 ---------- */

/**
 * 当前饱腹度（0~100）。
 *
 * 存档里只存「上次结算时的饱腹度 + 那个时刻」，这里按经过的小时数现算。
 * 好处是不需要任何后台定时器：页面关十天再打开，一读就是掉光的 0。
 */
export function dogSatiety(now = Date.now()) {
  const satiety = Math.max(0, state.pet.satiety || 0);
  const hours = Math.max(0, (now - (state.pet.updatedAt || 0)) / 3600_000);
  return Math.max(0, Math.min(DOG_SATIETY_MAX, satiety - hours * DOG_SATIETY_DECAY));
}

/** 守护犬是否还在守护（有饱腹度就在岗） */
export function isDogGuarding(now = Date.now()) {
  return dogSatiety(now) > 0.5;
}

/** 还能守护多久（毫秒） */
export function guardRemainMs(now = Date.now()) {
  return Math.round((dogSatiety(now) / DOG_SATIETY_DECAY) * 3600_000);
}

/**
 * 喂狗：消耗 1 份狗粮，饱腹度 +45
 * @returns {Promise<boolean>}
 */
export async function feedDog() {
  if (dogSatiety() >= DOG_SATIETY_MAX - 1) {
    notify('🐕 它已经吃得饱饱的了');
    return false;
  }
  if (!inventory.take('dogFood', 1)) {
    notify('没有狗粮，去商店买吧');
    return false;
  }

  const now = Date.now();
  // 先把「到此刻为止」的饱腹度结算掉，再往上加，避免叠加时把过期的时间也算进去
  const next = Math.min(DOG_SATIETY_MAX, dogSatiety(now) + DOG_FOOD_SATIETY);
  state.pet.satiety = next;
  state.pet.updatedAt = now;

  player.addLog('🦴', `喂了守护犬，饱腹度 ${Math.round(next)}%（约能守 ${Math.round(next / DOG_SATIETY_DECAY)} 小时）`);
  // pet 必须放在第一个参数里：commit() 只认 singles.pet，
  // 放进 collections 会被静默忽略，饱腹度就永远存不下来
  await commit({ player: state.player, pet: state.pet }, { bag: state.bag });
  emit(EVENTS.PETS);
  emit(EVENTS.INVENTORY);

  await completeGuide('feed');
  notify(`🐕 守护犬吃饱了，饱腹度 ${Math.round(next)}%`, 'gold');
  return true;
}
