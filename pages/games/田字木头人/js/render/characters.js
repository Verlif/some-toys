/**
 * 角色绘制：写字人（背对 / 回头插值）、木头人（配色区分身份 + 倒地动画），
 * 以及倒计时阶段的起点线。
 */
import { GROUND_Y, NOISE_COOLDOWN, NOISE_FLASH } from '../core/config.js';
import { clamp, lerp, roundRect } from '../core/utils.js';
import { ctx } from '../core/viewport.js';
import { world } from '../game/state.js';
import { getChalkPos } from './chalk.js';

/* ================================================================
   渲染 — 写字人
================================================================ */
export function drawWriterHead(x, y, r, f){
  const backA = clamp(1 - f * 1.7, 0, 1);
  if (backA > 0.01){
    ctx.globalAlpha = backA;
    ctx.fillStyle = '#31323c';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath(); ctx.arc(x - r*0.28, y - r*0.28, r*0.42, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  const frontA = clamp((f - 0.28) / 0.72, 0, 1);
  if (frontA > 0.01){
    ctx.globalAlpha = frontA;

    ctx.fillStyle = '#f2c9a0';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();

    ctx.fillStyle = '#31323c';
    ctx.beginPath();
    ctx.arc(x, y - 1, r + 1.5, Math.PI, Math.PI*2);
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = '#e5b98e';
    ctx.beginPath(); ctx.arc(x - r*0.96, y + r*0.08, r*0.24, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r*0.96, y + r*0.08, r*0.24, 0, Math.PI*2); ctx.fill();

    const eyeY = y + r*0.18, eyeDX = r*0.36;
    ctx.fillStyle = '#1c1c24';
    ctx.beginPath(); ctx.arc(x - eyeDX, eyeY, 2.9, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + eyeDX, eyeY, 2.9, 0, Math.PI*2); ctx.fill();

    ctx.strokeStyle = '#1c1c24';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - eyeDX - 6, eyeY - 9);
    ctx.lineTo(x - eyeDX + 5, eyeY - 5.5);
    ctx.moveTo(x + eyeDX + 6, eyeY - 9);
    ctx.lineTo(x + eyeDX - 5, eyeY - 5.5);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y + r*0.42, r*0.26, 0.15*Math.PI, 0.85*Math.PI);
    ctx.stroke();

    ctx.fillStyle = 'rgba(230,120,110,0.22)';
    ctx.beginPath(); ctx.arc(x - r*0.55, y + r*0.38, r*0.22, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r*0.55, y + r*0.38, r*0.22, 0, Math.PI*2); ctx.fill();

    ctx.globalAlpha = 1;
  }
}

export function drawWriter(){
  const wr = world.writer;
  const wx = wr.x, gy = GROUND_Y, f = wr.facing;

  const hipY = gy - 58;
  const shoulderY = gy - 132;
  const headY = gy - 158;
  const headR = 23;

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(wx, gy + 4, 32, 9, 0, 0, Math.PI*2);
  ctx.fill();

  ctx.strokeStyle = '#343a52';
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(wx - 10, hipY); ctx.lineTo(wx - 13, gy - 4);
  ctx.moveTo(wx + 10, hipY); ctx.lineTo(wx + 13, gy - 4);
  ctx.stroke();

  const bodyGrad = ctx.createLinearGradient(wx - 26, 0, wx + 26, 0);
  bodyGrad.addColorStop(0, '#4d6ea3');
  bodyGrad.addColorStop(.5, '#5f83bd');
  bodyGrad.addColorStop(1, '#44618f');
  ctx.fillStyle = bodyGrad;
  roundRect(ctx, wx - 26, shoulderY, 52, hipY - shoulderY + 8, 16);
  ctx.fill();

  const chalk = getChalkPos();
  const handX = lerp(chalk.x, wx - 30, f);
  const handY = lerp(chalk.y, hipY - 2, f);

  ctx.strokeStyle = '#5f83bd';
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(wx - 19, shoulderY + 20);
  ctx.lineTo(handX, handY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(wx + 19, shoulderY + 20);
  ctx.lineTo(wx + 28, hipY - 6);
  ctx.stroke();

  if (f < 0.6){
    ctx.fillStyle = '#f2c9a0';
    ctx.beginPath(); ctx.arc(handX, handY, 6.5, 0, Math.PI*2); ctx.fill();
  }

  drawWriterHead(wx, headY, headR, f);

  if (wr.looking && wr.lookTimer > 0.10){
    const a = clamp(1 - (wr.lookTimer - 0.10) * 2.5, 0, 1);
    if (a > 0){
      ctx.save();
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = '#ff6b6b';
      ctx.font = 'bold 34px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', wx + 40, headY - 28);
      ctx.restore();
    }
  }
}

/* ================================================================
   渲染 — 木头人「制造声响」的冷却环与声波
================================================================ */
function drawNoiseGauge(x, y, wolf){
  const R = 9;
  ctx.save();

  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(10,12,20,0.55)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2; ctx.stroke();

  if (wolf.noiseCd <= 0){
    const pulse = 1 + Math.sin(world.time * 7) * 0.14;
    ctx.beginPath(); ctx.arc(x, y, R * 0.52 * pulse, 0, Math.PI*2);
    ctx.fillStyle = '#ffd98a'; ctx.fill();
  } else {
    const p = 1 - wolf.noiseCd / NOISE_COOLDOWN;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, R - 1, -Math.PI/2, -Math.PI/2 + p * Math.PI*2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,217,138,0.34)'; ctx.fill();
  }

  ctx.restore();
}

