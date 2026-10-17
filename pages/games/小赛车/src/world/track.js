/* =========================================================
   track.js — 程序化赛道生成（实时生长，没有固定模板）

   生长流程：
     1) 随机一个"引导椭圆"，由目标圈长反推长短轴；
        椭圆周长 >= 目标圈长，保证路径绕行不超过一圈，
        从源头上避免自己贴上自己
     2) 沿椭圆切向逐段生长：直道 / 缓弯 / S 弯 / 发卡弯 /
        360° 回湾（回湾会先做"圆盘避让"检查，空间不干净
        就放弃，绝不让它跨过赛道别处）
     3) 首尾接近后用 Dubins 曲线（CSC 组合）平滑闭合，切线连续
     4) 统计每个采样点与"沿路径很远"的最近点距离，
        任何一处小于路面全宽都判定为交叉，整条作废重长
     5) 把起终点挪到一段直道的中段，便于排发车格

   整条赛道是单层平面且无交叉：没有立交，也没有平交路口。
   整个流程是 generator，可分片执行并汇报进度（generateAsync），
   生成耗时长时前端用进度条补位，不会卡住画面。
   ========================================================= */
(function (DRC) {
  'use strict';

  const C = DRC.CONFIG;
  const TAU = DRC.TAU;
  const HALF_PI = Math.PI / 2;
  const STEP = C.trackStep;
  const MIN_R = C.trackMinRadius;

  /* ==================== 基础工具 ==================== */

  function mod2pi(x) {
    let v = x % TAU;
    if (v < 0) v += TAU;
    return v;
  }

  /* ==================== 采样发射 ==================== */

  function emitLine(st, out, len) {
    if (!(len > 0)) return;
    const steps = Math.max(1, Math.round(len / STEP));
    const dl = len / steps;
    const cx = Math.cos(st.ang);
    const cy = Math.sin(st.ang);
    for (let i = 0; i < steps; i++) {
      st.x += cx * dl;
      st.y += cy * dl;
      out.push({ x: st.x, y: st.y });
    }
  }

  /** sweep > 0 为逆时针（圆心在左法向），< 0 为顺时针 */
  function emitArc(st, out, r, sweep) {
    if (!(r > 0) || Math.abs(sweep) < 1e-6) return;

    const dir = sweep > 0 ? 1 : -1;
    const steps = Math.max(2, Math.round(Math.abs(sweep) * r / STEP));
    const dth = sweep / steps;
    const ccx = st.x - Math.sin(st.ang) * r * dir;
    const ccy = st.y + Math.cos(st.ang) * r * dir;
    let phi = Math.atan2(st.y - ccy, st.x - ccx);

    for (let i = 0; i < steps; i++) {
      phi += dth;
      st.x = ccx + Math.cos(phi) * r;
      st.y = ccy + Math.sin(phi) * r;
      out.push({ x: st.x, y: st.y });
    }

    st.ang = dir > 0 ? phi + HALF_PI : phi - HALF_PI;
  }

  /* ==================== Dubins 闭合（CSC） ==================== */

  /**
   * 起点位姿 → 终点位姿的最短圆弧-直线-圆弧路径。
   * 返回 { type, t, p, q, len }，t/q 为弧度，p 为直线长度（半径倍数）。
   */
  function dubinsCSC(sx, sy, sth, ex, ey, eth, R) {
    const dx = ex - sx;
    const dy = ey - sy;
    const d = Math.sqrt(dx * dx + dy * dy) / R;
    const theta = Math.atan2(dy, dx);

    const alpha = mod2pi(sth - theta);
    const beta = mod2pi(eth - theta);
    const sa = Math.sin(alpha);
    const sb = Math.sin(beta);
    const ca = Math.cos(alpha);
    const cb = Math.cos(beta);
    const cab = Math.cos(alpha - beta);

    const cand = [];
    let pSq;

    // LSL
    pSq = 2 + d * d - 2 * cab + 2 * d * (sa - sb);
    if (pSq >= 0) {
      const tmp = Math.atan2(cb - ca, d + sa - sb);
      cand.push({ type: 'LSL', t: mod2pi(-alpha + tmp), p: Math.sqrt(pSq), q: mod2pi(beta - tmp) });
    }

    // RSR
    pSq = 2 + d * d - 2 * cab + 2 * d * (sb - sa);
    if (pSq >= 0) {
      const tmp = Math.atan2(ca - cb, d - sa + sb);
      cand.push({ type: 'RSR', t: mod2pi(alpha - tmp), p: Math.sqrt(pSq), q: mod2pi(-beta + tmp) });
    }

    // LSR
    pSq = -2 + d * d + 2 * cab + 2 * d * (sa + sb);
    if (pSq >= 0) {
      const p = Math.sqrt(pSq);
      const tmp = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p);
      cand.push({ type: 'LSR', t: mod2pi(-alpha + tmp), p: p, q: mod2pi(-beta + tmp) });
    }

    // RSL
    pSq = d * d - 2 + 2 * cab - 2 * d * (sa + sb);
    if (pSq >= 0) {
      const p = Math.sqrt(pSq);
      const tmp = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p);
      cand.push({ type: 'RSL', t: mod2pi(alpha - tmp), p: p, q: mod2pi(beta - tmp) });
    }

    let best = null;
    let bestLen = Infinity;
    for (let i = 0; i < cand.length; i++) {
      const c = cand[i];
      const len = c.t + c.p + c.q;
      if (len > 1e-9 && len < bestLen) {
        bestLen = len;
        best = c;
      }
    }
    if (!best) return null;

    best.len = bestLen * R;
    return best;
  }

  function emitDubins(st, out, path, R) {
    const seq = [
      { c: path.type.charAt(0), v: path.t },
      { c: 'S', v: path.p },
      { c: path.type.charAt(2), v: path.q },
    ];

    for (let i = 0; i < seq.length; i++) {
      const s = seq[i];
      if (s.v <= 1e-9) continue;
      if (s.c === 'S') emitLine(st, out, s.v * R);
      else emitArc(st, out, R, s.c === 'L' ? s.v : -s.v);
    }
  }

  /* ==================== 片段：选型与执行 ==================== */

  /** 按权重抽一个片段（回环之后不再立刻接回环，避免叠在一起） */
  function rollPiece(prevTag) {
    const heavy = prevTag === 'loop' || prevTag === 'ring';
    const table = [
      { tag: 'sweep', w: heavy ? 34 : 30 },
      { tag: 'straight', w: heavy ? 30 : 20 },
      { tag: 'sPair', w: heavy ? 20 : 16 },
      { tag: 'hairpin', w: heavy ? 16 : 15 },
      { tag: 'loop', w: 0 },
      { tag: 'ring', w: 0 },
    ];

    let sum = 0;
    for (let i = 0; i < table.length; i++) sum += table[i].w;

    let r = Math.random() * sum;
    let tag = 'straight';
    for (let i = 0; i < table.length; i++) {
      r -= table[i].w;
      if (r <= 0) { tag = table[i].tag; break; }
    }

    if (tag === 'straight') {
      const len = DRC.rnd(320, 720);
      return { kind: 'line', len: len, cost: len, tag: tag };
    }

    if (tag === 'sweep') {
      const r2 = DRC.rnd(MIN_R + 300, MIN_R + 760);
      const sweep = (Math.random() < 0.5 ? 1 : -1) * DRC.rnd(0.22, 0.55) * Math.PI;
      return { kind: 'arc', r: r2, sweep: sweep, cost: Math.abs(sweep) * r2, tag: tag };
    }

    if (tag === 'hairpin') {
      // 发卡弯进出两段的中心距约 2r，必须超过 CLEAR_DIST 才不判交叉；
      // 4 车道路面 CLEAR_DIST = 328，半径下限取 MIN_R + 64（2r ≥ 348）
      const r2 = DRC.rnd(MIN_R + 64, MIN_R + 140);
      const sweep = (Math.random() < 0.5 ? 1 : -1) * DRC.rnd(0.98, 1.14) * Math.PI;
      return { kind: 'arc', r: r2, sweep: sweep, cost: Math.abs(sweep) * r2, tag: tag };
    }

    // sPair：三段反向弧拼出的 S 弯。
    // 半径与摆角都取足够大的值，保证整体横摆超过两路安全间距，
    // 折回来的段落不会贴上别处。
    const r3 = DRC.rnd(MIN_R + 220, MIN_R + 430);
    const a = DRC.rnd(0.20, 0.34) * Math.PI;
    const sign = Math.random() < 0.5 ? 1 : -1;
    const parts = [
      { r: r3, sweep: sign * a },
      { r: r3 * 0.86, sweep: -sign * a * 1.15 },
      { r: r3, sweep: sign * a * 1.05 },
    ];

    let cost = 0;
    for (let i = 0; i < parts.length; i++) cost += Math.abs(parts[i].sweep) * parts[i].r;
    return { kind: 'multi', parts: parts, cost: cost, tag: tag };
  }

  /**
   * 360° 回湾：平面上绕满一整圈。
   * 单层赛道不能交叉，所以先按左右两个方向各试一圈半径候选，
   * 要求回湾圆周（含安全余量）不套住任何别处的已走采样点。
   * 判据是"到圆周的距离"而不是"到圆心的距离"——入口前的路
   * 距圆心可能只比 r + SAFE 小一点，但贴着圆周就只有一两百，
   * 远小于安全余量，这种必须排除。
   * 入口前连续贴着圆周的那一小段是回湾自身的延续，排除掉。
   * 两个方向都找不到干净半径就返回 null，本次放弃回湾。
   */
  function pickLoop(samples, st) {
    const n = samples.length;
    const SAFE = CLEAR_DIST + 44;      // 圆周之外至少留出的净距
    // 候选半径跟着 CLEAR_DIST 放大：4 车道路面更宽，回湾圆盘要占
    // 更大的空地才能保证圆周与别处不贴（SAFE = 372）
    const candidates = [430, 390, 350, 315, 285];

    for (let dir = -1; dir <= 1; dir += 2) {
      for (let ci = 0; ci < candidates.length; ci++) {
        const r = candidates[ci];
        const cx = st.x - Math.sin(st.ang) * r * dir;
        const cy = st.y + Math.cos(st.ang) * r * dir;
        const lim2 = (r + SAFE) * (r + SAFE);

        // 入口延续段：从末尾往前，连续贴近圆周的都算回湾自己的路
        let tail = 0;
        while (tail < n - 40) {
          const p = samples[n - 1 - tail];
          const dx = p.x - cx;
          const dy = p.y - cy;
          if (dx * dx + dy * dy < lim2) tail++;
          else break;
        }

        let clean = true;
        for (let i = 0; i < n - tail && clean; i++) {
          const dx = samples[i].x - cx;
          const dy = samples[i].y - cy;
          if (dx * dx + dy * dy < lim2) clean = false;
        }
        if (clean) {
          return {
            kind: 'arc', r: r, sweep: dir * TAU, cost: TAU * r,
            tag: r >= 280 ? 'ring' : 'loop',
          };
        }
      }
    }
    return null;
  }

  function applyPiece(st, out, piece) {
    if (piece.kind === 'arc') {
      emitArc(st, out, piece.r, piece.sweep);
    } else if (piece.kind === 'line') {
      emitLine(st, out, piece.len);
    } else if (piece.kind === 'multi') {
      for (let i = 0; i < piece.parts.length; i++) {
        emitArc(st, out, piece.parts[i].r, piece.parts[i].sweep);
      }
    }
  }

  /* ==================== 后处理 ==================== */

  /** 两段路面互不重叠要求的最小中心距（含墙与安全余量） */
  const CLEAR_DIST = (C.trackHalfWidth + C.bufferWidth) * 2 + 24;
  /** 沿路径至少隔这么多个采样点才算"别处" */
  const MIN_GAP_IDX = 40;

  /**
   * 在线避让：新生成的一段是否贴上了别处的旧采样点。
   * 沿路径距离要双向取近——闭环首尾（起点与末端）沿路径只隔
   * 一两个点，却会被索引差误判成"绕了整圈的别处"，
   * 正常的闭合直线正是这样被误拒的。
   * 用包围盒粗筛，避免逐点全量比较。
   */
  function tooClose(samples, newPts) {
    const n = samples.length;
    if (n < MIN_GAP_IDX + 8) return false;
    const lim2 = CLEAR_DIST * CLEAR_DIST;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let a = 0; a < newPts.length; a++) {
      const p = newPts[a];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    minX -= CLEAR_DIST; maxX += CLEAR_DIST;
    minY -= CLEAR_DIST; maxY += CLEAR_DIST;

    for (let a = 0; a < newPts.length; a += 2) {
      const np = newPts[a];
      for (let i = 0; i < n; i++) {
        // 沿路径索引差，双向取近；小于 minGap 的是接缝邻居，不算别处
        let d = (n + a - i) % n;
        if (d > n - d) d = n - d;
        if (d < MIN_GAP_IDX) continue;

        const sp = samples[i];
        if (sp.x < minX || sp.x > maxX || sp.y < minY || sp.y > maxY) continue;
        const dx = sp.x - np.x;
        const dy = sp.y - np.y;
        if (dx * dx + dy * dy < lim2) return true;
      }
    }
    return false;
  }

  function computeFrames(samples) {
    const n = samples.length;
    for (let i = 0; i < n; i++) {
      const a = samples[(i - 1 + n) % n];
      const b = samples[(i + 1) % n];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      samples[i].ang = ang;
      samples[i].nx = -Math.sin(ang);
      samples[i].ny = Math.cos(ang);
    }
  }

  /**
   * 对每个采样点，找到"沿路径距离 >= minGap"的最近点。
   * 单层平面赛道不允许交叉：这个距离小于路面全宽时，
   * 说明赛道在这个位置自己贴上了自己，整条作废重长。
   */
  function* proximityStage(samples, pFrom, pTo) {
    const n = samples.length;
    const minGap = MIN_GAP_IDX;
    const dist = new Float64Array(n);
    const idx = new Int32Array(n);
    const CHUNK = 40;

    for (let i0 = 0; i0 < n; i0 += CHUNK) {
      const iend = Math.min(n, i0 + CHUNK);
      for (let i = i0; i < iend; i++) {
        const a = samples[i];
        let bd = Infinity;
        let bi = -1;
        for (let k = minGap; k <= n - minGap; k++) {
          const j = (i + k) % n;
          const dx = a.x - samples[j].x;
          const dy = a.y - samples[j].y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bd) { bd = d2; bi = j; }
        }
        dist[i] = Math.sqrt(bd);
        idx[i] = bi;
      }
      yield {
        progress: pFrom + (pTo - pFrom) * (iend / n),
        label: '检查路线',
      };
    }

    return { dist: dist, idx: idx, minGap: minGap };
  }

  /**
   * 选一个新的索引起点：优先落在最长直道的中段。
   * 单层无交叉赛道没有"路口附近"概念，直道中段即可；
   * 直道天然远离首尾的闭合段，发车格前后都是平路。
   */
  function pickStart(samples, segments) {
    const n = samples.length;

    let bestS = -1;
    let bestLen = 0;
    for (let i = 0; i < segments.length; i++) {
      const sg = segments[i];
      if (sg.tag !== 'straight' || sg.to - sg.from < 6) continue;
      const len = sg.to - sg.from;
      if (len > bestLen) {
        bestLen = len;
        bestS = ((sg.from + sg.to) >> 1) % n;
      }
    }
    if (bestS >= 0) return bestS;
    return 0;
  }

  function wrapTrack(samples, stats) {
    let len = 0;
    for (let i = 0; i < samples.length; i++) {
      const a = samples[i];
      const b = samples[(i + 1) % samples.length];
      len += Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
    }

    return {
      samples: samples,
      n: samples.length,
      halfWidth: C.trackHalfWidth,
      bufferWidth: C.bufferWidth,
      length: len,
      pieces: stats,
    };
  }

  /* ==================== 单次尝试 ==================== */

  function* attemptBuild(idx, total) {
    const span = 0.9 / total;
    const base = 0.02 + idx * span;
    const at = function (local, label) {
      return { progress: base + span * DRC.clamp(local, 0, 1), label: label };
    };

    yield at(0.02, '规划路线');

    /* --- 引导椭圆：由目标圈长反推长短轴 --- */
    // 周长 >= 目标圈长：路径绕行不超过一圈，从源头避免自交
    const targetLen = DRC.rnd(C.trackLength[0], C.trackLength[1]);
    const aspect = DRC.rnd(1.22, 1.72);
    const perimeter = targetLen * DRC.rnd(1.00, 1.12);
    const k = 1 / aspect;
    const shape = 3 * (1 + k) - Math.sqrt((3 + k) * (1 + 3 * k));
    const A = perimeter / (Math.PI * shape);
    const B = A / aspect;
    const rot = DRC.rnd(-0.45, 0.45);
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const dir = Math.random() < 0.5 ? 1 : -1;

    const t0 = DRC.rnd(0, TAU);
    const e0x = Math.cos(t0) * A;
    const e0y = Math.sin(t0) * B;
    const tgx = -A * Math.sin(t0) * dir;
    const tgy = B * Math.cos(t0) * dir;

    const sx = e0x * cosR - e0y * sinR;
    const sy = e0x * sinR + e0y * cosR;
    const sth = Math.atan2(tgx * sinR + tgy * cosR, tgx * cosR - tgy * sinR);

    /** 椭圆上参数角 t 处的世界坐标 */
    function ellipsePoint(t) {
      const ex = Math.cos(t) * A;
      const ey = Math.sin(t) * B;
      return { x: ex * cosR - ey * sinR, y: ex * sinR + ey * cosR };
    }


    /* --- 生长：始终朝"椭圆上的前视点"做纯追踪 --- */
    const samples = [{ x: sx, y: sy }];
    const st = { x: sx, y: sy, ang: sth };
    const segments = [];
    const stats = { straight: 0, sweep: 0, sPair: 0, hairpin: 0, loop: 0, ring: 0 };
    const maxLen = targetLen * 2.0;
    const LEAD = 0.24;

    let walked = 0;
    let heavyLeft = Math.random() < 0.4 ? 2 : 1;      // 每局 1~2 个回环
    let nextHeavy = targetLen * DRC.rnd(0.1, 0.26);
    let theta = t0;            // 跟随车辆实际位置的参数角（连续累加）
    let prevPhi = t0;
    let prevTag = '';
    let fixRun = 0;            // 连续纠偏次数，太多就拉直道脱开
    let retreat = 0;           // 连续回退计数，越陷越深
    let homeShrink = 1;        // 收尾步长收缩系数：小步蠕行避开贴点，不回退
    let guard = 0;

    // 末端目标：起点退回后方一小段。
    // 闭环首尾在这里顺接（末段沿出发方向走进起点），
    // 而不是从侧方斜插进场——斜插会与出发段越贴越近直至重叠。
    const BACK = 300;
    const hx = sx - Math.cos(sth) * BACK;
    const hy = sy - Math.sin(sth) * BACK;

    while (guard++ < 500) {
      // 走满目标长度后朝终点位姿收尾
      const ddx = hx - st.x;
      const ddy = hy - st.y;
      const homeGap = Math.sqrt(ddx * ddx + ddy * ddy);

      const homing = walked >= targetLen;
      if (homing) {
        if (homeGap < 300) break;
      }
      if (walked >= maxLen) break;

      let want;
      if (homing) {
        want = Math.atan2(ddy, ddx);
      } else {
        const aim = ellipsePoint(theta + LEAD * dir);
        want = Math.atan2(aim.y - st.y, aim.x - st.x);
      }
      const err = DRC.normAngle(st.ang - want);

      /* --- 选片段 + 在线避让：贴上别处就换一个，最多试 4 次 --- */
      let piece = null;

      for (let tryIdx = 0; tryIdx < 4 && !piece; tryIdx++) {
        let cand = null;
        let usedHeavy = false;

        if (!homing && heavyLeft > 0 && walked >= nextHeavy && tryIdx === 0) {
          // 回湾先做圆盘避让，空间不干净就放弃（不消耗配额）
          cand = pickLoop(samples, st);
          if (cand) usedHeavy = true;
        }

        if (!cand && homing) {
          if (Math.abs(err) > 0.10 || tryIdx >= 2) {
            const r = DRC.rnd(MIN_R + 200, MIN_R + 480);
            let sweep;
            if (Math.abs(err) > 0.10) {
              sweep = (err > 0 ? -1 : 1) * Math.min(Math.abs(err) * 1.2, 1.3);
            } else {
              // 直线被贴死、步长也收缩过了：随机转个弧绕开再朝目标
              sweep = (Math.random() < 0.5 ? 1 : -1) * DRC.rnd(0.5, 1.1);
            }
            cand = { kind: 'arc', r: r, sweep: sweep, cost: Math.abs(sweep) * r, tag: 'fix' };
          } else {
            // 收尾：对准终点位姿后小步直行，不冲过头。
            // 步长可收缩——蠕行比回退更稳，回退会把 walked 拉回
            // 目标长度以下，退出收尾重新生长，来回震荡。
            const len = DRC.clamp(homeGap * 0.55 * homeShrink, 30, 430);
            cand = { kind: 'line', len: len, cost: len, tag: 'home' };
          }
        }

        if (!cand && !homing) {
          if (fixRun >= 3 || prevTag === 'loop' || prevTag === 'ring') {
            // 连续纠偏后 / 回环之后：先拉一段长直道脱开，避免折返回环旁
            const len = DRC.rnd(460, 740);
            cand = { kind: 'line', len: len, cost: len, tag: 'straight' };
          } else if (Math.abs(err) > 0.30) {
            const r = DRC.rnd(MIN_R + 200, MIN_R + 480);
            const sweep = (err > 0 ? -1 : 1) * Math.min(Math.abs(err) * 1.2, 1.3);
            cand = { kind: 'arc', r: r, sweep: sweep, cost: Math.abs(sweep) * r, tag: 'fix' };
          } else {
            cand = rollPiece(prevTag);
          }
        }

        // 先生成到临时数组，通过避让检查才真正落段
        const tmpSt = { x: st.x, y: st.y, ang: st.ang };
        const tmpOut = [];
        applyPiece(tmpSt, tmpOut, cand);
        if (tmpOut.length && tooClose(samples, tmpOut)) {
          // 收尾阶段收缩步长继续蠕行；生长阶段交给外层回退
          if (homing) homeShrink *= 0.5;
          continue;
        }

        if (usedHeavy) {
          heavyLeft--;
          nextHeavy = walked + targetLen * DRC.rnd(0.2, 0.38);
        }
        if (cand.tag === 'fix') fixRun++;
        else fixRun = 0;

        const from = samples.length;
        for (let q = 0; q < tmpOut.length; q++) samples.push(tmpOut[q]);
        st.x = tmpSt.x;
        st.y = tmpSt.y;
        st.ang = tmpSt.ang;
        const to = samples.length - 1;
        if (to >= from) segments.push({ tag: cand.tag, from: from, to: to });

        walked += cand.cost;
        piece = cand;
        homeShrink = 1;
      }

      if (!piece) {
        if (homing) {
          // 收尾阶段宁可小步硬挤也不回退：回退会把 walked 拉回
          // 目标长度以下而退出收尾，重新生长后再收尾，来回震荡
          const from = samples.length;
          emitLine(st, samples, 40);
          segments.push({ tag: 'home', from: from, to: samples.length - 1 });
          walked += 40;
        } else {
          // 四次候选都贴上别处：回退重新脱困，连续陷坑则越退越深。
          // 直接冲一段强制直道可能贴得更近甚至穿过去，回退才能绕开。
          const back_amt = 100 + retreat * 70;
          retreat++;
          const cut = Math.max(8, samples.length - back_amt);
          const back = samples[cut - 1];
          samples.length = cut;
          st.x = back.x;
          st.y = back.y;
          // 生长阶段采样点还没有 ang 字段，用前一个点的朝向推导
          const backPrev = samples[cut - 2];
          st.ang = backPrev
            ? Math.atan2(back.y - backPrev.y, back.x - backPrev.x)
            : sth;
          while (segments.length && segments[segments.length - 1].from >= cut) segments.pop();
          walked = Math.max(0, walked - back_amt * 15);

          const len = DRC.rnd(500, 800);
          const from = samples.length;
          emitLine(st, samples, len);
          segments.push({ tag: 'straight', from: from, to: samples.length - 1 });
          walked += len;
          fixRun = 0;
          prevTag = 'straight';
          stats.straight++;
        }
      } else {
        retreat = 0;

        // 参数角跟住实际位置，避免目标点跑到车前面太远而"抄近路"
        const u = (st.x * cosR + st.y * sinR) / A;
        const v = (-st.x * sinR + st.y * cosR) / B;
        const phi = Math.atan2(v, u);
        theta += DRC.normAngle(phi - prevPhi);
        prevPhi = phi;

        prevTag = piece.tag;
        const statKey = piece.tag === 'fix' ? 'sweep' : piece.tag;
        if (stats[statKey] !== undefined) stats[statKey]++;
      }

      yield at(0.05 + 0.55 * Math.min(1, walked / targetLen), '生成赛道');
    }

    /* --- 闭合 --- */
    yield at(0.62, '闭合赛道');

    const closeFrom = samples.length;
    let closed = false;
    // 大半径优先：闭合弧更肥，与前后段的间距更大，不会贴上出发段；
    // 后面补两个小半径，避免末端被迫走直线兜底
    const radii = [420, 300, 210, 150, 110];

    for (let i = 0; i < radii.length && !closed; i++) {
      const path = dubinsCSC(st.x, st.y, st.ang, sx, sy, sth, radii[i]);
      if (!path) continue;

      const tmpSt = { x: st.x, y: st.y, ang: st.ang };
      const tmpOut = [];
      emitDubins(tmpSt, tmpOut, path, radii[i]);
      if (tmpOut.length < 2) continue;
      if (tooClose(samples, tmpOut)) continue;   // 闭合弧贴上别处：换更小的半径

      for (let j = 0; j < tmpOut.length; j++) samples.push(tmpOut[j]);
      closed = true;
    }

    if (!closed) {
      // 所有半径的闭合弧都贴上别处：收尾空间太挤，这次作废重长。
      // 不用逐步弧硬修——弧只能对准"指向起点"的方向，而起点段
      // 要求沿 sth 进场，末端从侧方插进来接缝必然歪；
      // 追着目标转小弧又会绕圈。宁可重长，不留硬折角。
      computeFrames(samples);
      const bad = wrapTrack(samples, stats);
      bad.ok = false;
      return bad;
    }

    // 末点与起点重合时去掉，避免零长度段
    while (samples.length > 12) {
      const last = samples[samples.length - 1];
      const gap = Math.sqrt((last.x - sx) * (last.x - sx) + (last.y - sy) * (last.y - sy));
      if (gap < STEP * 0.5) samples.pop();
      else break;
    }

    if (samples.length > closeFrom) {
      segments.push({ tag: 'close', from: closeFrom, to: samples.length - 1 });
    }

    /* --- 后处理：帧数据 + 交叉检查 --- */
    yield at(0.68, '检查路线');
    computeFrames(samples);

    const prox = yield* proximityStage(samples, base + span * 0.72, base + span * 0.86);

    // 零容忍：任何一处与别处的间距小于路面全宽都算交叉，整条作废
    let bad = 0;
    for (let i = 0; i < samples.length; i++) {
      if (prox.dist[i] < CLEAR_DIST) bad++;
    }
    const ok = bad === 0;

    /* --- 起点挪到最长直道的中段 --- */
    const startIdx = pickStart(samples, segments);
    const rotated = startIdx > 0
      ? samples.slice(startIdx).concat(samples.slice(0, startIdx))
      : samples;

    const track = wrapTrack(rotated, stats);
    track.ok = ok;
    return track;
  }

  /* ==================== 装饰散布 ==================== */


  function* decorStage(track, p0, p1) {
    const s = track.samples;
    const n = track.n;
    const items = [];
    const GAP = 5;                                    // 每 5 个采样点铺一次
    const base = C.trackHalfWidth + C.bufferWidth + 34;
    const steps = Math.floor(n / GAP);

    for (let k = 0; k < steps; k++) {
      const sm = s[k * GAP];

      for (let side = -1; side <= 1; side += 2) {
        if (Math.random() < 0.32) continue;
        const off = (base + DRC.rnd(0, 250)) * side;
        items.push({
          x: sm.x + sm.nx * off + DRC.rnd(-16, 16),
          y: sm.y + sm.ny * off + DRC.rnd(-16, 16),
          r: DRC.rnd(9, 26),
          color: Math.random() < 0.5 ? '#1c3a24' : '#21452b',
        });
      }

      if (k % 48 === 0) {
        yield {
          progress: p0 + (p1 - p0) * (k / steps),
          label: '散布场景',
        };
      }
    }

    return items;
  }

  /* ==================== 主流程 ==================== */

  function* build() {
    // 零交叉判定很严，多给几次重试；仍不过就用正圆环兜底
    const ATTEMPTS = 8;
    let track = null;

    for (let a = 0; a < ATTEMPTS; a++) {
      track = yield* attemptBuild(a, ATTEMPTS);
      if (track.ok) break;
    }

    if (!track.ok) {
      track = fallbackTrack();
    }

    track.decor = yield* decorStage(track, 0.92, 1);
    delete track.ok;
    return track;
  }

  /** 同步生成（静态校验、初始化兜底） */
  function create() {
    const it = build();
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  /** 极简兜底赛道：正圆环，保证任何异常下游戏仍可进行 */
  function fallbackTrack() {
    const samples = [];
    const n = 520;
    const R = 2100;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      samples.push({ x: Math.cos(a) * R, y: Math.sin(a) * R });
    }
    computeFrames(samples);
    const track = wrapTrack(samples, { straight: 0, sweep: n, sPair: 0, hairpin: 0, loop: 0, ring: 0 });
    track.decor = makeDecor(track);
    return track;
  }

  /**
   * 分片异步生成：每片最多占用约 11ms，期间通过 onProgress 汇报进度。
   * 生成快于 minDuration 时会补足等待，让进度条有完整的一进一出。
   */
  function generateAsync(opts) {
    opts = opts || {};
    const onProgress = opts.onProgress || function () {};
    const minDuration = opts.minDuration == null ? 340 : opts.minDuration;
    const now = function () {
      return (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
    };
    const t0 = now();

    return new Promise(function (resolve) {
      const it = build();
      let label = '生成赛道';
      let reached = 0;

      /**
       * 收尾：生成快于 minDuration 时，把剩余进度平滑补齐，
       * 让进度条完整走完一次，而不是冲到 100% 后干等。
       */
      function finish(track) {
        const wait = Math.max(0, minDuration - (now() - t0));
        if (wait <= 0) {
          onProgress(1, label);
          resolve(track);
          return;
        }

        const from = reached;
        const steps = 4;
        let k = 0;
        const timer = setInterval(function () {
          k++;
          const p = from + (1 - from) * (k / steps);
          onProgress(Math.min(1, p), label);
          if (k >= steps) {
            clearInterval(timer);
            resolve(track);
          }
        }, wait / steps);
      }

      function step() {
        const tStart = now();
        try {
          while (now() - tStart < 8) {
            const r = it.next();
            if (r.done) {
              finish(r.value);
              return;
            }
            if (r.value && r.value.progress != null) {
              label = r.value.label || label;
              reached = r.value.progress;
              onProgress(reached, label);
            }
          }
        } catch (err) {
          onProgress(1, label);
          resolve(fallbackTrack());
          return;
        }
        setTimeout(step, 0);
      }

      setTimeout(step, 0);
    });
  }

  /* ==================== 查询接口 ==================== */

  /**
   * 最近采样点。hint 给定时先在上一帧位置附近找，
   * 高速过弯时搜索窗口能防止采样点跳变，圈速统计更稳。
   */
  function nearest(track, x, y, hint) {
    const s = track.samples;
    const n = s.length;
    let bi = 0;
    let bd = Infinity;

    if (typeof hint === 'number' && hint >= 0) {
      const WINDOW = 52;
      for (let k = -WINDOW; k <= WINDOW; k++) {
        const i = ((hint + k) % n + n) % n;
        const dx = s[i].x - x;
        const dy = s[i].y - y;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; bi = i; }
      }
      if (bd <= 240 * 240) return { i: bi, dist: Math.sqrt(bd) };
    }

    bd = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = s[i].x - x;
      const dy = s[i].y - y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; bi = i; }
    }
    return { i: bi, dist: Math.sqrt(bd) };
  }

  /** 有符号横向偏移：正数表示位于赛道中心线的右侧 */
  function lateral(track, index, x, y) {
    const s = track.samples[index];
    return (x - s.x) * s.nx + (y - s.y) * s.ny;
  }

  /** 赛道包围盒（含缓冲带与墙体） */
  function bounds(track) {
    const s = track.samples;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (let i = 0; i < s.length; i++) {
      if (s[i].x < minX) minX = s[i].x;
      if (s[i].x > maxX) maxX = s[i].x;
      if (s[i].y < minY) minY = s[i].y;
      if (s[i].y > maxY) maxY = s[i].y;
    }

    const pad = C.trackHalfWidth + C.bufferWidth + 30;
    return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
  }

  /** 在赛道两侧散布树木装饰 */
  function makeDecor(track) {
    const s = track.samples;
    const n = track.n;
    const items = [];
    const GAP = 5;
    const base = C.trackHalfWidth + C.bufferWidth + 34;
    const steps = Math.floor(n / GAP);

    for (let k = 0; k < steps; k++) {
      const sm = s[k * GAP];
      for (let side = -1; side <= 1; side += 2) {
        if (Math.random() < 0.32) continue;
        const off = (base + DRC.rnd(0, 250)) * side;
        items.push({
          x: sm.x + sm.nx * off + DRC.rnd(-16, 16),
          y: sm.y + sm.ny * off + DRC.rnd(-16, 16),
          r: DRC.rnd(9, 26),
          color: Math.random() < 0.5 ? '#1c3a24' : '#21452b',
        });
      }
    }
    return items;
  }

  DRC.Track = {
    create: create,
    generateAsync: generateAsync,
    nearest: nearest,
    lateral: lateral,
    bounds: bounds,
    makeDecor: makeDecor,
  };
})(window.DRC);
