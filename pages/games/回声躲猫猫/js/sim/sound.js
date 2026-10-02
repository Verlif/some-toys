/**
 * 声波系统：射线投射 + 声波发射。
 *
 * 声波由多条射线组成，射线以 4px 步进检测，撞墙按法线反射（最多 MAX_BOUNCE 次），
 * 沿途碰到角色就记录命中点。命中会带来三类后果：
 *   1. 搜捕者声波命中躲藏者 → 该躲藏者 AI 标记“已被发现”
 *   2. 躲藏者声波命中搜捕者 → 该躲藏者 AI 在命中点留下威胁区
 *   3. 声音传播到附近角色     → 只有敌对阵营的接收方才会写入 heardSound
 *
 * ★ 关键：第 3 条必须做阵营判定（core/teams.js）。
 *   同一阵营（队友）的声音只会被“听见”，不会产生任何 AI 反应，
 *   否则躲藏者 AI 会对着队友的脚步逃跑。
 *
 * ★ 联机友好：
 *   一次发声只广播**一条很短的描述**（谁、在哪、多大、射线角度偏移），
 *   客户端用同一张地图与同一个偏移量在本地重建射线 —— 带宽不用传整棵射线树。
 *   见 emitSound() 末尾的 EVT.SOUND_EMITTED 与 rebuildSoundFromEvent()。
 */
import {
  TILE, SOUND_SPEED, SOUND_INTERVAL, MAX_BOUNCE, MAX_SOUND_WAVES,
  WALK_SOUND_RADIUS, RUN_SOUND_RADIUS, NOISE_RADIUS,
  WALK_RAY_COUNT, RUN_RAY_COUNT, NOISE_RAY_MUL, NOISE_COOLDOWN,
  NOISE_AI_MIN_INTERVAL
} from '../core/config.js';
import { gstate } from '../core/state.js';
import { nowSec } from '../core/timer.js';
import { rng } from '../core/rng.js';
import { emit, EVT } from '../core/events.js';
import { shouldReactToSound } from '../core/teams.js';
import { bumpStat } from './stats.js';

/* ============================================================
   射线投射
   ============================================================ */

/**
 * 从 (sx,sy) 沿 angle 投射一条射线。
 * @returns {{x:number,y:number,dist:number}[]} 折线顶点（含起点），dist 为累计传播距离
 */
export function castRay(sx, sy, angle, maxDist, maxBounce, emitter, entityHits, wallHits) {
  const path = [{ x: sx, y: sy, dist: 0 }];
  let cx = sx, cy = sy;
  let dx = Math.cos(angle), dy = Math.sin(angle);
  let totalDist = 0;
  let bounces = 0;
  const nowT = nowSec();
  const COLS = gstate.grid[0].length, ROWS = gstate.grid.length;

  while (totalDist < maxDist && bounces <= maxBounce) {
    const remain = maxDist - totalDist;
    const step = 4;
    let hit = false;
    let hitX = 0, hitY = 0, hitNormal = null;
    let entityHit = null;
    let hitCell = null;

    for (let d = step; d <= remain; d += step) {
      const nx = cx + dx * d;
      const ny = cy + dy * d;
      const gx = Math.floor(nx / TILE);
      const gy = Math.floor(ny / TILE);
      if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) break;

      let foundEntity = null;
      for (const other of gstate.entities) {
        if (other === emitter) continue;
        if (other.type === 'hider' && !other.alive) continue;
        const odx = nx - other.x, ody = ny - other.y;
        if (odx * odx + ody * ody < other.r * other.r) {
          foundEntity = other;
          break;
        }
      }
      if (foundEntity) {
        hit = true;
        hitX = nx; hitY = ny;
        entityHit = foundEntity;
        break;
      }

      if (gstate.grid[gy][gx] === 1) {
        const prevD = Math.max(0, d - step);
        const px = cx + dx * prevD;
        const py = cy + dy * prevD;
        const cellX = gx * TILE, cellY = gy * TILE;
        const relX = (nx - cellX) / TILE;
        const relY = (ny - cellY) / TILE;
        if (relX < 0.2) hitNormal = { x: -1, y: 0 };
        else if (relX > 0.8) hitNormal = { x: 1, y: 0 };
        else if (relY < 0.2) hitNormal = { x: 0, y: -1 };
        else if (relY > 0.8) hitNormal = { x: 0, y: 1 };
        else hitNormal = { x: -dx, y: -dy };
        hitX = px; hitY = py;
        hitCell = { gx, gy };
        hit = true;
        break;
      }
    }

    if (!hit) {
      const endX = cx + dx * remain;
      const endY = cy + dy * remain;
      path.push({ x: endX, y: endY, dist: totalDist + remain });
      break;
    } else {
      const segLen = Math.hypot(hitX - cx, hitY - cy);
      const hitDist = totalDist + segLen;
      path.push({ x: hitX, y: hitY, dist: hitDist });
      totalDist = hitDist;

      if (entityHit) {
        entityHits.push({
          x: hitX, y: hitY, dist: hitDist,
          emitter: emitter,
          target: entityHit,
          hitTime: nowT
        });
        break;
      }

      if (wallHits && hitCell) {
        wallHits.push({ gx: hitCell.gx, gy: hitCell.gy, dist: hitDist });
      }

      // 镜面反射
      const dot = dx * hitNormal.x + dy * hitNormal.y;
      dx = dx - 2 * dot * hitNormal.x;
      dy = dy - 2 * dot * hitNormal.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) break;
      dx /= len; dy /= len;
      cx = hitX; cy = hitY;
      bounces++;
    }
  }
  return path;
}

