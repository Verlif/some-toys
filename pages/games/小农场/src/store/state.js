/**
 * 全局状态：整个游戏只有这一份内存状态。
 *
 * 对象结构与存档结构一一对应：
 *   state.farm       玩家农场（farm 表里 kind='player' 的那一行）
 *   state.friends    邻居农场（同一张表里 kind='npc' 的行）
 *   state.commons    公共用地（同一张表里 kind='commons' 的那一行，第 58 轮）
 *   state.relations  两两之间的好感度（relation 表，键是 `a|b`）
 *   state.news       全镇时报
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
import { INITIAL_COINS, MAX_LEVEL, TOTAL_PLOTS, unlockedPlotCount } from '../data/progression.js';
import { FREE_PLOTS } from '../data/plots.js';
import { SIGN_KEEP_DAYS } from '../data/signin.js';
import {
  PERSONALITIES,
  STEAL_CHANCE,
  cropsNearLevel,
  emptyNpcPlot,
  generateNpcPlots,
  nextVisitAt,
  npcStartCoins,
  npcsAtVillageLevel,
  npcsArrivingAt,
  rollNpcLevel,
  rollNpcSoil,
  shuffled,
  syncNpcPlots,
} from '../data/friends.js';
import { CROPS } from '../data/crops.js';
import { SOILS } from '../data/soils.js';
import { PRODUCE_PREFIX, produceId } from '../data/keys.js';
import { starterPack } from '../data/starter.js';
import { CRYSTAL_TIERS, VILLAGE_LOG_CAP, VILLAGE_MAX_LEVEL } from '../data/village.js';
import { PLAYER_ORDER_LIMIT } from '../data/orders.js';
import {
  BREED_MIGRATION,
  FIRST_DOG_ID,
  KENNEL_MAX_LEVEL,
  LEGACY_BREED_MAP,
  dogBreed,
  rollNpcDogBreed,
  rollNpcDogSatiety,
} from '../data/dogs.js';
import { WORKSHOP_MAX_LEVEL } from '../data/workshop.js';
import { COMMONS_AVATAR, COMMONS_ID, COMMONS_NAME, commonsPlotCount } from '../data/commons.js';
import { baseRelation, friendThreshold, readRelations, relKey } from '../data/relation.js';
import { scheduleCare } from '../data/care.js';
import { cleanNotices } from '../data/notice.js';
import { dayKey, randInt, safeNum } from '../core/utils.js';

/** 玩家农场的 id：farm 表的主键，也是地块 / 日志表里的 farmId */
export const PLAYER_ID = 'player';

/** 一小时内有多少毫秒，读档时给邻居补「上次上线」用 */
const HOUR = 3600_000;

/** 地块上所有「时间戳」字段，读档时要逐个清洗成有限数 */
const PLOT_TIMES = ['plantedAt', 'readyAt', 'total', 'waterNext', 'pestNext', 'stolenAt'];

/**
 * 新档开局礼包（建号时填一次）。
 *
 * 只活在内存里：它是「给 UI 弹一次窗」的凭据，弹过就清空 ——
 * 存档里没有必要记「我领过礼包」，能进游戏就说明已经发过了。
 * @type {?{cropId: string, entries: object[]}}
 */
let starterGift = null;

/**
 * 取走开局礼包的内容（弹窗用）；取过一次就没了。
 * @returns {?{cropId: string, entries: object[]}}
 */
export function takeStarterGift() {
  const gift = starterGift;
  starterGift = null;
  return gift;
}

/** @type {{farm: object, friends: object[], peers: object[], commons: object, bag: Record<string, number>,
 *          relations: Record<string, number>, news: object[],
 *          dailyRows: Record<string, object>}} */
export const state = {
  farm: null,
  /** 32 位 NPC：会落库、会被模拟推进 */
  friends: [],
  /**
   * 公共用地（第 58 轮）：一座**没有主人**的农场 —— 地块与日志照样落在
   * plot / log 两张表里（farmId 是 `commons`），但它不属于任何人，
   * 也不会进 `state.friends`（那不是一位邻居）。
   */
  commons: null,
  /**
   * 联机来的真人玩家：**只活在内存**，不落库、不参与邻居模拟。
   * 数据以对方浏览器为准，这里只放只读快照（见 store/peers.js）。
   */
  peers: [],
  bag: {},
  /** 好感度：`{ "npc01|npc02": 45 }`，一对只有一条，0 不落键 */
  relations: {},
  news: [],
  /**
   * 每日排行榜：本地日期键 → `{ date, settled, stats }`，一天一行。
   * stats 按参与者记账（`{ npc01: { care: 3 } }`），最多留 8 天。
   * 落库与结算都在 store/daily.js，这里只放数据。
   */
  dailyRows: {},
};

