/**
 * 主渲染：上帝视角地图、道具、声波射线、角色与玩家标记。
 *
 * 渲染只读状态，不改游戏逻辑（唯一例外是墙壁记忆的过期清理）。
 *
 * 关于插值：模拟是固定 60Hz 步长，而显示可能是 144Hz。
 * 每个模拟步开始前模拟层会把当前坐标存进 prevX/prevY，
 * 这里用 gstate.renderAlpha 在 prev → current 之间插值，画面才顺滑。
 * 联机时客户端同样受益：快照到来时把旧坐标写进 prev，两次快照之间插值。
 */
import {
  TILE, SOUND_SPEED, PLAYER_COLORS, PLAYER_MARKER_PULSE_SPEED,
  WALL_MEMORY_HOLD, WALL_MEMORY_FADE, SEEKER_R, HIDER_R, ITEM_RADIUS
} from '../core/config.js';
import { gstate } from '../core/state.js';
import { visualNowSec } from '../core/timer.js';
import { clamp, lerp } from '../core/utils.js';
import { isFrozen, isHasted, isRevealedTo } from '../core/status.js';
import { teamOf } from '../core/teams.js';
import { itemTypeOf } from '../world/items.js';
import { dom } from '../ui/dom.js';
import {
  beginWorldTransform, waveVisibleToPlayer,
  drawWallMemories, renderDetectFlashes, drawDetectFlash, flashIntensity
} from './sight.js';
import { entitiesVisibleTo, canSeeEntity } from '../core/vision.js';

/* ============================================================
   插值辅助
   ============================================================ */
const alpha = () => clamp(gstate.renderAlpha ?? 1, 0, 1);
const rx = e => (e.prevX === undefined ? e.x : lerp(e.prevX, e.x, alpha()));
const ry = e => (e.prevY === undefined ? e.y : lerp(e.prevY, e.y, alpha()));

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

    const waveAlpha = Math.max(0.10, 0.9 * (1 - ratio * 0.85));
    const isBig = wave.strength >= 1.0;

    ctx.strokeStyle = `rgba(140, 220, 255, ${waveAlpha})`;
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
   道具（所有角色都看得见 —— 需求）
   ============================================================ */
