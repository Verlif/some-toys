/**
 * 角色状态效果（纯查询）。
 *
 * 效果本身由 sim/effects.js 施加（写字段 + 发事件），这里只提供**判定**，
 * 让 core / world / sim / ai / render 都能在不产生依赖环的前提下读同一份事实。
 *
 * 当前效果：
 *   frozen   定格：不能移动、不能抓人（道具「凝滞之锁」）
 *   haste    加速：移动速度倍率提升（道具「疾行之羽」）
 *   reveal   显形：对指定阵营可见（道具「回响之眼」）
 */
import { nowSec } from './timer.js';

/** 是否被定格 */
export function isFrozen(entity, at = nowSec()) {
  return !!entity && (entity.frozenUntil || 0) > at;
}

/** 是否处于加速状态 */
export function isHasted(entity, at = nowSec()) {
  return !!entity && (entity.hasteUntil || 0) > at;
}

/** 剩余定格时间（秒） */
export function frozenRemain(entity, at = nowSec()) {
  return Math.max(0, (entity?.frozenUntil || 0) - at);
}

/** 剩余加速时间（秒） */
export function hasteRemain(entity, at = nowSec()) {
  return Math.max(0, (entity?.hasteUntil || 0) - at);
}

/** 剩余显形时间（秒） */
export function revealRemain(entity, at = nowSec()) {
  return Math.max(0, (entity?.revealedUntil || 0) - at);
}

/**
 * 该角色是否正对某个阵营显形。
 * 显形只对「拾取者的阵营」生效，所以队友之间不会因为敌方捡了道具而互相暴露。
 */
export function isRevealedTo(entity, team, at = nowSec()) {
  if (!entity || !team) return false;
  return (entity.revealedUntil || 0) > at && entity.revealedFor === team;
}
