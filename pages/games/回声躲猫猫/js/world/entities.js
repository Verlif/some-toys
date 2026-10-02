/**
 * 实体创建：搜捕者 / 躲藏者工厂 + 一局的开局布阵。
 *
 * 实体上除了位置与半径，还挂了两类“可序列化”的状态：
 *   · 效果字段：frozenUntil / hasteUntil / revealedUntil / revealedFor（见 core/status.js）
 *   · 转向字段：lastMoveDir / turnLockUntil / aim（见 sim/movement.js 的防抖逻辑）
 * 联机时这些字段都要能进快照，所以一律用数字与普通对象。
 */
import { SEEKER_R, HIDER_R, TILE } from '../core/config.js';
import { gstate } from '../core/state.js';
import { randRange, shuffle } from '../core/rng.js';
import { getOpenCells } from './map.js';

/**
 * 随机挑选 n 个互相分散的出生点。
 * 先大间距筛一遍，再逐步放宽最小间距，最后兜底随机补足。
 */
function pickSpawns(n) {
  const cells = shuffle(getOpenCells().slice());
  const chosen = [];
  let minD = 9;
  for (let pass = 0; pass < 5 && chosen.length < n; pass++) {
    for (const c of cells) {
      if (chosen.length >= n) break;
      let ok = true;
      for (const p of chosen) {
        if (Math.hypot(p.x - c.x, p.y - c.y) < minD) { ok = false; break; }
      }
      if (ok) chosen.push(c);
    }
    minD -= 2;
  }
  while (chosen.length < n && cells.length) {
    chosen.push(cells[(randRange(0, cells.length)) | 0]);
  }
  return chosen.map(c => ({ x: c.x * TILE + TILE / 2, y: c.y * TILE + TILE / 2 }));
}

/** 所有实体共享的字段（位置、效果、转向） */
function baseEntity(spawn, r) {
  return {
    /* 位置：x/y 是模拟位置，prevX/prevY 供渲染插值（见 render/renderer.js） */
    x: spawn.x, y: spawn.y,
    prevX: spawn.x, prevY: spawn.y,
    r,

    /* 状态效果 */
    frozenUntil: 0,
    hasteUntil: 0,
    revealedUntil: 0,
    revealedFor: null,

    /* 移动 / 转向防抖 */
    lastMoveDir: null,     // { x, y } 上一帧真实移动方向
    turnLockUntil: 0,      // 这段时间内不接受反向指令
    speedMode: 'walk',

    /* 声音 */
    soundTimer: 0,
    noiseCooldownUntil: 0,
    _px: spawn.x, _py: spawn.y,

    /* 路径 */
    path: null, pathIdx: 0, repathTimer: 0, stuckCount: 0,
    goal: null,
    aim: null,             // 当前锁定的朝向目标 { x, y, until }
    stuckTimer: 0,
    lastPathX: spawn.x,
    lastPathY: spawn.y
  };
}

/** 搜捕者实体 */
export function makeSeeker(spawn, isPlayer, controlScheme = 'p1') {
  return {
    ...baseEntity(spawn, SEEKER_R),
    id: gstate.nextEntityId++,
    type: 'seeker',
    isPlayer,
    controlScheme,
    alive: true,            // 搜捕者不会被淘汰，统一字段便于逻辑判断
    catchCooldownUntil: 0,  // 只有人类玩家会进入抓捕冷却（AI 无冷却）
    heardSound: null,       // 只记录敌对方（躲藏者）发出的声音
    spottedTarget: null,
    ai: {
      state: 'patrol',
      stateStart: 0,
      target: null,
      patrol: null,
      searchCenter: null,
      searchPoints: [],
      searchExpire: 0,
      visitedCells: new Map(),
      repathFast: false,
      lastNoise: 0,
      lastKnownHider: null,
      lastTargetPos: null,
      targetVelocity: { x: 0, y: 0 },
      confidence: 0,
      searchCursor: 0,
      itemTarget: null,     // 正在去捡的道具
      itemTargetUntil: 0
    }
  };
}

/** 躲藏者实体 */
export function makeHider(spawn, isPlayer, controlScheme = 'p1') {
  return {
    ...baseEntity(spawn, HIDER_R),
    id: gstate.nextEntityId++,
    type: 'hider',
    isPlayer,
    controlScheme,
    alive: true,
    heardSound: null,       // 只记录搜捕者发出的声音
    ai: {
      state: 'hide',
      stateStart: 0,
      threatZones: [],      // 只由“搜捕者的声音 / 搜捕者命中自己”产生
      hideSpot: null,
      hideSpotAt: 0,        // 上次换藏身点的时间（换点限流用）
      fleeTarget: null,
      fleeTargetAt: 0,      // 上次重算逃跑点的时间（限流用）
      fleeFrom: null,       // 上次重算时依据的威胁位置
      restTimer: randRange(1, 3),
      detectedBySeeker: 0,
      detectedBySeekerPos: null,
      lastNoise: 0,
      lastFleeFrom: null,
      quietTicks: 0,
      lastThreatPos: null,
      relocateTimer: randRange(2.5, 5.0),
      dangerScore: 0,
      itemTarget: null,
      itemTargetUntil: 0
    }
  };
}

/**
 * 按当前设置生成整局实体。
 * role 是玩家的身份：'seeker' 或 'hider'；前 humanCount 个该阵营角色由玩家控制。
 */
export function buildEntities(role) {
  const seekerCount = gstate.cfgSeekerCount;
  const hiderCount = gstate.cfgHiderCount;
  const humanCount = Math.min(2, Math.max(1, gstate.cfgPlayerCount));

  // 就地清空，保持 gstate 上数组引用不变（其他模块持有的是同一个数组）
  gstate.entities.length = 0;
  gstate.seekers.length = 0;
  gstate.hiders.length = 0;
  gstate.players.length = 0;
  gstate.nextEntityId = 1;

  const total = seekerCount + hiderCount;
  const spawns = pickSpawns(total);
  let idx = 0;

  for (let i = 0; i < seekerCount; i++) {
    const isHuman = role === 'seeker' && i < humanCount;
    const s = makeSeeker(spawns[idx++], isHuman, i === 0 ? 'p1' : 'p2');
    gstate.seekers.push(s);
    gstate.entities.push(s);
    if (isHuman) gstate.players.push(s);
  }
  for (let i = 0; i < hiderCount; i++) {
    const isHuman = role === 'hider' && i < humanCount;
    const h = makeHider(spawns[idx++], isHuman, i === 0 ? 'p1' : 'p2');
    gstate.hiders.push(h);
    gstate.entities.push(h);
    if (isHuman) gstate.players.push(h);
  }

  gstate.player = gstate.players[0] || gstate.entities[0] || null;
}
