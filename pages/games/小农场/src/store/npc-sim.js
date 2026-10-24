/**
 * 邻居模拟引擎。
 *
 * 核心模型：每个 NPC 有一个「下次上线时间」（固定钟点或随机间隔，
 * 见 data/friends.js 的 nextVisitAt），上线一次先做 2~4 件经营上的事，
 * 再按各自的偷菜倾向顺一手、按性格决定要不要帮玩家照料一块地。
 *
 * 一次上线被拆成「动作序列」：
 *   planVisit()  规划要做哪几个动作（纯数据）
 *   beginVisit() 把游标推到下一次上线、结算狗的饱腹度
 *   runStep()    执行其中一个动作，返回一条动态
 *
 * 离线结算把序列一口气执行完；玩家在线时由 social.js 每隔几秒执行一步，
 * 所以邻居的动作是「看得见一件一件发生」的，不是瞬间完成。
 *
 * 结算分两段，避免「离线一年回来」卡死：
 *   - 远期（超过 7 天）：聚合公式一次性推进等级与财富，不记日志，
 *     只把玩家农场上过期的照料需求一并结掉（邻居们这些天帮忙打理过了）；
 *   - 近期（7 天内）：逐条执行上线会话，行为写进双方日志。
 *
 * 这个模块是纯计算，不碰存储也不碰 DOM：
 * 它只负责把农场对象从旧状态推到新状态，由调用方决定何时落盘。
 */
import { CROPS, expOf } from '../data/crops.js';
import { expForLevel, MAX_LEVEL } from '../data/progression.js';
import { NPC_ADVENTURE_CHANCE, rollNpcAdventure } from '../data/adventure.js';
import { formatCoins, randInt } from '../core/utils.js';
import { itemLabel, produceId } from '../data/keys.js';
import {
  KEEP_RATIO,
  NPC_BAG_CAP,
  ORDER_CHANCE,
  ORDER_CHANCE_BONUS,
  ORDER_DAYS_RANGE,
  ORDER_LEVEL_FLOAT,
  ORDER_QTY_RANGE,
  ORDER_REL_GAIN,
  orderReward,
} from '../data/orders.js';
import {
  ACTIONS_PER_VISIT,
  BOOST_CAP,
  CARE_PLAYER_WEIGHT,
  DETAILED_WINDOW,
  MAX_VISITS_PER_NPC,
  PERSONALITIES,
  PEST_YIELD_BONUS,
  PLAYER_FARM_WEIGHT,
  STEAL_CHANCE,
  cropsNearLevel,
  emptyNpcPlot,
  expectedGapMs,
  nextVisitAt,
  npcGrowMs,
  onlineMs,
  shuffled,
  syncNpcPlots,
  trimLog,
} from '../data/friends.js';
import { carePenalty, cornerBonusPct, farmMaxBonus, needsPest, needsWater, scheduleCare, serveCare } from '../data/care.js';
import {
  REL_CARE_PRIORITY,
  REL_PER_CARE,
  closeGiftChanceFor,
  dogCaughtRelLoss,
  giftChanceFor,
  giftPersonalityFactor,
  giftRelGain,
  helpWeightFor,
  stealWeightFor,
} from '../data/relation.js';
import { SOILS } from '../data/soils.js';
import {
  DOG_FINE_MULTIPLE,
  DOG_FOOD_PRICE,
  DOG_FOOD_SATIETY,
  DOG_SATIETY_MAX,
  catchChance,
  dogBreed,
  dogSatietyAt,
} from '../data/dogs.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** 一次上线对玩家农场的影响（给「你不在时」的汇总用） */
const noDelta = () => ({ stolen: 0, cared: 0, caught: 0 });

/** NPC 仓库总件数（有上限，超了收获时直接卖掉） */
const bagCount = (bag) => Object.values(bag || {}).reduce((sum, n) => sum + n, 0);

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

/** 按 weight 字段加权抽一个（偷菜挑农场用） */
function pickWeighted(list) {
  const total = list.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of list) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return list.at(-1);
}

