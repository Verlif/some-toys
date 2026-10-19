/**
 * 邻居离线模拟引擎。
 *
 * 核心模型：每个 NPC 有一个「下次上线时间」（固定钟点或随机间隔，
 * 见 data/friends.js 的 nextVisitAt），上线一次先做 2~4 件经营上的事，
 * 再按各自的偷菜倾向顺一手、按性格决定要不要帮玩家照料一块地。
 *
 * 结算方式：玩家进入邻居页时，对每个 NPC 从上次结算点一路跑到「现在」。
 * 为了让「离线一年回来」也不会卡死，结算分两段：
 *   - 远期（超过 7 天）：用聚合公式一次性推进等级与财富，不记日志，
 *     也不会动玩家农场（那一段没有足够的信息还原过程）；
 *   - 近期（7 天内）：逐条执行上线会话，行为写进双方日志。
 *
 * 这个模块是纯计算，不碰存储也不碰 DOM：
 * 它只负责把 NPC 对象从旧状态推到新状态，由调用方决定何时落盘。
 */
import { CROPS, expOf } from '../data/crops.js';
import { expForLevel, MAX_LEVEL } from '../data/progression.js';
import { NPC_ADVENTURE_CHANCE, rollNpcAdventure } from '../data/adventure.js';
import { randInt, safeNum } from '../core/utils.js';
import {
  ACTIONS_PER_VISIT,
  BOOST_CAP,
  CARE_JITTER,
  DETAILED_WINDOW,
  LOG_LIMIT,
  MAX_VISITS_PER_NPC,
  PERSONALITIES,
  PEST_INTERVAL,
  PEST_YIELD_BONUS,
  STEAL_CHANCE,
  WATER_INTERVAL,
  cropsNearLevel,
  emptyNpcPlot,
  expectedGapMs,
  nextVisitAt,
  npcGrowMs,
  npcStartCoins,
  rollNpcLevel,
  dogCatchChance,
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

/** 新建一条动态 */
function log(npc, at, emoji, text) {
  npc.log.unshift({ at, emoji, text });
  if (npc.log.length > LOG_LIMIT) npc.log.length = LOG_LIMIT;
}

/** 补齐后来新增的字段，兼容旧存档 */
export function normalizeNpc(npc, fallback) {
  const personality = PERSONALITIES[npc.personality] ? npc.personality : fallback.personality;
  npc.personality = personality;
  // 职业、上线节奏、偷菜倾向是老存档里没有的，用名单里的定义补上
  npc.profession = npc.profession || fallback.profession || '农夫';
  npc.schedule = npc.schedule || fallback.schedule;
  npc.steal = STEAL_CHANCE[npc.steal] === undefined ? (fallback.steal || 'rare') : npc.steal;
  npc.coins = safeNum(npc.coins, 0);
  npc.exp = safeNum(npc.exp, 0);
  npc.level = safeNum(npc.level, 1);
  // 只有明显损坏的等级才会重掷。起始区间现在是 1~36，
  // 但老存档里已经长到 50 级的邻居不该被「打回原形」——
  // 成长没有上限，等级本来就该一路涨上去
  if (npc.level < 1 || npc.level > MAX_LEVEL) npc.level = rollNpcLevel();
  if (!npc.coins) npc.coins = npcStartCoins(npc.level);
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

/**
 * 邻居的成长没有额外上限：和玩家一样一路涨到满级。
 *
 * 起始等级按 1~36 加权随机（低等级更多），之后完全按正常模拟走 ——
 * 玩家离线很久回来，会发现邻居真的在长大，而不是卡在某个数字上。
 */
function gainExp(npc, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return;
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
    // 被顺走过几个就少收几个 —— 不做「减半」这种翻倍惩罚
    boosted = Math.max(0, boosted - (plot.stolenCount || 0));
    totalValue += boosted * crop.sell;
    count += 1;
    // 与玩家完全一致的经验公式：总时间/4×等级 + 等级×个数
    gainExp(npc, expOf(crop.lv, boosted));

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

/**
 * 顺菜。
 *
 * 先按这位邻居的偷菜倾向掷一次，再从「所有成熟且本轮没被顺过」的地里挑一处；
 * 邻居家与玩家农场一视同仁 —— 偷玩家的时候会写进玩家日志，
 * 玩家收获时按 stolenCount 扣掉。
 *
 * @param {object} npc
 * @param {object[]} neighbours 其他 NPC
 * @param {?object} farm 玩家农场 { plots, stolen, cared, caught, log, dogSatietyAt }
 * @param {number} at
 * @returns {?{emoji: string, text: string, exp: number}}
 */
function actSteal(npc, neighbours, farm, at) {
  const chance = STEAL_CHANCE[npc.steal] || 0;
  if (!chance || Math.random() >= chance) return null;

  const targets = [];
  for (const other of neighbours) {
    if (other === npc) continue;
    for (const plot of other.plots) {
      if (plot.cropId && CROPS[plot.cropId] && at >= plot.readyAt && !plot.stolen) {
        targets.push({ plot, owner: other });
      }
    }
  }
  for (const plot of farm?.plots || []) {
    if (plot.cropId && CROPS[plot.cropId] && at >= plot.readyAt && !plot.stolen) {
      targets.push({ plot, owner: farm });
    }
  }
  if (!targets.length) return null;

  const { plot, owner } = pick(targets);
  const crop = CROPS[plot.cropId];
  const isPlayer = owner === farm;

  // 玩家农场有守护犬：饱腹度越高，被当场赶走的概率越大。
  // 被赶走时这一趟白跑 —— 作物没少、邻居也没拿到钱。
  if (isPlayer && farm.dogSatietyAt) {
    const satiety = farm.dogSatietyAt(at);
    if (satiety > 0 && Math.random() < dogCatchChance(satiety)) {
      farm.caught += 1;
      farm.log(at, '🐕', `守护犬把 ${npc.name} 赶走了（饱腹 ${Math.round(satiety)}%）`);
      return { emoji: '🐕', text: '溜进 农场主 家想顺菜，被守护犬赶了出来', exp: 0 };
    }
  }

  plot.stolen = true;
  plot.stolenCount = (plot.stolenCount || 0) + 1;
  plot.stolenAt = at;

  npc.coins += crop.sell;
  // 经验按作物等级给，和玩家照料同一套口径；
  // 旧代码取的是 crop.exp（根本没有这个字段），会让 npc.exp 变成 NaN
  gainExp(npc, Math.max(1, Math.round(crop.lv * 0.6)) + 4);

  if (isPlayer) {
    farm.stolen += 1;
    farm.log(at, '🥷', `${npc.name} 来你的农场，顺走了 ${crop.emoji}${crop.name} ×1`);
  }

  return {
    emoji: '🥷',
    text: `从${isPlayer ? '你的农场' : `${owner.name}家`}顺走了 ${crop.emoji}${crop.name}`,
    exp: 0,
  };
}

/**
 * 串门帮忙。
 *
 * 性格里的「打理」权重同时代表热心程度：热心的邻居经常顺手替玩家
 * 浇一块地、捉一次虫，悠闲的邻居基本不管闲事。
 * 只在**还没成熟**的地上动手 —— 成熟了就不再需要照料。
 *
 * @param {object} npc
 * @param {?object} farm 玩家农场 { plots, cared, log }
 * @param {number} at
 */
function actHelpPlayer(npc, farm, at) {
  if (!farm) return null;

  const weights = PERSONALITIES[npc.personality].weights;
  if (Math.random() >= Math.min(0.6, weights.tend * 0.12)) return null;

  const needs = farm.plots.filter((p) => p.cropId
    && CROPS[p.cropId]
    && at < p.readyAt
    && (at >= (p.waterAt || 0) || at >= (p.pestAt || 0)));
  if (!needs.length) return null;

  const plot = pick(needs);
  const crop = CROPS[plot.cropId];

  if (at >= (plot.waterAt || 0)) {
    plot.waterAt = at + WATER_INTERVAL * (1 - CARE_JITTER + Math.random() * CARE_JITTER * 2);
    farm.cared += 1;
    farm.log(at, '💧', `${npc.name} 顺手帮你给 ${crop.emoji}${crop.name} 浇了水`);
    return { emoji: '🤝', text: `帮 农场主 给 ${crop.emoji}${crop.name} 浇了水`, exp: 0 };
  }

  plot.pestAt = at + PEST_INTERVAL * (1 - CARE_JITTER + Math.random() * CARE_JITTER * 2);
  plot.boost = Math.min(BOOST_CAP, (plot.boost || 0) + PEST_YIELD_BONUS);
  farm.cared += 1;
  farm.log(at, '🐛', `${npc.name} 顺手帮你给 ${crop.emoji}${crop.name} 捉了虫`);
  return { emoji: '🤝', text: `帮 农场主 给 ${crop.emoji}${crop.name} 捉了虫`, exp: 0 };
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
};

/**
 * 执行一次上线会话。
 * @param {object} npc
 * @param {object[]} neighbours 全部 NPC，用于互相顺菜
 * @param {number} at 本次上线时间戳
 * @param {boolean} record 是否写动态日志（远期聚合不写）
 * @param {?object} farm 玩家农场，允许 NPC 偷他的菜或帮他照料
 */
function runVisit(npc, neighbours, at, record, farm) {
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

    const result = ACTIONS[action](npc, at);
    if (record && result) log(npc, at, result.emoji, result.text);
  }

  // 有空地就顺手补种：邻居的农场不该长期荒着
  if (npc.plots.some((p) => !p.cropId)) {
    const planted = actPlant(npc, at);
    if (record && planted) log(npc, at, planted.emoji, planted.text);
  }

  // 顺菜与串门帮忙不受性格权重的名额限制 —— 上线再忙也可能顺一手
  const stolen = actSteal(npc, neighbours, farm, at);
  if (record && stolen) log(npc, at, stolen.emoji, stolen.text);

  const helped = actHelpPlayer(npc, farm, at);
  if (record && helped) log(npc, at, helped.emoji, helped.text);

  // 手头宽裕就去买张藏宝图：等级门槛、价格、奖励池都和玩家完全一致，
  // 只是 NPC 不在场，奖励按池子价值直接算法结算
  if (Math.random() < NPC_ADVENTURE_CHANCE) {
    const trip = rollNpcAdventure(npc);
    if (trip && record) {
      const net = trip.net >= 0 ? `赚了 ${formatCoins(trip.net)}` : `亏了 ${formatCoins(-trip.net)}`;
      log(npc, at, '🗺️', `买了${trip.map.name}去寻宝，${net} 💰`);
    }
  }

  npc.lastVisitAt = at;
  npc.nextVisitAt = nextVisitAt(npc, at);
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
  const visits = Math.max(1, Math.round(span / expectedGapMs(npc)));

  // 每次上线的平均收益：收获越多、地块越多、等级越高越多
  const plotValue = npc.plots.reduce((sum, p) => {
    if (!p.cropId) return sum;
    return sum + CROPS[p.cropId].sell * 1.5;
  }, 0);
  const perVisitCoins = plotValue * 0.6;
  npc.coins += Math.round(perVisitCoins * visits);

  // 经验按同等级可种作物的平均等级估算
  const pool = cropsNearLevel(npc.level);
  const avgExp = pool.length
    ? pool.reduce((sum, id) => sum + CROPS[id].lv, 0) / pool.length
    : 10;
  gainExp(npc, Math.round(avgExp * npc.plots.length * 0.5 * visits));

  // 远期也会去买藏宝图，但只抽有限次，免得离线一年要跑几千轮
  for (let i = 0, n = Math.min(visits, 20); i < n; i += 1) {
    if (Math.random() < NPC_ADVENTURE_CHANCE) rollNpcAdventure(npc);
  }

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
  npc.nextVisitAt = nextVisitAt(npc, until);
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
    detailed += Math.min(MAX_VISITS_PER_NPC, Math.round((now - from) / expectedGapMs(npc)));
  }
  return detailed;
}

/**
 * 把一位邻居推进到当前时间。
 * @param {object} npc
 * @param {object[]} npcs 全部 NPC
 * @param {number} now
 * @param {?object} [farm] 玩家农场，允许 NPC 偷菜或帮忙照料
 * @returns {number} 本次实际精细模拟的会话数
 */
export function simulateNpc(npc, npcs, now, farm = null) {
  const boundary = now - DETAILED_WINDOW;
  let detailed = 0;
  let guard = 0;

  while ((npc.nextVisitAt || 0) <= now && guard < MAX_VISITS_PER_NPC) {
    guard += 1;
    if (npc.nextVisitAt < boundary) {
      bulkAdvance(npc, boundary);
    } else {
      runVisit(npc, npcs, npc.nextVisitAt, true, farm);
      detailed += 1;
    }
  }
  return detailed;
}