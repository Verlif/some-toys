/**
 * 实体创建：搜捕者 / 躲藏者工厂 + 一局的开局布阵。
 */
import { SEEKER_R, HIDER_R, TILE } from '../core/config.js';
import { gstate } from '../core/state.js';
import { rand } from '../core/utils.js';
import { getOpenCells } from '../world/map.js';

/**
 * 随机挑选 n 个互相分散的出生点。
 * 先大间距筛一遍，再逐步放宽最小间距，最后兜底随机补足。
 */
function pickSpawns(n) {
  const cells = getOpenCells().slice();
  for (let i = cells.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = cells[i]; cells[i] = cells[j]; cells[j] = t;
  }
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
    chosen.push(cells[(Math.random() * cells.length) | 0]);
  }
  return chosen.map(c => ({ x: c.x * TILE + TILE / 2, y: c.y * TILE + TILE / 2 }));
}

/** 搜捕者实体 */
export function makeSeeker(spawn, isPlayer, controlScheme = 'p1') {
  return {
    id: gstate.nextEntityId++,
    type: 'seeker',
    x: spawn.x, y: spawn.y,
    r: SEEKER_R,
    isPlayer,
    controlScheme,
    alive: true,            // 搜捕者不会被淘汰，统一字段便于逻辑判断
    speedMode: 'walk',
    soundTimer: 0,
    noiseCooldownUntil: 0,
    catchCooldownUntil: 0,  // 抓到人后的抓捕冷却（只有搜捕者阵营能看到进度条）
    _px: spawn.x, _py: spawn.y,
    path: null, pathIdx: 0, repathTimer: 0, stuckCount: 0,
    goal: null,
    heardSound: null,       // 只记录敌对方（躲藏者）发出的声音
    spottedTarget: null,
    stuckTimer: 0,
    lastPathX: spawn.x,
    lastPathY: spawn.y,
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
      searchCursor: 0
    }
  };
}

/** 躲藏者实体 */
export function makeHider(spawn, isPlayer, controlScheme = 'p1') {
  return {
    id: gstate.nextEntityId++,
    type: 'hider',
    x: spawn.x, y: spawn.y,
    r: HIDER_R,
    isPlayer,
    controlScheme,
    alive: true,
    speedMode: 'walk',
    soundTimer: 0,
    noiseCooldownUntil: 0,
    _px: spawn.x, _py: spawn.y,
    path: null, pathIdx: 0, repathTimer: 0, stuckCount: 0,
    heardSound: null,       // 只记录搜捕者发出的声音
    ai: {
      state: 'hide',
      stateStart: 0,
      threatZones: [],      // 只由“搜捕者的声音 / 搜捕者命中自己”产生
      hideSpot: null,
      fleeTarget: null,
      restTimer: rand(1, 3),
      detectedBySeeker: 0,
      detectedBySeekerPos: null,
      lastNoise: 0,
      lastFleeFrom: null,
      quietTicks: 0,
      lastThreatPos: null,
      relocateTimer: rand(2.5, 5.0),
      dangerScore: 0
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
