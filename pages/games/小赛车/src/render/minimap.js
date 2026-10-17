/* =========================================================
   minimap.js — 右上角小地图
   画一张与选择页预览同款的赛道缩略轮廓（墙体 / 红白缓冲带 /
   沥青），再把每台车用颜色小圆点标出来；玩家车加白色描边圈，
   一眼就能找到自己。绘制在屏幕空间，不随相机移动。
   ========================================================= */
(function (DRC) {
  'use strict';

  const C = DRC.CONFIG;
  const WALL_HALF = C.trackHalfWidth + C.bufferWidth + 8;  // 与主渲染一致的轮廓外缘
  const PAD = 18;                  // 距屏幕边缘
  const GAP = 10;                  // 与下方排名卡片的间距
  const INNER = 0.94;              // 赛道轮廓在卡片内的留白系数

  // 赛道 bounds 按赛道对象缓存： regenerate 会换对象，自然失效
  const cache = { track: null, b: null };

  function getBounds(track) {
    if (cache.track !== track) {
      cache.track = track;
      cache.b = DRC.Track.bounds(track);
    }
    return cache.b;
  }

  /**
   * 小地图卡片矩形（CSS 像素）。排名卡片靠它下移，避免压住小地图。
   * 只有比赛中（race / paused / result）才有意义，其余场景返回 null。
   */
  function layout(game) {
    const track = game.track;
    if (!track) return null;

    const view = game.view;
    const maxSide = DRC.clamp(Math.min(view.w * 0.24, view.h * 0.30), 96, 200);

    const b = getBounds(track);
    // 轮廓外缘比中心线 bounds 各多出一个墙厚，拟合时一并算入
    const extX = (b.maxX - b.minX) + WALL_HALF * 2;
    const extY = (b.maxY - b.minY) + WALL_HALF * 2;

    let w, h;
    if (extX >= extY) { w = maxSide; h = maxSide * extY / extX; }
    else { h = maxSide; w = maxSide * extX / extY; }
    w = Math.max(64, w);
    h = Math.max(64, h);

    return {
      x: view.w - w - PAD,
      y: PAD,
      w: w,
      h: h,
      zoom: Math.min(w / extX, h / extY) * INNER,
      cx: (b.minX + b.maxX) * 0.5,
      cy: (b.minY + b.maxY) * 0.5,
    };
  }

  /** 世界坐标 → 小地图屏幕坐标 */
  function projector(box) {
    return {
      x: function (wx) { return box.x + box.w * 0.5 + (wx - box.cx) * box.zoom; },
      y: function (wy) { return box.y + box.h * 0.5 + (wy - box.cy) * box.zoom; },
    };
  }

  function draw(ctx, game) {
    const st = game.state;
    const track = game.track;
    if (!track || !game.cars.length) return;
    if (st.scene !== 'race' && st.scene !== 'paused' && st.scene !== 'result') return;

    const box = layout(game);
    if (!box) return;
    const px = projector(box);
    const samples = track.samples;

    // ---- 卡片底 ----
    ctx.save();
    ctx.fillStyle = 'rgba(8,14,20,0.62)';
    DRC.roundRect(ctx, box.x, box.y, box.w, box.h, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // ---- 赛道轮廓：墙体 → 红白缓冲带 → 沥青 ----
    ctx.beginPath();
    ctx.moveTo(px.x(samples[0].x), px.y(samples[0].y));
    for (let i = 1; i < samples.length; i++) {
      ctx.lineTo(px.x(samples[i].x), px.y(samples[i].y));
    }
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.strokeStyle = '#2b3542';
    ctx.lineWidth = WALL_HALF * 2 * box.zoom;
    ctx.stroke();

    ctx.strokeStyle = '#b0504a';
    ctx.lineWidth = (C.trackHalfWidth + C.bufferWidth) * 2 * box.zoom;
    ctx.stroke();

    ctx.strokeStyle = '#48505d';
    ctx.lineWidth = C.trackHalfWidth * 2 * box.zoom;
    ctx.stroke();

    // ---- 起点标记 ----
    const s0 = samples[0];
    ctx.fillStyle = '#eaf6ff';
    ctx.beginPath();
    ctx.arc(px.x(s0.x), px.y(s0.y), 2.6, 0, DRC.TAU);
    ctx.fill();

    // ---- 各赛车位置：颜色小圆点 ----
    for (let i = 0; i < game.cars.length; i++) {
      const car = game.cars[i];
      const cx = px.x(car.x);
      const cy = px.y(car.y);
      if (cx < box.x - 8 || cx > box.x + box.w + 8 ||
        cy < box.y - 8 || cy > box.y + box.h + 8) continue;

      ctx.beginPath();
      ctx.arc(cx, cy, car.isPlayer ? 4.2 : 3.2, 0, DRC.TAU);
      ctx.fillStyle = car.color;
      ctx.fill();
      ctx.lineWidth = car.isPlayer ? 1.6 : 1;
      ctx.strokeStyle = car.isPlayer ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.5)';
      ctx.stroke();
    }

    ctx.restore();
  }

  DRC.Minimap = {
    draw: draw,
    layout: layout,
  };
})(window.DRC);
