/**
 * 黑板上的「田」：五画逐笔绘制，笔尖位置驱动写字人的手。
 */
import { STROKES, TOTAL_STROKES, CHAR_X, CHAR_Y, CHAR_SIZE } from '../core/config.js';
import { clamp, strokePointAt } from '../core/utils.js';
import { ctx } from '../core/viewport.js';
import { world } from '../game/state.js';

/* ================================================================
   渲染 — 粉笔字「田」
================================================================ */
export function drawOneStrokePath(stroke, t){
  const pts = stroke;
  if (!pts || pts.length < 2) return;

  let total = 0;
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++){
    const dx = pts[i+1][0] - pts[i][0];
    const dy = pts[i+1][1] - pts[i][1];
    const len = Math.sqrt(dx*dx + dy*dy);
    segs.push(len);
    total += len;
  }

  const target = clamp(t, 0, 1) * total;
  let remaining = target;

  ctx.beginPath();
  ctx.moveTo(CHAR_X + pts[0][0]*CHAR_SIZE, CHAR_Y + pts[0][1]*CHAR_SIZE);

  for (let i = 0; i < pts.length - 1; i++){
    if (remaining >= segs[i]){
      ctx.lineTo(CHAR_X + pts[i+1][0]*CHAR_SIZE, CHAR_Y + pts[i+1][1]*CHAR_SIZE);
      remaining -= segs[i];
    } else {
      const k = segs[i] > 0 ? remaining / segs[i] : 0;
      const x = pts[i][0] + (pts[i+1][0] - pts[i][0]) * k;
      const y = pts[i][1] + (pts[i+1][1] - pts[i][1]) * k;
      ctx.lineTo(CHAR_X + x*CHAR_SIZE, CHAR_Y + y*CHAR_SIZE);
      break;
    }
  }
  ctx.stroke();
}

export function drawChalk(){
  const wr = world.writer;
  const total = wr.writeProgress;
  const done  = Math.floor(total);
  const part  = total - done;

  ctx.save();
  ctx.strokeStyle = 'rgba(246,250,255,0.9)';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255,255,255,0.4)';
  ctx.shadowBlur = 6;

  for (let i = 0; i < done; i++){
    drawOneStrokePath(STROKES[i], 1);
  }
  if (done < TOTAL_STROKES && part > 0){
    drawOneStrokePath(STROKES[done], part);
  }
  ctx.restore();
}

export function getChalkPos(){
  const wr = world.writer;
  const total = wr.writeProgress;
  const done = Math.floor(total);
  const part = total - done;
  const idx = Math.min(done, TOTAL_STROKES - 1);
  const t = done >= TOTAL_STROKES ? 1 : part;
  const pt = strokePointAt(STROKES[idx], t);
  return {
    x: CHAR_X + pt[0] * CHAR_SIZE,
    y: CHAR_Y + pt[1] * CHAR_SIZE
  };
}
