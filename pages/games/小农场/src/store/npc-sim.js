/**
 * 邻居离线模拟引擎。
 *
 * 核心模型：每个 NPC 有一个「下次上线时间」，上线一次就执行 2~4 个行为，
 * 然后重新掷一个 8~16 小时间隔（平均每天 2 次），之后进入待机。
 *
 * 结算方式：玩家进入邻居页时，对每个 NPC 从上次结算点一路跑到「现在」。
 * 为了让「离线一年回来」也不会卡死，结算分两段：
 *   - 远期（超过 7 天）：用聚合公式一次性推进等级与财富，不记日志；
 *   - 近期（7 天内）：逐条执行上线会话，行为写进动态日志给玩家看。
 *
 * 这个模块是纯计算，不碰存储也不碰 DOM：
 * 它只负责把 NPC 对象从旧状态推到新状态，由调用方决定何时落盘。
 */
import { CROPS, expOf } from '../data/crops.js';
import { expForLevel, MAX_LEVEL } from '../data/progression.js';
import { randInt, safeNum } from '../core/utils.js';
import {
  ACTIONS_PER_VISIT,
  ADVENTURE_CHANCE,
  ADVENTURE_SUCCESS,
  BOOST_CAP,
  CARE_JITTER,
  DETAILED_WINDOW,
  LOG_LIMIT,
  MAX_VISITS_PER_NPC,
  PERSONALITIES,
  PEST_INTERVAL,
  PEST_YIELD_BONUS,
  STEAL_YIELD_PENALTY,
  VISIT_GAP_MAX,
  VISIT_GAP_MIN,
  WATER_INTERVAL,
  cropsNearLevel,
  emptyNpcPlot,
  npcGrowMs,
  npcPlotCount,
  shuffled,
} from '../data/friends.js';

const HOUR = 3600_000;

/* ============================================================
   随机选择
   ============================================================ */

const randFloat = () => Math.random();
const pick = (list) => list[randInt(0, list.length - 1)];

/** 按权重抽一个行为 */
function weightedPick(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [key, w] of entries) {
    roll -= w;
    if (roll <= 0) return key;
  }
  return entries[0][0];
}

/** 掷下一次上线的间隔 */
const rollGap = () => randInt(VISIT_GAP_MIN, VISIT_GAP_MAX);

/** 新建一条动态 */
function log(npc, at, emoji, text) {
  npc.log.unshift({ at, emoji, text });
  if (npc.log.length > LOG_LIMIT) npc.log.length = LOG_LIMIT;
}

/** 补齐后来新增的字段，兼容旧存档 */
export function normalizeNpc(npc, fallback) {
  const personality = PERSONALITIES[npc.personality] ? npc.personality : fallback.personality;
  npc.personality = personality;
  npc.coins = safeNum(npc.coins, fallback.coins);
  npc.exp = safeNum(npc.exp, 0);
  npc.level = safeNum(npc.level, fallback.level);
  npc.lastVisitAt = safeNum(npc.lastVisitAt, 0);
  npc.nextVisitAt = safeNum(npc.nextVisitAt, 0);
  npc.log ??= [];

  npc.plots = (npc.plots || []).map((p) => {
    const plot = { ...emptyNpcPlot(), ...p };
    // 同样要逐个清洗时间戳：存档里可能是 undefined
    for (const key of ['plantedAt', 'readyAt', 'total', 'waterAt', 'pestAt', 'stolenAt']) {
      plot[key] = safeNum(plot[key], 0);
    }
    plot.boost = safeNum(plot.boost, 0);
    plot.harvested = safeNum(plot.harvested, 0);
    return plot;
  });
  return npc;
}

/* ============================================================
   成长
   ============================================================ */

function gainExp(npc, amount) {
  npc.exp += amount;
  while (npc.level < MAX_LEVEL && npc.exp >= expForLevel(npc.level)) {
    npc.exp -= expForLevel(npc.level);
    npc.level += 1;
  }
  if (npc.level >= MAX_LEVEL) npc.exp = 0;
}

/* ============================================================
   单个行为
   ============================================================ */

/** 收获所有成熟的地 */
function actHarvest(npc, at) {
  let acted = false;
  let totalValue = 0;
  let count = 0;

  for (const plot of npc.plots) {
    if (!plot.cropId || at < plot.readyAt) continue;
    const crop = CROPS[plot.cropId];

    const amount = randInt(crop.yield[0], crop.yield[1]);
    // 邻居捉过虫的地也有产量加成
    let boosted = Math.floor(amount * (1 + (plot.boost || 0)));
    // 被偷过的地，剩余产量对邻居减半
    if (plot.stolenCount) {
      boosted = Math.floor(boosted * (1 - STEAL_YIELD_PENALTY));
    }
    totalValue += boosted * crop.sell;
    count += 1;
    // 与玩家完全一致的经验公式：总时间/4×等级 + 等级×个数
    gainExp(npc, expOf(plot.total / 1000, crop.lv, boosted));

    // 多次收获作物进入再生轮次，否则清空这块地
    plot.harvested = (plot.harvested || 0) + 1;
    if (plot.harvested >= crop.harvests) {
      Object.assign(plot, emptyNpcPlot());
    } else {
      const regrow = Math.max(30_000, Math.floor(plot.total * crop.regrow));
      plot.plantedAt = at;
      plot.readyAt = at + regrow;
      plot.total = regrow;
    }
    acted = true;
  }

  if (!acted) return null;
  npc.coins += totalValue;
  return { emoji: '🌾', text: `收获了一批作物，+${formatCoins(totalValue)} 💰`, exp: 0 };
}