/** 新建一条动态（最新在前，只留最近 7 天，见 trimLog） */
function log(npc, at, emoji, text) {
  const list = npc.log ?? (npc.log = []);
  list.unshift({ at, emoji, text });
  trimLog(list);
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
   单个动作
   ============================================================ */

/**
 * 这块地在这一刻是不是「成熟且本轮没被顺过」。
 * guarded = 这座农场被守护犬盯上过（玩家偷菜被抓住时整片标记），
 * 邻居之间也认这个标记 —— 与 social.isStealable 保持同一套口径。
 */
const stealable = (plot, at) =>
  Boolean(plot.cropId) && Boolean(CROPS[plot.cropId])
  && at >= plot.readyAt && !plot.stolen && !plot.guarded;

/**
 * 收获所有成熟的地。
 *
 * @param {object} npc
 * @param {?object} ctx 模拟上下文（含每日榜单记账，见 social.js 的 simCtx）
 * @param {number} at
 */
function actHarvest(npc, ctx, at) {
  let acted = false;
  let totalValue = 0;
  npc.bag ??= {};
  // 收获时按性格保留入库的比例：不是全卖（没金币收入），也不是全留（没法和别人互通有无）
  const keepRatio = KEEP_RATIO[npc.personality] ?? 0.3;

  for (const plot of npc.plots) {
    if (!plot.cropId || at < plot.readyAt) continue;
    const crop = CROPS[plot.cropId];

    const amount = randInt(crop.yield[0], crop.yield[1]);
    // 邻居捉过虫的地也有产量加成；土地倍率与玩家同一套
    const soilMul = SOILS[plot.soil]?.yieldMul || 1;
    let boosted = Math.floor(amount * (1 + (plot.boost || 0)) * soilMul);
    // 成熟时还挂着「该浇水 / 该杀虫」的账：和玩家一样 −15% / −40%
    boosted = Math.floor(boosted * carePenalty(plot).mul);
    // 被顺走过几个就少收几个 —— 不做「减半」这种翻倍惩罚
    boosted = Math.max(0, boosted - (plot.stolenCount || 0));
    // 收成分裂：留一部分进仓库（订单功能要用的就是它），其余卖成金币。
    // 仓库有上限，放不下的部分照样卖
    const key = produceId(plot.cropId);
    const room = Math.max(0, NPC_BAG_CAP - bagCount(npc.bag));
    const keep = Math.min(boosted, Math.floor(boosted * keepRatio), room);
    if (keep > 0) npc.bag[key] = (npc.bag[key] || 0) + keep;
    totalValue += (boosted - keep) * crop.sell;
    // 与玩家完全一致的经验公式：总时间/4×等级 + 等级×个数
    gainExp(npc, expOf(crop.lv, boosted));

    // 每日榜单：打理王 = 收获时地块的角标加成；农事劳模 = 每收一块地
    ctx?.dailyMax?.(npc.id, 'manage', farmMaxBonus(npc.plots), at);
    ctx?.daily?.(npc.id, 'work', 1, at);

    // 多茬作物进入再生轮次，否则清空这块地
    plot.harvested = (plot.harvested || 0) + 1;
    if (plot.harvested >= crop.harvests) {
      Object.assign(plot, emptyNpcPlot());
    } else {
      const regrow = Math.max(30_000, Math.floor(plot.total * crop.regrow));
      plot.plantedAt = at;
      plot.readyAt = at + regrow;
      plot.total = regrow;
      // 进入新一轮：被偷过的标记与守护犬的封锁都该清掉
      plot.stolen = false;
      plot.stolenCount = 0;
      plot.guarded = false;
      // 照料次数也跟着回到 0，重新按 1 小时窗口开始排
      plot.waterTimes = 0;
      plot.pestTimes = 0;
      scheduleCare(plot, at);
    }
    acted = true;
  }

  if (!acted) return null;
  npc.coins += totalValue;
  return { emoji: '🌾', text: `收获了一批作物，+${formatCoins(totalValue)} 💰` };
}

/**
 * 在空地上播种。
 *
 * @param {object} npc
 * @param {?object} ctx 模拟上下文（含每日榜单记账）
 * @param {number} at
 */
function actPlant(npc, ctx, at) {
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
    plot.guarded = false;
    plot.boost = 0;
    // 邻居也会缺水、生虫 —— 这是玩家能插手的地方，规则与玩家农场完全一致
    plot.waterTimes = 0;
    plot.pestTimes = 0;
    scheduleCare(plot, at);
    names.push(`${crop.emoji}${crop.name}`);
  }

  gainExp(npc, 4 * names.length);
  // 农事劳模：种下几块地记几笔
  ctx?.daily?.(npc.id, 'work', names.length, at);
  const head = names.slice(0, 2).join('、');
  return { emoji: '🌱', text: `种下了 ${names.length} 块地：${head}${names.length > 2 ? ' 等' : ''}` };
}

/**
 * 打理：给缺水的地浇水、给生虫的地捉虫。
 *
 * @param {object} npc
 * @param {?object} ctx 模拟上下文（含每日榜单记账）
 * @param {number} at
 */
function actTend(npc, ctx, at) {
  let tended = 0;
  for (const plot of npc.plots) {
    if (!plot.cropId) continue;
    if (needsWater(plot, at)) {
      serveCare(plot, 'water', at);
      tended += 1;
    }
    if (needsPest(plot, at)) {
      plot.boost = Math.min(BOOST_CAP, (plot.boost || 0) + PEST_YIELD_BONUS);
      serveCare(plot, 'pest', at);
      tended += 1;
    }
  }
  if (!tended) return null;

  gainExp(npc, 6 * tended);
  // 农事劳模：打理几块地记几笔
  ctx?.daily?.(npc.id, 'work', tended, at);
  return { emoji: '🧹', text: `打理了 ${tended} 块地，浇了水也除了虫` };
}

/**
 * 给守护犬添食。
 *
 * 邻居的狗不是摆设：饱腹度低了它自己也会被偷。喂不喂由性格决定 ——
 * 性格里「打理」的权重同时代表顾家的程度，热心/勤勉的邻居几乎不会让狗饿着，
 * 悠闲/爱占便宜的基本想不起来。
 *
 * 门槛压得比较低（0.85 封顶）：狗饿着不只是「他家容易被偷」，
 * 玩家农场的狗同样会饿 —— 让邻居显得尽心些，玩家才有个参照。
 */
