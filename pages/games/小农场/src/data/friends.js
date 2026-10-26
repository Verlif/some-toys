/**
 * 邻居 NPC 定义与离线模拟规则。
 *
 * 每位邻居 = 性格 + 职业 + 上线节奏 + 偷菜倾向。
 * 这四样叠起来决定他这座农场长什么样、什么时候上线、
 * 会不会摸到玩家家里顺菜 —— 32 位邻居因此各有各的发展轨迹。
 *
 * 邻居是完全离线的：玩家什么时候打开游戏、什么时候进邻居页，
 * 都不影响他们的节奏；进度由「上次结算时间 → 现在」的时间差补算出来。
 * 玩家在线时他们的动作会一条一条地演出来，见 store/social.js。
 */
import { CROPS } from './crops.js';
import { SOILS } from './soils.js';
import { unlockedPlotCount } from './progression.js';
import { scheduleCare } from './care.js';
import { randInt } from '../core/utils.js';

/* ---------- 性格：决定上线时各行为的权重 ---------- */

/**
 * 性格有两重作用：
 *   - `weights` 决定上线时先做什么（收获 / 播种 / 打理）；
 *   - `friendly` 是这个人的**基础好感度**，两个人之间的好感就从这里起算
 *     （见 data/relation.js 的 baseRelation）。
 *     热心 / 勤勉的人天生讨喜，爱占便宜 / 生意人则要多走动才熟。
 */
export const PERSONALITIES = {
  diligent: { name: '勤勉', weights: { harvest: 4, plant: 4, tend: 3 }, friendly: 45 },
  thrifty: { name: '精打细算', weights: { harvest: 3, plant: 2, tend: 2 }, friendly: 10 },
  merchant: { name: '生意人', weights: { harvest: 2, plant: 2, tend: 1 }, friendly: -15 },
  scholar: { name: '爱钻研', weights: { harvest: 2, plant: 3, tend: 4 }, friendly: 35 },
  leisurely: { name: '悠闲', weights: { harvest: 2, plant: 1, tend: 1 }, friendly: 5 },
  greedy: { name: '爱占便宜', weights: { harvest: 2, plant: 2, tend: 1 }, friendly: -45 },
  friendly: { name: '热心', weights: { harvest: 3, plant: 3, tend: 4 }, friendly: 75 },
  boss: { name: '场面人', weights: { harvest: 3, plant: 3, tend: 2 }, friendly: 25 },
};

/* ---------- 偷菜倾向 ---------- */

/**
 * 偷菜倾向 → 每次上线真的动手的概率。
 *
 * 单独抽出来而不是混进性格权重：「偷不偷」是邻居之间最直观的差异，
 * 玩家被顺几次就能记住谁手不干净，而不是靠概率表算出来的错觉。
 */
export const STEAL_CHANCE = { never: 0, rare: 0.18, often: 0.65, always: 0.95 };

/** 倾向的中文说明，显示在邻居详情里 */
export const STEAL_LABELS = {
  never: '从不偷菜',
  rare: '偶尔顺菜',
  often: '常去顺菜',
  always: '见菜就偷',
};

/* ---------- 32 位邻居 ---------- */

/**
 * 邻居的起始等级。
 *
 * 不写死在名单里：每一位开局时从 1~36 级里加权随机，且**低等级更多** ——
 * 玩家刚起步就能看到一批比自己高不了几级的邻居，追得上、也偷得着。
 * 之后完全按正常模拟成长，**没有额外上限**（一直能涨到满级）。
 */
export const NPC_LEVEL_MAX = 36;

/**
 * 掷一个邻居起始等级（1~36）
 *
 * 用 `random ** 1.7` 把分布压向低端：平均约 14 级，
 * 一半以上的邻居落在 13 级以内，30 级以上的只是少数。
 * @returns {number}
 */
export function rollNpcLevel() {
  return 1 + Math.floor(NPC_LEVEL_MAX * Math.random() ** 1.7);
}

/**
 * 邻居的起始身家：等级越高越有钱，再乘一个 ±30% 的随机
 * @param {number} level
 * @returns {number}
 */
export function npcStartCoins(level) {
  return Math.round(300 * level ** 1.6 * (0.7 + Math.random() * 0.6));
}

