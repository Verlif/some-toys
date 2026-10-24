/**
 * 种子制造间领域：解锁、制造、升级。
 *
 * 三件事：**解锁**（一次性条件 + 金币）、**制造**（吃产出换种子）、
 * **升级**（造过的作物种类数 + 金币 → 更好的概率）。
 *
 * 状态存在 `farm.workshop = { level, kinds }`：`level = 0` 表示还没解锁，
 * `kinds` 是「作物 id → 造过几次」的记账，**升级只看它的 key 有几个**。
 *
 * 为什么门槛是种类而不是次数：按次数算的时候，最便宜的小麦造一次也算一次，
 * 于是升级的最优解是拿小麦刷几百次 —— 跟经营无关，纯属磨洋工。
 * 按种类算之后，同一种作物造一百次也只算 1 种，想升级必须什么作物都造一点。
 * `kinds` 仍然记次数（UI 里显示「造过 3 次」），但**不参与升级判定**。
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
  craftFee,
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

/** 造过的作物种类数（升级门槛看这个） */
export const workshopKinds = () => Object.keys(ws().kinds || {}).length;

/** 某一种作物造过几次 */
export const kindTimes = (cropId) => ws().kinds?.[cropId] || 0;

/** 这种作物造过没有（列表里给个「已造过」标记） */
export const kindDone = (cropId) => kindTimes(cropId) > 0;

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
 * @returns {{maxed: boolean, next: ?object, kinds: number, kindsOk: boolean, coinsOk: boolean, ok: boolean}}
 */
export function upgradeState() {
  const level = workshopLevel();
  const next = nextLevelRow(level);
  const kinds = workshopKinds();
  if (!next) return { maxed: true, next: null, kinds, kindsOk: false, coinsOk: false, ok: false };
  const kindsOk = kinds >= next.kinds;
  const coinsOk = state.farm.coins >= next.cost;
  return { maxed: false, next, kinds, kindsOk, coinsOk, ok: kindsOk && coinsOk };
}

/**
 * 仓库里**份数够了**的作物：`{ id, crop, have, need, fee, coinsOk }`，按作物等级从低到高。
 *
 * 差几个的走 UI 的「再攒一点就能造」，不混进这张单子 ——
 * 否则标题上的「可以制造（3 种）」会把造不了的也算进去。
 *
 * 金币不够的**仍然列出来**（`coinsOk: false`），只是按钮灰掉：
 * 玩家得看得见「差 12 金币」，而不是整行凭空消失。
 *
 * 第 43 轮起**限定作物也能造**（同样的份数与工本费逻辑）——
 * 挖宝挖多了的限定产出终于有变现以外的出路。
 */
export function craftables() {
  const out = [];
  for (const id of CROP_IDS) {
    const crop = CROPS[id];
    if (!crop) continue;
    const need = produceCost(crop);
    const have = inventory.count(produceId(id));
    if (have < need) continue;
    const fee = craftFee(crop);
    out.push({ id, crop, have, need, fee, coinsOk: state.farm.coins >= fee });
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
 * 两道消耗：**产出份数**（半轮产量）+ **工本费**（四分之一颗种子的价钱）。
 * 都先扣、再摇数量，所有改动在同一个事务里落盘 ——
 * 中途关页面不会出现「产出没了、金币扣了、种子却没到」。
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
  if (!crop) return 0;
  // 第 43 轮起限定作物也能制造（产出从藏宝图来，这里只负责复刻成种子）

  // 先在**扣东西之前**把两道关卡都过一遍：扣了产出再发现金币不够，
  // 就得把它原样加回去，多一条容易漏的回滚路径
  const fee = craftFee(crop);
  if (state.farm.coins < fee) {
    notify(`工本费还差 ${fee - state.farm.coins} 金币`);
    return 0;
  }

  const need = produceCost(crop);
  if (!inventory.take(produceId(cropId), need)) {
    notify(`还需要 ${need} 份${crop.emoji}${crop.name}`);
    return 0;
  }

  // 工本费：半颗种子的价钱。和产出一起扣，同一个事务落盘 ——
  // 中途关页面不会出现「产出没了、金币也扣了、种子却没到」
  player.spendCoins(fee);

  const got = rollSeeds(workshopLevel());
  inventory.add(seedId(cropId), got);
  // 记账：这一种作物 +1 次。升级只看「有几种」，不看每种造了几次
  const kinds = ws().kinds;
  kinds[cropId] = (kinds[cropId] || 0) + 1;

  player.addLog('⚒️', `${crop.emoji}${crop.name} ×${need} + 💰${fee} → 种子 ×${got}`);
  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.INVENTORY);
  emit(EVENTS.PLAYER);
  notify(`🌱 ${crop.emoji}${crop.name}种子 ×${got}（工本费 -${fee} 💰）`, got > 1 ? 'gold' : '');
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
  if (!st.kindsOk) {
    notify(`还差 ${st.next.kinds - st.kinds} 种作物（每种都要造一次）`);
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
