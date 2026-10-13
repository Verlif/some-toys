/* =========================================================
   scene/stars.js —— 星辰层
   每颗星持有一份**真实的速度**，位置完全由速度积分得到：

     (bvx, bvy)  基线漂移速度 —— 星场无人扰动时的匀速流动
     (vx,  vy )  当前速度     —— 被黑洞引力改变之后才与基线不同

   这里刻意不用"原位 + 位移偏移"的橡皮筋模型：那种模型下星点被拉走
   之后一定会被弹回原位，位置是被弹簧绑住的，也就谈不上惯性。改成
   速度积分之后，星点被引力推着走多远、走多快，都真实地累积下来；
   只有在**脱离所有引力井**之后，速度才缓慢回归基线，星场重新归于平静。

   尾流不属于这里，也不由任何状态触发：它只是把每帧的位置喂给
   scene/trail.js，于是"被吸引 → 加速 → 环绕"整条路径自动获得痕迹，
   不存在"进入黑洞才突然长出尾巴"的问题。
   ========================================================= */
(function (global) {
  'use strict';

  var NS = global.AnswerBook;
  var C = NS.config.stars;
  var M = NS.math;
  var vp = NS.viewport;
  var TAU = M.TAU;

  /** 星星数组本体。始终复用同一引用，供黑洞模块直接遍历 */
  var list = [];

  function makeStar() {
    var depth = Math.random();                 // 0 = 远且暗，1 = 近且亮
    var angle = Math.random() * TAU;
    var speed = C.speedMin + depth * C.speedSpan;
    var bvx = Math.cos(angle) * speed;
    var bvy = Math.sin(angle) * speed;

    return {
      x: Math.random() * vp.width,
      y: Math.random() * vp.height,

      bvx: bvx, bvy: bvy,                      // 基线漂移速度
      vx: bvx, vy: bvy,                        // 当前速度，惯性由它承载

      r: C.radiusMin + depth * C.radiusSpan,
      alpha: 0.22 + depth * 0.72,
      tw: 0.4 + Math.random() * 1.8,           // 闪烁频率
      phase: Math.random() * TAU,
      sprite: NS.sprites.pool[(Math.random() * NS.sprites.pool.length) | 0],
      trail: NS.trail.create(C.trailSpan, C.trailSteps),

      dim: 1,                                  // 被吞没时的透明度系数
      inGravity: false                         // 本帧是否处在某个引力井内
    };
  }

  /** 重建星场：数量随视口面积自适应 */
  function build() {
    var count = M.clamp(
      Math.round(vp.width * vp.height / C.areaPerStar),
      C.minCount,
      C.maxCount
    );

    list.length = 0;
    for (var i = 0; i < count; i++) list.push(makeStar());
  }

  /** 把一颗星挪到屏幕外随机边缘，并清空它的速度与轨迹 */
  function respawn(s) {
    var pad = 30;
    var edge = (Math.random() * 4) | 0;

    if (edge === 0)      { s.x = -pad;                     s.y = Math.random() * vp.height; }
    else if (edge === 1) { s.x = vp.width + pad;           s.y = Math.random() * vp.height; }
    else if (edge === 2) { s.x = Math.random() * vp.width; s.y = -pad; }
    else                 { s.x = Math.random() * vp.width; s.y = vp.height + pad; }

    s.vx = s.bvx;
    s.vy = s.bvy;
    s.dim = 1;
    s.inGravity = false;
    s.trail.reset();                           // 否则会从旧位置拉出一条长线
  }

  function update(dt) {
    var wrap = 40;
    var relax = dt / C.relaxSec;

    for (var i = 0; i < list.length; i++) {
      var s = list[i];

      /* 只有脱离所有引力井之后才把速度拉回基线。
         井内必须保持纯惯性，否则"被引力拽着走"会被回弹抵消掉。
         inGravity 由 blackhole.attract 置位，这里读完即清：
         这样即使黑洞在星点仍在井内时被回收，下一帧也能自动恢复平静。 */
      if (!s.inGravity) {
        s.vx += (s.bvx - s.vx) * relax;
        s.vy += (s.bvy - s.vy) * relax;
      }
      s.inGravity = false;

      s.x += s.vx * dt;
      s.y += s.vy * dt;

      /* 出界后从对侧回绕。这是一次瞬移，所以轨迹必须跟着一起平移：
         若只挪星点不动轨迹，最旧的点在屏幕这头、最新的点在那头，
         两点之间会凭空连出一条横贯画面的亮线（看上去就是"突然闪一下的
         线条"，尤其在星点刚被黑洞甩出画面、速度还很快的时候）。 */
      var sx = 0;
      var sy = 0;
      if (s.x < -wrap) sx = (vp.width + wrap) - s.x;
      else if (s.x > vp.width + wrap) sx = -wrap - s.x;
      if (s.y < -wrap) sy = (vp.height + wrap) - s.y;
      else if (s.y > vp.height + wrap) sy = -wrap - s.y;

      if (sx !== 0 || sy !== 0) {
        s.x += sx;
        s.y += sy;
        s.trail.shift(sx, sy);
      }

      s.trail.push(s.x, s.y, dt);
    }
  }

  /**
   * 尾流单独一遍绘制，且排在星点之前，星点才像是领着这条尾巴走
   * 亮度随速度渐显：慢速漂移时完全没有痕迹，被引力加速后逐渐亮起来
   */
  function drawTrails() {
    var ctx = vp.ctx;
    var range = C.trailFullSpeed - C.trailMinSpeed;

    ctx.globalCompositeOperation = 'lighter';

    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s.dim < 0.02) continue;

      var vis = M.clamp((M.len(s.vx, s.vy) - C.trailMinSpeed) / range, 0, 1);
      if (vis < 0.01) continue;

      s.trail.draw(ctx, C.trailAlpha * vis * s.dim, Math.max(1, s.r * C.trailWidth), '214,232,255');
    }
  }

  function draw(now) {
    var ctx = vp.ctx;
    var prevAlpha = ctx.globalAlpha;

    ctx.globalCompositeOperation = 'lighter';

    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s.dim < 0.002) continue;             // 正在被吞没，直接跳过

      var twinkle = 0.55 + 0.45 * Math.sin(now * 0.0012 * s.tw + s.phase);
      var size = s.r * 9;

      ctx.globalAlpha = s.alpha * twinkle * s.dim;
      ctx.drawImage(s.sprite, s.x - size / 2, s.y - size / 2, size, size);
    }

    ctx.globalAlpha = prevAlpha;
    ctx.globalCompositeOperation = 'source-over';
  }

  NS.stars = {
    list: list,
    build: build,
    respawn: respawn,
    update: update,
    drawTrails: drawTrails,
    draw: draw
  };
})(window);
