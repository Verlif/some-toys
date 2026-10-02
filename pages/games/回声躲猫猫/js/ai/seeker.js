/**
 * 搜捕者 AI —— 状态机（优先级从高到低）。
 *
 *   1. chase       声波探测到躲藏者后立刻前往命中点，持续约 4 秒
 *   2. search      失去目标后在最后位置周围撒搜索点逐一排查，并定期噪声扫描
 *   3. investigate 听到声音（延迟到达）后前往声源调查
 *   4. patrol      无目标时优先巡逻长时间未访问的格子 / 顺手捡附近道具
 *
 * 听到的声音只可能来自躲藏者：sim/sound.js 在写入 heardSound 前已做阵营过滤
 * （core/teams.js），所以搜捕者不会再去调查队友的噪声。
 *
 * ★ 抓捕冷却：AI 搜捕者**没有**冷却（需求），只有人类玩家有（见 sim/combat.js）。
 *
 * ★ 防“卡墙左右晃”：
 *   · 追击时的直线扑击要求“真的靠近了”，只是被推着侧移不算成功；
 *   · 移动统一走 sim/movement.steer（贴墙滑动 + 反向锁），不再自己硬蹭墙角。
 */
import {
  TILE, W, H, NOISE_AI_MIN_INTERVAL, PROXIMITY_DETECT, DETECT_RANGE, CHASE_DIRECT_HOLD
} from '../core/config.js';
import { gstate } from '../core/state.js';
import { nowSec } from '../core/timer.js';
import { tx, ty, clamp } from '../core/utils.js';
import { randRange } from '../core/rng.js';
import { isFrozen } from '../core/status.js';
import { computePathFor, generateSearchPoints, hasLineOfSight } from '../world/pathfind.js';
import { followPath, resetNavigation, hasPath, setGoal } from '../sim/navigation.js';
import { moveDistance, steerToward } from '../sim/movement.js';
import { circleHitsWall } from '../world/collision.js';
import { getOpenCells } from '../world/map.js';
import { nearestItemTo } from '../world/items.js';
import { nearestVisibleEnemy } from '../core/vision.js';
import { tryEmitNoise } from '../sim/sound.js';

/** 巡逻时顺手捡道具的最大距离（px） */
const ITEM_SEEK_RANGE = 320;
/** 捡道具目标的保持时间（秒）：到期后重新评估，避免目标每帧抖动 */
const ITEM_TARGET_HOLD = 6;

/**
 * 选一个“很久没去过”的巡逻点。
 *
 * 评分要点：访问间隔越久越好，同时**偏好中等距离（≈6 格）**：
 *   · 太近的点会变成原地来回踱步（旧实现就是“就近挑没去过的格子”，
 *     于是刚到就掉头走向身后 1~2 格，看起来像左右晃）；
 *   · 太远的点会让巡逻变成一条直线穿越地图，漏掉沿途区域。
 */