function actFeedDog(npc, at) {
  const satiety = dogSatietyAt(npc.dog, at);
  if (satiety > 60) return null;

  const weights = PERSONALITIES[npc.personality].weights;
  if (Math.random() >= Math.min(0.95, weights.tend * 0.40)) return null;
  if (npc.coins < DOG_FOOD_PRICE) return null;

  npc.coins -= DOG_FOOD_PRICE;
  npc.dog.satiety = Math.min(DOG_SATIETY_MAX, satiety + DOG_FOOD_SATIETY);
  npc.dog.at = at;
  return {
    emoji: '🦴',
    text: `给守护犬添了食，饱腹度 ${Math.round(npc.dog.satiety)}%`,
  };
}

/**
 * 邻居农场的守护犬在 at 时刻的拦截概率。
 * 与玩家农场同一套公式：品种基础率 × 饱腹度修正。
 * @param {object} owner 邻居农场
 * @param {number} at 毫秒时间戳
 * @returns {number} 0~1
 */
function npcGuardChance(owner, at) {
  const breed = dogBreed(owner.dog?.breed);
  if (!breed) return 0;
  return catchChance(breed.rate, dogSatietyAt(owner.dog, at));
}

/**
 * 顺菜。
 *
 * 先按这位邻居的偷菜倾向掷一次，再**挑农场**、最后挑地块。
 * 玩家农场的权重是 PLAYER_FARM_WEIGHT 倍：地最多、最扎眼的一座，
 * 这样「邻居变多」才会真的变成「我更容易被偷」，
 * 而不是被一堆 NPC 农场把概率稀释掉。
 *
 * 邻居家与玩家农场一视同仁 —— 偷玩家的时候会写进玩家日志，
 * 玩家收获时按 stolenCount 扣掉。守护犬也是同一套：
 * 不管偷谁，被狗抓住都要按想偷的果实价值 ×DOG_FINE_MULTIPLE 罚款，
 * 罚金归被偷的农场主；小偷钱不够就倾家荡产。
 * **顺走不掉好感，被当场逮住才掉**（按售价折算，见 dogCaughtRelLoss）。
 */
function actSteal(npc, ctx, at) {
  const chance = STEAL_CHANCE[npc.steal] || 0;
  if (!chance || Math.random() >= chance) return null;
  const { neighbours, farm } = ctx;

  // 挑农场的权重里带上好感度：越是跟他不对付的，越容易被盯上
  const targets = [];
  for (const other of neighbours) {
    if (other === npc) continue;
    const plots = other.plots.filter((plot) => stealable(plot, at));
    if (plots.length) {
      targets.push({ owner: other, plots, weight: stealWeightFor(ctx.rel(npc.id, other.id)) });
    }
  }
  const mine = (farm?.plots || []).filter((plot) => stealable(plot, at));
  if (mine.length) {
    targets.push({
      owner: farm,
      plots: mine,
      weight: PLAYER_FARM_WEIGHT * stealWeightFor(ctx.rel(npc.id, farm.id)),
    });
  }
  if (!targets.length) return null;

  const { owner, plots } = pickWeighted(targets);
  const plot = pick(plots);
  const crop = CROPS[plot.cropId];
  const isPlayer = owner === farm;

  // 守护犬：玩家农场与邻居农场一视同仁。品种决定基础拦截率，
  // 饱腹度决定它现在有没有力气。被赶走时这一趟白跑 ——
  // 作物没少、邻居也没拿到钱，还要倒贴一笔罚款。
  const guard = isPlayer && farm.dogGuardChanceAt
    ? farm.dogGuardChanceAt(at)
    : npcGuardChance(owner, at);
  if (guard > 0 && Math.random() < guard) {
    const fine = Math.round(crop.sell * DOG_FINE_MULTIPLE);
    // 有多少罚多少：NPC 也可能穷到叮当响，不记负债
    const paid = Math.min(npc.coins, fine);
    npc.coins -= paid;
    // 人赃并获：钱罚了，好感也按这个果实的售价破个角（至少 1）
    ctx.relAdjust(npc.id, owner.id, -dogCaughtRelLoss(crop.sell));

    if (isPlayer) {
      farm.caught += 1;
      // 狗狗王：玩家农场拦下一次
      ctx.daily?.(farm.id, 'dog', 1, at);
      farm.addCoins?.(paid);
      // by = npc.id：这条是「邻居对玩家农场做的事」，农场日志的邻居动向 tab 靠它认
      farm.log(at, '🐕', `守护犬把 ${npc.name} 赶走了，罚了 ${formatCoins(paid)} 金币（拦截率 ${Math.round(guard * 100)}%）`, npc.id);
      farm.news?.(at, '🐕', `${npc.name} 溜进你的农场想顺菜，被守护犬赶了出来并罚了款`);
      return { emoji: '🐕', text: `溜进 ${farm.name} 家想顺菜，被守护犬抓住罚了 ${formatCoins(paid)} 金币` };
    }

    owner.coins += paid;
    // 狗狗王：这座邻居农场拦下一次
    ctx.daily?.(owner.id, 'dog', 1, at);
    log(owner, at, '🐕', `守护犬抓住了想顺菜的 ${npc.name}，罚了 ${formatCoins(paid)} 金币`);
    farm?.news?.(at, '🐕', `${npc.name} 想顺 ${owner.name} 家的菜，被守护犬抓住罚了款`);
    return { emoji: '🐕', text: `想顺 ${owner.name} 家的菜，被守护犬抓住罚了 ${formatCoins(paid)} 金币` };
  }

  plot.stolen = true;
  plot.stolenCount = (plot.stolenCount || 0) + 1;
  plot.stolenAt = at;

  npc.coins += crop.sell;
  // 顺走不进好感账：被偷的心里有数，但不至于撕破脸（被狗抓住才算，见上）
  // 经验按作物等级给，和玩家照料同一套口径
  gainExp(npc, Math.max(1, Math.round(crop.lv * 0.6)) + 4);

  if (isPlayer) {
    farm.stolen += 1;
    farm.log(at, '🥷', `${npc.name} 来你的农场，顺走了 ${crop.emoji}${crop.name} ×1`, npc.id);
    farm.news?.(at, '🥷', `${npc.name} 溜进你的农场，顺走了 ${crop.emoji}${crop.name}`);
  } else {
    // 邻居之间的偷菜是时报最喜欢的素材
    farm?.news?.(at, '🥷', `${npc.name} 从 ${owner.name} 家顺走了 ${crop.emoji}${crop.name}`);
  }

  return {
    emoji: '🥷',
    text: `从${isPlayer ? '你的农场' : `${owner.name}家`}顺走了 ${crop.emoji}${crop.name}`,
  };
}

