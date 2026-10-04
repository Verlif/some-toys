/**
 * 场景绘制：地面 / 墙体 / 网格、同队伍路径、已知地雷、入口箭头、出口高亮、迷雾层。
 * 全部只读传入的 scene（实时对局传 game，回放传回放场景），不修改任何状态。
 */
import { W, H, TILE, OUTSIDE_COLS, TEAM_COLORS } from '../core/config.js';
import { idx, inBounds, hexToRgb } from '../core/utils.js';
import { game } from '../core/state.js';

/** 底色（画布已随震动偏移，故向外多铺一圈） */
export function drawBackground(ctx) {
  ctx.fillStyle = '#080c12';
  ctx.fillRect(-10, -10, W * TILE + 20, H * TILE + 20);
}

/**
 * 地块：白色道路 / 深蓝灰墙体。
 * 已知雷格暗红；走过且已探明的格子保留队伍色路径（永不消失，只显示同队伍的）。
 */
export function drawGround(ctx, scene = game) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const px = x * TILE, py = y * TILE;

      if (scene.walls[i]) {
        ctx.fillStyle = '#2a3346';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(px, py, TILE, 2);
      } else if (scene.unionKnown[i] === 2) {
        ctx.fillStyle = '#5a1e28';
        ctx.fillRect(px, py, TILE, TILE);
      } else {
        ctx.fillStyle = '#e8eef5';
        ctx.fillRect(px, py, TILE, TILE);
      }
    }
  }

  // 网格线
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= W; x++) { ctx.moveTo(x * TILE + .5, 0); ctx.lineTo(x * TILE + .5, H * TILE); }
  for (let y = 0; y <= H; y++) { ctx.moveTo(0, y * TILE + .5); ctx.lineTo(W * TILE, y * TILE + .5); }
  ctx.stroke();
}

/** 同队伍路径：淡淡的队伍色铺在路面上，越走越密但不会消失 */
export function drawTrails(ctx, scene = game) {
  const trail = scene.displayTrail;
  if (!trail) return;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const t = trail[i];
      if (t < 0 || scene.walls[i]) continue;
      const [r, g, b] = hexToRgb(TEAM_COLORS[t] || '#94a3b8');
      ctx.fillStyle = `rgba(${r},${g},${b},0.22)`;
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      ctx.fillStyle = `rgba(${r},${g},${b},0.30)`;
      ctx.fillRect(x * TILE + TILE / 2 - 1.5, y * TILE + TILE / 2 - 1.5, 3, 3);
    }
  }
}

/** 已被玩家方发现的雷：雾越浓越淡 */
export function drawKnownMines(ctx, scene = game) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (scene.unionKnown[i] === 2 && !scene.walls[i]) {
        const fog = scene.displayFog[i];
        const alpha = 1 - fog * 0.65;
        if (alpha < 0.05) continue;
        const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';   // 阴影
        ctx.beginPath();
        ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ef4444';           // 红雷
        ctx.beginPath();
        ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#7f1d1d';
        ctx.beginPath();
        ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
}

/** 入口：蓝色脉动箭头 */
export function drawEntrances(ctx, scene = game) {
  for (const ey of scene.entranceYs) {
    const px = OUTSIDE_COLS * TILE;
    const py = ey * TILE;
    const pulse = 0.5 + 0.4 * Math.sin(scene.elapsed * 3 + ey);
    ctx.fillStyle = `rgba(96,165,250,${0.35 + pulse * 0.35})`;
    ctx.beginPath();
    ctx.moveTo(px + TILE * 0.2, py + TILE * 0.2);
    ctx.lineTo(px + TILE * 0.9, py + TILE * 0.5);
    ctx.lineTo(px + TILE * 0.2, py + TILE * 0.8);
    ctx.closePath();
    ctx.fill();
  }
}

/** 出口：绿色 3×3 高亮 + 右侧通道；有人到达时短暂闪光 */
export function drawExit(ctx, scene = game) {
  const ex = scene.exitX, ey = scene.exitY;
  const pulse = 0.5 + 0.3 * Math.sin(scene.elapsed * 3) + scene.exitFlash * 0.6;

  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = ex + dx, y = ey + dy;
      if (!inBounds(x, y)) continue;
      ctx.fillStyle = `rgba(34,197,94,${0.10 + pulse * 0.15})`;
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  ctx.strokeStyle = `rgba(34,197,94,${0.6 + pulse * 0.35})`;
  ctx.lineWidth = 2;
  ctx.strokeRect((ex - 1) * TILE + 1.5, (ey - 1) * TILE + 1.5, TILE * 3 - 3, TILE * 3 - 3);
  ctx.fillStyle = `rgba(34,197,94,${0.5 + pulse * 0.4})`;
  ctx.fillRect((ex + 2) * TILE - 2, (ey - 1) * TILE, 3, TILE * 3);
}

/** 迷雾层：盖在地形与已知雷之上、角色之下 */
export function drawFog(ctx, scene = game) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const fog = scene.displayFog[i];
      if (fog < 0.02) continue;
      ctx.fillStyle = `rgba(8,14,24,${fog * 0.9})`;
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }
}
