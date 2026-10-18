/* =========================================================
   sound.js — 程序化音效（Web Audio 实时合成，不加载任何音频文件）
   三类声音：
     · 撞击   低频砸击 + 带通噪声爆点，亮度与时长随撞击强度变化，
              按与听者的距离衰减、按左右位置做声像
     · 倒计时 双音喇叭（纯五度）的"嘟嘟嘟"三声，尾音轻微下滑；
              GO 换更高更长的音
     · 完赛   玩家冲线的三连上行音 + 结算面板的分解和弦
              （结算会顺延播放，避免与冲线音叠在一起）

   不做持续行驶噪声（引擎/胎噪）：合成出来的音色始终偏电子，
   高频一多就刺耳，所以只在事件上出声，跑起来保持安静。

   听者位置：玩家车的中点；观战时是当前跟随的那台车。
   浏览器要求音频上下文由用户手势解锁——见 main.js 的 unlock 监听。
   ========================================================= */
(function (DRC) {
  'use strict';

  const MASTER = 0.9;      // 总音量

  let ctx = null;
  let master = null;
  let sfxBus = null;
  let noise = null;
  let enabled = true;
  let lastHit = -1;
  let listener = null;     // 听者世界坐标（撞击的音量衰减与声像用）

  function clamp(v, a, b) {
    return DRC.clamp ? DRC.clamp(v, a, b) : Math.max(a, Math.min(b, v));
  }

  /** 懒建音频上下文与总线（首次需要出声时才创建） */
  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;

    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = enabled ? MASTER : 0;

    // 总线上挂一个限幅器：几起撞击叠在一起很容易冲过 0dB，
    // 用一个温和的压缩把峰值压住，避免破音
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 18;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.25;

    master.connect(limiter);
    limiter.connect(ctx.destination);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 1;
    sfxBus.connect(master);

    // 撞击用的噪声缓冲：0.5s 白噪声。固定种子，每次运行的噪声完全一致
    const len = Math.floor(ctx.sampleRate * 0.5);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 20260118;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = seed / 0x3fffffff - 1;
    }

    return true;
  }

  /** 能出声了吗（上下文已在跑，且总开关没关） */
  function live() {
    return !!ctx && enabled && ctx.state === 'running';
  }

  /** 每帧刷新听者位置：玩家车中点 / 观战跟随车 */
  function update(game) {
    if (!ctx || !game) return;

    const players = game.players || [];
    if (players.length) {
      let x = 0;
      let y = 0;
      for (let i = 0; i < players.length; i++) {
        x += players[i].x;
        y += players[i].y;
      }
      listener = { x: x / players.length, y: y / players.length };
      return;
    }
    if (game.state.mode === 'spectate' && game.spectateCar) {
      const c = game.spectateCar();
      if (c) listener = { x: c.x, y: c.y };
    }
  }

  /* ==================== 音效 ==================== */

  /** 世界坐标 → 音量衰减与声像（isPlayer 的不衰减） */
  function place(x, y, isPlayer, spread) {
    if (!listener) return { att: isPlayer ? 1 : 0, pan: 0 };
    const dx = x - listener.x;
    const dy = y - listener.y;
    const d = Math.hypot(dx, dy);
    return {
      att: isPlayer ? 1 : Math.pow(clamp(1 - d / spread, 0, 1), 1.2),
      pan: clamp(dx / 900, -0.85, 0.85),
    };
  }

  /** 一段带包络的短音（可指定滑音终点） */
  function tone(freq, delay, dur, type, gain, sweepTo) {
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);

    osc.connect(g);
    g.connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /**
   * 喇叭式的"嘟"：两支相差纯五度的振荡器一起响（真实喇叭就是两个
   * 簧片）→ 低通削掉刺耳的高次谐波 → 尾音轻微下滑，
   * 听感是圆润的"嘟"而不是尖细的"哔"
   */
  function horn(freq, delay, dur, gain) {
    const t0 = ctx.currentTime + delay;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    out.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    out.connect(sfxBus);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = freq * 6;
    lp.Q.value = 1.4;
    lp.connect(out);

    const parts = [[1, 0.7, 'sawtooth'], [1.5, 0.42, 'triangle']];
    for (let i = 0; i < parts.length; i++) {
      const ratio = parts[i][0];
      const o = ctx.createOscillator();
      o.type = parts[i][2];
      o.frequency.setValueAtTime(freq * ratio, t0);
      // 尾音下滑 7%：从"哔"变成"嘟"
      o.frequency.exponentialRampToValueAtTime(freq * ratio * 0.93, t0 + dur);
      const g = ctx.createGain();
      g.gain.value = parts[i][1];
      o.connect(g);
      g.connect(lp);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    }
  }

  /**
   * 撞击：低频砸击 + 噪声爆点
   * @param {number} power 0~1 撞击强度（collision.js 已有）
   * @param {number} x 世界坐标
   * @param {number} y
   * @param {boolean} isPlayer 是否玩家车（玩家车不衰减）
   */
  function hit(power, x, y, isPlayer) {
    if (!live()) return;
    const now = ctx.currentTime;
    if (now - lastHit < 0.035) return;   // 同一帧多起碰撞叠起来就是爆音

    const spot = place(x, y, isPlayer, 1400);
    if (spot.att <= 0.02) return;
    lastHit = now;

    const p = clamp(power, 0, 1);
    const level = (0.20 + 0.55 * p) * spot.att;

    const out = ctx.createGain();
    out.gain.setValueAtTime(level, now);
    out.gain.exponentialRampToValueAtTime(0.0008, now + 0.28 + 0.14 * p);

    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = spot.pan;
      out.connect(pan);
      pan.connect(sfxBus);
    } else {
      out.connect(sfxBus);
    }

    // 1) 砸击：撞击的"重量"，频率向下扫
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(160 - 70 * p, now);
    thump.frequency.exponentialRampToValueAtTime(46, now + 0.18);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(1, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    thump.connect(tg);
    tg.connect(out);
    thump.start(now);
    thump.stop(now + 0.26);

    // 2) 爆点：越重越亮、越长，像金属被撞变形
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.85 + 0.5 * p;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + 2400 * p;
    bp.Q.value = 0.9;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(1, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.1 + 0.16 * p);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    src.start(now);
    src.stop(now + 0.32);
  }

  /** 倒计时：n = 3 / 2 / 1 各"嘟"一声，n = 0 是 GO（更高更长） */
  function countdown(n) {
    if (!live()) return;
    if (n > 0) {
      horn(392, 0, 0.17, 0.17);
      return;
    }
    horn(523, 0, 0.42, 0.17);
  }

  /** 玩家冲线：三连上行短音 */
  function finish() {
    if (!live()) return;
    tone(659, 0, 0.12, 'triangle', 0.13);
    tone(880, 0.1, 0.12, 'triangle', 0.13);
    tone(1319, 0.2, 0.3, 'triangle', 0.12);
  }

  /** 结算面板：C 大调上行分解和弦 + 低音铺底 */
  function result(delay) {
    if (!live()) return;
    const t = delay || 0;
    const notes = [523, 659, 784, 1047];
    for (let i = 0; i < notes.length; i++) {
      tone(notes[i], t + i * 0.11, 0.9 - i * 0.1, 'triangle', 0.085);
    }
    tone(131, t, 1.1, 'sine', 0.09);
    tone(196, t + 0.02, 1.0, 'sine', 0.05);
  }

  /** 用户手势解锁（浏览器自动播放策略） */
  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }

  function setEnabled(on) {
    enabled = !!on;
    if (!ctx) return;
    master.gain.setTargetAtTime(enabled ? MASTER : 0, ctx.currentTime, 0.04);
    if (enabled) unlock();
  }

  function isEnabled() {
    return enabled;
  }

  DRC.Sound = {
    unlock: unlock,
    setEnabled: setEnabled,
    isEnabled: isEnabled,
    update: update,
    hit: hit,
    countdown: countdown,
    finish: finish,
    result: result,
  };
})(window.DRC);
