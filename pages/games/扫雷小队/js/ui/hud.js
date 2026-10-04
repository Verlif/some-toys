/**
 * HUD：每张队伍卡片显示到达 / 倒地人数，顶栏显示计时与结算倒计时。
 */
import { FLAG_BONUS } from '../core/config.js';
import { settings, game } from '../core/state.js';

export function renderHUD() {
  let html = '';

  for (let t = 0; t < settings.teamCount; t++) {
    const team = game.teams[t];
    const members = game.entities.filter(e => e.teamId === t);
    const arrived = members.filter(e => e.arrived).length;
    const downed = members.filter(e => e.downed && !e.arrived).length;
    const isHuman = members.some(e => e.isPlayer);

    html += `
      <div class="team-card" style="border-color:${team.color}${isHuman ? '88' : '33'}">
        <div class="dot" style="background:${team.color}"></div>
        <div class="info">
          <div class="name" style="color:${team.color}">
            ${team.name}${isHuman ? ' <span class="tag">玩家</span>' : ''}
          </div>
          <div class="stat">
            ${arrived}/${members.length} 到达${downed > 0 ? ` · ${downed} 倒地` : ''}
          </div>
          <div class="stat flags">
            🚩 ${team.flags}${game.flags.length ? '/' + game.flags.length : ''}
            ${team.flags ? ` · 每人 -${team.flags * FLAG_BONUS}s` : ''}
          </div>        </div>
      </div>
    `;
  }

  document.getElementById('hud').innerHTML = html;
  document.getElementById('timerDisplay').textContent = game.elapsed.toFixed(2) + 's';

  const countEl = document.getElementById('countdownDisplay');
  if (game.endCountdown !== null && game.endCountdown > 0) {
    countEl.textContent = `结算倒计时 ${Math.ceil(game.endCountdown)}s`;
  } else {
    countEl.textContent = '';
  }

  const arrived = game.entities.filter(e => e.arrived).length;
  const total = game.entities.length;
  let status = `${arrived} / ${total} 已到达`;

  if (game.state === 'countdown') status = '倒计时中…';
  if (game.state === 'paused') status = '已暂停';

  document.getElementById('statusDisplay').textContent = status;
}
