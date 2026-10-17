/* =========================================================
   game.js — 比赛主控：场景状态机、倒计时、帧更新
   场景：menu | setup | race(running / countdown) | paused | result
   模式：solo | coop | versus | spectate（观战：全场 AI，
        空格切鸟瞰总览，A/D 或 ←/→ 切换跟随车辆）
   ========================================================= */
(function (DRC) {
  'use strict';

  const CONFIG = DRC.CONFIG;
  const COUNTDOWN_STEPS = 3;   // 3 / 2 / 1，GO 出现时立即解锁

  class Game {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.view = { w: 0, h: 0, dpr: 1 };

      this.cam = new DRC.Camera();
      this.effects = new DRC.Particles();

      this.state = {
        scene: 'menu',
        phase: 'idle',       // idle | countdown | running
        mode: 'solo',        // solo | coop | versus | spectate
        coopScheme: 1,       // 1 = W/S + ←/→，2 = ↑/↓ + A/D
        npcCount: 3,
        totalLaps: 3,
        aiLevel: 3,           // AI 智能程度挡位 1~5（DRC.AI_LEVELS）
        time: 0,
        countdown: 0,
        countdownKind: 'start',  // start = 开赛，resume = 暂停恢复
        goFlash: 0,              // GO! 淡出计时
        grace: 0,
        // 观战模式：跟随车辆在 cars 里的下标；overview = 鸟瞰总览开关
        spectate: { follow: 0, overview: false },
      };

      this.track = DRC.Track.create();
      this.decor = this.track.decor || [];
      this._gen = null;
      this._boundsTrack = null;   // 赛道包围盒缓存（跟随换赛道即失效）
      this._bounds = null;
      this.cars = [];
      this.players = [];
      this.order = [];
      this.animTime = 0;
    }

    /* ==================== 视口 ==================== */
    resize(w, h, dpr) {
      this.view.w = w;
      this.view.h = h;
      this.view.dpr = dpr;
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
    }

    /* ==================== 场景切换 ==================== */
    toMenu() {
      const st = this.state;
      st.scene = 'menu';
      st.phase = 'idle';
      st.countdown = 0;
      st.goFlash = 0;
      st.grace = 0;

      this.track = DRC.Track.create();
      this.decor = this.track.decor || [];
      this._gen = null;
      this.cars = [];
      this.players = [];
      this.order = [];
      this.effects.clear();
      this.cam.reset();
      DRC.Input.reset();
      DRC.UI.show('panelMain');
    }

    toSetup() {
      this.state.scene = 'setup';
      DRC.UI.show('panelSetup');
      DRC.UI.refreshPreview();
      this.regenerate();
    }

    /**
     * 重新实时生成一条赛道。
     * 生成分片执行，期间用进度条补位，不阻塞渲染。
     */
    regenerate() {
      const self = this;
      if (this._gen) return this._gen;

      DRC.UI.beginLoading();
      this._gen = DRC.Track.generateAsync({
        onProgress: function (p, label) { DRC.UI.setLoading(p, label); },
      }).then(function (track) {
        self.track = track;
        self.decor = track.decor || [];
        self._gen = null;
        self.cam.reset();
        DRC.UI.endLoading();
        DRC.UI.refreshPreview();
        return track;
      });

      return this._gen;
    }

    /** 重新随机一条赛道（选择页按钮），主菜单背景同步更换 */
    rerollTrack() {
      return this.regenerate();
    }

    /** 生成新赛道、排布发车格并进入倒计时 */
    startRace() {
      // 还在生成中就先等它完成
      if (this._gen) {
        const self = this;
        this._gen.then(function () { self.startRace(); });
        return;
      }

      const st = this.state;
      st.scene = 'race';
      st.phase = 'countdown';
      st.countdownKind = 'start';
      st.goFlash = 0;
      st.time = 0;
      st.grace = 0;
      st.countdown = CONFIG.countdownStep * COUNTDOWN_STEPS;
      st.spectate = { follow: 0, overview: false };

      // 应用 AI 智能程度挡位：把所选挡位的参数写进 CONFIG，
      // ai.js / ai-throttle.js / ai-steer.js 直接读，无需逐层传参
      const lvl = DRC.AI_LEVELS[(st.aiLevel || 3) - 1] || DRC.AI_LEVELS[2];
      CONFIG.aiThrottleDelay = lvl.throttleDelay;
      CONFIG.aiSteerDelay = lvl.steerDelay;
      CONFIG.aiSteerGain = lvl.steerGain;
      CONFIG.aiCornerMargin = lvl.cornerMargin;
      CONFIG.aiOvertakeGap = lvl.overtakeGap;
      CONFIG.aiDodgeRange = lvl.dodgeRange;
      CONFIG.aiLookAhead = lvl.lookAhead;
      CONFIG.aiSafety = lvl.safety;
      CONFIG.aiSharedSense = lvl.sharedSense;
      CONFIG.aiSkill = lvl.skill;
      CONFIG.aiOvertake = lvl.overtake;
      CONFIG.aiFollowBase = lvl.follow[0];
      CONFIG.aiFollowHead = lvl.follow[1];
      if (lvl.brake) {
        CONFIG.aiBrakeReact = lvl.brake[0];
        CONFIG.aiBrakeBuffer = lvl.brake[1];
      }

      // 使用选择页里预览的那条赛道，不再重新生成
      this.effects.clear();
      this.cars = [];
      this.players = [];
      this.order = [];

      const n = this.track.n;
      // 观战模式没有玩家车：全场都是 AI，自己当导播
      const playerCount = st.mode === 'versus' ? 2 : (st.mode === 'spectate' ? 0 : 1);
      if (st.mode === 'spectate' && st.npcCount < 1) st.npcCount = 1;   // 兜底：至少有一台车可看
      const total = playerCount + st.npcCount;

      // 车型洗牌：每局所有车各不相同，玩家的车也随机
      const models = DRC.CAR_MODELS.slice();
      for (let i = models.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = models[i];
        models[i] = models[j];
        models[j] = t;
      }

      for (let i = 0; i < total; i++) {
        // 单人 / 合作时玩家独占第一排，AI 从第二排起，避免出生重叠
        const slot = (playerCount === 1 && i > 0) ? i + 1 : i;
        const row = Math.floor(slot / 2);
        const col = slot % 2;

        let idx = (n - 14 - row * 12) % n;
        if (idx < 0) idx += n;

        const sm = this.track.samples[idx];
        let lat = (col === 0 ? -1 : 1) * CONFIG.trackHalfWidth * 0.42;
        if (i === 0 && playerCount === 1) lat = 0;   // 只有一台玩家车时居中发车
        const isPlayer = i < playerCount;
        const isCoop = st.mode === 'coop';

        const car = new DRC.Car(
          sm.x + sm.nx * lat,
          sm.y + sm.ny * lat,
          sm.ang,
          isPlayer ? DRC.PLAYER_COLORS[i] : DRC.AI_COLORS[(i - playerCount) % DRC.AI_COLORS.length],
          {
            isPlayer: isPlayer,
            playerIndex: isPlayer ? i : -1,
            model: models[i % models.length],
            name: isPlayer ? (isCoop ? 'P1 + P2' : 'P' + (i + 1)) : 'AI ' + (i - playerCount + 1),
          }
        );

        car.trackIdx = idx;
        car.nearIdx = idx;
        car.lat = lat;
        car.skill = isPlayer ? 1 : DRC.rnd(CONFIG.aiSkill[0], CONFIG.aiSkill[1]);
        // 每台车 roll 一条自己的走线偏好（相对半宽）：有的偏内有的偏外，
        // 不是全场压着中线跑
        car.lineBias = isPlayer ? 0 : DRC.rnd(-CONFIG.aiLineBias, CONFIG.aiLineBias);

        this.cars.push(car);
        if (isPlayer) this.players.push(car);
      }

      this.order = DRC.Race.updateRanks(this.cars);
      this.cam.reset();
      DRC.Input.reset();
      DRC.UI.hideAll();

      // 观战开局先跟领头羊
      if (st.mode === 'spectate' && this.order.length) {
        st.spectate.follow = this.cars.indexOf(this.order[0]);
      }
    }

    /** 暂停：只有比赛中才生效，ESC 与窗口失焦都走这里 */
    pause() {
      const st = this.state;
      if (st.scene !== 'race') return false;
      st.scene = 'paused';
      DRC.Input.reset();
      DRC.UI.show('panelPause');
      return true;
    }

    togglePause() {
      if (this.state.scene === 'paused') this.resume();
      else this.pause();
    }

    /** 恢复：重新播一遍 3-2-1，比赛计时不补 */
    resume() {
      const st = this.state;
      if (st.scene !== 'paused') return;

      st.scene = 'race';
      st.phase = 'countdown';
      st.countdownKind = 'resume';
      st.countdown = CONFIG.countdownStep * COUNTDOWN_STEPS;
      st.goFlash = 0;

      DRC.Input.reset();
      DRC.UI.hideAll();
    }

    endRace() {
      const st = this.state;
      st.scene = 'result';
      st.phase = 'idle';

      this.order = DRC.Race.updateRanks(this.cars);

      const players = this.players.slice().sort(function (a, b) {
        return a.rank - b.rank;
      });
      // 观战模式没有玩家车：冠军就是全场第一
      const winner = players[0] || this.order[0] || null;

      let title = '比 赛 结 束';
      if (winner) {
        if (st.mode === 'versus' && players.length > 1) {
          const tie = players[1].finished && winner.finished &&
            Math.abs(winner.finishTime - players[1].finishTime) < 0.005;
          title = tie ? '平  局' : (winner.name + ' 获胜');
        } else if (st.mode === 'spectate') {
          title = winner.rank === 1 ? winner.name + ' 夺 冠' : '第 ' + winner.rank + ' 名';
        } else {
          title = winner.rank === 1 ? '冠  军' : '第 ' + winner.rank + ' 名';
        }
      }

      const rows = this.order.map(function (c) {
        const laps = c.lapTimes.length;
        let sum = 0;
        for (let i = 0; i < laps; i++) sum += c.lapTimes[i];

        return {
          name: c.name,
          color: c.color,
          model: c.model.name,
          rank: c.rank,
          isPlayer: c.isPlayer,
          finished: c.finished,
          time: c.finished ? c.finishTime : 0,
          timeText: c.finished ? DRC.formatTime(c.finishTime) : '未完赛',
          laps: laps,
          bestLap: c.bestLap,
          bestLapText: c.bestLap ? DRC.formatTime(c.bestLap) : '—',
          avgLapText: laps ? DRC.formatTime(sum / laps) : '—',
          wallHits: c.wallHits,
          carHits: c.carHits,
          topSpeed: Math.round(c.topSpeed),
        };
      });

      const best = rows.reduce(function (a, b) {
        if (!a) return b.bestLap ? b : a;
        return (b.bestLap && (!a.bestLap || b.bestLap < a.bestLap)) ? b : a;
      }, null);

      const lvl = DRC.AI_LEVELS[(st.aiLevel || 3) - 1] || DRC.AI_LEVELS[2];
      DRC.UI.showResult({
        winner: title,
        winnerColor: winner ? winner.color : '#ffd166',
        rows: rows,
        meta: this.modeLabel() +
          ' · AI ' + lvl.label +
          ' · 圈数 ' + st.totalLaps +
          (st.mode === 'spectate' ? '' : ' · AI 对手 ' + st.npcCount + ' 台') +
          ' · 参赛 ' + this.cars.length + ' 台' +
          ' · 赛道 ' + (this.track.length / 10000).toFixed(2) + ' km' +
          (best && best.bestLap ? ' · 全场最快 ' + best.name + ' ' + best.bestLapText : ''),
      });
    }

    /** 结算与 HUD 用的模式描述 */
    modeLabel() {
      const st = this.state;
      if (st.mode === 'spectate') return '观战';
      if (st.mode === 'solo') return '单人';
      if (st.mode === 'coop') return '双人合作 · ' + DRC.COOP_SCHEMES[st.coopScheme].label;
      return '双人对抗';
    }

    /** 按当前模式读取玩家操作意图 */
    playerInput(index) {
      const st = this.state;
      if (st.mode === 'solo') return DRC.Input.driveSolo();
      if (st.mode === 'coop') return DRC.Input.driveCoop(st.coopScheme);
      return DRC.Input.driveVersus(index);
    }

    /* ==================== 帧更新 ==================== */
    update(dt) {
      const st = this.state;
      if (st.scene === 'paused') return;

      this.animTime += dt;
      this.effects.update(dt);

      if (st.scene === 'race') {
        if (st.phase === 'countdown') {
          // 倒计时期间车辆锁定，只推进特效计时
          st.countdown -= dt;
          for (let i = 0; i < this.cars.length; i++) this.cars[i].tick(dt);
          if (st.countdown <= 0) {
            st.countdown = 0;
            st.phase = 'running';
            st.goFlash = CONFIG.countdownStep;
          }
        } else if (st.phase === 'running') {
          if (st.goFlash > 0) st.goFlash = Math.max(0, st.goFlash - dt);
          st.time += dt;
          this.stepRace(dt);
        }
      }

      this.updateCamera(dt);
    }

    stepRace(dt) {
      const st = this.state;
      const cars = this.cars;

      // 1) 输入 + 物理
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        let throttle = 0;
        let steer = 0;

        if (!c.finished) {
          if (c.isPlayer) {
            const inp = this.playerInput(c.playerIndex);
            throttle = inp.throttle;
            steer = inp.steer;
          } else {
            const inp = DRC.AI.think(c, this.track, cars, dt);
            throttle = inp.throttle;
            steer = inp.steer;
          }
        }

        c.phys(dt, throttle, steer);
      }

      // 2) 车与车碰撞
      DRC.Collision.resolveCars(cars, this.effects, this.cam);

      // 3) 赛道硬约束（同时刷新 nearIdx / lat）与特效计时
      for (let i = 0; i < cars.length; i++) {
        DRC.Collision.constrainToTrack(cars[i], this.track, this.effects, this.cam);
        cars[i].tick(dt);
      }

      // 4) 圈数与排名
      DRC.Race.updateProgress(cars, this.track, st.totalLaps, st.time);
      this.order = DRC.Race.updateRanks(cars);

      // 5) 结束判定
      this.checkFinish(dt);
    }

    checkFinish(dt) {
      const st = this.state;
      const cars = this.cars;
      let done = 0;
      for (let i = 0; i < cars.length; i++) {
        if (cars[i].finished) done++;
      }

      // 全部冲线 → 立即结算
      if (done === cars.length) {
        this.endRace();
        return;
      }
      if (done === 0) return;

      // 首位冲线后开始倒计时：最多再跑 圈数 × 5s，超时直接结算
      if (st.grace <= 0) {
        st.grace = st.totalLaps * CONFIG.finishGracePerLap;
      } else {
        st.grace -= dt;
        if (st.grace <= 0) this.endRace();
      }
    }

    /* ==================== 相机 ==================== */
    updateCamera(dt) {
      const st = this.state;
      // 观战：跟随指定车辆，或切鸟瞰总览
      if (st.mode === 'spectate' &&
          (st.scene === 'race' || st.scene === 'paused' || st.scene === 'result')) {
        const car = this.spectateCar();
        if (st.spectate.overview || !car) {
          this.cam.overview(dt, this.view.w, this.view.h, this.trackBounds());
        } else {
          this.cam.update(dt, this.view.w, this.view.h,
            [{ x: car.x, y: car.y }], Math.abs(car.speed) / CONFIG.maxSpeed);
        }
        return;
      }

      const points = (st.scene === 'menu' || st.scene === 'setup' || !this.players.length)
        ? this.trackFocus()
        : this.players.map(function (p) { return { x: p.x, y: p.y }; });

      let ratio = 0;
      for (let i = 0; i < this.players.length; i++) {
        ratio = Math.max(ratio, Math.abs(this.players[i].speed) / CONFIG.maxSpeed);
      }

      this.cam.update(dt, this.view.w, this.view.h, points, ratio);
    }

    /** 赛道包围盒（按赛道对象缓存，鸟瞰每帧都要用） */
    trackBounds() {
      if (this._boundsTrack !== this.track) {
        this._boundsTrack = this.track;
        this._bounds = DRC.Track.bounds(this.track);
      }
      return this._bounds;
    }

    /** 菜单 / 设置界面：框住整条赛道 */
    trackFocus() {
      const b = this.trackBounds();
      return [
        { x: b.minX, y: b.minY },
        { x: b.maxX, y: b.maxY },
      ];
    }

    /* ==================== 观战 ==================== */

    /** 当前跟随的车（非观战模式或下标越界返回 null） */
    spectateCar() {
      const st = this.state;
      if (st.mode !== 'spectate') return null;
      const i = st.spectate.follow;
      return (i >= 0 && i < this.cars.length) ? this.cars[i] : null;
    }

    /** 切换跟随车辆：dir = -1 上一台，+1 下一台，循环 */
    cycleFollow(dir) {
      const st = this.state;
      if (st.mode !== 'spectate' || !this.cars.length) return;
      const n = this.cars.length;
      st.spectate.follow = (st.spectate.follow + dir + n) % n;
    }

    /** 空格：鸟瞰总览 ⇄ 跟随视角 */
    toggleOverview() {
      const st = this.state;
      if (st.mode !== 'spectate') return;
      st.spectate.overview = !st.spectate.overview;
    }

    /** 观战快捷键：空格切鸟瞰，A/D 或 ←/→ 切跟随车辆 */
    onKey(code) {
      const st = this.state;
      if (st.mode !== 'spectate' || st.scene !== 'race') return;
      if (code === 'Space') this.toggleOverview();
      else if (code === 'KeyA' || code === 'ArrowLeft') this.cycleFollow(-1);
      else if (code === 'KeyD' || code === 'ArrowRight') this.cycleFollow(1);
    }
  }

  DRC.Game = Game;
})(window.DRC);
