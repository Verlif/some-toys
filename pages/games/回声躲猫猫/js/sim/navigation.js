/**
 * 路径跟随（模拟层）：把 world/pathfind 拉直后的路点变成真实位移。
 *
 * 与旧实现的关键区别：
 *   1. **方向完全由路点决定**，一帧之内不会换主意
 *      （旧实现每帧在“直奔目标”和“走下一个节点”之间重挑一次朝向，
 *       两者来回抢占 → 贴着墙左右晃）。
 *   2. **统一走 sim/movement.steer()**（内含最小平移解算的贴墙滑动），
 *      不再用「探测一步 → 撞墙就整帧不动 → 沿 ±90° 硬蹭」那套。
 *   3. 只保留两个看门狗：
 *      · 脚步级：STEP_TIMEOUT 秒几乎没有位移 → 重规划；
 *      · 进度级：PROGRESS_TIMEOUT 秒没有拉近目标 → 重规划。
 */
import { isFrozen } from '../core/status.js';
import { moveDistance, steerToward } from './movement.js';
import { NODE_SNAP } from '../world/pathfind.js';

/** 进度看门狗判定“有拉近”的阈值（px） */
const PROGRESS_EPS = 6;
/** 进度看门狗超时（秒） */
const PROGRESS_TIMEOUT = 0.6;
/** 脚步看门狗超时（秒） */
const STEP_TIMEOUT = 0.3;
/** 一帧内最多连续走过多少个路点（异常路径兜底） */
const MAX_WAYPOINTS_PER_STEP = 8;

/** 清掉导航状态（重规划 / 被定格时调用） */
export function resetNavigation(e) {
  e.path = null;
  e.pathIdx = 0;
  e.waypoints = null;
  e.wpIdx = 0;
  e.aim = null;
  e.stuckTimer = 0;
  e.progressTimer = 0;
  e.progressBest = null;
  e.repathTimer = 0;
}

/** 是否还有没走完的路径 */
export function hasPath(e) {
  return !!(e.waypoints && e.wpIdx < e.waypoints.length);
}

/**
 * 设定移动目标；目标变化较大时**立即作废旧路径**。
 *
 * 这一步是防“原地掉头”的关键：巡逻点/追击点随时可能换，
 * 如果继续沿用旧路点，角色会先把旧路点走完、再掉头走向新目标 ——
 * 看起来就是在墙边来回走直线（实测到的“左右晃”主要来源）。
 *
 * @param {object} e 实体
 * @param {number} x 目标世界坐标
 * @param {number} y
 * @param {number} tolerance 目标移动超过这个距离就作废旧路径（px）
 */
export function setGoal(e, x, y, tolerance = 40) {
  const g = e.goal;
  if (!g || Math.hypot(g.x - x, g.y - y) > tolerance) {
    e.path = null;
    e.pathIdx = 0;
    e.waypoints = null;
    e.wpIdx = 0;
    e.repathTimer = 0;
    e.progressTimer = 0;
    e.progressBest = null;
    e.stuckTimer = 0;
  }
  e.goal = { x, y };
}

/**
 * 进度看门狗：长时间没有靠近目标就强制重规划。
 *
 * 只看「有没有位移」是不够的 —— 贴着墙角时角色会小幅来回抖，每帧位移都不为零。
 */
function updateProgressWatchdog(e, dt) {
  const goal = e.goal;
  if (!goal) return false;
  const d = Math.hypot(goal.x - e.x, goal.y - e.y);
  if (d < PROGRESS_EPS) { e.progressTimer = 0; e.progressBest = d; return false; }
  if (e.progressBest === undefined || e.progressBest === null || d < e.progressBest - PROGRESS_EPS) {
    e.progressBest = d;
    e.progressTimer = 0;
    return false;
  }
  e.progressTimer = (e.progressTimer || 0) + dt;
  if (e.progressTimer >= PROGRESS_TIMEOUT) {
    resetNavigation(e);
    return true;
  }
  return false;
}

/**
 * 沿当前路点前进一帧。
 * @param {object} e 实体
 * @param {number} dt 固定步长
 * @param {string} speedMode 'walk' | 'run'
 * @param {number} extraMul 额外速度倍率（例如逃跑时的 +3%）
 * @returns {boolean} 路径是否仍然有效
 */
export function followPath(e, dt, speedMode = e.speedMode, extraMul = 1) {
  e.speedMode = speedMode;
  if (isFrozen(e)) return false;
  if (updateProgressWatchdog(e, dt)) return false;
  if (!hasPath(e)) return false;

  let budget = moveDistance(e, dt, speedMode, extraMul);
  let moved = 0;
  let blocked = false;

  for (let guard = 0; guard < MAX_WAYPOINTS_PER_STEP && budget > 0.05; guard++) {
    // 跳过已经站在上面的路点
    while (e.wpIdx < e.waypoints.length) {
      const wp = e.waypoints[e.wpIdx];
      if (Math.hypot(wp.x - e.x, wp.y - e.y) > NODE_SNAP) break;
      e.wpIdx++;
    }
    if (e.wpIdx >= e.waypoints.length) break;

    const wp = e.waypoints[e.wpIdx];
    const d = Math.hypot(wp.x - e.x, wp.y - e.y);
    const step = Math.min(budget, d);
    const got = steerToward(e, wp.x, wp.y, step, { antiJitter: true });
    moved += got;
    budget -= step;

    if (got < step * 0.35) { blocked = true; break; }   // 被墙吃掉了大半，交给看门狗

    if (d - got <= NODE_SNAP) {                          // 到达：吸附到路点，避免残差推不动索引
      e.x = wp.x;
      e.y = wp.y;
      e.wpIdx++;
    }
    if (step >= d) continue;
  }

  // 脚步看门狗：这一步几乎没动（贴死在墙角 / 路径本身走不通）
  const expected = moveDistance(e, dt, speedMode, extraMul);
  if (blocked || moved < expected * 0.25) {
    e.stuckTimer = (e.stuckTimer || 0) + dt;
    if (e.stuckTimer >= STEP_TIMEOUT) {
      resetNavigation(e);
      return false;
    }
  } else {
    e.stuckTimer = 0;
  }
  return true;
}