/**
 * 一次提交里「要一起写下去的农场」。
 *
 * 为什么需要这个函数：世界时钟那条线上有**三类**数据在同时被推进 ——
 * 玩家农场、若干邻居农场、公共用地。早先每个落盘点都手写
 * `[state.farm, ...state.friends]`，第 58 轮加了公共用地之后就漏了三处
 * （村民在公共地抢收的账本没落盘，重开能原地再拿一遍）。
 *
 * 所以凡是「时钟线 / 补算收尾」这类批量落盘，一律走这里：
 * 公共用地**自动跟上**，以后再加第四类数据也只改这一处。
 *
 * ⚠️ 玩家主动操作邻居（浇水 / 偷菜 / 送礼）的单点提交**不要**用它 ——
 * 那些操作根本不碰公共地，带上只是白写一遍（「动了才带」原则）。
 *
 * @param {...(object|undefined|null)} base 本来就要写的农场，按顺序排在前
 * @returns {object[]}
 */
export function farmRows(...base) {
  const rows = base.filter(Boolean);
  if (state.commons && !rows.includes(state.commons)) rows.push(state.commons);
  return rows;
}

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
     * 狗窝：level 是等级（0~5，每级 +30 狗粮槽容量，见 data/dogs.js），
     * digDay 是守护犬最后一次「每日挖宝」掷骰的日期键（dayKey）
     */
    dogHouse: { level: 0, digDay: '' },
    /**
     * 种子制造间：level 0 = 还没开张。
     * kinds 是「作物 id → 造过几次」，**升级只看它有几个 key**（造过多少种）
     * jobs 是排队中的制造任务（第 44 轮新增）：
     *   [{ id, cropId, need, fee, startAt, doneAt }]
     * 时间戳存在档里，离线期间照样在走，回来就能收。
     */
    workshop: { level: 0, kinds: {}, jobs: [] },
    /**
     * 村庄建设（第 48 轮）：全村唯一一份，但存在 farm 行上 ——
     * 单开一张表要改存档结构、读写路径与所有事务，而它每次变化都
     * 跟着玩家农场一起落盘。
     *   level     1~5
     *   coins     本期已投入金币（升级时清零）
     *   crystals  本期已投入水晶数（升级时清零）
     *   pray      本期祈福总次数（玩家 + 全部邻居，升级时清零）
     *   stock     { 1..4: n } 冒险挖到、还没投出去的水晶
     *   prayDay   { 农场 id: dayKey } 今天谁祈过（只留今天）
     *   giveDay   { 农场 id: dayKey } 今天谁投过钱（只留今天，第 49 轮）
     *   logs      建设日志，7 天 / 160 条
     */
    village: {
      level: 1,
      coins: 0,
      crystals: 0,
      pray: 0,
      stock: { 1: 0, 2: 0, 3: 0, 4: 0 },
      prayDay: {},
      giveDay: {},
      logs: [],
    },
    /** 农场主的成长档案：签到 / 图鉴 / 称号 / 引导 */
    progress: {
      /**
       * 上次还在线的时刻（第 46 轮）：世界时钟从这里开始补算。
       * 每次结算与页面隐藏时写。
       *
       * **新档必须给「现在」**：给 0 会让读档逻辑退回「最早的待办上线」，
       * 而开局那批邻居本来就排在几小时前，于是第一次进游戏就弹一份
       * 「你不在的 16 小时」——他明明才刚建号。
       * 老存档（升级前没有这个字段）保留 0，正好用那条兜底把停摆点猜出来。
       */
      lastSeenAt: Date.now(),
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
      /**
       * 自动机器的到期时刻（第 51 轮）：`{ water, pest, harvest }` → 时间戳，0 = 没有。
       *
       * 记绝对时间戳而不是「还剩多久」—— 玩家离线那段时间机器照样在跑，
       * 存剩余毫秒的话关一次页面就等于把它冻住了。
       */
      auto: { water: 0, pest: 0, harvest: 0 },
      /**
       * 农场通知（第 54 轮）：NPC 寄来的信，玩家手动领取。
       * 形状与清洗见 data/notice.js，读写入口在 store/notices.js。
       */
      notices: [],
      titles: { claimed: {}, equipped: '' },
      guide: {},
    },
    plots: [],
    log: [],
    /** 我发布的订单（NPC 上线时按仓库存货接单），形状见 data/orders.js */
    orders: [],
  };
}

