/* =========================================================
   scene/blackhole.js —— 黑洞
   ---------------------------------------------------------------
   造型极简：就是一个中心纯黑、边缘渐变到透明的小球，没有光晕、没有
   吸积盘、没有边缘流光。

   而它对星点做的事**完全交给牛顿力学**——没有任何"入轨""绕圈"之类的
   状态或参数化轨道。星点永远只是一个被积分的质点：

       a = 引力(径向)  +  吸积流耦合(黏滞拖曳)
       v += a · dt        ← 惯性在这里
       x += v · dt

   两项力各自的任务：

   1. 引力  a = gm·R² / (r² + soften²)，并在作用半径处平滑收尾。
      纯径向的中心力，**不产生任何力矩**，所以角动量守恒——
      星点进来是什么轨道，就沿着什么轨道走（椭圆就是椭圆）。

   2. 吸积流耦合  v ← v + (v_flow − v) · k · dt
      v_flow 是**当地圆轨道的切向速度**。这是一个耗散项：它把速度大小
      拖向当地轨道速度、方向拖向切向，于是
        · 径向落速被吃掉 → 星点从"径向下坠"逐渐转成"环绕"
        · 每绕一圈都损失一点能量 → 远心点逐圈收缩 → **椭圆慢慢变成圆**
        · 角动量由吸积流提供（真实吸积盘的物质本来就带着轨道角动量进来，
          纯径向坠落的物质不可能绕行——这一点绕不过去）
      目标速度取 flowInflow(<1) 倍，永远略低于圆轨道速度，
      所以圆化之后还会持续缓慢内落，最终被吞没。

   注意这里是**速度耦合**而不是"加一个切向力"：切向力会持续对星点做功，
   越转越快最后直接飞出去；耦合是耗散的，只会把速度拉向流场速度。
   ========================================================= */
