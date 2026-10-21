/**
 * 全局状态：整个游戏只有这一份内存状态。
 *
 * 对象结构与存档结构一一对应：
 *   state.farm     玩家农场（farm 表里 kind='player' 的那一行）
 *   state.friends  邻居农场（同一张表里 kind='npc' 的行）
 *   state.news     全镇时报
 *
 * 每座农场都自带 plots / log —— 它们其实来自 plot / log 两张子表，
 * 读档时按 farmId 挂回农场，写档时再拆回去（见 core/storage.js）。
 * 这样 store 与 ui 都能像操作一个完整对象那样操作一座农场，
 * 而库里不会有任何一条记录被日志撑爆。
 *
 * 规则：
 * - 只有 store/ 下的领域模块可以改它，ui/ 只读；
 * - 任何改动都必须落到 IndexedDB，再由事件总线通知 UI 重渲染；
 * - 这里不包含任何 DOM 操作。
 */
import { commit, dropFarms, loadSave } from '../core/storage.js';
import { INITIAL_COINS, MAX_LEVEL, TOTAL_PLOTS } from '../data/progression.js';
import { SIGN_KEEP_DAYS } from '../data/signin.js';
import {
  NPCS,
  PERSONALITIES,
  STEAL_CHANCE,
  emptyNpcPlot,
  generateNpcPlots,
  nextVisitAt,
  npcStartCoins,
  rollNpcLevel,
  rollNpcSoil,
  syncNpcPlots,
} from '../data/friends.js';
import { CROPS } from '../data/crops.js';
import { SOILS } from '../data/soils.js';
import {
  BREED_MIGRATION,
  FIRST_DOG_ID,
  LEGACY_BREED_MAP,
  dogBreed,
  rollNpcDogBreed,
  rollNpcDogSatiety,
} from '../data/dogs.js';
import { WORKSHOP_MAX_LEVEL } from '../data/workshop.js';
import { dayKey, randInt, safeNum } from '../core/utils.js';

/** 玩家农场的 id：farm 表的主键，也是地块 / 日志表里的 farmId */
export const PLAYER_ID = 'player';

/** 一小时内有多少毫秒，读档时给邻居补「上次上线」用 */
const HOUR = 3600_000;

/** 地块上所有「时间戳」字段，读档时要逐个清洗成有限数 */
const PLOT_TIMES = ['plantedAt', 'readyAt', 'total', 'waterAt', 'pestAt', 'stolenAt'];

/** @type {{farm: object, friends: object[], bag: Record<string, number>, news: object[]}} */
export const state = {
  farm: null,
  friends: [],
  bag: {},
  news: [],
};

/* ============================================================
   新建
   ============================================================ */

/** 新玩家农场 */
function createPlayerFarm() {
  return {
    id: PLAYER_ID,
    kind: 'player',
    name: '农场主',
    avatar: '🧑‍🌾',
    level: 1,
    exp: 0,
    coins: INITIAL_COINS,
    createdAt: Date.now(),
    /** 看家狗：owned 记已收集的品种，breed 是上岗的那只（空串 = 全部休息） */
    dog: {
      owned: { [FIRST_DOG_ID]: true },
      breed: FIRST_DOG_ID,
      satiety: 0,
      at: Date.now(),
    },
    /**
     * 种子制造间：level 0 = 还没开张。
     * kinds 是「作物 id → 造过几次」，**升级只看它有几个 key**（造过多少种）
     */
    workshop: { level: 0, kinds: {} },
    /** 农场主的成长档案：签到 / 图鉴 / 称号 / 引导 */
    progress: {
      /** 上次签到时间；两个 sign 字段是连续天数与累计天数 */
      lastSign: 0,
      signStreak: 0,
      signTotal: 0,
      /** 签到历史：最近 SIGN_KEEP_DAYS 天的日期键（dayKey），日历标「已签」用 */
      signDays: [],
      /** 作物 id → { planted, harvested } */
      cropStats: {},
      /** 作物 id → true，做了标本才算点亮图鉴 */
      specimens: {},
      titles: { claimed: {}, equipped: '' },
      guide: {},
    },
    plots: [],
    log: [],
  };
}

