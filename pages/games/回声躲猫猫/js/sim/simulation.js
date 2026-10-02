/**
 * 对局模拟（唯一的世界推进入口）。
 *
 * ── 这一层绝对不碰 DOM
 *   所有需要通知界面的东西都通过 core/events.js 发出去，
 *   因此同一份模拟可以直接跑在：浏览器、无头测试、将来的房主 / 服务端。
 *
 * ── 固定步长
 *   外部（main.js 的主循环）按 SIM_HZ 调用 stepMatch(SIM_DT)；
 *   固定步长是回放复现与将来联机（快照 / 锁步）的前提。
 *
 * ── 指令入口
 *   玩家操作以 PlayerCommand 的形式放进 gstate.commands，
 *   本地键盘与网络包走的是同一条路径（见 core/command.js、net/session.js）。
 */
import { START_COUNTDOWN, SPECTATOR_GRACE, setWorldSize } from '../core/config.js';
import { gstate, countAliveHiders } from '../core/state.js';
import { nowSec, beginPause, endPause, resetTimeBase } from '../core/timer.js';
import { emit, EVT } from '../core/events.js';
import { setSeed, randomSeed } from '../core/rng.js';
import { indexCommands } from '../core/command.js';
import { buildEntities } from '../world/entities.js';
import { generateMap, forgetOpenCells } from '../world/map.js';
import { resetItems, updateItemSpawns, updateItemExpiry, collectPickups } from '../world/items.js';
import { resetStats, setStat, bumpStat } from './stats.js';
import { applyPlayerCommand } from './movement.js';
import { applyItemEffect } from './effects.js';
import { resolveCatches } from './combat.js';
import { updateMovementSounds, updateSoundWaves } from './sound.js';
import { captureReplayFrame, setReplayStart, resetReplayData } from './replay.js';
import { updateSeekerAI } from '../ai/seeker.js';
import { updateHiderAI } from '../ai/hider.js';

/* ============================================================
   开局
   ============================================================ */

/**
 * 按配置 + 种子生成世界（不含对局状态）。
 * 房主开局与客户端加入房间都走这里 —— 同一颗种子必然得到同一张地图，
 * 所以地图本身不需要走网络。
 */
export function prepareWorldFromConfig({ seed, cfg } = {}) {
  if (cfg) {
    if (cfg.seekerCount) gstate.cfgSeekerCount = cfg.seekerCount;
    if (cfg.hiderCount) gstate.cfgHiderCount = cfg.hiderCount;
    if (cfg.playerCount) gstate.cfgPlayerCount = cfg.playerCount;
    if (cfg.mapSize) gstate.cfgMapSize = cfg.mapSize;
    if (cfg.gameTime) gstate.cfgGameTime = cfg.gameTime;
  }

  const useSeed = seed !== undefined && seed !== null ? seed : randomSeed();
  setSeed(useSeed);
  gstate.seed = useSeed;

  setWorldSize(gstate.cfgMapSize);
  gstate.grid = generateMap();
  forgetOpenCells();
  buildEntities(gstate.selectedRole);

  gstate.soundWaves = [];
  gstate.wallMemoryMap = new Map();
  gstate.commands = [];
  gstate.commandsSeq = 0;
  resetItems();
  resetReplayData();
  return { seed: useSeed };
}

/**
 * 开始一局。
 * @param {string} role 'seeker' | 'hider'
 * @param {object} [opts] opts.seed 指定随机种子（联机时由房主下发）
 */
export function startMatch(role, opts = {}) {
  if (gstate.cfgPlayerCount === 2) {
    if (role === 'seeker') gstate.cfgSeekerCount = Math.max(2, gstate.cfgSeekerCount);
    else gstate.cfgHiderCount = Math.max(2, gstate.cfgHiderCount);
  }

  prepareWorldFromConfig(opts);
  resetTimeBase();

  gstate.pendingGameEnd = null;
  gstate.matchOver = false;
  gstate.matchWinner = null;
  gstate.timeLeft = gstate.cfgGameTime;
  gstate.spectator = false;
  gstate.showGodView = false;
  gstate.frozenRenderTime = null;
  gstate.resultAnimRemain = 0;
  gstate.resultAnimWinner = null;
  gstate.renderAlpha = 1;

  resetStats(role, {
    hiderCount: gstate.cfgHiderCount,
    seekerCount: gstate.cfgSeekerCount,
    gameTime: gstate.cfgGameTime,
    playerCount: gstate.cfgPlayerCount,
    seed: gstate.seed,
    netMode: gstate.net.mode
  });

  gstate.state = 'countdown';
  gstate.countdownRemain = START_COUNTDOWN;

  emit(EVT.MATCH_START, { role, seed: gstate.seed });
}

/**
 * 客户端侧：收到房主的 START 消息后把世界准备好。
 * 之后的一切都由快照驱动，本地不推进模拟。
 */
export function applyRemoteStart(payload = {}) {
  prepareWorldFromConfig({ seed: payload.seed, cfg: payload.cfg });
  gstate.state = 'countdown';
  gstate.countdownRemain = START_COUNTDOWN;
  gstate.matchOver = false;
  gstate.matchWinner = null;
  emit(EVT.MATCH_START, { role: payload.role || gstate.selectedRole, seed: gstate.seed, remote: true });
}

