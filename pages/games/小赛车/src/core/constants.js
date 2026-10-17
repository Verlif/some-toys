/* =========================================================
   constants.js — 全局命名空间与可调参数
   ========================================================= */
window.DRC = window.DRC || {};

(function (DRC) {
  'use strict';

  DRC.TAU = Math.PI * 2;

  /** 所有手感 / 规则参数集中在此，便于调参 */
  DRC.CONFIG = {
    // 赛道
    trackHalfWidth: 140,     // 沥青路面半宽（整车面宽 280 = 4 车位，留足超车空间）
    bufferWidth: 16,         // 沥青外侧的红白缓冲带宽度（墙在缓冲带之外）
    wallMargin: 2.5,         // 车身距墙的额外余量

    // 赛道生成（实时生长，无固定模板）
    trackStep: 15,           // 采样步长（世界单位）
    trackMinRadius: 110,     // 最小弯道半径，决定最急的发卡弯
    trackLength: [12000, 15200],  // 每圈目标长度区间

    // 车辆动力
    maxSpeed: 580,           // 最高前进速度
    reverseMax: 260,         // 最高倒车速度
    accel: 440,              // 加速度
    brake: 860,              // 刹车减速度
    reverseAccel: 280,       // 倒车加速度
    rollingDrag: 300,        // 松开油门后的滚动阻力
    turnRate: 2.6,           // 转向速率（rad/s）

    // 碰撞
    wallRestitution: 0.42,   // 撞墙反弹系数（0 = 完全不弹，1 = 完全弹性）
    wallFriction: 0.86,      // 撞墙后切向速度损耗
    carRestitution: 0.35,    // 车车碰撞分离系数
    carHitSlow: 0.9,         // 车车碰撞整体掉速
    effectCooldown: 0.13,    // 同一辆车两次碰撞特效的最小间隔

    // AI：前后与左右由两个独立"驾驶员"分别决策
    aiLookAhead: 5,          // 前视采样基数
    aiDodgeRange: 240,       // 前方避让的起始距离
    aiDodgeHalfWidth: 96,    // 视为挡住自己车道的横向阈值（4 车道路面上并排两车不算占道）
    aiNeighborAhead: 130,    // 并排分离感知的纵向范围（含略偏后的车）
    aiNeighborSide: 150,     // 并排分离感知的横向范围
    aiRearRange: 110,        // 倒车避让：后方车辆的感知距离
    aiRearHalfWidth: 100,    // 倒车避让：后方车辆的横向范围
    aiStuckSpeed: 50,        // 判定"推不动"的速度阈值
    aiReverseTime: 0.9,      // 倒车脱困持续时间
    aiCornerMargin: 0.80,    // 弯道限速余量：过弯速度上限 = turnRate × 曲率半径 × 该系数
    aiOvertakeGap: 0.30,     // 被长时间压制后，跟车距离最多压缩 30%，主动求超车
    aiOvertake: 0.60,        // 超车积极性 0~1（由挡位写入）：被压多久后发起绕行、绕行时的速度余量
    aiFollowBase: 82,        // 跟车安全距基数 px（由挡位写入）：挡位越高跟得越近
    aiFollowHead: 0.40,      // 跟车安全距的车头时距 s（由挡位写入）
    aiBrakeReact: 0.10,      // 急刹判断余量·按接近速度折算的秒数（由挡位写入）：判断越准值越小
    aiBrakeBuffer: 72,       // 急刹判断余量·固定缓冲 px（由挡位写入）：约一个车身长 + 余量
    aiRankBoost: 0.20,       // 位次速度加成上限：最后一名 +20%，按名次线性递减，第一名 0
    aiLineBias: 0.35,        // 每台车的基础走线偏好幅度（相对半宽）：不全场压中线，各有各的线
    aiThrottleDelay: [0.09, 0.15],   // 前后驾驶员的反应间隔（秒）
    aiSteerDelay: [0.07, 0.13],      // 转向驾驶员的反应间隔（秒）
    aiSteerGain: 2.4,                // 瞄准增益：方向 = 偏差 × 该系数（由挡位写入）
    aiLevel: 3,              // 默认智能程度挡位（1~5，见 DRC.AI_LEVELS）
    aiSafety: true,          // 安全覆盖总开关（由挡位写入：急刹/倒车避让/贴墙降速/横向分离）
    aiSharedSense: true,     // 两位驾驶员是否共享感知（由挡位写入；false = 各管各的）
    aiSkill: [0.85, 0.95],   // AI 技能系数区间（由挡位写入）

    // 流程
    countdownStep: 0.9,      // 3 / 2 / 1 / GO 每一步时长
    finishGracePerLap: 5,    // 首位冲线后，每圈宽限的秒数（总宽限 = 圈数 × 该值）
    npcMax: 12,              // AI 对手数量上限（配色池同样 12 色，保证每台车颜色不重复）
    lapMax: 9,
  };

  /**
   * AI 智能程度五挡。
   * 每位 AI 始终是"两位独立驾驶员"的架构；挡位改变的是：
   *   · 两位驾驶员的反应间隔（越长越各管各的）
   *   · 是否共享感知（最低挡不共享，且各自对赛道有随机理解偏差）
   *   · 激进程度（弯道限速余量 / 跟车压迫 / 躲车距离 / 前视 / 超车积极性）
   *   · 安全覆盖开关（急刹、倒车避让、贴墙降速、横向分离）
   *   · 车距判断精度（follow 跟车安全距 / brake 急刹判断余量）：
   *     从普通挡起，挡位越高对"多近会撞"算得越准——跟得越近、
   *     越晚减速，不会隔着老远就松油门；新手 / 入门保持保守
   * startRace() 会把所选挡位写进 CONFIG 的 ai* 字段，ai*.js 直接读。
   */
  DRC.AI_LEVELS = [
    {
      label: '新手',
      note: '两位驾驶员完全没有默契，各管各的：反应慢半拍，对赛道的理解还不一样，撞墙是常态',
      throttleDelay: [0.32, 0.55],
      steerDelay: [0.26, 0.44],
      steerGain: 1.4,
      cornerMargin: 0.66,
      overtakeGap: 0,
      overtake: 0.15,           // 超车积极性 0~1（新手）
      follow: [100, 0.47],      // 跟车安全距 [基数 px, 车头时距 s]：保守
      dodgeRange: 165,
      lookAhead: 5,
      safety: false,
      sharedSense: false,
      skill: [0.72, 0.88],
    },
    {
      label: '入门',
      note: '配合生疏：开始共享视野，但反应慢、过弯不敢压极限，撞墙仍不少',
      throttleDelay: [0.20, 0.34],
      steerDelay: [0.16, 0.28],
      steerGain: 1.8,
      cornerMargin: 0.68,
      overtakeGap: 0.08,
      overtake: 0.35,           // 超车积极性 0~1（入门）
      follow: [95, 0.45],       // 跟车安全距：仍保守
      dodgeRange: 190,
      lookAhead: 4,
      safety: false,
      sharedSense: true,
      skill: [0.80, 0.92],
    },
    {
      label: '普通',
      note: '有基本配合：会提前刹车、互相避让，偶有失误',
      throttleDelay: [0.14, 0.24],
      steerDelay: [0.11, 0.20],
      steerGain: 2.2,
      cornerMargin: 0.72,
      overtakeGap: 0.16,
      overtake: 0.60,           // 超车积极性 0~1（普通）
      follow: [82, 0.40],       // 跟车安全距：开始收得比较紧
      brake: [0.10, 72],        // 急刹判断余量 [反应折算 s, 固定缓冲 px]（缓冲 ≈ 一个车身长 + 余量）
      dodgeRange: 245,
      lookAhead: 5,
      safety: true,
      sharedSense: true,
      skill: [0.85, 0.96],
    },
    {
      label: '老练',
      note: '反应快、跟车压迫积极、走线干净，很少出事',
      throttleDelay: [0.10, 0.16],
      steerDelay: [0.08, 0.14],
      steerGain: 2.4,
      cornerMargin: 0.80,
      overtakeGap: 0.30,
      overtake: 0.80,           // 超车积极性 0~1（老练）
      follow: [66, 0.32],       // 跟车安全距：贴身跟跑
      brake: [0.07, 66],        // 急刹判断余量：贴到接近物理极限才出手
      dodgeRange: 215,
      lookAhead: 5,
      safety: true,
      sharedSense: true,
      skill: [0.88, 1.00],
    },
    {
      label: '赛车手',
      note: '极度激进：贴限过弯、贴身超车、反应几乎无延迟——但仍然是两位各管各的驾驶员',
      throttleDelay: [0.07, 0.12],
      steerDelay: [0.05, 0.10],
      steerGain: 2.6,
      cornerMargin: 0.86,
      overtakeGap: 0.38,
      overtake: 1.00,           // 超车积极性 0~1（赛车手）
      follow: [52, 0.26],       // 跟车安全距：轮对轮级别
      brake: [0.04, 62],        // 急刹判断余量：几乎只按物理刹停距离行事
      dodgeRange: 275,
      lookAhead: 6,
      safety: true,
      sharedSense: true,
      skill: [0.93, 1.05],
    },
  ];

  /** 两名玩家固定配色 */
  DRC.PLAYER_COLORS = ['#3aa0ff', '#ff5d6c'];

  /**
   * AI 配色池：12 色，与 npcMax 一一对应——满编 12 台时每台车颜色都不重复
   * （小地图圆点与排名列表全靠颜色区分）。色相之外还错开明暗，避免
   * 相邻两色在深色沥青上撞脸；两名玩家的蓝 / 红不在池内
   */
  DRC.AI_COLORS = [
    '#3ddc84', '#ffc93c', '#b06bff', '#ff8a3d', '#3dd9e0', '#ff6bd6',
    '#a6e22e', '#ff5fa2', '#7f8cff', '#f2f2f2', '#1abc9c', '#ff9e80',
  ];

  /**
   * 合作模式的两种分工方案。
   * throttle = 负责前后，steer = 负责左右，两人各管一半。
   */
  DRC.COOP_SCHEMES = {
    1: {
      label: '方案 A',
      throttle: { owner: '玩家 1', keys: ['W', 'S'], roles: ['前进', '后退'] },
      steer: { owner: '玩家 2', keys: ['←', '→'], roles: ['左转', '右转'] },
      hint: 'P1 W/S 前后 · P2 ←/→ 转向',
      note: '玩家 1 用 W / S 控制前进与后退，玩家 2 用 ← / → 控制左右转向',
    },
    2: {
      label: '方案 B',
      throttle: { owner: '玩家 1', keys: ['↑', '↓'], roles: ['前进', '后退'] },
      steer: { owner: '玩家 2', keys: ['A', 'D'], roles: ['左转', '右转'] },
      hint: 'P1 ↑/↓ 前后 · P2 A/D 转向',
      note: '玩家 1 用 ↑ / ↓ 控制前进与后退，玩家 2 用 A / D 控制左右转向',
    },
  };
})(window.DRC);