/**
 * 一块地现在需要人搭把手吗（缺水 / 生虫，且还没成熟）
 * @param {object} plot
 * @param {number} at
 */
const careWanted = (plot, at) => Boolean(plot.cropId)
  && Boolean(CROPS[plot.cropId])
  && at < plot.readyAt
  && (needsWater(plot, at) || needsPest(plot, at));

/**
 * 串门帮忙：给某户人家浇一块地 / 捉一次虫。
 *
 * 谁会去帮谁，看的是**好感度**（helpWeightFor）：交情越好越愿意跑腿，
 * 结了怨的基本绕着走。**亲近档（好感 ≥100）优先** —— 上线先登门照顾这些
 * 铁交情，一个 ≥100 的都没有才按老逻辑全量挑，低好感的偶尔也帮得上。
 * 玩家农场照样有自己的权重（地最多、最扎眼，care 专用 CARE_PLAYER_WEIGHT），
 * **一次最多 2 块地** —— 帮得再多也不该变成「一键托管」。
 *
 * 概率与块数都是 2026-10-24 调过的：原来每次上线只可能碰 1 块地、
 * 命中率还只有 tend×0.22，32 个邻居分 33 座农场，玩家农场长期没人管，
 * 离线几天回来一片缺水生虫，高好感邻居像白交的一样。
 */
/** 一次串门最多照料几块地：2 块是「真的在帮」和「全托管」之间的线 */
const CARE_MAX_PLOTS = 2;

function actCare(npc, ctx, at) {
  const weights = PERSONALITIES[npc.personality].weights;
  if (Math.random() >= Math.min(0.90, weights.tend * 0.30)) return null;

  const targets = [];
  for (const other of ctx.neighbours) {
    if (other === npc) continue;
    const needs = other.plots.filter((p) => careWanted(p, at));
    if (needs.length) {
      targets.push({ owner: other, plots: needs, weight: helpWeightFor(ctx.rel(npc.id, other.id)) });
    }
  }
  if (ctx.farm) {
    const needs = ctx.farm.plots.filter((p) => careWanted(p, at));
    if (needs.length) {
      targets.push({
        owner: ctx.farm,
        plots: needs,
        // 照顾用 care 专用权重（偷菜的 PLAYER_FARM_WEIGHT 不动）：
        // 「地最多、最扎眼」在偷菜上是 2，在帮忙上该更愿意来
        weight: CARE_PLAYER_WEIGHT * helpWeightFor(ctx.rel(npc.id, ctx.farm.id)),
      });
    }
  }
  if (!targets.length) return null;

  // 亲近档优先：有 ≥100 的目标就只从里面挑，一个都没有才回退全量
  const close = targets.filter((t) => ctx.rel(npc.id, t.owner.id) >= REL_CARE_PRIORITY);
  const { owner, plots } = pickWeighted(close.length ? close : targets);
  // 一次最多 2 块，且**缺水生虫一起处理**（原来只修一个，另一个白挂着）
  const chosen = shuffled(plots).slice(0, CARE_MAX_PLOTS);

  let tended = 0;
  const names = [];
  for (const plot of chosen) {
    const crop = CROPS[plot.cropId];
    const water = needsWater(plot, at);
    const pest = needsPest(plot, at);
    if (water) serveCare(plot, 'water', at);
    if (pest) {
      plot.boost = Math.min(BOOST_CAP, (plot.boost || 0) + PEST_YIELD_BONUS);
      serveCare(plot, 'pest', at);
    }
    tended += 1;
    names.push(`${crop.emoji}${crop.name}`);
  }
  if (!tended) return null;

  // 每块 +1 好感，与玩家一键帮邻居浇多块地同一口径
  ctx.relAdjust(npc.id, owner.id, REL_PER_CARE * tended);
  // 最友善榜：帮几块记几笔（记在帮忙的人头上）
  ctx.daily?.(npc.id, 'care', tended, at);

  const detail = names.join('、');
  if (owner === ctx.farm) {
    owner.cared += tended;
    // by = npc.id：邻居主动帮忙，归进农场日志的「邻居动向」tab
    owner.log(at, '🤝', `${npc.name} 顺手帮你照料了 ${detail}`, npc.id);
  } else {
    log(owner, at, '🤝', `${npc.name} 路过，顺手给 ${detail} 浇了水除了虫`);
  }
  return { emoji: '🤝', text: `帮 ${owner.name} 照料了 ${tended} 块地` };
}