export function pickPatrolTarget(e, nowT) {
  const list = getOpenCells();
  let best = null, bestScore = -Infinity;
  const ai = e.ai;
  const heading = e.lastMoveDir;
  for (let i = 0; i < 80; i++) {
    const c = list[(randRange(0, list.length)) | 0];
    const key = `${c.x},${c.y}`;
    const lastVisit = ai.visitedCells.get(key) || 0;
    const sinceVisit = nowT - lastVisit;
    const wx = c.x * TILE + TILE / 2;
    const wy = c.y * TILE + TILE / 2;
    const d = Math.hypot(wx - e.x, wy - e.y);
    let score = Math.min(sinceVisit, 90) * 3.0;
    score -= Math.abs(d - TILE * 6) * 0.35;      // 6 格左右最优
    if (d < TILE * 2.5) score -= 140;            // 太近：宁可换一个，别原地打转
    if (heading && d > 1) {
      // 身后的点重罚：不然刚到目标就掉头走回去，看起来就是左右晃
      const dot = ((wx - e.x) * heading.x + (wy - e.y) * heading.y) / d;
      if (dot < 0) score -= 180 * (-dot);
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/**
 * 追击目标是否近到可以直接扑过去。
 * 只在近距离（8 格内）启用：远了还是要靠寻路绕墙，否则会一头撞进死路。
 */
function canPursueDirectly(e, target) {
  if (!target) return false;
  const d = Math.hypot(target.x - e.x, target.y - e.y);
  if (d > TILE * 8) return false;
  return !circleHitsWall(target.x, target.y, e.r * 0.98);
}

/**
 * 巡逻时顺手捡道具：目标带黏性，捡到 / 过期 / 有更近的才换。
 * @returns {object|null} 要去的道具
 */
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

export function updateSeekerAI(e, dt) {
  const nowT = nowSec();
  const ai = e.ai;

  // 被「凝滞之锁」定格：站着不动，解冻后重新规划
  if (isFrozen(e, nowT)) {
    resetNavigation(e);
    e.goal = null;
    return;
  }

  // 访问记忆：45 秒内去过的格子不再优先巡逻
  ai.visitedCells.set(`${tx(e.x)},${ty(e.y)}`, nowT);
  if (ai.visitedCells.size > 800) {
    for (const [k, t] of ai.visitedCells) {
      if (nowT - t > 45) ai.visitedCells.delete(k);
    }
  }

  // 近距离照面：看见了就直接追，不必先等声波传回来
  const seen = PROXIMITY_DETECT ? nearestVisibleEnemy(e, DETECT_RANGE) : null;
  if (seen) {
    e.spottedTarget = { x: seen.x, y: seen.y, target: seen, arriveTime: nowT };
  }

  // 目标已经被别人抓走了就作废，否则会一直追着一具“尸体”原地不动
  const chaseTarget = e.spottedTarget?.target;
  if (chaseTarget && !chaseTarget.alive) {
    e.spottedTarget = null;
    if (ai.state === 'chase') {
      ai.state = 'patrol';
      ai.stateStart = nowT;
      e.goal = null;
      resetNavigation(e);
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
    if (ai.target) setGoal(e, ai.target.x, ai.target.y, 24);
    speedMode = 'run';
    ai.repathFast = true;
  } else if (ai.state === 'investigate') {
    if (ai.target) setGoal(e, ai.target.x, ai.target.y, 40);
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
        setGoal(e, nextPoint.x, nextPoint.y);
        speedMode = 'run';
        ai.repathFast = true;
      }
    }
  }

  if (ai.state === 'patrol') {
    // 顺手捡道具：临时改变目标点，不改变巡逻记忆
    const item = pickItemTarget(e, nowT);
    if (item) {
      setGoal(e, item.x, item.y);
    } else {
      const arrive = !ai.patrol ||
        Math.hypot(ai.patrol.x * TILE + TILE / 2 - e.x, ai.patrol.y * TILE + TILE / 2 - e.y) < 30;
      if (arrive) ai.patrol = pickPatrolTarget(e, nowT);
      if (ai.patrol) setGoal(e, ai.patrol.x * TILE + TILE / 2, ai.patrol.y * TILE + TILE / 2);
    }
    speedMode = 'run';
    if (nowT - ai.lastNoise > NOISE_AI_MIN_INTERVAL * 1.35) {
      if (tryEmitNoise(e)) ai.lastNoise = nowT;
    }
  }

  e.speedMode = speedMode;
  e.repathTimer -= dt;

  // 追击时如果目标就在眼前且中间没墙，直接直线扑上去。
  // 只靠寻路会出问题：被追的躲藏者常常贴着墙/角落，追击点落进墙格导致
  // computePathFor 失败，于是 AI 一边“原地重算”一边烧掉追击时间。
  // ★ 判据是“有没有真的靠近目标”，而不是“有没有位移”：
  //   贴着墙被推着侧移会算成位移，于是 AI 会一直保持直线模式原地蹭。
  if (ai.state === 'chase') {
    const aim = e.spottedTarget?.target;
    const holdDirect = (e.directChaseUntil || 0) > nowT;
    const canDirect = aim && aim.alive !== false && canPursueDirectly(e, aim) && hasLineOfSight(e, aim);
    if (canDirect || (holdDirect && aim && aim.alive !== false)) {
      const beforeD = Math.hypot(aim.x - e.x, aim.y - e.y);
      const px = e.x, py = e.y;
      const distance = moveDistance(e, dt, 'run');
      steerToward(e, aim.x, aim.y, distance, { antiJitter: true });
      const afterD = Math.hypot(aim.x - e.x, aim.y - e.y);
      if (afterD < beforeD - distance * 0.25) {
        // 保持一段时间，避免“直线扑 / 走寻路”每帧来回切
        e.directChaseUntil = nowT + CHASE_DIRECT_HOLD;
        e.stuckTimer = 0;
        e.progressTimer = 0;
        e.progressBest = null;
        return;
      }
      e.directChaseUntil = 0;
      e.x = px; e.y = py;   // 没靠近，交回寻路
    }
  }

  const needRepath = !hasPath(e) || e.repathTimer <= 0;
  if (needRepath && e.goal) {
    computePathFor(e, e.goal.x, e.goal.y);
    if (!hasPath(e)) {
      if (ai.state === 'patrol') {
        ai.patrol = null;
        ai.itemTarget = null;
        e.repathTimer = 0.25;
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

  if (hasPath(e)) {
    followPath(e, dt, speedMode);
  }
}