/** 新地块：开局前 6 块可用，其余等玩家花金币买（见 data/plots.js） */
function createPlot(id) {
  return {
    id,
    /** 这块地能不能种 —— 落库存档，等级不再决定它 */
    usable: id < FREE_PLOTS,
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
    /**
     * 下一次需要浇水 / 杀虫的时间戳（0 = 本轮不会再需要），
     * 以及这一轮已经处理过几次 —— 排程窗口就按次数算，见 data/care.js
     */
    waterNext: 0,
    pestNext: 0,
    waterTimes: 0,
    pestTimes: 0,
    /** 本轮是否已被邻居顺走过，重新种下后刷新 */
    stolen: false,
    /** 本轮被顺走了几个，收获时扣掉 */
    stolenCount: 0,
    /** 最近一次被顺走的时间，仅用于展示与排查 */
    stolenAt: 0,
    /** 成熟那一刻摇定的本轮产量（0 = 还没摇；收获与「可收 X」都用这个数） */
    pendingYield: 0,
    /**
     * 「先到先得」的账本（第 58 轮，只有公共用地用得上）：
     * taken 是这一轮已经被拿走几个，takers 是拿过的人（每人每块地最多 1 个）。
     * 玩家地块上它们永远是 0 / 空数组 —— 形状统一，省得 normalize 两套分支。
     */
    taken: 0,
    takers: [],
  };
}

/**
 * 公共用地的地块：和玩家地块同一套字段，只是**永远可用**。
 *
 * 额外两个字段是「先到先得」的账本（第 58 轮）：
 *   `taken`  这一轮已经被拿走几个
 *   `takers` 谁拿过（玩家 `player` / 村民 id）—— 每人每块地最多 1 个
 *
 * @param {number} id
 * @returns {object}
 */
export function createCommonsPlot(id) {
  return {
    ...createPlot(id),
    usable: true,
    taken: 0,
    takers: [],
  };
}

/**
 * 新建公共用地。
 *
 * 它是一座**没有主人的农场**：没有等级、身家、狗、背包，
 * 只有地块与日志 —— 所以能整条复用 farm / plot / log 三张表，
 * 存储层与备份一行都不用改。
 * @returns {object}
 */
function createCommonsFarm() {
  return {
    id: COMMONS_ID,
    kind: 'commons',
    name: COMMONS_NAME,
    avatar: COMMONS_AVATAR,
    /** 跟着村庄等级走，读档时由 initState / 升级流程对齐 */
    level: 1,
    plots: [],
    log: [],
  };
}

/**
 * 新建一位邻居农场。
 *
 * 等级与身家都按分布现掷，而不是写死在名单里；
 * lastVisitAt 定在过去、nextVisitAt 按他上线节奏排，
 * 这样玩家第一次进来就能看到他们已经「离线了一段时间」。
 */
export function createNpc(def, now) {
  const lastVisitAt = now - randInt(2 * HOUR, 20 * HOUR);
  /**
   * 等级：随村庄升级搬来的新住户（第 53 轮）自带 `levelRange`，
   * 刚搬来的人地少、等级低，不走 rollNpcLevel() 那套 1~36 的分布；
   * 原住民照旧加权随机。
   */
  const level = def.levelRange
    ? randInt(def.levelRange[0], def.levelRange[1])
    : rollNpcLevel();
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
    /** 在线窗口的截止时刻（ms），由 npc-sim 的 beginVisit 维护；0 = 不在线 */
    onlineUntil: 0,
    /**
     * 在线期间下一件「小事」排在哪（第 48 轮，见 npc-sim 的 planIdle）。
     * 0 = 这个在线窗口已经没排了 / 不在线
     */
    idleAt: 0,
    /** NPC 自己的小仓库：收获时按性格留一部分，接订单 / 互通有无靠它 */
    bag: {},
    /**
     * NPC 自己挖到的升级水晶（第 53 轮）：`{1: n, ...}`。
     * 与玩家的 `farm.village.stock` 分开记 —— 村民只能投自己挖到的。
     */
    crystals: {},
    /** 张榜中的收购订单（同时最多 1 条），null = 没有 */
    order: null,
    dog: { breed: rollNpcDogBreed(level).id, satiety: rollNpcDogSatiety(), at: lastVisitAt },
    plots: [],
    log: [],
  };
  npc.plots = generateNpcPlots(npc, now);
  // 起步家底：几条等级附近的产出，让订单功能一上来就转得动
  seedNpcBag(npc);
  return npc;
}

/**
 * 给 NPC 补一点「家底」：等级附近随机几件产出。
 * 新档开局与旧档迁移都用它 —— 没点存货的话，玩家发布的订单要等好几天
 * 才有 NPC 交得出（2026-10-24 订单功能）。
 * @param {object} npc
 */
function seedNpcBag(npc) {
  npc.bag ??= {};
  const pool = shuffled(cropsNearLevel(npc.level));
  for (const cropId of pool.slice(0, randInt(3, 6))) {
    const key = produceId(cropId);
    npc.bag[key] = (npc.bag[key] || 0) + randInt(1, 4);
  }
}

