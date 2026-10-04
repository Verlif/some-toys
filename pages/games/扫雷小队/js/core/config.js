/**
 * 全局配置：网格尺寸、队伍配色、按键映射、规则时长、回放与演示局参数。
 *
 * 这里是可调数值的唯一来源，模拟 / 渲染 / UI 三层都从这里取值，
 * 其它模块不得再硬编码同类常量。
 */

/* ── 迷宫网格 ── */
export const W = 57, H = 27, TILE = 16;
export const CW = W * TILE, CH = H * TILE;
export const OUTSIDE_COLS = 4;   // 左侧出发区宽度（不属于迷宫内部）

/* ── 队伍（最多 5 支，每队最多 5 人） ── */
export const MAX_TEAMS = 5, MAX_TEAM_SIZE = 5;
export const TEAM_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#06b6d4'];
export const TEAM_NAMES  = ['红队', '蓝队', '绿队', '紫队', '青队'];

/** 结算柱状图中区分真人玩家的斜条纹配色（P1 / P2） */
export const PLAYER_COLORS = ['#fbbf24', '#f472b6'];

export const DIRS8 = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];

/* ── 地雷类型 ── */
export const MINE_NONE = 0, MINE_INSTANT = 1, MINE_DELAYED = 2;

/* ── 键盘 ── */
export const BLOCKED_KEYS = ['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ControlLeft','ControlRight','Slash'];

export const CONTROLS = [
  { up:'KeyW', down:'KeyS', left:'KeyA', right:'KeyD', action:['Space'] },
  { up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight', action:['ControlLeft','ControlRight'] }
];

/* ── 时序（秒） ── */
export const SCAN_DURATION   = 0.5;   // 扫描耗时
export const HOLD_FOR_DEFUSE = 0.5;   // 按下后 0.5 秒开始排雷
export const DEFUSE_DURATION = 2.0;   // 排雷耗时，需持续按住
export const RESPAWN_TIME    = 5.0;   // 倒地复活耗时
export const COUNTDOWN_TIME  = 3.0;   // 开局倒计时
export const END_COUNTDOWN   = 60;    // 首人到达后的结算倒计时

/* ── 视野 / 迷雾 ── */
export const FOG_REGEN      = 0.09;   // 迷雾每秒恢复量
export const FOG_VISION_R   = 2;      // 常驻视野半径（格）

/* ── 回放 ── */
export const REPLAY_HZ         = 30;   // 实体状态采样频率
export const TERRAIN_SNAP_HZ   = 5;    // 地形（已知/迷雾/路径）快照频率
export const REPLAY_MAX_FRAMES = 12000;// 上限，防止超长局撑爆内存

/* ── 主菜单背景演示局 ── */
export const DEMO_SETTINGS = { playerCount: 0, teamCount: 4, teamSize: 2, mineCount: 45 };
export const DEMO_DURATION = 35;       // 演示局最长时长，到点自动重开
export const DEMO_FOG_SCALE = 0.45;    // 演示局迷雾压暗系数（让背景不至于全黑）