/**
 * schedule 决定上线节奏：
 *   { type: 'fixed', hours: [6, 18] }  每天固定钟点上线（带 ±30 分钟浮动）
 *   { type: 'interval', min: 3, max: 10 } 按小时区间随机
 * steal 是 STEAL_CHANCE 的档位。
 */
export const NPCS = [
  { id: 'npc01', name: '王大爷', avatar: '👴', personality: 'diligent', profession: '退休农民',
    schedule: { type: 'fixed', hours: [0, 6, 12, 18] }, steal: 'rare' },
  { id: 'npc02', name: '李大婶', avatar: '👩', personality: 'thrifty', profession: '家庭主妇',
    schedule: { type: 'fixed', hours: [7, 19] }, steal: 'rare' },
  { id: 'npc03', name: '小芳', avatar: '👧', personality: 'friendly', profession: '农大学生',
    schedule: { type: 'fixed', hours: [5, 11, 17, 21] }, steal: 'never' },
  { id: 'npc04', name: '赵老板', avatar: '🧔', personality: 'merchant', profession: '水果贩子',
    schedule: { type: 'interval', min: 2, max: 5 }, steal: 'always' },
  { id: 'npc05', name: '陈老师', avatar: '👩‍🏫', personality: 'scholar', profession: '小学教师',
    schedule: { type: 'fixed', hours: [1, 7, 13, 19] }, steal: 'never' },
  { id: 'npc06', name: '老王头', avatar: '🧓', personality: 'leisurely', profession: '钓鱼佬',
    schedule: { type: 'interval', min: 4, max: 8 }, steal: 'rare' },
  { id: 'npc07', name: '张婶婶', avatar: '👵', personality: 'friendly', profession: '面点摊主',
    schedule: { type: 'interval', min: 3, max: 6 }, steal: 'never' },
  { id: 'npc08', name: '刘大哥', avatar: '👨', personality: 'diligent', profession: '货车司机',
    schedule: { type: 'interval', min: 2, max: 5 }, steal: 'often' },
  { id: 'npc09', name: '林妹妹', avatar: '👩‍🦱', personality: 'greedy', profession: '带货主播',
    schedule: { type: 'interval', min: 1, max: 4 }, steal: 'always' },
  { id: 'npc10', name: '周老板', avatar: '🧑‍💼', personality: 'boss', profession: '农资经销商',
    schedule: { type: 'interval', min: 3, max: 7 }, steal: 'often' },
  { id: 'npc11', name: '郑爷爷', avatar: '👴', personality: 'scholar', profession: '退休会计',
    schedule: { type: 'fixed', hours: [2, 8, 14, 20] }, steal: 'never' },
  { id: 'npc12', name: '黄阿姨', avatar: '👩‍🦰', personality: 'thrifty', profession: '裁缝',
    schedule: { type: 'fixed', hours: [3, 9, 15, 21] }, steal: 'rare' },
  { id: 'npc13', name: '吴秀才', avatar: '🎓', personality: 'scholar', profession: '农技站技术员',
    schedule: { type: 'fixed', hours: [6, 10, 15, 22] }, steal: 'never' },
  { id: 'npc14', name: '孙大厨', avatar: '🧑‍🍳', personality: 'merchant', profession: '农家乐老板',
    schedule: { type: 'interval', min: 2, max: 6 }, steal: 'often' },
  { id: 'npc15', name: '村长', avatar: '👨‍🌾', personality: 'boss', profession: '村长',
    schedule: { type: 'fixed', hours: [0, 7, 12, 18] }, steal: 'rare' },
  { id: 'npc16', name: '何师傅', avatar: '🚚', personality: 'leisurely', profession: '长途司机',
    schedule: { type: 'interval', min: 3, max: 8 }, steal: 'rare' },
  { id: 'npc17', name: '小雨', avatar: '🌷', personality: 'friendly', profession: '花店店主',
    schedule: { type: 'fixed', hours: [2, 8, 14, 20] }, steal: 'never' },
  { id: 'npc18', name: '老支书', avatar: '👴', personality: 'boss', profession: '退休支书',
    schedule: { type: 'fixed', hours: [6, 18] }, steal: 'rare' },
  { id: 'npc19', name: '阿满', avatar: '🧑‍🌾', personality: 'diligent', profession: '种粮大户',
    schedule: { type: 'fixed', hours: [5, 11, 17, 23] }, steal: 'rare' },
  { id: 'npc20', name: '米雪', avatar: '🍰', personality: 'thrifty', profession: '烘焙师',
    schedule: { type: 'interval', min: 2, max: 5 }, steal: 'often' },
  { id: 'npc21', name: '胖婶', avatar: '👩‍🍳', personality: 'greedy', profession: '早点摊主',
    schedule: { type: 'interval', min: 3, max: 6 }, steal: 'often' },
  { id: 'npc22', name: '老葛', avatar: '🧑‍🔧', personality: 'leisurely', profession: '退休木匠',
    schedule: { type: 'fixed', hours: [1, 7, 13, 19] }, steal: 'rare' },
  { id: 'npc23', name: '二丫', avatar: '🐑', personality: 'friendly', profession: '放羊娃',
    schedule: { type: 'interval', min: 2, max: 5 }, steal: 'never' },
  { id: 'npc24', name: '金链哥', avatar: '🕶️', personality: 'greedy', profession: '二手车商',
    schedule: { type: 'interval', min: 2, max: 4 }, steal: 'always' },
  { id: 'npc25', name: '秦阿姨', avatar: '🧹', personality: 'thrifty', profession: '保洁员',
    schedule: { type: 'fixed', hours: [6, 11, 17, 23] }, steal: 'rare' },
  { id: 'npc26', name: '大勇', avatar: '🔧', personality: 'diligent', profession: '修理工',
    schedule: { type: 'interval', min: 3, max: 6 }, steal: 'often' },
  { id: 'npc27', name: '柳先生', avatar: '📚', personality: 'scholar', profession: '中学老师',
    schedule: { type: 'fixed', hours: [1, 7, 13, 20] }, steal: 'never' },
  { id: 'npc28', name: '花姐', avatar: '🎀', personality: 'merchant', profession: '婚庆老板',
    schedule: { type: 'interval', min: 3, max: 7 }, steal: 'often' },
  { id: 'npc29', name: '老K', avatar: '🧢', personality: 'boss', profession: '网吧老板',
    schedule: { type: 'interval', min: 2, max: 5 }, steal: 'often' },
  { id: 'npc30', name: '石头', avatar: '🧒', personality: 'diligent', profession: '学徒工',
    schedule: { type: 'fixed', hours: [0, 6, 12, 18] }, steal: 'rare' },
  { id: 'npc31', name: '吴姐', avatar: '🍼', personality: 'thrifty', profession: '月嫂',
    schedule: { type: 'interval', min: 4, max: 8 }, steal: 'never' },
  { id: 'npc32', name: '赵六', avatar: '🧤', personality: 'greedy', profession: '收废品的',
    schedule: { type: 'interval', min: 1, max: 4 }, steal: 'always' },
];

