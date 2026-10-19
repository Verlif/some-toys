/* =========================================================
   car.js — 车辆实体与基础物理
   玩家与 AI 共用同一套前进 / 刹车 / 倒车 / 转向逻辑，
   赛道边界约束与碰撞特效由 systems/collision.js 负责。

   惯性与漂移：车头朝向（angle）与行驶方向（velAngle）是两个角。
   转向改的是车头，行驶方向靠横向轮胎力追——速度越高，可用的横向
   加速度越低，追得越慢，于是高速打方向就会甩出侧滑角（slip）。
   滑角一大就是漂移：转向"不咬"、沿车头方向的速度被摩擦掉、路面上
   留下淡淡的双轮胎印。行进中重刹会让前轴失抓，同样能甩出去。
   ========================================================= */
(function (DRC) {
  'use strict';

  const C = DRC.CONFIG;

  class Car {
    constructor(x, y, angle, color, opts) {
      opts = opts || {};

      this.x = x;
      this.y = y;
      this.angle = angle;
      this.speed = 0;
      this.color = color;

      // 行驶方向（速度矢量指向，含正负号含义）。起步与 angle 相同，
      // 高速打方向后两者分开 = 侧滑
      this.velAngle = angle;
      this.slip = 0;        // 侧滑角（rad）：车头朝向减去行驶方向
      this.drift = 0;       // 漂移强度 0~1，driftSlip 以上才开始计
      this.brakeFade = 1;   // 本帧的抓地折减（重刹时前轴失抓）
      this.pitch = 0;       // 刹车点头量（纯表现层，渲染时车身前倾）
      this._fwd = true;     // 上一帧是否前进（跨越零点时行驶方向要翻半个 π）

      // 身份
      this.isPlayer = !!opts.isPlayer;
      this.playerIndex = opts.playerIndex == null ? -1 : opts.playerIndex;
      this.name = opts.name || 'AI';

      // 车型：决定车身尺寸与外观，碰撞体随之变化
      this.model = opts.model || DRC.CAR_MODELS[0];
      this.len = this.model.len;
      this.wid = this.model.wid;

      // 赛道位置
      this.trackIdx = 0;
      this.nearIdx = 0;
      this.lat = 0;

      // 赛况
      this.lap = 0;
      this.crossed = false;
      this.progress = 0;
      this.rank = 1;
      this.finished = false;
      this.finishTime = 0;
      this.finishChime = false;   // 冲线音效是否已播（纯表现层状态）

      // 本场数据统计（结算页用）
      this.lapTimes = [];
      this.bestLap = 0;
      this.lapStart = 0;
      this.wallHits = 0;      // 撞墙次数（以触发火花为准）
      this.carHits = 0;       // 车与车碰撞次数
      this.topSpeed = 0;      // 本场最高速度

      // AI：前后 / 左右两个"驾驶员"各自的决策缓存与反应节奏
      this.skill = 1;
      this.aiLevel = 0;      // 该车 NPC 挡位（0 = 没有 AI 在开；玩家接管位看 driveStyle）
      this.driveStyle = 0;   // 该车 AI 队友的风格（0 = 不适用；1 保守 / 2 激进）
      this.stuckTimer = 0;
      this.reverseTimer = 0;
      this.wallStuck = 0;      // 贴墙卡死脱困计时（>0 时前进脱困，而不是倒车）
      this.idleTimer = 0;       // 原地打转计时（连续低速多久算卡住）
      this.lastSteer = 0;
      this.throttlePlan = 0;
      this.steerPlan = 0;
      this.throttleClock = 0;
      this.steerClock = 0;
      this.blockTime = 0;    // 被前车压住的累计时长（驱动求超车欲望）
      this.spinTimer = 0;    // 车头持续偏离赛道方向的时长（触发倒车回正）
      // 上一帧的并排侧偏距离（算横向接近速度用：null = 身旁没有车）
      this.nbSide = null;
      // 位次速度补偿（橡皮筋）：名次越低越高（每落后一位 +2%），
      // ai.js 每帧按名次刷新，phys 的限速随之放宽——追不上时白给一点尾速
      this.boost = 1;
      // 主动超车：otSide = 绕行方向（-1 左 / +1 右 / 0 不绕），
      // otTimer = 本次绕行剩余时间，otCooldown = 回正冷却
      this.otSide = 0;
      this.otTimer = 0;
      this.otCooldown = 0;
      // 基础走线偏好（开局 roll 一次，相对半宽的比例）：各有各的线，
      // 不是全场都压着中线跑
      this.lineBias = 0;
      // 最低挡位专用：两位驾驶员"各管各的"的世界观偏差
      // （瞄准点横向偏移 / 前视采样 / 刹车窗口），各自独立刷新
      this.jitter = {
        t: { lat: 0, look: 0, win: 1 }, s: { lat: 0, look: 0, win: 1 },
        ct: 0, cs: 0,
      };

      // 特效状态
      this.hitFlash = 0;
      this.effectCooldown = 0;
      // 漂移取样的连续状态（上一帧两个后轮的位置），由 TireMarks 回写
      this.tire = null;
    }

    /**
     * 单帧物理积分
     * @param {number} dt
     * @param {number} throttle -1 ~ 1（正为前进）
     * @param {number} steer    -1 ~ 1（正为右转）
     */
    phys(dt, throttle, steer) {
      // 转向：改的是车头朝向。速度越低转向越弱，倒车时方向相反。
      // 踩着刹车打方向时前轴已经失抓，转向权限反而更"整"——
      // 同样的输入能把车头甩得更多，这正是重刹入弯容易推头的原因
      const grip = DRC.clamp(Math.abs(this.speed) / 220, 0, 1);
      const dir = this.speed >= 0 ? 1 : -1;
      const brakeAmt = (throttle < -0.01 && this.speed > 10) ? -throttle : 0;
      this.pitch = DRC.damp(this.pitch, brakeAmt * this.brakeFade, 14, dt);   // 车身点头，纯表现层
      const yaw = steer * C.turnRate * grip * dir
        * (1 + brakeAmt * C.brakeYaw * DRC.clamp(Math.abs(this.speed) / C.maxSpeed, 0, 1));
      this.angle += yaw * dt;

      if (throttle > 0.01) {
        if (this.speed < -10) this.speed += C.brake * dt;             // 倒车中踩油门 = 刹车
        else this.speed += C.accel * dt * throttle;
      } else if (throttle < -0.01) {
        const t = Math.abs(throttle);
        if (this.speed > 10) this.speed -= C.brake * dt * t;          // 前进中踩刹车
        else this.speed -= C.reverseAccel * dt * t;                   // 静止或后退中 = 倒车
      } else {
        const f = C.rollingDrag * dt;
        if (Math.abs(this.speed) <= f) this.speed = 0;
        else this.speed -= Math.sign(this.speed) * f;
      }

      // 限速：硬上限，油门顶不出这个值（软阻尼会让全油门稳态超出上限
      // 10% 以上，把位次补偿的 2% 差异完全吃掉）
      const vmax = C.maxSpeed * this.boost;
      if (this.speed > vmax) this.speed = vmax;
      if (this.speed < -C.reverseMax) this.speed = -C.reverseMax;

      // 越过零点（前进切倒车）：行驶方向要跟着掉头，否则 velAngle 会平白
      // 多出半个 π，被当成巨大的侧滑角
      const fwd = this.speed >= 0;
      if (fwd !== this._fwd) this.velAngle += fwd ? Math.PI : -Math.PI;
      this._fwd = fwd;

      this.updateSlip(dt, throttle);
      this.integrate(dt);

      const v = Math.abs(this.speed);
      if (v > this.topSpeed) this.topSpeed = v;
    }

    /**
     * 惯性与漂移：把行驶方向拉回车头朝向。
     * 横向加速度 = min(刚度 × 滑角, 抓地上限)，速度越高抓地上限越低，
     * 所以行驶方向追得越慢——这正是"高速打方向会甩出去"的来源。
     * 重刹时前轴先失去抓地，抓地上限还会额外塌缩一段。
     */
    updateSlip(dt, throttle) {
      const v = Math.abs(this.speed);

      // 前轴失抓：只在"前进中踩刹车"时发生，静止挪车不算
      const braking = (throttle < -0.01 && this.speed > 10) ? -throttle : 0;
      this.brakeFade = 1 - C.brakeSlide * braking * DRC.clamp(v / C.maxSpeed, 0, 1);

      if (v < 2) {
        // 速度低到没有侧滑可言：行驶方向直接咬住车头
        this.velAngle = this.angle;
        this.slip = 0;
        this.drift = 0;
        return;
      }

      // 行驶方向（倒车时是 velAngle + π，速度矢量的反方向）
      let travel = (this.speed >= 0 ? this.velAngle : this.velAngle + Math.PI);
      const slip = DRC.normAngle(this.angle - travel);

      const gripMax = C.lateralGrip
        * (1 - C.lateralGripFalloff * DRC.clamp(v / C.maxSpeed, 0, 1))
        * this.brakeFade;
      let rate = Math.min(C.lateralStiff * Math.abs(slip), gripMax) / v;
      if (Math.abs(slip) > C.slipMax) {
        rate += C.spinRecover * (Math.abs(slip) - C.slipMax);   // 打转：额外往回拉
      }

      travel += (slip >= 0 ? rate : -rate) * dt;
      this.velAngle = (this.speed >= 0 ? travel : travel - Math.PI);

      // 侧滑角：车头朝向与行驶方向的夹角
      this.slip = DRC.normAngle(this.angle - travel);

      // 漂移强度：滑角超过 driftSlip 才起算，速度太低不留痕
      this.drift = (v >= C.driftSpeed && Math.abs(this.slip) > C.driftSlip)
        ? DRC.clamp((Math.abs(this.slip) - C.driftSlip) / C.driftFull, 0, 1)
        : 0;

      // 漂移损耗：轮胎侧向滑动把沿车头方向的速度磨掉
      const scrub = C.driftDrag * Math.abs(Math.sin(this.slip)) * dt;
      if (Math.abs(this.speed) > scrub) this.speed -= Math.sign(this.speed) * scrub;
      else this.speed = 0;
    }

    /** 位置积分：沿行驶方向走，所以漂移时车会真的往侧滑方向偏出去 */
    integrate(dt) {
      this.x += Math.cos(this.velAngle) * this.speed * dt;
      this.y += Math.sin(this.velAngle) * this.speed * dt;
    }

    /**
     * 漂移时两个后轮的地面坐标（胎痕取样点）。
     * 返回 null 表示当前不在漂移。
     * @returns {?{x:number, y:number}}
     */
    rearWheels() {
      if (this.drift <= 0) return null;
      const c = Math.cos(this.angle);
      const s = Math.sin(this.angle);
      const bx = this.x - c * this.len * 0.3;
      const by = this.y - s * this.len * 0.3;
      const off = this.wid * 0.42;
      return {
        lx: bx - s * off, ly: by + c * off,
        rx: bx + s * off, ry: by - c * off,
        w: this.wid,
        drift: this.drift,
      };
    }

    /** 推进特效计时器 */
    tick(dt) {
      if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);
      if (this.effectCooldown > 0) this.effectCooldown = Math.max(0, this.effectCooldown - dt);
    }
  }

  DRC.Car = Car;
})(window.DRC);
