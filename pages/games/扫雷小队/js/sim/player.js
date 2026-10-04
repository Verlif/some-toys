/**
 * 玩家更新：一个动作键承担两段语义。
 *
 *   轻按         → 立即扫描（0.5 秒出结果）
 *   按住 ≥0.5 秒 → 扫描完成后自动接续排雷
 *   排雷 2 秒    → 中途松开即取消，前功尽弃
 *
 * 扫描与排雷期间角色不能移动，这是「停下来工作」的代价。
 */
import { CONTROLS, HOLD_FOR_DEFUSE } from '../core/config.js';
import { game } from '../core/state.js';
import { moveEntity } from '../world/collision.js';
import { startScan, cancelDefuse, startDefuse, completeDefuse, revealScan } from './scan.js';

export function updatePlayer(e, dt) {
  if (e.downed || e.arrived) return;

  const c = CONTROLS[e.playerIndex];
  const actionPressed = c.action.some(k => game.keys[k]);

  // ---------- 1. 松开处理 ----------
  if (!actionPressed && e.actionKeyHeld) {
    if (e.defuseTimer > 0) cancelDefuse(e);  // 松开中断排雷
    e.actionKeyHeld = false;
    e.actionKeyHoldTime = 0;
    e.actionKeyTriggered = false;
  }

  // ---------- 2. 新按下 → 立即开始扫描 ----------
  if (actionPressed && !e.actionKeyHeld) {
    e.actionKeyHeld = true;
    e.actionKeyHoldTime = 0;
    e.actionKeyTriggered = false;
    if (e.scanCooldown <= 0 && e.defuseCooldown <= 0 && e.defuseTimer <= 0) {
      startScan(e);
    }
  }

  // ---------- 3. 按住计时 ----------
  if (actionPressed && e.actionKeyHeld) {
    e.actionKeyHoldTime += dt;
  }

  // ---------- 4. 排雷进行中 ----------
  if (e.defuseTimer > 0) {
    e.defuseTimer -= dt;
    if (e.defuseTimer <= 0) completeDefuse(e);
    return;
  }

  // ---------- 5. 扫描进行中 ----------
  if (e.scanTimer > 0) {
    e.scanTimer -= dt;
    if (e.scanTimer <= 0) {
      e.scanTimer = 0;
      revealScan(e);
      e.scanCooldown = 0.2;
    }
  }

  // ---------- 6. 扫描已完成 + 按住 ≥0.5 秒 → 触发排雷 ----------
  if (actionPressed && e.actionKeyHeld && !e.actionKeyTriggered &&
      e.actionKeyHoldTime >= HOLD_FOR_DEFUSE &&
      e.scanTimer <= 0 && e.defuseCooldown <= 0) {
    e.actionKeyTriggered = true;
    startDefuse(e);
    if (e.defuseTimer > 0) return;
  }

  // ---------- 7. 扫描/排雷中不移动 ----------
  if (e.scanTimer > 0 || e.defuseTimer > 0) return;

  // ---------- 8. 移动 ----------
  let dx = 0, dy = 0;
  if (game.keys[c.up])    dy -= 1;
  if (game.keys[c.down])  dy += 1;
  if (game.keys[c.left])  dx -= 1;
  if (game.keys[c.right]) dx += 1;

  if (dx || dy) {
    const len = Math.hypot(dx, dy);
    dx /= len; dy /= len;
    e.faceX = dx; e.faceY = dy;
    moveEntity(e, dx * e.speed * dt, dy * e.speed * dt);
  }
}