/** 在空地上播种 */
function actPlant(npc, at) {
  const empties = npc.plots.filter((p) => !p.cropId);
  if (!empties.length) return null;

  const pool = cropsNearLevel(npc.level);
  if (!pool.length) return null;

  // 已经在长的作物先占位，尽量让整座农场不重样
  const used = new Set(npc.plots.filter((p) => p.cropId).map((p) => p.cropId));
  let bag = shuffled(pool.filter((id) => !used.has(id)));

  const names = [];
  for (const plot of empties) {
    if (!bag.length) bag = shuffled(pool);
    const cropId = bag.pop();
    const crop = CROPS[cropId];
    const total = npcGrowMs(crop);

    plot.cropId = cropId;
    plot.harvested = 0;
    plot.plantedAt = at;
    plot.total = total;
    plot.readyAt = at + total;
    plot.stolenAt = 0;
    plot.stolen = false;
    plot.stolenCount = 0;
    plot.boost = 0;
    // 邻居也会遇到缺水与生虫，这是玩家能插手的地方
    plot.waterAt = at + WATER_INTERVAL * (1 - CARE_JITTER + Math.random() * CARE_JITTER * 2);
    plot.pestAt = at + PEST_INTERVAL * (1 - CARE_JITTER + Math.random() * CARE_JITTER * 2);
    names.push(`${crop.emoji}${crop.name}`);
  }

  gainExp(npc, 4 * names.length);
  const head = names.slice(0, 2).join('、');
  return { emoji: '🌱', text: `种下了 ${names.length} 块地：${head}${names.length > 2 ? ' 等' : ''}`, exp: 0 };
}

/** 打理：给缺水的地浇水、给生虫的地捉虫 */
function actTend(npc, at) {
  let tended = 0;
  for (const plot of npc.plots) {
    if (!plot.cropId) continue;
    if (at >= (plot.waterAt || 0)) {
      plot.waterAt = at + WATER_INTERVAL;
      tended += 1;
    }
    if (at >= (plot.pestAt || 0)) {
      plot.pestAt = at + PEST_INTERVAL;
      plot.boost = Math.min(BOOST_CAP, (plot.boost || 0) + PEST_YIELD_BONUS);
      tended += 1;
    }
  }
  if (!tended) return null;

  gainExp(npc, 6 * tended);
  return { emoji: '🧹', text: `打理了 ${tended} 块地，浇了水也除了虫`, exp: 0 };
}

/** 去别的邻居那儿偷菜。规则和玩家一样：每块地每轮只能被偷一次 */
function actSteal(npc, neighbours, at) {
  if (neighbours.length < 2) return null;
  if (Math.random() > 0.6) return null;

  const victims = neighbours.filter((n) => n !== npc);
  const victim = pick(victims);
  const ripe = victim.plots.filter(
    (p) => p.cropId && at >= p.readyAt && !p.stolen,
  );
  if (!ripe.length) return null;

  const plot = pick(ripe);
  const crop = CROPS[plot.cropId];
  plot.stolen = true;
  plot.stolenCount = (plot.stolenCount || 0) + 1;
  plot.stolenAt = at;

  npc.coins += crop.sell;
  gainExp(npc, Math.floor(crop.exp * 0.5) + 6);
  return { emoji: '🥷', text: `从 ${victim.name} 那儿顺走了 ${crop.emoji}${crop.name}`, exp: 0 };
}

/** 冒险：小概率暴富，多数时候空手而归 */
function actAdventure(npc, at) {
  if (Math.random() > ADVENTURE_CHANCE) return null;

  gainExp(npc, 20);
  if (Math.random() < ADVENTURE_SUCCESS) {
    const prize = Math.round(npc.coins * randFloat() * 0.5) + 500;
    npc.coins += prize;
    return { emoji: '🎲', text: `去山里转了一圈，捡到 ${formatCoins(prize)} 💰`, exp: 0 };
  }
  return { emoji: '🎲', text: '去山里转了一圈，空手而归', exp: 0 };
}

/** 万以内显示原数，超过后用「万」缩写，避免界面被长数字撑破 */
export function formatCoins(n) {
  if (n < 10_000) return String(n);
  if (n < 100_000_000) return `${(n / 10_000).toFixed(1)}万`;
  return `${(n / 100_000_000).toFixed(2)}亿`;
}

/* ============================================================
   一次上线会话
   ============================================================ */

const ACTIONS = {
  harvest: actHarvest,
  plant: actPlant,
  tend: actTend,
  steal: actSteal,
  adventure: actAdventure,
};