/* ---------- 模拟节奏 ---------- */
const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** 固定钟点型上线的浮动：±30 分钟，免得所有邻居整点一起冒出来 */
const FIXED_JITTER = 30 * 60_000;

/**
 * 没写 schedule 的邻居按这个区间上线。
 *
 * 第 45 轮：整体砍半（原来 8~16 小时）。邻居一天只来一趟时，
 * 玩家守着页面也很难碰上谁上线，交易、偷菜、帮忙这些互动几乎不会发生 ——
 * 间隔砍半之后平均 4~8 小时一趟，一天能碰上三四次。
 */
const DEFAULT_INTERVAL = { min: 4, max: 8 };

/** 每次上线平均执行的动作数 */
export const ACTIONS_PER_VISIT = [2, 4];

/**
 * 玩家在线时，邻居每做一个动作之间要隔多久（毫秒）。
 *
 * 离线结算是「一口气算完」的，玩家看不见；在线时则要看得出来
 * 邻居正在自己农场里忙：先上线打个招呼，然后隔几秒做一件事。
 */
export const LIVE_STEP_MS = [3000, 7000];

/**
 * 邻居挑目标时给「玩家农场」的权重。
 *
 * 偷菜先挑农场、再挑地块。玩家有 40 块地，是镇上最扎眼的一座 ——
 * 所以给他 2 倍权重：邻居越多，玩家被顺的次数才会跟着涨。
 * 不加这个权重的话，新增邻居只是在稀释「我」被偷的概率，
 * 邻居再多也不会有危机感。
 */