/**
 * 清洗一条订单（NPC 的或玩家的，形状完全一样）。
 *
 * 需求只认**产出**（NPC 仓库里只有产出，种子订单没人交得了）；
 * 缺时间戳 / 数量 / 赏金的当没有，别让坏行把界面带崩。
 * @param {any} raw 存档里的原始行
 * @param {string} ownerId 下单方农场 id
 * @param {string} id 订单 id（NPC 用自己的 id，玩家用发布时生成的）
 * @returns {?object}
 */
function cleanOrder(raw, ownerId, id) {
  if (!raw || typeof raw !== 'object') return null;
  const itemId = String(raw.itemId || '');
  if (!itemId.startsWith(PRODUCE_PREFIX) || !CROPS[itemId.slice(PRODUCE_PREFIX.length)]) return null;
  const createdAt = safeNum(raw.createdAt, 0);
  const deadline = safeNum(raw.deadline, 0);
  if (!createdAt || !deadline) return null;
  return {
    id,
    ownerId,
    itemId,
    qty: Math.max(1, Math.floor(Number(raw.qty) || 0)),
    reward: Math.max(1, Math.round(Number(raw.reward) || 0)),
    createdAt,
    deadline,
  };
}

/**
 * NPC 仓库清洗：只认产出 key，正数才留。
 *
 * 第 52 轮起也留 `seed_` 开头的 key —— 村庄升级会往每个邻居的仓库里放一颗
 * 荣耀种子（「发给全村所有人」），读档时把它洗掉就等于只发给了玩家。
 */
function cleanNpcBag(raw) {
  const bag = {};
  for (const [id, n] of Object.entries(raw || {})) {
    const isProduce = id.startsWith(PRODUCE_PREFIX) && CROPS[id.slice(PRODUCE_PREFIX.length)];
    const isSeed = id.startsWith('seed_') && CROPS[id.slice('seed_'.length)];
    if (!isProduce && !isSeed) continue;
    bag[id] = Math.max(0, Math.floor(Number(n) || 0));
  }
  return bag;
}

/**
 * 邻居自己挖到的升级水晶（第 53 轮）：`{1: n, 2: n, 3: n, 4: n}`。
 *
 * 水晶从来不在背包里 —— 玩家挖到的记在 `farm.village.stock`，
 * 邻居挖到的记在各自的 `crystals` 上。分开记之后，村民只能投自己挖到的，
 * 不会再用「村里公共那一堆」去投共建（那正是「我没水晶却被投出去」的来源）。
 *
 * @param {any} raw 存档里的原始行
 * @returns {Record<number, number>}
 */
function cleanNpcCrystals(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const tier of CRYSTAL_TIERS) {
    const n = Math.max(0, Math.floor(safeNum(raw[tier], 0)));
    if (n > 0) out[tier] = n;
  }
  return out;
}

/* ============================================================
   读档补齐
   ============================================================ */

/** 时间戳字段逐个清洗：IndexedDB 用结构化克隆保存，undefined 会被原样存下来 */
function cleanTimes(target) {
  for (const key of PLOT_TIMES) target[key] = safeNum(target[key], 0);
  return target;
}

/**
 * 旧档的照料是「固定周期」的 waterAt / pestAt，次数反推不出来 ——
 * 直接丢掉旧值，按「刚种下」的节奏重排一次（这一轮从头算，不会白扣产量）。
 * @param {object} merged 清洗后的地块
 * @param {object} raw 存档里的原始行
 */
function migrateCare(merged, raw) {
  if (!raw || !('waterAt' in raw || 'pestAt' in raw)) return merged;
  delete merged.waterAt;
  delete merged.pestAt;
  if (merged.cropId) scheduleCare(merged, Date.now());
  return merged;
}

