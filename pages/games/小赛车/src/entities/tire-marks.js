/* =========================================================
   tire-marks.js — 漂移轮胎印
   只在漂移时取样：每台车的两个后轮各留一道淡淡的痕迹，连成折线段。
   痕迹有寿命（默认 5 秒），淡出后回收——既能看到刚才那次甩尾，
   又不会在长局里堆出一张看不清的旧地图。
   宽度按世界坐标画（车宽的比例），所以鸟瞰拉远时会自然变细，
   像真实路面上的痕迹那样随透视缩小，而不是屏幕上恒定粗细的黑带。
   绘制按不透明度分桶，一桶一次 stroke，段数再多也不会掉帧。
   ========================================================= */
(function (DRC) {
  'use strict';

  const C = DRC.CONFIG;
  const BUCKETS = 5;          // 不透明度分桶数：桶数越多淡出越细腻
  const IN_FADE = 0.08;       // 出生瞬间的淡入时长，避免痕迹"啪"地出现

  class TireMarks {
    constructor() {
      this.segs = [];
      this.age = 0;           // 全局计时器，所有段共用（省掉逐段计时）
    }

    clear() {
      this.segs.length = 0;
      this.age = 0;
    }

    /**
     * 从一台车上取样：漂移就追加一段，不漂移就断开（下次漂移从新点起）
     * @param {DRC.Car} car
     * @param {DRC.Particles} fx 用于喷轮胎烟（可为 null）
     */
    sample(car, fx) {
      const w = car.rearWheels();

      if (!w) {
        if (car.tire) car.tire.on = false;
        return;
      }

      if (!car.tire || !car.tire.on) {
        // 刚进入漂移：以当前位置为起点，下一帧才有第一段
        car.tire = { on: true, lx: w.lx, ly: w.ly, rx: w.rx, ry: w.ry, smoke: 0 };
        return;
      }

      const st = car.tire;
      const step = C.tireStep;
      const mx = w.lx + w.rx - st.lx - st.rx;
      const my = w.ly + w.ry - st.ly - st.ry;
      if (mx * mx + my * my >= step * step * 4) {
        this.push(st.lx, st.ly, w.lx, w.ly, w.w);
        this.push(st.rx, st.ry, w.rx, w.ry, w.w);
      }
      st.lx = w.lx; st.ly = w.ly; st.rx = w.rx; st.ry = w.ry;

      // 轮胎烟：漂移越猛越浓，隔两帧喷一次，不至于糊成一片
      if (fx && --st.smoke <= 0) {
        st.smoke = 2;
        fx.smoke(w.lx, w.ly, w.drift);
        fx.smoke(w.rx, w.ry, w.drift);
      }
    }

    /** 追加一段轮胎印 */
    push(x1, y1, x2, y2, wid) {
      const segs = this.segs;
      segs.push({ x1: x1, y1: y1, x2: x2, y2: y2, w: wid * C.tireWidth, b: this.age });
      if (segs.length > C.tireMax) segs.splice(0, segs.length - C.tireMax);
    }

    /** 推进寿命并回收过期痕迹 */
    update(dt) {
      this.age += dt;
      const life = C.tireLife;
      const segs = this.segs;
      // 段按写入顺序排列，过期的永远在前面，从头扫即可
      let cut = 0;
      while (cut < segs.length && this.age - segs[cut].b > life) cut++;
      if (cut) segs.splice(0, cut);
    }

    /** @param {CanvasRenderingContext2D} ctx 世界坐标下绘制 */
    draw(ctx) {
      const segs = this.segs;
      if (!segs.length) return;

      const span = C.tireLife - IN_FADE;
      const paths = [];
      for (let i = 0; i < BUCKETS; i++) paths.push(null);

      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const age = this.age - s.b;
        // 正在淡入的一律归第一桶
        const k = age < IN_FADE ? 1 : 1 - (age - IN_FADE) / span;
        let b = ((DRC.clamp(k, 0, 1) * BUCKETS) | 0);
        if (b > BUCKETS - 1) b = BUCKETS - 1;
        if (!paths[b]) paths[b] = [];
        paths[b].push(s);
      }

      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(16,18,22,1)';

      for (let b = 0; b < BUCKETS; b++) {
        const list = paths[b];
        if (!list) continue;
        ctx.globalAlpha = C.tireAlpha * (BUCKETS - b) / BUCKETS;

        // 线宽逐段设定会打断批处理，所以取桶内最大值统一画：
        // 同桶里的宽度最多差一台车的车宽，肉眼看不出来
        let w = 0;
        ctx.beginPath();
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          if (s.w > w) w = s.w;
          ctx.moveTo(s.x1, s.y1);
          ctx.lineTo(s.x2, s.y2);
        }
        ctx.lineWidth = w;
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  DRC.TireMarks = TireMarks;
})(window.DRC);