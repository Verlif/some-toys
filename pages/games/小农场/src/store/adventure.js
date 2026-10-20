/**
 * 冒险领域：藏宝图的持有、出发、逐张选路与结算。
 *
 * 一趟冒险的状态（牌堆、走到第几张、已挖到的东西）只放在内存里，
 * 不进存档 —— 中途刷新页面这趟就废了，但**已经挖到的奖励是即时落盘的**，
 * 所以点「退出」或提前结束都不会白跑。
 *
 * 牌组与奖励池在 buildRun() 里一次生成，见 data/adventure.js。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';
import * as player from './player.js';
import * as inventory from './inventory.js';
import { MAP_TIERS, buildRun, describeReward, mapTier } from '../data/adventure.js';
import { mapId, produceId, seedId } from '../data/keys.js';
import { formatCoins } from '../core/utils.js';
import { addDogBreed, ownedBreedIds } from './dogs.js';
import { addNews } from './news.js';
import { notify } from './notify.js';

/** 当前正在进行的冒险，null 表示没在冒险 */
let run = null;

async function persist() {
  await commit({ farms: [state.farm], bag: state.bag, news: state.news });
  emit(EVENTS.PLAYER);
  emit(EVENTS.INVENTORY);
  emit(EVENTS.PETS);
}

/** 背包里还有哪些藏宝图 */
export function ownedMaps() {
  return MAP_TIERS
    .map((map) => ({ ...map, count: inventory.count(mapId(map.tier)) }))
    .filter((map) => map.count > 0);
}

/** 正在进行的冒险（只读，供 UI 渲染） */
export const currentRun = () => run;

/** 当前该翻的那张牌 */
export const currentCard = () => (run ? run.cards[run.index] || null : null);

/** 剩余步数 */
export const stepsLeft = () => (run ? run.cards.length - run.index : 0);

/** 把一份奖励真正发到玩家身上（内存操作） */
function applyReward(reward) {
  if (reward.kind === 'coin') player.addCoins(reward.n);
  else if (reward.kind === 'item') inventory.add(reward.id, reward.n);
  else if (reward.kind === 'produce') inventory.add(produceId(reward.id), reward.n);
  else if (reward.kind === 'dog') addDogBreed(reward.id);
  else inventory.add(seedId(reward.id), reward.n);
}

/**
 * 出发：消耗一张藏宝图并生成这一趟的牌堆。
 * @param {number} tier
 * @returns {Promise<?object>} 成功返回 run，没有图/已在冒险中返回 null
 */
export async function startRun(tier) {
  if (run) return null;
  const map = mapTier(tier);
  if (!map) return null;
  if (!inventory.take(mapId(tier), 1)) {
    notify('没有这张藏宝图');
    return null;
  }

  // 守护犬：低概率附带，且不会给已经收集过的品种
  run = buildRun(tier, { dog: { owned: ownedBreedIds() } });
  player.addLog('🗺️', `用掉 ${map.name}，进入寻宝`);
  await persist();
  return run;
}

/**
 * 选一条路。
 *
 * @param {'left'|'right'} side
 * @returns {Promise<?{reward: ?object, rewardSide: string, done: boolean, remaining: number}>}
 */
export async function choose(side) {
  if (!run) return null;
  const card = run.cards[run.index];
  if (!card) return null;

  const got = card.reward && card.rewardSide === side ? card.reward : null;
  run.index += 1;

  if (got) {
    run.earned.push(got);
    applyReward(got);
    player.addLog('🗺️', `寻宝挖到 ${describeReward(got)}`);
    await persist();
  }

  return {
    reward: got,
    rewardSide: card.rewardSide,
    done: run.index >= run.cards.length,
    remaining: run.cards.length - run.index,
  };
}

/**
 * 结束这一趟（走完或被玩家提前退出）。
 * 已挖到的奖励早就落盘了，这里只补一条总结日志。
 * @returns {Promise<?{tier: number, earned: object[], totalRewards: number, value: number}>}
 */
export async function finishRun() {
  if (!run) return null;

  const earned = run.earned.slice();
  const value = earned.reduce((sum, r) => sum + r.value, 0);
  const summary = { tier: run.tier, earned, totalRewards: run.totalRewards, value };

  player.addLog('🏁', earned.length
    ? `寻宝结束，带回 ${earned.length} 份奖励（约值 ${value} 💰）`
    : '寻宝结束，两手空空地回来了');

  // 大赚要上电视：跑一趟拿回的价值超过图价两倍才算「大奖」
  const map = MAP_TIERS.find((m) => m.tier === run.tier);
  if (map && value > map.price * 2) {
    addNews('💰', `你在${map.name}里挖到大奖，带回约 ${formatCoins(value)} 的奖励`);
  }

  run = null;
  await persist();
  return summary;
}