/**
 * 执行一次上线会话。
 * @param {object} npc
 * @param {object[]} neighbours 全部 NPC，用于互相偷菜
 * @param {number} at 本次上线时间戳
 * @param {boolean} record 是否写动态日志（远期聚合不写）
 */
function runVisit(npc, neighbours, at, record) {
  const weights = PERSONALITIES[npc.personality].weights;
  const want = randInt(ACTIONS_PER_VISIT[0], ACTIONS_PER_VISIT[1]);
  const seen = new Set();

  for (let i = 0; i < want; i += 1) {
    let action = weightedPick(weights);
    // 避免一次上线里重复做同一件事
    let guard = 0;
    while (seen.has(action) && guard < 4) {
      action = weightedPick(weights);
      guard += 1;
    }
    seen.add(action);

    const result = ACTIONS[action](npc, neighbours, at);
    if (record && result) log(npc, at, result.emoji, result.text);
  }

  npc.lastVisitAt = at;
  npc.nextVisitAt = at + rollGap();
}

/* ============================================================
   远期聚合
   ============================================================ */

/**
 * 把 NPC 从当前时间直接推进到 until，不逐条执行会话。
 * 用于超过精细模拟窗口的长离线，只能得到「总量」而非「过程」。
 */
function bulkAdvance(npc, until) {
  const span = Math.max(HOUR, until - (npc.lastVisitAt || until - HOUR));
  const visits = Math.round((span / (24 * HOUR)) * 2);

  // 每次上线的平均收益：收获越多、地块越多、等级越高越多
  const plotValue = npc.plots.reduce((sum, p) => {
    if (!p.cropId) return sum;
    return sum + CROPS[p.cropId].sell * 1.5;
  }, 0);
  const perVisitCoins = plotValue * 0.6;
  npc.coins += Math.round(perVisitCoins * visits);

  // 经验按同等级区间的作物平均值估算
  const pool = cropsNearLevel(npc.level);
  const avgExp = pool.length
    ? pool.reduce((sum, id) => sum + CROPS[id].exp, 0) / pool.length
    : 10;
  gainExp(npc, Math.round(avgExp * npc.plots.length * 0.5 * visits));

  // 地里作物按随机进度重建，保证状态看起来是「正在长的」，且尽量不重样
  const poolNow = shuffled(cropsNearLevel(npc.level));
  npc.plots.forEach((plot, i) => {
    if (!poolNow.length) return;
    const cropId = poolNow[i % poolNow.length];
    const total = npcGrowMs(CROPS[cropId]);
    const elapsed = randFloat() * total;
    Object.assign(plot, {
      cropId,
      harvested: 0,
      plantedAt: until - elapsed,
      readyAt: until - elapsed + total,
      total,
      stolenAt: 0,
      stolen: false,
      stolenCount: 0,
      boost: 0,
      waterAt: until + WATER_INTERVAL * (1 - CARE_JITTER + randFloat() * CARE_JITTER * 2),
      pestAt: until + PEST_INTERVAL * (1 - CARE_JITTER + randFloat() * CARE_JITTER * 2),
    });
  });

  npc.lastVisitAt = until;
  npc.nextVisitAt = until + rollGap();
}

/* ============================================================
   对外入口
   ============================================================ */

/** 这批 NPC 要结算多少个会话，用来给等待画面算进度 */
export function estimateWork(npcs, now) {
  const boundary = now - DETAILED_WINDOW;
  let detailed = 0;
  for (const npc of npcs) {
    const from = Math.max(npc.nextVisitAt || now, boundary);
    if (from > now) continue;
    detailed += Math.min(MAX_VISITS_PER_NPC, Math.round((now - from) / ((VISIT_GAP_MIN + VISIT_GAP_MAX) / 2)));
  }
  return detailed;
}

/**
 * 把一位邻居推进到当前时间。
 * @param {object} npc
 * @param {object[]} npcs 全部 NPC
 * @param {number} now
 * @returns {number} 本次实际精细模拟的会话数
 */
export function simulateNpc(npc, npcs, now) {
  const boundary = now - DETAILED_WINDOW;
  let detailed = 0;
  let guard = 0;

  while ((npc.nextVisitAt || 0) <= now && guard < MAX_VISITS_PER_NPC) {
    guard += 1;
    if (npc.nextVisitAt < boundary) {
      bulkAdvance(npc, boundary);
    } else {
      runVisit(npc, npcs, npc.nextVisitAt, true);
      detailed += 1;
    }
  }
  return detailed;
}

/**
 * 估算这位邻居距离下一次上线还有多久，用于「在线/待机」状态展示。
 * @returns {{online: boolean, inMs: number}}
 */
export function npcPresence(npc, now = Date.now()) {
  const next = npc.nextVisitAt || now;
  const inMs = Math.max(0, next - now);
  // 待机中的 NPC 记作刚刚才上线过，避免整页显示成一片「在线」
  return { online: inMs > 0 && now - (npc.lastVisitAt || 0) < 30 * 60_000, inMs };
}

export { LOG_LIMIT, npcPlotCount };