/** 一次发声的参数（半径 / 强度 / 射线数） */
function soundParams(isNoise, isRun) {
  const maxRadius = isNoise ? NOISE_RADIUS : (isRun ? RUN_SOUND_RADIUS : WALK_SOUND_RADIUS);
  const strength = isNoise ? 1.4 : (isRun ? 1.0 : 0.5);
  let rayCount;
  if (isNoise) rayCount = RUN_RAY_COUNT * NOISE_RAY_MUL;
  else if (isRun) rayCount = RUN_RAY_COUNT;
  else rayCount = WALK_RAY_COUNT;
  return { maxRadius, strength, rayCount };
}

/**
 * 只做几何：从 (ox,oy) 投射一圈射线，返回射线与命中。
 * 模拟与“客户端重建声波”共用这一份实现，保证两端画出来一样。
 */
function castSound({ ox, oy, emitter, isNoise, isRun, angleOffset, rayCount, maxRadius }) {
  const rays = [];
  const rawHits = [];
  const wallHits = [];
  for (let i = 0; i < rayCount; i++) {
    const angle = (i / rayCount) * Math.PI * 2 + angleOffset;
    const path = castRay(ox, oy, angle, maxRadius, MAX_BOUNCE, emitter, rawHits, wallHits);
    if (path.length > 1) rays.push(path);
  }
  // 同一目标只保留最近的一次命中，避免闪烁叠成一团
  const hitMap = new Map();
  for (const h of rawHits) {
    const key = h.target;
    if (!hitMap.has(key) || h.dist < hitMap.get(key).dist) hitMap.set(key, h);
  }
  return { rays, hits: Array.from(hitMap.values()), wallHits };
}

/** 墙壁记忆写入（模拟与客户端重建共用） */
function rememberWalls(emitterId, wallHits, strength, nowT) {
  for (const wh of wallHits) {
    const key = `${emitterId},${wh.gx},${wh.gy}`;
    const arrivalTime = nowT + wh.dist / SOUND_SPEED;
    const existing = gstate.wallMemoryMap.get(key);
    if (existing) {
      existing.arrivals.push(arrivalTime);
      if (existing.arrivals.length > 12) {
        existing.arrivals.splice(0, existing.arrivals.length - 12);
      }
      existing.strength = Math.max(existing.strength, strength);
    } else {
      gstate.wallMemoryMap.set(key, {
        emitterId,
        gx: wh.gx, gy: wh.gy,
        arrivals: [arrivalTime],
        strength
      });
    }
  }
}

/* ============================================================
   发声
   ============================================================ */

/**
 * 发射一次声波。
 * @param {object} e 发射者实体
 * @param {boolean} isNoise 是否为主动噪声
 * @param {object} [opts] opts.silentStat 不统计；opts.noEvent 不广播事件（客户端重建时用）
 */
export function emitSound(e, isNoise = false, opts = {}) {
  const isRun = (e.speedMode === 'run') && !isNoise;
  const { maxRadius, strength, rayCount } = soundParams(isNoise, isRun);
  const angleOffset = rng() * Math.PI * 2 / rayCount;

  const { rays, hits, wallHits } = castSound({
    ox: e.x, oy: e.y, emitter: e, isNoise, isRun, angleOffset, rayCount, maxRadius
  });
  const nowT = nowSec();

  gstate.soundWaves.push({
    x: e.x, y: e.y,
    maxRadius, strength, age: 0,
    rays, hits, emitTime: nowT,
    emitter: e,
    angleOffset, isNoise, isRun
  });

  rememberWalls(e.id, wallHits, strength, nowT);

  // 搜捕者 AI：声波扫到躲藏者时记录命中点，到达后才开始追击
  if (e.type === 'seeker' && !e.isPlayer) {
    let nearest = null;
    for (const h of hits) {
      if (h.target.type === 'hider' && h.target.alive) {
        if (!nearest || h.dist < nearest.dist) nearest = h;
      }
    }
    if (nearest) {
      e.spottedTarget = {
        x: nearest.target.x, y: nearest.target.y,
        target: nearest.target,
        arriveTime: nowT + nearest.dist / SOUND_SPEED
      };
    }
  }

  if (gstate.soundWaves.length > MAX_SOUND_WAVES) {
    gstate.soundWaves.splice(0, gstate.soundWaves.length - MAX_SOUND_WAVES);
  }

  // 可听范围：只有敌对阵营才会写入 heardSound（队友的声音一律忽略）
  for (const other of gstate.entities) {
    if (other === e) continue;
    if (!shouldReactToSound(other, e)) continue;
    const dist = Math.hypot(other.x - e.x, other.y - e.y);
    if (dist < maxRadius * 1.15) {
      other.heardSound = {
        x: e.x, y: e.y,
        strength,
        emitTime: nowT,
        arrivalTime: nowT + dist / SOUND_SPEED
      };
    }
  }

  // 广播给网络层：一条极短的消息就够客户端本地重建出同样的声波
  if (!opts.noEvent) {
    emit(EVT.SOUND_EMITTED, {
      emitterId: e.id,
      emitterType: e.type,
      x: e.x, y: e.y,
      isNoise, isRun, angleOffset, rayCount,
      maxRadius, strength,
      speedMode: e.speedMode
    });
  }
}

