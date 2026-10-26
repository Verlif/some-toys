/**
 * 种子制造间领域：解锁、下锅、收取、升级。
 *
 * 四件事：**解锁**（一次性条件 + 金币）、**下锅**（扣产出与工本费、排队一炉）、
 * **收取**（到点摇种子）、**升级**（造过的作物种类数 + 金币 → 更好的概率 + 更多栏位）。
 *
 * 状态存在 `farm.workshop = { level, kinds, jobs }`：`level = 0` 表示还没解锁，
 * `kinds` 是「作物 id → 造过几次」的记账，**升级只看它的 key 有几个**。
 *
 * 为什么门槛是种类而不是次数：按次数算的时候，最便宜的小麦造一次也算一次，
 * 于是升级的最优解是拿小麦刷几百次 —— 跟经营无关，纯属磨洋工。
 * 按种类算之后，同一种作物造一百次也只算 1 种，想升级必须什么作物都造一点。
 * `kinds` 仍然记次数（UI 里显示「造过 3 次」），但**不参与升级判定**。
 *
 * 第 44 轮起制造改成**排队**：一炉要烧 `种子等级 × 10 秒`（见 data/workshop.js
 * 的 craftMs），栏位数 = 制造间等级（每升一级 +1）。任务是带绝对时间戳的
 * 普通对象，所以玩家离线期间照样在走，上线回来就能收。
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
  craftMs,
  levelRow,
  nextLevelRow,
  produceCost,
  rollSeeds,
  slotCount,
} from '../data/workshop.js';
import { notify } from './notify.js';
import { fmtSaved } from '../core/utils.js';

const ws = () => state.farm.workshop;

/** 制造任务列表（没有就补一个空数组，老档读进来也安全） */
function jobs() {
  if (!Array.isArray(ws().jobs)) ws().jobs = [];
  return ws().jobs;
}

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

/* ---------- 制造队列（第 44 轮） ---------- */

/**
 * 栏位数：每升一级 +1（Lv.1 一炉，Lv.10 十炉）。
 *
 * 栏位是并行的炉子数。做好的那几炉**仍然占着栏位**，直到玩家收走 ——
 * 否则「攒着不收」等于无限栏位，制造时间就白设了。
 */
export const craftSlots = () => slotCount(workshopLevel());

/** 排队中的全部任务（含已经做好、等着收的），按出种子时间排序 */
export function craftJobs() {
  return jobs().slice().sort((a, b) => a.doneAt - b.doneAt);
}

/** 还在烧的任务 */
export function activeJobs(now = Date.now()) {
  return craftJobs().filter((job) => job.doneAt > now);
}

/** 已经做好、等着收的任务 */
export function readyJobs(now = Date.now()) {
  return craftJobs().filter((job) => job.doneAt <= now);
}

/** 还空着几个栏位 */
export function freeSlots() {
  return Math.max(0, craftSlots() - jobs().length);
}

/** 这炉还剩多久（毫秒，做好为 0） */
export function jobLeftMs(job, now = Date.now()) {
  return Math.max(0, (job?.doneAt || 0) - now);
}

/**
 * 制造一次 —— **排队**，不是立刻出种子。
 *
 * 三道消耗同时扣：**产出份数**（半轮产量）、**工本费**（四分之一颗种子的价钱）、
 * **一炉的时间**（种子等级 × 10 秒）。扣完把任务塞进队列，等时间到了再收。
 *
 * 栏位满了就直接拦下来、**什么都不扣** —— 先收一炉再来，
 * 不然玩家会以为产出白扔了。
 *
 * @param {string} cropId 作物 id
 * @returns {Promise<?object>} 入队的任务，失败为 null
 */
