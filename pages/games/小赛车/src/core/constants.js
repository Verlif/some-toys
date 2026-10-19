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
    turnRate: 2.6,           // 车头朝向的转向速率（rad/s）——注意它约束的是车头，不是行驶轨迹

    // 惯性与漂移：车头朝向与行驶方向分离，由横向轮胎力把行驶方向拉回车头
    lateralGrip: 1450,       // 横向加速度上限（px/s²）：速度越高，可用来"拽回"的速度变化率越低
    lateralGripFalloff: 0.35,// 抓地上限随速度衰减的比例（满速时只剩 65%）
    lateralStiff: 3100,      // 侧偏刚度（px/s² per rad）：横向加速度 = 该值 × 滑角，超过上限被 gripMax 截断；
                              // 回正时间常数 = 速度 / 该值，所以高速的滑角"赖"得更久
    brakeSlide: 0.42,        // 行进中重刹时前轴失抓：抓地上限最多塌缩到 58%
    brakeYaw: 0.85,          // 重刹放大转向的系数：踩着刹车打方向，转向权限 ×(1+该值)
    slipMax: 0.95,           // 侧滑角上限（rad ≈ 54°），超过按打转处理并强制回正
    spinRecover: 7.0,        // 打转后的额外回正速率：把满舵死打的稳态滑角兜在 60° 出头
    driftSlip: 0.17,         // 滑角超过这个值（≈10°）才算漂移，开始留胎痕
    driftSpeed: 190,         // 低于这个速度不留胎痕（挪车、原地打方向不算）
    driftDrag: 190,          // 漂移速度损耗（px/s²），按 |sin(slip)| 折算
    driftFull: 0.52,         // 滑角达到 driftSlip + 该值时漂移强度满格
    tireLife: 5.0,           // 轮胎印寿命（秒）：淡出后回收，不留整局痕迹
    tireAlpha: 0.26,         // 轮胎印最大不透明度（淡淡一层）
    tireWidth: 0.15,         // 单条胎痕宽度（相对车宽）
    tireStep: 9,             // 相邻胎痕点的最小间距（世界单位），太密就浪费
    tireMax: 2200,           // 全场胎痕段数上限，超出丢最旧的

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
    aiRankStep: 0.02,        // 位次速度补偿：每落后一位 +2% 基准最大速度，第一名 0
    aiLineBias: 0.35,        // 每台车的基础走线偏好幅度（相对半宽）：不全场压中线，各有各的线
    aiGripUse: 0.85,         // 弯道限速里允许用掉多少横向抓地（0~1）：用得越满滑角越大
    aiDriftCap: 0.34,        // 弯道限速时允许的最大滑角（rad）：保守的路把速度压到漂移线以下
    aiLineWeight: 1.0,       // 瞄准点里"弯心内切"的权重：保守≈0.3（走中线），激进 >1（极限切角）
    aiLineRange: 0.72,       // 走线偏移的横向限幅（相对半宽）
    aiJitterRange: 7,        // 低档位"不默契"的世界观偏差上限（px）：超过这个量级油门与转向会自相矛盾
    aiSlipLead: 1.2,         // 侧滑前馈系数：转向输入里扣掉 slip×该系数，补偿"车头已到位、车还在甩"
    aiAlignLoss: 0.22,       // 车头尚未对准弯道时的额外收油比例：激进几乎不为对不准收油
    aiBrakeWindow: 1.0,      // 刹车前视窗口倍率：保守拉长（提前一个刹车点收油），激进收紧
    aiThrottleDelay: [0.09, 0.15],   // 前后驾驶员的反应间隔（秒）
    aiSteerDelay: [0.07, 0.13],      // 转向驾驶员的反应间隔（秒）
    aiSteerGain: 2.4,                // 瞄准增益：方向 = 偏差 × 该系数（由挡位写入）
    aiLevel: 3,              // 默认智能程度挡位（1~5，见 DRC.AI_LEVELS）
    aiSafety: true,          // 安全覆盖总开关（由挡位写入：急刹/倒车避让/贴墙降速/横向分离）
    aiSharedSense: true,     // 两位驾驶员是否共享感知（由挡位写入；false = 各管各的）
    aiSkill: [0.85, 0.95],   // AI 过弯技能系数区间（由挡位写入）：只乘在弯道限速上，不影响直道尾速

    // 流程
    countdownStep: 0.9,      // 3 / 2 / 1 / GO 每一步时长
    finishGracePerLap: 5,    // 首位冲线后，每圈宽限的秒数（总宽限 = 圈数 × 该值）
    npcMax: 12,              // AI 对手数量上限（配色池同样 12 色，保证每台车颜色不重复）
    lapMax: 9,
  };

  /**
   * AI 智能程度五挡（全场 NPC 对手用）。
   * 每位 AI 始终是"两位独立驾驶员"的架构；挡位改变的是：
   *   · 两位驾驶员的反应间隔（越长越各管各的）
   *   · 是否共享感知（最低挡不共享，且各自对赛道有随机理解偏差）
   *   · 激进程度（弯道限速余量 / 跟车压迫 / 躲车距离 / 前视 / 超车积极性）
   *   · 安全覆盖开关（急刹、倒车避让、贴墙降速、横向分离）
   *   · 车距判断精度（follow 跟车安全距 / brake 急刹判断余量）：
   *     从普通挡起，挡位越高对"多近会撞"算得越准——跟得越近、
   *     越晚减速，不会隔着老远就松油门；新手 / 入门保持保守
   *   · 漂移余量（gripUse / driftCap）：能用到多少横向抓地、
   *     弯里允许滑到多大滑角——低挡位不敢滑，高挡位贴边走
   */
  DRC.AI_LEVELS = [
    {
      label: '新手',
      note: '两位驾驶员完全没有默契，各管各的：反应慢半拍，对赛道的理解还不一样，撞墙是常态',
      throttleDelay: [0.32, 0.55],
      steerDelay: [0.26, 0.44],
      steerGain: 1.4,
      cornerMargin: 0.66,
      gripUse: 0.74,
      driftCap: 0.22,
      lineWeight: 0.86,
      lineRange: 0.66,
      slipLead: 1.15,
      alignLoss: 0.26,
      brakeWindow: 1.08,
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
      gripUse: 0.79,
      driftCap: 0.26,
      lineWeight: 0.92,
      lineRange: 0.70,
      slipLead: 1.2,
      alignLoss: 0.24,
      brakeWindow: 1.06,
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
      gripUse: 0.84,
      driftCap: 0.31,
      lineWeight: 1.0,
      lineRange: 0.72,
      slipLead: 1.2,
      alignLoss: 0.22,
      brakeWindow: 1.00,
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
      gripUse: 0.90,
      driftCap: 0.40,
      lineWeight: 1.08,
      lineRange: 0.74,
      slipLead: 1.35,
      alignLoss: 0.20,
      brakeWindow: 0.95,
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
      note: '极度激进：贴限过弯、贴身超车、反应几乎无延迟，能用漂移换弯道就绝不收油',
      throttleDelay: [0.07, 0.12],
      steerDelay: [0.05, 0.10],
      steerGain: 2.6,
      cornerMargin: 0.86,
      gripUse: 0.97,
      driftCap: 0.55,
      lineWeight: 1.18,
      lineRange: 0.76,
      slipLead: 1.5,
      alignLoss: 0.18,
      brakeWindow: 0.88,
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

  /**
   * 协作驾驶的两种驾驶员风格（玩家车里另一个座位上的 AI 队友）。
   * 与 AI_LEVELS 是两套独立参数：前者决定"这位队友开得多稳 / 多敢"，
   * 后者决定"全场 NPC 有多强"。
   *   保守 = 把安全放在第一位：早收油、留足车距、走中线不切角，
   *          几乎不主动漂移——宁可慢，也要把车完整地交回玩家手里
   *   激进 = 相信玩家会做完美操作：以"玩家能兜住"为前提，很少主动减速，
   *          走几何最短路线、极限切角，能漂就漂——风险留给玩家，圈速留给你们
   */
  DRC.DRIVE_STYLES = [
    {
      key: 'safe',
      label: '保 守',
      note: '安全优先：进弯前早早收油、跟车留足距离、贴着中线走不切角，' +
        '几乎不主动漂移——宁可慢半拍，也要把车完整地交回你手里',
      throttleDelay: [0.12, 0.20],
      steerDelay: [0.09, 0.16],
      steerGain: 2.0,
      cornerMargin: 0.70,
      gripUse: 0.78,          // 只用八成抓地：弯里基本不甩
      driftCap: 0.24,         // 弯里滑角上限：略高于留胎痕线，急弯偶尔擦一道胎印
      lineWeight: 0.26,       // 弯心内切几乎关掉 = 走中线
      lineRange: 0.44,
      slipLead: 1.35,         // 侧滑补偿给足：出弯回正早，高速贴线
      alignLoss: 0.30,
      brakeWindow: 1.15,      // 别拉太长：窗口过长会连直道都收油（实测全速占比掉到 51%）
      overtakeGap: 0.05,
      overtake: 0.35,
      follow: [150, 0.62],    // 跟车安全距拉得很开
      brake: [0.17, 130],     // 远在安全之外就开始收油
      dodgeRange: 310,
      lookAhead: 5,
      safety: true,
      sharedSense: true,
      skill: [0.86, 0.96],
    },
    {
      key: 'fast',
      label: '激 进',
      note: '无条件信任你：几乎不主动减速、追到车尾才松、' +
        '走几何最短路线并用漂移切角——你做完美操作，它就不拖你后腿',
      throttleDelay: [0.06, 0.11],
      steerDelay: [0.05, 0.09],
      steerGain: 2.5,
      cornerMargin: 0.95,
      gripUse: 1.00,          // 抓地用满：弯里能滑起来换更紧的线
      driftCap: 0.64,
      lineWeight: 1.34,       // 弯心内切拉到 1.34 倍 = 钳形最短路线
      lineRange: 0.78,
      slipLead: 0.95,         // 少补偿：更信自己的转向，不等抓地慢慢拽
      alignLoss: 0.09,        // 车头没对准也照样冲
      brakeWindow: 0.82,
      overtakeGap: 0.40,
      overtake: 0.95,
      follow: [56, 0.27],     // 贴身跟，认为你会处理
      brake: [0.04, 58],      // 贴着物理刹停距离才介入
      dodgeRange: 250,
      lookAhead: 6,
      safety: true,
      sharedSense: true,
      skill: [0.94, 1.04],
    },
  ];

  /**
   * 把一份驾驶参数档案写进 CONFIG（ai*.js 全部直接读 CONFIG，不逐层传参）。
   * 档案既可能是 AI_LEVELS 里的一挡，也可能是 DRIVE_STYLES 里的一种风格，
   * 字段名完全一致，所以 NPC 与协作队友可以共用这一段。
   * 一场比赛里可以同时存在多套档案——做法是"思考某台车之前先把
   * 它那套参数套进 CONFIG"（见 Game.useAiProfile），而不是让 ai*.js 逐层收参数。
   */
  function applyProfile(p) {
    const C = DRC.CONFIG;

    C.aiThrottleDelay = p.throttleDelay;
    C.aiSteerDelay = p.steerDelay;
    C.aiSteerGain = p.steerGain;
    C.aiCornerMargin = p.cornerMargin;
    C.aiGripUse = p.gripUse;
    C.aiDriftCap = p.driftCap;
    C.aiLineWeight = p.lineWeight;
    C.aiLineRange = p.lineRange;
    C.aiSlipLead = p.slipLead;
    C.aiAlignLoss = p.alignLoss;
    C.aiBrakeWindow = p.brakeWindow;
    C.aiOvertakeGap = p.overtakeGap;
    C.aiDodgeRange = p.dodgeRange;
    C.aiLookAhead = p.lookAhead;
    C.aiSafety = p.safety;
    C.aiSharedSense = p.sharedSense;
    C.aiSkill = p.skill;
    C.aiOvertake = p.overtake;
    C.aiFollowBase = p.follow[0];
    C.aiFollowHead = p.follow[1];
    // 新手 / 入门没有安全覆盖，这两项读不到；照样写成常量，
    // 免得换车时残留上一台车的数值
    C.aiBrakeReact = p.brake ? p.brake[0] : 0.10;
    C.aiBrakeBuffer = p.brake ? p.brake[1] : 72;

    return p;
  }

  /**
   * 套用某个智能程度挡位（全场 NPC）
   * @param {number} level 1~5
   */
  DRC.applyAiLevel = function (level) {
    return applyProfile(DRC.AI_LEVELS[(level || 3) - 1] || DRC.AI_LEVELS[2]);
  };

  /**
   * 套用某种协作驾驶风格（玩家车接管位）
   * @param {number} style 1 = 保守，2 = 激进
   */
  DRC.applyDriveStyle = function (style) {
    return applyProfile(DRC.DRIVE_STYLES[(style || 1) - 1] || DRC.DRIVE_STYLES[0]);
  };

  /**
   * 驾驶方式：每台车有前后（油门 / 刹车）与方向两位驾驶员。
   * 玩家可以自己开两边，也可以只坐一个座位、把另一边交给 AI 队友。
   *   own  = 玩家自己负责的那一轴
   *   role = 接管位 AI 在 ai.js 里扮演的角色
   */
  DRC.DRIVE_SEATS = {
    0: { label: '自主驾驶', short: '自主', own: 'both', role: 'both' },
    1: { label: '前后位', short: '前后位', own: 'throttle', role: 'steer' },
    2: { label: '方向位', short: '方向位', own: 'steer', role: 'throttle' },
  };

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
