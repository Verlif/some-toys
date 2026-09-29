/**
 * 主渲染：上帝视角地图、声波射线、角色与玩家标记。
 *
 * 渲染只读状态，不改游戏逻辑（唯一例外是墙壁记忆的过期清理）。
 */
import {
  TILE, SOUND_SPEED, PLAYER_COLORS, PLAYER_MARKER_PULSE_SPEED,
  WALL_MEMORY_HOLD, WALL_MEMORY_FADE, SEEKER_R, HIDER_R
} from '../core/config.js';
import { gstate } from '../core/state.js';
import { visualNowSec } from '../core/timer.js';
import { clamp } from '../core/utils.js';
import { dom } from '../ui/dom.js';
import {
  beginWorldTransform, waveVisibleToPlayer,
  drawWallMemories, renderDetectFlashes, drawDetectFlash, flashIntensity
} from './sight.js';

/* ============================================================
   上帝视角完整地图
============================================================ */
export function drawSpectatorMap() {
  const ctx = dom.ctx;
  for (let y = 0; y < gstate.grid.length; y++) {
    for (let x = 0; x < gstate.grid[0].length; x++) {
      const px = x * TILE, py = y * TILE;
      if (gstate.grid[y][x] === 1) {
        ctx.fillStyle = 'rgba(34, 48, 72, 0.85)';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.strokeStyle = 'rgba(90, 140, 220, 0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
      } else {
        ctx.fillStyle = 'rgba(10, 16, 26, 0.55)';
        ctx.fillRect(px, py, TILE, TILE);
      }
    }
  }
}

/* ============================================================
   声波射线
============================================================ */
/** 画一组声波（含尚未到达的线段裁剪）。waves 元素需带 age / maxRadius / rays / strength */
export function drawSoundWaves(waves) {
  const ctx = dom.ctx;
  for (const wave of waves) {
    const frontDist = wave.age * SOUND_SPEED;
    if (frontDist <= 0) continue;
    const ratio = clamp(frontDist / wave.maxRadius, 0, 1);
    if (ratio >= 1 && frontDist - wave.maxRadius > 0.9 * SOUND_SPEED) continue;

    const alpha = Math.max(0.10, 0.9 * (1 - ratio * 0.85));
    const isBig = wave.strength >= 1.0;

    ctx.strokeStyle = `rgba(140, 220, 255, ${alpha})`;
    ctx.lineWidth = isBig ? 2.0 : 1.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    for (const path of wave.rays || []) {
      if (path.length < 2) continue;
      ctx.moveTo(path[0].x, path[0].y);
      for (let j = 1; j < path.length; j++) {
        const p = path[j];
        if (p.dist <= frontDist) {
          ctx.lineTo(p.x, p.y);
        } else {
          const prev = path[j - 1];
          const segLen = p.dist - prev.dist;
          if (segLen > 0.001) {
            const tt = clamp((frontDist - prev.dist) / segLen, 0, 1);
            ctx.lineTo(prev.x + (p.x - prev.x) * tt, prev.y + (p.y - prev.y) * tt);
          }
          break;
        }
      }
    }
    ctx.stroke();
  }
}

