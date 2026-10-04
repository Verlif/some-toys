/**
 * 主菜单背景演示局：跑一局全 AI 的对局当作动态壁纸。
 *
 * 演示局直接复用真实的世界构建与 stepMatch，只是 settings 临时换成演示配置
 * （构建完成后立刻还原，避免污染玩家在选项里选的设定），
 * 且没有真人玩家——视野合成会走 vision.js 的 demo 分支。
 */
import { W, H, DEMO_SETTINGS, DEMO_DURATION } from '../core/config.js';
import { settings, game } from '../core/state.js';
import { generateMaze } from '../world/maze.js';
import { placeMines } from '../world/mines.js';
import { createTeams } from '../world/teams.js';
import { createEntities } from '../world/entities.js';
import { stepMatch } from './simulation.js';

export function startDemo() {
  // 世界构建函数读的是全局 settings，这里临时切换、构建完立刻还原
  const saved = { ...settings };
  Object.assign(settings, DEMO_SETTINGS);

  const maze = generateMaze();
  game.walls = maze.walls;
  game.entranceYs = maze.entranceYs;
  game.exitX = maze.exitX;
  game.exitY = maze.exitY;
  game.mines = placeMines();
  game.teams = createTeams();
  game.entities = [];
  createEntities();

  Object.assign(settings, saved);

  game.teamTrails = game.teams.map(() => new Uint8Array(W * H));
  game.displayTrail = new Int8Array(W * H).fill(-1);
  game.unionKnown = new Uint8Array(W * H);
  game.displayFog = new Float32Array(W * H).fill(1);

  game.explosions = [];
  game.ripples = [];
  game.particles = [];
  game.elapsed = 0;
  game.countdown = 0;
  game.endCountdown = null;
  game.exitFlash = 0;
  game.screenShake = 0;
  game.keys = {};
  game.demo = true;
  game.state = 'demo';
}

/** 推进演示局；返回 true 表示该重开了 */
export function updateDemo(dt) {
  if (stepMatch(dt)) return true;
  return game.elapsed > DEMO_DURATION;
}
