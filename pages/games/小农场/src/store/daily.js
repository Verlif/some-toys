/**
 * 每日排行榜：当日行为计数 + 下午 2 点结算 + 榜单查询。
 *
 * 数据形状（state.dailyRows：日期键 → 一行，一天一行）：
 *   { date: '2026-10-22', settled: false,
 *     stats: { player: { care: 3, manage: 45 }, npc01: { care: 5 } } }
 * 33 个参与者（玩家 + 32 位邻居）共用一行，体量极小，整表清空重写最不容易出错。
 *
 * 三条设计底线：
 *   1. **按发生日记账**：bump 带 at，归到 boardDayKey(at) 那一天 ——
 *      离线补算的邻居访问发生在过去某天，不能记到「今天」头上；
 *   2. **已结算的日子冻结**：下午 2 点发过奖的行不再接受迟到的动作，
 *      迟到的直播演出（跨 midnight 那一刻）也不会改写已发出的奖；
 *   3. **远期聚合不进榜**：bulkAdvance 没有 ctx，本来就调不到 bump，
 *      只有逐条模拟（最近 7 天）与实时演出记账 —— 模糊数据不跟精确数据同榜。
 *
 * 发奖只给玩家：NPC 夺冠只上报一条时报（世界照常运转的感觉）。
 * 金币从严：主榜 100/50/30，冒险王各档多一张「免费藏宝图」—— 发的是道具不是钱。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { PLAYER_ID, state, getFriend } from './state.js';
import * as player from './player.js';
import * as inventory from './inventory.js';
import { addNews } from './news.js';
import { notify } from './notify.js';
import { boardDayKey, boardPeriodStart, formatCoins } from '../core/utils.js';
import { farmMaxBonus } from '../data/care.js';
import { MAP_TIERS } from '../data/adventure.js';
import { mapId, itemLabel } from '../data/keys.js';
import { SPRINKLER_ID, PESTICIDE_ID, HARVESTER_ID } from '../data/items.js';

/** 保留多少天的行：昨天要展示、再往前要容得下 7 天精细模拟窗口的补算 */
const KEEP_DAYS = 8;

/* ---------- 榜单定义 ---------- */

/**
 * 六个基础榜 + 冒险王按藏宝图等级拆五档，共 11 张榜。
 *
 * rewards 是前三名递减（并列都发，见 rankOf）；金币从严，
 * 真正的大头是道具与「免费藏宝图」—— 发道具不发钱，经济才守得住。
 */
export const BOARDS = [
  {
    metric: 'care', icon: '🏅', name: '最友善',
    desc: '帮邻里农场打理（浇水 / 捉虫）的次数',
    format: (v) => `${v} 次`,
    rewards: [
      { coins: 100, items: { [SPRINKLER_ID]: 5, [PESTICIDE_ID]: 5 } },
      { coins: 50, items: { [SPRINKLER_ID]: 3 } },
      { coins: 30 },
    ],
  },
  {
    metric: 'dog', icon: '🐕', name: '狗狗王',
    desc: '守护犬拦下偷菜贼的次数',
    format: (v) => `${v} 次`,
    rewards: [
      { coins: 100, items: { dogFood: 10 } },
      { coins: 50, items: { dogFood: 5 } },
      { coins: 30 },
    ],
  },
  {
    metric: 'manage', icon: '🌾', name: '打理王',
    desc: '自己农场里最高的那一个「+加成」角标',
    format: (v) => `+${v}%`,
    rewards: [
      { coins: 100, items: { boost10: 3, [HARVESTER_ID]: 3 } },
      { coins: 50, items: { boost10: 2 } },
      { coins: 30 },
    ],
  },
  {
    metric: 'gift', icon: '🎁', name: '送礼达人',
    desc: '送出礼物的总价值（产出按售价、道具按商店价）',
    format: (v) => formatCoins(v),
    rewards: [
      { coins: 100, items: { boost10: 2 } },
      { coins: 50 },
      { coins: 30 },
    ],
  },
  {
    metric: 'work', icon: '🐝', name: '农事劳模',
    desc: '播种 / 浇水 / 捉虫 / 施肥 / 收获 / 铲除的次数',
    format: (v) => `${v} 次`,
    rewards: [
      { coins: 100, items: { [HARVESTER_ID]: 3 } },
      { coins: 50 },
      { coins: 30 },
    ],
  },
];

