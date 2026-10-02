/**
 * 快照序列化 / 应用。
 *
 * 联机时房主是权威：它把「世界现在长什么样」打包发出去，客户端直接覆盖本地状态。
 * 单机也用它 —— 回放、调试、以及“客户端本地预测后校正”都走同一条路径。
 *
 * 设计约定：
 *   · 只传**可序列化的模拟状态**，不传引用、不传函数；
 *   · 实体按 id 对齐，客户端不重建对象，只更新字段（避免渲染层持有旧引用）；
 *   · 地图不传：种子 + 配置就能在客户端本地生成同一张地图（见 world/map.js）。
 */
import { gstate } from '../core/state.js';
import { nowSec } from '../core/timer.js';

/** 打包当前世界的权威状态 */
export function serializeSnapshot() {
  const nowT = nowSec();
  return {
    t: gstate.timeLeft,
    state: gstate.state,
    seed: gstate.seed,
    matchOver: gstate.matchOver,
    matchWinner: gstate.matchWinner,
    spectator: gstate.spectator,
    cfg: {
      seekerCount: gstate.cfgSeekerCount,
      hiderCount: gstate.cfgHiderCount,
      playerCount: gstate.cfgPlayerCount,
      mapSize: gstate.cfgMapSize,
      gameTime: gstate.cfgGameTime
    },
    entities: gstate.entities.map(e => ({
      id: e.id,
      type: e.type,
      x: round2(e.x), y: round2(e.y),
      alive: !!e.alive,
      isPlayer: !!e.isPlayer,
      controlScheme: e.controlScheme,
      speedMode: e.speedMode,
      // 效果用“剩余秒数”传，避免两端时钟不同步
      frozenIn: Math.max(0, round2((e.frozenUntil || 0) - nowT)),
      hasteIn: Math.max(0, round2((e.hasteUntil || 0) - nowT)),
      revealedIn: Math.max(0, round2((e.revealedUntil || 0) - nowT)),
      revealedFor: e.revealedFor || null
    })),
    items: gstate.items.map(it => ({
      id: it.id, type: it.type,
      x: round2(it.x), y: round2(it.y),
      lifeIn: Math.max(0, round2(it.expireAt - nowT))
    }))
  };
}

/**
 * 用快照覆盖本地状态。
 * 客户端在两次快照之间用 prevX/prevY 做插值（见 render/renderer.js）。
 */
export function applySnapshot(snap) {
  if (!snap) return false;
  const nowT = nowSec();

  gstate.timeLeft = snap.t;
  gstate.seed = snap.seed;
  gstate.matchOver = !!snap.matchOver;
  gstate.matchWinner = snap.matchWinner ?? null;
  gstate.spectator = !!snap.spectator;
  if (snap.state) gstate.state = snap.state;
  if (snap.cfg) {
    gstate.cfgSeekerCount = snap.cfg.seekerCount;
    gstate.cfgHiderCount = snap.cfg.hiderCount;
    gstate.cfgPlayerCount = snap.cfg.playerCount;
    gstate.cfgMapSize = snap.cfg.mapSize;
    gstate.cfgGameTime = snap.cfg.gameTime;
  }

  // 实体：按 id 对齐更新
  const byId = new Map(gstate.entities.map(e => [e.id, e]));
  for (const se of snap.entities || []) {
    const e = byId.get(se.id);
    if (!e) continue;
    e.prevX = e.x; e.prevY = e.y;      // 供渲染插值
    e.x = se.x; e.y = se.y;
    e.alive = se.alive;
    e.isPlayer = !!se.isPlayer;
    if (se.controlScheme) e.controlScheme = se.controlScheme;
    e.speedMode = se.speedMode || e.speedMode;
    e.frozenUntil = se.frozenIn > 0 ? nowT + se.frozenIn : 0;
    e.hasteUntil = se.hasteIn > 0 ? nowT + se.hasteIn : 0;
    e.revealedUntil = se.revealedIn > 0 ? nowT + se.revealedIn : 0;
    e.revealedFor = se.revealedFor;
  }

  // 玩家归属（客户端第一次收到快照时才知道谁是玩家）
  gstate.players.length = 0;
  for (const e of gstate.entities) {
    if (e.isPlayer) gstate.players.push(e);
  }
  if (!gstate.player || !gstate.players.includes(gstate.player)) {
    gstate.player = gstate.players[0] || gstate.entities[0] || null;
  }

  // 道具
  const itemsById = new Map(gstate.items.map(it => [it.id, it]));
  const nextItems = [];
  for (const si of snap.items || []) {
    const existing = itemsById.get(si.id);
    if (existing) {
      existing.prevX = existing.x; existing.prevY = existing.y;
      existing.x = si.x; existing.y = si.y;
      existing.expireAt = nowT + si.lifeIn;
      nextItems.push(existing);
    } else {
      nextItems.push({
        id: si.id, type: si.type, x: si.x, y: si.y,
        prevX: si.x, prevY: si.y, r: 11,
        bornAt: nowT, expireAt: nowT + si.lifeIn
      });
    }
  }
  gstate.items.length = 0;
  gstate.items.push(...nextItems);

  return true;
}

const round2 = v => Math.round(v * 100) / 100;
