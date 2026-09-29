/**
 * 躲藏者 AI —— 威胁地图 + 三种状态。
 *
 *   flee   被声波直接探测到，或威胁贴脸 → 朝远离威胁的方向逃跑
 *   hide   安全时挑选藏身点，静步移动并定期换位置
 *   frozen 完全静止、不发声（预留状态，当前策略更偏向“静默换位”）
 *
 * ★ 阵营过滤：威胁区只可能来自搜捕者。
 *   - ai/threat 的来源一：ai.reaction 允许 heardSound 的情况下听到搜捕者声音
 *   - 来源二：自己发出的声波扫到搜捕者（audio/sound.js 写入 threatZones）
 *   队友（其他躲藏者）的脚步与噪声不会再被写入 heardSound / threatZones，
 *   因此躲藏者不会因为队友跑动而逃跑。
 */
import { TILE, RUN_MUL, WALK_MUL, PROXIMITY_DETECT, DETECT_RANGE } from '../core/config.js';
import { gstate } from '../core/state.js';
import { nowSec } from '../core/timer.js';
import { tx, ty, rand, clamp } from '../core/utils.js';
import { computePathFor, followPath, cellQuality } from '../world/pathfind.js';
import { getOpenCells } from '../world/map.js';
import { nearestVisibleEnemy } from '../render/vision.js';

/** 藏身点评分：远离威胁与追捕者、靠近墙壁、出口 2~3 个最优、远离队友 */
function scoreHideSpot(x, y, e, nowT) {
  let score = 0;
  let minThreatDist = 800;
  for (const t of e.ai.threatZones) {
    const d = Math.hypot(x - t.x, y - t.y);
    if (d < minThreatDist) minThreatDist = d;
  }
  score += Math.min(minThreatDist, 600) * 1.4;

  // 追捕者只作为“软”参考：躲藏者不会凭空知道追捕者位置，但记忆里的位置会影响评分
  for (const s of gstate.seekers) {
    const d = Math.hypot(x - s.x, y - s.y);
    score += Math.min(d, 500) * 0.8;
  }

  let wallCount = 0;
  const cgx = tx(x), cgy = ty(y);
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      const gx = cgx + dx, gy = cgy + dy;
      if (gx < 0 || gy < 0 || gx >= gstate.grid[0].length || gy >= gstate.grid.length) continue;
      if (gstate.grid[gy][gx] === 1) wallCount++;
    }
  }
  score += wallCount * 5;

  const q = cellQuality(gstate.grid, cgx, cgy);
  if (q === 2 || q === 3) score += 40;
  else if (q === 1) score -= 50;
  else if (q === 4) score -= 15;

  for (const other of gstate.hiders) {
    if (other === e || !other.alive) continue;
    const d = Math.hypot(x - other.x, y - other.y);
    if (d < 220) score -= (220 - d) * 1.2;
  }

  const dSelf = Math.hypot(x - e.x, y - e.y);
  score -= dSelf * 0.6;
  return score;
}

/** 采样若干空地，挑一个最安全的藏身点 */
function pickHideSpot(e, nowT) {
  const list = getOpenCells();
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < 90; i++) {
    const c = list[(Math.random() * list.length) | 0];
    const wx = c.x * TILE + TILE / 2;
    const wy = c.y * TILE + TILE / 2;
    const score = scoreHideSpot(wx, wy, e, nowT)
      + (Math.hypot(wx - (e.ai.lastThreatPos?.x ?? wx), wy - (e.ai.lastThreatPos?.y ?? wy)) > 180 ? 18 : 0);
    if (score > bestScore) { bestScore = score; best = { x: wx, y: wy }; }
  }
  return best;
}

/**
 * 逃跑点评估：采样 60 个候选位置，综合
 * 方向契合度 / 与威胁的距离 / 与追捕者的距离 / 路口质量 / 队友距离 / 自身路程。
 */
function chooseFleePoint(e, threatX, threatY) {
  const list = getOpenCells();
  let best = null, bestScore = -Infinity;

  const ax = e.x - threatX, ay = e.y - threatY;
  const alen = Math.hypot(ax, ay) || 1;
  const fleeDirX = ax / alen, fleeDirY = ay / alen;

  for (let i = 0; i < 60; i++) {
    const c = list[(Math.random() * list.length) | 0];
    const wx = c.x * TILE + TILE / 2;
    const wy = c.y * TILE + TILE / 2;

    const dx = wx - e.x, dy = wy - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const dirX = dx / dist, dirY = dy / dist;

    const dotFlee = dirX * fleeDirX + dirY * fleeDirY;
    const toThreat = Math.hypot(wx - threatX, wy - threatY);

    let minSeekerDist = Infinity;
    for (const s of gstate.seekers) {
      const d = Math.hypot(wx - s.x, wy - s.y);
      if (d < minSeekerDist) minSeekerDist = d;
    }

    const q = cellQuality(gstate.grid, tx(wx), ty(wy));

    let score = 0;
    score += dotFlee * 180;
    score += Math.min(toThreat, 600) * 1.5;
    score += Math.min(minSeekerDist, 500) * 1.0;
    if (q >= 3) score += 50;
    else if (q === 1) score -= 80;
    score -= dist * 0.25;

    for (const other of gstate.hiders) {
      if (other === e || !other.alive) continue;
      const d = Math.hypot(wx - other.x, wy - other.y);
      if (d < 120) score -= (120 - d) * 2;
    }

    if (score > bestScore) { bestScore = score; best = { x: wx, y: wy }; }
  }
  return best || { x: e.x, y: e.y };
}

