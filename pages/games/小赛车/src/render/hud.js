/* =========================================================
   hud.js — 抬头显示与开赛倒计时
   ========================================================= */
(function (DRC) {
  'use strict';

  const CONFIG = DRC.CONFIG;
  const FONT = 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';

  function card(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(6,12,18,0.58)';
    DRC.roundRect(ctx, x, y, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** 左上：两名玩家的圈数与名次 */
  function drawPlayers(ctx, game) {
    const st = game.state;
    const players = game.players;
    const rowH = 46;
    const w = 258;
    const x = 18;
    const y = 18;
    const h = 26 + players.length * rowH + 8;

    card(ctx, x, y, w, h);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#7fa8c4';
    ctx.font = '600 11.5px ' + FONT;
    ctx.fillText(st.mode === 'coop' ? '合 作 车 队' : '车  手', x + 16, y + 19);

    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const top = y + 26 + i * rowH;

      ctx.fillStyle = p.color;
      DRC.roundRect(ctx, x + 16, top + 6, 5, 30, 2.5);
      ctx.fill();

      ctx.fillStyle = '#e8f2ff';
      ctx.font = '800 15px ' + FONT;
      ctx.fillText(p.name, x + 32, top + 22);

      const lap = Math.min(p.lap + 1, st.totalLaps);
      const modelName = p.model ? p.model.name : '';
      ctx.fillStyle = '#7fa8c4';
      ctx.font = '600 11.5px ' + FONT;
      ctx.fillText(
        '圈 ' + lap + ' / ' + st.totalLaps + (modelName ? ' · ' + modelName : ''),
        x + 32,
        top + 38
      );

      ctx.textAlign = 'right';
      ctx.fillStyle = p.finished ? '#5cf2a8' : '#ffd166';
      ctx.font = '800 17px ' + FONT;
      ctx.fillText(p.finished ? '完赛' : '第 ' + p.rank + ' 名', x + w - 16, top + 28);
      ctx.textAlign = 'left';
    }
  }

  /** 右上：实时排名（位于小地图下方） */
  function drawRanking(ctx, game) {
    const list = (game.order && game.order.length) ? game.order : game.cars;
    if (!list.length) return;

    const rowH = 22;
    const w = 184;
    const x = game.view.w - w - 18;
    // 小地图占住右上角，排名卡片整体下移，避免互相压盖
    const mm = DRC.Minimap ? DRC.Minimap.layout(game) : null;
    const y = mm ? mm.y + mm.h + 10 : 18;

    // 满编 12 台 AI 时最多 14 行，窗口不够高就裁掉尾部——但玩家自己
    // 那一行一定保留（挪到末尾补上），名次照样看得到
    const room = Math.max(1, Math.floor((game.view.h - y - 54) / rowH));
    let shown = list;
    let cut = 0;

    if (list.length > room) {
      // 会落在截断区里的玩家行数（至多两名玩家，重算一次就够）
      const outside = function (k) {
        let n2 = 0;
        for (let i = k; i < list.length; i++) if (list[i].isPlayer) n2++;
        return n2;
      };
      let k = Math.max(1, room - 1);                     // 先留出省略号那一行
      if (outside(k)) k = Math.max(1, k - outside(k));   // 再给补位的玩家让行
      const mine = [];
      for (let i = k; i < list.length; i++) if (list[i].isPlayer) mine.push(list[i]);
      shown = list.slice(0, k).concat(mine);
      cut = list.length - k - mine.length;
    }

    const extra = cut > 0 ? 1 : 0;                       // 省略号行
    const h = 26 + (shown.length + extra) * rowH + 6;

    card(ctx, x, y, w, h);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#7fa8c4';
    ctx.font = '600 11.5px ' + FONT;
    ctx.fillText('排  名', x + 16, y + 19);

    for (let i = 0; i < shown.length; i++) {
      const c = shown[i];
      const rank = list.indexOf(c) + 1;
      const base = y + 26 + i * rowH + 15;
      const tx = x + 16;

      ctx.fillStyle = rank === 1 ? '#ffd166' : '#5f7c93';
      ctx.font = '800 11.5px ' + FONT;
      ctx.fillText(String(rank), tx, base);

      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(tx + 20, base - 4, 4, 0, DRC.TAU);
      ctx.fill();

      ctx.fillStyle = c.isPlayer ? '#e8f2ff' : '#8fb2cc';
      ctx.font = '600 12px ' + FONT;
      ctx.fillText(c.name, tx + 30, base);
    }

    if (extra) {
      const base = y + 26 + shown.length * rowH + 15;
      ctx.fillStyle = '#5f7c93';
      ctx.font = '800 11.5px ' + FONT;
      ctx.fillText('· · ·', x + 16, base);
      ctx.font = '600 11.5px ' + FONT;
      ctx.fillText('其余 ' + cut + ' 台', x + 46, base);
    }
  }

  /** 右下：两名玩家的速度表 */
  function drawSpeed(ctx, game) {
    const players = game.players;
    const rowH = 38;
    const w = 216;
    const h = 30 + players.length * rowH + 6;
    const x = game.view.w - w - 18;
    const y = game.view.h - h - 18;

    card(ctx, x, y, w, h);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#7fa8c4';
    ctx.font = '600 11.5px ' + FONT;
    ctx.fillText('速  度', x + 16, y + 19);

    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const base = y + 40 + i * rowH;
      const ratio = DRC.clamp(Math.abs(p.speed) / CONFIG.maxSpeed, 0, 1);

      ctx.fillStyle = p.color;
      DRC.roundRect(ctx, x + 16, base - 10, 4, 13, 2);
      ctx.fill();

      ctx.fillStyle = '#e8f2ff';
      ctx.font = '800 12.5px ' + FONT;
      ctx.fillText(p.name, x + 26, base);

      const barX = x + 66;
      const barW = 74;
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      DRC.roundRect(ctx, barX, base - 7, barW, 6, 3);
      ctx.fill();

      if (ratio > 0.001) {
        ctx.fillStyle = p.color;
        DRC.roundRect(ctx, barX, base - 7, barW * ratio, 6, 3);
        ctx.fill();
      }

      ctx.textAlign = 'right';
      ctx.fillStyle = '#8fb2cc';
      ctx.font = '600 11.5px ' + FONT;
      ctx.fillText(Math.round(Math.abs(p.speed)) + ' km/h', x + w - 16, base);
      ctx.textAlign = 'left';
    }
  }

  /** 左下操作提示，随模式变化 */
  function hintText(st) {
    if (st.mode === 'solo') return 'WASD 或 ↑/←/↓/→ 驾驶';
    if (st.mode === 'coop') return DRC.COOP_SCHEMES[st.coopScheme].hint;
    if (st.mode === 'spectate') return '空格 鸟瞰总览 · A/D 或 ←/→ 切换跟随';
    return 'P1  W/A/S/D       P2  ↑/←/↓/→';
  }

  function drawHints(ctx, game) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.font = '600 12px ' + FONT;
    ctx.fillText(hintText(game.state) + '       Esc 暂停', 20, game.view.h - 18);
  }

  /** 底部居中：观战模式的导播条——跟随谁、什么视角、怎么切 */
  function drawSpectate(ctx, game) {
    const st = game.state;
    if (st.scene !== 'race' && st.scene !== 'paused') return;

    const view = game.view;
    const car = game.spectateCar ? game.spectateCar() : null;
    const overview = st.spectate.overview;
    const viewText = overview ? '鸟瞰总览' : '跟随视角';
    const followText = car
      ? '跟随 ' + car.name + (car.rank ? ' · 第 ' + car.rank + ' 名' : '')
      : '等待发车';
    const keyText = overview
      ? '空格 返回跟随 · A/D 切换车辆'
      : '空格 鸟瞰总览 · A/D 切换车辆';

    ctx.font = '800 12.5px ' + FONT;
    const tagW = ctx.measureText('观战 · ' + viewText).width;
    ctx.font = '600 12.5px ' + FONT;
    const followW = ctx.measureText(followText).width;
    const keyW = ctx.measureText(keyText).width;

    const h = 38;
    const w = Math.max(380, tagW + followW + keyW + 92);
    const x = Math.round((view.w - w) / 2);
    const y = view.h - h - 56;

    card(ctx, x, y, w, h);

    ctx.textBaseline = 'middle';
    const midY = y + h / 2;

    // 左：观战标签 + 当前视角
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffd166';
    ctx.font = '800 12.5px ' + FONT;
    ctx.fillText('观战 · ' + viewText, x + 18, midY);

    // 中：跟随车辆（颜色点 + 名字 + 名次）
    let cx = x + 18 + tagW + 20;
    if (car) {
      ctx.fillStyle = car.color;
      ctx.beginPath();
      ctx.arc(cx + 4, midY, 4, 0, DRC.TAU);
      ctx.fill();
      cx += 14;
    }
    ctx.fillStyle = '#e8f2ff';
    ctx.font = '600 12.5px ' + FONT;
    ctx.fillText(followText, cx, midY);

    // 右：键位提示
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '600 12px ' + FONT;
    ctx.fillText(keyText, x + w - 18, midY);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /** 顶部居中：首位冲线后的结算倒计时（全员完赛会立即结算，不显示） */
  function drawGrace(ctx, game) {
    const st = game.state;
    if (st.scene !== 'race' || st.grace <= 0) return;

    ctx.save();
    ctx.setTransform(game.view.dpr, 0, 0, game.view.dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 13px ' + FONT;
    ctx.fillStyle = 'rgba(255, 209, 102, 0.88)';
    ctx.fillText(
      '首位冲线 · ' + Math.ceil(st.grace) + 's 后结算',
      game.view.w / 2, 26
    );
    ctx.restore();
  }

  function draw(ctx, game) {
    const st = game.state;
    if (!game.track) return;
    if (st.scene !== 'race' && st.scene !== 'paused' && st.scene !== 'result') return;

    drawGrace(ctx, game);
    drawRanking(ctx, game);
    if (game.players.length) {
      drawPlayers(ctx, game);
      drawSpeed(ctx, game);
    } else if (st.mode === 'spectate') {
      drawSpectate(ctx, game);
    }
    drawHints(ctx, game);
  }

  /** 开赛 3-2-1-GO 倒计时（GO 与解锁同步出现，随后淡出） */
  function drawCountdown(ctx, game) {
    const st = game.state;
    const step = CONFIG.countdownStep;
    let idx, local;

    if (st.phase === 'countdown') {
      const total = step * 3;
      const elapsed = DRC.clamp(total - st.countdown, 0, total - 0.001);
      idx = Math.min(2, Math.floor(elapsed / step));
      local = (elapsed - idx * step) / step;
    } else {
      idx = 3;
      local = 1 - DRC.clamp(st.goFlash / step, 0, 1);
    }

    const labels = ['3', '2', '1', 'GO!'];
    const isGo = idx === 3;

    const scale = isGo
      ? 1 + local * 0.3
      : 1.35 - 0.35 * DRC.easeOut(Math.min(1, local / 0.32));
    const alpha = isGo ? 1 - local : (local > 0.82 ? (1 - local) / 0.18 : 1);

    ctx.save();
    ctx.setTransform(game.view.dpr, 0, 0, game.view.dpr, 0, 0);
    ctx.globalAlpha = DRC.clamp(alpha, 0, 1);

    ctx.translate(game.view.w / 2, game.view.h * 0.44);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 132px ' + FONT;
    ctx.shadowColor = isGo ? 'rgba(92,242,168,0.85)' : 'rgba(120,200,255,0.8)';
    ctx.shadowBlur = 46;
    ctx.fillStyle = isGo ? '#5cf2a8' : '#eaf6ff';
    ctx.fillText(labels[idx], 0, 0);

    ctx.restore();

    // 倒计时阶段的副标题：开赛提示方向，暂停恢复只提示继续
    if (st.phase === 'countdown') {
      const tip = st.countdownKind === 'resume'
        ? '准备继续'
        : '沿地面箭头方向发车';

      ctx.save();
      ctx.setTransform(game.view.dpr, 0, 0, game.view.dpr, 0, 0);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 13px ' + FONT;
      ctx.fillStyle = 'rgba(190,228,255,0.62)';
      ctx.fillText(tip, game.view.w / 2, game.view.h * 0.44 + 96);
      ctx.restore();
    }
  }

  DRC.HUD = {
    draw: draw,
    drawCountdown: drawCountdown,
  };
})(window.DRC);
