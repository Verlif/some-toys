/**
 * 旗帜绘制：画在迷雾之上，所以全图任何位置都看得见（这也是夺旗玩法的意义）。
 *
 * 未被夺走的旗：旗杆 + 飘动旗面 + 地面光晕，带呼吸脉动；
 * 已被某队夺走：降透明度、换成该队颜色，补一个 ✓。
 */
import { TILE, TEAM_COLORS } from '../core/config.js';
import { game } from '../core/state.js';

export function drawFlags(ctx, scene = game) {
  const flags = scene.flags || game.flags;
  if (!flags || !flags.length) return;

  for (const f of flags) {
    const px = f.x * TILE + TILE / 2;
    const py = f.y * TILE + TILE / 2;
    const taken = f.takenBy >= 0;
    const color = taken ? (TEAM_COLORS[f.takenBy] || '#94a3b8') : '#fbbf24';
    const pulse = 0.5 + 0.5 * Math.sin(scene.elapsed * 3 + f.x * 0.7 + f.y * 0.4);

    ctx.save();
    ctx.globalAlpha = taken ? 0.45 : 1;

    // 地面光晕
    if (!taken) {
      const g = ctx.createRadialGradient(px, py, 0, px, py, TILE * 1.6);
      g.addColorStop(0, `rgba(251,191,36,${0.30 + pulse * 0.25})`);
      g.addColorStop(1, 'rgba(251,191,36,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, TILE * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 旗杆
    const topY = py - TILE * 0.62;
    ctx.strokeStyle = taken ? color : '#e2e8f0';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(px - 2.5, py + TILE * 0.34);
    ctx.lineTo(px - 2.5, topY);
    ctx.stroke();

    // 旗面（随时间轻微摆动）
    const wave = Math.sin(scene.elapsed * 5 + f.y) * 1.2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(px - 2.5, topY);
    ctx.lineTo(px + TILE * 0.44, topY + 2.2 + wave);
    ctx.lineTo(px - 2.5, topY + TILE * 0.42);
    ctx.closePath();
    ctx.fill();

    if (taken) {
      // 已夺走：画个勾表示「这队拿下了」
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(px - 4, py + 1);
      ctx.lineTo(px - 1, py + 4.5);
      ctx.lineTo(px + 5, py - 3.5);
      ctx.stroke();
    } else {
      // 未夺：旗杆底座
      ctx.fillStyle = 'rgba(226,232,240,.75)';
      ctx.fillRect(px - 5, py + TILE * 0.32, 7, 1.6);
    }

    ctx.restore();
  }
}