/* ============================================================
   角色
============================================================ */
function drawPlayerMarkers(nowT, labelPlayers) {
  const ctx = dom.ctx;
  for (let i = 0; i < gstate.players.length; i++) {
    const p = gstate.players[i];
    if (!p || (p.type === 'hider' && !p.alive)) continue;
    const pulse = 0.5 + 0.5 * Math.sin(nowT * PLAYER_MARKER_PULSE_SPEED + i * Math.PI);
    const outerR = 13 + pulse * 6;
    const markerColor = PLAYER_COLORS[i] || PLAYER_COLORS[0];

    ctx.beginPath();
    ctx.arc(p.x, p.y, outerR, 0, Math.PI * 2);
    ctx.strokeStyle = markerColor;
    ctx.globalAlpha = 0.45 + pulse * 0.4;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.globalAlpha = 1;

    const innerR = 7 + pulse * 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, innerR, 0, Math.PI * 2);
    ctx.fillStyle = markerColor;
    ctx.globalAlpha = 0.55 + pulse * 0.3;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.85 + pulse * 0.15})`;
    ctx.fill();

    if (labelPlayers && gstate.cfgPlayerCount === 2) {
      ctx.font = '700 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = markerColor;
      ctx.fillText(i === 0 ? 'P1' : 'P2', p.x, p.y - 18);
    }
  }
}

/* ============================================================
   主渲染
============================================================ */
export function render() {
  beginWorldTransform();
  if (gstate.state === 'menu') return;

  const nowT = visualNowSec();
  const inGame = (gstate.state === 'playing' || gstate.state === 'countdown');
  const showEffects = inGame || gstate.state === 'over' || gstate.state === 'resultAnimation';
  // 结算 / 结果动画 / 观战时显示上帝视角地图
  const showFullMap = gstate.spectator || gstate.state === 'over' || gstate.state === 'resultAnimation';

  if (showFullMap) {
    dom.ctx.save();
    // 结算时地图更透一些，避免盖住结算面板文字
    if (gstate.state === 'over') dom.ctx.globalAlpha = 0.55;
    drawSpectatorMap();
    dom.ctx.restore();
  }

  // 墙壁记忆只在游戏中显示
  if (showEffects) drawWallMemories();

  // 声波射线：游戏结束后保留终局瞬间的所有声波，不再继续推进
  if (showEffects) {
    const visibleWaves = gstate.soundWaves.filter(waveVisibleToPlayer);
    drawSoundWaves(visibleWaves);
    renderDetectFlashes();
  }

  if (showFullMap) {
    // 结算 / 观战：显示所有角色
    for (const h of gstate.hiders) {
      if (!h.alive) {
        // 被抓的躲藏者：灰色 X
        dom.ctx.save();
        dom.ctx.globalAlpha = gstate.state === 'over' ? 0.35 : 0.45;
        dom.ctx.strokeStyle = '#5a6a8c';
        dom.ctx.lineWidth = 2;
        dom.ctx.beginPath();
        dom.ctx.moveTo(h.x - 5, h.y - 5); dom.ctx.lineTo(h.x + 5, h.y + 5);
        dom.ctx.moveTo(h.x + 5, h.y - 5); dom.ctx.lineTo(h.x - 5, h.y + 5);
        dom.ctx.stroke();
        dom.ctx.restore();
        continue;
      }
      dom.ctx.beginPath();
      dom.ctx.arc(h.x, h.y, h.r + 1.5, 0, Math.PI * 2);
      dom.ctx.fillStyle = 'rgba(60, 220, 150, 0.85)';
      dom.ctx.fill();
    }
    for (const s of gstate.seekers) {
      dom.ctx.beginPath();
      dom.ctx.arc(s.x, s.y, s.r + 1.5, 0, Math.PI * 2);
      dom.ctx.fillStyle = 'rgba(255, 80, 110, 0.9)';
      dom.ctx.fill();
    }
    drawPlayerMarkers(nowT, true);
  } else if (gstate.players.length) {
    // 游戏中只显示玩家自己的标记（AI 不可见）
    drawPlayerMarkers(nowT, false);
  }
}

/* ============================================================
   回放渲染：从快照重建上帝视角
============================================================ */
export function drawReplayWallMemories(t, frame) {
  const ctx = dom.ctx;
  if (!frame?.wallMemories?.length) return;
  const totalLife = WALL_MEMORY_HOLD + WALL_MEMORY_FADE;
  for (const wm of frame.wallMemories) {
    const arrivals = wm.arrivals.filter(a => t - a < totalLife && a <= t);
    if (!arrivals.length) continue;
    const latest = Math.max(...arrivals);
    const age = t - latest;
    let alpha = age < WALL_MEMORY_HOLD
      ? wm.strength * 0.55
      : wm.strength * 0.55 * (1 - (age - WALL_MEMORY_HOLD) / WALL_MEMORY_FADE);
    alpha = clamp(alpha, 0, 1);
    if (!alpha) continue;
    const px = wm.gx * TILE, py = wm.gy * TILE;
    ctx.fillStyle = `rgba(70,130,200,${alpha * 0.9})`;
    ctx.fillRect(px, py, TILE, TILE);
    ctx.strokeStyle = `rgba(150,220,255,${alpha * 1.3})`;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
  }
}

export function drawReplayWaves(t, frame) {
  if (!frame?.waves?.length) return;
  const waves = frame.waves.map(w => ({ ...w, age: t - w.emitTime }));
  drawSoundWaves(waves);

  for (const wave of waves) {
    const frontDist = Math.max(0, wave.age * SOUND_SPEED);
    for (const hit of wave.hits || []) {
      if (frontDist < hit.dist) continue;
      const since = (frontDist - hit.dist) / SOUND_SPEED;
      if (since < 0 || since > 0.9) continue;
      const intensity = flashIntensity(since, 0.9);
      if (intensity <= 0) continue;
      drawDetectFlash(hit.x, hit.y, intensity);
    }
  }
}

export function renderReplay(t, frame, entities) {
  drawSpectatorMap();
  drawReplayWallMemories(t, frame);
  drawReplayWaves(t, frame);

  for (const e of entities) {
    if (e.type === 'hider' && !e.alive) {
      dom.ctx.save();
      dom.ctx.globalAlpha = 0.35;
      dom.ctx.strokeStyle = '#5a6a8c';
      dom.ctx.lineWidth = 2;
      dom.ctx.beginPath();
      dom.ctx.moveTo(e.x - 5, e.y - 5); dom.ctx.lineTo(e.x + 5, e.y + 5);
      dom.ctx.moveTo(e.x + 5, e.y - 5); dom.ctx.lineTo(e.x - 5, e.y + 5);
      dom.ctx.stroke();
      dom.ctx.restore();
      continue;
    }
    dom.ctx.beginPath();
    dom.ctx.arc(e.x, e.y, e.r || (e.type === 'seeker' ? SEEKER_R : HIDER_R), 0, Math.PI * 2);
    dom.ctx.fillStyle = e.type === 'seeker' ? 'rgba(255,80,110,.90)' : 'rgba(60,220,150,.85)';
    dom.ctx.fill();
  }

  const replayPlayers = entities.filter(e => e.isPlayer);
  for (let i = 0; i < replayPlayers.length; i++) {
    const p = replayPlayers[i];
    if (p.type === 'hider' && !p.alive) continue;
    const c = PLAYER_COLORS[i] || PLAYER_COLORS[0];
    const pulse = 0.5 + 0.5 * Math.sin(t * PLAYER_MARKER_PULSE_SPEED + i * Math.PI);
    dom.ctx.save();
    dom.ctx.strokeStyle = c;
    dom.ctx.globalAlpha = 0.55 + pulse * 0.35;
    dom.ctx.lineWidth = 2.5;
    dom.ctx.shadowColor = c;
    dom.ctx.shadowBlur = 12;
    dom.ctx.beginPath();
    dom.ctx.arc(p.x, p.y, 13 + pulse * 5, 0, Math.PI * 2);
    dom.ctx.stroke();
    dom.ctx.globalAlpha = 1;
    dom.ctx.shadowBlur = 0;
    dom.ctx.font = '800 10px sans-serif';
    dom.ctx.textAlign = 'center';
    dom.ctx.fillStyle = c;
    dom.ctx.fillText(i === 0 ? 'P1' : 'P2', p.x, p.y - 17);
    dom.ctx.restore();
  }
}