export function updateHiderAI(e, dt) {
  const nowT = nowSec();
  const ai = e.ai;

  // 1) 把“听到的声音”写进威胁地图（heardSound 只可能来自搜捕者）
  if (e.heardSound && nowT - e.heardSound.emitTime < 6.0) {
    const existing = ai.threatZones.find(t => Math.hypot(t.x - e.heardSound.x, t.y - e.heardSound.y) < 50);
    if (existing) {
      existing.time = nowT;
      existing.intensity = Math.max(existing.intensity, e.heardSound.strength);
    } else {
      ai.threatZones.push({ x: e.heardSound.x, y: e.heardSound.y, time: nowT, intensity: e.heardSound.strength });
    }
  }
  ai.threatZones = ai.threatZones.filter(t => nowT - t.time < 12.0);
  if (ai.threatZones.length > 20) ai.threatZones.splice(0, ai.threatZones.length - 20);

  ai.relocateTimer -= dt;

  // 2) 最近的搜捕者
  let nearbySeeker = null, nearbySeekerDist = Infinity;
  for (const s of gstate.seekers) {
    const d = Math.hypot(s.x - e.x, s.y - e.y);
    if (d < nearbySeekerDist) { nearbySeekerDist = d; nearbySeeker = s; }
  }
  ai.dangerScore = nearbySeeker ? clamp(1 - nearbySeekerDist / 420, 0, 1) : 0;
  if (nearbySeeker && nearbySeekerDist < 300) ai.lastThreatPos = { x: nearbySeeker.x, y: nearbySeeker.y };

  // 2.5) 近距离照面：互相显形的那一刻就当自己被看见了 → 立刻逃
  //      （否则玩家能看见搜捕者、AI 却还在原地发呆）
  if (PROXIMITY_DETECT) {
    const seen = nearestVisibleEnemy(e, DETECT_RANGE);
    if (seen) {
      ai.detectedBySeeker = nowT;
      ai.detectedBySeekerPos = { x: seen.x, y: seen.y };
      nearbySeeker = seen;
      nearbySeekerDist = Math.hypot(seen.x - e.x, seen.y - e.y);
      ai.lastThreatPos = { x: seen.x, y: seen.y };
    }
  }

  // 3) 被搜捕者声波直接探测到 → 立即逃跑
  if (ai.detectedBySeeker && nowT - ai.detectedBySeeker < 2.0) {
    const tx0 = ai.detectedBySeekerPos?.x || e.x;
    const ty0 = ai.detectedBySeekerPos?.y || e.y;
    ai.state = 'flee';
    ai.fleeTarget = chooseFleePoint(e, tx0, ty0);
    ai.lastThreatPos = { x: tx0, y: ty0 };
    ai.stateStart = nowT;
    ai.lastFleeFrom = { x: tx0, y: ty0 };
    e.path = null;
    ai.detectedBySeeker = 0;
  }

  let nearestThreat = null, nearestDist = Infinity;
  for (const t of ai.threatZones) {
    const d = Math.hypot(t.x - e.x, t.y - e.y);
    if (d < nearestDist) { nearestDist = d; nearestThreat = t; }
  }

  if (ai.state !== 'flee') {
    if ((nearbySeeker && nearbySeekerDist < 150) || (nearestThreat && nearestDist < 200)) {
      // 贴脸威胁 → 逃跑
      // 注意：威胁可能只来自“看见的搜捕者”而威胁区为空，这里统一用 tx0/ty0
      ai.state = 'flee';
      const fleeFromSeeker = nearbySeeker && nearbySeekerDist < 150;
      const tx0 = fleeFromSeeker ? nearbySeeker.x : nearestThreat.x;
      const ty0 = fleeFromSeeker ? nearbySeeker.y : nearestThreat.y;
      ai.fleeTarget = chooseFleePoint(e, tx0, ty0);
      ai.stateStart = nowT;
      ai.lastFleeFrom = { x: tx0, y: ty0 };
      ai.lastThreatPos = { x: tx0, y: ty0 };
      e.path = null;
    } else if ((nearbySeeker && nearbySeekerDist < 420) || (nearestThreat && nearestDist < 390)) {
      // 中距离威胁不再原地“冻住”，而是静默换到更安全的躲藏点
      if (!e.path || e.pathIdx >= e.path.length) {
        const tx0 = nearbySeeker ? nearbySeeker.x : nearestThreat.x;
        const ty0 = nearbySeeker ? nearbySeeker.y : nearestThreat.y;
        const safer = chooseFleePoint(e, tx0, ty0);
        ai.hideSpot = safer;
        ai.lastThreatPos = { x: tx0, y: ty0 };
        ai.state = 'hide';
        ai.stateStart = nowT;
        ai.restTimer = 0;
        ai.relocateTimer = rand(1.5, 3.0);
        e.path = null;
      }
    } else {
      if (ai.state === 'frozen' || ai.state === 'flee') {
        const recent = ai.threatZones.find(t => nowT - t.time < 3.0);
        if (!recent) {
          ai.state = 'hide';
          ai.restTimer = 1.0;
          e.path = null;
        }
      } else if (ai.state !== 'hide') {
        ai.state = 'hide';
      }
    }
  }

  // 4) 逃跑
  if (ai.state === 'flee') {
    const newThreat = nearestThreat && (nowT - nearestThreat.time < 1.5) && nearestDist < 200;
    const tooLong = nowT - ai.stateStart > 5.5;
    const noTarget = !ai.fleeTarget;

    if (tooLong || noTarget) {
      ai.state = 'hide';
      ai.restTimer = 0.6;
      e.path = null;
      return;
    }
    if (newThreat || (nearbySeeker && nearbySeekerDist < 230)) {
      // 威胁换位置 → 立即重算逃跑方向
      const tx0 = nearbySeeker && nearbySeekerDist < 230 ? nearbySeeker.x : nearestThreat.x;
      const ty0 = nearbySeeker && nearbySeekerDist < 230 ? nearbySeeker.y : nearestThreat.y;
      ai.fleeTarget = chooseFleePoint(e, tx0, ty0);
      ai.lastThreatPos = { x: tx0, y: ty0 };
      ai.stateStart = nowT;
      e.path = null;
    }
    e.speedMode = 'run';
    e.repathTimer -= dt;
    if (!e.path || e.pathIdx >= e.path.length || e.repathTimer <= 0) {
      computePathFor(e, ai.fleeTarget.x, ai.fleeTarget.y);
      if (!e.path) {
        ai.state = 'hide';
        ai.restTimer = 0.5;
        e.path = null;
        return;
      }
      e.repathTimer = 0.38;
    }
    followPath(e, dt, RUN_MUL * 1.03);
    if (ai.relocateTimer <= 0 && nearbySeeker && nearbySeekerDist > 180) {
      ai.state = 'hide';
      ai.restTimer = 0.15;
      ai.relocateTimer = rand(2.0, 4.0);
      e.path = null;
    }
    return;
  }

  // 5) 冻结：完全静止（不移动就不会发声）
  if (ai.state === 'frozen') {
    e.speedMode = 'walk';
    return;
  }

  // 6) 隐藏：静步走向藏身点，休息后再换一个
  if (ai.state === 'hide') {
    if (nearbySeeker && nearbySeekerDist < 155) {
      ai.state = 'flee';
      ai.fleeTarget = chooseFleePoint(e, nearbySeeker.x, nearbySeeker.y);
      ai.lastThreatPos = { x: nearbySeeker.x, y: nearbySeeker.y };
      ai.stateStart = nowT;
      ai.relocateTimer = rand(2.0, 4.0);
      e.path = null;
      return;
    }
    if (ai.relocateTimer <= 0 && nearbySeekerDist > 220) {
      // 休息够了，重新选点保持动态隐蔽
      ai.restTimer = 0;
      ai.relocateTimer = rand(2.2, 4.2);
    }
    const arrived = !e.path || e.pathIdx >= e.path.length;
    if (arrived) {
      ai.restTimer -= dt;
      e.speedMode = 'walk';
      if (ai.restTimer <= 0) {
        const newSpot = pickHideSpot(e, nowT);
        if (newSpot) {
          ai.hideSpot = newSpot;
          computePathFor(e, newSpot.x, newSpot.y);
          if (!e.path) {
            ai.restTimer = 0.6;
          } else {
            ai.restTimer = (nearbySeekerDist < 280) ? 0.35 : (1.8 + Math.random() * 2.8);
          }
        } else {
          ai.restTimer = 1.0;
        }
      }
    } else {
      e.speedMode = 'walk';
      followPath(e, dt, WALK_MUL);
    }
  }
}
