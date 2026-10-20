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
import { randInt } from '../core/utils.js';

/* ---------- 性格：决定上线时各行为的权重 ---------- */
export const PERSONALITIES = {
  diligent: { name: '勤勉', weights: { harvest: 4, plant: 4, tend: 3 } },
  thrifty: { name: '精打细算', weights: { harvest: 3, plant: 2, tend: 2 } },
  merchant: { name: '生意人', weights: { harvest: 2, plant: 2, tend: 1 } },
  scholar: { name: '爱钻研', weights: { harvest: 2, plant: 3, tend: 4 } },
  leisurely: { name: '悠闲', weights: { harvest: 2, plant: 1, tend: 1 } },
  greedy: { name: '爱占便宜', weights: { harvest: 2, plant: 2, tend: 1 } },
  friendly: { name: '热心', weights: { harvest: 3, plant: 3, tend: 4 } },
  boss: { name: '场面人', weights: { harvest: 3, plant: 3, tend: 2 } },
};

/* ---------- 偷菜倾向 ---------- */

/**
 * 偷菜倾向 → 每次上线真的动手的概率。
 *
 * 单独抽出来而不是混进性格权重：「偷不偷」是邻居之间最直观的差异，
 * 玩家被顺几次就能记住谁手不干净，而不是靠概率表算出来的错觉。
 */
export const STEAL_CHANCE = { never: 0, rare: 0.12, often: 0.45, always: 0.9 };

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
    schedule: { type: 'fixed', hours: [6, 18] }, steal: 'rare' },
  { id: 'npc02', name: '李大婶', avatar: '👩', personality: 'thrifty', profession: '家庭主妇',
    schedule: { type: 'fixed', hours: [7] }, steal: 'rare' },
  { id: 'npc03', name: '小芳', avatar: '👧', personality: 'friendly', profession: '农大学生',
    schedule: { type: 'fixed', hours: [17, 21] }, steal: 'never' },
  { id: 'npc04', name: '赵老板', avatar: '🧔', personality: 'merchant', profession: '水果贩子',
    schedule: { type: 'interval', min: 4, max: 10 }, steal: 'always' },
  { id: 'npc05', name: '陈老师', avatar: '👩‍🏫', personality: 'scholar', profession: '小学教师',
    schedule: { type: 'fixed', hours: [7, 19] }, steal: 'never' },
  { id: 'npc06', name: '老王头', avatar: '🧓', personality: 'leisurely', profession: '钓鱼佬',
    schedule: { type: 'interval', min: 8, max: 16 }, steal: 'rare' },
  { id: 'npc07', name: '张婶婶', avatar: '👵', personality: 'friendly', profession: '面点摊主',
    schedule: { type: 'interval', min: 6, max: 12 }, steal: 'never' },
  { id: 'npc08', name: '刘大哥', avatar: '👨', personality: 'diligent', profession: '货车司机',
    schedule: { type: 'interval', min: 3, max: 9 }, steal: 'often' },
  { id: 'npc09', name: '林妹妹', avatar: '👩‍🦱', personality: 'greedy', profession: '带货主播',
    schedule: { type: 'interval', min: 2, max: 8 }, steal: 'always' },
  { id: 'npc10', name: '周老板', avatar: '🧑‍💼', personality: 'boss', profession: '农资经销商',
    schedule: { type: 'interval', min: 5, max: 14 }, steal: 'often' },
  { id: 'npc11', name: '郑爷爷', avatar: '👴', personality: 'scholar', profession: '退休会计',
    schedule: { type: 'fixed', hours: [8, 20] }, steal: 'never' },
  { id: 'npc12', name: '黄阿姨', avatar: '👩‍🦰', personality: 'thrifty', profession: '裁缝',
    schedule: { type: 'fixed', hours: [9, 21] }, steal: 'rare' },
  { id: 'npc13', name: '吴秀才', avatar: '🎓', personality: 'scholar', profession: '农技站技术员',
    schedule: { type: 'fixed', hours: [6, 15] }, steal: 'never' },
  { id: 'npc14', name: '孙大厨', avatar: '🧑‍🍳', personality: 'merchant', profession: '农家乐老板',
    schedule: { type: 'interval', min: 4, max: 12 }, steal: 'often' },
  { id: 'npc15', name: '村长', avatar: '👨‍🌾', personality: 'boss', profession: '村长',
    schedule: { type: 'fixed', hours: [7, 18] }, steal: 'rare' },
  { id: 'npc16', name: '何师傅', avatar: '🚚', personality: 'leisurely', profession: '长途司机',
    schedule: { type: 'interval', min: 6, max: 16 }, steal: 'rare' },
  { id: 'npc17', name: '小雨', avatar: '🌷', personality: 'friendly', profession: '花店店主',
    schedule: { type: 'fixed', hours: [8, 20] }, steal: 'never' },
  { id: 'npc18', name: '老支书', avatar: '👴', personality: 'boss', profession: '退休支书',
    schedule: { type: 'fixed', hours: [6] }, steal: 'rare' },
  { id: 'npc19', name: '阿满', avatar: '🧑‍🌾', personality: 'diligent', profession: '种粮大户',
    schedule: { type: 'fixed', hours: [5, 17] }, steal: 'rare' },
  { id: 'npc20', name: '米雪', avatar: '🍰', personality: 'thrifty', profession: '烘焙师',
    schedule: { type: 'interval', min: 3, max: 10 }, steal: 'often' },
  { id: 'npc21', name: '胖婶', avatar: '👩‍🍳', personality: 'greedy', profession: '早点摊主',
    schedule: { type: 'interval', min: 5, max: 11 }, steal: 'often' },
  { id: 'npc22', name: '老葛', avatar: '🧑‍🔧', personality: 'leisurely', profession: '退休木匠',
    schedule: { type: 'fixed', hours: [7, 19] }, steal: 'rare' },
  { id: 'npc23', name: '二丫', avatar: '🐑', personality: 'friendly', profession: '放羊娃',
    schedule: { type: 'interval', min: 4, max: 9 }, steal: 'never' },
  { id: 'npc24', name: '金链哥', avatar: '🕶️', personality: 'greedy', profession: '二手车商',
    schedule: { type: 'interval', min: 3, max: 7 }, steal: 'always' },
  { id: 'npc25', name: '秦阿姨', avatar: '🧹', personality: 'thrifty', profession: '保洁员',
    schedule: { type: 'fixed', hours: [6, 17] }, steal: 'rare' },
  { id: 'npc26', name: '大勇', avatar: '🔧', personality: 'diligent', profession: '修理工',
    schedule: { type: 'interval', min: 5, max: 12 }, steal: 'often' },
  { id: 'npc27', name: '柳先生', avatar: '📚', personality: 'scholar', profession: '中学老师',
    schedule: { type: 'fixed', hours: [7, 20] }, steal: 'never' },
  { id: 'npc28', name: '花姐', avatar: '🎀', personality: 'merchant', profession: '婚庆老板',
    schedule: { type: 'interval', min: 6, max: 14 }, steal: 'often' },
  { id: 'npc29', name: '老K', avatar: '🧢', personality: 'boss', profession: '网吧老板',
    schedule: { type: 'interval', min: 4, max: 10 }, steal: 'often' },
  { id: 'npc30', name: '石头', avatar: '🧒', personality: 'diligent', profession: '学徒工',
    schedule: { type: 'fixed', hours: [6, 18] }, steal: 'rare' },
  { id: 'npc31', name: '吴姐', avatar: '🍼', personality: 'thrifty', profession: '月嫂',
    schedule: { type: 'interval', min: 8, max: 16 }, steal: 'never' },
  { id: 'npc32', name: '赵六', avatar: '🧤', personality: 'greedy', profession: '收废品的',
    schedule: { type: 'interval', min: 2, max: 8 }, steal: 'always' },
];

