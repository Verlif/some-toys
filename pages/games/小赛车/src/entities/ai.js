/* =========================================================
   ai.js — NPC 驾驶协调器
   一台 AI 由两位"驾驶员"共同操作：
     · ai-throttle.js 只踩油门 / 刹车 / 倒车（风格激进）
     · ai-steer.js    只打方向
   两人有各自的反应间隔，决策互相不同步，模拟双人合作驾驶；
   协调器负责共享感知、受阻判定、倒车脱困与掉头恢复。

   智能程度五挡（DRC.AI_LEVELS，startRace 时写进 CONFIG）：
     · 挡位越高，两位驾驶员的反应间隔越短、配合越默契
     · 最低挡不共享感知——rollJitter() 让两位驾驶员各算各的，
       且各自对赛道形状有随机理解偏差，即"完全没有默契"
     · 安全覆盖（急刹 / 倒车避让 / 横向分离）由 CONFIG.aiSafety
       门控，低挡位关闭——撞墙是正常的
     · 贴墙倒车降速是基础车辆操作，所有挡位都生效
     · 车距判断精度：跟车安全距（aiFollowBase / aiFollowHead）与
       急刹判断余量（aiBrakeReact / aiBrakeBuffer 叠加在物理最小
       刹停间距上）。从普通挡起，挡位越高跟得越近、越晚减速

   共享感知在两位驾驶员之间只算一次：
     · angleDiff   瞄准点偏差（瞄准点已向弯心内切，过弯走线更短，
                   叠走线偏好 / 绕行外移 / 并排避让，并限幅在路面内）
     · velAngle    行驶方向：车头朝向 ≠ 行驶方向是漂移的本质，转向
                   驾驶员要按它修正而不是按车头修
     · minRAhead   刹车窗口内的最小曲率半径（提前减速的依据）
     · blocker     车头前方最近的占道车
     · neighbor    并排最近的车（横向分离，防起步互切与超车侧擦；
                   含按同一台车连续跟踪算出的横向接近速度）
     · pass        绕行超车期间正在超的那台车（含身侧与略后方）
     · rear        正后方最近的车（倒车避让）
     · wallGap / headingToWall  与两侧墙的关系

   两种协作风格（DRC.DRIVE_STYLES，由 Game.useAiProfile 套进 CONFIG）：
     · 保守：弯心内切权重压到 0.26 = 几乎走中线；只用六成抓地，
             弯道限速把速度压到远低于漂移线，所以基本不甩尾
     · 激进：弯心内切拉到 1.34 倍 + 横向限幅放到 0.78 半宽 = 钳形
             最短路线；抓地用满，能漂就漂，几乎不主动收油

   协调器还保留两项安全覆盖（绕过驾驶员的反应间隔）：
     · 倒车时后方有车 → hold 住不倒
     · 前车近到刹不停 → 立即急刹，间距按相对距离缩短量
       （接近速度²/(2·刹车)）现场算，不是"自己一路跑过的距离"

   还有两条"胜负心"：
     · 位次速度补偿（橡皮筋）：名次越低 boost 越高（第一名 0，
       之后每落后一位 +2% 基准最大速度），物理限速同步放宽
     · 主动超车：被前车压住就选一侧绕出去（瞄准点外移 + 油门
       不低于前车速度+余量），绕行期间锁定目标车直到明显超过它
      （目标退到身侧时靠 pass 续上），不做稳定跟跑按部就班的车
   ========================================================= */
