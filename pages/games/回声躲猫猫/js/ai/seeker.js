/**
 * 搜捕者 AI —— 状态机（优先级从高到低）。
 *
 *   1. chase       声波探测到躲藏者后立刻前往命中点，持续约 4 秒
 *   2. search      失去目标后在最后位置周围撒搜索点逐一排查，并定期噪声扫描
 *   3. investigate 听到声音（延迟到达）后前往声源调查
 *   4. patrol      无目标时优先巡逻长时间未访问的格子
 *
 * 听到的声音只可能来自躲藏者：audio/sound.js 在写入 heardSound 前已做阵营过滤，
 * 所以搜捕者不会再去调查队友的噪声。追击 / 调查 / 搜索 / 巡逻统一快步移动，
 * 路径规划失败时不会原地停留。
 */
import {
  TILE, W, H, RUN_MUL, WALK_MUL, SEEKER_SPEED_MUL,
  NOISE_AI_MIN_INTERVAL, BASE_SPEED
} from '../core/config.js';
import { gstate } from '../core/state.js';
import { nowSec } from '../core/timer.js';
import { tx, ty, clamp } from '../core/utils.js';
import { computePathFor, followPath, generateSearchPoints } from '../world/pathfind.js';
import { moveEntity } from '../world/collision.js';
import { getOpenCells } from '../world/map.js';
import { tryEmitNoise } from '../audio/sound.js';

