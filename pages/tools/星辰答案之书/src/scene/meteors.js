/* =========================================================
   scene/meteors.js —— 流星层
   ---------------------------------------------------------------
   斜掠而过的光迹。速度刻意压得比"真实流星"慢得多：真实流星在屏幕上
   只存在零点几秒，看到的是一道一闪而过的划痕，既看不出方向，也看不出
   角度。这里要的是能看清的一条斜线，所以取 240~500 px/s。

   尾流用与其他实体同一套 scene/trail.js：把每帧位置喂进去即可，
   长度 = 速度 × trailSpan，不需要手工算线段端点。

   两条设计约定：

   1. **角度与入射边绑定**。陡的从上方飞进来，缓的从侧边飞进来。
      如果一律从上方生成，浅角度的流星会在屏幕外横着飞很久才露头，
      看起来像"迟到"——它该出现的时候没出现。

   2. **寿命由几何决定**，不人工猜时长：算出它飞到离开画面所需的
      时间即可。这样无论角度多缓、速度多快，流星总是刚好横穿一程，
      不会在半空中凭空消失，也不会在画面外空跑一半的寿命。
   ========================================================= */
(function (global) {
  'use strict';

  var NS = global.AnswerBook;
  var C = NS.config.meteors;
  var vp = NS.viewport;
  var rand = NS.rand;

  var list = [];
  var timer = C.firstDelayMs;

  function spawn() {
    var toRight = Math.random() < 0.5;
    /* 与水平方向的夹角。18° ≈ 平掠，64° ≈ 陡坠，方向一眼可辨 */
    var angle = rand(C.angleMinDeg, C.angleMaxDeg) * Math.PI / 180;
    var speed = rand(C.speedMin, C.speedMax);

    var vx = Math.cos(angle) * speed * (toRight ? 1 : -1);
    var vy = Math.sin(angle) * speed;

    /* 起点在画面之外：陡的从上方来，缓的从侧边来。
       注意 x 必须收在 [0, width] 内：取满 [-0.1w, 1.1w] 的话，起点可能落在
       右侧边界之外，而它又正朝右飞 —— 到右边界的距离变成负数，寿命会算成
       负数或一个极小值，流星一出生就"消失"了。 */
    var pad = C.spawnPad;
    var x, y;
    if (angle > Math.PI / 4) {
      y = -pad;
      /* 横向起点还要再收一档：按"飞到屏幕下方需要多久"反推出这段时间里能横移
         多远，起点就得离出口侧那么远。否则贴着右边缘生成、又朝右飞的流星
         会在露头后一瞬就从侧边溜走 —— 看着像在角落里闪了一下。 */
      var room = Math.abs(vx) * ((vp.height + pad * 2) / vy);
      x = toRight ? rand(0, Math.max(0, vp.width - room))
                  : rand(Math.min(vp.width, room), vp.width);
    } else {
      x = toRight ? -pad : vp.width + pad;
      y = rand(-vp.height * 0.05, vp.height * 0.5);
    }

    /* 寿命 = 飞到任一条边界之外所需的时间，取先到的那条 */
    var tx = (toRight ? vp.width + pad - x : x + pad) / Math.abs(vx);
    var ty = (vp.height + pad - y) / vy;

    list.push({
      x: x, y: y,
      vx: vx, vy: vy,
      age: 0,
      lifeMax: Math.min(tx, ty),
      trail: NS.trail.create(C.trailSpan, C.trailSteps)
    });
  }

  function update(dt) {
    timer -= dt * 1000;
    if (timer <= 0) {
      timer = rand(C.intervalMinMs, C.intervalMaxMs);
      spawn();
    }

    for (var i = list.length - 1; i >= 0; i--) {
      var m = list[i];
      m.age += dt;

      if (m.age >= m.lifeMax) {
        list.splice(i, 1);
        continue;
      }

      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.trail.push(m.x, m.y, dt);
    }
  }

  function draw() {
    var ctx = vp.ctx;
    ctx.globalCompositeOperation = 'lighter';

    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var p = m.age / m.lifeMax;

      /* 亮度包络：快速点亮 → 保持 → 缓慢熄灭（收尾那一段像烧尽） */
      var a;
      if (p < 0.10) a = p / 0.10;
      else if (p > 0.72) a = (1 - p) / 0.28;
      else a = 1;

      m.trail.draw(ctx, a * C.alpha, C.trailWidth, '205,228,255');
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  NS.meteors = {
    list: list,
    spawn: spawn,
    update: update,
    draw: draw
  };
})(window);
