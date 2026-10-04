/**
 * 视野与路径合成：画面上只呈现「玩家所在队伍」看到的东西。
 *
 * unionKnown    = 玩家所属各队 known 的逐格最大值
 * displayFog    = 玩家所属各队 fog 的逐格最小值（任一队看得见就算看得见）
 * displayTrail  = 只显示玩家所属队伍走过的路径（每格记队伍号，用于按队伍上色）
 *
 * 演示局（主菜单背景）没有真人玩家，改用 0 号的认知，并把迷雾压暗，
 * 好让背景里能看见迷宫轮廓与逐渐标红的雷。
 */
import { W, H, DEMO_FOG_SCALE } from '../core/config.js';
import { game } from '../core/state.js';

/** 玩家方所属队伍；演示局返回空数组由调用方特殊处理 */
function humanTeamIds() {
  const ids = [];
  for (const e of game.entities) {
    if (e.isPlayer && !ids.includes(e.teamId)) ids.push(e.teamId);
  }
  return ids;
}

export function computeUnionKnown() {
  if (game.demo && game.teams.length) {
    game.unionKnown.set(game.teams[0].known);
    return;
  }
  game.unionKnown.fill(0);
  for (const t of humanTeamIds()) {
    const k = game.teams[t].known;
    for (let i = 0; i < W * H; i++) {
      if (k[i] > game.unionKnown[i]) game.unionKnown[i] = k[i];
    }
  }
}

export function computeDisplayFog() {
  if (game.demo && game.teams.length) {
    const f = game.teams[0].fog;
    for (let i = 0; i < W * H; i++) game.displayFog[i] = f[i] * DEMO_FOG_SCALE;
    return;
  }
  const ids = humanTeamIds();
  if (ids.length === 0) {
    game.displayFog.fill(1);
    return;
  }
  for (let i = 0; i < W * H; i++) {
    let minFog = 1;
    for (const t of ids) {
      const f = game.teams[t].fog[i];
      if (f < minFog) minFog = f;
    }
    game.displayFog[i] = minFog;
  }
}

export function computeDisplayTrail() {
  game.displayTrail.fill(-1);
  const ids = game.demo && game.teams.length ? [0] : humanTeamIds();
  if (!ids.length) return;

  for (const t of ids) {
    const tr = game.teamTrails[t];
    if (!tr) continue;
    for (let i = 0; i < W * H; i++) {
      if (tr[i] && game.displayTrail[i] < 0) game.displayTrail[i] = t;
    }
  }
}