/* ---------- 模拟节奏 ---------- */
const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** 固定钟点型上线的浮动：±30 分钟，免得所有邻居整点一起冒出来 */
const FIXED_JITTER = 30 * 60_000;

/** 没写 schedule 的邻居按这个区间上线 */
const DEFAULT_INTERVAL = { min: 8, max: 16 };

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
 * 精细模拟的时间窗口：只有这段时间内的上线会被逐条执行并写进动态日志，
 * 更久远的部分用聚合公式一次性结算，否则离线几个月会把浏览器卡死。
 */
export const DETAILED_WINDOW_DAYS = 7;
export const DETAILED_WINDOW = DETAILED_WINDOW_DAYS * DAY;

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

/* ---------- 守护犬 ---------- */

/**
 * 邻居家的狗：品种 + 饱腹度。
 *
 * 玩家的狗有十个品种可选（见 data/dogs.js），邻居的狗也有 ——
 * 等级越高越可能养得起好狗。他们的狗只看「基础拦截率 × 饱腹度」，
 * 和玩家同一套公式。
 */

/** 每个邻居保留的操作记录条数（玩家页最多显示 10 条） */
export const LOG_LIMIT = 10;

/* ---------- 照料（浇水 / 捉虫）---------- */

/** 作物多久会「缺水」，需要玩家或 NPC 浇水 */
export const WATER_INTERVAL = 6 * HOUR;

/** 作物多久会「生虫」，需要玩家或 NPC 捉虫 */
export const PEST_INTERVAL = 12 * HOUR;

/** 照料触发时间的随机浮动区间：实际是 interval × (1 ± 30%) */
export const CARE_JITTER = 0.3;

/** 浇水一次，当前阶段剩余时间缩减的比例 */
export const WATER_SPEEDUP = 0.1;

/** 捉虫一次，产量增加的比例 */
export const PEST_YIELD_BONUS = 0.1;

/** 产量加成的上限（最多 +100%） */
export const BOOST_CAP = 1;

/* ---------- 农场生成 ---------- */

/** 邻居的地块数量随等级增长 */
function npcPlotCount(level) {
  return Math.min(12, 4 + Math.floor(level / 8));
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

/**
 * 生成一座邻居农场的初始状态。
 *
 * 地块**全部种满**且尽量不重样：一座满地空地的农场，玩家没有拜访的欲望。
 * 每块地的生长进度各不相同，这样玩家一进去就有得看。
 */
export function generateNpcPlots(npc, at = Date.now()) {
  const pool = shuffled(cropsNearLevel(npc.level));
  const count = npcPlotCount(npc.level);

  return Array.from({ length: count }, (_, i) => {
    const cropId = pool[i % pool.length];
    const crop = CROPS[cropId];
    const total = npcGrowMs(crop);
    // 已生长 0~90%，其中一部分已经成熟可偷
    const elapsed = Math.random() * total * 0.9;
    return {
      /** 地块在一座农场里的序号：plot 表用 [farmId, id] 做主键 */
      id: i,
      cropId,
      harvested: 0,
      plantedAt: at - elapsed,
      readyAt: at - elapsed + total,
      total,
      stolenAt: 0,
      stolen: false,
      stolenCount: 0,
      boost: 0,
      waterAt: 0,
      pestAt: 0,
    };
  });
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
  waterAt: 0,
  pestAt: 0,
});