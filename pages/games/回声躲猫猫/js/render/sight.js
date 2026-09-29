/**
 * 表现层基础：画布适配、世界坐标变换，以及“感知类”特效
 * （声波可见性、墙壁记忆、探测闪烁）。
 *
 * 可见性规则：
 *   · 声波射线只显示自己阵营的（搜捕者看不到躲藏者的声波，反之亦然）
 *   · 墙壁轮廓只被自己的声波点亮（wallMemoryMap 以 emitterId 区分）
 *   · 探测闪烁只对相关方可见（自己的声波扫到别人 / 别人的声波扫到自己）
 */
import {
  W, H, TILE, SOUND_SPEED,
  WALL_MEMORY_HOLD, WALL_MEMORY_FADE,
  DETECT_RISE_TIME, DETECT_FADE_TIME
} from '../core/config.js';
import { gstate } from '../core/state.js';
import { visualNowSec } from '../core/timer.js';
import { dom } from '../ui/dom.js';

/* ============================================================
   画布
============================================================ */
export function resizeCanvas() {
  const rect = dom.wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  dom.canvas.width = Math.max(1, Math.round(rect.width * dpr));
  dom.canvas.height = Math.max(1, Math.round(rect.height * dpr));
}

/** 每帧开头：清屏并把世界坐标 (0,0)-(W,H) 等比铺满画布 */
export function beginWorldTransform() {
  const ctx = dom.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, dom.canvas.width, dom.canvas.height);
  const sx = dom.canvas.width / W;
  const sy = dom.canvas.height / H;
  const scale = Math.min(sx, sy);
  const ox = (dom.canvas.width - W * scale) * 0.5;
  const oy = (dom.canvas.height - H * scale) * 0.5;
  ctx.setTransform(scale, 0, 0, scale, ox, oy);
}

/** 某个声波对当前玩家是否可见 */
export function waveVisibleToPlayer(wave) {
  if (gstate.state === 'over' || gstate.spectator || !gstate.player) return true;
  if (!wave.emitter) return false;
  return wave.emitter.type === gstate.player.type;
}

/* ============================================================
   墙壁记忆
============================================================ */
export function drawWallMemories() {
  if (!gstate.player) return;
  const ctx = dom.ctx;
  const playerId = gstate.player.id;
  const nowT = visualNowSec();
  const totalLife = WALL_MEMORY_HOLD + WALL_MEMORY_FADE;

  for (const [key, wm] of gstate.wallMemoryMap) {
    if (wm.emitterId !== playerId) continue;

    // 顺带清理过期到达记录
    wm.arrivals = wm.arrivals.filter(t => nowT - t < totalLife);
    if (wm.arrivals.length === 0) { gstate.wallMemoryMap.delete(key); continue; }

    let latestPast = -Infinity;
    for (const t of wm.arrivals) {
      if (t <= nowT && t > latestPast) latestPast = t;
    }
    if (latestPast === -Infinity) continue;

    const age = nowT - latestPast;
    let alpha;
    if (age < WALL_MEMORY_HOLD) alpha = wm.strength * 0.55;
    else alpha = wm.strength * 0.55 * (1 - (age - WALL_MEMORY_HOLD) / WALL_MEMORY_FADE);
    if (alpha <= 0) continue;

    const px = wm.gx * TILE, py = wm.gy * TILE;
    ctx.fillStyle = `rgba(70, 130, 200, ${alpha * 0.9})`;
    ctx.fillRect(px, py, TILE, TILE);
    ctx.strokeStyle = `rgba(150, 220, 255, ${alpha * 1.3})`;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
  }
}

/* ============================================================
   探测闪烁
============================================================ */
export function flashIntensity(t, fadeTime) {
  if (t < 0) return 0;
  if (t >= fadeTime) return 0;
  if (t < DETECT_RISE_TIME) return t / DETECT_RISE_TIME;
  return Math.max(0, 1 - (t - DETECT_RISE_TIME) / (fadeTime - DETECT_RISE_TIME));
}

/** 在 (fx,fy) 画一次橙红色脉冲 + 十字准星 */
export function drawDetectFlash(fx, fy, intensity) {
  const ctx = dom.ctx;
  const alpha = intensity * 0.95;

  ctx.save();
  ctx.shadowColor = `rgba(255, 130, 60, ${alpha})`;
  ctx.shadowBlur = 20 + intensity * 16;

  const outerR = 16 - intensity * 5;
  ctx.beginPath();
  ctx.arc(fx, fy, outerR, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255, 110, 45, ${alpha * 0.55})`;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(fx, fy, 4 + intensity * 3, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255, 235, 195, ${alpha})`;
  ctx.fill();

  ctx.strokeStyle = `rgba(255, 200, 140, ${alpha})`;
  ctx.lineWidth = 2;
  const arm = 12 + intensity * 4;
  ctx.beginPath();
  ctx.moveTo(fx - arm, fy); ctx.lineTo(fx - 4, fy);
  ctx.moveTo(fx + 4, fy);   ctx.lineTo(fx + arm, fy);
  ctx.moveTo(fx, fy - arm); ctx.lineTo(fx, fy - 4);
  ctx.moveTo(fx, fy + 4);   ctx.lineTo(fx, fy + arm);
  ctx.stroke();
  ctx.restore();
}

export function renderDetectFlashes() {
  if (!gstate.player) return;
  const preserveFinal = gstate.state === 'over' || gstate.state === 'resultAnimation';

  for (const wave of gstate.soundWaves) {
    if (!wave.hits || wave.hits.length === 0) continue;
    if (!wave.emitter) continue;

    const frontDist = wave.age * SOUND_SPEED;

    for (const hit of wave.hits) {
      const emitter = wave.emitter;
      const target = hit.target;

      // 正常游戏仅提示玩家自己发出的声波命中其他角色；双人时 P1/P2 都适用
      if (!preserveFinal && !emitter.isPlayer) continue;
      if (target === emitter) continue;

      // 闪烁位置就是声波射线与角色首次相交的实际坐标
      const fx = hit.x;
      const fy = hit.y;

      if (!preserveFinal && target && target.type === 'hider' && !target.alive) continue;
      if (!preserveFinal && emitter.type === 'hider' && !emitter.alive) continue;

      if (frontDist < hit.dist) continue;
      const sinceArrival = (frontDist - hit.dist) / SOUND_SPEED;
      if (sinceArrival < 0 || sinceArrival > DETECT_FADE_TIME) continue;

      const intensity = flashIntensity(sinceArrival, DETECT_FADE_TIME);
      if (intensity <= 0) continue;
      drawDetectFlash(fx, fy, intensity);
    }
  }
}
