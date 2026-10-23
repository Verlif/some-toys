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
import { boardDayKey, formatCoins } from '../core/utils.js';
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
    desc: '农场内最高「+加成」角标的百分比（全场峰值）',
    format: (v) => `+${v}%`,
    rewards: [
      { coins: 100, items: { boost10: 3, [HARVESTER_ID]: 3 } },
      { coins: 50, items: { boost10: 2 } },
      { coins: 30 },
    ],
  },
  {
    metric: 'gift', icon: '🎁', name: '送礼达人',
    desc: '送出礼物的总价值（产出售价合计）',
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

/** 取某一天的行，没有就建一行（未结算） */
function rowOf(key) {
  let row = state.dailyRows[key];
  if (!row) {
    row = state.dailyRows[key] = { date: key, settled: false, stats: {} };
  }
  return row;
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

/** 玩家今天某指标的值（下午 2 点前「统计中」的展示用） */
export function todayValue(metric) {
  const row = state.dailyRows[boardDayKey()];
  const value = row?.stats[PLAYER_ID]?.[metric];
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
function rewardText(reward) {
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
 * 结算一天：每张榜前三名发奖，玩家写农场日志，NPC 冠军上报一条时报。
 * @returns {{date: string, awards: object[], playerWon: boolean}} 本日发奖记录
 */
function settleDay(row) {
  const awards = [];
  let playerWon = false;
  for (const board of BOARDS) {
    rankOf(row, board.metric, 3).forEach((entry, i) => {
      const reward = board.rewards[i];
      if (entry.actor === PLAYER_ID) {
        grantReward(reward);
        playerWon = true;
        player.addLog(
          '🏆',
          `昨日「${board.name}」第 ${i + 1} 名（${board.format(entry.value)}），获得${rewardText(reward)}`,
        );
      } else if (i === 0) {
        // NPC 夺冠不发自产道具，上报一条时报让大家知道
        addNews(board.icon, `${entry.name} 拿了昨日「${board.name}」第一名（${board.format(entry.value)}）`);
      }
      awards.push({ board: board.name, rank: i + 1, actor: entry.actor, name: entry.name });
    });
  }
  row.settled = true;
  return { date: row.date, awards, playerWon };
}

/**
 * 跨天检查：把已经结束但还没结算的日子逐天结算掉。
 *
 * 两个调用时机：启动时（补算之后）与在线时的每分钟 tick。
 * 下午 2 点那一刻玩家正好在线上 → 当场发奖并 toast；不在线则下次进游戏补结，同样提示。
 *
 * @param {number} [now]
 * @returns {Array<{date: string, awards: object[], playerWon: boolean}>} 结算掉的每一天（通常只有一页）
 */
export function checkRollover(now = Date.now()) {
  const today = boardDayKey(now);
  const pending = Object.values(state.dailyRows)
    .filter((row) => !row.settled && row.date !== today)
    .sort((a, b) => dayIndex(a.date) - dayIndex(b.date));
  if (!pending.length) return [];

  const results = pending.map(settleDay);

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
  const last = results[results.length - 1];
  notify(`🏆 ${last.date} 的每日榜单已出炉，去「更多 → 排行榜」看看`, 'gold');
  return results;
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

/** 今日（未结算）某榜的实时排名，含 NPC */
export function todayRank(metric, n = 5) {
  const date = boardDayKey(Date.now());
  return rankOf(state.dailyRows[date] || { stats: {} }, metric, n);
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
