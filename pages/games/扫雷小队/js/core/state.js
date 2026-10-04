/**
 * 全局状态：玩家设定 + 一局对战的全部运行时数据。
 *
 * 这是唯一被各层共享的可变对象：
 *   world/ 负责填充（迷宫、地雷、队伍、实体）
 *   sim/   负责推进（移动、扫描、爆炸、结算判定）
 *   render/ 只读
 *   ui/    负责重置与生命周期
 */
import { PLAYER_TEAM_SPLIT } from './config.js';

export const settings = {
  playerCount: 1,   // 真人玩家数（1 或 2）
  teamCount: 2,     // 队伍数（2 ~ 5）
  teamSize: 2,      // 每队人数（1 ~ 5）
  mineCount: 60,    // 地雷数量
  playerTeams: PLAYER_TEAM_SPLIT  // 双人时的阵容：split 各带一队 / same 并肩同队
};

export const game = {
  state: 'menu',    // menu | options | countdown | playing | paused | ended | demo
  demo: false,      // true = 当前是主菜单背景的演示局

  // 场景
  walls: null,      // Uint8Array：1=墙
  mines: null,      // Uint8Array：地雷类型
  flags: [],        // { x, y, takenBy, takenAt, claim } —— 全图可见的旗帜
  entranceYs: [],   // 各入口所在行
  exitX: 0, exitY: 0,

  // 角色
  teams: [],        // { id, name, color, known, fog, minesFound, members }
  entities: [],

  // 视野与路径合成结果（每帧重算，供渲染与录制使用）
  unionKnown: null,   // 玩家所属队伍已知信息的并集
  displayFog: null,   // 玩家所属队伍的迷雾最小值
  displayTrail: null, // Int8Array：-1=无路径，否则为队伍号（只能看到同队伍的路径）
  teamTrails: [],     // 每队一份 Uint8Array 路径位图，写入后永不清除

  // 特效
  explosions: [], ripples: [], particles: [],

  // 计时与反馈
  elapsed: 0, countdown: 0, endCountdown: null,
  exitFlash: 0, screenShake: 0,
  lastTime: 0,
  keys: {}
};