(function (DRC) {
  'use strict';

  const C = DRC.CONFIG;

  /** 采样点 i 处的局部曲率半径（三点外接圆，直线时为 Infinity） */
  function localRadius(s, i) {
    const n = s.length;
    const a = s[(i - 6 + n) % n];
    const b = s[i];
    const c = s[(i + 6) % n];
    const A = Math.hypot(b.x - a.x, b.y - a.y);
    const B = Math.hypot(c.x - b.x, c.y - b.y);
    const Cc = Math.hypot(c.x - a.x, c.y - a.y);
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) * 0.5;
    if (area < 1e-6) return Infinity;      // 三点共线 = 直道
    return (A * B * Cc) / (4 * area);
  }

  /**
   * 共享感知：把两位驾驶员都要用的信息算一次
   * @param {DRC.Car} car
   * @param {object} track
   * @param {Array} cars 全部车辆（含自己）
   * @param {?{lat:number, look:number, win:number}} jitter 世界观偏差
   *   （最低挡专用：两位驾驶员各算各的，对赛道的理解还不一样）
   * @returns {{spd:number, aimX:number, aimY:number, velAngle:number,
   *            angleDiff:number, minRAhead:number,
   *            blocker:?{ahead:number, side:number, speed:number},
   *            neighbor:?{ahead:number, side:number},
   *            rear:?{behind:number, side:number},
   *            pass:?{ahead:number, side:number, speed:number},
   *            wallGap:number, headingToWall:number}}
   */
  function sense(car, track, cars, jitter) {
    const j = jitter || { lat: 0, look: 0, win: 1 };
    const s = track.samples;
    const n = track.n;
    const spd = Math.abs(car.speed);
    const near = car.nearIdx;

    // 前视点：速度越快看得越远（jitter.look 可能为负，取模要防负索引）
    const look = Math.floor(C.aiLookAhead + spd * 0.028 + j.look);
    const tgt = s[((near + look) % n + n) % n];

    // 车际感知先算：瞄准点要用到"身旁有没有车"（并排避让），
    // 跟车 / 倒车避让 / 绕行锁定也都在这一遍里
    const hx = Math.cos(car.angle);
    const hy = Math.sin(car.angle);
    const range = C.aiDodgeRange + spd * 0.22;
    let blocker = null;      // 车头前方最近的占道车（含速度，供跟车判断接近快慢）
    let bestAhead = Infinity;
    let neighbor = null;     // 并排最近的车（含略偏前后），治横向互切
    let bestNb = Infinity;
    let rear = null;         // 正后方最近的车，倒车别往人家身上倒
    let bestRear = Infinity;
    let pass = null;         // 绕行超车中正在超的那台车（含身侧与略后方）
    let bestPass = Infinity;

    for (let i = 0; i < cars.length; i++) {
      const o = cars[i];
      if (o === car) continue;

      const dx = o.x - car.x;
      const dy = o.y - car.y;
      const ahead = dx * hx + dy * hy;
      const side = -dx * hy + dy * hx;          // 正 = 在车头右侧
      const dist2 = dx * dx + dy * dy;

      if (ahead > 0 && ahead <= range && Math.abs(side) <= C.aiDodgeHalfWidth && ahead < bestAhead) {
        bestAhead = ahead;
        blocker = { ahead: ahead, side: side, speed: Math.abs(o.speed) };
      }

      // 并排：贴着车身侧向的车（不限前后）——起步抢线、超车过半时
      // 两车会朝同一点收方向，必须靠横向分离各自让开
      if (Math.abs(ahead) < C.aiNeighborAhead && Math.abs(side) > 18 &&
          Math.abs(side) < C.aiNeighborSide && dist2 < bestNb) {
        bestNb = dist2;
        // 横向接近速度（px/s，按 60fps 估算）：两条线正在收拢时，光看
        // 当前侧偏距离反应太慢——等掉到贴身再让，横向速度已经收不住
        // （实测发车抢线：双方都瞄着内线切，隔着 100px 时避让权重只剩
        // 0.3，压不住弯心内切，等侧偏 40px 时才让就晚了）。只对同一台
        // 车连续跟踪才算——最近车会在几台车间跳换，跨车算差值是噪声
        const closing = (car.nbName === o.name && car.nbSide != null)
          ? Math.max(0, (car.nbSide - Math.abs(side)) * 60) : 0;
        neighbor = { ahead: ahead, side: side, closing: closing, name: o.name };
      }

      // 正后方：倒车路径上有没有车
      if (ahead < 0 && -ahead < C.aiRearRange && Math.abs(side) < C.aiRearHalfWidth && -ahead < bestRear) {
        bestRear = -ahead;
        rear = { behind: -ahead, side: side };
      }

      // 绕行超车进行中：锁定"正在超的那台车"。它超过半程后会退到
      // 身侧甚至略后方，blocker 只含正前方的车——不续上的话，刚好
      // 并排就收手回正，是最常见的超车失败原因。记录对方速度供油门加成
      if (car.otTimer > 0 && ahead > -170 && Math.abs(side) < 190 && dist2 < bestPass) {
        bestPass = dist2;
        pass = { ahead: ahead, side: side, speed: Math.abs(o.speed) };
      }
    }

    // 瞄准点向弯心内切：按前方一小段的朝向变化偏向内侧，
    // 过弯走线更短，同样的弯道限速能跑出更快的圈速。
    // 再叠两份"个性"：lineBias 是每台车开局 roll 的固定走线偏好
    // （有的偏内有的偏外，不是全场压着中线跑）；otSide 是超车绕行
    // 方向（要超车就往外线切，把内线让给前车）
    // 内切权重由驾驶档案决定：保守档压到 0.26 以下≈关掉内切走中线，
    // 激进档拉到 1.34 让它贴着弯心极限切——两者都乘进 lineBias，
    // 所以保守档连"自己的走线偏好"也一并收掉
    const apex = DRC.clamp(
      DRC.normAngle(s[(near + 26) % n].ang - s[(near + 6) % n].ang), -1.3, 1.3);
    const cut = C.aiLineWeight;
    let bias = apex * 0.32 * C.trackHalfWidth * cut + j.lat
      + car.lineBias * C.trackHalfWidth * 0.4 * cut
      + (car.otSide || 0) * 0.42 * C.trackHalfWidth;

    // 并排横向避让也作用在瞄准点上：只靠转向打舵压不住瞄准追踪——
    // 实测弯心内切会把两车对着挤，打舵那点修正会被 angleDiff 拉回去。
    // 身旁有车（不限前后）时，把瞄准点拉到"对方的横向位置再让开一个
    // 半车位"的地方；那一侧贴墙则不让。注意必须是"拉到目标位"，不是
    // 简单把瞄准点往那边推——双方都偏在一侧时，后者会把两车对着挤。
    // 与转向层的横向分离一样由安全开关门控：新手 / 入门各管各的，
    // 擦碰自负；从普通挡起才具备这种判断
    if (neighbor && C.aiSafety) {
      const away = neighbor.side >= 0 ? -1 : 1;        // 车在右半就往左让
      const edge2 = C.trackHalfWidth - car.wid * 0.5;
      const room = away > 0 ? edge2 + car.lat : edge2 - car.lat;
      // 让开的那一侧要留出真空间才让（满编 12 台时路面会被挤满，
      // 只剩一点点余量还硬往边上让，结果就是被顶到墙上蹭）
      if (room > 46) {
        // 权重 = 横向接近程度 × 纵向接近程度 + 横向收拢速度折算。
        // 收拢速度是提前量：双方都瞄着内线切时，隔着一百多 px 权重
        // 只剩 0.3，压不住弯心内切——加上收拢速度才会在"还没贴身"
        // 时就把线让开，而不是等侧偏掉到 40px 再救火
        const w = DRC.clamp(
          (1 - DRC.clamp(Math.abs(neighbor.side) / C.aiNeighborSide, 0, 1))
          * (1 - 0.45 * DRC.clamp(Math.abs(neighbor.ahead) / C.aiNeighborAhead, 0, 1))
          + neighbor.closing / 300, 0, 1);
        // 让开一个半车位：瞄准点偏移 78px 在 285px 前视距上约 15°，
        // 全速下能拉出 ~140px/s 的横向分离——让 60px 时只有 ~110px/s，
        // 压不住双方同时切内线的 ~280px/s 收拢
        const want = DRC.clamp(car.lat + neighbor.side + away * 78, -edge2, edge2);
        bias += (want - bias) * w;
      }
    }

    // 瞄准点不能超出路面：内切 + 走线 + 绕行 + 避让叠满时最深能到
    // ±137px，比墙面还靠外——车会直奔墙去（低速绕行撞墙的主因）。
    // 收到 aiLineRange 倍半宽内：留足车身与墙的距离，绕行该有的外移
    // 照样有。激进档放到 0.78（几乎用满路宽去切钳形线），
    // 保守档收到 0.44（贴着中线，连绕行外移都收敛）
    bias = DRC.clamp(bias, -C.aiLineRange * C.trackHalfWidth, C.aiLineRange * C.trackHalfWidth);

    const aimX = tgt.x + tgt.nx * bias;
    const aimY = tgt.y + tgt.ny * bias;

    const desired = Math.atan2(aimY - car.y, aimX - car.x);
    const angleDiff = DRC.normAngle(desired - car.angle);

    // 刹车窗口内的最小曲率半径：窗口覆盖"从现在减速到过弯"所需的距离，
    // 只要窗口里藏着更急的弯，现在就开始收油。窗口长度由档案决定——
    // 保守档把窗口拉长 1.45 倍，等于提前一个刹车点就开始收油；
    // 激进档收到 0.82，几乎是贴着弯才刹车
    const win = Math.floor((16 + spd * 0.055) * C.aiBrakeWindow * j.win);
    let minRAhead = Infinity;
    for (let k = 4; k <= win; k += 4) {
      const r = localRadius(s, (near + k) % n);
      if (r < minRAhead) minRAhead = r;
    }

    // 与墙的关系（墙在沥青 + 红白缓冲带之外）
    // headingToWall 用的是行驶方向而不是车头朝向：漂移时车尾已经甩出去了，
    // 车头看着没顶墙，屁股可能早就蹭上了
    const sample = s[near];
    const sign = car.lat >= 0 ? 1 : -1;
    const limit = C.trackHalfWidth + C.bufferWidth - car.wid * 0.5;
    const wallGap = limit - Math.abs(car.lat);
    const headingToWall =
      (Math.cos(car.velAngle) * sample.nx + Math.sin(car.velAngle) * sample.ny) * sign;

    // 记下本帧的并排对象与侧偏距离，供下一帧算横向接近速度
    car.nbName = neighbor ? neighbor.name : null;
    car.nbSide = neighbor ? Math.abs(neighbor.side) : null;

    return {
      spd: spd,
      // 瞄准点（转向驾驶员直接拿它算期望行驶方向）
      aimX: aimX,
      aimY: aimY,
      // 行驶方向（不是车头朝向）：有惯性的车上这两者会分开，
      // 转向驾驶员必须修正行驶方向才能真的走在那条线上
      velAngle: car.velAngle,
      angleDiff: angleDiff,
      minRAhead: minRAhead,
      blocker: blocker,
      neighbor: neighbor,
      rear: rear,
      pass: pass,
      wallGap: wallGap,
      headingToWall: headingToWall,
    };
  }

  /**
   * 受阻判定：方向踩满却推不动、且前方有车或贴墙，就安排一次倒车。
   * 这是两位驾驶员共享的"共识"，避免一人狂踩油门一人干瞪眼。
   *
   * 贴墙时倒车只会继续蹭——那本来是给"被车顶住"准备的。所以贴墙
   * 卡死改为直接朝赛道中心给油：低速下转向权限本来就小，
   * 车头朝哪转就往哪挪，慢但一定能挪出来。漂移模型之前撞墙后
   * 车头基本朝着路面方向，一路倒车就能退回去；现在车可能整台横在
   * 墙里（侧滑角上百度），倒车只会把车尾也塞进墙，必须换成前进。
   */
  function updateStuck(car, ctx, dt) {
    // 倒车也可能是"卡在墙里出不来"：车整台横过来之后，倒车脱困会
    // 把它按在墙上打转（车头永远对不上路面方向）。所以这里看的是
    // "贴墙 + 推不动"这个事实本身，不在乎当前是给油还是倒车
    const wedged = ctx.wallGap < 26 && ctx.spd < C.aiStuckSpeed;
    if (car.reverseTimer > 0) {
      car.reverseTimer -= dt;
      car.stuckTimer = wedged ? car.stuckTimer + dt : 0;
      // 倒车 0.9s 到了还是贴墙不动 → 换前进脱困，否则永远出不来
      if (car.reverseTimer <= 0 && wedged) {
        car.wallStuck = C.aiReverseTime;
        car.throttlePlan = 1;
      }
      return;
    }

    const pushing = ctx.spd < C.aiStuckSpeed && car.throttlePlan > 0.5;
    const blocked = (ctx.blocker !== null && ctx.blocker.ahead < 64) || ctx.wallGap < 26;

    if (pushing && blocked || wedged) car.stuckTimer += dt;
    else car.stuckTimer = 0;

    if (car.stuckTimer > 0.55) {
      car.stuckTimer = 0;
      if (ctx.wallGap < 26) {
        car.wallStuck = C.aiReverseTime;         // 贴墙卡死：改用前进脱困
      } else {
        car.reverseTimer = C.aiReverseTime;
        car.throttlePlan = -1;                    // 立即生效，不等下一次决策
      }
    }
  }

  /**
   * 位次速度补偿（橡皮筋）：名次越低给得越多——第一名不加，
   * 之后每落后一位多 2% 基准最大速度（第 2 名 +2%、第 3 名 +4%…）。
   * rank 由上一帧的 updateRanks 写好（1 = 领先）。
   * boost 阻尼平滑——超掉一台或被超一台时速度目标渐变，不会突然窜。
   * 物理上限（phys 的限速）随之放宽，这是"可以获得"的额外尾速。
   */
  function updateRankBoost(car, dt) {
    const want = 1 + C.aiRankStep * Math.max(0, car.rank - 1);
    // 丢掉名次时补偿涨得慢一点（避免刚被超就窜），
    // 抢到名次时收回得快一点（否则新领跑者还带着上一名的尾速优势）
    car.boost = DRC.damp(car.boost, want, want < car.boost ? 6 : 2, dt);
  }

  /** 绕行方向：优先前车反侧；那一侧太窄就换到宽的一侧 */
  function pickOvertakeSide(car, b) {
    const edge = C.trackHalfWidth - car.wid * 0.5;
    const roomLeft = edge + car.lat;
    const roomRight = edge - car.lat;
    let side = b.side >= 0 ? -1 : 1;            // 挡在右侧就往左绕
    const room = side > 0 ? roomRight : roomLeft;
    const alt = side > 0 ? roomLeft : roomRight;
    if (room < 30 && alt > room + 12) side = -side;
    return side;
  }

  /**
   * 主动超车状态机：被前车压住一段时间就选一侧绕出去，
   * 而不是稳定跟在前车尾巴后面按部就班。绕行期间始终锁定目标车
   * （含它退到身侧 / 略后方的情况）——油门加成与走线外移持续到
   * 「明显超过它」为止；半程松油门回正，是最常见的超车失败原因。
   * 积极性由挡位的 aiOvertake 决定：低挡位懒得超，
   * 高挡位贴上去就要超（发起更快、绕行更久、速度余量更大）。
   */
  function updateOvertake(car, ctx, dt) {
    if (C.aiOvertake <= 0) return;               // 积极性 0 = 完全不琢磨超车
    if (car.otCooldown > 0) car.otCooldown -= dt;

    const urge = DRC.clamp(C.aiOvertake, 0, 1);
    const b = ctx.blocker;
    // 绕行期间盯着"正在超的那台车"：它过半程后会退到身侧甚至略后方，
    // ctx.blocker 只含正前方的车——不续上的话，刚好并排就收手回正
    const tgt = b || ctx.pass;

    if (car.otTimer > 0) {
      car.otTimer -= dt;
      // 收队三种：目标已明显落到身后（超车完成）/ 目标跑掉或丢失 / 绕行超时。
      // "跑掉"按感知范围判定（dodgeRange + 速度折算）：超出这个距离才真的
      // 追不上了；发起时目标还隔着两百多 px 是常事，不能因此当场收手
      const passed = tgt !== null && tgt.ahead < -150;
      const lost = tgt === null || tgt.ahead > C.aiDodgeRange + ctx.spd * 0.22;
      if (passed || lost || car.otTimer <= 0) {
        car.otTimer = 0;
        car.otSide = 0;
        car.otCooldown = passed ? 1.2 : (lost ? 1.0 : 0.7);
      }
      return;
    }

    if (b && car.otCooldown <= 0 && car.blockTime > 0.85 - 0.5 * urge) {
      car.otSide = pickOvertakeSide(car, b);
      car.otTimer = DRC.rnd(1.6, 2.4) * (0.7 + 0.3 * urge);
    }
  }

  /**
   * 最低挡专用：两位驾驶员各自的世界观偏差。
   * 偏差每隔 0.4~0.8s 重抽一次——持续一小会儿，两个人才会稳定地
   * "各管各的"（一个瞄左一个刹早），而不是每帧随机抽搐。
   *
   * 偏差幅度由 aiJitterRange 封顶。加漂移之前它只影响走线好不好看；
   * 现在它直接乘进速度方向的修正里——油门按 A 的弯道算、转向按 B 的
   * 弯道算，两套指令天生对不上，车会在中线上左右横甩。原来的 ±20 /
   * 前视 ±2 / 窗口 0.8~1.2 实测太狠：60 秒只能跑 9km，等于开不出赛。
   * 收窄到 ±7 之后"完全没有默契"依然看得出来（撞墙多、圈速慢），
   * 但车还是能跑完全程——档位定位是"菜"，不是"动不了"。
   */
  function rollJitter(car, dt) {
    const j = car.jitter;
    const cap = C.aiJitterRange;
    j.ct -= dt;
    if (j.ct <= 0) {
      j.ct = DRC.rnd(0.4, 0.8);
      j.t = {
        lat: DRC.rnd(-cap, cap),
        look: Math.round(DRC.rnd(-1, 1)),
        win: DRC.rnd(0.88, 1.12),
      };
    }
    j.cs -= dt;
    if (j.cs <= 0) {
      j.cs = DRC.rnd(0.4, 0.8);
      j.s = {
        lat: DRC.rnd(-cap, cap),
        look: Math.round(DRC.rnd(-1, 1)),
        win: DRC.rnd(0.88, 1.12),
      };
    }
  }

  /**
   * @param {DRC.Car} car
   * @param {object} track
   * @param {Array} cars 全部车辆（含自己）
   * @param {number} dt
   * @param {string} [role] 'both'（默认，整车 AI）| 'throttle'（只接管前后）
   *   | 'steer'（只接管方向）。玩家车选了协作驾驶时，只出自己那一半，
   *   另一半由玩家键盘输入（见 game.stepRace）
   * @returns {{throttle:number, steer:number}}
   */
  function think(car, track, cars, dt, role) {
    // 只坐一个座位的两种互补情形：接管方向 / 接管前后
    const steerOnly = role === 'steer';
    const throttleOnly = role === 'throttle';

    // 感知：中高挡位共享一次，两位驾驶员看同一个世界；
    // 最低挡不共享——各算各的，且各自对赛道形状有随机理解偏差
    // （偏差幅度由 rollJitter 里的 aiJitterRange 限制，理由见那里）
    let ctxT, ctxS;
    if (C.aiSharedSense) {
      ctxT = ctxS = sense(car, track, cars);
    } else {
      rollJitter(car, dt);
      ctxT = sense(car, track, cars, car.jitter.t);
      ctxS = sense(car, track, cars, car.jitter.s);
    }

    // 跟车压迫计时：被前车压住越久，跟车距离压缩越多，超车欲望越强
    if (ctxT.blocker && ctxT.blocker.ahead < 95 + ctxT.spd * 0.45) {
      car.blockTime = Math.min(4, car.blockTime + dt);
    } else {
      car.blockTime = Math.max(0, car.blockTime - dt * 1.5);
    }

    // 位次速度补偿：名次越低尾速越高，每落后一位 +2% 基准最大速度。
    // 玩家车的接管位同样算"车上有 AI 在开"，照吃这份补偿
    updateRankBoost(car, dt);

    // 兜底：长时间原地打转就强制救援。
    // 低挡位"完全没有默契"在有惯性之后可能演变成自锁——两个人各按各的
    // 理解操作，指令互相抵消，车在原地反复横甩（实测 60 秒只跑 3km）。
    // 这不该是"菜"的一部分，菜是慢和撞墙，不是动不了。
    // 检测方式：连续 1.5s 速度都低于 90 且没有前进，就直接安排一次倒车
    if (ctxT.spd < 90 && car.reverseTimer <= 0 && car.wallStuck <= 0) {
      car.idleTimer += dt;
      if (car.idleTimer > 1.5) {
        car.idleTimer = 0;
        car.reverseTimer = 1.0;
        car.throttlePlan = -1;
      }
    } else {
      car.idleTimer = 0;
    }

    // 倒车脱困与掉头恢复都要靠油门执行：AI 不管油门时整段跳过，
    // 否则会出现「玩家踩着油门，AI 却按倒车逻辑打方向」的错乱
    if (!steerOnly) {
      updateStuck(car, ctxT, dt);
      if (car.wallStuck > 0) car.wallStuck -= dt;

      // 掉头 / 打横恢复：车头偏离赛道方向超过约 86° 且速度起不来时，
      // 倒车把车头摆回来——硬着头皮开只会横向滑墙
      if (car.reverseTimer > 0 || car.wallStuck > 0) {
        car.spinTimer = 0;
      } else {
        if (Math.abs(ctxT.angleDiff) > 1.5 && ctxT.spd < 160) car.spinTimer += dt;
        else car.spinTimer = 0;
        if (car.spinTimer > 0.35) {
          car.spinTimer = 0;
          car.reverseTimer = 0.75;
          car.throttlePlan = -1;
        }
      }
    }

    // 倒车中：节流仍归前后驾驶员（含贴墙降速），转向决策整个交给
    // 转向驾驶员（掉头回正 / 贴墙朝中心倒 / 反打脱开都在 ai-steer.js 里）。
    // 安全覆盖开启时，后方有车先稳住不倒；但已贴墙卡住时恢复优先——
    // 趴窝不动的车对后车只是静止障碍，持续刮墙谁也别想走
    if (car.reverseTimer > 0) {
      let thr = DRC.AIThrottle.decide(car, ctxT);
      if (C.aiSafety && ctxS.rear !== null && ctxS.wallGap >= 26) thr = 0;
      return { throttle: thr, steer: throttleOnly ? 0 : DRC.AISteer.decide(car, ctxS) };
    }

    // 超车状态机（倒车时不琢磨超车，先脱困）。只坐一个座位时照样跑：
    // 接管方向的一方会把线往要超的那侧带，接管前后的一方会给足油
    updateOvertake(car, ctxT, dt);

    // 前后驾驶员：按自己的反应间隔刷新决策
    if (!steerOnly) {
      car.throttleClock -= dt;
      if (car.throttleClock <= 0) {
        car.throttleClock = DRC.rnd(C.aiThrottleDelay[0], C.aiThrottleDelay[1]);
        car.throttlePlan = DRC.AIThrottle.decide(car, ctxT);
      }
    }

    // 转向驾驶员：独立节奏，与前后不同步
    if (!throttleOnly) {
      car.steerClock -= dt;
      if (car.steerClock <= 0) {
        car.steerClock = DRC.rnd(C.aiSteerDelay[0], C.aiSteerDelay[1]);
        car.steerPlan = DRC.AISteer.decide(car, ctxS);
      }
    }

    // 紧急制动（安全覆盖）：前车近到"现在不刹就停不住"时，立即覆盖油门计划，
    // 不等前后驾驶员的下一次反应——反应间隔内全速能冲出 50~90px，
    // 高速追尾往往就是差这半步。刹停间距按物理公式现场算：
    // 追上前车的过程中，相对距离只会缩短 closing²/(2·刹车)——这是
    // "必须保留"的量，而不是自己一路跑过的距离（旧公式按后者算，
    // 等于离着 140~200px 就重刹，间距明明很大却减速，不合理）。
    // 判断余量由挡位决定：普通挡起，挡位越高对"多近会撞"算得越准——
    // 按接近速度折算的反应余量越短、固定缓冲越薄，越晚减速；
    // 新手 / 入门没有安全覆盖，本就保守跟车。
    // 绕行超车中横向门控与常规一致：车偏在外线（侧偏 40+）时前车
    // 已经不可能被追尾，为它刹车只会把超车掐死在并排阶段；收回内线
    // 时侧偏掉到 40 以内，门控自然重新生效，照样刹得住
    // 接管方向的 AI 不碰油门，这条覆盖留给玩家自己判断（钻缝就撞，自己负责）
    if (!steerOnly && C.aiSafety && ctxT.blocker) {
      const b = ctxT.blocker;
      const closing = ctxT.spd - b.speed;
      const lateral = car.otTimer > 0 ? 44 : 42;
      if (closing > 20 && b.ahead > 0 && Math.abs(b.side) < lateral) {
        const phys = closing * closing / (2 * C.brake);
        const need = phys + closing * C.aiBrakeReact + C.aiBrakeBuffer;
        if (b.ahead < need) car.throttlePlan = -1;
      }
    }

    car.lastSteer = car.steerPlan;
    return { throttle: car.throttlePlan, steer: car.steerPlan };
  }

  DRC.AI = {
    think: think,
    sense: sense,
  };
})(window.DRC);