/* ============================================================
   每帧推进
   ============================================================ */

/** 倒计时阶段 */
function stepCountdown(dt) {
  gstate.countdownRemain -= dt;
  if (gstate.countdownRemain > 0) return;
  gstate.state = 'playing';
  // 必须先记录对局起点：captureReplayFrame 以 replayGameStartSec 为基准
  setReplayStart(nowSec());
  captureReplayFrame(true);
  emit(EVT.COUNTDOWN_END, {});
}

/** 玩家指令 → 角色动作 */
function stepPlayerCommands(dt) {
  if (!gstate.players.length) return;
  const cmds = indexCommands(gstate.commands);
  for (let i = 0; i < gstate.players.length; i++) {
    const p = gstate.players[i];
    if (!p) continue;
    if (p.type === 'hider' && !p.alive) continue;
    if (gstate.spectator) continue;          // 观战时玩家角色交给 AI
    const cmd = cmds[i];
    if (!cmd) continue;
    applyPlayerCommand(p, cmd, dt);
  }
}

/** AI 更新（非玩家控制的角色，以及观战时的玩家角色） */
function stepAI(dt) {
  for (const e of gstate.entities) {
    if (e.isPlayer && !gstate.spectator) continue;
    if (e.type === 'seeker') updateSeekerAI(e, dt);
    else if (e.alive) updateHiderAI(e, dt);
  }
}

/** 道具：刷新、过期、拾取、生效 */
function stepItems(dt) {
  updateItemSpawns(dt);
  updateItemExpiry();

  const picked = collectPickups();
  for (const { item, holder } of picked) {
    bumpStat('itemsCollected');
    if (holder.isPlayer) bumpStat('playerItemsCollected');
    gstate.itemLog.push({ t: gstate.timeLeft, itemId: item.id, type: item.type, holderId: holder.id });
    if (gstate.itemLog.length > 40) gstate.itemLog.shift();

    const result = applyItemEffect(holder, item);
    if (result.affected.length) bumpStat('itemEffects');
    emit(EVT.ITEM_PICKUP, { item, holder, type: result.type, affected: result.affected });
  }
}

/** 躲藏者被抓后的统一处理（含观战切换与延迟结算） */
function handleCatches(caught) {
  for (const { hider, seeker } of caught) {
    const total = gstate.cfgHiderCount;
    const remain = countAliveHiders();
    emit(EVT.HIDER_CAUGHT, {
      hider, seeker, remain, total,
      isPlayer: !!hider.isPlayer
    });

    if (hider.isPlayer && !gstate.spectator) {
      const aliveHumanHiders = gstate.players.filter(p => p.type === 'hider' && p.alive).length;
      if (aliveHumanHiders === 0) gstate.spectator = true;
    }
  }
}

/** 胜负判定 */
function checkEnd() {
  const aliveCount = countAliveHiders();
  setStat('hidersAlive', aliveCount);

  if (aliveCount === 0) {
    if (!gstate.pendingGameEnd) {
      const grace = gstate.spectator ? SPECTATOR_GRACE : 0;
      gstate.pendingGameEnd = { winner: 'seeker', at: nowSec() + grace };
    }
  }

  if (gstate.pendingGameEnd && nowSec() >= gstate.pendingGameEnd.at) {
    const w = gstate.pendingGameEnd.winner;
    gstate.pendingGameEnd = null;
    finishMatch(w);
    return true;
  }
  return false;
}

/**
 * 推进一个固定步长。
 * @param {number} dt 固定步长（秒），由主循环按 SIM_HZ 传入
 */
export function stepMatch(dt) {
  if (gstate.matchOver) return;

  if (gstate.state === 'countdown') {
    stepCountdown(dt);
    return;
  }
  if (gstate.state !== 'playing') return;

  // 渲染插值基准：本步开始前的位置（见 render/renderer.js）
  for (const e of gstate.entities) { e.prevX = e.x; e.prevY = e.y; }
  for (const it of gstate.items) { it.prevX = it.x; it.prevY = it.y; }

  gstate.timeLeft -= dt;
  const timeUp = gstate.timeLeft <= 0;
  if (timeUp) gstate.timeLeft = 0;

  stepPlayerCommands(dt);
  stepAI(dt);
  stepItems(dt);
  updateMovementSounds(dt);
  updateSoundWaves(dt);

  const caught = resolveCatches();
  if (caught.length) handleCatches(caught);

  captureReplayFrame(false);

  if (checkEnd()) return;
  if (timeUp) finishMatch('hiders');
}

/**
 * 判定胜负：停止世界推进，把结果交给表现层。
 * @param {'seeker'|'hiders'} winner
 */
export function finishMatch(winner) {
  if (gstate.matchOver) return;
  gstate.matchOver = true;
  gstate.matchWinner = winner;
  gstate.pendingGameEnd = null;
  captureReplayFrame(true);
  emit(EVT.MATCH_END, { winner });
}

/**
 * 暂停 / 继续：冻结逻辑时钟（core/timer），世界因此不再推进。
 * UI 侧（暂停面板）由 ui/flow.js 负责。
 */
export function setSimPaused(paused) {
  if (paused === gstate.paused) return;
  gstate.paused = paused;
  if (paused) beginPause();
  else endPause();
}
