/**
 * 声波系统：射线投射 + 声波发射。
 *
 * 声波由多条射线组成，射线以 4px 步进检测，撞墙按法线反射（最多 MAX_BOUNCE 次），
 * 沿途碰到角色就记录命中点。命中会带来三类后果：
 *   1. 搜捕者声波命中躲藏者 → 该躲藏者 AI 标记“已被发现”
 *   2. 躲藏者声波命中搜捕者 → 该躲藏者 AI 在命中点留下威胁区
 *   3. 声音传播到附近角色     → 只有敌对阵营的接收方才会写入 heardSound
 *
 * ★ 关键：第 3 条必须做阵营判定。同一阵营（队友）的声音只会被“听见”，
 *   不会产生任何 AI 反应，否则躲藏者 AI 会对着队友的脚步逃跑。
 */
import {
  TILE, SOUND_SPEED, SOUND_INTERVAL, MAX_BOUNCE, MAX_SOUND_WAVES,
  WALK_SOUND_RADIUS, RUN_SOUND_RADIUS, NOISE_RADIUS,
  WALK_RAY_COUNT, RUN_RAY_COUNT, NOISE_RAY_MUL, NOISE_COOLDOWN,
  NOISE_AI_MIN_INTERVAL
} from '../core/config.js';
import { gstate } from '../core/state.js';
import { nowSec } from '../core/timer.js';
import { shouldReactToSound } from '../ai/reaction.js';
import { bumpStat } from '../game/stats.js';

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
          target: entityHit
        });

        // 搜捕者的声波锁定躲藏者
        if (emitter.type === 'seeker' && entityHit.type === 'hider' && entityHit.ai) {
          entityHit.ai.detectedBySeeker = nowT;
          entityHit.ai.detectedBySeekerPos = { x: emitter.x, y: emitter.y };
        }
        // 躲藏者的声波扫到搜捕者：在搜捕者所在位置留下威胁区（而不是射线上的擦碰点）
        if (emitter.type === 'hider' && entityHit.type === 'seeker' && emitter.ai) {
          const threatX = entityHit.x, threatY = entityHit.y;
          const existing = emitter.ai.threatZones.find(
            t => Math.hypot(t.x - threatX, t.y - threatY) < 60
          );
          if (existing) {
            existing.time = nowT;
            existing.intensity = Math.max(existing.intensity, 1.5);
          } else {
            emitter.ai.threatZones.push({
              x: threatX, y: threatY, time: nowT, intensity: 1.5
            });
          }
        }

        // 统计：与玩家相关的探测
        if (emitter.isPlayer && !entityHit.isPlayer) bumpStat('playerDetectedEnemy');
        if (entityHit.isPlayer && !emitter.isPlayer) bumpStat('playerDetectedByEnemy');

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

/**
 * 发射一次声波。
 * @param {object} e 发射者实体
 * @param {boolean} isNoise 是否为主动噪声
 */
export function emitSound(e, isNoise = false) {
  const isRun = (e.speedMode === 'run') && !isNoise;
  const maxRadius = isNoise ? NOISE_RADIUS : (isRun ? RUN_SOUND_RADIUS : WALK_SOUND_RADIUS);
  const strength = isNoise ? 1.4 : (isRun ? 1.0 : 0.5);

  let rayCount;
  if (isNoise) rayCount = RUN_RAY_COUNT * NOISE_RAY_MUL;
  else if (isRun) rayCount = RUN_RAY_COUNT;
  else rayCount = WALK_RAY_COUNT;

  const rays = [];
  const rawHits = [];
  const wallHits = [];
  const angleOffset = Math.random() * Math.PI * 2 / rayCount;

  for (let i = 0; i < rayCount; i++) {
    const angle = (i / rayCount) * Math.PI * 2 + angleOffset;
    const path = castRay(e.x, e.y, angle, maxRadius, MAX_BOUNCE, e, rawHits, wallHits);
    if (path.length > 1) rays.push(path);
  }

  // 同一目标只保留最近的一次命中，避免闪烁叠成一团
  const hitMap = new Map();
  for (const h of rawHits) {
    const key = h.target;
    if (!hitMap.has(key) || h.dist < hitMap.get(key).dist) hitMap.set(key, h);
  }
  const hits = Array.from(hitMap.values());
  const nowT = nowSec();

  gstate.soundWaves.push({
    x: e.x, y: e.y,
    maxRadius, strength, age: 0,
    rays, hits, emitTime: nowT,
    emitter: e
  });

  // 墙壁记忆：以 emitterId 区分，只有发射者本人能看到自己点亮的墙
  for (const wh of wallHits) {
    const key = `${e.id},${wh.gx},${wh.gy}`;
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
        emitterId: e.id,
        gx: wh.gx, gy: wh.gy,
        arrivals: [arrivalTime],
        strength
      });
    }
  }

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
}

/** 尝试发出主动噪声，冷却中返回 false */
export function tryEmitNoise(e) {
  const nowT = nowSec();
  const cooldown = e.isPlayer ? NOISE_COOLDOWN : NOISE_AI_MIN_INTERVAL;
  if (e.noiseCooldownUntil && nowT < e.noiseCooldownUntil) return false;
  e.noiseCooldownUntil = nowT + cooldown;
  if (e.isPlayer) bumpStat('playerNoiseCount');
  emitSound(e, true);
  return true;
}

/**
 * 移动发声：所有会动的角色每隔 SOUND_INTERVAL 自动发出一次脚步/奔跑声波。
 *
 * 注意：声波照常发射（队友也能“看到”声波），但 emitSound 内部已经过滤掉
 * 同阵营的 AI 反应，所以躲藏者对着队友跑步不会再触发队友逃跑。
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