/** 新地块 */
function createPlot(id) {
  return {
    id,
    cropId: null,
    /** 本轮已经收获过几次，用于多茬作物的再生判定 */
    harvested: 0,
    plantedAt: 0,
    readyAt: 0,
    total: 0,
    soil: 'normal',
    /** 本轮是否已经施过肥（任何肥料共用这一个额度） */
    fert: false,
    /** 增产剂带来的产量加成（0.1 / 0.2 / 0.3），本轮有效 */
    yieldBonus: 0,
    /** 捉虫带来的产量加成，每捉一次 +10% */
    boost: 0,
    /** 下次需要浇水 / 捉虫的时间戳 */
    waterAt: 0,
    pestAt: 0,
    /** 本轮是否已被邻居顺走过，重新种下后刷新 */
    stolen: false,
    /** 本轮被顺走了几个，收获时扣掉 */
    stolenCount: 0,
    /** 最近一次被顺走的时间，仅用于展示与排查 */
    stolenAt: 0,
    /** 成熟那一刻摇定的本轮产量（0 = 还没摇；收获与「可收 X」都用这个数） */
    pendingYield: 0,
  };
}

/**
 * 新建一位邻居农场。
 *
 * 等级与身家都按分布现掷，而不是写死在名单里；
 * lastVisitAt 定在过去、nextVisitAt 按他上线节奏排，
 * 这样玩家第一次进来就能看到他们已经「离线了一段时间」。
 */
function createNpc(def, now) {
  const lastVisitAt = now - randInt(2 * HOUR, 20 * HOUR);
  const level = rollNpcLevel();
  const npc = {
    id: def.id,
    kind: 'npc',
    name: def.name,
    avatar: def.avatar,
    level,
    exp: 0,
    coins: npcStartCoins(level),
    createdAt: lastVisitAt,
    personality: def.personality,
    profession: def.profession,
    schedule: def.schedule,
    steal: def.steal,
    lastVisitAt,
    nextVisitAt: nextVisitAt(def, lastVisitAt),
    dog: { breed: rollNpcDogBreed(level).id, satiety: rollNpcDogSatiety(), at: lastVisitAt },
    plots: [],
    log: [],
  };
  npc.plots = generateNpcPlots(npc, now);
  return npc;
}

/* ============================================================
   读档补齐
   ============================================================ */

/** 时间戳字段逐个清洗：IndexedDB 用结构化克隆保存，undefined 会被原样存下来 */
function cleanTimes(target) {
  for (const key of PLOT_TIMES) target[key] = safeNum(target[key], 0);
  return target;
}

/** 玩家地块 */
function normalizePlot(plot, index) {
  const merged = cleanTimes({ ...createPlot(index), ...plot });
  merged.id = safeNum(merged.id, index);
  merged.fert = Boolean(merged.fert);
  merged.yieldBonus = safeNum(merged.yieldBonus, 0);
  merged.boost = safeNum(merged.boost, 0);
  merged.harvested = safeNum(merged.harvested, 0);
  merged.stolen = Boolean(merged.stolen);
  merged.stolenCount = safeNum(merged.stolenCount, 0);
  merged.pendingYield = safeNum(merged.pendingYield, 0);
  return merged;
}

/**
 * 邻居地块。
 * @param {object} plot 存档里的那一行
 * @param {number} index 地块序号
 * @param {number} level 邻居等级（旧档没有土地字段，按它补一个）
 */
function normalizeNpcPlot(plot, index, level = 1) {
  const merged = cleanTimes({ ...emptyNpcPlot(), ...plot });
  merged.id = safeNum(merged.id, index);
  if (!SOILS[merged.soil]) merged.soil = rollNpcSoil(level);
  merged.boost = safeNum(merged.boost, 0);
  merged.harvested = safeNum(merged.harvested, 0);
  merged.guarded = Boolean(merged.guarded);
  merged.stolen = Boolean(merged.stolen);
  merged.stolenCount = safeNum(merged.stolenCount, 0);
  return merged;
}

