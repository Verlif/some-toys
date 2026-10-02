/**
 * 角色移动 —— 全项目**唯一**的位置推进入口。
 *
 * 为什么要统一：
 *   · 玩家（指令）与 AI（寻路/追击/逃跑）如果各写一套位移，手感与卡墙表现必然不一致；
 *   · 联机时客户端预测、房主校正都希望只有一处“角色怎么动”的规则；
 *   · 冻结、加速、贴墙滑动这些通用规则只在这里实现一次。
 *
 * 分工：
 *   · world/collision.js  —— 几何：撞墙怎么滑（最小平移解算）
 *   · sim/movement.js     —— 规则：谁能动、走多快、要不要防抖
 */
import {
  BASE_SPEED, WALK_MUL, RUN_MUL, SEEKER_SPEED_MUL, ITEM_HASTE_MUL,
  STEER_TURN_LOCK, STEER_REVERSE_ANGLE
} from '../core/config.js';
import { nowSec } from '../core/timer.js';
import { isFrozen, isHasted } from '../core/status.js';
import { moveEntity } from '../world/collision.js';
import { tryEmitNoise } from './sound.js';

/** 角色当前速度倍率（阵营 + 走/跑 + 加速道具） */
export function speedMultiplier(e, speedMode = e.speedMode) {
  const base = (speedMode === 'run' ? RUN_MUL : WALK_MUL) * (e.type === 'seeker' ? SEEKER_SPEED_MUL : 1);
  return base * (isHasted(e) ? ITEM_HASTE_MUL : 1);
}

/** 这一 tick 能走的距离（px） */
export function moveDistance(e, dt, speedMode = e.speedMode, extraMul = 1) {
  return BASE_SPEED * speedMultiplier(e, speedMode) * extraMul * dt;
}

const REVERSE_DOT = Math.cos((STEER_REVERSE_ANGLE * Math.PI) / 180);

/**
 * 按方向移动角色。
 *
 * @param {object} e 角色
 * @param {number} dirX 方向（不必归一化，函数内会处理）
 * @param {number} dirY
 * @param {number} distance 期望位移（px）
 * @param {object} [opts]
 *        opts.antiJitter 是否启用“反向锁”（AI 用；玩家输入必须 1:1 响应，不能锁）
 * @returns {number} 实际位移（px）
 */
export function steer(e, dirX, dirY, distance, opts = {}) {
  if (!(distance > 0) || (!dirX && !dirY)) return 0;
  if (isFrozen(e)) return 0;

  const len = Math.hypot(dirX, dirY);
  if (len < 1e-6) return 0;
  let ux = dirX / len, uy = dirY / len;

  const nowT = nowSec();
  const last = e.lastMoveDir;

  if (opts.antiJitter && last) {
    const dot = ux * last.x + uy * last.y;
    if (dot < REVERSE_DOT) {
      // 想反向：短时间锁内保持原方向，避免贴着墙左右来回抖
      if ((e.turnLockUntil || 0) > nowT) {
        ux = last.x; uy = last.y;
      } else {
        e.turnLockUntil = nowT + STEER_TURN_LOCK;
      }
    } else if (dot > 0.5) {
      e.turnLockUntil = 0;   // 方向大体一致，解锁
    }
  }

  const fromX = e.x, fromY = e.y;
  moveEntity(e, ux * distance, uy * distance);
  const moved = Math.hypot(e.x - fromX, e.y - fromY);
  if (moved > 0.05) {
    e.lastMoveDir = { x: (e.x - fromX) / moved, y: (e.y - fromY) / moved };
  }
  return moved;
}

/** 朝某个点走一步（AI 的通用动作） */
export function steerToward(e, targetX, targetY, distance, opts = {}) {
  return steer(e, targetX - e.x, targetY - e.y, distance, opts);
}

/**
 * 把玩家指令变成位移。
 * 玩家输入不做转向防抖 —— 手感优先，按哪走哪。
 */
export function applyPlayerCommand(e, cmd, dt) {
  const out = { moved: 0, noise: false };
  if (!e || !cmd) return out;
  if (isFrozen(e)) return out;

  if (cmd.mx || cmd.my) {
    e.speedMode = cmd.run ? 'run' : 'walk';
    out.moved = steer(e, cmd.mx, cmd.my, moveDistance(e, dt, e.speedMode));
  } else {
    e.speedMode = cmd.run ? 'run' : 'walk';
  }

  if (cmd.noise && tryEmitNoise(e)) out.noise = true;
  return out;
}

/** 玩家是否被定格（UI 提示用） */
export { isFrozen };
