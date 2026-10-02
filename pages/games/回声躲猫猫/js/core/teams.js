/**
 * 阵营与敌我关系 —— 全项目唯一的「谁是谁的敌人」判定入口。
 *
 * 原先放在 ai/reaction.js，但它其实是**领域规则**而不是 AI 逻辑：
 * 声波系统、道具效果、显形、抓捕判定都要用它。
 * 放到 core/ 之后，sim / ai / render 都能引，且依赖方向统一向下。
 */
import { TEAM } from './config.js';

/** 实体所属阵营 */
export function teamOf(entity) {
  if (!entity) return null;
  return entity.type === 'seeker' ? TEAM.seeker : TEAM.hider;
}

/** 角色是否还在场上（出局的躲藏者不算） */
export function isActive(entity) {
  if (!entity) return false;
  return entity.type !== 'hider' || !!entity.alive;
}

/** 同阵营？（自己和自己不算队友） */
export function isTeammate(a, b) {
  if (!a || !b || a === b) return false;
  return teamOf(a) === teamOf(b);
}

/**
 * 两者是否敌对。
 * 两个躲藏者、两个搜捕者之间是队友；躲藏者与搜捕者之间才是敌人。
 * 已经出局的躲藏者不再算作有效敌人。
 */
export function isEnemy(a, b) {
  if (!a || !b || a === b) return false;
  if (teamOf(a) === teamOf(b)) return false;
  if (a.type === 'hider' && !a.alive) return false;
  if (b.type === 'hider' && !b.alive) return false;
  return true;
}

/** 声音接收方是否应当对某个声源做出反应（写入威胁 / 前往调查） */
export function shouldReactToSound(listener, emitter) {
  return isEnemy(listener, emitter);
}

/**
 * 某个角色的敌人列表（只含在场角色）。
 * @param {object} owner
 * @param {object[]} entities
 */
export function enemiesOf(owner, entities) {
  const out = [];
  if (!owner) return out;
  for (const e of entities) {
    if (e === owner) continue;
    if (!isActive(e)) continue;
    if (isEnemy(owner, e)) out.push(e);
  }
  return out;
}