/** 玩家地块 */
function normalizePlot(plot, index, fallbackUsable = false) {
  const merged = cleanTimes({ ...createPlot(index), ...plot });
  merged.id = safeNum(merged.id, index);
  /* 老存档没有 usable：按以前「等级解锁」的结果折算，玩家不会因为改版掉地 */
  merged.usable = typeof plot?.usable === 'boolean' ? plot.usable : Boolean(fallbackUsable || merged.usable);
  merged.fert = Boolean(merged.fert);
  merged.yieldBonus = safeNum(merged.yieldBonus, 0);
  merged.boost = safeNum(merged.boost, 0);
  merged.harvested = safeNum(merged.harvested, 0);
  merged.stolen = Boolean(merged.stolen);
  merged.stolenCount = safeNum(merged.stolenCount, 0);
  merged.pendingYield = safeNum(merged.pendingYield, 0);
  // 公共用地的「先到先得」账本（第 58 轮）：玩家地块上永远是 0 / 空数组，
  // 统一在这里清洗，省得 createPlot 与 normalizePlot 两处各写一份
  merged.taken = safeNum(merged.taken, 0);
  merged.takers = Array.isArray(merged.takers)
    ? merged.takers.filter((who) => typeof who === 'string' && who)
    : [];
  merged.waterTimes = safeNum(merged.waterTimes, 0);
  merged.pestTimes = safeNum(merged.pestTimes, 0);
  // 旧档排过 0 次、又还在长：补一次排程，否则这块地永远不会缺水
  if (merged.cropId && !merged.waterNext && !merged.pestNext && !('waterAt' in (plot || {}))) {
    scheduleCare(merged, Date.now());
  }
  return migrateCare(merged, plot);
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
  merged.waterTimes = safeNum(merged.waterTimes, 0);
  merged.pestTimes = safeNum(merged.pestTimes, 0);
  if (merged.cropId && !merged.waterNext && !merged.pestNext && !('waterAt' in (plot || {}))) {
    scheduleCare(merged, Date.now());
  }
  return migrateCare(merged, plot);
}

/** 玩家农场：缺什么补什么，多余的字段留着不动 */
/**
 * 村庄建设：把存档里的那一块洗干净。
 *
 * 老存档完全没有它 → 一个 1 级的新村庄，和刚开村一样。
 * 三项进度都夹到合法值，水晶只认 1~4 档，日志裁到上限。
 *
 * 祈福标记**只留今天**：它唯一的用途是判断「今天祈过没有」，
 * 昨天的没有任何意义，攒着会长成 33 × N 的表。
 * @param {?object} raw
 */
function normalizeVillage(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const out = {
    level: Math.min(VILLAGE_MAX_LEVEL, Math.max(1, safeNum(v.level, 1))),
    coins: Math.max(0, safeNum(v.coins, 0)),
    crystals: Math.max(0, safeNum(v.crystals, 0)),
    pray: Math.max(0, safeNum(v.pray, 0)),
    stock: {},
    prayDay: {},
    giveDay: {},
    logs: [],
  };
  for (const tier of CRYSTAL_TIERS) out.stock[tier] = Math.max(0, safeNum(v.stock?.[tier], 0));

  // prayDay / giveDay 都只留今天那几个 key：留着历史只会长成「人数 × N」的表
  const today = dayKey(Date.now());
  for (const [who, day] of Object.entries(v.prayDay || {})) {
    if (typeof who === 'string' && day === today) out.prayDay[who] = day;
  }
  for (const [who, day] of Object.entries(v.giveDay || {})) {
    if (typeof who === 'string' && day === today) out.giveDay[who] = day;
  }

  out.logs = (Array.isArray(v.logs) ? v.logs : [])
    .map((entry) => (entry && Number.isFinite(entry.at)
      ? { at: entry.at, emoji: String(entry.emoji || ''), text: String(entry.text || '') }
      : null))
    .filter(Boolean)
    .slice(-VILLAGE_LOG_CAP);
  return out;
}

/**
 * 公共用地：一座没有主人的农场，只清洗地块与日志。
 *
 * 块数按村庄等级补齐（Lv.1 两块，每级 +2）—— 村庄升级后由 store/commons.js
 * 的 `ensurePlots`（`advanceCommons` 每次调）再补一次，两边用同一个
 * `commonsPlotCount`，所以这里只管「读档这一刻该有几块」。
 * 地块全部可用：这里没有「买地」这回事。
 *
 * @param {?object} row 存档里的那一行（没有就是新档）
 * @param {object} save loadSave() 的结果
 * @param {number} [level] 当前村庄等级（块数看它）
 * @returns {object}
 */
function normalizeCommons(row, save, level = 1) {
  const base = createCommonsFarm();
  const lv = Math.min(VILLAGE_MAX_LEVEL, Math.max(1, safeNum(level, safeNum(row?.level, 1))));
  const farm = {
    ...base,
    level: lv,
    plots: [],
    log: save.logs[COMMONS_ID] || [],
  };

  const saved = (save.plots[COMMONS_ID] || []).map((plot, i) => normalizePlot(plot, i, true));
  const want = commonsPlotCount(lv);
  for (let id = 0; id < want; id += 1) {
    const hit = saved.find((plot) => plot.id === id);
    farm.plots.push(hit || createCommonsPlot(id));
  }
  // 村庄不会降级，所以只可能「存档里的地比现在该有的多」—— 多出来的丢掉
  farm.plots.sort((a, b) => a.id - b.id);
  return farm;
}

