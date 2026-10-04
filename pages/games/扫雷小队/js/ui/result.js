/**
 * 结算面板：概览小卡 + 两个 tab（用时·排名 / 完整统计）。
 *
 * 布局：头部与底部按钮固定，只有 tab 内容区滚动；
 * 柱状图独占一整行（以前和队伍排名并排，人多时横轴标签全挤在一起）。
 * 柱状图里真人玩家用「不同颜色的 45° 斜条纹」区分（P1 金 / P2 粉），
 * AI 用队伍纯色渐变；冠军队伍与全场最快的柱子带闪烁描边。
 * 只负责把数据画成 DOM，回调节由 ui/flow 注入，不反向依赖游戏流程。
 */
import { TEAM_COLORS, TEAM_NAMES, PLAYER_COLORS, FLAG_BONUS, DEFUSE_BONUS } from '../core/config.js';
import { settings } from '../core/state.js';
import { replay } from '../sim/recorder.js';
import { showOverlay, hideOverlay } from './screens.js';

const ROLE_TEXT = { runner: '冲刺', flagRunner: '夺旗', defuser: '排雷' };

export function showResults(data, teamStats, overview, { onRestart, onMenu, onReplay }) {
  const ov = document.getElementById('resultOverlay');

  const winner = teamStats[0];
  const fastest = data[0];
  const maxTime = Math.max(...data.map(d => d.time), 1);
  const dense = data.length > 12;                 // 人多时柱子变窄，隐掉次要文字
  const canReplay = replay.frames.length > 0;

  const caption =
    `🏆 ${winner.name} 获胜 · 全队 ${winner.total.toFixed(1)}s · 最快 ${fastest.name} ${fastest.time.toFixed(2)}s`;

  /* ── 概览小卡 ── */
  const chips = [
    ['⏱', overview.duration.toFixed(1) + 's', '总时长'],
    ['🚩', `${overview.arrived}/${overview.total}`, '到达出口'],
    ['🧨', overview.defused, `排雷 -${overview.defuseBonus}s`],
    ['📡', overview.scans, '扫描次数'],
    ['💥', overview.downs, '倒地次数'],
    ['🎏', `${overview.flagsTaken}/${overview.flagsTotal}`, `夺旗 -${overview.flagBonus}s`],
    ['⏬', `-${overview.totalBonus}s`, '全队总减秒'],
    ['🗺', Math.round(overview.explore * 100) + '%', '迷宫探索']
  ].map(([ico, val, label]) => `
    <div class="chip">
      <span class="chip-ico">${ico}</span>
      <b class="chip-val">${val}</b>
      <i class="chip-label">${label}</i>
    </div>`).join('');

  /* ── 柱状图：独占一行，玩家斜条纹 / AI 队伍色 ── */
  let barsHtml = '';
  data.forEach((d, i) => {
    const h = Math.max(2, (d.time / maxTime) * 100);
    const flash = d.teamId === winner.teamId || i === 0;
    const pc = PLAYER_COLORS[d.playerIndex] || PLAYER_COLORS[0];

    const fill = d.isPlayer
      ? `repeating-linear-gradient(45deg, ${pc} 0 6px, #0b1220 6px 12px)`
      : `linear-gradient(180deg, ${d.color}, ${d.color}88)`;

    const nameColor = d.isPlayer ? pc : d.color;
    const role = d.isPlayer ? '真人' : (ROLE_TEXT[d.role] || '冲刺');

    barsHtml += `
      <div class="bar-group${flash ? ' bar-flash' : ''}${d.isPlayer ? ' is-player' : ''}"
           title="${d.name}（${role}）· 最终 ${d.time.toFixed(2)}s = 原始 ${d.rawTime.toFixed(2)}s${d.bonus ? ` − 减 ${d.bonus}s（🎏${d.teamFlags} · 🧨${d.teamDefused}）` : ''} · 排雷${d.defused} · 扫描${d.scans} · 倒地${d.downs} · 夺旗${d.flags} · 路程${Math.round(d.distance)}格">
        <div class="bar-value">${d.time.toFixed(1)}</div>
        <div class="bar-track">
          <div class="bar-fill" style="height:${h}%;background:${fill}"></div>
        </div>
        <div class="bar-name" style="color:${nameColor}">${d.short}${d.isPlayer ? '👤' : ''}</div>
        ${(!dense && d.title) ? `<div class="bar-title" title="${d.title.hint}">${d.title.icon}${d.title.text}</div>` : ''}
        <div class="bar-defused">🧨${d.defused}</div>
      </div>`;
  });

  /* ── 队伍排名 ── */
  let teamHtml = '';
  teamStats.forEach((t, i) => {
    teamHtml += `
      <div class="team-line${i === 0 ? ' champion' : ''}" style="border-color:${t.color}${i === 0 ? 'aa' : '33'}">
        <span class="rank">#${i + 1}</span>
        <span class="tname" style="color:${t.color}">${t.name}</span>
        <span class="tmeta">${t.arrived}/${t.count} 到达</span>
        <span class="tmeta">🧨${t.defused}</span>
        <span class="tmeta">💥${t.downs}</span>
        <span class="tmeta flag">🎏${t.flags}</span>
        <span class="ttime">${t.total.toFixed(1)}s</span>
      </div>
      <div class="team-sub">
        原始 ${t.rawTotal.toFixed(1)}s · 减 ${t.bonus}s（🎏${t.flags} -${t.flagBonus}s · 🧨${t.defused} -${t.defuseBonus}s）
        = ${t.total.toFixed(1)}s · 均 ${t.avg.toFixed(1)}s · 最快 ${t.bestName} ${t.bestTime.toFixed(1)}s
      </div>`;
  });

  /* ── 图例 ── */
  let legendHtml = '';
  for (let t = 0; t < settings.teamCount; t++) {
    legendHtml += `<span><i style="background:${TEAM_COLORS[t]}"></i>${TEAM_NAMES[t]}</span>`;
  }
  legendHtml += `<span><i class="stripe p1"></i>玩家1</span>`;
  if (settings.playerCount > 1) legendHtml += `<span><i class="stripe p2"></i>玩家2</span>`;
  legendHtml += `<span>👤 真人</span><span>🎏 夺旗</span><span>✨ 冠军 / 最快</span>`;

  /* ── 完整统计表：每行跟一条可展开的「用时公式」明细行 ── */
  const COLS = 13;
  let rowsHtml = '';
  data.forEach((d, i) => {
    const nc = d.isPlayer ? (PLAYER_COLORS[d.playerIndex] || PLAYER_COLORS[0]) : d.color;
    const cut = d.bonus > 0
      ? `<i class="cut">-${d.bonus}s</i>`
      : `<i class="cut none">—</i>`;

    // 减秒明细：每项一个 chip
    const termChips = d.terms.length
      ? d.terms.map(t => `<span class="fx-chip">${t.icon} ${t.label} ${t.amount}×${t.unit}s = -${t.delta}s</span>`).join('')
      : '<span class="fx-chip none">无减秒</span>';

    const termLines = d.terms.length
      ? d.terms.map(t => `<div class="fx-item"><span class="fx-ico">${t.icon}</span>
           <span class="fx-label">${t.label}</span>
           <span class="fx-term">${t.amount} × ${t.unit}s</span>
           <span class="fx-delta">-${t.delta}s</span>
           <span class="fx-note">${t.note}</span></div>`).join('')
      : '<div class="fx-item none">本局没有产生任何减秒（未夺旗、未排雷）</div>';

    const titleHtml = d.title
      ? `<span class="ttl" title="${d.title.hint}">${d.title.icon}${d.title.text}</span>`
      : '';

    rowsHtml += `
      <tr class="main-row" data-row="${i}">
        <td class="c-rank">${d.rank}</td>
        <td class="c-name" style="color:${nc}">
          ${d.name}${d.isPlayer ? ' 👤' : ''}${titleHtml}<span class="fx-caret">▸</span>
        </td>
        <td><span class="dot" style="background:${d.color}"></span>${d.teamName}</td>
        <td>${d.isPlayer ? '真人' : (ROLE_TEXT[d.role] || '冲刺')}</td>
        <td class="num raw">${d.rawTime.toFixed(2)}s</td>
        <td class="num cut-cell">${cut}</td>
        <td class="num final">${d.time.toFixed(2)}s</td>
        <td><span class="badge ${d.arrived ? 'ok' : 'no'}">${d.arrived ? '到达' : '未到达'}</span></td>
        <td class="num">${d.defused}</td>
        <td class="num">${d.scans}</td>
        <td class="num">${d.downs}</td>
        <td class="num">${d.flags}</td>
        <td class="num">${Math.round(d.distance)}</td>
      </tr>
      <tr class="fx-row" data-fx="${i}" hidden>
        <td colspan="${COLS}">
          <div class="fx-box">
            <div class="fx-expr">${d.expr}</div>
            <div class="fx-chips">${termChips}</div>
            <div class="fx-items">${termLines}</div>
            <div class="fx-foot">
              ${d.arrived ? '到达出口，以到达时刻计时' : `未到达，按本局总时长 ${d.rawTime.toFixed(2)}s 计`}
              ${d.floored ? ' · 减秒后低于 0，按 0s 计' : ''}
            </div>
          </div>
        </td>
      </tr>`;
  });

  ov.innerHTML = `
    <div class="panel result-panel">
      <div class="result-head">
        <div class="result-title">比 赛 结 束</div>
        <div class="winner-line" style="color:${winner.color}">
          🏆 ${winner.name} 获胜 · 全队 ${winner.total.toFixed(1)}s
        </div>
        <div class="stat-chips">${chips}</div>
      </div>

      <div class="result-tabs">
        <button class="tab active" data-tab="chart">⏱ 用时 · 排名</button>
        <button class="tab" data-tab="stats">📊 完整统计</button>
      </div>

      <div class="result-scroll">
        <div class="tab-page active" data-page="chart">
          <div class="card">
            <div class="col-title">⏱ 个人用时（秒）· 最快 ${fastest.name} ${fastest.time.toFixed(2)}s</div>
            <div class="chart${dense ? ' dense' : ''}">
              <span class="ax ax-max">${maxTime.toFixed(0)}s</span>
              <span class="ax ax-zero">0</span>
              ${barsHtml}
            </div>
            <div class="chart-legend">${legendHtml}</div>
          </div>

          <div class="card">
            <div class="col-title">🏅 队伍排名（总用时已扣除夺旗与排雷减秒）</div>
            <div class="team-summary">${teamHtml}</div>
          </div>
        </div>

        <div class="tab-page" data-page="stats">
          <div class="card">
            <div class="col-title">🧮 用时计算公式</div>
            <div class="formula-card">
              <div class="fx-formula">
                最终用时 = max(0, 原始用时 − 🎏 夺旗数 × ${FLAG_BONUS}s − 🧨 排雷数 × ${DEFUSE_BONUS}s)
              </div>
              <ul class="fx-rules">
                <li><b>原始用时</b>：到达出口的时刻；未到达者按本局总时长 ${overview.duration.toFixed(2)}s 计（含倒地等待）。</li>
                <li><b>🎏 夺旗</b>：全队共享，每面旗让该队<b>每人</b> −${FLAG_BONUS}s。</li>
                <li><b>🧨 排雷</b>：全队共享，每排除一颗雷让该队<b>每人</b> −${DEFUSE_BONUS}s。</li>
                <li>两项都按<b>队伍总数</b>计算（不是个人），同一队每个人的减秒完全相同。</li>
              </ul>
              <button class="fx-toggle" id="btnToggleFx">展开全部公式</button>
            </div>
          </div>

          <div class="card">
            <div class="col-title">📊 完整统计 · 点击任意一行查看该角色的用时明细</div>
            <div class="table-wrap">
              <table class="stat-table">
                <thead>
                  <tr>
                    <th>#</th><th>角色</th><th>队伍</th><th>分工</th>
                    <th>原始</th><th>减秒</th><th>最终用时</th><th>状态</th>
                    <th>排雷</th><th>扫描</th><th>倒地</th><th>夺旗</th><th>路程(格)</th>
                  </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="result-actions">
        <button class="menu-btn accent" id="btnResultReplay"${canReplay ? '' : ' disabled'}>
          🎞 观 看 回 放
        </button>
        <button class="menu-btn primary" id="btnResultRestart">再 来 一 局</button>
        <button class="menu-btn" id="btnResultMenu">返 回 主 菜 单</button>
      </div>
    </div>
  `;

  showOverlay('resultOverlay');

  /* ── tab 切换 ── */
  const panel = ov.querySelector('.result-panel');
  const tabs = ov.querySelectorAll('.tab');
  const pages = ov.querySelectorAll('.tab-page');
  tabs.forEach(b => {
    b.onclick = () => {
      tabs.forEach(x => x.classList.toggle('active', x === b));
      pages.forEach(p => p.classList.toggle('active', p.dataset.page === b.dataset.tab));
      // 完整统计：关掉外层滚动，高度全部让给表格，只有表格内部滚
      panel.classList.toggle('stats-mode', b.dataset.tab === 'stats');
    };
  });

  /* ── 完整统计：点击行展开该角色的用时公式 ── */
  const fxRows = ov.querySelectorAll('.fx-row');
  const mainRows = ov.querySelectorAll('.main-row');
  mainRows.forEach(r => {
    r.onclick = () => {
      const fx = ov.querySelector(`.fx-row[data-fx="${r.dataset.row}"]`);
      if (!fx) return;
      const open = !fx.hidden;
      fx.hidden = open;
      r.classList.toggle('open', !open);
    };
  });

  const btnFx = document.getElementById('btnToggleFx');
  if (btnFx) {
    let allOpen = false;
    btnFx.onclick = () => {
      allOpen = !allOpen;
      fxRows.forEach(fx => { fx.hidden = !allOpen; });
      mainRows.forEach(r => r.classList.toggle('open', allOpen));
      btnFx.textContent = allOpen ? '收起全部公式' : '展开全部公式';
    };
  }

  document.getElementById('btnResultRestart').onclick = () => {
    hideOverlay('resultOverlay');
    onRestart();
  };
  document.getElementById('btnResultMenu').onclick = () => {
    hideOverlay('resultOverlay');
    onMenu();
  };
  document.getElementById('btnResultReplay').onclick = () => {
    if (!canReplay) return;
    hideOverlay('resultOverlay');
    onReplay(caption);
  };
}