// 冒险王：五档藏宝图各一榜，奖励多一张该档的免费图
for (const map of MAP_TIERS) {
  BOARDS.push({
    metric: `adv${map.tier}`,
    icon: map.emoji,
    name: `冒险王 · ${map.name}`,
    desc: `当日${map.name}寻宝带回的奖励总价值`,
    format: (v) => `${formatCoins(v)} 💰`,
    tier: map.tier,
    rewards: [
      { coins: 100, maps: [map.tier] },
      { coins: 50 },
      { coins: 30 },
    ],
  });
}

/* ---------- 记账 ---------- */

/** 一期从账期开始那天（`date`）的 14:00 起算 */
const periodStart = (key) => boardPeriodStart(key);

/**
 * 取某一期的行，没有就建一行（未结算）。
 *
 * 每一行都记着 `start`（这一期的起点时间戳）。旧账期（0 点切日）留下的行用的是
 * **同一把日期键、不同的时间窗** —— 直接拿来用就等于把昨天的数当成今天的，
 * 所以 start 对不上就丢掉重开。历史期直接返回一个「已结算」的空行，
 * 让 bump 安静丢弃，而不是凭空造一期出来补奖。
 */
function rowOf(key) {
  const start = periodStart(key);
  let row = state.dailyRows[key];

  if (row && row.start !== start) {
    if (key !== boardDayKey()) return { date: key, start, settled: true, stats: {} };
    delete state.dailyRows[key];
    row = null;
  }

  if (!row) row = state.dailyRows[key] = { date: key, start, settled: false, stats: {} };
  return row;
}

/**
 * 当前这一期的行（只读）。
 * start 对不上就当成空行 —— 界面上绝不显示旧账期的数字。
 */
function currentRow() {
  const key = boardDayKey();
  const start = periodStart(key);
  const row = state.dailyRows[key];
  return row && row.start === start ? row : { date: key, start, settled: false, stats: {} };
}

/**
 * 打理王的实时口径。
 *
 * 榜上每个人 = **自己农场里当前最高的那一个「+加成」角标**，不累计、也不依赖
 * 「收获过」这个事件 —— 否则地里挂着高加成却还没收，人就上不了榜。
 * 记账里的峰值仍取较大值保留：收获后角标会回落，数值不该跟着往回走。
 * @param {Record<string, object>} baseStats
 * @returns {Record<string, object>}
 */
function mergeLiveManage(baseStats) {
  const stats = {};
  for (const [id, row] of Object.entries(baseStats || {})) stats[id] = { ...row };

  const take = (id, plots) => {
    const value = farmMaxBonus(plots);
    if (value <= 0) return;
    const entry = stats[id] || (stats[id] = {});
    entry.manage = Math.max(entry.manage || 0, value);
  };

  if (state.farm) take(PLAYER_ID, state.farm.plots);
  for (const friend of state.friends || []) take(friend.id, friend.plots);
  return stats;
}

/**
 * 记一笔当日行为。
 *
 * @param {string} actor 'player' 或邻居农场 id
 * @param {string} metric 指标名（care / dog / manage / gift / work / adv1~adv5）
 * @param {number} [n] 增量，0 忽略
 * @param {number} [at] 发生时刻 —— 决定记到哪天（离线补算的访问发生在过去）
 */
export function bump(actor, metric, n = 1, at = Date.now()) {
  if (!actor || !metric || !Number.isFinite(n) || n === 0) return;
  const row = rowOf(boardDayKey(at));
  if (row.settled) return;
  const stats = row.stats[actor] || (row.stats[actor] = {});
  stats[metric] = (stats[metric] || 0) + n;
  schedulePersist();
}

/**
 * 记一笔「峰值」型行为：只保留最大值，不累加。
 * 打理王（全场最高加成百分比）用这个。
 */
export function bumpMax(actor, metric, n = 0, at = Date.now()) {
  if (!actor || !metric || !Number.isFinite(n) || n <= 0) return;
  const row = rowOf(boardDayKey(at));
  if (row.settled) return;
  const stats = row.stats[actor] || (row.stats[actor] = {});
  stats[metric] = Math.max(stats[metric] || 0, n);
  schedulePersist();
}

