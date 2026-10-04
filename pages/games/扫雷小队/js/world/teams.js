/**
 * 队伍容器：每队一份「已知信息」与「迷雾」位图，彼此独立。
 * known：0=未知 / 1=已知安全 / 2=已知有雷（扫描后写入，全局共享清除）
 */
import { W, H, TEAM_COLORS, TEAM_NAMES } from '../core/config.js';
import { settings } from '../core/state.js';

export function createTeams() {
  const teams = [];
  for (let t = 0; t < settings.teamCount; t++) {
    teams.push({
      id: t,
      name: TEAM_NAMES[t],
      color: TEAM_COLORS[t],
      known: new Uint8Array(W * H),
      fog: new Float32Array(W * H).fill(1),
      minesFound: 0,
      flags: 0,          // 本队已夺旗数（每面让全队每人 -FLAG_BONUS 秒）
      members: []
    });
  }
  return teams;
}
