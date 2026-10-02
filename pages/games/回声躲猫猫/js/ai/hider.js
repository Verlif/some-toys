/**
 * 躲藏者 AI —— 威胁地图 + 三种状态。
 *
 *   flee   被声波直接探测到，或威胁贴脸 → 朝远离威胁的方向逃跑
 *   hide   安全时挑选藏身点，静步移动并定期换位置
 *   frozen 完全静止、不发声（预留状态，当前策略更偏向“静默换位”）
 *
 * ★ 阵营过滤：威胁区只可能来自搜捕者（见 core/teams.js 与 sim/sound.js）。
 *
 * ★ 防“原地打转 / 左右晃”（旧实现的主要问题）：
 *   · 逃跑点**限流重算**：旧代码在「搜捕者 230px 内」时每帧都重抽一次逃跑点
 *     并清空路径，方向因此每帧翻转，看起来就是原地左右抖；
 *     现在最短 FLEE_REPLAN_INTERVAL 秒才重算一次，且威胁移动超过阈值才提前重算。
 *   · 换藏身点限流：旧代码在搜捕者 280px 内时几乎每 0.35 秒换一个点，
 *     于是来回踱步；现在换点有最短间隔，并要求新点离当前位置有一定距离。
 *   · 移动统一走 sim/navigation + sim/movement（贴墙滑动 + 反向锁）。
 */
import { TILE, PROXIMITY_DETECT, DETECT_RANGE, FLEE_REPLAN_INTERVAL, FLEE_REPLAN_THREAT_MOVE } from '../core/config.js';
import { gstate } from '../core/state.js';
import { nowSec } from '../core/timer.js';
import { tx, ty, clamp } from '../core/utils.js';
import { randRange } from '../core/rng.js';
import { isFrozen } from '../core/status.js';
import { computePathFor, cellQuality } from '../world/pathfind.js';
import { followPath, resetNavigation, hasPath, setGoal } from '../sim/navigation.js';
import { getOpenCells } from '../world/map.js';
import { nearestItemTo } from '../world/items.js';
import { nearestVisibleEnemy } from '../core/vision.js';

/** 换藏身点的最短间隔（秒） */
const HIDE_REPLAN_MIN = 1.4;
/** 新藏身点至少要离当前位置这么远，避免原地来回挪（px） */
const HIDE_MIN_MOVE = TILE * 2;
/** 藏身状态下顺手捡道具的最大距离（px） */
const ITEM_SEEK_RANGE = 260;
/** 道具目标的保持时间（秒） */
const ITEM_TARGET_HOLD = 6;

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
  // 太近的点不再考虑：否则“换藏身点”会变成原地来回挪
  if (dSelf < HIDE_MIN_MOVE) score -= 260;
  // 轻微惩罚“往回走”的目标：刚走两步就掉头换点看起来像原地打转
  const heading = e.lastMoveDir;
  if (heading && dSelf > 1) {
    const dot = ((x - e.x) * heading.x + (y - e.y) * heading.y) / dSelf;
    if (dot < 0) score -= 70 * (-dot);
  }
  return score;
}

/** 采样若干空地，挑一个最安全的藏身点 */
function pickHideSpot(e, nowT) {
  const list = getOpenCells();
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < 90; i++) {
    const c = list[(randRange(0, list.length)) | 0];
    const wx = c.x * TILE + TILE / 2;
    const wy = c.y * TILE + TILE / 2;
    const score = scoreHideSpot(wx, wy, e, nowT)
      + (Math.hypot(wx - (e.ai.lastThreatPos?.x ?? wx), wy - (e.ai.lastThreatPos?.y ?? wy)) > 180 ? 18 : 0);
    if (score > bestScore) { bestScore = score; best = { x: wx, y: wy }; }
  }
  return best;
}

