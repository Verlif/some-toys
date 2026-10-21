/**
 * 种子制造间领域：解锁、制造、升级。
 *
 * 三件事：**解锁**（一次性条件 + 金币）、**制造**（吃产出换种子）、
 * **升级**（累计制造次数 + 金币 → 更好的概率）。
 *
 * 状态存在 `farm.workshop = { level, uses }`：`level = 0` 表示还没解锁，
 * `uses` 是累计制造次数，升级只看它，不看当前等级 —— 所以不会因为
 * 「攒着不升级」而丢进度。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';
import * as inventory from './inventory.js';
import * as player from './player.js';
import { CROPS, CROP_IDS } from '../data/crops.js';
import { produceId, seedId } from '../data/keys.js';
import {
  WORKSHOP_MAX_LEVEL,
  WORKSHOP_UNLOCK,
  levelRow,
  nextLevelRow,
  produceCost,
  rollSeeds,
} from '../data/workshop.js';
import { notify } from './notify.js';

const ws = () => state.farm.workshop;

/* ---------- 查询 ---------- */

/** 制造间等级，0 = 未解锁 */
export const workshopLevel = () => ws().level || 0;

/** 累计制造次数 */
export const workshopUses = () => ws().uses || 0;

/** 是否已解锁 */
export const isUnlocked = () => workshopLevel() > 0;

/** 当前等级的概率与期望（给 UI 用） */
export const currentOdds = () => levelRow(workshopLevel());

/**
 * 解锁条件还差什么。
 * @returns {{ok: boolean, lackLevel: number, lackCoins: number}}
 */
export function unlockState() {
  return {
    ok: state.farm.level >= WORKSHOP_UNLOCK.level && state.farm.coins >= WORKSHOP_UNLOCK.cost,
    lackLevel: Math.max(0, WORKSHOP_UNLOCK.level - state.farm.level),
    lackCoins: Math.max(0, WORKSHOP_UNLOCK.cost - state.farm.coins),
  };
}

/**
 * 升级还差什么。满级时 `maxed = true`。
 * @returns {{maxed: boolean, next: ?object, usesOk: boolean, coinsOk: boolean, ok: boolean}}
 */
export function upgradeState() {
  const level = workshopLevel();
  const next = nextLevelRow(level);
  if (!next) return { maxed: true, next: null, usesOk: false, coinsOk: false, ok: false };
  const usesOk = workshopUses() >= next.uses;
  const coinsOk = state.farm.coins >= next.cost;
  return { maxed: false, next, usesOk, coinsOk, ok: usesOk && coinsOk };
}

/**
 * 仓库里**现在就能造**的作物：`{ id, crop, have, need }`，按作物等级从低到高。
 *
 * 差几个的走 UI 的「再攒一点就能造」，不混进这张单子 ——
 * 否则标题上的「可以制造（3 种）」会把造不了的也算进去。
 */
export function craftables() {
  const out = [];
  for (const id of CROP_IDS) {
    const crop = CROPS[id];
    // 限定作物只能靠藏宝图挖，不能在这里复刻，否则它的稀缺性就没了
    if (!crop || crop.special) continue;
    const need = produceCost(crop);
    const have = inventory.count(produceId(id));
    if (have < need) continue;
    out.push({ id, crop, have, need });
  }
  return out;
}

/* ---------- 解锁 ---------- */

/**
 * 开张。
 * @returns {Promise<boolean>}
 */
export async function unlock() {
  if (isUnlocked()) return false;
  const st = unlockState();
  if (!st.ok) {
    notify(st.lackLevel
      ? `需要 Lv.${WORKSHOP_UNLOCK.level} 才能解锁`
      : `还差 ${st.lackCoins} 金币`);
    return false;
  }

  player.spendCoins(WORKSHOP_UNLOCK.cost);
  ws().level = 1;
  player.addLog('⚒️', `解锁了种子制造间（${WORKSHOP_UNLOCK.cost} 金币）`);
  await commit({ farms: [state.farm] });
  emit(EVENTS.PLAYER);
  notify('⚒️ 种子制造间开张了，去仓库挑点产出吧');
  return true;
}

/* ---------- 制造 ---------- */

/**
 * 制造一次。
 *
 * 先扣产出、再摇数量，两个动作在同一个事务里落盘 ——
 * 中途关页面不会出现「产出没了、种子也没到」。
 *
 * @param {string} cropId 作物 id
 * @returns {Promise<number>} 得到的种子数，失败为 0
 */
export async function craft(cropId) {
  if (!isUnlocked()) {
    notify('先去「其他 → 种子制造间」开张');
    return 0;
  }

  const crop = CROPS[cropId];
  if (!crop || crop.special) return 0;

  const need = produceCost(crop);
  if (!inventory.take(produceId(cropId), need)) {
    notify(`还需要 ${need} 份${crop.emoji}${crop.name}`);
    return 0;
  }

  const got = rollSeeds(workshopLevel());
  inventory.add(seedId(cropId), got);
  ws().uses = workshopUses() + 1;

  player.addLog('⚒️', `${crop.emoji}${crop.name} ×${need} → 种子 ×${got}`);
  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.INVENTORY);
  emit(EVENTS.PLAYER);
  notify(`🌱 ${crop.emoji}${crop.name}种子 ×${got}`, got > 1 ? 'gold' : '');
  return got;
}

/* ---------- 升级 ---------- */

/**
 * 升一级。
 * @returns {Promise<boolean>}
 */
export async function upgrade() {
  const st = upgradeState();
  if (st.maxed) {
    notify(`已经满级（Lv.${WORKSHOP_MAX_LEVEL}）`);
    return false;
  }
  if (!st.usesOk) {
    notify(`还差 ${st.next.uses - workshopUses()} 次制造才能升级`);
    return false;
  }
  if (!st.coinsOk) {
    notify(`还差 ${st.next.cost - state.farm.coins} 金币`);
    return false;
  }

  player.spendCoins(st.next.cost);
  ws().level = st.next.level;
  player.addLog('⚒️', `种子制造间升到 Lv.${st.next.level}`);
  await commit({ farms: [state.farm] });
  emit(EVENTS.PLAYER);
  notify(`⚒️ 种子制造间升到 Lv.${st.next.level}`, 'gold');
  return true;
}