/** 玩家农场：缺什么补什么，多余的字段留着不动 */
function normalizePlayerFarm(row, save) {
  const base = createPlayerFarm();
  const progress = { ...base.progress, ...(row.progress || {}) };
  progress.titles = { ...base.progress.titles, ...(progress.titles || {}) };
  // 签到历史：旧档没有这个字段，补空数组；有就裁到保留窗口内
  progress.signDays = Array.isArray(progress.signDays)
    ? progress.signDays.slice(-SIGN_KEEP_DAYS)
    : [];
  // 老存档只有 lastSign、没有历史：至少把上次签到那天补进去 ——
  // 否则日历上明明签过、格子却空白，玩家会以为记录丢了
  if (progress.lastSign) {
    const key = dayKey(progress.lastSign);
    if (!progress.signDays.includes(key)) {
      progress.signDays.push(key);
      progress.signDays.sort();
    }
  }

  const dog = { ...base.dog, ...(row.dog || {}) };
  dog.owned = { ...dog.owned };
  // 品种改名只迁一次：先算出一整套新键，再整体替换 ——
  // 逐条改的话 huli→tuyuan 的结果会被紧接着的 tuyuan→bixiong 二次改写
  if (dog.migrated !== BREED_MIGRATION) {
    const next = {};
    for (const id of Object.keys(dog.owned)) next[LEGACY_BREED_MAP[id] || id] = true;
    dog.owned = next;
    dog.breed = LEGACY_BREED_MAP[dog.breed] || dog.breed;
    dog.migrated = BREED_MIGRATION;
  }
  for (const id of Object.keys(dog.owned)) if (!dogBreed(id)) delete dog.owned[id];
  if (!Object.keys(dog.owned).length) dog.owned[FIRST_DOG_ID] = true;
  // 存档里记的品种要是已经不认识了，退回最低档，别让农场凭空不设防
  if (dog.breed && !dog.owned[dog.breed]) dog.breed = FIRST_DOG_ID;
  dog.satiety = safeNum(dog.satiety, 0);
  dog.at = safeNum(dog.at, Date.now());

  // 种子制造间：旧档没有这个字段，补 0（未解锁）
  const workshop = { ...base.workshop, ...(row.workshop || {}) };
  workshop.level = Math.min(WORKSHOP_MAX_LEVEL, Math.max(0, safeNum(workshop.level, 0)));
  // 升级口径从「累计次数」换成了「造过的种类数」：旧的 uses 还原不出
  // 具体造过哪几种，只能丢弃（等级保留，概率不会掉回去）
  delete workshop.uses;
  workshop.kinds = {};
  for (const [id, times] of Object.entries(row.workshop?.kinds || {})) {
    if (CROPS[id] && !CROPS[id].special) workshop.kinds[id] = Math.max(1, safeNum(times, 1));
  }

  const farm = {
    id: PLAYER_ID,
    kind: 'player',
    name: row.name || base.name,
    avatar: row.avatar || base.avatar,
    level: safeNum(row.level, 1),
    exp: safeNum(row.exp, 0),
    coins: safeNum(row.coins, 0),
    createdAt: safeNum(row.createdAt, base.createdAt),
    dog,
    workshop,
    progress,
    plots: [],
    log: save.logs[PLAYER_ID] || [],
  };

  // 地块：不足 TOTAL_PLOTS 就补齐，多的不删
  const saved = (save.plots[PLAYER_ID] || []).map(normalizePlot);
  for (let id = 0; id < TOTAL_PLOTS; id += 1) {
    if (!saved.some((p) => p.id === id)) farm.plots.push(createPlot(id));
  }
  farm.plots.push(...saved);
  farm.plots.sort((a, b) => a.id - b.id);
  return farm;
}

/**
 * 邻居农场。
 *
 * 性格 / 职业 / 上线节奏 / 偷菜倾向以名单为准（它们决定「这个人是谁」），
 * 等级、身家、地块、游标以存档为准 —— 邻居是一路长大的，不能被版本打回原形。
 */