/**
 * 送礼：只会送给**交情够好**的人。
 *
 * 两档交情两套概率：
 *   - **亲近档（好感 ≥100）**：`closeGiftChanceFor`（100 → 0.15，200 → 0.35）
 *     再乘**性格系数** —— 热心的几乎逢门就带礼，爱占便宜的打骨子里抠。
 *     NPC 上线时先登门打理（见 actCare），顺手再送一份，是一条完整的「串门」；
 *   - **老门槛（60~99）**：维持原来的 giftChanceFor，性格不掺和。
 *
 * 送给玩家的是真东西 —— 进背包、写日志，UI 还会弹一屏「收到赠礼」；
 * 送给别的邻居的只是人情（NPC 没有背包），两边各记一条动态。
 */
function actGift(npc, ctx, at) {
  const factor = giftPersonalityFactor(npc.personality);
  const cands = [];
  for (const other of ctx.neighbours) {
    if (other === npc) continue;
    const rel = ctx.rel(npc.id, other.id);
    const chance = rel >= REL_CARE_PRIORITY
      ? closeGiftChanceFor(rel) * factor
      : giftChanceFor(rel);
    if (chance > 0) cands.push({ owner: other, rel, chance });
  }
  if (ctx.farm) {
    const rel = ctx.rel(npc.id, ctx.farm.id);
    const chance = rel >= REL_CARE_PRIORITY
      ? closeGiftChanceFor(rel) * factor
      : giftChanceFor(rel);
    if (chance > 0) cands.push({ owner: ctx.farm, rel, chance });
  }
  if (!cands.length) return null;

  // 先挑交情最好的那家，再掷一次「今天送不送」
  cands.sort((a, b) => b.rel - a.rel);
  const target = cands[0];
  if (Math.random() >= target.chance) return null;

  const pool = cropsNearLevel(npc.level);
  if (!pool.length) return null;
  const cropId = pick(pool);
  const crop = CROPS[cropId];
  const gain = giftRelGain(crop.lv);
  ctx.relAdjust(npc.id, target.owner.id, gain);
  // 送礼达人榜：送出一份记一笔
  ctx.daily?.(npc.id, 'gift', crop.sell, at);

  if (target.owner === ctx.farm) {
    ctx.receiveGift?.(at, npc, cropId, 1);
  } else {
    log(target.owner, at, '🎁', `${npc.name} 送来一份 ${crop.emoji}${crop.name}`);
  }
  return { emoji: '🎁', text: `给 ${target.owner.name} 送去一份 ${crop.emoji}${crop.name}` };
}

/**
 * 张榜收购：上线时若没有进行中的订单，按概率发一条（不一定每次都有）。
 *
 * 需求从 **1 级 ~（NPC 自己等级 + ORDER_LEVEL_FLOAT）** 之间随机抽，
 * 不看玩家等级 —— 高阶邻居就该开出高阶单，接不了是玩家自己的取舍
 * （2026-10-24 用户明确要求，早先是「取两者较低等级」，低阶邻居永远开低阶单）。
 *
 * 赏金 = 售价 ×1.2× 数量，**当场从 NPC 金币托管**（掏不出钱就不张榜，不开空头支票）；
 * 期限 1~3 天，每个 NPC 同时最多 1 条（NPC_ORDER_LIMIT）。
 */
function actOrder(npc, ctx, at) {
  if (npc.order) return null;
  // 不一定每次上线都有订单：基础 30%，生意人 / 场面人更爱张榜
  const bonus = ORDER_CHANCE_BONUS[npc.personality] || 1;
  if (Math.random() >= ORDER_CHANCE * bonus) return null;

  const pool = Object.keys(CROPS).filter(
    (id) => !CROPS[id].special && CROPS[id].lv <= npc.level + ORDER_LEVEL_FLOAT,
  );
  if (!pool.length) return null;

  const cropId = pick(pool);
  const crop = CROPS[cropId];
  const qty = randInt(ORDER_QTY_RANGE[0], ORDER_QTY_RANGE[1]);
  const reward = orderReward(crop.sell, qty);
  if (npc.coins < reward) return null;
  npc.coins -= reward;

  npc.order = {
    id: npc.id,
    ownerId: npc.id,
    itemId: produceId(cropId),
    qty,
    reward,
    createdAt: at,
    deadline: at + randInt(ORDER_DAYS_RANGE[0], ORDER_DAYS_RANGE[1]) * DAY,
  };
  log(npc, at, '📋', `张榜收购 ${crop.emoji}${crop.name} ×${qty}，赏金 ${formatCoins(reward)} 💰`);
  return { emoji: '📋', text: `张榜收购 ${crop.emoji}${crop.name} ×${qty}` };
}