export function drawItems(nowT) {
  const ctx = dom.ctx;
  for (const item of gstate.items) {
    const type = itemTypeOf(item);
    if (!type) continue;
    const x = item.prevX === undefined ? item.x : lerp(item.prevX, item.x, alpha());
    const y = item.prevY === undefined ? item.y : lerp(item.prevY, item.y, alpha());
    const pulse = 0.5 + 0.5 * Math.sin(nowT * 3.4 + item.id);
    const r = ITEM_RADIUS;

    // 光晕
    ctx.save();
    ctx.globalAlpha = 0.22 + pulse * 0.18;
    ctx.fillStyle = type.color;
    ctx.beginPath();
    ctx.arc(x, y, r + 8 + pulse * 3, 0, Math.PI * 2);
    ctx.fill();

    // 本体
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8, 14, 24, 0.85)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = type.color;
    ctx.stroke();

    // 图标
    ctx.globalAlpha = 0.95;
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = type.color;
    ctx.fillText(type.icon, x, y + 0.5);

    // 即将消失时闪烁提示
    const remain = item.expireAt - visualNowSec();
    if (remain < 5) {
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(nowT * 10);
      ctx.beginPath();
      ctx.arc(x, y, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = type.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';
}

/* ============================================================
   角色
   ============================================================ */
function drawPlayerMarkers(nowT, labelPlayers) {
  const ctx = dom.ctx;
  for (let i = 0; i < gstate.players.length; i++) {
    const p = gstate.players[i];
    if (!p || (p.type === 'hider' && !p.alive)) continue;
    const px = rx(p), py = ry(p);
    const pulse = 0.5 + 0.5 * Math.sin(nowT * PLAYER_MARKER_PULSE_SPEED + i * Math.PI);
    const outerR = 13 + pulse * 6;
    const markerColor = PLAYER_COLORS[i] || PLAYER_COLORS[0];

    ctx.beginPath();
    ctx.arc(px, py, outerR, 0, Math.PI * 2);
    ctx.strokeStyle = markerColor;
    ctx.globalAlpha = 0.45 + pulse * 0.4;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.globalAlpha = 1;

    const innerR = 7 + pulse * 2;
    ctx.beginPath();
    ctx.arc(px, py, innerR, 0, Math.PI * 2);
    ctx.fillStyle = markerColor;
    ctx.globalAlpha = 0.55 + pulse * 0.3;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.arc(px, py, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.85 + pulse * 0.15})`;
    ctx.fill();

    // 状态效果：定格 / 加速
    drawStatusRings(px, py, p, nowT);

    if (labelPlayers && gstate.cfgPlayerCount === 2) {
      ctx.font = '700 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = markerColor;
      ctx.fillText(i === 0 ? 'P1' : 'P2', px, py - 18);
    }
  }
}

/** 定格 / 加速 / 显形 的视觉提示 */
function drawStatusRings(x, y, e, nowT) {
  const ctx = dom.ctx;
  if (isFrozen(e)) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = '#7fd3ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(x, y, e.r + 5, nowT * 1.6, nowT * 1.6 + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  if (isHasted(e)) {
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = '#8ef0a8';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x, y, e.r + 3.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/* ============================================================
   近身可见的角色
   ============================================================ */
/**
 * 游戏中只画出玩家“看得见”的其他角色：
 *   · 3 格以内的任何角色
 *   · 搜捕者之间的互相位置
 *   · 被道具显形的敌人
 * 看不见的人不会画，所以黑暗里的对手依旧只靠声波暴露。
 */
function drawVisibleCharacters(nowT) {
  const ctx = dom.ctx;
  const me = gstate.player;
  if (!me) return;
  const visible = entitiesVisibleTo(me);
  const myTeam = teamOf(me);

  for (const e of visible) {
    if (e.isPlayer) continue;
    const px = rx(e), py = ry(e);
    const revealed = isRevealedTo(e, myTeam);

    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, e.r + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = e.type === 'seeker' ? 'rgba(255, 80, 110, 0.9)' : 'rgba(60, 220, 150, 0.85)';
    ctx.fill();

    // 细描边，让近身的角色在黑洞洞的画面里更清楚
    ctx.strokeStyle = e.type === 'seeker' ? 'rgba(255, 170, 190, 0.85)' : 'rgba(180, 255, 220, 0.8)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 道具显形：额外套一圈醒目的脉冲，明确“这是被显形出来的”
    if (revealed) {
      const pulse = 0.5 + 0.5 * Math.sin(nowT * 9);
      ctx.globalAlpha = 0.55 + pulse * 0.4;
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, e.r + 6 + pulse * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    drawStatusRings(px, py, e, nowT);
  }

  // 双人模式下给看得见的队友标上 P1 / P2
  if (gstate.cfgPlayerCount === 2) {
    for (let i = 0; i < gstate.players.length; i++) {
      const p = gstate.players[i];
      if (!p || p === me || !canSeeEntity(me, p)) continue;
      const px = rx(p), py = ry(p);
      const pulse = 0.5 + 0.5 * Math.sin(nowT * PLAYER_MARKER_PULSE_SPEED + i * Math.PI);
      ctx.save();
      ctx.globalAlpha = 0.5 + pulse * 0.4;
      ctx.strokeStyle = PLAYER_COLORS[i] || PLAYER_COLORS[0];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 12 + pulse * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = '700 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = PLAYER_COLORS[i] || PLAYER_COLORS[0];
      ctx.fillText(i === 0 ? 'P1' : 'P2', px, py - 17);
      ctx.restore();
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

  // 道具全场可见：对局中始终画出来
  if (inGame) drawItems(nowT);

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
        const hx = rx(h), hy = ry(h);
        dom.ctx.beginPath();
        dom.ctx.moveTo(hx - 5, hy - 5); dom.ctx.lineTo(hx + 5, hy + 5);
        dom.ctx.moveTo(hx + 5, hy - 5); dom.ctx.lineTo(hx - 5, hy + 5);
        dom.ctx.stroke();
        dom.ctx.restore();
        continue;
      }
      dom.ctx.beginPath();
      dom.ctx.arc(rx(h), ry(h), h.r + 1.5, 0, Math.PI * 2);
      dom.ctx.fillStyle = 'rgba(60, 220, 150, 0.85)';
      dom.ctx.fill();
      drawStatusRings(rx(h), ry(h), h, nowT);
    }
    for (const s of gstate.seekers) {
      dom.ctx.beginPath();
      dom.ctx.arc(rx(s), ry(s), s.r + 1.5, 0, Math.PI * 2);
      dom.ctx.fillStyle = 'rgba(255, 80, 110, 0.9)';
      dom.ctx.fill();
      drawStatusRings(rx(s), ry(s), s, nowT);
    }
    drawPlayerMarkers(nowT, true);
  } else if (gstate.players.length && gstate.player) {
    // 游戏进行中：先画近身可见的其他角色，再画自己的标记
    drawVisibleCharacters(nowT);
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
    let wmAlpha = age < WALL_MEMORY_HOLD
      ? wm.strength * 0.55
      : wm.strength * 0.55 * (1 - (age - WALL_MEMORY_HOLD) / WALL_MEMORY_FADE);
    wmAlpha = clamp(wmAlpha, 0, 1);
    if (!wmAlpha) continue;
    const px = wm.gx * TILE, py = wm.gy * TILE;
    ctx.fillStyle = `rgba(70,130,200,${wmAlpha * 0.9})`;
    ctx.fillRect(px, py, TILE, TILE);
    ctx.strokeStyle = `rgba(150,220,255,${wmAlpha * 1.3})`;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
  }
}

export function drawReplayItems(frame) {
  if (!frame?.items?.length) return;
  const ctx = dom.ctx;
  for (const it of frame.items) {
    const type = itemTypeOf({ type: it.type });
    if (!type) continue;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(it.x, it.y, ITEM_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,14,24,0.85)';
    ctx.fill();
    ctx.strokeStyle = type.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = type.color;
    ctx.fillText(type.icon, it.x, it.y + 0.5);
    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';
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
  drawReplayItems(frame);
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
    if (e.frozen) {
      dom.ctx.save();
      dom.ctx.globalAlpha = 0.8;
      dom.ctx.strokeStyle = '#7fd3ff';
      dom.ctx.lineWidth = 2;
      dom.ctx.beginPath();
      dom.ctx.arc(e.x, e.y, (e.r || 8) + 5, 0, Math.PI * 2);
      dom.ctx.stroke();
      dom.ctx.restore();
    }
    if (e.revealed) {
      dom.ctx.save();
      dom.ctx.globalAlpha = 0.8;
      dom.ctx.strokeStyle = '#ffd166';
      dom.ctx.lineWidth = 2;
      dom.ctx.beginPath();
      dom.ctx.arc(e.x, e.y, (e.r || 8) + 7, 0, Math.PI * 2);
      dom.ctx.stroke();
      dom.ctx.restore();
    }
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
