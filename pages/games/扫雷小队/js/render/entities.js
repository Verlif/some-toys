/**
 * 角色绘制：阴影、朝向点、玩家描边与标签、AI 思考气泡、
 * 扫描进度环、排雷连线与进度条、倒地倒计时、到达标记。
 */
import { TILE, RESPAWN_TIME, TEAM_COLORS } from '../core/config.js';

export function drawEntity(ctx, e, elapsed) {
  const color = TEAM_COLORS[e.teamId];
  const x = e.x;
  const y = e.y + (e.downed || e.arrived ? 0 : Math.sin(e.bob) * 0.9);

  // 阴影
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.beginPath();
  ctx.ellipse(x, e.y + 6, 6, 2.8, 0, 0, Math.PI * 2);
  ctx.fill();

  if (e.arrived) {
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (e.downed) {
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3);
    ctx.moveTo(x + 3, y - 3); ctx.lineTo(x - 3, y + 3);
    ctx.stroke();

    if (e.respawnTimer > 0) {
      const p = 1 - e.respawnTimer / RESPAWN_TIME;
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
      ctx.stroke();

      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 9px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(Math.ceil(e.respawnTimer), x, y + 0.5);
    }
  } else {
    if (e.invuln > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${0.35 + 0.35 * Math.sin(elapsed * 20)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = e.isPlayer ? '#ffffff' : 'rgba(255,255,255,0.28)';
    ctx.lineWidth = e.isPlayer ? 2 : 1;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.stroke();

    // 朝向点
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.arc(x + e.faceX * 2.6, y + e.faceY * 2.6, 1.9, 0, Math.PI * 2);
    ctx.fill();
  }

  // 玩家标签
  if (e.isPlayer) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P' + (e.playerIndex + 1), x, y - 12);
  }

  // AI 思考气泡
  if (!e.isPlayer && e.thinkTimer > 0 && !e.downed && !e.arrived) {
    const bx = x, by = y - 16;
    ctx.fillStyle = 'rgba(30,41,59,0.92)';
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(bx, by, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('…', bx, by - 1);
  }

  // 扫描进度
  if (e.scanTimer > 0) {
    const p = 1 - e.scanTimer / e.scanMax;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
    ctx.stroke();

    ctx.strokeStyle = color + '55';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(x, y, e.scanRadius * TILE, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 排雷进度
  if (e.defuseTimer > 0 && e.defuseTarget) {
    const p = 1 - e.defuseTimer / e.defuseMax;
    const tx = e.defuseTarget.x * TILE + TILE / 2;
    const ty = e.defuseTarget.y * TILE + TILE / 2;

    // 连线
    ctx.strokeStyle = `rgba(251,191,36,${0.65 + 0.35 * Math.sin(elapsed * 15)})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);

    // 目标框
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(tx - 11, ty - 11, 22, 22);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.strokeRect(tx - 11, ty - 11, 22, 22);

    // 进度填充
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(tx - 9, ty + 7 - 14 * p, 18, 14 * p);

    // 持续按住提示（玩家）
    if (e.isPlayer) {
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 9px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('按住…', tx, ty - 15);
    }
  }
}
