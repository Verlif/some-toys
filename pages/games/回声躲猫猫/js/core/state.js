/**
 * 全局可变状态。
 *
 * 拆分前这些变量都在同一个 IIFE 闭包里，跨模块共享天然成立；
 * 拆成 ES module 之后，统一挂在一个共享对象 gstate 上，
 * 任何模块 import 进来都能读写同一份状态。
 *
 * 约束（为了将来的联机与测试）：
 *   · 这里只放**可序列化的对局数据**，不放 DOM / 定时器 / 函数；
 *   · 由 gstate 派生的临时表现量（renderAlpha 之类）也放这里，但模拟层不依赖它们。
 */
import { DEFAULT_GAME_TIME } from './config.js';

export const gstate = {
  /* ---------- 地图 ---------- */
  grid: null,          // ROWS × COLS 的二维数组，1 = 墙
  openCells: null,     // 缓存的空地格子列表
  seed: 0,             // 本局随机种子（联机时由房主下发）

  /* ---------- 实体 ---------- */
  entities: [],        // 所有角色（搜捕者 + 躲藏者）
  seekers: [],
  hiders: [],
  players: [],         // 人类玩家控制的角色（1~2 个）
  player: null,        // 渲染/UI 视角所依附的玩家角色

  /* ---------- 道具 ---------- */
  items: [],           // 场上道具 { id, type, x, y, r, bornAt, expireAt }
  itemTimer: 0,        // 距离下一次刷新的秒数
  nextItemId: 1,
  itemLog: [],         // 最近的道具事件（结算/回放展示用）

  /* ---------- 声波 ---------- */
  soundWaves: [],      // 活跃声波（含射线路径与命中信息）
  wallMemoryMap: new Map(), // key = `${emitterId},${gx},${gy}`；渲染时按阵营共享

  /* ---------- 对局流程 ---------- */
  timeLeft: DEFAULT_GAME_TIME,
  state: 'menu',       // menu | countdown | playing | resultAnimation | over | replay
  spectator: false,    // 玩家出局后转为观战
  paused: false,
  matchOver: false,    // 模拟层：本局是否已判定胜负（胜负结果见 matchWinner）
  matchWinner: null,
  pendingGameEnd: null, // { winner, at } —— 全员出局后的延迟结算

  /* ---------- 输入 ---------- */
  commands: [],        // 本 tick 的玩家指令（由 input / net 写入，模拟层消费）
  commandsSeq: 0,      // 指令包序号（联机时用于回滚/排序）

  /* ---------- 网络 ---------- */
  net: {
    mode: 'offline',   // offline | host | guest
    connected: false,
    ping: 0,
    remotePlayers: 0
  },

  /* ---------- 结算 / 回放表现 ---------- */
  showGodView: false,
  frozenRenderTime: null, // 结算时冻结的表现时间
  resultAnimRemain: 0,
  resultAnimWinner: null,
  renderAlpha: 1,      // 渲染插值系数：0 = 上一模拟步，1 = 当前模拟步
  replayElapsed: 0,    // 回放播放进度（秒）；录制数据在 sim/replay.js
  replayPlaying: false,

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

/** 键盘状态：keydown/keyup 写入，输入层读取后转成指令 */
export const keys = {};

/** 当前对局中存活（未被抓）的躲藏者数量 */
export function countAliveHiders() {
  let alive = 0;
  for (const h of gstate.hiders) if (h.alive) alive++;
  return alive;
}

/** 是否处于「世界在推进」的对局阶段 */
export function inMatch() {
  return gstate.state === 'playing' || gstate.state === 'countdown';
}