/**
 * 客户端侧：用房主广播的发声描述在本地重建声波。
 * 只影响画面（射线 / 墙壁记忆 / 命中闪烁），不改 AI 状态——
 * AI 的状态由房主的快照说了算。
 */
export function rebuildSoundFromEvent(payload) {
  if (!payload) return null;
  const emitter = gstate.entities.find(x => x.id === payload.emitterId) || null;
  // 发射者已不在本地（例如刚加入）：用一个临时壳做几何计算，仅用于画线
  const shell = emitter || {
    id: payload.emitterId,
    type: payload.emitterType || 'hider',
    x: payload.x, y: payload.y,
    r: 0
  };
  const isRun = payload.isRun;
  const rayCount = payload.rayCount || soundParams(!!payload.isNoise, isRun).rayCount;
  const maxRadius = payload.maxRadius || soundParams(!!payload.isNoise, isRun).maxRadius;
  const strength = payload.strength ?? 0.5;

  const { rays, hits, wallHits } = castSound({
    ox: payload.x, oy: payload.y, emitter: shell,
    isNoise: !!payload.isNoise, isRun, angleOffset: payload.angleOffset || 0,
    rayCount, maxRadius
  });
  const nowT = nowSec();
  gstate.soundWaves.push({
    x: payload.x, y: payload.y,
    maxRadius, strength, age: 0,
    rays, hits, emitTime: nowT,
    emitter: shell,
    angleOffset: payload.angleOffset || 0,
    isNoise: !!payload.isNoise, isRun
  });
  rememberWalls(payload.emitterId, wallHits, strength, nowT);

  if (gstate.soundWaves.length > MAX_SOUND_WAVES) {
    gstate.soundWaves.splice(0, gstate.soundWaves.length - MAX_SOUND_WAVES);
  }
  return { rays, hits };
}

/** 尝试发出主动噪声，冷却中返回 false */
export function tryEmitNoise(e, opts = {}) {
  const nowT = nowSec();
  const cooldown = e.isPlayer ? NOISE_COOLDOWN : NOISE_AI_MIN_INTERVAL;
  if (e.noiseCooldownUntil && nowT < e.noiseCooldownUntil) return false;
  e.noiseCooldownUntil = nowT + cooldown;
  if (e.isPlayer && !opts.silentStat) bumpStat('playerNoiseCount');
  emitSound(e, true, opts);
  return true;
}

/**
 * 道具效果：让某个角色**无视冷却**立刻发出一次噪声。
 * 这是“喧嚣之铃”的核心，所以不能走 tryEmitNoise（会被冷却挡住）。
 */
export function forceNoise(e) {
  e.noiseCooldownUntil = nowSec() + (e.isPlayer ? NOISE_COOLDOWN : NOISE_AI_MIN_INTERVAL);
  emitSound(e, true, { silentStat: true });
}

/**
 * 移动发声：所有会动的角色每隔 SOUND_INTERVAL 自动发出一次脚步/奔跑声波。
 */
export function updateMovementSounds(dt) {
  for (const e of gstate.entities) {
    if (e.type === 'hider' && !e.alive) continue;
    if (e.isPlayer && gstate.spectator) { e._px = e.x; e._py = e.y; continue; }

    const moved = Math.hypot(e.x - e._px, e.y - e._py);
    e._px = e.x; e._py = e.y;
    if (moved > 0.15) {
      e.soundTimer -= dt;
      if (e.soundTimer <= 0) {
        if (e.isPlayer) bumpStat('playerSoundCount');
        emitSound(e);
        e.soundTimer = SOUND_INTERVAL;
      }
    } else {
      e.soundTimer = 0;
    }
  }
}

/** 推进所有声波的年龄，超出最大半径的移除 */
export function updateSoundWaves(dt) {
  for (let i = gstate.soundWaves.length - 1; i >= 0; i--) {
    const w = gstate.soundWaves[i];
    w.age += dt;
    if (w.age * SOUND_SPEED >= w.maxRadius) gstate.soundWaves.splice(i, 1);
  }
}
