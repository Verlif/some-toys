/**
 * 渲染主函数：合成玩家方视野与路径 → 按层绘制 → 结束。
 * 只读 scene（默认 game），不产生任何游戏逻辑副作用。
 */
import { game } from '../core/state.js';
import { computeUnionKnown, computeDisplayFog, computeDisplayTrail } from '../sim/vision.js';
import {
  drawBackground, drawGround, drawTrails, drawKnownMines,
  drawEntrances, drawExit, drawFog
} from './tiles.js';
import { drawEntity } from './entities.js';
import {
  drawRipples, drawDelayedMineWarnings,
  drawParticles, drawExplosions, drawCountdown
} from './effects.js';

export function render(ctx, scene = game) {
  if (!scene.walls) return;

  // 实时对局：先合成玩家方视野与路径；回放场景已自带快照
  if (scene === game) {
    computeUnionKnown();
    computeDisplayFog();
    computeDisplayTrail();
  }

  // 屏幕震动偏移
  let shakeX = 0, shakeY = 0;
  if (scene.screenShake > 0) {
    shakeX = (Math.random() - 0.5) * 6 * scene.screenShake;
    shakeY = (Math.random() - 0.5) * 6 * scene.screenShake;
  }

  ctx.save();
  ctx.translate(shakeX, shakeY);

  drawBackground(ctx);
  drawGround(ctx, scene);
  drawTrails(ctx, scene);
  drawKnownMines(ctx, scene);
  drawEntrances(ctx, scene);
  drawExit(ctx, scene);
  drawRipples(ctx, scene);
  drawDelayedMineWarnings(ctx, scene);
  drawFog(ctx, scene);

  // 玩家画在 AI 之上
  const sorted = [...scene.entities].sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
  for (const e of sorted) drawEntity(ctx, e, scene.elapsed);

  drawParticles(ctx, scene);
  drawExplosions(ctx, scene);
  drawCountdown(ctx, scene);

  ctx.restore();
}
