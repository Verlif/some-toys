/* =========================================================
   car-render.js — 车型化车辆绘制
   车头：尖头 + 白色灯组；车尾：红色尾灯 + 尾翼，前后一眼可分。
   玩家车额外有车底柔光与车头细箭头，不遮挡车身与视野。
   ========================================================= */
(function (DRC) {
  'use strict';

  const TAU = DRC.TAU;

  /** 车身轮廓：nose 越大车头越尖 */
  function bodyPath(ctx, m) {
    const hl = m.len * 0.5;
    const hw = m.wid * 0.5;
    const tipW = hw * (1 - m.nose * 0.58);
    const sx = hl - m.len * (0.08 + m.nose * 0.12);
    const rearX = -hl + m.len * 0.05;

    ctx.beginPath();
    ctx.moveTo(sx, hw);
    ctx.lineTo(hl, tipW);
    ctx.quadraticCurveTo(hl + m.len * 0.035, 0, hl, -tipW);
    ctx.lineTo(sx, -hw);
    ctx.lineTo(rearX, -hw);
    ctx.quadraticCurveTo(-hl, -hw, -hl, -hw * 0.5);
    ctx.lineTo(-hl, hw * 0.5);
    ctx.quadraticCurveTo(-hl, hw, rearX, hw);
    ctx.closePath();
  }

  function drawWheels(ctx, m) {
    const hl = m.len * 0.5;
    const hw = m.wid * 0.5;
    const fwx = hl - m.len * 0.22;
    const rwx = -hl + m.len * 0.18;
    const wy = m.open ? hw + 1.5 : hw - 1.5;

    ctx.fillStyle = '#111318';
    ctx.fillRect(fwx - 6, -wy - 2.5, 12, 5);
    ctx.fillRect(fwx - 6, wy - 2.5, 12, 5);
    ctx.fillRect(rwx - 6, -wy - 2.5, 12, 5);
    ctx.fillRect(rwx - 6, wy - 2.5, 12, 5);
  }

  function drawStripe(ctx, m) {
    const hl = m.len * 0.5;
    const hw = m.wid * 0.5;

    ctx.fillStyle = 'rgba(255,255,255,0.22)';

    if (m.stripe === 'center') {
      ctx.fillRect(-hl * 0.82, -m.wid * 0.07, m.len * 0.66, m.wid * 0.14);
    } else if (m.stripe === 'dual') {
      ctx.fillRect(-hl * 0.82, -m.wid * 0.24, m.len * 0.66, m.wid * 0.08);
      ctx.fillRect(-hl * 0.82, m.wid * 0.16, m.len * 0.66, m.wid * 0.08);
    } else if (m.stripe === 'side') {
      ctx.fillRect(-hl * 0.9, -hw + m.wid * 0.07, m.len * 0.78, m.wid * 0.06);
      ctx.fillRect(-hl * 0.9, hw - m.wid * 0.13, m.len * 0.78, m.wid * 0.06);
    }

    // 车身高光
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(-hl * 0.5, -hw * 0.16, m.len * 0.5, m.wid * 0.08);
  }

  function drawCabin(ctx, m) {
    const c = m.cabin;
    const cw = m.wid * c.wid;

    if (m.open) {
      // 敞开座舱 + 车手头盔
      ctx.fillStyle = 'rgba(12,18,26,0.92)';
      ctx.beginPath();
      ctx.ellipse(c.x, 0, c.len * 0.55, cw * 0.46, 0, 0, TAU);
      ctx.fill();

      ctx.fillStyle = '#dfe9f5';
      ctx.beginPath();
      ctx.arc(c.x + 1.5, 0, Math.min(4.4, cw * 0.32), 0, TAU);
      ctx.fill();

      ctx.fillStyle = 'rgba(20,30,45,0.85)';
      ctx.beginPath();
      ctx.arc(c.x + 2.6, 0, Math.min(2.4, cw * 0.18), 0, TAU);
      ctx.fill();
    } else {
      // 风挡 + 车顶
      ctx.fillStyle = 'rgba(16,24,34,0.88)';
      DRC.roundRect(ctx, c.x - c.len * 0.5, -cw * 0.5, c.len, cw, 3);
      ctx.fill();

      ctx.fillStyle = 'rgba(150,205,255,0.30)';
      DRC.roundRect(ctx, c.x + c.len * 0.5 - 5, -cw * 0.5 + 2, 3.5, cw - 4, 1.8);
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      DRC.roundRect(ctx, c.x - c.len * 0.5 + 2, -cw * 0.5 + 2, 3, cw - 4, 1.5);
      ctx.fill();
    }
  }

  /** 车顶行李架（越野车 / 面包车） */
  function drawRack(ctx, m) {
    if (!m.rack) return;

    const c = m.cabin;
    const cw = m.wid * c.wid;
    const half = c.len * 0.5;
    const y = cw * 0.42;

    ctx.strokeStyle = 'rgba(22,28,38,0.9)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(c.x - half + 2, -y);
    ctx.lineTo(c.x + half - 2, -y);
    ctx.moveTo(c.x - half + 2, y);
    ctx.lineTo(c.x + half - 2, y);
    for (let k = -1; k <= 1; k++) {
      const x = c.x + k * c.len * 0.26;
      ctx.moveTo(x, -y);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawLamps(ctx, m) {
    const hl = m.len * 0.5;
    const hw = m.wid * 0.5;
    const tipW = hw * (1 - m.nose * 0.58);

    if (m.lamps === 'round') {
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      ctx.arc(hl - 2.6, -tipW * 0.78, 2.3, 0, TAU);
      ctx.arc(hl - 2.6, tipW * 0.78, 2.3, 0, TAU);
      ctx.fill();
    } else if (m.lamps === 'strip') {
      ctx.fillStyle = '#fff3c4';
      ctx.fillRect(hl - 4.6, -tipW * 0.95, 3.4, tipW * 0.52);
      ctx.fillRect(hl - 4.6, tipW * 0.43, 3.4, tipW * 0.52);
    }

    // 车尾灯：所有车型都亮，强化前后识别
    ctx.fillStyle = '#ff4a5c';
    ctx.fillRect(-hl + 0.6, -hw * 0.78, 2.4, hw * 0.4);
    ctx.fillRect(-hl + 0.6, hw * 0.38, 2.4, hw * 0.4);
  }

  function drawWing(ctx, m, car) {
    if (m.wing <= 0) return;

    const hl = m.len * 0.5;
    const hw = m.wid * 0.5;
    const x = -hl + 2;
    const wh = hw * (0.72 + 0.3 * m.wing);

    ctx.fillStyle = 'rgba(22,28,38,0.95)';
    ctx.fillRect(x + 2, -wh * 0.7, 3, wh * 1.4);

    ctx.fillStyle = car.color;
    ctx.fillRect(x - 3, -wh, 5.5, wh * 2);

    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x - 3, -wh, 5.5, 1.4);
  }

  function drawRoofLights(ctx, m) {
    if (!m.roofLight) return;

    const c = m.cabin;
    ctx.fillStyle = '#fff6cf';
    for (let i = -1; i <= 1; i++) {
      ctx.fillRect(c.x + c.len * 0.32, i * 5 - 1.6, 4, 3.2);
    }
  }

  /** 玩家车：车底柔光（随车型拉长，缓慢呼吸） */
  function drawHalo(ctx, car, time) {
    const r = car.model.len * 0.95 + Math.sin(time * 3) * 3;

    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    ctx.scale(1, 0.72);

    const g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
    g.addColorStop(0, DRC.hexToRgba(car.color, 0.30));
    g.addColorStop(0.55, DRC.hexToRgba(car.color, 0.14));
    g.addColorStop(1, DRC.hexToRgba(car.color, 0));

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /** 玩家车：车头前的细箭头，指向行驶方向 */
  function drawMarker(ctx, car, time) {
    const d = car.model.len * 0.58 + 20 + Math.sin(time * 2.6) * 2.5;

    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    ctx.fillStyle = DRC.hexToRgba(car.color, 0.62);
    ctx.beginPath();
    ctx.moveTo(d + 9, 0);
    ctx.lineTo(d, -5.5);
    ctx.lineTo(d + 2, 0);
    ctx.lineTo(d, 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawCar(ctx, car, time) {
    const m = car.model;
    const hl = m.len * 0.5;
    const hw = m.wid * 0.5;

    if (car.isPlayer) drawHalo(ctx, car, time);

    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);

    // 刹车点头 + 漂移侧倾：前者是重量前移，后者是车顺着侧滑方向"歪"。
    // 轮胎印只在后轮，车身若还端端正正就看不出是在甩——这一下
    // 让"打方向会甩出去"、"踩刹车车会点头"在画面上立刻成立
    if (car.pitch > 0.01) {
      const d = car.pitch;
      ctx.transform(1 - d * 0.09, 0, 0, 1, 0, car.len * 0.05 * d);
    }
    if (Math.abs(car.slip) > 0.01) {
      const lean = DRC.clamp(car.slip * 0.9, -0.24, 0.24) * (0.45 + 0.55 * car.drift);
      ctx.transform(1, 0, Math.sin(lean), 1, 0, 0);
    }

    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    DRC.roundRect(ctx, -hl + 3, -hw + 5, m.len, m.wid, 8);
    ctx.fill();

    drawWheels(ctx, m);

    // 车身
    bodyPath(ctx, m);
    ctx.fillStyle = car.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();

    drawStripe(ctx, m);
    drawCabin(ctx, m);
    drawRack(ctx, m);
    drawLamps(ctx, m);
    drawWing(ctx, m, car);
    drawRoofLights(ctx, m);

    // 撞击闪白
    if (car.hitFlash > 0) {
      ctx.globalAlpha = Math.min(0.9, car.hitFlash * 3.2);
      ctx.fillStyle = '#ffffff';
      bodyPath(ctx, m);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    if (car.isPlayer) drawMarker(ctx, car, time);
  }

  DRC.CarRenderer = { drawCar: drawCar };
})(window.DRC);