function normalizePlayerFarm(row, save) {
  const base = createPlayerFarm();
  const progress = { ...base.progress, ...(row.progress || {}) };
  progress.titles = { ...base.progress.titles, ...(progress.titles || {}) };
  // 自动机器的到期时刻：旧档没有这个字段，补 0（= 没买过）；
  // 坏值一律当 0，宁可少算一天，也别让一台「-Infinity 天后过期」的机器永远转下去
  progress.auto = {
    water: safeNum(progress.auto?.water, 0),
    pest: safeNum(progress.auto?.pest, 0),
    harvest: safeNum(progress.auto?.harvest, 0),
  };
  // 农场通知：旧档没有这个字段 → 空信箱；有就洗干净并裁到保留窗口
  progress.notices = cleanNotices(progress.notices);
  // 签到历史：旧档没有这个字段，补空数组；有就裁到保留窗口内
  progress.signDays = Array.isArray(progress.signDays)
    ? progress.signDays.slice(-SIGN_KEEP_DAYS)
    : [];  // 老存档只有 lastSign、没有历史：至少把上次签到那天补进去 ——
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

  // 狗窝：旧档没有这个字段，补 0 级（容量 100，与早先一致）；
  // digDay 空串 = 还没掷过挖宝，第一次结算只记账不补发
  const dogHouse = { ...base.dogHouse, ...(row.dogHouse || {}) };
  dogHouse.level = Math.min(KENNEL_MAX_LEVEL, Math.max(0, safeNum(dogHouse.level, 0)));
  dogHouse.digDay = typeof dogHouse.digDay === 'string' ? dogHouse.digDay : '';

  // 种子制造间：旧档没有这个字段，补 0（未解锁）
  const workshop = { ...base.workshop, ...(row.workshop || {}) };
  workshop.level = Math.min(WORKSHOP_MAX_LEVEL, Math.max(0, safeNum(workshop.level, 0)));
  // 升级口径从「累计次数」换成了「造过的种类数」：旧的 uses 还原不出
  // 具体造过哪几种，只能丢弃（等级保留，概率不会掉回去）
  delete workshop.uses;
  workshop.kinds = {};
  for (const [id, times] of Object.entries(row.workshop?.kinds || {})) {
    // 第 43 轮起限定作物也能制造，kinds 不再按 special 过滤
    if (CROPS[id]) workshop.kinds[id] = Math.max(1, safeNum(times, 1));
  }
  // 排队中的制造任务：只留认得出来的作物 + 有效时间戳。
  // 时间是绝对时间戳，所以读档时「已经做好」的那些原样留着，进页面即可领
  workshop.jobs = (Array.isArray(row.workshop?.jobs) ? row.workshop.jobs : [])
    .map((job, i) => {
      const cropId = job?.cropId;
      if (!CROPS[cropId]) return null;
      const startAt = safeNum(job.startAt, 0);
      const doneAt = safeNum(job.doneAt, 0);
      if (!startAt || !doneAt || doneAt <= startAt) return null;
      return {
        id: String(job.id || `j${i}-${startAt}`),
        cropId,
        need: Math.max(1, safeNum(job.need, 1)),
        fee: Math.max(0, safeNum(job.fee, 0)),
        startAt,
        doneAt,
      };
    })
    .filter(Boolean)
    .slice(0, WORKSHOP_MAX_LEVEL);

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
    dogHouse,
    workshop,
    village: normalizeVillage(row.village),
    progress,
    plots: [],
    log: save.logs[PLAYER_ID] || [],
    orders: Array.isArray(row.orders)
      ? row.orders
        .map((item, i) => cleanOrder(item, PLAYER_ID, String(item?.id || `p${i}-${safeNum(item?.createdAt, 0)}`)))
        .filter(Boolean)
        .slice(0, PLAYER_ORDER_LIMIT)
      : [],
  };

  // 地块：不足 TOTAL_PLOTS 就补齐，多的不删
  // 老档的可用地块数 = 以前按等级算出来的数量；新档每块地自带 usable
  const legacyUsable = unlockedPlotCount(farm.level);
  const saved = (save.plots[PLAYER_ID] || []).map(
    (plot, i) => normalizePlot(plot, i, (plot?.id ?? i) < legacyUsable),
  );
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
    // 上线节奏**只认名单**，不吃存档：名单是策划调数值的地方，
    // 早先写成 `row.schedule || def.schedule`，结果老档里的旧区间永远盖住新值 ——
    // 第 45 轮把间隔砍半之后，老玩家一点变化都感觉不到
    schedule: def.schedule,
    steal: STEAL_CHANCE[row.steal] === undefined ? def.steal : row.steal,
    level: safeNum(row.level, fresh.level),
    exp: safeNum(row.exp, 0),
    coins: safeNum(row.coins, 0) || fresh.coins,
    lastVisitAt: safeNum(row.lastVisitAt, fresh.lastVisitAt),
    nextVisitAt: safeNum(row.nextVisitAt, fresh.nextVisitAt),
    onlineUntil: safeNum(row.onlineUntil, 0),
    // 在线空闲的下一个动作时刻：老档没有就给 0，世界时钟会在下一次
    // 心跳里顺手补一个（见 world.js 的 runIdleActions）
    idleAt: safeNum(row.idleAt, 0),
    bag: cleanNpcBag(row.bag),
    crystals: cleanNpcCrystals(row.crystals),
    order: cleanOrder(row.order, def.id, def.id),
    dog: { ...fresh.dog, ...(row.dog || {}) },
    plots: [],
    log: save.logs[def.id] || [],
  };
  if (npc.level < 1 || npc.level > MAX_LEVEL) npc.level = rollNpcLevel();
  if (!dogBreed(npc.dog.breed)) npc.dog.breed = rollNpcDogBreed(npc.level).id;
  npc.dog.satiety = safeNum(npc.dog.satiety, rollNpcDogSatiety());
  npc.dog.at = safeNum(npc.dog.at, npc.lastVisitAt);
  // 旧档没有仓库字段：补一份家底，订单功能一上来就转得动
  if (!row.bag) seedNpcBag(npc);

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
  // 第一次进游戏：6 颗当前等级的种子 + 三件省手道具 + 狗粮（见 data/starter.js）
  if (!playerRow) starterGift = grantStarterPack(now);
  state.news = save.news;
  state.dailyRows = save.dailyRows || {};

  /**
   * 公共用地（第 58 轮）：**必须先于** `rows` 的过滤认领掉 `commons` 那一行，
   * 否则它会被当成一位「名单里已经没有的邻居」丢给 dropFarms 清掉。
   * 块数跟着村庄等级走，所以等级要先算出来一起传进去。
   */
  const villageLevel = state.farm.village?.level || 1;
  state.commons = normalizeCommons(
    save.farms.find((row) => row.id === COMMONS_ID),
    save,
    villageLevel,
  );

  const rows = new Map(save.farms
    .filter((row) => row.id !== PLAYER_ID && row.id !== COMMONS_ID)
    .map((row) => [row.id, row]));
  /**
   * 谁在村里，看村庄等级（第 53 轮）。
   *
   * 开局只有 32 位原住民，另外 20 位是村子升到 Lv.2~5 时陆续搬来的
   * （`npcsArrivingAt` 在 store/village.js 的 checkUpgrade 里补进名单）。
   * 这里按等级过滤而不是照单全收：老档里可能存着「村子还没升级却已经写进库」
   * 的新住户，直接 map 全部 NPCS 会让他们提前入住。
   */
  state.friends = npcsAtVillageLevel(villageLevel).map((def) => {
    const row = rows.get(def.id);
    rows.delete(def.id);
    return row ? normalizeNpc(row, def, save) : createNpc(def, now);
  });

  // 名单里已经没有的邻居：连地块与日志一起清掉，免得留下孤儿数据
  await dropFarms([...rows.keys()]);

  /* 好感度：读档 + 按性格补上还没有记录的那些对 */
  const ids = [PLAYER_ID, ...state.friends.map((friend) => friend.id)];
  state.relations = readRelations(save.relations, new Set(ids));
  seedRelations(ids);
  // 开局好友：起点就够门槛的自动成为好友（只有「热心」那 7 位够）
  seedFriends();

  await commit({
    farms: [state.farm, ...state.friends, state.commons],
    bag: state.bag,
    news: state.news,
    relations: state.relations,
  });

  return state;
}

