/**
 * 特效推进：爆炸、涟漪、粒子的生命周期与屏幕震动衰减。
 * 纯表现层，不参与任何胜负判定。
 */
import { game } from '../core/state.js';

export function updateEffects(dt) {
  for (let i = game.explosions.length - 1; i >= 0; i--) {
    game.explosions[i].t += dt;
    if (game.explosions[i].t >= game.explosions[i].dur) game.explosions.splice(i, 1);
  }
  for (let i = game.ripples.length - 1; i >= 0; i--) {
    game.ripples[i].t += dt;
    if (game.ripples[i].t >= game.ripples[i].dur) game.ripples.splice(i, 1);
  }
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const p = game.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.93;
    p.vy *= 0.93;
    p.life -= dt;
    if (p.life <= 0) game.particles.splice(i, 1);
  }
  if (game.exitFlash > 0) game.exitFlash -= dt;
  if (game.screenShake > 0) game.screenShake = Math.max(0, game.screenShake - dt);
}