/**
 * 接单：从看板上挑一条**不是自己发的**、自家仓库凑得齐的订单交货。
 *
 * 每次上线最多 1 条；优先接**玩家**的单（我发的单真有人接），
 * 其余按赏金从高到低挑 —— NPC 之间也互通有无。完成一笔，
 * 接单方与下单方好感 +5：互通有无也是交情。
 */
function actFill(npc, ctx, at) {
  const orders = ctx.orders?.() || [];
  const can = orders.filter((o) => o.ownerId !== npc.id && (npc.bag?.[o.itemId] || 0) >= o.qty);
  if (!can.length) return null;

  const mine = can.filter((o) => o.ownerId === ctx.farm?.id);
  const pool = mine.length ? mine : can;
  pool.sort((a, b) => b.reward - a.reward);
  const order = pool[0];

  const label = itemLabel(order.itemId);
  const ownerIsPlayer = order.ownerId === ctx.farm?.id;
  const owner = ownerIsPlayer
    ? ctx.farm
    : ctx.neighbours.find((n) => n.id === order.ownerId);
  // 下单方不在（理论上不会）：这条单跳过，别白白扣自己的货
  if (!owner) return null;

  // 交货：从自己仓库扣，转给下单方
  npc.bag[order.itemId] -= order.qty;
  if (npc.bag[order.itemId] <= 0) delete npc.bag[order.itemId];

  if (ownerIsPlayer) {
    ctx.farm.giveItem?.(order.itemId, order.qty);
  } else {
    owner.bag ??= {};
    owner.bag[order.itemId] = (owner.bag[order.itemId] || 0) + order.qty;
  }
  // 赏金从托管里出来，归接单的人；完成一笔双方好感 +5
  npc.coins += order.reward;
  ctx.relAdjust(npc.id, order.ownerId, ORDER_REL_GAIN);
  ctx.removeOrder?.(order);

  if (ownerIsPlayer) {
    // by = npc.id：邻居主动帮忙，归进农场日志的「邻居动向」tab
    ctx.farm.log?.(at, '📦', `${npc.name} 帮你凑齐了 ${label} ×${order.qty}`, npc.id);
  } else {
    log(owner, at, '📦', `${npc.name} 帮你凑齐了 ${label} ×${order.qty}`);
    // 邻里之间互通有无：时报最喜欢的素材
    ctx.farm.news?.(at, '📦', `${npc.name} 帮 ${owner.name} 凑齐了 ${label} ×${order.qty}`);
  }
  // 回执带上涉及的农场：接 NPC 的单时，对方的行也要一起落盘
  return {
    emoji: '📦',
    text: `帮 ${owner.name} 凑齐了 ${label} ×${order.qty}`,
    farms: [npc.id, order.ownerId],
    gave: ownerIsPlayer,
  };
}

/**
 * 买张藏宝图去寻宝：等级门槛、价格、奖励池都和玩家完全一致，
 * 只是 NPC 不在场，奖励按池子价值直接算法结算。
 *
 * @param {object} npc
 * @param {?object} farm 玩家农场视图（只为上报时报）
 * @param {?object} ctx 模拟上下文（含每日榜单记账）
 * @param {number} at
 */
function actAdventure(npc, farm, ctx, at) {
  if (Math.random() >= NPC_ADVENTURE_CHANCE) return null;
  const trip = rollNpcAdventure(npc);
  if (!trip) return null;

  // 冒险王榜：按藏宝图等级分榜，记这一趟带回的奖励价值
  ctx?.daily?.(npc.id, `adv${trip.map.tier}`, trip.gain, at);

  const net = trip.net >= 0 ? `赚了 ${formatCoins(trip.net)}` : `亏了 ${formatCoins(-trip.net)}`;
  // 赚回图价以上才算「大奖」，亏本的不配上时报
  if (trip.net >= trip.map.price) {
    farm?.news?.(at, '💰', `${npc.name} 寻宝挖到大奖，一张${trip.map.name}赚了 ${formatCoins(trip.net)} 💰`);
  }
  return { emoji: '🗺️', text: `买了${trip.map.name}去寻宝，${net} 💰` };
}

/* ============================================================
   一次上线会话
   ============================================================ */

/**
 * 每种动作的签名统一成 (npc, at, ctx)：
 * ctx = { neighbours, farm, rel, relAdjust, receiveGift, orders, removeOrder }，
 * 动作内部自己挑需要的部分 —— 模拟层始终不认识 store，好感度与订单看板都是「传进来的」。
 */
