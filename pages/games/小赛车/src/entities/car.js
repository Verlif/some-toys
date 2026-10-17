/* =========================================================
   car.js — 车辆实体与基础物理
   玩家与 AI 共用同一套前进 / 刹车 / 倒车 / 转向逻辑，
   赛道边界约束与碰撞特效由 systems/collision.js 负责。
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

      // 本场数据统计（结算页用）
      this.lapTimes = [];
      this.bestLap = 0;
      this.lapStart = 0;
      this.wallHits = 0;      // 撞墙次数（以触发火花为准）
      this.carHits = 0;       // 车与车碰撞次数
      this.topSpeed = 0;      // 本场最高速度

      // AI：前后 / 左右两个"驾驶员"各自的决策缓存与反应节奏
      this.skill = 1;
      this.stuckTimer = 0;
      this.reverseTimer = 0;
      this.lastSteer = 0;
      this.throttlePlan = 0;
      this.steerPlan = 0;
      this.throttleClock = 0;
      this.steerClock = 0;
      this.blockTime = 0;    // 被前车压住的累计时长（驱动求超车欲望）
      this.spinTimer = 0;    // 车头持续偏离赛道方向的时长（触发倒车回正）
      // 上一帧的并排侧偏距离（算横向接近速度用：null = 身旁没有车）
      this.nbSide = null;
      // 位次速度加成（橡皮筋）：最后一名最高 +10%，ai.js 每帧按名次刷新，
      // phys 的限速随之放宽——追不上时白给一点尾速，比赛始终有悬念
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
    }

    /**
     * 单帧物理积分
     * @param {number} dt
     * @param {number} throttle -1 ~ 1（正为前进）
     * @param {number} steer    -1 ~ 1（正为右转）
     */
    phys(dt, throttle, steer) {
      // 转向：速度越低转向越弱，倒车时方向相反
      const grip = DRC.clamp(Math.abs(this.speed) / 220, 0, 1);
      const dir = this.speed >= 0 ? 1 : -1;
      this.angle += steer * C.turnRate * dt * grip * dir;

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

      // 限速（位次加成会放宽上限，玩家车恒为 1）
      const vmax = C.maxSpeed * this.boost;
      if (this.speed > vmax) {
        this.speed -= (this.speed - vmax) * Math.min(1, 5 * dt);
      }
      if (this.speed < -C.reverseMax) {
        this.speed -= (this.speed + C.reverseMax) * Math.min(1, 5 * dt);
      }

      this.x += Math.cos(this.angle) * this.speed * dt;
      this.y += Math.sin(this.angle) * this.speed * dt;

      const v = Math.abs(this.speed);
      if (v > this.topSpeed) this.topSpeed = v;
    }

    /** 推进特效计时器 */
    tick(dt) {
      if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);
      if (this.effectCooldown > 0) this.effectCooldown = Math.max(0, this.effectCooldown - dt);
    }
  }

  DRC.Car = Car;
})(window.DRC);