/** 玩家本期某指标的值（实时榜里「我」那一行用） */
export function todayValue(metric) {
  const row = currentRow();
  const stats = metric === 'manage' ? mergeLiveManage(row.stats) : row.stats;
  const value = stats[PLAYER_ID]?.[metric];
  return Number.isFinite(value) ? value : 0;
}

/* ---------- 结算 ---------- */

/** 本地日期的小整数索引，用于比较先后与裁剪 */
const dayIndex = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(new Date(y, m - 1, d).getTime() / 86_400_000);
};

/** 参与者显示信息：玩家用农场名与头像，邻居用名单里的 */
const actorMeta = (id) => (id === PLAYER_ID
  ? { name: state.farm.name, avatar: state.farm.avatar }
  : { name: getFriend(id)?.name || '邻居', avatar: getFriend(id)?.avatar || '🧑‍🌾' });

/**
 * 某行某指标的前 n 名。
 *
 * 并列（同值）共用一个名次且都返回 —— 「并列第一」不该靠随机决出输赢。
 * @param {object} row 某一天的行
 * @param {string} metric
 * @param {number} [n] 名次上限，Infinity = 全部
 * @returns {Array<{actor: string, name: string, avatar: string, value: number, rank: number}>}
 */
function rankOf(row, metric, n = 3) {
  const entries = [];
  for (const [actor, stats] of Object.entries(row.stats || {})) {
    const value = stats[metric];
    if (!Number.isFinite(value) || value <= 0) continue;
    entries.push({ actor, ...actorMeta(actor), value });
  }
  // 值降序，同值按 id 字典序 —— 保证同样数据排出同样结果
  entries.sort((a, b) => b.value - a.value || (a.actor < b.actor ? -1 : 1));

  const out = [];
  let prevValue = null;
  let prevRank = 0;
  entries.forEach((entry, i) => {
    const rank = entry.value === prevValue ? prevRank : i + 1;
    if (rank <= n) out.push({ ...entry, rank });
    prevValue = entry.value;
    prevRank = rank;
  });
  return out;
}

/** 奖励文案：💰100、🚿洒水器×5、🗺️三级藏宝图 */
export function rewardText(reward) {
  const parts = [];
  if (reward.coins) parts.push(`💰${formatCoins(reward.coins)}`);
  for (const [id, n] of Object.entries(reward.items || {})) parts.push(`${itemLabel(id)}×${n}`);
  for (const tier of reward.maps || []) parts.push(itemLabel(mapId(tier)));
  return parts.join('、');
}

/** 把一份奖励发到玩家身上（金币 / 道具 / 藏宝图） */
function grantReward(reward) {
  if (reward.coins) player.addCoins(reward.coins);
  for (const [id, n] of Object.entries(reward.items || {})) inventory.add(id, n);
  for (const tier of reward.maps || []) inventory.add(mapId(tier), 1);
}

/**
 * 结算一天：每张榜前三名发奖，玩家写农场日志与时报，NPC 冠军上报一条时报。
 *
 * @returns {{date: string, awards: object[], playerWon: boolean, playerAwards: object[]}}
 *   本日发奖记录；playerAwards 是玩家拿到的名次（给庆祝动画用）
 */