export const PLAYER_FARM_WEIGHT = 2;

/**
 * 「串门帮忙」挑农场时给「玩家农场」的权重。
 *
 * 和偷菜的 PLAYER_FARM_WEIGHT 分开：帮忙是另一回事 ——
 * 32 个邻居分 33 座农场，权重不给足，玩家农场长期没人管，
 * 离线几天回来一片缺水生虫，高好感邻居像白交了一样
 * （2026-10-24 用户反馈「我有很多好感度高的邻居，他们上线时应该会帮我打理啊」）。
 */
export const CARE_PLAYER_WEIGHT = 3;

/* ---------- 在线时长 ---------- */

/**
 * NPC「在线」状态持续多久（分钟）—— 按**性格**定基调：
 * 热心 / 勤勉的老在村里转悠，悠闲 / 爱占便宜的神龙见首不见尾。
 * 上线一次就把 `onlineUntil` 设成「上线时刻 + 这个时长」（见 npc-sim 的
 * beginVisit），邻居页的绿点与「偷在线邻居被狗抓住双倍惩罚」都看它。
 *
 * 第 44 轮：整体砍半（原来 10~30 分钟，现在 5~15 分钟）——
 * 玩家在线时邻居挂着绿点的时间太长，串门动作显得没完没了。
 */
export const ONLINE_MINUTES = {
  diligent: [26, 30],
  scholar: [22, 28],
  friendly: [26, 30],
  boss: [19, 26],
  thrifty: [16, 22],
  merchant: [16, 22],
  leisurely: [10, 16],
  greedy: [10, 16],
};

/**
 * **身份**（职业）对在线时长的微调：退休的老有空，跑外的没空。
 * 命中一条关键词就加 / 减，都不命中不调整。
 */
const ONLINE_PROFESSION_BONUS = [
  { keys: ['退休'], bonus: 2 },
  { keys: ['司机', '主播'], bonus: -2 },
  { keys: ['学生', '技术员', '老师'], bonus: -1 },
];

/**
 * 这位邻居这次上线要「挂机」多久（毫秒）。
 * 5~15 分钟封顶：性格定区间、身份微调、再掷 ±1 分钟浮动。
 * @param {{personality: string, profession?: string}} npc
 * @returns {number}
 */
export function onlineMs(npc) {
  const range = ONLINE_MINUTES[npc.personality] || [8, 11];
  const prof = npc.profession || '';
  const bonus = ONLINE_PROFESSION_BONUS.find((r) => r.keys.some((k) => prof.includes(k)))?.bonus || 0;
  const minutes = randInt(range[0], range[1]) + bonus + randInt(-1, 1);
  return Math.min(15, Math.max(5, minutes)) * 60_000;
}

/** 这位邻居现在是否在线（onlineUntil 是 ms 时间戳，缺省 0 = 不在线） */
export const isNpcOnline = (npc, now = Date.now()) => now < (npc.onlineUntil || 0);

/** 单个 NPC 单次结算的会话数上限（兜底，正常远达不到） */
export const MAX_VISITS_PER_NPC = 4000;

/* ---------- 上线时间 ---------- */

/**
 * 从 at 起的下一次上线时间
 *
 * 固定钟点型：取 at 之后最近的一个钟点（带浮动）；今天的都过了就明天第一个。
 * 间隔型：at + [min, max] 小时的随机落点。
 *
 * @param {{schedule?: object}} npc
 * @param {number} at 毫秒时间戳
 * @returns {number}
 */
export function nextVisitAt(npc, at) {
  const schedule = npc.schedule || DEFAULT_INTERVAL;

  if (schedule.type === 'fixed') {
    const hours = [...schedule.hours].sort((a, b) => a - b);
    for (const hour of hours) {
      const day = new Date(at);
      day.setHours(hour, 0, 0, 0);
      const candidate = day.getTime() + randInt(-FIXED_JITTER, FIXED_JITTER);
      if (candidate > at) return candidate;
    }
    const next = new Date(at);
    next.setDate(next.getDate() + 1);
    next.setHours(hours[0], 0, 0, 0);
    return next.getTime() + randInt(-FIXED_JITTER, FIXED_JITTER);
  }

  return at + randInt(schedule.min * HOUR, schedule.max * HOUR);
}

