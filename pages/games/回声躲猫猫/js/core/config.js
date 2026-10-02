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

/* ---------- 碰撞 ---------- */
/**
 * 单次位移拆分的最大步长（px）。
 * 位移越小，撞墙时被“吃掉”的越少，贴墙滑动与通道口对位也越顺；
 * 实际步长还会取 min(该值, TILE * 0.25)，避免大地图上一步跨过整格。
 */
export const COLLIDE_MAX_STEP = 5;
/** 重叠解算（把角色从墙里推出来）的最大迭代轮数 */
export const COLLIDE_RESOLVE_ITER = 4;
/** 解算后额外推开的安全余量（px），避免浮点残留被反复判成“仍然相交” */
export const COLLIDE_SKIN = 0.01;
/**
 * 通道口辅助（墙角辅助）：顶住墙时允许的接触深度上限（px）。
 * 只有“轻轻擦到”的浅接触才会触发辅助，深度超过它的正面撞击依旧会被墙挡住。
 */
export const COLLIDE_ASSIST_MAX_DEPTH = 3.5;
/** 通道口辅助：沿墙面这么多像素内能脱离接触，就认为角色是在门框/墙角上（px） */
export const COLLIDE_ASSIST_RANGE = 8;
/** 通道口辅助：单帧最大辅助位移（px），防止辅助变成“自动寻路” */
export const COLLIDE_ASSIST_MAX_NUDGE = 1.2;
/** 通道口辅助：单帧辅助位移相对本步位移的比例上限 */
export const COLLIDE_ASSIST_NUDGE_MUL = 0.6;

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
/**
 * 搜捕者抓到人后的硬直 / 抓捕冷却（秒）。
 *
 * 只对**人类玩家**生效：AI 搜捕者默认没有冷却，可以连续抓捕（需求：去除 AI 抓捕冷却）。
 * 冷却进度条只在搜捕者阵营的 HUD 上显示。
 */
export const CATCH_COOLDOWN = 2.5;
/**
 * AI 搜捕者的抓捕冷却（秒）。默认 0 = 没有冷却（可以连续抓）。
 * 如果之后觉得 AI 清场太快，把它调成 0.6~1.2 即可，不需要改任何逻辑。
 */
export const CATCH_COOLDOWN_AI = 0;
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
/**
 * 队友（含 AI 队友）点亮的墙壁轮廓是否共享给玩家。
 *   true  —— 队友声波扫到的墙格，玩家同样能看到那圈轮廓（默认，方便互相配合 / 分头探图）
 *   false —— 只有自己声波点亮的墙可见（信息更封闭）
 * 共享只发生在**同一阵营**之间；敌方声波依旧不会给你任何地形信息。
 */
export const SHARE_TEAM_WALL_MEMORY = true;

/* ---------- 道具 ---------- */
/** 道具刷新间隔（秒）：每过这么久，地图上随机出现一个道具 */
export const ITEM_SPAWN_INTERVAL = 20;
/** 道具没人捡时的存活时间（秒），到点自动消失，避免地图上越堆越多 */
export const ITEM_LIFETIME = 30;
/** 道具的显示/拾取半径（px） */
export const ITEM_RADIUS = 11;
/** 拾取判定的额外宽容（px）：角色半径 + 道具半径 + 该值 */
export const ITEM_PICKUP_PAD = 2;
/** 刷新点与任何角色/已有道具的最小距离（px），避免“脸上刷道具” */
export const ITEM_SPAWN_MIN_DIST = 90;
/** 道具类型表：id 会写进协议，改动要同步 net/protocol.js 的版本号 */
export const ITEM_TYPES = {
  /** 使对方阵营角色全体现形 */
  reveal: {
    id: 'reveal', name: '回响之眼', icon: '👁', color: '#ffd166',
    desc: '敌方全体显形 1 秒', duration: 1.0
  },
  /** 使对方阵营所有角色定格 */
  freeze: {
    id: 'freeze', name: '凝滞之锁', icon: '❄', color: '#7fd3ff',
    desc: '敌方全体定格 2 秒', duration: 2.0
  },
  /** 使对方阵营所有角色立即发出一次噪声 */
  noise: {
    id: 'noise', name: '喧嚣之铃', icon: '🔔', color: '#ff7fc4',
    desc: '敌方全体发出噪声', duration: 0
  },
  /** 使自己加速 */
  haste: {
    id: 'haste', name: '疾行之羽', icon: '⚡', color: '#8ef0a8',
    desc: '自身加速 5 秒', duration: 5.0
  }
};
/** 道具池（等概率随机；想调权重就往数组里多写几次对应的 id） */
export const ITEM_POOL = ['reveal', 'freeze', 'noise', 'haste'];
/** 加速道具的移动速度倍率 */
export const ITEM_HASTE_MUL = 1.6;

/* ---------- AI 稳定性（防“贴墙左右晃”） ---------- */
/** 一次转向后，这段时间内不再接受“反向”指令，避免左右抖（秒） */
export const STEER_TURN_LOCK = 0.18;
/** 判定“想反向”的角度阈值（度） */
export const STEER_REVERSE_ANGLE = 100;
/** 路径平滑时往后看多少个节点（决定走多直） */
export const WAYPOINT_LOOKAHEAD = 8;
/** 追击时“直接扑过去”的最短保持时间（秒）：避免与寻路来回抢 */
export const CHASE_DIRECT_HOLD = 0.4;
/** 躲藏者逃跑点最短重算间隔（秒）：原先每帧重算导致原地打转 */
export const FLEE_REPLAN_INTERVAL = 0.7;
/** 威胁移动超过这个距离才值得立刻重算逃跑点（px） */
export const FLEE_REPLAN_THREAT_MOVE = 80;

/* ---------- 网络 / 主循环 ---------- */
/** 模拟固定步长（Hz）。固定步长是联机与回放复现的前提 */
export const SIM_HZ = 60;
/** 单帧最多补算多少个模拟步（防止切后台回来一次性算爆） */
export const SIM_MAX_STEPS_PER_FRAME = 5;
/** 房主向客户端广播快照的频率（Hz） */
export const NET_SNAPSHOT_HZ = 15;

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