function settleDay(row, now = Date.now()) {
  // 打理王看的是「农场里最高的那一个加成」，期结束那一刻再量一次：
  // 有人的高加成本期没收获过，也该算成绩。
  // 只补「刚结束两小时内」的那一期 —— 补算三天前的榜时，玩家的农场早就不是当时的模样了，
  // 拿现在的数据去填旧榜只会失真。
  const start = periodStart(row.date);
  const end = start + 24 * 3600_000;
  if (row.start === start && now >= end && now - end < 2 * 3600_000) {
    row.stats = mergeLiveManage(row.stats);
  }

  const awards = [];
  const playerAwards = [];
  for (const board of BOARDS) {
    rankOf(row, board.metric, 3).forEach((entry, i) => {
      // 奖励按名次顺序发（并列都发，各拿各那档）；展示的名次用 entry.rank ——
      // 并列第一的两个人都该显示「第 1 名」，不是 1、2
      const reward = board.rewards[i];
      if (entry.actor === PLAYER_ID) {
        grantReward(reward);
        const value = board.format(entry.value);
        const prize = rewardText(reward);
        player.addLog('🏆', `昨日「${board.name}」第 ${entry.rank} 名（${value}），获得${prize}`);
        // 公告栏（时报）也要有玩家这一条 —— 早年只写农场日志，
        // 公告栏里只剩 NPC 的名字，玩家自己获奖了却看不见
        addNews(board.icon, `${state.farm.name} 拿了昨日「${board.name}」第 ${entry.rank} 名（${value}）`);
        playerAwards.push({
          date: row.date,
          icon: board.icon,
          board: board.name,
          rank: entry.rank,
          value,
          reward: prize,
        });
      } else if (i === 0) {
        // NPC 夺冠不发自产道具，上报一条时报让大家知道
        addNews(board.icon, `${entry.name} 拿了昨日「${board.name}」第一名（${board.format(entry.value)}）`);
      }
      awards.push({ board: board.name, rank: entry.rank, actor: entry.actor, name: entry.name });
    });
  }
  row.settled = true;
  return { date: row.date, awards, playerWon: playerAwards.length > 0, playerAwards };
}

/**
 * 跨天检查：把已经结束但还没结算的日子逐天结算掉。
 *
 * 两个调用时机：启动时（补算之后）与在线时的每分钟 tick。
 * 下午 2 点那一刻玩家正好在线上 → 当场发奖并 toast；不在线则下次进游戏补结，同样提示。
 *
 * 玩家拿到的名次会发一个 BOARD_AWARD 事件，UI 层播全屏庆祝动画
 * （离线积压了几天就按天数从旧到新逐张播）。
 *
 * @param {number} [now]
 * @returns {Array<{date: string, awards: object[], playerWon: boolean}>} 结算掉的每一天（通常只有一页）
 */
export function checkRollover(now = Date.now()) {
  const today = boardDayKey(now);
  // 兜底：设备时钟被往前调过时可能结算出「未来」的行，把这类行解锁，
  // 让它们等到真正到期再结算（正常时间线上这个循环不会命中）。
  // 旧账期的历史行由 migrateBoardRows() 在启动时整表清掉，不走这里。
  for (const row of Object.values(state.dailyRows)) {
    if (row.settled && dayIndex(row.date) > dayIndex(today)) row.settled = false;
  }
  // 只结算**严格早于**当前 boardDayKey、且账期起点对得上的行 ——
  // 旧口径残留的行（start 缺失或对不上）一律不结算，免得给一个语义不同的榜发奖
  const pending = Object.values(state.dailyRows)
    .filter((row) => !row.settled
      && row.start === boardPeriodStart(row.date)
      && dayIndex(row.date) < dayIndex(today))
    .sort((a, b) => dayIndex(a.date) - dayIndex(b.date));
  if (!pending.length) return [];

  const results = pending.map((row) => settleDay(row, now));

  // 只留最近这些天，行虽小也不该无限堆
  const floor = dayIndex(today) - KEEP_DAYS;
  for (const key of Object.keys(state.dailyRows)) {
    if (dayIndex(key) < floor) delete state.dailyRows[key];
  }

  // 结算发了奖（金币 / 道具 / 日志 / 时报），这些都在另外几张表里，必须一起落盘
  persistNow(true);
  emit(EVENTS.PLAYER);
  emit(EVENTS.INVENTORY);
  emit(EVENTS.FARM);
  emit(EVENTS.NEWS);
  emit(EVENTS.DAILY);

  // 玩家拿到的名次（按天数从旧到新，days 内按榜的次序）→ 庆祝动画
  const playerAwards = results.flatMap((r) => r.playerAwards || []);
  if (playerAwards.length) emit(EVENTS.BOARD_AWARD, playerAwards);

  if (playerAwards.length) {
    const brief = playerAwards.slice(0, 2).map((a) => `${a.board} 第${a.rank}名`).join(' · ');
    notify(
      `🏆 榜单已出炉 · 你拿了 ${playerAwards.length} 个名次（${brief}${playerAwards.length > 2 ? ' 等' : ''}）`,
      'gold',
    );
  } else if (results.length > 1) {
    notify(`🏆 积压 ${results.length} 天的榜单已出炉，去「更多 → 排行榜」看看`, 'gold');
  } else {
    notify('🏆 昨日的每日榜单已出炉，去「更多 → 排行榜」看看', 'gold');
  }
  return results;
}

