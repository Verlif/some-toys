/* =========================================================
   particles.js — 特效粒子系统
   撞击火花：lighter 叠加，高亮爆点。
   轮胎烟：普通混合，随寿命膨胀并变淡，漂移时从后轮冒出。
   两类粒子的混合模式不同，分两遍画。
   ========================================================= */
(function (DRC) {
  'use strict';

  const SPARK_COLORS = ['#fff8d6', '#ffd166', '#ffb347', '#ff8a3d'];

  class Particles {
    constructor() {
      this.items = [];
    }

    clear() {
      this.items.length = 0;
    }

    /**
     * 在碰撞点喷出火花
     * @param {number} x 世界坐标
     * @param {number} y 世界坐标
     * @param {number} angle 主喷射方向
     * @param {number} count 粒子数量
     * @param {number} power 0~1，撞击强度（影响初速与寿命）
     */
    sparks(x, y, angle, count, power) {
      const boost = 0.6 + power;
      for (let i = 0; i < count; i++) {
        const a = angle + DRC.rnd(-1.15, 1.15);
        const sp = DRC.rnd(70, 250) * boost;
        const life = DRC.rnd(0.22, 0.5) * (0.75 + power * 0.6);
        this.items.push({
          k: 0,
          x: x,
          y: y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: life,
          max: life,
          size: DRC.rnd(1.4, 3.2),
          color: SPARK_COLORS[(Math.random() * SPARK_COLORS.length) | 0],
        });
      }
    }

    /**
     * 漂移轮胎烟：一小团慢慢膨胀的灰白雾
     * @param {number} x @param {number} y 世界坐标
     * @param {number} power 0~1，漂移强度（影响浓度与体积）
     */
    smoke(x, y, power) {
      const life = DRC.rnd(0.5, 0.95);
      this.items.push({
        k: 1,
        x: x + DRC.rnd(-4, 4),
        y: y + DRC.rnd(-4, 4),
        vx: DRC.rnd(-26, 26),
        vy: DRC.rnd(-26, 26),
        life: life,
        max: life,
        size: DRC.rnd(5, 8) * (0.7 + power * 0.7),
        grow: DRC.rnd(16, 30) * (0.6 + power * 0.8),
        alpha: 0.10 + power * 0.14,
      });
    }

    update(dt) {
      const items = this.items;
      for (let i = items.length - 1; i >= 0; i--) {
        const p = items[i];
        p.life -= dt;
        if (p.life <= 0) {
          items.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.k === 1) {
          p.size += p.grow * dt;               // 烟随时间膨胀
          continue;
        }
        const drag = Math.pow(0.12, dt);   // 强阻尼，火花迅速散开停下
        p.vx *= drag;
        p.vy *= drag;
      }
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     */
    draw(ctx) {
      if (!this.items.length) return;

      // ① 轮胎烟：普通混合，暗色胎印上飘起来的一层薄雾
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 0; i < this.items.length; i++) {
        const p = this.items[i];
        if (p.k !== 1) continue;
        const k = p.life / p.max;
        ctx.globalAlpha = p.alpha * k;
        ctx.fillStyle = '#c8ccd2';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, DRC.TAU);
        ctx.fill();
      }

      // ② 火花：lighter 叠加，越到末期越暗
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < this.items.length; i++) {
        const p = this.items[i];
        if (p.k !== 0) continue;
        const k = p.life / p.max;
        ctx.globalAlpha = k;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * k;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  DRC.Particles = Particles;
})(window.DRC);