/**
 * 这位邻居平均多久上线一次，用来给离线结算估进度
 * @param {{schedule?: object}} npc
 * @returns {number} 毫秒
 */
export function expectedGapMs(npc) {
  const schedule = npc.schedule || DEFAULT_INTERVAL;
  if (schedule.type === 'fixed') return DAY / Math.max(1, schedule.hours.length);
  return ((schedule.min + schedule.max) / 2) * HOUR;
}

/* ---------- 日志保留 ---------- */

/**
 * 日志（玩家农场日志 / 邻居动态）统一保留这么多天。
 *
 * **只按天、不设条数上限**：早年玩家农场日志两个 tab 共用 60 条，
 * 玩家自己一天的操作就能把「邻居动向」挤光，看起来像没保存
 * （2026-10-24 用户反馈）；邻居自己的动态也曾压到 10 条，同样不按天。
 */
export const LOG_KEEP_DAYS = 7;

/**
 * 按时间裁剪一条日志列表（原地改）。
 *
 * 数组是按写入顺序存的（最新在前），但邻居结算会补写过去的时间点，
 * 所以不能假设它有序 —— 必须 filter，不能从头截断。
 * @param {Array<{at: number}>} list
 * @param {number} [now]
 */
export function trimLog(list, now = Date.now()) {
  const cutoff = now - LOG_KEEP_DAYS * 86_400_000;
  const kept = list.filter((entry) => entry.at >= cutoff);
  list.length = 0;
  list.push(...kept);
}

/* ---------- 守护犬 ---------- */

/**
 * 邻居家的狗：品种 + 饱腹度。
 *
 * 玩家的狗有十个品种可选（见 data/dogs.js），邻居的狗也有 ——
 * 等级越高越可能养得起好狗。他们的狗只看「基础拦截率 × 饱腹度」，
 * 和玩家同一套公式。
 */

/* ---------- 照料（浇水 / 捉虫）---------- */

/**
 * 浇水一次，当前阶段剩余时间缩减的比例
 */
export const WATER_SPEEDUP = 0.1;

/** 捉虫一次，产量增加的比例 */
export const PEST_YIELD_BONUS = 0.1;

/** 产量加成的上限（最多 +100%） */
export const BOOST_CAP = 1;

/**
 * 「什么时候该浇水 / 生虫」现在由 data/care.js 按次数随机排，
 * 不再是固定周期 —— 原来那组 WATER_INTERVAL / PEST_INTERVAL / CARE_JITTER
 * 常量已经删掉，需要排程请调用 care.js 的 nextCareAt / scheduleCare。
 */

/* ---------- 农场生成 ---------- */

/* 邻居的地块数量与玩家完全一致：按 PLOT_UNLOCK_LV 逐块解锁，最多 40 块。
   等级越高地越多，升级当场补上新地块（见 syncNpcPlots）。 */

/**
 * 一块「正在生长」的随机地块。
 *
 * 已生长 0~90%，其中一部分已经成熟可偷 —— 玩家一进去就有得看。
 * @param {number} id 地块在一座农场里的序号（plot 表用 [farmId, id] 做主键）
 * @param {string[]} pool 候选作物 id（已洗牌）
 * @param {number} at 参照时刻
 */
function randomNpcPlot(id, pool, at, soil = 'normal') {
  const cropId = pool[id % pool.length];
  const crop = CROPS[cropId];
  const total = npcGrowMs(crop);
  const elapsed = Math.random() * total * 0.9;
  const plot = {
    id,
    // 邻居的土地：等级够得着的档位里随机——他们不买地，但也该有点家底
    soil,
    cropId,
    harvested: 0,
    plantedAt: at - elapsed,
    readyAt: at - elapsed + total,
    total,
    stolenAt: 0,
    stolen: false,
    stolenCount: 0,
    boost: 0,
    waterNext: 0,
    pestNext: 0,
    waterTimes: 0,
    pestTimes: 0,
  };
  // 从「现在」往后排：刚生成的一座农场不该一进门就满地待照料
  scheduleCare(plot, at);
  return plot;
}

/**
 * 生成一座邻居农场的初始地块。
 *
 * 地块**全部种满**且尽量不重样：一座满地空地的农场，玩家没有拜访的欲望。
 * 每块地的生长进度各不相同。
 */
