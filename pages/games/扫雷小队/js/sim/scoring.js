/**
 * 结算统计：把实体状态折算成「每人成绩」「队伍总成绩」与「全局概览」。
 * 未到达者按当前总耗时计；队伍成绩 = 队员用时之和，越小越靠前。
 */
import { W, H, TILE, TEAM_COLORS, TEAM_NAMES } from '../core/config.js';
import { settings, game } from '../core/state.js';

export function collectResults() {
  const perTeamSeen = new Array(game.teams.length).fill(0);

  const data = game.entities.map(m => {
    const t = m.teamId;
    const seat = ++perTeamSeen[t];
    const time = m.arrived ? m.arrivedAt : game.elapsed;
    return {
      name: m.isPlayer ? `玩家${m.playerIndex + 1}` : `${TEAM_NAMES[t]}·AI${seat}`,
      short: m.isPlayer ? `P${m.playerIndex + 1}` : `A${seat}`,
      seat,
      teamId: t,
      teamName: TEAM_NAMES[t],
      color: TEAM_COLORS[t],
      time,
      arrived: m.arrived,
      isPlayer: m.isPlayer,
      playerIndex: m.playerIndex,
      defused: m.stats.minesDefused,
      scans: m.stats.scans,
      downs: m.stats.downs,
      distance: m.stats.distance / TILE      // 换算成格
    };
  });

  data.sort((a, b) => a.time - b.time);
  data.forEach((d, i) => { d.rank = i + 1; });

  // 队伍成绩
  const teamStats = [];
  for (let t = 0; t < game.teams.length; t++) {
    const members = data.filter(d => d.teamId === t);
    if (!members.length) continue;
    const total = members.reduce((s, m) => s + m.time, 0);
    const best = members[0];
    teamStats.push({
      teamId: t,
      name: TEAM_NAMES[t],
      color: TEAM_COLORS[t],
      count: members.length,
      total,
      avg: total / members.length,
      defused: members.reduce((s, m) => s + m.defused, 0),
      scans: members.reduce((s, m) => s + m.scans, 0),
      downs: members.reduce((s, m) => s + m.downs, 0),
      arrived: members.filter(m => m.arrived).length,
      bestTime: best.time,
      bestName: best.name
    });
  }
  teamStats.sort((a, b) => {
    if (b.arrived !== a.arrived) return b.arrived - a.arrived;   // 到达人数多的靠前
    return a.total - b.total;
  });
  teamStats.forEach((t, i) => { t.rank = i + 1; });

  // 全局概览
  let remaining = 0;
  for (let i = 0; i < W * H; i++) if (game.mines[i] > 0) remaining++;

  let walkable = 0, explored = 0;
  for (let i = 0; i < W * H; i++) {
    if (game.walls[i]) continue;
    walkable++;
    for (const team of game.teams) {
      if (team.known[i] !== 0) { explored++; break; }
    }
  }

  const overview = {
    duration: game.elapsed,
    total: data.length,
    arrived: data.filter(d => d.arrived).length,
    defused: data.reduce((s, d) => s + d.defused, 0),
    scans: data.reduce((s, d) => s + d.scans, 0),
    downs: data.reduce((s, d) => s + d.downs, 0),
    minesLeft: remaining,
    minesCleared: Math.max(0, Math.min(settings.mineCount, walkable) - remaining),
    explore: walkable ? explored / walkable : 0
  };

  return { data, teamStats, overview };
}