/* ---------- 账期版本 ---------- */

/**
 * 账期版本。
 *
 * v3 = 行里带 `start`（账期起点）之后的账期；v2 是「昨天 14:00 → 今天 14:00 一期、
 * 今天下午 2 点开奖」但行里没记起点，v1 是 0 点切日。
 * 旧版（按 0 点切日）留下的行用的是**同一把日期键、不同的时间窗**，
 * 混在一起会互相覆盖、还会让 `bump` 撞上 `settled` 把数据静默丢掉，
 * 所以升级时整表清空一次（最多 8 天历史，代价可接受）。
 */
const BOARD_VERSION = 3;

/**
 * 校验账期版本，不一致就把每日榜单整表清空。
 * 必须在 checkRollover 之前调用，否则旧行可能先被当成新账期结算掉。
 * @returns {Promise<boolean>} 是否清空过
 */
export async function migrateBoardRows() {
  const progress = state.farm?.progress;
  if (!progress || progress.boardVersion === BOARD_VERSION) return false;

  // 只清「不属于当前账期口径」的行：start 对得上的（新口径写出来的）原样留下，
  // 旧账期的行则整行丢掉 —— 它们的时间窗和现在完全不同，留着只会污染统计
  const kept = {};
  let dropped = 0;
  for (const [key, row] of Object.entries(state.dailyRows || {})) {
    if (row?.start === boardPeriodStart(key)) kept[key] = row;
    else dropped += 1;
  }
  state.dailyRows = kept;
  progress.boardVersion = BOARD_VERSION;
  // 进度字段在 farm 上，清空的是 daily 表，两张都要落盘
  await persistNow(true);
  emit(EVENTS.DAILY);
  if (dropped) console.info(`[daily] 清理了 ${dropped} 行旧账期榜单`);
  return true;
}

/* ---------- 查询（UI 只读） ---------- */

/** 最新一页已结算的榜单（展示用）；一页都没有返回 null */
export function latestSettled() {
  return Object.values(state.dailyRows)
    .filter((row) => row.settled)
    .sort((a, b) => dayIndex(b.date) - dayIndex(a.date))[0] || null;
}

/** 某页某榜的排名（含并列处理） */
export function boardRank(date, metric, n = 3) {
  const row = state.dailyRows[date];
  return row ? rankOf(row, metric, n) : [];
}

/** 玩家在某页某榜的名次与数值（没上榜返回 rank 0） */
export function playerStanding(date, metric) {
  const row = state.dailyRows[date];
  if (!row) return { rank: 0, value: 0 };
  const mine = rankOf(row, metric, Infinity).find((e) => e.actor === PLAYER_ID);
  return mine ? { rank: mine.rank, value: mine.value } : { rank: 0, value: 0 };
}

/** 本期（未结算）某榜的实时排名，含 NPC */
export function todayRank(metric, n = 5) {
  const row = currentRow();
  const stats = metric === 'manage' ? mergeLiveManage(row.stats) : row.stats;
  return rankOf({ stats }, metric, n);
}

/* ---------- 落盘 ---------- */

let persistTimer = 0;

/** 合并短时间内的连续记账，400ms 后一次性写库 */
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = 0;
    persistNow();
    // 通知排行榜页实时刷新今日排名（防抖后才发，避免每笔记账都触发）
    emit(EVENTS.STATS);
  }, 400);
}

/** 立刻写库（结算与关页面前用） */
function persistNow(rich = false) {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = 0;
  }
  const changes = { dailyRows: state.dailyRows };
  // 结算场景：发的奖在 farm（金币 / 日志）、inventory（道具）、news（时报）里
  if (rich) {
    changes.farms = [state.farm];
    changes.bag = state.bag;
    changes.news = state.news;
  }
  return commit(changes);
}

/** 把还在排队的那次记账立刻写掉（页面隐藏 / 结算前调用） */
export function flushDaily() {
  return persistNow();
}
