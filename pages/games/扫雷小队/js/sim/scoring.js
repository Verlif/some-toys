/**
 * 结算统计：把实体状态折算成「每人成绩」「队伍总成绩」与「全局概览」。
 *
 * ── 减秒规则（都是**全队每人**共享，在结算时统一折算，不改动实时计时）
 *   🎏 每夺一面旗：该队每人 -FLAG_BONUS 秒
 *   🧨 每排掉一颗雷：该队每人 -DEFUSE_BONUS 秒
 *   于是 最终用时 = max(0, 原始用时 − 5×旗数 − 1×雷数)
 *   队伍总成绩 = Σ 队员最终用时（未到达者按当前总时长计）
 *
 * 每一项减秒都会拆成 terms 数组，供结算页「完整统计」展开显示完整公式与原因。
 */
import { W, H, TILE, TEAM_COLORS, TEAM_NAMES, FLAG_BONUS, DEFUSE_BONUS } from '../core/config.js';
import { settings, game } from '../core/state.js';

/** 把一个人的减秒明细算出来：返回 { terms, bonus, time, formula } */
function buildBreakdown(m, raw, teamFlags, teamDefused) {
  const terms = [];

  if (teamFlags > 0) {
    terms.push({
      icon: '🎏',
      label: '夺旗',
      amount: teamFlags,
      unit: FLAG_BONUS,
      delta: teamFlags * FLAG_BONUS,
      note: `全队夺下 ${teamFlags} 面旗，每面 ${FLAG_BONUS}s${m.stats.flags ? `（其中你亲手夺 ${m.stats.flags} 面）` : ''}`
    });
  }

  if (teamDefused > 0) {
    terms.push({
      icon: '🧨',
      label: '排雷',
      amount: teamDefused,
      unit: DEFUSE_BONUS,
      delta: teamDefused * DEFUSE_BONUS,
      note: `全队排除 ${teamDefused} 颗雷，每颗 ${DEFUSE_BONUS}s${m.stats.minesDefused ? `（其中你亲手排 ${m.stats.minesDefused} 颗）` : ''}`
    });
  }

  const bonus = terms.reduce((s, t) => s + t.delta, 0);
  const floored = raw - bonus < 0;
  const time = Math.max(0, raw - bonus);

  // 公式文本：92.31 − 🎏2×5 − 🧨3×1 = 79.31
  const expr = [raw.toFixed(2)]
    .concat(terms.map(t => `− ${t.icon}${t.amount}×${t.unit}`))
    .concat([`= ${time.toFixed(2)}`])
    .join(' ');

  return { terms, bonus, time, expr, floored };
}

/** 称号：按「最值得说道的那一项」给，顺序即优先级，命中就不再往下找 */
const TITLES = {
  first:  { icon: '⚡', text: '闪电先锋', hint: '全场最先抵达终点（按到达时刻，不含减秒）' },
  flag:   { icon: '🎏', text: '夺旗王',   hint: '本局夺旗最多' },
  defuse: { icon: '🧨', text: '拆弹专家', hint: '本局排除地雷最多' },
  scan:   { icon: '📡', text: '侦察尖兵', hint: '本局扫描次数最多' },
  iron:   { icon: '💥', text: '雷区硬汉', hint: '被炸倒地次数最多' },
  clean:  { icon: '🛡', text: '零失误',   hint: '全程未被炸倒且抵达终点' },
  march:  { icon: '👣', text: '远征者',   hint: '行进路程最长' },
  finish: { icon: '🏁', text: '完赛者',   hint: '抵达终点' },
  lost:   { icon: '🌫', text: '迷途者',   hint: '未能抵达终点' }
};

/** 给每个人发一个称号（可以并列，比如两个人都是零失误） */
function assignTitles(data) {
  const maxOf = (f) => data.reduce((m, d) => Math.max(m, f(d)), 0);
  const arrived = data.filter(d => d.arrived);
  const first = arrived.length
    ? arrived.reduce((a, b) => (a.rawTime <= b.rawTime ? a : b))
    : null;

  const mFlag = maxOf(d => d.flags);
  const mDef  = maxOf(d => d.defused);
  const mScan = maxOf(d => d.scans);
  const mDown = maxOf(d => d.downs);
  const mDist = maxOf(d => d.distance);

  for (const d of data) {
    if (d === first) d.title = TITLES.first;
    else if (mFlag > 0 && d.flags === mFlag) d.title = TITLES.flag;
    else if (mDef > 0 && d.defused === mDef) d.title = TITLES.defuse;
    else if (mScan > 0 && d.scans === mScan) d.title = TITLES.scan;
    else if (mDown > 0 && d.downs === mDown) d.title = TITLES.iron;
    else if (d.arrived && d.downs === 0) d.title = TITLES.clean;
    else if (mDist > 0 && d.distance === mDist) d.title = TITLES.march;
    else if (d.arrived) d.title = TITLES.finish;
    else d.title = TITLES.lost;
  }
}