const STEPS = {
  harvest: (npc, at, ctx) => actHarvest(npc, ctx, at),
  plant: (npc, at, ctx) => actPlant(npc, ctx, at),
  tend: (npc, at, ctx) => actTend(npc, ctx, at),
  /** 收尾补种：有空地才种，不让邻居的农场长期荒着 */
  replant: (npc, at, ctx) => (npc.plots.some((p) => !p.cropId) ? actPlant(npc, ctx, at) : null),
  feed: (npc, at) => actFeedDog(npc, at),
  steal: (npc, at, ctx) => actSteal(npc, ctx, at),
  /** 帮别人照料一块地（玩家或别的邻居，≥100 的亲近档优先） */
  care: (npc, at, ctx) => actCare(npc, ctx, at),
  /** 给交情够好的人送一份产出（≥100 走性格加权的新概率） */
  gift: (npc, at, ctx) => actGift(npc, ctx, at),
  adventure: (npc, at, ctx) => actAdventure(npc, ctx.farm, ctx, at),
  /** 张榜收购产出（手里没有进行中订单时才掷，赏金托管） */
  order: (npc, at, ctx) => actOrder(npc, ctx, at),
  /** 从看板接一条交得起的订单交货（每次上线最多 1 条） */
  fill: (npc, at, ctx) => actFill(npc, ctx, at),
};

/**
 * 规划一次上线要做的动作序列。
 *
 * 纯数据、不产生任何副作用 —— 离线结算顺序执行完，
 * 玩家在线时则交给 social.js 每隔几秒执行一步。
 * @param {object} npc
 * @returns {string[]} 动作 key 序列
 */
export function planVisit(npc) {
  const weights = PERSONALITIES[npc.personality].weights;
  const want = randInt(ACTIONS_PER_VISIT[0], ACTIONS_PER_VISIT[1]);
  const steps = [];
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
    steps.push(action);
  }

  // 顺菜、串门帮忙、送礼、订单不受性格权重的名额限制 —— 上线再忙也可能做一件
  return [...steps, 'replant', 'feed', 'steal', 'care', 'gift', 'adventure', 'order', 'fill'];
}

/**
 * 开始一次上线：把狗的饱腹度结算到这一刻，把地块补齐到等级对应的解锁数，
 * 并把游标推到下一次上线。
 *
 * 游标**必须**在这里推进：玩家在线时动作是隔几秒逐个执行的，
 * 不推进的话下一次轮询会把同一趟上线再演一遍。
 *
 * @param {object} npc
 * @param {number} at
 * @returns {number} 这次上线之前的等级（判断有没有升级）
 */
export function beginVisit(npc, at) {
  const levelBefore = npc.level;
  npc.dog.satiety = dogSatietyAt(npc.dog, at);
  npc.dog.at = at;
  // 地块数量和玩家一样按等级解锁：升了级就该有新地（直接种上，和初始生成一致）
  syncNpcPlots(npc, at);
  npc.lastVisitAt = at;
  // 在线窗口：按性格与身份 10~30 分钟。邻居页的绿点、偷菜双倍惩罚都看它 ——
  // 只有精细访问走这里，远期聚合不设，别让上古上线也「在线」
  npc.onlineUntil = at + onlineMs(npc);
  npc.nextVisitAt = nextVisitAt(npc, at);
  return levelBefore;
}

/**
 * 执行一个动作，并把结果写进这位邻居的动态。
 * @param {object} npc
 * @param {number} at 这次上线的时刻
 * @param {string} kind 见 STEPS 的键
 * @param {{neighbours: object[], farm: ?object}} ctx
 * @returns {?{emoji: string, text: string}} 一条动态，没做成则为 null
 */
export function runStep(npc, at, kind, ctx) {
  const entry = STEPS[kind]?.(npc, at, ctx) ?? null;
  if (entry) log(npc, at, entry.emoji, entry.text);
  return entry;
}

/**
 * 离线结算用：一口气跑完一整趟上线。
 * @returns {number} 这次上线之前的等级
 */
function runVisit(npc, ctx, at) {
  const levelBefore = beginVisit(npc, at);

  for (const kind of planVisit(npc)) runStep(npc, at, kind, ctx);

  // 这次上线可能连升几级：地块解锁数跟着等级走，当场补上
  syncNpcPlots(npc, at);

  // 农场升级也是新闻：一次上线涨好几级的时候只报最终等级
  if (npc.level > levelBefore) {
    ctx.farm?.news?.(at, '🎉', `${npc.name} 的农场升到了 Lv.${npc.level}`);
  }
  return levelBefore;
}

/* ============================================================
   远期聚合
   ============================================================ */

/**
 * 把 NPC 从当前时间直接推进到 until，不逐条执行会话。
 * 用于超过精细模拟窗口的长离线，只能得到「总量」而非「过程」。
 *
 * @param {object} npc
 * @param {number} until
 * @param {?object} [ctx] 模拟上下文。远期窗口里没人逐次模拟，但邻居们
 *   （尤其高好感的）这些天也没闲着 —— 顺手把玩家农场上过期的照料需求
 *   一并结掉，当作他们帮忙打理过了。32 个邻居各跑一次，第一个结掉后
 *   后面的看到的已是「无需照料」，天然幂等。
 */
