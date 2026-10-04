/**
 * HUD 与画面反馈：时间条、飘字、危险暗角、3-2-1 倒计时、「开始！」闪光。
 */
import { VW, VH, GROUND_Y, WRITER_MAX_TIME, START_FLASH_DUR } from '../core/config.js';
import { clamp, roundRect } from '../core/utils.js';
import { ctx } from '../core/viewport.js';
import { world } from '../game/state.js';

/* ================================================================
   渲染 — 时间条
================================================================ */
export function drawTimer(){
  if (!world || world.over) return;

  const t = world.writerTimeLeft;
  const pct = clamp(t / WRITER_MAX_TIME, 0, 1);

  const barW = 320;
  const barH = 18;
  const barX = (VW - barW) / 2;
  const barY = 26;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(10,12,20,0.7)';
  roundRect(ctx, barX - 8, barY - 8, barW + 16, barH + 16, 12);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, barX, barY, barW, barH, 9);
  ctx.fill();

  let fillColor;
  if (world.timeFlash > 0.4){
    const fl = Math.sin(world.timeFlash * 30) * 0.5 + 0.5;
    fillColor = fl > 0.5 ? '#ff5555' : '#ff8888';
  } else if (pct > 0.5) fillColor = '#7dd98a';
  else if (pct > 0.25) fillColor = '#efb44b';
  else {
    const fl = Math.sin(world.time * 8) * 0.5 + 0.5;
    fillColor = fl > 0.5 ? '#ff5555' : '#ff8888';
  }

  const fillW = barW * pct;
  if (fillW > 0.5){
    ctx.save();
    ctx.shadowColor = fillColor;
    ctx.shadowBlur = 8;
    ctx.fillStyle = fillColor;
    roundRect(ctx, barX, barY, fillW, barH, 9);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  roundRect(ctx, barX + 2, barY + 2, Math.max(0, fillW - 4), barH * 0.35, 5);
  ctx.fill();

  ctx.save();
  ctx.font = 'bold 13px -apple-system,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText('⏱ ' + t.toFixed(1) + 's', VW/2 + 1, barY + barH/2 + 1);
  ctx.fillStyle = pct > 0.25 ? '#0e1017' : '#fff';
  ctx.fillText('⏱ ' + t.toFixed(1) + 's', VW/2, barY + barH/2);
  ctx.restore();

  ctx.save();
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(240,230,210,0.55)';
  ctx.fillText('写字人', barX - 16, barY + barH/2);
  ctx.restore();
}

/* ================================================================
   渲染 — 飘字
================================================================ */
export function drawFloatTexts(){
  if (!world) return;
  for (const ft of world.floatTexts){
    const a = clamp(ft.life / ft.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = 'bold 26px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(ft.text, ft.x + 2, ft.y + 2);
    ctx.fillStyle = '#ff5555';
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.restore();
  }
}

/* ================================================================
   渲染 — 声响惊扰提示（只给人类写字人看）
================================================================ */
export function drawNoiseHint(){
  if (!world || world.over || !world.started) return;
  const wr = world.writer;
  if (wr.isAI || !wr.writing || wr.alertTimer <= 0) return;

  const x = wr.x, y = GROUND_Y - 214;

  ctx.save();
  ctx.globalAlpha = clamp(0.62 + Math.sin(world.time * 18) * 0.34, 0, 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = 'bold 23px -apple-system,sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText('身后有动静！', x + 1.5, y + 1.5);
  ctx.fillStyle = '#ffd98a';
  ctx.fillText('身后有动静！', x, y);

  ctx.globalAlpha = 0.9;
  ctx.font = 'bold 13px -apple-system,sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillText('松开写字键回头', x + 1, y + 27);
  ctx.fillStyle = '#e8e2d4';
  ctx.fillText('松开写字键回头', x, y + 26);

  ctx.restore();
}

/* ================================================================
   渲染 — 危险提示
================================================================ */
export function drawDangerVignette(){
  if (!world || world.over) return;
  const wr = world.writer;
  if (wr.writing) return;

  const intensity = clamp(wr.lookTimer / 0.35, 0, 1);
  const g = ctx.createRadialGradient(VW/2, VH/2, VH*0.32, VW/2, VH/2, VH*0.92);
  g.addColorStop(0, 'rgba(220,60,60,0)');
  g.addColorStop(1, 'rgba(200,40,40,' + (0.22 * intensity) + ')');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VW, VH);
}

/* ================================================================
   渲染 — 321 倒计时
================================================================ */
export function drawCountdown(){
  if (!world || world.started) return;

  ctx.fillStyle = 'rgba(8,10,16,0.42)';
  ctx.fillRect(0, 0, VW, VH);

  const n = Math.ceil(world.countdown);
  if (n <= 0) return;

  const p = clamp(1 - (world.countdown - (n - 1)), 0, 1);
  const scale = 1 + (1 - p) * 0.55;

  let alpha = 1;
  if (p < 0.10) alpha = p / 0.10;
  else if (p > 0.72) alpha = 1 - (p - 0.72) / 0.28;
  alpha = clamp(alpha, 0, 1);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(VW / 2, VH / 2);
  ctx.scale(scale, scale);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.shadowColor = 'rgba(255,217,138,0.65)';
  ctx.shadowBlur = 60;

  const grad = ctx.createLinearGradient(0, -100, 0, 100);
  grad.addColorStop(0, '#fff2c8');
  grad.addColorStop(0.5, '#ffd98a');
  grad.addColorStop(1, '#d9992f');
  ctx.fillStyle = grad;

  ctx.font = '900 200px -apple-system,BlinkMacSystemFont,sans-serif';
  ctx.fillText(String(n), 0, 0);

  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,217,138,' + (0.35 * (1 - p)) + ')';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, 130 + p * 60, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.55 + Math.sin(world.countdown * 6) * 0.15;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#c8cfdd';
  ctx.font = 'bold 16px -apple-system,sans-serif';
  ctx.fillText('准 备', VW / 2, VH / 2 + 180);
  ctx.restore();
}

/* ================================================================
   渲染 — 「开始！」提示
================================================================ */
export function drawStartFlash(){
  if (!world || !world.started || world.startFlash <= 0) return;

  const p = 1 - world.startFlash / START_FLASH_DUR;
  const alpha = clamp(1 - p, 0, 1);
  const scale = 1 + p * 0.7;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(VW / 2, VH / 2);
  ctx.scale(scale, scale);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.shadowColor = 'rgba(255,217,138,0.9)';
  ctx.shadowBlur = 60;

  const grad = ctx.createLinearGradient(0, -70, 0, 70);
  grad.addColorStop(0, '#fff2c8');
  grad.addColorStop(1, '#efb44b');
  ctx.fillStyle = grad;

  ctx.font = '900 150px -apple-system,BlinkMacSystemFont,sans-serif';
  ctx.fillText('开 始 !', 0, 0);

  ctx.restore();
}