/** 设目标并（必要时）立刻算路：目标换了就作废旧路点，避免走完旧路再掉头 */
function goTo(e, x, y, tolerance = 24) {
  setGoal(e, x, y, tolerance);
  if (!hasPath(e)) computePathFor(e, x, y);
}

/** 限流 + 落地一个新藏身点 */
function relocateHideSpot(e, nowT) {
  const ai = e.ai;
  if (nowT - (ai.hideSpotAt || 0) < HIDE_REPLAN_MIN) return false;
  const spot = pickHideSpot(e, nowT);
  if (!spot) return false;
  ai.hideSpotAt = nowT;
  ai.hideSpot = spot;
  ai.itemTarget = null;
  goTo(e, spot.x, spot.y);
  return true;
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
    const c = list[(randRange(0, list.length)) | 0];
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

/**
 * 逃跑点重算（限流）。
 * 旧实现每帧都重抽一次并清空路径 —— 方向每帧翻转，表现就是原地左右晃。
 */
function replanFlee(e, threatX, threatY, nowT, force = false) {
  const ai = e.ai;
  const threatMoved = ai.fleeFrom
    ? Math.hypot(threatX - ai.fleeFrom.x, threatY - ai.fleeFrom.y)
    : Infinity;
  const stale = nowT - (ai.fleeTargetAt || 0) > FLEE_REPLAN_INTERVAL;
  if (!force && !stale && threatMoved < FLEE_REPLAN_THREAT_MOVE) return;

  ai.fleeTarget = chooseFleePoint(e, threatX, threatY);
  ai.fleeFrom = { x: threatX, y: threatY };
  ai.fleeTargetAt = nowT;
  ai.lastFleeFrom = { x: threatX, y: threatY };
  ai.lastThreatPos = { x: threatX, y: threatY };
  resetNavigation(e);
}

/** 藏身时顺手捡道具（威胁远的时候才贪） */
function pickItemTarget(e, nowT) {
  const ai = e.ai;
  const held = ai.itemTarget;
  if (held) {
    if (gstate.items.includes(held) && ai.itemTargetUntil > nowT) return held;
    ai.itemTarget = null;
  }
  const near = nearestItemTo(e, ITEM_SEEK_RANGE);
  if (!near) return null;
  ai.itemTarget = near;
  ai.itemTargetUntil = nowT + ITEM_TARGET_HOLD;
  return near;
}

export function updateHiderAI(e, dt) {
  const nowT = nowSec();
  const ai = e.ai;

  // 被定格：完全静止，解冻后重新规划
  if (isFrozen(e, nowT)) {
    resetNavigation(e);
    e.speedMode = 'walk';
    return;
  }

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

  // 2.5) 近距离照面 / 道具显形：立刻当作被发现
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

  // 3) 被搜捕者声波直接探测到 → 立即逃跑（换状态时强制重算一次）
  if (ai.detectedBySeeker && nowT - ai.detectedBySeeker < 2.0) {
    const tx0 = ai.detectedBySeekerPos?.x || e.x;
    const ty0 = ai.detectedBySeekerPos?.y || e.y;
    ai.state = 'flee';
    ai.stateStart = nowT;
    ai.detectedBySeeker = 0;
    replanFlee(e, tx0, ty0, nowT, true);
  }

  let nearestThreat = null, nearestDist = Infinity;
  for (const t of ai.threatZones) {
    const d = Math.hypot(t.x - e.x, t.y - e.y);
    if (d < nearestDist) { nearestDist = d; nearestThreat = t; }
  }

  if (ai.state !== 'flee') {
    if ((nearbySeeker && nearbySeekerDist < 150) || (nearestThreat && nearestDist < 200)) {
      // 贴脸威胁 → 逃跑
      const fleeFromSeeker = nearbySeeker && nearbySeekerDist < 150;
      const tx0 = fleeFromSeeker ? nearbySeeker.x : nearestThreat.x;
      const ty0 = fleeFromSeeker ? nearbySeeker.y : nearestThreat.y;
      ai.state = 'flee';
      ai.stateStart = nowT;
      replanFlee(e, tx0, ty0, nowT, true);
    } else if ((nearbySeeker && nearbySeekerDist < 420) || (nearestThreat && nearestDist < 390)) {
      // 中距离威胁不再原地“冻住”，而是静默换到更安全的躲藏点
      if (!hasPath(e)) {
        const tx0 = nearbySeeker ? nearbySeeker.x : nearestThreat.x;
        const ty0 = nearbySeeker ? nearbySeeker.y : nearestThreat.y;
        const safer = chooseFleePoint(e, tx0, ty0);
        ai.hideSpot = safer;
        ai.hideSpotAt = nowT;
        ai.lastThreatPos = { x: tx0, y: ty0 };
        ai.state = 'hide';
        ai.stateStart = nowT;
        ai.restTimer = 0;
        ai.relocateTimer = randRange(1.5, 3.0);
        ai.itemTarget = null;
        goTo(e, safer.x, safer.y);
      }
    } else {
      if (ai.state === 'frozen' || ai.state === 'flee') {
        const recent = ai.threatZones.find(t => nowT - t.time < 3.0);
        if (!recent) {
          ai.state = 'hide';
          ai.restTimer = 1.0;
          resetNavigation(e);
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
      resetNavigation(e);
      return;
    }

    // 威胁换位置 / 贴得很近 → 重算逃跑方向（replanFlee 内部有限流）
    if (newThreat || (nearbySeeker && nearbySeekerDist < 230)) {
      const fromSeeker = nearbySeeker && nearbySeekerDist < 230;
      const tx0 = fromSeeker ? nearbySeeker.x : nearestThreat.x;
      const ty0 = fromSeeker ? nearbySeeker.y : nearestThreat.y;
      replanFlee(e, tx0, ty0, nowT);
    }

    e.repathTimer -= dt;
    if (!hasPath(e) || e.repathTimer <= 0) {
      goTo(e, ai.fleeTarget.x, ai.fleeTarget.y);
      if (!hasPath(e)) {
        ai.state = 'hide';
        ai.restTimer = 0.5;
        return;
      }
      e.repathTimer = 0.38;
    }
    followPath(e, dt, 'run', 1.03);
    if (ai.relocateTimer <= 0 && nearbySeeker && nearbySeekerDist > 180) {
      ai.state = 'hide';
      ai.restTimer = 0.15;
      ai.relocateTimer = randRange(2.0, 4.0);
      resetNavigation(e);
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
      ai.stateStart = nowT;
      ai.relocateTimer = randRange(2.0, 4.0);
      replanFlee(e, nearbySeeker.x, nearbySeeker.y, nowT, true);
      return;
    }
    if (ai.relocateTimer <= 0 && nearbySeekerDist > 220) {
      // 休息够了，重新选点保持动态隐蔽
      ai.restTimer = 0;
      ai.relocateTimer = randRange(2.2, 4.2);
    }

    const arrived = !hasPath(e);
    if (arrived) {
      ai.restTimer -= dt;
      e.speedMode = 'walk';
      if (ai.restTimer <= 0) {
        // 安全的时候顺手捡一个道具，否则换藏身点
        const item = (nearbySeekerDist > 240 || !nearbySeeker) ? pickItemTarget(e, nowT) : null;
        if (item) {
          goTo(e, item.x, item.y);
          if (!hasPath(e)) { ai.itemTarget = null; ai.restTimer = 0.3; }
          else ai.restTimer = 0.8;
        } else if (!relocateHideSpot(e, nowT)) {
          ai.restTimer = 0.4;   // 限流中：稍后再试，不要每帧重抽
        } else {
          ai.restTimer = (nearbySeekerDist < 280) ? 0.35 : randRange(1.8, 3.5);
        }
      }
    } else {
      e.speedMode = 'walk';
      followPath(e, dt, 'walk');
    }
  }
}
