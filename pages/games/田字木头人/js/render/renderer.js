/**
 * 渲染主函数：把逻辑坐标 1440×560 映射到画布，然后按层绘制。
 * 顺序：背景 → 黑板 → 粉笔字 → 写字人 → 起点线 → 木头人 → 危险提示 → HUD。
 */
import { canvas, ctx, dpr, cssW, cssH, viewOx, viewOy, viewScale } from '../core/viewport.js';
import { world } from '../game/state.js';
import { drawBackground, drawBoard } from './background.js';
import { drawChalk } from './chalk.js';
import { drawWriter, drawWolf, drawStartLine } from './characters.js';
import {
  drawTimer, drawFloatTexts, drawNoiseHint, drawDangerVignette,
  drawCountdown, drawStartFlash
} from './hud.js';

/* ================================================================
   渲染主函数
================================================================ */
export function render(){
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = '#0e1017';
  ctx.fillRect(0, 0, cssW, cssH);

  ctx.save();
  ctx.translate(viewOx, viewOy);
  ctx.scale(viewScale, viewScale);

  if (world && world.shake > 0){
    const s = world.shake * 9;
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  drawBackground();
  drawBoard();

  if (world){
    drawChalk();
    drawWriter();
    drawStartLine();
    for (const wolf of world.wolves) drawWolf(wolf);
    drawDangerVignette();
    drawTimer();
    drawFloatTexts();
    drawNoiseHint();
    drawCountdown();
    drawStartFlash();
  }

  ctx.restore();
}
