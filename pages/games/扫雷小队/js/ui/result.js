/**
 * 结算面板：概览小卡 + 个人用时柱状图 + 队伍排名 + 完整统计表。
 *
 * 布局全部走「卡片 + auto-fit 网格」，从 320px 窄窗口到宽屏都能自适应；
 * 柱状图里真人玩家用「不同颜色的 45° 斜条纹」区分（P1 金 / P2 粉），
 * AI 用队伍纯色渐变；冠军队伍与全场最快的柱子带闪烁描边。
 * 只负责把数据画成 DOM，回调节由 ui/flow 注入，不反向依赖游戏流程。
 */
import { TEAM_COLORS, TEAM_NAMES, PLAYER_COLORS } from '../core/config.js';
import { settings } from '../core/state.js';
import { replay } from '../sim/recorder.js';
import { showOverlay, hideOverlay } from './screens.js';

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
    ['🧨', overview.defused, '排除地雷'],
    ['📡', overview.scans, '扫描次数'],
    ['💥', overview.downs, '倒地次数'],
    ['🗺', Math.round(overview.explore * 100) + '%', '迷宫探索']
  ].map(([ico, val, label]) => `
    <div class="chip">
      <span class="chip-ico">${ico}</span>
      <b class="chip-val">${val}</b>
      <i class="chip-label">${label}</i>
    </div>`).join('');

  /* ── 柱状图：玩家斜条纹 / AI 队伍色 ── */
  let barsHtml = '';
  data.forEach((d, i) => {
    const h = Math.max(2, (d.time / maxTime) * 100);
    const flash = d.teamId === winner.teamId || i === 0;
    const pc = PLAYER_COLORS[d.playerIndex] || PLAYER_COLORS[0];

    const fill = d.isPlayer
      ? `repeating-linear-gradient(45deg, ${pc} 0 6px, #0b1220 6px 12px)`
      : `linear-gradient(180deg, ${d.color}, ${d.color}88)`;

    const nameColor = d.isPlayer ? pc : d.color;

    barsHtml += `
      <div class="bar-group${flash ? ' bar-flash' : ''}${d.isPlayer ? ' is-player' : ''}"
           title="${d.name} · ${d.time.toFixed(2)}s · 排雷${d.defused} · 扫描${d.scans} · 倒地${d.downs} · 路程${Math.round(d.distance)}格">
        <div class="bar-value">${d.time.toFixed(1)}</div>
        <div class="bar-track">
          <div class="bar-fill" style="height:${h}%;background:${fill}"></div>
        </div>
        <div class="bar-name" style="color:${nameColor}">${d.short}${d.isPlayer ? '👤' : ''}</div>
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
        <span class="ttime">${t.total.toFixed(1)}s</span>
      </div>
      <div class="team-sub">均 ${t.avg.toFixed(1)}s · 最快 ${t.bestName} ${t.bestTime.toFixed(1)}s</div>`;
  });

  /* ── 图例 ── */
  let legendHtml = '';
  for (let t = 0; t < settings.teamCount; t++) {
    legendHtml += `<span><i style="background:${TEAM_COLORS[t]}"></i>${TEAM_NAMES[t]}</span>`;
  }
  legendHtml += `<span><i class="stripe p1"></i>玩家1</span>`;
  if (settings.playerCount > 1) legendHtml += `<span><i class="stripe p2"></i>玩家2</span>`;
  legendHtml += `<span>👤 真人</span><span>✨ 冠军 / 最快</span>`;

  /* ── 完整统计表 ── */
  let rowsHtml = '';
  data.forEach(d => {
    rowsHtml += `
      <tr>
        <td class="c-rank">${d.rank}</td>
        <td class="c-name" style="color:${d.isPlayer ? (PLAYER_COLORS[d.playerIndex] || PLAYER_COLORS[0]) : d.color}">
          ${d.name}${d.isPlayer ? ' 👤' : ''}
        </td>
        <td><span class="dot" style="background:${d.color}"></span>${d.teamName}</td>
        <td class="num">${d.time.toFixed(2)}s</td>
        <td><span class="badge ${d.arrived ? 'ok' : 'no'}">${d.arrived ? '到达' : '未到达'}</span></td>
        <td class="num">${d.defused}</td>
        <td class="num">${d.scans}</td>
        <td class="num">${d.downs}</td>
        <td class="num">${Math.round(d.distance)}</td>
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

      <div class="result-grid">
        <div class="card">
          <div class="col-title">⏱ 个人用时（秒）· 最快 ${fastest.name} ${fastest.time.toFixed(2)}s</div>
          <div class="chart${dense ? ' dense' : ''}">${barsHtml}</div>
          <div class="chart-legend">${legendHtml}</div>
        </div>

        <div class="card">
          <div class="col-title">🏅 队伍排名</div>
          <div class="team-summary">${teamHtml}</div>
        </div>
      </div>

      <div class="card">
        <div class="col-title">📊 完整统计</div>
        <div class="table-wrap">
          <table class="stat-table">
            <thead>
              <tr>
                <th>#</th><th>角色</th><th>队伍</th><th>用时</th><th>状态</th>
                <th>排雷</th><th>扫描</th><th>倒地</th><th>路程(格)</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
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