/**
 * 村子升级时把新一批邻居请进村（第 53 轮）。
 *
 * 谁在名单里由 data/friends.js 的 `arrive` 决定：4 批 × 5 人，村子升到
 * Lv.2 / 3 / 4 / 5 各搬来一批，农场等级 2~10 级。由 store/village.js 的
 * checkUpgrade 调用 —— state.js 不认识村庄模块，反过来 village.js 认识
 * state.js，依赖只有一个方向，不会绕成环。
 *
 * @param {number} level 村子升到的等级
 * @param {number} [now]
 * @returns {object[]} 这次搬进来的邻居，没有新住户时是空数组
 */
export function admitVillageNeighbours(level, now = Date.now()) {
  const arrived = [];
  for (const def of npcsArrivingAt(level)) {
    if (state.friends.some((friend) => friend.id === def.id)) continue;
    const npc = createNpc(def, now);
    /**
     * 「刚搬来」就是刚刚：createNpc 会给所有人把上次上线推到 2~20 小时前
     * （让老邻居一进游戏就看着像离线了一段时间），但对新住户不行 ——
     * 世界时钟会拿 `nextVisitAt` 往前补算，等于让他们**入住之前**就在
     * 村里串了二十小时的门、顺了二十小时的菜。这里把他们按到当下。
     */
    npc.createdAt = now;
    npc.lastVisitAt = now;
    npc.nextVisitAt = nextVisitAt(def, now);
    npc.dog.at = now;
    state.friends.push(npc);
    arrived.push(npc);
  }
  // 新来的人跟玩家、跟老住户之间也要有初始好感，否则第一次点开全是 0。
  // 传全量 id：seedRelations 自己会跳过已经有记录的那些对。
  if (arrived.length) {
    seedRelations([PLAYER_ID, ...state.friends.map((npc) => npc.id)]);
    // 刚搬来的人里，起点就够门槛的当场成为好友（「热心」那类）
    for (const npc of arrived) markFriendIfQualified(npc);
  }
  return arrived;
}

