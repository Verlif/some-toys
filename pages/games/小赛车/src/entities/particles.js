/* =========================================================
   particles.js — 碰撞火花粒子系统
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

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';

      for (let i = 0; i < this.items.length; i++) {
        const p = this.items[i];

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
