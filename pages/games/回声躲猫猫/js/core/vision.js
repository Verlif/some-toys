/**
 * 显形 / 视野规则（表现层与 AI 共用的唯一判定）。
 *
 * 黑暗世界里角色默认互相不可见，只有满足以下任一条才会显形：
 *
 *   1. 双方距离小于 3 格（VISION_TILE_RANGE）—— 任何组合、不论敌我都成立
 *   2. 同一阵营的搜捕者之间 —— 不受距离限制，始终能互相看到位置
 *   3. **队友视野共享**：只要任一队友靠近了某个角色，同队的你也能看到它
 *   4. **道具显形**：被「回响之眼」标记的角色，在持续时间内对本方阵营完全可见
 *
 * 关于“共享视野”的含义：
 *   · 它是**近身触发的**，不是全知。队友自己也得先靠近（3 格内）才能把对方暴露给你；
 *     离所有人都远的角色照样谁也看不见。
 *   · 共享的是「被队友看到的那个人」，不是队友的眼睛：视野本身不会扩大；
 *     地形信息另有一条规则 —— 队友声波点亮的墙壁轮廓会一并显示给你
 *     （见 render/sight.js 的 SHARE_TEAM_WALL_MEMORY）。
 *   · 参与共享的是**全部同阵营角色**，包括 AI 队友：队友是人还是 AI，不影响你能看到什么。
 *   · 双人模式下两名玩家永远看得见彼此（互为队友，且都在共享组里）。
 *
 * 这个模块同时被 render（画谁）和 ai（对谁有反应）使用，
 * 所以两边的“看得见”永远一致，不会出现「玩家看得见、AI 却发呆」。
 */
import { TILE, VISION_TILE_RANGE, SHARE_TEAM_VISION, DETECT_RANGE } from './config.js';
import { gstate } from './state.js';
import { nowSec } from './timer.js';
import { isTeammate, teamOf, isActive } from './teams.js';
import { isRevealedTo } from './status.js';

/** 近身视野半径（px），随地图格子尺寸缩放 */
export function visionRadius() {
  return VISION_TILE_RANGE * TILE;
}

/** 两名角色是否因靠得太近而互相可见（严格小于 3 格） */
export function withinVisionRange(a, b) {
  if (!a || !b || a === b) return false;
  return Math.hypot(a.x - b.x, a.y - b.y) < visionRadius();
}

/**
 * 观察者的“共享视野组”：自己 + 同阵营的所有在场上队友。
 * `SHARE_TEAM_VISION = false` 时只有自己（潜行压力更大）。
 */
export function visionGroupOf(observer) {
  if (!observer) return [];
  if (!SHARE_TEAM_VISION) return [observer];
  const group = [observer];
  for (const other of gstate.entities) {
    if (other === observer) continue;
    if (other.type !== observer.type) continue;
    if (!isActive(other)) continue;
    group.push(other);
  }
  return group;
}

/**
 * 判断某个队友是否真的把目标“看见”并共享出来了。
 * 注意这里不包含“搜捕者之间远距离互见”那条规则——那条只对观察者自己生效，
 * 否则搜捕者会通过任意一个远处的 AI 队友看到全场。
 */
function teammateReveals(member, target) {
  if (!member || member === target) return false;
  if (!isActive(member)) return false;
  return withinVisionRange(member, target);
}

/** 观察者能否看到目标角色（含队友的近身视野共享与道具显形） */
export function canSeeEntity(observer, target) {
  if (!observer || !target || observer === target) return false;
  if (!isActive(target)) return false;

  // 道具显形：对本方阵营完全可见
  if (isRevealedTo(target, teamOf(observer))) return true;

  // 搜捕者之间不受距离限制（既有规则）
  if (observer.type === 'seeker' && target.type === 'seeker') return true;

  // 近身：自己靠近，或目标是自己阵营的队友（用同一条规则，队友不会“全场可见”）
  if (isTeammate(observer, target)) return withinVisionRange(observer, target);
  if (withinVisionRange(observer, target)) return true;

  // 队友的近身视野共享
  return visionGroupOf(observer).some(member => member !== observer && teammateReveals(member, target));
}

/** 收集观察者当前能直接看到的其他角色 */
export function entitiesVisibleTo(observer) {
  const out = [];
  if (!observer) return out;
  for (const other of gstate.entities) {
    if (canSeeEntity(observer, other)) out.push(other);
  }
  return out;
}

/* ============================================================
   AI 侧：把「互相显形」变成行动依据
   ============================================================ */

/**
 * 最近的一个「因互相显形而暴露」的敌人。
 *
 * 注意这里用的是**双向**的 `canSeeEntity`：只要双方距离进入显形范围，
 * 就视为彼此都察觉到了对方——玩家看得见敌人时，敌人也看得见玩家，
 * 不会出现“你能看到他、他却呆立不动”的不对称。
 * 道具显形同样生效：被显形的敌人会被 AI 直接锁定。
 *
 * @param {object} observer 观察者
 * @param {number} extraRange 额外容许距离（px），默认取 DETECT_RANGE
 */
export function nearestVisibleEnemy(observer, extraRange = DETECT_RANGE) {
  if (!observer) return null;
  const at = nowSec();
  let best = null, bestDist = Infinity;
  for (const other of gstate.entities) {
    if (!isActive(other)) continue;
    if (other.type === observer.type) continue;      // 只看敌人
    const revealed = isRevealedTo(other, teamOf(observer), at);
    if (!revealed && !canSeeEntity(observer, other)) continue;
    const d = Math.hypot(other.x - observer.x, other.y - observer.y);
    if (revealed || d <= visionRadius() + extraRange) {
      if (d < bestDist) { bestDist = d; best = other; }
    }
  }
  return best;
}
