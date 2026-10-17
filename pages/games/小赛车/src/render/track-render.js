/* =========================================================
   track-render.js — 赛道绘制（单层平面赛道）
   路面结构由内到外：沥青 → 红白缓冲带 → 硬墙。
   ========================================================= */
(function (DRC) {
  'use strict';

  const C = DRC.CONFIG;
  const WALL = 16;   // 墙体视觉厚度

  const ROAD_GROUND = '#31363e';         // 沥青
  const ROAD_PREVIEW_GROUND = '#3d444e'; // 缩略图里的沥青
  const WALL_GROUND = '#1b1f25';         // 墙体
  const WALL_PREVIEW = '#232a34';
  const BUFFER = '#c8443f';              // 红白缓冲带
  const BUFFER_PREVIEW = '#8f3b38';

  function tracePath(ctx, track) {
    const s = track.samples;
    ctx.beginPath();
    ctx.moveTo(s[0].x, s[0].y);
    for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
    ctx.closePath();
  }

  /** 起终点格子线 */
  function drawStartLine(ctx, track) {
    const sm = track.samples[0];
    const cols = 10;
    const cw = (C.trackHalfWidth * 2) / cols;

    ctx.save();
    ctx.translate(sm.x, sm.y);
    ctx.rotate(sm.ang);
    for (let i = 0; i < cols; i++) {
      for (let r = 0; r < 2; r++) {
        ctx.fillStyle = ((i + r) % 2 === 0) ? '#ffffff' : '#1b1e23';
        ctx.fillRect(-14 + r * 14, -C.trackHalfWidth + i * cw, 14, cw);
      }
    }
    ctx.restore();
  }

  /**
   * 整条赛道一次画完：墙体 → 红白缓冲带 → 沥青 → 中心虚线 → 起终点。
   * 与车辆绘制解耦，渲染主流程可以直接在赛道之上画车。
   */
  function drawGround(ctx, track) {
    const w = C.trackHalfWidth * 2;
    const buf = C.bufferWidth * 2;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    tracePath(ctx, track);

    // 墙体
    ctx.strokeStyle = WALL_GROUND;
    ctx.lineWidth = w + buf + WALL;
    ctx.stroke();

    // 红白缓冲带
    ctx.strokeStyle = BUFFER;
    ctx.lineWidth = w + buf;
    ctx.stroke();

    ctx.save();
    ctx.setLineDash([34, 34]);
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = w + buf;
    ctx.stroke();
    ctx.restore();

    // 沥青
    ctx.strokeStyle = ROAD_GROUND;
    ctx.lineWidth = w;
    ctx.stroke();

    // 中心虚线
    ctx.save();
    ctx.setLineDash([28, 34]);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();

    drawStartLine(ctx, track);
  }

  /** 装饰：传入可视区 rect 时只画视野内的，赛道变大后这一步很必要 */
  function drawDecor(ctx, decor, rect) {
    for (let i = 0; i < decor.length; i++) {
      const d = decor[i];
      if (rect && (d.x + d.r < rect.minX || d.x - d.r > rect.maxX ||
        d.y + d.r < rect.minY || d.y - d.r > rect.maxY)) continue;

      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.arc(d.x + 4, d.y + 5, d.r, 0, DRC.TAU);
      ctx.fill();

      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, DRC.TAU);
      ctx.fill();
    }
  }

  /** 选择页缩略图：整条赛道（墙体 / 缓冲带 / 沥青）+ 起点标记 */
  function drawPreview(canvas, track) {
    if (!canvas || !track) return;

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const b = DRC.Track.bounds(track);
    const spanX = b.maxX - b.minX;
    const spanY = b.maxY - b.minY;
    const zoom = Math.min(w / spanX, h / spanY) * 0.86;

    ctx.save();
    ctx.translate(w * 0.5, h * 0.5);
    ctx.scale(zoom, zoom);
    ctx.translate(-(b.minX + spanX * 0.5), -(b.minY + spanY * 0.5));

    const wFull = (C.trackHalfWidth + C.bufferWidth + WALL * 0.5) * 2;
    const wBuf = (C.trackHalfWidth + C.bufferWidth) * 2;
    const wRoad = C.trackHalfWidth * 2;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    tracePath(ctx, track);
    ctx.strokeStyle = WALL_PREVIEW;
    ctx.lineWidth = wFull;
    ctx.stroke();

    ctx.strokeStyle = BUFFER_PREVIEW;
    ctx.lineWidth = wBuf;
    ctx.stroke();

    ctx.strokeStyle = ROAD_PREVIEW_GROUND;
    ctx.lineWidth = wRoad;
    ctx.stroke();

    // 起点标记
    const s0 = track.samples[0];
    ctx.fillStyle = '#eaf6ff';
    ctx.beginPath();
    ctx.arc(s0.x, s0.y, 6 / zoom, 0, DRC.TAU);
    ctx.fill();

    ctx.restore();
  }

  DRC.TrackRenderer = {
    drawGround: drawGround,
    drawDecor: drawDecor,
    drawPreview: drawPreview,
  };
})(window.DRC);
