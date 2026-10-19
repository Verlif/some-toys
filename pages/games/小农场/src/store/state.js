/**
 * 全局状态：整个游戏只有这一份内存状态。
 *
 * 规则：
 * - 只有 store/ 下的领域模块可以改它，ui/ 只读；
 * - 任何改动都必须落到 IndexedDB，再由事件总线通知 UI 重渲染；
 * - 这里不包含任何 DOM 操作。
 */
import { loadSave, saveFriend } from '../core/storage.js';
import { INITIAL_COINS, TOTAL_PLOTS } from '../data/progression.js';
import { NPCS, VISIT_GAP_MAX, VISIT_GAP_MIN, generateNpcPlots } from '../data/friends.js';
import { normalizeNpc } from './npc-sim.js';
import { randInt, safeNum } from '../core/utils.js';

/** @type {{player: object, plots: object[], bag: Record<string, number>, friends: object[], pet: object}} */
export const state = {
  player: null,
  plots: [],
  bag: {},
  friends: [],
  pet: { id: 'dog', fedUntil: 0 },
};

/** 新玩家档案 */
export function createPlayer() {
  return {
    id: 'player',
    name: '农场主',
    level: 1,
    exp: 0,
    coins: INITIAL_COINS,
    createdAt: Date.now(),
    // 签到
    lastSign: 0,
    signStreak: 0,
    signTotal: 0,
    // 图鉴：作物 id → { planted, harvested }
    cropStats: {},
    // 新手引导：已完成的引导项
    guide: {},
  };
}

/** 新地块的初始结构 */
export function createPlot(id) {
  return {
    id,
    cropId: null,
    /** 本轮作物已经收获过几次，用于多次收获作物的再生判定 */
    harvested: 0,
    plantedAt: 0,
    readyAt: 0,
    total: 0,
    soil: 'normal',
    fert: false,
    organic: false,
    /** 产量加成，捉一次虫 +10% */
    boost: 0,
    /** 下次需要浇水的时间戳 */
    waterAt: 0,
    /** 下次需要捉虫的时间戳 */
    pestAt: 0,
  };
}

/**
 * 新建一位邻居。lastVisitAt 定在过去、nextVisitAt 定在未来，
 * 这样玩家第一次进来就能看到他们已经「离线了一段时间」。
 */
function createNpc(def, now) {
  const lastVisitAt = now - randInt(2 * 3600_000, 20 * 3600_000);
  return {
    id: def.id,
    name: def.name,
    avatar: def.avatar,
    personality: def.personality,
    level: def.level,
    exp: 0,
    coins: def.coins,
    plots: generateNpcPlots(def, now),
    lastVisitAt,
    nextVisitAt: lastVisitAt + randInt(VISIT_GAP_MIN, VISIT_GAP_MAX),
    log: [],
  };
}

/** 补齐后来新增的字段，兼容旧存档 */
function normalizePlot(plot) {
  if (plot.harvested === undefined) plot.harvested = 0;
  if (plot.boost === undefined) plot.boost = 0;
  // 时间戳必须逐个清洗成有限数：IndexedDB 用结构化克隆保存，
  // undefined 会被原样存下来，界面上就会冒出 "NaN小时" 这种东西。
  for (const key of ['plantedAt', 'readyAt', 'total', 'waterAt', 'pestAt', 'stolenAt']) {
    plot[key] = safeNum(plot[key], 0);
  }
  // 杂草机制已废弃（从来不会真的滋长），清掉残留字段
  delete plot.weed;
  delete plot.watered;
  return plot;
}

/**
 * 读档 + 补齐缺失数据。任何一条补丁都会立即写回。
 * @returns {Promise<typeof state>}
 */
export async function initState() {
  const save = await loadSave();

  state.player = save.player || createPlayer();
  state.player.cropStats ??= {};
  state.player.guide ??= {};
  state.player.signStreak ??= 0;
  state.player.signTotal ??= 0;
  state.pet = save.pet;

  // 地块：不足 TOTAL_PLOTS 就补齐，多的不删
  // （新建的地块不用立刻落盘，下次被玩家操作时 persist 会一并写回）
  for (let id = 0; id < TOTAL_PLOTS; id += 1) {
    if (!save.plots.some((p) => p.id === id)) state.plots.push(createPlot(id));
  }
  for (const plot of save.plots) state.plots.push(normalizePlot(plot));
  state.plots.sort((a, b) => a.id - b.id);

  state.bag = save.bag;

  // 邻居：首次进入时按固定名单建好 15 座农场，之后只补字段不重建
  const now = Date.now();
  if (save.friends.length) {
    state.friends = save.friends
      .map((npc) => normalizeNpc(npc, NPCS.find((d) => d.id === npc.id) || NPCS[0]))
      .filter((npc) => npc.id && npc.name);
  } else {
    state.friends = NPCS.map((def) => createNpc(def, now));
    await Promise.all(state.friends.map(saveFriend));
  }

  return state;
}

/** 按 id 取地块 */
export function getPlot(plotId) {
  return state.plots.find((p) => p.id === plotId);
}

/** 按 id 取邻居 */
export function getFriend(friendId) {
  return state.friends.find((f) => f.id === friendId);
}