function drawNoiseWave(px, headY, wolf){
  const t = 1 - wolf.noiseFlash / NOISE_FLASH;
  ctx.save();
  ctx.strokeStyle = '#ffd98a';
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++){
    ctx.globalAlpha = (1 - t) * (0.55 - i * 0.13);
    ctx.lineWidth = 3.2 - i * 0.7;
    ctx.beginPath();
    ctx.arc(px, headY, 16 + t * 40 + i * 11, Math.PI * 0.72, Math.PI * 1.28);
    ctx.stroke();
  }
  ctx.restore();
}

/* ================================================================
   渲染 — 木头人
================================================================ */
export function drawWolf(wolf){
  const px = wolf.x;
  const gy = GROUND_Y;
  const bob = wolf.bob;
  const alive = wolf.alive;
  const fall = wolf.fallT;

  const legY = gy - 4;
  const hipY = gy - 52;
  const shoulderY = gy - 110 + bob;
  const headY = gy - 132 + bob;
  const headR = 20;

  const isP1 = wolf.index === 0;
  const isAI = wolf.isAI;

  let shirt, armCol, legCol;
  if (!alive){
    shirt = ['#4a4a55','#5a5a68'];
    armCol = '#4e4e5a';
    legCol = '#3a3a44';
  } else if (isAI){
    shirt = ['#5f6b80','#7e8aa0'];
    armCol = '#7e8aa0';
    legCol = '#3a4254';
  } else if (isP1){
    shirt = ['#c96a52','#e08268'];
    armCol = '#d4745c';
    legCol = '#2d3247';
  } else {
    shirt = ['#4a6fb5','#6d92d4'];
    armCol = '#5f83bd';
    legCol = '#252d42';
  }

  ctx.save();
  if (fall > 0.01){
    ctx.globalAlpha = 1 - fall * 0.55;
    ctx.translate(px, gy);
    ctx.rotate(fall * 1.15);
    ctx.translate(-px, -gy);
  }

  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(px, gy + 4, 24, 7.5, 0, 0, Math.PI*2);
  ctx.fill();

  const moving = alive && wolf.moving;
  const swing = moving ? Math.sin(wolf.legPhase) * 9 : 0;

  ctx.strokeStyle = legCol;
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px - 7, hipY); ctx.lineTo(px - 7 + swing, legY);
  ctx.moveTo(px + 7, hipY); ctx.lineTo(px + 7 - swing, legY);
  ctx.stroke();

  const bg = ctx.createLinearGradient(px - 20, 0, px + 20, 0);
  bg.addColorStop(0, shirt[0]);
  bg.addColorStop(1, shirt[1]);
  ctx.fillStyle = bg;
  roundRect(ctx, px - 20, shoulderY, 40, hipY - shoulderY + 6, 13);
  ctx.fill();

  ctx.strokeStyle = armCol;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(px - 17, shoulderY + 12);
  ctx.lineTo(px - 23 + swing * 0.6, hipY - 8);
  ctx.moveTo(px + 17, shoulderY + 12);
  ctx.lineTo(px + 23 - swing * 0.6, hipY - 8);
  ctx.stroke();

  ctx.fillStyle = alive ? '#f2c9a0' : '#b0a89e';
  ctx.beginPath(); ctx.arc(px, headY, headR, 0, Math.PI*2); ctx.fill();

  ctx.fillStyle = alive ? (isAI ? '#3a3f4a' : '#2b2b35') : '#3e3e46';
  ctx.beginPath();
  ctx.arc(px, headY, headR, Math.PI, Math.PI*2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = alive ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)';
  ctx.beginPath();
  ctx.arc(px - headR*0.3, headY - headR*0.35, headR*0.4, 0, Math.PI*2);
  ctx.fill();

  if (moving && Math.random() < 0.35){
    ctx.fillStyle = 'rgba(200,180,140,0.18)';
    ctx.beginPath();
    ctx.arc(px + 18 + Math.random()*10, gy - 4 - Math.random()*8,
            2 + Math.random()*3, 0, Math.PI*2);
    ctx.fill();
  }

  if (alive && !isAI) drawNoiseGauge(px, headY - headR - 20, wolf);
  if (alive && wolf.noiseFlash > 0) drawNoiseWave(px, headY, wolf);

  if (!alive){
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#ff6b6b';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('×', px, headY - 30);
  }

  ctx.restore();
}

/* ================================================================
   渲染 — 起点标记
================================================================ */
export function drawStartLine(){
  if (!world || world.started) return;
  if (world.wolves.length === 0) return;

  const leftX = Math.min(...world.wolves.map(w => w.x)) - 24;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,217,138,0.45)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);

  ctx.beginPath();
  ctx.moveTo(leftX, GROUND_Y - 160);
  ctx.lineTo(leftX, GROUND_Y);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.restore();
}