export function generateNpcPlots(npc, at = Date.now()) {
  const pool = shuffled(cropsNearLevel(npc.level));
  return Array.from(
    { length: unlockedPlotCount(npc.level) },
    (_, i) => randomNpcPlot(i, pool, at, rollNpcSoil(npc.level)),
  );
}

/**
 * 邻居地块的土地档位。
 *
 * 邻居不会去买地，但等级高的人家总该有几块好地 ——
 * 否则玩家点进邻居页，看到的永远是 40 格一模一样的黄土地。
 * 只从「等级够得着」的档位里挑，所以低等级邻居依然是普通地。
 *
 * @param {number} level 邻居等级
 * @returns {string} SOILS 的键
 */
export function rollNpcSoil(level) {
  if (Math.random() >= Math.min(0.5, level / 90)) return 'normal';
  const pool = Object.keys(SOILS).filter((id) => id !== 'normal' && SOILS[id].unlock <= level);
  if (!pool.length) return 'normal';
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 把地块数量补齐到等级对应的解锁数。
 *
 * 三个调用场景：邻居升级（模拟中）、读档时旧档只有寥寥几块地、
 * 以及远期聚合后等级跳了一截。补的地块**直接种上**随机作物 ——
 * 和初始生成一个口径，农场看起来是「活着」的。
 *
 * @param {object} npc 邻居农场
 * @param {number} [at] 参照时刻
 */
export function syncNpcPlots(npc, at = Date.now()) {
  const want = unlockedPlotCount(npc.level);
  if (npc.plots.length >= want) return;
  const pool = shuffled(cropsNearLevel(npc.level));
  for (let id = npc.plots.length; id < want; id += 1) {
    npc.plots.push(randomNpcPlot(id, pool, at, rollNpcSoil(npc.level)));
  }
}

/**
 * 邻居挑作物时的等级窗口：只看「自己等级往下这么多级」的作物。
 * 70 级的村长还在种小麦并不合理，所以池子要跟着等级往上收窄。
 * 但高等级的作物分布稀疏，窗口里可能只剩两三种，一座农场就会
 * 整齐划一像复制粘贴 —— 所以池子里作物太少时继续往下放宽。
 */
const CROP_WINDOW = 10;

/** 池子里至少保留这么多种作物，保证一座农场看起来是「杂着种」的 */
const CROP_POOL_MIN = 8;

/**
 * 该等级附近的作物 id
 * @param {number} level
 * @returns {string[]}
 */
export function cropsNearLevel(level) {
  const usable = Object.keys(CROPS)
    // 限定作物只能从藏宝图挖到，邻居的日常种植池里不该出现
    .filter((id) => !CROPS[id].special && CROPS[id].lv <= level)
    // 按等级从高到低，放宽窗口时是从「最接近等级」的那一端往外拿
    .sort((a, b) => CROPS[b].lv - CROPS[a].lv);

  const near = usable.filter((id) => CROPS[id].lv > level - CROP_WINDOW);
  return near.length >= CROP_POOL_MIN ? near : usable.slice(0, CROP_POOL_MIN);
}

/**
 * Fisher–Yates 洗牌（返回新数组，不改动入参）
 * @template T
 * @param {T[]} list
 * @returns {T[]}
 */
export function shuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 邻居作物的成熟时长。
 *
 * 与玩家**完全一致** —— 同样的作物、同样的等待时间，
 * 没有额外的倍率也没有上限。邻居就是「另一个玩家」：
 * 他们种什么、什么时候收、拿到多少经验，都和玩家一样。
 */
export function npcGrowMs(crop) {
  return crop.grow * 1000;
}

/** 空地 */
export const emptyNpcPlot = () => ({
  cropId: null,
  harvested: 0,
  plantedAt: 0,
  readyAt: 0,
  total: 0,
  stolenAt: 0,
  /** 本轮是否已被偷过（重新种下后刷新） */
  stolen: false,
  /** 本轮被偷走了多少个 */
  stolenCount: 0,
  /** 本轮被守护犬拦下过：整座农场都不能再偷 */
  guarded: false,
  boost: 0,
  /** 下一次需要浇水 / 杀虫的时间（0 = 本轮不会再需要）与已处理次数 */
  waterNext: 0,
  pestNext: 0,
  waterTimes: 0,
  pestTimes: 0,
});
