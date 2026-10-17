/* =========================================================
   renderer.js — 渲染主流程
   平面赛道没有层级，世界层按「地面 → 起步箭头 → 赛车与火花」
   顺序绘制，所有车都画在赛道之上。
   ========================================================= */
(function (DRC) {
  'use strict';

  function draw(game) {
    const ctx = game.ctx;
    const view = game.view;
    const cam = game.cam;
    const st = game.state;

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

    // 草地底色
    ctx.fillStyle = '#14251a';
    ctx.fillRect(0, 0, view.w, view.h);

    if (!game.track) return;

    ctx.save();
    ctx.translate(view.w / 2 + cam.offsetX, view.h / 2 + cam.offsetY);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    const halfW = view.w / 2 / cam.zoom;
    const halfH = view.h / 2 / cam.zoom;
    DRC.TrackRenderer.drawDecor(ctx, game.decor, {
      minX: cam.x - halfW - 80,
      maxX: cam.x + halfW + 80,
      minY: cam.y - halfH - 80,
      maxY: cam.y + halfH + 80,
    });

    // ① 赛道：墙体 → 红白缓冲带 → 沥青 → 中线 → 起终点
    DRC.TrackRenderer.drawGround(ctx, game.track);

    // ② 起步方向箭头：贴在路面上，不挡车
    let hint = 0;
    if (st.scene === 'race' && (st.countdownKind || 'start') === 'start') {
      if (st.phase === 'countdown') hint = 1;
      else if (st.goFlash > 0) hint = st.goFlash / DRC.CONFIG.countdownStep;
    }
    if (hint > 0) {
      DRC.DirectionHints.draw(ctx, game.track, hint, game.animTime);
    }

    // ③ 全部赛车
    for (let i = 0; i < game.cars.length; i++) {
      DRC.CarRenderer.drawCar(ctx, game.cars[i], game.animTime);
    }

    // ③.5 观战模式：给跟随的车套一个呼吸光环。
    //     线宽与半径都按 1/zoom 换算，跟随视角和鸟瞰总览下
    //     都是稳定的屏幕尺寸，缩再小也找得到
    if (st.mode === 'spectate') {
      const fc = game.spectateCar();
      if (fc) {
        const pulse = 0.5 + 0.5 * Math.sin(game.animTime * 4);
        ctx.save();
        ctx.strokeStyle = fc.color;
        ctx.globalAlpha = 0.4 + 0.35 * pulse;
        ctx.lineWidth = 3 / cam.zoom;
        ctx.beginPath();
        ctx.arc(fc.x, fc.y, (42 + pulse * 6) / cam.zoom, 0, DRC.TAU);
        ctx.stroke();
        ctx.restore();
      }
    }

    // ④ 火花粒子
    game.effects.draw(ctx);

    ctx.restore();

    DRC.HUD.draw(ctx, game);

    // 右上角小地图：赛道缩略轮廓 + 各车位置圆点（屏幕空间，不随相机）
    DRC.Minimap.draw(ctx, game);

    const goFading = st.phase === 'running' && st.goFlash > 0;
    if (st.scene === 'race' && (st.phase === 'countdown' || goFading)) {
      DRC.HUD.drawCountdown(ctx, game);
    }
  }

  DRC.Renderer = { draw: draw };
})(window.DRC);
