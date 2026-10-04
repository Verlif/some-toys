/**
 * 特效绘制：扫描涟漪、延迟雷倒计时环、爆炸火焰、粒子、开局倒计时数字。
 * 只读传入的 scene（实时对局为 game，回放为回放场景）。
 */
import { TILE, CW, CH } from '../core/config.js';
import { game } from '../core/state.js';

/** 扫描涟漪 */
export function drawRipples(ctx, scene = game) {
  for (const r of scene.ripples) {
    const p = r.t / r.dur;
    ctx.strokeStyle = r.color;
    ctx.globalAlpha = (1 - p) * 0.65;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.maxR * p, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** 延迟雷：闪烁红圈 + 剩余秒数 */
export function drawDelayedMineWarnings(ctx, scene = game) {
  for (const e of scene.entities) {
    if (!e.pendingExplosions || !e.pendingExplosions.length) continue;
    for (const pe of e.pendingExplosions) {
      const cx = pe.x * TILE + TILE / 2;
      const cy = pe.y * TILE + TILE / 2;
      const p = 1 - pe.timer;
      const r = 4 + p * 12;
      const flash = 0.5 + 0.5 * Math.sin(pe.timer * 30);
      ctx.strokeStyle = `rgba(255,60,60,${flash})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = `rgba(255,220,60,${flash * 0.8})`;
      ctx.font = 'bold 9px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pe.timer.toFixed(1), cx, cy);
    }
  }
}

/** 爆炸：5 格火焰 + 双层冲击波 */
export function drawExplosions(ctx, scene = game) {
  for (const ex of scene.explosions) {
    const p = ex.t / ex.dur;
    const alpha = 1 - p;

    for (const [x, y] of ex.cells) {
      const px = x * TILE, py = y * TILE;
      ctx.fillStyle = `rgba(255,180,50,${alpha * 0.55})`;   // 外圈橙
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = `rgba(255,70,30,${alpha * 0.85})`;    // 内圈红
      ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
      if (p < 0.6) {                                        // 中心亮
        ctx.fillStyle = `rgba(255,255,220,${(1 - p / 0.6) * alpha * 0.85})`;
        ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
      }
    }

    const shockR = 8 + p * 55;
    ctx.strokeStyle = `rgba(255,220,120,${alpha * 0.85})`;
    ctx.lineWidth = 3 * (1 - p) + 1;
    ctx.beginPath();
    ctx.arc(ex.x, ex.y, shockR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = `rgba(255,90,40,${alpha * 0.6})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ex.x, ex.y, shockR * 0.7, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** 粒子（最顶层之一） */
export function drawParticles(ctx, scene = game) {
  for (const p of scene.particles) {
    const a = Math.max(0, p.life / p.maxLife);
    const rad = p.size * (0.4 + a * 0.8);
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad * 2);
    grad.addColorStop(0, `hsla(${p.hue}, 100%, 75%, ${a})`);
    grad.addColorStop(0.5, `hsla(${p.hue}, 100%, 55%, ${a * 0.7})`);
    grad.addColorStop(1, `hsla(${p.hue}, 100%, 40%, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad * 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 开局倒计时数字 */
export function drawCountdown(ctx, scene = game) {
  if (scene.state !== 'countdown') return;
  const n = Math.ceil(scene.countdown);
  ctx.fillStyle = 'rgba(4,7,12,0.6)';
  ctx.fillRect(-10, -10, CW + 20, CH + 20);

  ctx.fillStyle = '#eef3fa';
  ctx.font = 'bold 90px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(59,130,246,0.8)';
  ctx.shadowBlur = 30;
  ctx.fillText(n > 0 ? n : 'GO', CW / 2, CH / 2);
  ctx.shadowBlur = 0;

  ctx.font = 'bold 16px -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(200,215,230,0.75)';
  ctx.fillText('准备出发…', CW / 2, CH / 2 + 70);
}