(function (global) {
  'use strict';

  var NS = global.AnswerBook;
  var C = NS.config.blackhole;
  var M = NS.math;
  var vp = NS.viewport;
  var TAU = M.TAU;
  var rand = NS.rand;
  var randInt = NS.randInt;

  /** 当前存活的黑洞。同屏最多一个 */
  var list = [];
  var timer = C.firstDelayMs;

  /* =========================================================
     生命周期
     ========================================================= */

  function spawn() {
    var r = rand(C.radiusMin, C.radiusMax);
    var margin = r * C.influence;                 // 入场边距 = 引力作用半径

    /* 从屏幕外某一侧进入 */
    var side = randInt(0, 3);
    var x, y;
    if (side === 0)      { x = -margin;                          y = rand(-margin, vp.height + margin); }
    else if (side === 1) { x = vp.width + margin;                y = rand(-margin, vp.height + margin); }
    else if (side === 2) { x = rand(-margin, vp.width + margin); y = -margin; }
    else                 { x = rand(-margin, vp.width + margin); y = vp.height + margin; }

    /* 目标落在屏幕中心 ±28% 区域，保证真正横穿画面而不是擦边而过 */
    var tx = vp.width * 0.5 + rand(-vp.width * 0.28, vp.width * 0.28);
    var ty = vp.height * 0.5 + rand(-vp.height * 0.28, vp.height * 0.28);
    var angle = Math.atan2(ty - y, tx - x) + rand(-0.25, 0.25);
    var speed = rand(C.speedMin, C.speedMax);

    list.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: r,
      age: 0
    });
  }

  /** 推进黑洞自身：移动、计时召唤、越界回收 */
  function update(dt) {
    if (list.length === 0) {
      timer -= dt * 1000;
      if (timer <= 0) {
        spawn();
        timer = rand(C.intervalMinMs, C.intervalMaxMs);
      }
    }

    for (var i = list.length - 1; i >= 0; i--) {
      var bh = list[i];

      bh.x += bh.vx * dt;
      bh.y += bh.vy * dt;
      bh.age += dt;

      /* 连同引力作用范围一起移出画面后才回收 */
      var m = bh.r * (C.influence + 2);
      if (bh.x < -m || bh.x > vp.width + m || bh.y < -m || bh.y > vp.height + m) {
        list.splice(i, 1);
      }
    }
  }

  /* =========================================================
     引力 + 吸积流耦合
     ========================================================= */

  /**
   * 施加引力与吸积流耦合，并吞没落入球内的星点
   * @param {Array} stars 星点数组（原地修改）
   * @param {number} dt
   */
  function attract(stars, dt) {
    if (list.length === 0) return;

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.dim = 1;

      for (var b = 0; b < list.length; b++) {
        var bh = list[b];
        var dx = bh.x - s.x;
        var dy = bh.y - s.y;
        var r = M.len(dx, dy) || 0.0001;
        var reach = bh.r * C.influence;

        if (r < reach) {
          s.inGravity = true;                      // 井内不做速度回归，保持纯惯性

          var ux = dx / r;                         // 由星点指向球心
          var uy = dy / r;

          /* --- 1. 引力：软化平方反比，在作用半径处平滑收尾 --- */
          var soften = C.soften * bh.r;
          var a = (C.gm * bh.r * bh.r) / (r * r + soften * soften);
          a *= 1 - M.smoothstep(reach * C.taper, reach, r);

          s.vx += ux * a * dt;
          s.vy += uy * a * dt;

          /* --- 2. 吸积流耦合：把速度拖向当地圆轨道速度（切向） --- */
          var k = C.flowCoupling *
                  (1 - M.smoothstep(C.flowInner * bh.r, C.flowRange * bh.r, r));
          if (k > 0) {
            var vFlow = Math.sqrt(a * r) * C.flowInflow;   // 当地圆轨道速度，刻意略低
            var lean = k * dt;

            /* (-uy, ux) 是径向的单位切向量，即吸积流的流向 */
            s.vx += (-uy * vFlow - s.vx) * lean;
            s.vy += (ux * vFlow - s.vy) * lean;
          }
        }

        /* 落入球内即被吞没。重生点由黑球盖住，看不到瞬移 */
        if (r < bh.r) {
          NS.stars.respawn(s);
          break;
        }

        /* 越靠近球面越暗，让尾流和星点一起"沉"进去，而不是在球边被硬切 */
        var dim = M.smoothstep(bh.r * 0.7, bh.r * 1.5, r);
        if (dim < s.dim) s.dim = dim;
      }
    }
  }

  /* =========================================================
     绘制：中心纯黑、往外渐变到完全透明的小球
     ---------------------------------------------------------------
     用径向渐变而不是填一个纯黑圆，是为了让边缘"化开"：
     纯黑圆在星空上是一块硬邦邦的剪影，边界太清楚，看起来像贴上去的
     一个圆片；渐变之后边缘把星光一层层吃掉，才像一个真正把光吸走的东西。

     渐变的两个端点：
       内半径 = (1 - edgeSoft)·R   ← 从这里开始往外透明，以内全是纯黑
       外半径 = R                  ← 完全透明
     注意 alpha 是渐变的、颜色始终是黑：所以渐变带是"越来越淡的黑"，
     而不是"越来越灰"。用 source-over 叠在星空上，效果就是星光被压暗。
     ========================================================= */

  function draw() {
    if (list.length === 0) return;

    var ctx = vp.ctx;

    for (var i = 0; i < list.length; i++) {
      var bh = list[i];

      /* 时间上淡入、贴边淡出，避免凭空出现或凭空消失 */
      var fadeIn = M.smoothstep(0, 1, Math.min(1, bh.age / C.fadeInSec));
      var edge = Math.min(
        Math.min(bh.x + bh.r * 4, vp.width + bh.r * 4 - bh.x),
        Math.min(bh.y + bh.r * 4, vp.height + bh.r * 4 - bh.y)
      );
      var fade = fadeIn * M.smoothstep(0, bh.r * 3, edge);
      if (fade <= 0.002) continue;

      ctx.save();
      ctx.globalAlpha = fade;
      ctx.globalCompositeOperation = 'source-over';

      var core = bh.r * (1 - C.edgeSoft);
      var g = ctx.createRadialGradient(bh.x, bh.y, core, bh.x, bh.y, bh.r);
      g.addColorStop(0, 'rgba(0, 0, 0, 1)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.beginPath();
      ctx.arc(bh.x, bh.y, bh.r, 0, TAU);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
    }
  }

  NS.blackhole = {
    list: list,
    spawn: spawn,
    update: update,
    attract: attract,
    draw: draw
  };
})(window);