export async function craft(cropId) {
  if (!isUnlocked()) {
    notify('先去「其他 → 种子制造间」开张');
    return null;
  }

  const crop = CROPS[cropId];
  if (!crop) return null;
  // 第 43 轮起限定作物也能制造（产出从藏宝图来，这里只负责复刻成种子）

  const list = jobs();
  const slots = craftSlots();
  if (list.length >= slots) {
    notify(`制造栏位满了（${list.length} / ${slots}），先收一炉再下锅`);
    return null;
  }

  // 先在**扣东西之前**把两道关卡都过一遍：扣了产出再发现金币不够，
  // 就得把它原样加回去，多一条容易漏的回滚路径
  const fee = craftFee(crop);
  if (state.farm.coins < fee) {
    notify(`工本费还差 ${fee - state.farm.coins} 金币`);
    return null;
  }

  const need = produceCost(crop);
  if (!inventory.take(produceId(cropId), need)) {
    notify(`还需要 ${need} 份${crop.emoji}${crop.name}`);
    return null;
  }

  // 工本费：四分之一颗种子的价钱。和产出一起扣，同一个事务落盘 ——
  // 中途关页面不会出现「产出没了、金币也扣了、任务却没排上」
  player.spendCoins(fee);

  const now = Date.now();
  const ms = craftMs(crop);
  const job = {
    id: `j${now.toString(36)}${list.length}`,
    cropId,
    need,
    fee,
    startAt: now,
    doneAt: now + ms,
  };
  list.push(job);

  player.addLog('⚒️', `${crop.emoji}${crop.name} ×${need} + 💰${fee} 下锅，${fmtSaved(ms)}后出种子`);
  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.INVENTORY);
  emit(EVENTS.PLAYER);
  notify(`⚒️ ${crop.emoji}${crop.name}下锅了，${fmtSaved(ms)}后好`);
  scheduleClaim();
  return job;
}

/**
 * 收取所有已经做好的炉子。
 *
 * 摇数量放在**收取那一刻**：摇完就把任务从队列里删掉，同一个事务落盘，
 * 所以不可能出现「收了两次」或「任务还在、种子又没到」。
 *
 * @param {number} [now]
 * @param {{quiet?: boolean}} [options] quiet 给世界时钟的离线补算用：
 *   不落盘、不发事件、不弹提示，补算结束由调用方统一写一次
 * @returns {Promise<number>} 收到的种子总数（没有可收的为 0）
 */
export async function claimJobs(now = Date.now(), { quiet = false } = {}) {
  const list = jobs();
  const done = list.filter((job) => job.doneAt <= now);
  if (!done.length) return 0;

  ws().jobs = list.filter((job) => job.doneAt > now);

  const kinds = ws().kinds;
  let total = 0;
  for (const job of done) {
    const crop = CROPS[job.cropId];
    if (!crop) continue;
    const got = rollSeeds(workshopLevel());
    inventory.add(seedId(job.cropId), got);
    // 记账：这一种作物 +1 次。升级只看「有几种」，不看每种造了几次
    kinds[job.cropId] = (kinds[job.cropId] || 0) + 1;
    total += got;
    player.addLog('⚒️', `${crop.emoji}${crop.name}出种子 ×${got}`);
  }

  if (quiet) {
    scheduleClaim();
    return total;
  }

  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.INVENTORY);
  emit(EVENTS.PLAYER);
  if (total > 0) {
    const label = done.length > 1 ? `收了 ${done.length} 炉` : '收了一炉';
    notify(`🌱 ${label}，种子 ×${total}`, done.length > 1 ? 'gold' : '');
  }
  scheduleClaim();
  return total;
}

/** 定时器：到点自动收取，玩家不用守着页面 */
let claimTimer = 0;

/**
 * 排下一次自动收取。
 *
 * 时间戳存在存档里，所以「下锅 → 关掉页面 → 明天回来」这条路径靠的是
 * 读档后重排一次（main.js 启动时调 resumeCraftTimers），而不是定时器本身。
 */
function scheduleClaim() {
  if (claimTimer) {
    clearTimeout(claimTimer);
    claimTimer = 0;
  }
  const list = jobs();
  if (!list.length) return;

  const next = Math.min(...list.map((job) => job.doneAt));
  const delay = Math.max(0, next - Date.now()) + 40;
  claimTimer = setTimeout(() => {
    claimTimer = 0;
    claimJobs()
      .catch((error) => console.error(error))
      .finally(() => {
        if (jobs().length) scheduleClaim();
      });
  }, delay);
}

/** 读档后调一次：把离线期间已经做好的炉子收掉，并重排定时器 */
export function resumeCraftTimers() {
  if (!jobs().length) return;
  scheduleClaim();
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
