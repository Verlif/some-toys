/* =========================================================
   panels.js — DOM 面板控制与事件绑定
   模式选择页为分层展开：
     单人 / 双人 / 观战 → （双人时）合作 / 对抗 → （合作时）方案 A / B
     单人 / 对抗时另有「驾驶方式」：每人一行 [自主驾驶][前后位][方向位]，
     选了座位就只开自己那一半，另一半由接管位的 AI 队友负责，
     并可选队友的风格（保守 / 激进）
   观战模式没有玩家车：车辆数量下限 2，标签改为"参赛车辆数量"。
   ========================================================= */
(function (DRC) {
  'use strict';

  const PANELS = ['panelMain', 'panelSetup', 'panelPause', 'panelResult'];

  let game = null;
  let segMode = null;
  let segTeam = null;
  let segScheme = null;
  let segSeatStyle = null;
  let segAi = null;
  let segSound = null;
  let fieldTeam = null;
  let fieldSeat = null;
  let fieldSeatStyle = null;
  let seatList = null;
  let seatNote = null;
  let lblSeatStyle = null;
  let styleNote = null;
  let fieldScheme = null;
  let modeNote = null;
  let schemeNote = null;
  let aiNote = null;
  let lblAi = null;
  let lblNpcTitle = null;
  let rngNpc = null;
  let lblNpc = null;
  let keypad = null;
  let loader = null;
  let loaderBar = null;
  let loaderPct = null;
  let loaderLabel = null;

  function el(id) {
    return document.getElementById(id);
  }

  function hideAll() {
    for (let i = 0; i < PANELS.length; i++) el(PANELS[i]).classList.add('hidden');
  }

  function show(id) {
    hideAll();
    el(id).classList.remove('hidden');
  }

  /** 领奖台：按 2 - 1 - 3 站位，台阶高度随名次递减 */
  function renderPodium(container, rows) {
    container.innerHTML = '';
    if (!rows.length) return;

    const top = rows.slice(0, 3);
    const layout = [];
    if (top[1]) layout.push(top[1]);
    if (top[0]) layout.push(top[0]);
    if (top[2]) layout.push(top[2]);

    for (let i = 0; i < layout.length; i++) {
      const r = layout[i];
      const slot = document.createElement('div');
      slot.className = 'podium-slot rank-' + r.rank + (r.isPlayer ? ' me' : '');
      slot.innerHTML =
        '<div class="podium-info">' +
          '<div class="podium-name">' +
            '<span class="res-dot" style="background:' + r.color + '"></span>' +
            r.name +
          '</div>' +
          '<div class="podium-model">' + r.model + '</div>' +
          '<div class="podium-time">' + r.timeText + '</div>' +
        '</div>' +
        '<div class="podium-step">' + r.rank + '</div>';
      container.appendChild(slot);
    }
  }

  /** 每台车的详细数据：总时间、单圈、碰撞、极速 */
  function renderBoard(board, rows) {
    board.innerHTML = '';

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const hits = r.wallHits + r.carHits;
      const item = document.createElement('div');
      item.className = 'res-row' +
        (r.rank === 1 ? ' win' : '') +
        (r.isPlayer ? ' me' : '');

      item.innerHTML =
        '<div class="res-rank">' + r.rank + '</div>' +
        '<div class="res-body">' +
          '<div class="res-head">' +
            '<span class="res-dot" style="background:' + r.color + '"></span>' +
            '<b>' + r.name + '</b>' +
            '<small class="res-model">' + r.model + '</small>' +
            (r.isPlayer ? '<small class="res-tag">你</small>' : '') +
            '<span class="res-time">' + r.timeText + '</span>' +
          '</div>' +
          '<div class="res-stats">' +
            '最快单圈 ' + r.bestLapText +
            ' · 均圈 ' + r.avgLapText +
            ' · 碰撞 ' + hits + '（墙 ' + r.wallHits + ' / 车 ' + r.carHits + '）' +
            ' · 极速 ' + r.topSpeed +
          '</div>' +
        '</div>';

      board.appendChild(item);
    }
  }

  /** 渲染结算面板内容 */
  function showResult(data) {
    const winner = el('resWinner');
    winner.textContent = data.winner;
    winner.style.backgroundImage =
      'linear-gradient(100deg, ' + data.winnerColor + ', #ffd166)';

    renderPodium(el('resPodium'), data.rows);
    renderBoard(el('resBoard'), data.rows);

    el('resMeta').textContent = data.meta;
    show('panelResult');
  }

  /* ==================== 合作操作预览 ==================== */

  function keycardHtml(part, role, color) {
    let keys = '';
    for (let i = 0; i < part.keys.length; i++) {
      if (i > 0) keys += '<span class="arrow">/</span>';
      keys += '<kbd>' + part.keys[i] + '</kbd>';
    }

    return '<div class="keycard">' +
      '<div class="keycard-head">' +
        '<span class="who" style="color:' + color + '">' + part.owner + '</span>' +
        '<b>' + role + '</b>' +
      '</div>' +
      '<div class="keys">' + keys + '</div>' +
      '<div class="keycard-foot">' + part.roles.join(' · ') + '</div>' +
    '</div>';
  }

  function renderKeypad(scheme) {
    const s = DRC.COOP_SCHEMES[scheme] || DRC.COOP_SCHEMES[1];
    keypad.innerHTML =
      keycardHtml(s.throttle, '前后', DRC.PLAYER_COLORS[0]) +
      keycardHtml(s.steer, '左右', DRC.PLAYER_COLORS[1]);
  }

  /* ==================== 驾驶方式（拆分座位） ==================== */

  const SEAT_BUTTONS =
    '<button type="button" data-v="0">自主驾驶</button>' +
    '<button type="button" data-v="1">前后位</button>' +
    '<button type="button" data-v="2">方向位</button>';

  /** 说明文字：没选座位时解释机制，选了就写清谁管哪一半 */
  function seatNoteText(st, n) {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const seat = st.seats[i] | 0;
      if (!seat) continue;
      const who = n > 1 ? 'P' + (i + 1) + ' ' : '你';
      const style = (DRC.DRIVE_STYLES[(st.seatStyle || 1) - 1] || DRC.DRIVE_STYLES[0]).label;
      parts.push((seat === 1 ? who + '管前后，方向交给' : who + '管方向，前后交给')
        + 'AI（' + style + '）');
    }
    if (!parts.length) {
      return '每台车都有前后与方向两位驾驶员：自主驾驶两边都自己开，' +
        '选一个座位则另一半交给 AI 队友';
    }
    return parts.join('　·　');
  }

  /**
   * 每个玩家一行：[自主驾驶][前后位][方向位]。
   * 行内按钮用事件委托重建，所以 sync 里可以整块重绘，不必逐个解绑
   */
  function renderSeats(st) {
    const n = st.mode === 'versus' ? 2 : 1;
    let assist = false;
    let html = '';

    for (let i = 0; i < n; i++) {
      if (st.seats[i] | 0) assist = true;
      html += '<div class="seat-row">' +
        '<span class="seat-who" style="color:' + DRC.PLAYER_COLORS[i] + '">' +
          (n > 1 ? 'P' + (i + 1) : '你') +
        '</span>' +
        '<div class="seg seat-seg" data-p="' + i + '">' + SEAT_BUTTONS + '</div>' +
      '</div>';
    }
    seatList.innerHTML = html;

    for (let i = 0; i < n; i++) {
      const seg = seatList.querySelector('.seat-seg[data-p="' + i + '"]');
      setActive(seg.querySelectorAll('button'), String(st.seats[i] | 0));
      seg.onclick = onSeatClick(i);
    }

    fieldSeatStyle.classList.toggle('hidden', !assist);
    seatNote.textContent = seatNoteText(st, n);
  }

  function onSeatClick(idx) {
    return function (e) {
      if (e.target.tagName !== 'BUTTON') return;
      game.state.seats[idx] = Number(e.target.dataset.v);
      sync();
    };
  }

  /* ==================== 生成进度 ==================== */

  function beginLoading() {
    if (!loader) return;
    loader.classList.remove('hidden');
    setLoading(0, '正在生成赛道');
  }

  function setLoading(progress, label) {
    if (!loaderBar) return;
    const pct = Math.round(DRC.clamp(progress, 0, 1) * 100);
    loaderBar.style.width = pct + '%';
    loaderPct.textContent = pct + '%';
    if (label) loaderLabel.textContent = label;
  }

  function endLoading() {
    if (!loader) return;
    setLoading(1, '准备发车');
    loader.classList.add('hidden');
  }

  /* ==================== 状态同步 ==================== */

  function setActive(buttons, value) {
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].dataset.v === value);
    }
  }

  function sync() {
    const st = game.state;
    const isTeam = st.mode === 'coop' || st.mode === 'versus';
    const isSpectate = st.mode === 'spectate';

    setActive(segMode, isSpectate ? 'spectate' : (isTeam ? 'team' : 'solo'));
    fieldTeam.classList.toggle('open', isTeam);
    setActive(segTeam, st.mode);

    const isCoop = st.mode === 'coop';
    fieldScheme.classList.toggle('open', isCoop);
    setActive(segScheme, String(st.coopScheme));

    // 驾驶方式：单人 / 双人对抗可拆座位，合作模式两人本来各占一席
    const isSeat = st.mode === 'solo' || st.mode === 'versus';
    fieldSeat.classList.toggle('open', isSeat);
    // 协作风格：无 AI 上车时整块藏起来，免得勾着不用
    setActive(segSeatStyle, String(st.seatStyle));
    const style = DRC.DRIVE_STYLES[(st.seatStyle || 1) - 1] || DRC.DRIVE_STYLES[0];
    lblSeatStyle.textContent = style.label.replace(/\s/g, '');
    styleNote.textContent = style.note;
    if (isSeat) renderSeats(st);

    // AI 智能程度：挡位名 + 一句话说明
    const lvl = DRC.AI_LEVELS[(st.aiLevel || 3) - 1] || DRC.AI_LEVELS[2];
    setActive(segAi, String(st.aiLevel));
    lblAi.textContent = lvl.label;
    aiNote.textContent = lvl.note;

    // 音效开关
    setActive(segSound, st.sound ? '1' : '0');

    // 观战：车数下限 2（一台车没什么可看），标签改成"参赛车辆数量"
    if (isSpectate && st.npcCount < 2) {
      st.npcCount = 2;
      rngNpc.value = '2';
      lblNpc.textContent = '2';
    }
    lblNpcTitle.textContent = isSpectate ? '参赛车辆数量' : 'AI 对手数量';

    if (isSpectate) {
      modeNote.textContent = 'AI 全自动比赛：空格切换鸟瞰总览，A/D 或 ←/→ 切换跟随车辆';
    } else if (st.mode === 'solo') {
      modeNote.textContent = (st.seats[0] | 0)
        ? '只坐一个座位，另一个座位由 AI 队友负责'
        : 'WASD 与方向键都可以驾驶同一台车';
    } else if (st.mode === 'coop') {
      modeNote.textContent = '两人分工控制同一台车';
      renderKeypad(st.coopScheme);
      schemeNote.textContent = DRC.COOP_SCHEMES[st.coopScheme].note;
    } else {
      modeNote.textContent = (st.seats[0] | 0) || (st.seats[1] | 0)
        ? '一人一台车：可以各自选座位，另一个座位交给 AI'
        : '一人一台车：P1 用 WASD，P2 用方向键';
    }

    // 展开 / 收起会改变面板高度，滚动条出现时缩略图需要重绘保持清晰
    refreshPreview();
  }

  /** 重绘赛道缩略图（面板需已显示，否则画布没有尺寸） */
  function refreshPreview() {
    if (!game) return;

    const canvas = el('trackPreview');
    const note = el('trackNote');
    if (!canvas) return;

    DRC.TrackRenderer.drawPreview(canvas, game.track);

    const t = game.track;
    if (note && t) {
      const p = t.pieces || {};
      const parts = ['全长 ' + (t.length / 10000).toFixed(2) + ' km'];
      const heavy = (p.loop || 0) + (p.ring || 0);
      if (heavy > 0) parts.push(heavy + ' 处回环');
      note.textContent = parts.join(' · ');
    }
  }

  /* ==================== 初始化 ==================== */

  function init(g) {
    game = g;

    segMode = el('segMode').querySelectorAll('button');
    segTeam = el('segTeam').querySelectorAll('button');
    segScheme = el('segScheme').querySelectorAll('button');
    segSeatStyle = el('segSeatStyle').querySelectorAll('button');
    segAi = el('segAi').querySelectorAll('button');
    segSound = el('segSound').querySelectorAll('button');
    fieldTeam = el('fieldTeam');
    fieldSeat = el('fieldSeat');
    fieldSeatStyle = el('fieldSeatStyle');
    seatList = el('seatList');
    seatNote = el('seatNote');
    lblSeatStyle = el('lblSeatStyle');
    styleNote = el('styleNote');
    fieldScheme = el('fieldScheme');
    modeNote = el('modeNote');
    schemeNote = el('schemeNote');
    aiNote = el('aiNote');
    lblAi = el('lblAi');
    keypad = el('keypad');
    loader = el('loader');
    loaderBar = el('loaderBar');
    loaderPct = el('loaderPct');
    loaderLabel = el('loaderLabel');

    // 展开动画结束后重绘缩略图，保证尺寸变化后不糊
    fieldTeam.addEventListener('transitionend', refreshPreview);
    fieldSeat.addEventListener('transitionend', refreshPreview);
    fieldScheme.addEventListener('transitionend', refreshPreview);

    const rngLap = el('rngLap');
    const lblLap = el('lblLap');

    rngNpc = el('rngNpc');
    lblNpc = el('lblNpc');
    lblNpcTitle = el('lblNpcTitle');

    // 与配置同步滑块范围与初值
    rngNpc.max = String(DRC.CONFIG.npcMax);
    rngLap.max = String(DRC.CONFIG.lapMax);
    rngNpc.value = String(game.state.npcCount);
    rngLap.value = String(game.state.totalLaps);
    lblNpc.textContent = String(game.state.npcCount);
    lblLap.textContent = String(game.state.totalLaps);

    rngNpc.oninput = function () {
      game.state.npcCount = Number(rngNpc.value);
      lblNpc.textContent = rngNpc.value;
    };

    rngLap.oninput = function () {
      game.state.totalLaps = Number(rngLap.value);
      lblLap.textContent = rngLap.value;
    };

    // 单人 / 双人 / 观战
    for (let i = 0; i < segMode.length; i++) {
      segMode[i].onclick = function () {
        const v = this.dataset.v;
        if (v === 'solo') game.state.mode = 'solo';
        else if (v === 'spectate') game.state.mode = 'spectate';
        else if (game.state.mode !== 'coop' && game.state.mode !== 'versus') {
          game.state.mode = 'coop';
        }
        sync();
      };
    }

    // 合作 / 对抗
    for (let i = 0; i < segTeam.length; i++) {
      segTeam[i].onclick = function () {
        game.state.mode = this.dataset.v;
        sync();
      };
    }

    // 方案 A / B
    for (let i = 0; i < segScheme.length; i++) {
      segScheme[i].onclick = function () {
        game.state.coopScheme = Number(this.dataset.v);
        sync();
      };
    }

    // AI 智能程度 1~5
    for (let i = 0; i < segAi.length; i++) {
      segAi[i].onclick = function () {
        game.state.aiLevel = Number(this.dataset.v);
        sync();
      };
    }

    // 协作驾驶风格 保守 / 激进（只管坐进玩家另一个座位的队友）
    for (let i = 0; i < segSeatStyle.length; i++) {
      segSeatStyle[i].onclick = function () {
        game.state.seatStyle = Number(this.dataset.v);
        sync();
      };
    }

    // 音效开 / 关（点击本身也是用户手势，顺手解锁音频上下文）
    for (let i = 0; i < segSound.length; i++) {
      segSound[i].onclick = function () {
        game.state.sound = this.dataset.v === '1';
        DRC.Sound.setEnabled(game.state.sound);
        sync();
      };
    }

    el('btnStart').onclick = function () { game.toSetup(); };
    el('btnBack').onclick = function () { game.toMenu(); };
    el('btnGo').onclick = function () { game.startRace(); };
    el('btnReroll').onclick = function () { game.rerollTrack(); };

    el('btnResume').onclick = function () { game.resume(); };
    el('btnQuit').onclick = function () { game.toMenu(); };

    el('btnAgain').onclick = function () {
      game.rerollTrack().then(function () { game.startRace(); });
    };
    el('btnMenu').onclick = function () { game.toMenu(); };

    sync();
  }

  DRC.UI = {
    init: init,
    show: show,
    hideAll: hideAll,
    showResult: showResult,
    sync: sync,
    refreshPreview: refreshPreview,
    beginLoading: beginLoading,
    setLoading: setLoading,
    endLoading: endLoading,
  };
})(window.DRC);
