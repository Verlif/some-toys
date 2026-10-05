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

/* ── 本地双人的队伍安排 ── */
export const PLAYER_TEAM_SPLIT = 'split';  // 各带一队：P1 → 红队、P2 → 蓝队，两队各自记分
export const PLAYER_TEAM_SAME  = 'same';   // 并肩同队：两人都在红队（需每队 ≥ 2 人）

/* ── 队伍（最多 5 支，每队最多 5 人） ── */
export const MAX_TEAMS = 5, MAX_TEAM_SIZE = 5;
export const TEAM_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#06b6d4'];
export const TEAM_NAMES  = ['红队', '蓝队', '绿队', '紫队', '青队'];

/** 结算柱状图中区分真人玩家的斜条纹配色（P1 / P2） */
export const PLAYER_COLORS = ['#fbbf24', '#f472b6'];

export const DIRS8 = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];

/* ── 地雷类型 ── */
export const MINE_NONE = 0, MINE_INSTANT = 1, MINE_DELAYED = 2;

/* ── 减秒奖励（都是「全队每人」共享） ── */
export const FLAG_BONUS       = 5;    // 每面旗：该队每人最终用时 -5 秒
export const DEFUSE_BONUS     = 1;    // 每排掉一颗雷：该队每人最终用时 -1 秒

/* ── 旗帜 ── */
export const FLAG_MIN_GAP     = 7;    // 旗与旗之间的最小曼哈顿格距
export const FLAG_EXIT_MARGIN = 6;    // 旗与出口的最小格距（不给终点送温暖）
export const FLAG_MAX_DETOUR  = 22;   // 夺旗允许的最大绕路格数，超了就直接冲出口

/* ── AI ── */
export const AI_ROLES = ['runner', 'flagRunner', 'defuser'];
export const DEFUSER_SEARCH_R   = 24;  // 排雷手搜索「已知雷」的半径（格）
export const DEFUSER_MAX_JOBS   = 3;   // 排这么多雷之后回归冲刺
export const MINE_BEST_CHANCE   = 0.85;// 遇到雷时选择「最优解」的概率（其余随机，保留多样性）
export const MINE_LOOKAHEAD     = 3;   // 前瞻几格找已知雷（只看下一格来不及：速度 4.5 格/秒）
export const RESCUE_RADIUS      = 120; // 救援半径（像素）
export const RESCUE_STANDOFF    = 26;  // 到位后保持的距离，不再挤成一团
export const RESCUE_MAX_TIME    = 2.5; // 单人救援最多守这么久，之后放弃

/** 终点冲刺：离出口这么近就开始评估「直冲」 */
export const EXIT_RUSH_TILES   = 12;
/** 直冲概率；剩下的继续按角色思考（小概率保留变数） */
export const EXIT_RUSH_CHANCE  = 0.85;
/** 没选择直冲的话，隔多久再评估一次（秒） */
export const EXIT_RUSH_RETRY   = 1.5;

/* ── 出发区 / 入口走廊 ──
   迷宫左侧空地里没有任何可决策的东西，跨过入口后的一小段也一样：
   AI 在这两段里只管走进去，不思考、不扫描、不重估岔路，路线最多算一次。 */
export const ENTRY_CORRIDOR_COLS = 3;   // 入口往里这几列仍算走廊
export const ENTRY_TIMEOUT       = 8;   // 走廊里最多待这么久，超时强制转回正常 AI（兜底防卡死）
/** 待在出发区期间唯一那次思考的时长（秒）：允许想一次，但绝不能走一步想一步 */
export const STAGING_THINK_TIME  = 0.5;

/* ── 画布分辨率 ──
   逻辑坐标系恒为 CW × CH；位图分辨率 = 显示尺寸 × DPR（上限 MAX_DPR），
   由 render() 开头的 setTransform 把逻辑坐标映射到设备像素，
   放大后线条与文字仍是矢量清晰度，而不是把小位图拉伸。 */
export const MAX_DPR = 2;
export const MAX_BACKING_PX = 8e6;   // 位图总像素上限：4K/带鱼屏上避免填充量爆炸拖垮帧率

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