/**
 * 把开局礼包塞进仓库，并记进农场日志。
 *
 * 直接操作 `state.bag` 而不是走 `store/inventory.js` 的 `add()`：
 * 那一步会顺手记「图鉴已收集」，而种子 / 道具本来就不该算收集，
 * `noteProduce` 也会因为不认识这些 key 而白跑一趟。
 *
 * @param {number} now
 * @returns {{cropId: string, entries: {id: string, n: number, emoji: string, name: string}[]}}
 */
function grantStarterPack(now) {
  const pack = starterPack(state.farm.level);
  for (const entry of pack.entries) {
    state.bag[entry.id] = (state.bag[entry.id] || 0) + entry.n;
  }
  const text = pack.entries.map((e) => `${e.emoji}${e.name}×${e.n}`).join('、');
  state.farm.log ??= [];
  state.farm.log.unshift({ at: now, emoji: '🎁', text: `收到新手礼包：${text}`, by: '' });
  return pack;
}

/**
 * 给还没有记录的一对按性格算一个起点。
 *
 * 玩家没有性格档案，按 0 算 —— 所以玩家与「热心」天生 +37、
 * 与「爱占便宜」天生 −22，第一次点开邻居就能看出谁跟谁投缘。
 * @param {string[]} ids
 */
function seedRelations(ids) {
  const friendly = new Map(
    state.friends.map((friend) => [friend.id, PERSONALITIES[friend.personality]?.friendly || 0]),
  );
  const valueOf = (id) => (id === PLAYER_ID ? 0 : friendly.get(id) || 0);

  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const key = relKey(ids[i], ids[j]);
      if (state.relations[key] !== undefined) continue;
      const base = baseRelation(valueOf(ids[i]), valueOf(ids[j]));
      if (base) state.relations[key] = { v: base, friend: false };
    }
  }
}

/**
 * 开局好友（第 57 轮）：起点就够门槛的，直接算好友。
 *
 * 只判「玩家 ↔ 邻居」这一侧 —— 玩家点开好友页总得有几个熟人，
 * 否则一个空列表像是坏了。邻居之间从零开始处，让他们靠主动申请慢慢处出来
 * （见 store/npc-sim.js 的 friend 动作），不然开局全村早就结成一张网了。
 *
 * **只在第一次跑**：`progress.friendSeeded` 一旦落盘就再也不回来。
 * 否则玩家手动解除掉一位「热心」邻居（好感还挂在 +37 上），下次开游戏
 * 又会被自动加回去，等于解除按钮失灵。
 */
function seedFriends() {
  const progress = (state.farm.progress ??= {});
  if (progress.friendSeeded) return;
  progress.friendSeeded = true;
  for (const npc of state.friends) markFriendIfQualified(npc);
}

/**
 * 这一对的起点够不够当好友，够就写标记。
 * @param {object} npc
 */
function markFriendIfQualified(npc) {
  const row = state.relations[relKey(PLAYER_ID, npc.id)];
  if (!row || row.friend) return;
  if (row.v >= friendThreshold(npc.personality)) row.friend = true;
}

/** 按序号取玩家地块 */
export function getPlot(plotId) {
  return state.farm.plots.find((plot) => plot.id === plotId);
}

/**
 * 按 id 取邻居农场。
 *
 * 先查 NPC，再查联机名册 —— 弹窗、记录里的人名标签、时报都只认这一处，
 * 所以「点开真人农场」与「点开 NPC 农场」走的是同一套 UI。
 */
export function getFriend(friendId) {
  return state.friends.find((friend) => friend.id === friendId)
    || state.peers.find((peer) => peer.id === friendId);
}
