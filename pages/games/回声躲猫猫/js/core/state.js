/**
 * 全局可变状态。
 *
 * 拆分前这些变量都在同一个 IIFE 闭包里，跨模块共享天然成立；
 * 拆成 ES module 之后，统一挂在一个共享对象 gstate 上，
 * 任何模块 import 进来都能读写同一份状态。
 */
import { DEFAULT_GAME_TIME } from './config.js';

export const gstate = {
  /* ---------- 地图 ---------- */
  grid: null,          // ROWS × COLS 的二维数组，1 = 墙
  openCells: null,     // 缓存的空地格子列表

  /* ---------- 实体 ---------- */
  entities: [],        // 所有角色（搜捕者 + 躲藏者）
  seekers: [],
  hiders: [],
  players: [],         // 人类玩家控制的角色（1~2 个）
  player: null,        // 渲染/UI 视角所依附的玩家角色

  /* ---------- 声波 ---------- */
  soundWaves: [],      // 活跃声波（含射线路径与命中信息）
  wallMemoryMap: new Map(), // key = `${emitterId},${gx},${gy}`

  /* ---------- 对局流程 ---------- */
  timeLeft: DEFAULT_GAME_TIME,
  state: 'menu',       // menu | countdown | playing | resultAnimation | over | replay
  spectator: false,    // 玩家出局后转为观战
  paused: false,
  pendingGameEnd: null, // { winner, at } —— 全员出局后的延迟结算

  /* ---------- 结算 / 回放表现 ---------- */
  showGodView: false,
  frozenRenderTime: null, // 结算时冻结的表现时间
  resultAnimRemain: 0,
  resultAnimWinner: null,

  /* ---------- 设置（由 settings.js 维护） ---------- */
  selectedRole: 'hider',
  cfgSeekerCount: 1,
  cfgHiderCount: 6,
  cfgPlayerCount: 1,
  cfgMapSize: 'medium',
  cfgGameTime: DEFAULT_GAME_TIME,

  /* ---------- 实体 ID 分配 ---------- */
  nextEntityId: 1,

  /* ---------- 结算统计 ---------- */
  stats: {}
};

/** 键盘状态：keydown/keyup 写入，输入与 AI 读取 */
export const keys = {};

/** 当前对局中存活（未被抓）的躲藏者数量 */
export function countAliveHiders() {
  let alive = 0;
  for (const h of gstate.hiders) if (h.alive) alive++;
  return alive;
}

/** 人类玩家中是否全部被抓（用于观战判定） */
export function allHumanHidersDead() {
  const humanHiders = gstate.players.filter(p => p.type === 'hider');
  return humanHiders.length > 0 && humanHiders.every(p => !p.alive);
}