function normalizeNpc(row, def, save) {
  const fresh = createNpc(def, Date.now());
  const npc = {
    ...fresh,
    ...row,
    id: def.id,
    kind: 'npc',
    name: row.name || def.name,
    avatar: row.avatar || def.avatar,
    personality: PERSONALITIES[row.personality] ? row.personality : def.personality,
    profession: row.profession || def.profession,
    schedule: row.schedule || def.schedule,
    steal: STEAL_CHANCE[row.steal] === undefined ? def.steal : row.steal,
    level: safeNum(row.level, fresh.level),
    exp: safeNum(row.exp, 0),
    coins: safeNum(row.coins, 0) || fresh.coins,
    lastVisitAt: safeNum(row.lastVisitAt, fresh.lastVisitAt),
    nextVisitAt: safeNum(row.nextVisitAt, fresh.nextVisitAt),
    dog: { ...fresh.dog, ...(row.dog || {}) },
    plots: [],
    log: save.logs[def.id] || [],
  };
  if (npc.level < 1 || npc.level > MAX_LEVEL) npc.level = rollNpcLevel();
  if (!dogBreed(npc.dog.breed)) npc.dog.breed = rollNpcDogBreed(npc.level).id;
  npc.dog.satiety = safeNum(npc.dog.satiety, rollNpcDogSatiety());
  npc.dog.at = safeNum(npc.dog.at, npc.lastVisitAt);

  const saved = (save.plots[def.id] || []).map((plot, i) => normalizeNpcPlot(plot, i, npc.level));
  npc.plots = saved.length ? saved : fresh.plots;
  // 旧档的地块数还是老口径（≤12）：按当前等级补齐到解锁数，补的直接种上
  syncNpcPlots(npc, Date.now());
  return npc;
}

/* ============================================================
   入口
   ============================================================ */

/**
 * 读档 + 补齐缺失数据，并把补齐后的结果原样写回一次。
 *
 * 一次性回写让「名单里新增的邻居」「新加的字段」都能立刻落盘，
 * 省掉一堆「某处补丁要顺手存一下」的散落逻辑。
 * @returns {Promise<typeof state>}
 */
export async function initState() {
  const save = await loadSave();
  const now = Date.now();

  const playerRow = save.farms.find((row) => row.id === PLAYER_ID);
  state.farm = playerRow ? normalizePlayerFarm(playerRow, save) : createPlayerFarm();
  // 新档：地块全部空着，等玩家自己开垦
  if (!playerRow) {
    for (let id = 0; id < TOTAL_PLOTS; id += 1) state.farm.plots.push(createPlot(id));
  }

  state.bag = save.bag;
  state.news = save.news;

  const rows = new Map(save.farms.filter((row) => row.id !== PLAYER_ID).map((row) => [row.id, row]));
  state.friends = NPCS.map((def) => {
    const row = rows.get(def.id);
    rows.delete(def.id);
    return row ? normalizeNpc(row, def, save) : createNpc(def, now);
  });

  // 名单里已经没有的邻居：连地块与日志一起清掉，免得留下孤儿数据
  await dropFarms([...rows.keys()]);

  await commit({
    farms: [state.farm, ...state.friends],
    bag: state.bag,
    news: state.news,
  });

  return state;
}

/** 按序号取玩家地块 */
export function getPlot(plotId) {
  return state.farm.plots.find((plot) => plot.id === plotId);
}

/** 按 id 取邻居农场 */
export function getFriend(friendId) {
  return state.friends.find((friend) => friend.id === friendId);
}

/**
 * 某座农场的头像（日志 / 时报里标识「是谁」用）。
 *
 * 留空、或是对手农场已经不在名单里时，退回农场主头像 ——
 * 日志行总要有个头像，空白反而像没渲染完。
 * @param {string} [farmId]
 * @returns {string} 头像 emoji
 */
export function avatarOf(farmId) {
  if (farmId && farmId !== PLAYER_ID) {
    const friend = state.friends.find((f) => f.id === farmId);
    if (friend?.avatar) return friend.avatar;
  }
  return state.farm?.avatar || '🧑‍🌾';
}

/**
 * 某座农场的名字 —— 和头像配对使用，口径与 avatarOf 完全一致：
 * 认不出来（留空 / 名单里已经没这个人）就退回农场主。
 * @param {string} [farmId]
 * @returns {string}
 */
export function nameOf(farmId) {
  if (farmId && farmId !== PLAYER_ID) {
    const friend = state.friends.find((f) => f.id === farmId);
    if (friend?.name) return friend.name;
  }
  return state.farm?.name || '农场主';
}