export function collectResults() {
  const nTeams = game.teams.length;
  const perTeamSeen = new Array(nTeams).fill(0);

  // 全队共享的两项减秒来源，先汇总
  const teamFlags   = new Array(nTeams).fill(0);
  const teamDefused = new Array(nTeams).fill(0);
  for (const m of game.entities) {
    teamDefused[m.teamId] += m.stats.minesDefused;
  }
  for (let t = 0; t < nTeams; t++) {
    teamFlags[t] = game.teams[t] ? game.teams[t].flags : 0;
  }

  const data = game.entities.map(m => {
    const t = m.teamId;
    const seat = ++perTeamSeen[t];
    const raw = m.arrived ? m.arrivedAt : game.elapsed;
    const bd = buildBreakdown(m, raw, teamFlags[t], teamDefused[t]);

    return {
      name: m.isPlayer ? `玩家${m.playerIndex + 1}` : `${TEAM_NAMES[t]}·AI${seat}`,
      short: m.isPlayer ? `P${m.playerIndex + 1}` : `A${seat}`,
      seat,
      teamId: t,
      teamName: TEAM_NAMES[t],
      color: TEAM_COLORS[t],
      time: bd.time,
      rawTime: raw,
      bonus: bd.bonus,
      terms: bd.terms,
      expr: bd.expr,
      floored: bd.floored,
      arrived: m.arrived,
      isPlayer: m.isPlayer,
      playerIndex: m.playerIndex,
      role: m.role,
      defused: m.stats.minesDefused,
      scans: m.stats.scans,
      downs: m.stats.downs,
      flags: m.stats.flags,
      teamFlags: teamFlags[t],
      teamDefused: teamDefused[t],
      distance: m.stats.distance / TILE      // 换算成格
    };
  });

  data.sort((a, b) => a.time - b.time);
  data.forEach((d, i) => { d.rank = i + 1; });
  assignTitles(data);

  // 队伍成绩
  const teamStats = [];
  for (let t = 0; t < nTeams; t++) {
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
      rawTotal: members.reduce((s, m) => s + m.rawTime, 0),
      avg: total / members.length,
      defused: teamDefused[t],
      scans: members.reduce((s, m) => s + m.scans, 0),
      downs: members.reduce((s, m) => s + m.downs, 0),
      arrived: members.filter(m => m.arrived).length,
      flags: teamFlags[t],
      bonus: teamFlags[t] * FLAG_BONUS + teamDefused[t] * DEFUSE_BONUS,
      flagBonus: teamFlags[t] * FLAG_BONUS,
      defuseBonus: teamDefused[t] * DEFUSE_BONUS,
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

  const flagsTotal = game.flags ? game.flags.length : 0;
  const flagsTaken = game.teams.reduce((s, t) => s + t.flags, 0);
  const defuseTotal = teamDefused.reduce((s, v) => s + v, 0);

  const overview = {
    duration: game.elapsed,
    total: data.length,
    arrived: data.filter(d => d.arrived).length,
    defused: defuseTotal,
    scans: data.reduce((s, d) => s + d.scans, 0),
    downs: data.reduce((s, d) => s + d.downs, 0),
    flagsTaken,
    flagsTotal,
    flagBonus: flagsTaken * FLAG_BONUS,
    defuseBonus: defuseTotal * DEFUSE_BONUS,
    totalBonus: flagsTaken * FLAG_BONUS + defuseTotal * DEFUSE_BONUS,
    minesLeft: remaining,
    minesCleared: Math.max(0, Math.min(settings.mineCount, walkable) - remaining),
    explore: walkable ? explored / walkable : 0
  };

  return { data, teamStats, overview };
}
