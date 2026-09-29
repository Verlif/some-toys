/**
 * 全局可配置参数。
 *
 * 这里的“常量”是设计数值，改这里就能调整游戏手感；
 * 需要按地图大小变化的量（TILE / COLS / ROWS / WALL_COUNT / SOUND_SPEED）
 * 由 setWorldSize() 统一改写，并通过 ES module 的实时绑定同步给所有模块。
 */

/* ---------- 世界 ---------- */
export const W = 960;
export const H = 600;

/** 地图预设：格子尺寸 / 列数 / 行数 / 障碍物数量 */
export const MAP_PRESETS = {
  small:  { TILE: 30, COLS: 32, ROWS: 20, walls: 26 },
  medium: { TILE: 24, COLS: 40, ROWS: 25, walls: 58 },
  large:  { TILE: 20, COLS: 48, ROWS: 30, walls: 92 }
};

/** 当前生效的地图尺寸参数（随设置变化） */
export let TILE = 24;
export let COLS = 40;
export let ROWS = 25;
export let WALL_COUNT = 58;

/**
 * 切换地图大小。传入 MAP_PRESETS 的键，返回实际生效的预设。
 * SOUND_SPEED 依赖 TILE，必须一起更新。
 */
export function setWorldSize(sizeKey) {
  const preset = MAP_PRESETS[sizeKey] || MAP_PRESETS.medium;
  TILE = preset.TILE;
  COLS = preset.COLS;
  ROWS = preset.ROWS;
  WALL_COUNT = preset.walls;
  SOUND_SPEED = SOUND_SPEED_TILES * TILE;
  return preset;
}

/* ---------- 移动 ---------- */
export const BASE_SPEED       = 130;   // 基础移动速度 px/s
export const WALK_MUL         = 0.5;   // 静步倍率
export const RUN_MUL          = 1.0;   // 快步倍率
export const SEEKER_SPEED_MUL = 1.12;  // 搜捕者速度倍率

/* ---------- 声波 ---------- */
export const SOUND_INTERVAL    = 0.5;  // 移动时的自动发声间隔（秒）
export const SOUND_SPEED_TILES = 10;   // 声波传播速度（格/秒）
export let   SOUND_SPEED       = SOUND_SPEED_TILES * TILE; // px/s，随地图缩放
export const WALK_SOUND_RADIUS = 220;
export const RUN_SOUND_RADIUS  = 440;
export const WALK_RAY_COUNT    = 8;
export const RUN_RAY_COUNT     = 8;
export const MAX_BOUNCE        = 2;    // 射线最多反射次数
export const MAX_SOUND_WAVES   = 70;   // 同时保留的声波上限

export const NOISE_RADIUS   = RUN_SOUND_RADIUS * 1.5; // 主动噪声半径
export const NOISE_RAY_MUL  = 2;                      // 主动噪声射线倍率
export const NOISE_COOLDOWN = 4.0;                    // 玩家噪声冷却（秒）
export const NOISE_AI_MIN_INTERVAL = 3.5;             // AI 噪声最小间隔（秒）

/* ---------- 近身视野 ---------- */
export const VISION_TILE_RANGE = 3;      // 双方距离小于 3 格时互相显形
export const CATCH_COOLDOWN = 2.5;       // 搜捕者抓到人后的硬直 / 抓捕冷却（秒）
/**
 * 队友（含 AI 队友）的近身视野是否共享给玩家。
 *   true  —— 队友靠近某个角色时，玩家也能看到它（默认）
 *   false —— 只有玩家自己靠近才看得见，黑暗的潜行压力更大
 */
export const SHARE_TEAM_VISION = true;
/**
 * 双方互相显形（VISION_TILE_RANGE）时，AI 是否也据此行动：
 * 搜捕者看见躲藏者即刻追击，躲藏者看见搜捕者即刻逃跑 / 换位。
 * 否则只有玩家单方面看得到对方，AI 仍然“瞎着”，会在近距离呆立。
 */
export const PROXIMITY_DETECT = true;
/** 被 AI 发现的额外距离（px）。0 表示严格等于显形距离 */
export const DETECT_RANGE = 0;

/* ---------- 墙壁记忆 ---------- */
export const WALL_MEMORY_HOLD = 1.0;   // 完全保持时长
export const WALL_MEMORY_FADE = 1.4;   // 淡出时长

/* ---------- 探测闪烁 ---------- */
export const DETECT_RISE_TIME = 0.07;
export const DETECT_FADE_TIME = 0.9;
/** 别人扫到自己时是否也在自己身上闪一下：当前统一关闭，减少对画面的干扰 */
export const SHOW_INCOMING_FLASH = false;

/* ---------- 渲染 ---------- */
export const PLAYER_MARKER_PULSE_SPEED = 4.0;
export const PLAYER_COLORS = ['#7fd3ff', '#ff7fc4'];

/* ---------- 对局 ---------- */
export const DEFAULT_GAME_TIME = 120;  // 默认游戏时长（秒）
export const DEFAULT_SEEKER_COUNT = 1;
export const DEFAULT_HIDER_COUNT = 6;
export const DEFAULT_PLAYER_COUNT = 1;
export const DEFAULT_MAP_SIZE = 'medium';
export const DEFAULT_ROLE = 'hider';
export const SEEKER_R = 9.0;           // 搜捕者碰撞半径
export const HIDER_R  = 8.0;           // 躲藏者碰撞半径
export const SPECTATOR_GRACE = 2.0;    // 玩家全部出局后的观战缓冲（秒）
export const START_COUNTDOWN = 3.0;    // 开局倒计时（秒）
export const REPLAY_SAMPLE_INTERVAL = 0.10; // 回放采样间隔（秒）

/** 阵营：声波反应 / 可见性判定都以此为唯一依据 */
export const TEAM = {
  hider: 'hiders',
  seeker: 'seekers'
};