/** 选一个“很久没去过”的巡逻点：访问间隔越久分越高，距离越远分越低 */
export function pickPatrolTarget(e, nowT) {
  const list = getOpenCells();
  let best = null, bestScore = -Infinity;
  const ai = e.ai;
  for (let i = 0; i < 80; i++) {
    const c = list[(Math.random() * list.length) | 0];
    const key = `${c.x},${c.y}`;
    const lastVisit = ai.visitedCells.get(key) || 0;
    const sinceVisit = nowT - lastVisit;
    const wx = c.x * TILE + TILE / 2;
    const wy = c.y * TILE + TILE / 2;
    const d = Math.hypot(wx - e.x, wy - e.y);
    let score = Math.min(sinceVisit, 90) * 3.0;
    score -= d * 0.3;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

export function updateSeekerAI(e, dt) {
  const nowT = nowSec();
  const ai = e.ai;

  // 访问记忆：45 秒内去过的格子不再优先巡逻
  ai.visitedCells.set(`${tx(e.x)},${ty(e.y)}`, nowT);
  if (ai.visitedCells.size > 800) {
    for (const [k, t] of ai.visitedCells) {
      if (nowT - t > 45) ai.visitedCells.delete(k);
    }
  }

  const spotFresh = e.spottedTarget && nowT >= e.spottedTarget.arriveTime && nowT - e.spottedTarget.arriveTime < 5.5;
  const hearFresh = e.heardSound && nowT >= e.heardSound.arrivalTime && nowT - e.heardSound.emitTime < 6.5;

  if (spotFresh) {
    // 声波命中：带速度预判的追击
    if (ai.state !== 'chase') ai.state = 'chase';
    ai.stateStart = nowT;
    const liveTarget = e.spottedTarget.target;
    if (liveTarget && liveTarget.type === 'hider' && liveTarget.alive) {
      const lp = ai.lastTargetPos || { x: liveTarget.x, y: liveTarget.y };
      const vx = clamp((liveTarget.x - lp.x) / Math.max(0.05, nowT - (ai.lastTargetTime || nowT)), -220, 220);
      const vy = clamp((liveTarget.y - lp.y) / Math.max(0.05, nowT - (ai.lastTargetTime || nowT)), -220, 220);
      ai.targetVelocity.x = ai.targetVelocity.x * 0.45 + vx * 0.55;
      ai.targetVelocity.y = ai.targetVelocity.y * 0.45 + vy * 0.55;
      ai.lastTargetPos = { x: liveTarget.x, y: liveTarget.y };
      ai.lastTargetTime = nowT;
      const lead = clamp(Math.hypot(liveTarget.x - e.x, liveTarget.y - e.y) / 170, 0.35, 1.15);
      ai.target = {
        x: clamp(liveTarget.x + ai.targetVelocity.x * lead, TILE, W - TILE),
        y: clamp(liveTarget.y + ai.targetVelocity.y * lead, TILE, H - TILE)
      };
    } else {
      ai.target = { x: e.spottedTarget.x, y: e.spottedTarget.y };
    }
    ai.confidence = 1;
    ai.lastKnownHider = { x: ai.target.x, y: ai.target.y, time: nowT };
  } else if (ai.state === 'chase' && nowT - ai.stateStart < 4.0) {
    // 保持追击
  } else if (ai.state === 'chase' && ai.target) {
    // 追击超时 → 在最后位置周围搜索
    ai.state = 'search';
    ai.stateStart = nowT;
    ai.searchCenter = { x: ai.target.x, y: ai.target.y };
    ai.searchExpire = nowT + 11.0;
    ai.searchPoints = generateSearchPoints(ai.searchCenter.x, ai.searchCenter.y, 11)
      .sort((a, b) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y));
  } else if (hearFresh) {
    if (ai.state !== 'investigate' && ai.state !== 'chase') {
      ai.state = 'investigate';
      ai.stateStart = nowT;
    }
    ai.confidence = Math.max(ai.confidence * 0.7, e.heardSound.strength);
    ai.target = { x: e.heardSound.x, y: e.heardSound.y };
  } else if (ai.state === 'investigate' && nowT - ai.stateStart < 3.0 && ai.target) {
    // 继续调查
  } else if (ai.state === 'search' && nowT < ai.searchExpire && ai.searchPoints.some(p => !p.visited)) {
    // 继续搜索
  } else {
    ai.state = 'patrol';
  }

  let speedMode = 'walk';

  if (ai.state === 'chase') {
    e.goal = ai.target;
    speedMode = 'run';
    ai.repathFast = true;
  } else if (ai.state === 'investigate') {
    e.goal = ai.target;
    speedMode = 'run';
    ai.repathFast = true;
  } else if (ai.state === 'search') {
    // 搜索时定期噪声扫描
    if (nowT - ai.lastNoise > NOISE_AI_MIN_INTERVAL * 0.78) {
      if (tryEmitNoise(e)) ai.lastNoise = nowT;
    }
    let nextPoint = null;
    for (let si = 0; si < ai.searchPoints.length; si++) {
      const p = ai.searchPoints[(ai.searchCursor + si) % ai.searchPoints.length];
      if (!p.visited) { nextPoint = p; ai.searchCursor = (ai.searchCursor + si) % ai.searchPoints.length; break; }
    }
    if (!nextPoint) {
      ai.state = 'patrol';
    } else {
      const d = Math.hypot(nextPoint.x - e.x, nextPoint.y - e.y);
      if (d < 25) { nextPoint.visited = true; }
      else {
        e.goal = { x: nextPoint.x, y: nextPoint.y };
        speedMode = 'run';
        ai.repathFast = true;
      }
    }
  }

  if (ai.state === 'patrol') {
    const arrive = !ai.patrol ||
      Math.hypot(ai.patrol.x * TILE + TILE / 2 - e.x, ai.patrol.y * TILE + TILE / 2 - e.y) < 30;
    if (arrive) ai.patrol = pickPatrolTarget(e, nowT);
    if (ai.patrol) e.goal = { x: ai.patrol.x * TILE + TILE / 2, y: ai.patrol.y * TILE + TILE / 2 };
    speedMode = 'run';
    if (nowT - ai.lastNoise > NOISE_AI_MIN_INTERVAL * 1.35) {
      if (tryEmitNoise(e)) ai.lastNoise = nowT;
    }
  }

  e.speedMode = speedMode;
  e.repathTimer -= dt;

  const needRepath = !e.path || e.pathIdx >= e.path.length || e.repathTimer <= 0;
  if (needRepath && e.goal) {
    computePathFor(e, e.goal.x, e.goal.y);
    if (!e.path) {
      if (ai.state === 'patrol') {
        ai.patrol = null;
        e.repathTimer = 0.2;
      } else if (ai.state === 'search') {
        ai.searchPoints = ai.searchPoints.filter(p => !p.visited);
        e.repathTimer = 0.12;
      } else {
        // 追击 / 调查时路径暂时不可用，不退回巡逻，快速原地重算
        e.repathTimer = 0.10;
      }
    } else {
      // 追击时频繁重规划，目标移动后不会沿旧路线跑空
      e.repathTimer = ai.state === 'chase' ? 0.18 : (ai.repathFast ? 0.3 : 1.2);
    }
    ai.repathFast = false;
  }

  if (e.path) {
    const mul = (speedMode === 'run' ? RUN_MUL : WALK_MUL) * SEEKER_SPEED_MUL;
    const beforeX = e.x, beforeY = e.y;
    followPath(e, dt, mul);
    if (!e.path && (ai.state === 'chase' || ai.state === 'investigate')) {
      // 卡角落时先尝试一个切向脱困步，随后立刻重算路线
      const ox = e.x - (ai.target?.x ?? e.x);
      const oy = e.y - (ai.target?.y ?? e.y);
      const len = Math.hypot(ox, oy) || 1;
      moveEntity(e, (-oy / len) * BASE_SPEED * 0.35 * dt, (ox / len) * BASE_SPEED * 0.35 * dt);
      if (Math.hypot(e.x - beforeX, e.y - beforeY) < 0.05) e.repathTimer = 0;
      else e.repathTimer = 0.02;
    }
  }
}
