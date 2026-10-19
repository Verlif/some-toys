/**
 * 邻居 NPC 定义与离线模拟规则。
 *
 * 邻居是完全离线的：他们每天随机上线若干次，每次做几件事，然后待机。
 * 玩家什么时候打开游戏、什么时候进入邻居页，都不影响他们的成长节奏，
 * 进度由「上次结算时间 → 现在」的时间差补算出来。
 */
import { CROPS } from './crops.js';

/* ---------- 性格：决定上线时各行为的权重 ---------- */
export const PERSONALITIES = {
  diligent: { name: '勤勉', weights: { harvest: 4, plant: 4, tend: 3, steal: 1, adventure: 1 } },
  thrifty: { name: '精打细算', weights: { harvest: 3, plant: 2, tend: 2, steal: 2, adventure: 1 } },
  merchant: { name: '生意人', weights: { harvest: 2, plant: 2, tend: 2, steal: 4, adventure: 2 } },
  scholar: { name: '爱钻研', weights: { harvest: 2, plant: 3, tend: 4, steal: 1, adventure: 3 } },
  leisurely: { name: '悠闲', weights: { harvest: 2, plant: 1, tend: 1, steal: 2, adventure: 2 } },
  greedy: { name: '爱占便宜', weights: { harvest: 2, plant: 2, tend: 1, steal: 5, adventure: 1 } },
  friendly: { name: '热心', weights: { harvest: 3, plant: 3, tend: 4, steal: 1, adventure: 1 } },
  boss: { name: '场面人', weights: { harvest: 3, plant: 3, tend: 2, steal: 3, adventure: 2 } },
};

/* ---------- 15 位邻居 ---------- */
export const NPCS = [
  { id: 'npc01', name: '王大爷', avatar: '👴', personality: 'diligent', level: 6, coins: 800 },
  { id: 'npc02', name: '李大婶', avatar: '👩', personality: 'thrifty', level: 9, coins: 1200 },
  { id: 'npc03', name: '小芳', avatar: '👧', personality: 'friendly', level: 13, coins: 2400 },
  { id: 'npc04', name: '赵老板', avatar: '🧔', personality: 'merchant', level: 18, coins: 5200 },
  { id: 'npc05', name: '陈老师', avatar: '👩‍🏫', personality: 'scholar', level: 24, coins: 9000 },
  { id: 'npc06', name: '老王头', avatar: '🧓', personality: 'leisurely', level: 10, coins: 1500 },
  { id: 'npc07', name: '张婶婶', avatar: '👵', personality: 'friendly', level: 16, coins: 3800 },
  { id: 'npc08', name: '刘大哥', avatar: '👨', personality: 'diligent', level: 20, coins: 4600 },
  { id: 'npc09', name: '林妹妹', avatar: '👩‍🦱', personality: 'greedy', level: 28, coins: 12000 },
  { id: 'npc10', name: '周老板', avatar: '🧑‍💼', personality: 'boss', level: 35, coins: 26000 },
  { id: 'npc11', name: '郑爷爷', avatar: '👴', personality: 'scholar', level: 22, coins: 6000 },
  { id: 'npc12', name: '黄阿姨', avatar: '👩‍🦰', personality: 'thrifty', level: 30, coins: 14000 },
  { id: 'npc13', name: '吴秀才', avatar: '🎓', personality: 'scholar', level: 42, coins: 40000 },
  { id: 'npc14', name: '孙大厨', avatar: '🧑‍🍳', personality: 'merchant', level: 55, coins: 90000 },
  { id: 'npc15', name: '村长', avatar: '👨‍🌾', personality: 'boss', level: 70, coins: 200000 },
];

/* ---------- 模拟节奏 ---------- */
const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** 一天平均上线次数 */
export const VISITS_PER_DAY = 2;

/** 上线间隔区间（随机落点），8~16 小时正好平均每天 2 次 */
export const VISIT_GAP_MIN = 8 * HOUR;
export const VISIT_GAP_MAX = 16 * HOUR;

/** 上线时触发「冒险」的概率 */
export const ADVENTURE_CHANCE = 0.16;

/** 冒险成功的概率（其余为空手而归） */
export const ADVENTURE_SUCCESS = 0.45;

/** 每次上线平均执行的动作数 */
export const ACTIONS_PER_VISIT = [2, 4];

/**
 * 精细模拟的时间窗口：只有这段时间内的上线会被逐条执行并写进动态日志，
 * 更久远的部分用聚合公式一次性结算，否则离线几个月会把浏览器卡死。
 */
export const DETAILED_WINDOW_DAYS = 7;
export const DETAILED_WINDOW = DETAILED_WINDOW_DAYS * DAY;

/** 单个 NPC 单次结算的会话数上限（兜底，正常远达不到） */
export const MAX_VISITS_PER_NPC = 4000;

/* ---------- 偷菜规则 ---------- */

/**
 * 玩家偷走一个作物后，这块地本轮产量对邻居减半的比例。
 * 偷是有代价的：邻居只能收一半。
 */
export const STEAL_YIELD_PENALTY = 0.5;

/** 剩余产量低于原版产量的这个比例时，就不能再偷了 */
export const STEAL_MIN_REMAIN_RATIO = 0.5;

/* ---------- 玩家与邻居互动 ---------- */

/** 守护犬在位时，偷菜被当场抓住的概率 */
export const DOG_CATCH_CHANCE = 0.5;

/** 守护犬一次喂食维持的时间（毫秒） */
export const DOG_GUARD_DURATION = 30 * 60_000;

/** 每个 NPC 保留的动态条数 */
export const LOG_LIMIT = 6;

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
export function npcPlotCount(level) {
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
    .filter((id) => CROPS[id].lv <= level)
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
  boost: 0,
  waterAt: 0,
  pestAt: 0,
});