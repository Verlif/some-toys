/**
 * 阵营判定 —— 全项目唯一的“敌我识别”入口。
 *
 * 单文件版本里，声波的接受方只看“有没有听到声音”，
 * 所以躲藏者 AI 听到队友的脚步也会当成威胁逃跑，搜捕者 AI 也会去调查队友的噪声。
 * 现在所有声音反应都先过一遍 isEnemy()：
 *   · 躲藏者只对搜捕者的声音有反应
 *   · 搜捕者只对躲藏者的声音有反应
 * 声波本身的传播、墙壁记忆、探测闪烁不受影响。
 */
import { TEAM } from '../core/config.js';

/** 实体所属阵营 */
export function teamOf(entity) {
  if (!entity) return null;
  return entity.type === 'seeker' ? TEAM.seeker : TEAM.hider;
}

/**
 * 两者是否敌对。
 * 两个躲藏者、两个搜捕者之间是队友；躲藏者与搜捕者之间才是敌人。
 * 注意：被抓的躲藏者不再算作有效敌人来源。
 */
export function isEnemy(a, b) {
  if (!a || !b || a === b) return false;
  if (teamOf(a) === teamOf(b)) return false;
  if (a.type === 'hider' && !a.alive) return false;
  if (b.type === 'hider' && !b.alive) return false;
  return true;
}

/**
 * 声音接收方是否应当对某个声源做出反应（写入威胁 / 前往调查）。
 * 同阵营的声波会被直接忽略。
 */
export function shouldReactToSound(listener, emitter) {
  return isEnemy(listener, emitter);
}
