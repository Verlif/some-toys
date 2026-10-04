/**
 * 场景绘制：墙面、地面、踢脚线与黑板。
 */
import { VW, VH, GROUND_Y, BOARD, INNER } from '../core/config.js';
import { ctx } from '../core/viewport.js';
import { roundRect } from '../core/utils.js';

/* ================================================================
   渲染 — 背景
================================================================ */
export function drawBackground(){
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  g.addColorStop(0, '#2b3050');
  g.addColorStop(1, '#191d2e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VW, GROUND_Y);

  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = 1;
  for (let x = 0; x < VW; x += 60){
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, GROUND_Y); ctx.stroke();
  }

  ctx.fillStyle = '#141726';
  ctx.fillRect(0, GROUND_Y - 16, VW, 16);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0, GROUND_Y - 16, VW, 1.5);

  const fg = ctx.createLinearGradient(0, GROUND_Y, 0, VH);
  fg.addColorStop(0, '#413729');
  fg.addColorStop(1, '#282216');
  ctx.fillStyle = fg;
  ctx.fillRect(0, GROUND_Y, VW, VH - GROUND_Y);

  ctx.fillStyle = 'rgba(255,220,160,0.07)';
  ctx.fillRect(0, GROUND_Y, VW, 2);

  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  for (let x = 0; x < VW; x += 90){
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y);
    ctx.lineTo(x - 40, VH);
    ctx.stroke();
  }
}

/* ================================================================
   渲染 — 黑板
================================================================ */
export function drawBoard(){
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#6b4a2f';
  roundRect(ctx, BOARD.x, BOARD.y, BOARD.w, BOARD.h, 10);
  ctx.fill();
  ctx.restore();

  const bg = ctx.createLinearGradient(BOARD.x, BOARD.y, BOARD.x, BOARD.y + BOARD.h);
  bg.addColorStop(0, '#7d5738');
  bg.addColorStop(1, '#52371e');
  ctx.fillStyle = bg;
  roundRect(ctx, BOARD.x, BOARD.y, BOARD.w, BOARD.h, 10);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,220,170,0.12)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, BOARD.x+2, BOARD.y+2, BOARD.w-4, BOARD.h-4, 9);
  ctx.stroke();

  const ig = ctx.createLinearGradient(INNER.x, INNER.y, INNER.x+INNER.w, INNER.y+INNER.h);
  ig.addColorStop(0, '#1d352a');
  ig.addColorStop(.5, '#152a20');
  ig.addColorStop(1, '#1d352a');
  ctx.fillStyle = ig;
  roundRect(ctx, INNER.x, INNER.y, INNER.w, INNER.h, 4);
  ctx.fill();

  const rg = ctx.createLinearGradient(0, INNER.y, 0, INNER.y + INNER.h * 0.45);
  rg.addColorStop(0, 'rgba(255,255,255,0.045)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = rg;
  roundRect(ctx, INNER.x, INNER.y, INNER.w, INNER.h * 0.45, 4);
  ctx.fill();
}
