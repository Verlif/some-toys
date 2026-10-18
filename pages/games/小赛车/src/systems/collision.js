/* =========================================================
   collision.js — 碰撞系统（车身级精确判定）
   1) 车与车：车身有向矩形（OBB）分离轴检测，位置分离 + 掉速 + 特效
   2) 车与赛道墙：车身四角分别投影到围墙，任一角越界即整车推回
   ========================================================= */
(function (DRC) {
  'use strict';

  const C = DRC.CONFIG;

  function velocityOf(car) {
    return {
      x: Math.cos(car.angle) * car.speed,
      y: Math.sin(car.angle) * car.speed,
    };
  }

  /** 有向矩形在某一轴上的投影半径 */
  function radiusOn(car, ax, ay) {
    const c = Math.cos(car.angle);
    const s = Math.sin(car.angle);
    return Math.abs(c * ax + s * ay) * car.len * 0.5 +
      Math.abs(-s * ax + c * ay) * car.wid * 0.5;
  }

  /**
   * 两个有向矩形的分离轴检测
   * @returns {?{nx:number, ny:number, depth:number}} 从 b 指向 a 的最小分离方向
   */
  function obbHit(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;

    const axes = [
      Math.cos(a.angle), Math.sin(a.angle),
      -Math.sin(a.angle), Math.cos(a.angle),
      Math.cos(b.angle), Math.sin(b.angle),
      -Math.sin(b.angle), Math.cos(b.angle),
    ];

    let depth = Infinity;
    let nx = 0;
    let ny = 0;

    for (let i = 0; i < 8; i += 2) {
      const ax = axes[i];
      const ay = axes[i + 1];
      const proj = dx * ax + dy * ay;
      const overlap = radiusOn(a, ax, ay) + radiusOn(b, ax, ay) - Math.abs(proj);

      if (overlap <= 0) return null;     // 找到分离轴，未碰撞

      if (overlap < depth) {
        depth = overlap;
        const sign = proj < 0 ? -1 : 1;
        nx = ax * sign;
        ny = ay * sign;
      }
    }

    return { nx: nx, ny: ny, depth: depth };
  }

  /**
   * 车与车碰撞
   * @param {Array} cars
   * @param {DRC.Particles} effects
   * @param {DRC.Camera} cam
   */
  function resolveCars(cars, effects, cam) {
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];

      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];

        const hit = obbHit(a, b);
        if (!hit) continue;

        // 位置分离
        const push = hit.depth * 0.5;
        a.x += hit.nx * push;
        a.y += hit.ny * push;
        b.x -= hit.nx * push;
        b.y -= hit.ny * push;

        // 沿分离轴的接近速度 → 撞击强度
        const av = velocityOf(a);
        const bv = velocityOf(b);
        const closing = Math.abs((av.x - bv.x) * hit.nx + (av.y - bv.y) * hit.ny);

        a.speed *= C.carHitSlow;
        b.speed *= C.carHitSlow;

        if (closing < 50) continue;
        if (a.effectCooldown > 0 || b.effectCooldown > 0) continue;

        const power = DRC.clamp(closing / C.maxSpeed, 0, 1);
        a.effectCooldown = C.effectCooldown;
        b.effectCooldown = C.effectCooldown;
        a.hitFlash = Math.max(a.hitFlash, 0.1 + power * 0.16);
        b.hitFlash = Math.max(b.hitFlash, 0.1 + power * 0.16);
        a.carHits++;
        b.carHits++;

        const mx = (a.x + b.x) * 0.5;
        const my = (a.y + b.y) * 0.5;
        effects.sparks(mx, my, Math.atan2(hit.ny, hit.nx), 8 + Math.round(power * 16), power);
        cam.shake(2 + power * 12);
        DRC.Sound.hit(power, mx, my, a.isPlayer || b.isPlayer);
      }
    }
  }

  /** 车身四角写入 out（世界坐标） */
  function cornersOf(car, out) {
    const c = Math.cos(car.angle);
    const s = Math.sin(car.angle);
    const hl = car.len * 0.5;
    const hw = car.wid * 0.5;

    out[0].x = car.x + c * hl - s * hw; out[0].y = car.y + s * hl + c * hw;
    out[1].x = car.x + c * hl + s * hw; out[1].y = car.y + s * hl - c * hw;
    out[2].x = car.x - c * hl + s * hw; out[2].y = car.y - s * hl - c * hw;
    out[3].x = car.x - c * hl - s * hw; out[3].y = car.y - s * hl + c * hw;
    return out;
  }

  const CORNERS = [
    { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
  ];

  /**
   * 赛道硬约束：按车身四角判断越界，取越界最多的角把整车推回，
   * 再用车身速度的法向分量反弹。四角判定保证左右碰撞区与车型完全一致。
   */
  function constrainToTrack(car, track, effects, cam) {
    // 带 hint 的就近搜索：平交路口处不会跳错车道
    const near = DRC.Track.nearest(track, car.x, car.y, car.trackIdx);
    const s = track.samples[near.i];

    car.nearIdx = near.i;
    car.lat = (car.x - s.x) * s.nx + (car.y - s.y) * s.ny;

    // 墙体位于沥青 + 红白缓冲带之外
    const limit = C.trackHalfWidth + C.bufferWidth - C.wallMargin;
    cornersOf(car, CORNERS);

    let worst = 0;
    let sign = 0;
    let cx = 0;
    let cy = 0;

    for (let i = 0; i < 4; i++) {
      const p = CORNERS[i];
      const lat = (p.x - s.x) * s.nx + (p.y - s.y) * s.ny;
      const over = Math.abs(lat) - limit;
      if (over > worst) {
        worst = over;
        sign = lat >= 0 ? 1 : -1;
        cx = p.x;
        cy = p.y;
      }
    }

    if (worst <= 0) return;

    // 1) 硬约束：把车身整体推回赛道
    const nx = s.nx * sign;
    const ny = s.ny * sign;
    car.x -= nx * worst;
    car.y -= ny * worst;
    cx -= nx * worst;
    cy -= ny * worst;

    // 2) 速度分解：法向反弹 + 切向摩擦
    const v = velocityOf(car);
    const vn = v.x * nx + v.y * ny;

    if (vn > 0) {
      const k = 1 + C.wallRestitution;
      const rvx = v.x - k * vn * nx;
      const rvy = v.y - k * vn * ny;
      const hx = Math.cos(car.angle);
      const hy = Math.sin(car.angle);
      car.speed = (rvx * hx + rvy * hy) * C.wallFriction;

      const power = DRC.clamp(vn / (C.maxSpeed * 0.55), 0, 1);
      if (power > 0.05 && car.effectCooldown <= 0) {
        car.effectCooldown = C.effectCooldown;
        car.hitFlash = Math.max(car.hitFlash, 0.12 + power * 0.26);
        car.wallHits++;

        // 火花从实际发生碰撞的那个角飞溅
        effects.sparks(cx, cy, Math.atan2(-ny, -nx), 6 + Math.round(power * 14), power);
        cam.shake(2 + power * 14);
        DRC.Sound.hit(power, cx, cy, car.isPlayer);
      }
    } else {
      // 贴墙滑行时的轻微摩擦
      car.speed *= 0.985;
    }
  }

  DRC.Collision = {
    resolveCars: resolveCars,
    constrainToTrack: constrainToTrack,
  };
})(window.DRC);
