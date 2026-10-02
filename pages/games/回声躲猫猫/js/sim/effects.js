/**
 * 道具效果（模拟层规则）。
 *
 * 四种道具都作用在「拾取者的阵营」上：
 *   reveal 回响之眼 —— 对方阵营全体对本方显形 1 秒
 *   freeze 凝滞之锁 —— 对方阵营全体定格 2 秒（不能移动、不能抓人）
 *   noise  喧嚣之铃 —— 对方阵营全体立即发出一次噪声（暴露位置）
 *   haste  疾行之羽 —— 自己获得加速 5 秒
 *
 * 效果只写实体上的时间戳字段（frozenUntil / hasteUntil / revealedUntil+revealedFor），
 * 判定统一走 core/status.js —— 这样联机快照里只要带上这些数字就够了。
 */
import { ITEM_TYPES } from '../core/config.js';
import { gstate } from '../core/state.js';
import { nowSec } from '../core/timer.js';
import { emit, EVT } from '../core/events.js';
import { teamOf, enemiesOf } from '../core/teams.js';
import { forceNoise } from './sound.js';

/**
 * 施加道具效果。
 * @param {object} holder 拾取者
 * @param {object} item 道具
 * @returns {{type:object, affected:number[]}} 生效的道具与受影响实体 id
 */
export function applyItemEffect(holder, item) {
  const type = ITEM_TYPES[item?.type];
  const result = { type, affected: [] };
  if (!holder || !type) return result;

  const nowT = nowSec();
  const team = teamOf(holder);
  const enemies = enemiesOf(holder, gstate.entities);

  switch (type.id) {
    case 'reveal':
      for (const e of enemies) {
        e.revealedUntil = Math.max(e.revealedUntil || 0, nowT + type.duration);
        e.revealedFor = team;
        result.affected.push(e.id);
      }
      break;

    case 'freeze':
      for (const e of enemies) {
        e.frozenUntil = Math.max(e.frozenUntil || 0, nowT + type.duration);
        e.path = null;      // 解冻后重新规划，不要继续跑旧路线
        e.aim = null;
        e.lastMoveDir = null;
        result.affected.push(e.id);
      }
      break;

    case 'noise':
      for (const e of enemies) {
        forceNoise(e);
        result.affected.push(e.id);
      }
      break;

    case 'haste':
      holder.hasteUntil = Math.max(holder.hasteUntil || 0, nowT + type.duration);
      result.affected.push(holder.id);
      break;

    default:
      break;
  }

  emit(EVT.ITEM_EFFECT, { item, holder, type, affected: result.affected.slice() });
  return result;
}