function bulkAdvance(npc, until, ctx) {
  const span = Math.max(HOUR, until - (npc.lastVisitAt || until - HOUR));
  const visits = Math.max(1, Math.round(span / expectedGapMs(npc)));

  // 每次上线的平均收益：收获越多、地块越多、等级越高越多
  const plotValue = npc.plots.reduce((sum, p) => {
    if (!p.cropId) return sum;
    return sum + CROPS[p.cropId].sell * 1.5;
  }, 0);
  npc.coins += Math.round(plotValue * 0.6 * visits);

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
      waterTimes: 0,
      pestTimes: 0,
    });
    // 远期不逐次模拟，但「会不会缺水 / 生虫」照样按新规则排一次
    scheduleCare(plot, until);
  });
  // 这段时间可能连升了好几级：把新解锁的地块补上
  syncNpcPlots(npc, until);

  npc.lastVisitAt = until;
  npc.nextVisitAt = nextVisitAt(npc, until);

  // 远期没有逐次会话，狗的状态给一个「像那么回事」的值：
  // 顾家的邻居更可能记得喂（和 actFeedDog 的新概率对齐），悠闲的基本任它饿着
  const weights = PERSONALITIES[npc.personality].weights;
  npc.dog.satiety = Math.min(DOG_SATIETY_MAX, 25 + weights.tend * 16);
  npc.dog.at = until;

  // 远期补账：玩家农场这些天没人逐次照料，把过期的浇水 / 杀虫需求结掉 ——
  // 相当于那些天里邻居们（按人数与交情）已经帮忙打理过了。
  // 不补的话离线一个月回来一片缺水生虫，高好感邻居像白交的一样
  // （2026-10-24 用户反馈）。
  if (ctx?.farm) {
    let cared = 0;
    for (const plot of ctx.farm.plots) {
      if (needsWater(plot, until)) {
        serveCare(plot, 'water', until);
        cared += 1;
      }
      if (needsPest(plot, until)) {
        serveCare(plot, 'pest', until);
        cared += 1;
      }
    }
    if (cared > 0) {
      // 汇总计数走 farmView：邻居页那句「你不在时：邻居帮你照料了 N 块地」
      ctx.farm.cared += cared;
      ctx.farm.news?.(until, '🤝', `你不在的这些天，邻居们帮你照料了 ${cared} 块地`);
    }
  }
}

/* ============================================================
   对外入口
   ============================================================ */

/**
 * 这批 NPC 要结算多少个会话，用来给等待画面算进度。
 *
 * 只是估算（间隔型的上线时间是掷出来的），所以调用方要么夹住百分比，
 * 要么别把「已完成 / 总数」直接摆给玩家看。
 * `+1` 是因为 `from` 那一刻本身就是一次要执行的上线。
 */
export function estimateWork(npcs, now) {
  const boundary = now - DETAILED_WINDOW;
  let detailed = 0;
  for (const npc of npcs) {
    const from = Math.max(npc.nextVisitAt || now, boundary);
    if (from > now) continue;
    detailed += Math.min(MAX_VISITS_PER_NPC, 1 + Math.round((now - from) / expectedGapMs(npc)));
  }
  return detailed;
}

/**
 * 把一位邻居推进到 now，逐条执行他这期间的每一次上线。
 *
 * @param {object} npc
 * @param {{neighbours: object[], farm: ?object, rel: Function, relAdjust: Function,
 *          receiveGift?: Function}} ctx 模拟上下文（含好感度读写，由 social 注入）
 * @param {number} now
 * @param {?object} [farm] 玩家农场视图
 * @param {(visit: {at: number, entries: object[], delta: object,
 *                  levelBefore: number, deferred: boolean}) => void} [onVisit]
 *   每次上线的回调。`deferred: true` 表示这次上线「到点了但不在这里执行」——
 *   调用方要给玩家演出，见 social.js。
 * @param {number} [deferFrom] 从这个时刻起的上线都留给调用方演出
 * @returns {number} 精细模拟的会话数
 */
export function simulateNpcUntil(npc, ctx, now, onVisit = null, deferFrom = Infinity) {
  const boundary = now - DETAILED_WINDOW;
  let detailed = 0;
  let guard = 0;

  while ((npc.nextVisitAt || 0) <= now && guard < MAX_VISITS_PER_NPC) {
    guard += 1;
    if (npc.nextVisitAt < boundary) {
      bulkAdvance(npc, boundary, ctx);
      continue;
    }

    const at = npc.nextVisitAt;
    if (at >= deferFrom) {
      // 玩家正看着：游标先推进（防止下一轮重复触发），动作留给调用方演
      const levelBefore = beginVisit(npc, at);
      onVisit?.({ at, entries: [], delta: noDelta(), levelBefore, deferred: true });
      break;
    }

    // 记下这次上线前的动态列表，之后用「对象引用」认出新写的那些
    const before = npc.log.slice();
    const farm = ctx.farm;
    const beforeCounts = { stolen: farm?.stolen ?? 0, cared: farm?.cared ?? 0, caught: farm?.caught ?? 0 };
    const levelBefore = runVisit(npc, ctx, at);

    onVisit?.({
      at,
      entries: npc.log.filter((entry) => !before.includes(entry)),
      delta: {
        stolen: (farm?.stolen ?? 0) - beforeCounts.stolen,
        cared: (farm?.cared ?? 0) - beforeCounts.cared,
        caught: (farm?.caught ?? 0) - beforeCounts.caught,
      },
      levelBefore,
      deferred: false,
    });
    detailed += 1;
  }
  return detailed;
}
