/**
 * 每帧推进：倒计时 → 写字人 → 木头人 → 回头惩罚 → 飘字 → 结算。
 *
 * 这是唯一按 dt 改写世界的地方；渲染层只读不写。
 * dt 已在主循环里夹到 0.05 秒以内，卡顿时物理不会失控。
 */
import { VW, LOOK_PENALTY, START_FLASH_DUR } from '../core/config.js';
import { sfxCountdown, sfxPenalty, sfxTimeUp } from '../core/audio.js';
import { world } from './state.js';
import { updateWriter } from './writer.js';
import { updateWolves } from './wolf.js';
import { endGame } from './match.js';
import { showResult } from '../ui/screens.js';

/* ================================================================
   更新
================================================================ */
export function update(dt){
  if (!world) return;
  if (world.paused) return;

  /* ---------- 倒计时阶段 ---------- */
  if (!world.started){
    world.countdown -= dt;

    const n = Math.ceil(world.countdown);
    if (n !== world.lastCountdownNum && n > 0){
      world.lastCountdownNum = n;
      sfxCountdown(n);
    }

    if (world.countdown <= 0){
      world.countdown = 0;
      world.started = true;
      world.startFlash = START_FLASH_DUR;
      sfxCountdown(0);
    }
    return;
  }

  if (world.startFlash > 0) world.startFlash = Math.max(0, world.startFlash - dt);

  if (world.shake > 0) world.shake = Math.max(0, world.shake - dt * 3.2);
  if (world.timeFlash > 0) world.timeFlash = Math.max(0, world.timeFlash - dt * 2.2);

  if (world.active){
    const wr = world.writer;
    const wasWriting = wr.writing;

    world.time += dt;
    updateWriter(dt);
    updateWolves(dt);

    if (!world.over && wasWriting && !wr.writing){
      world.writerTimeLeft = Math.max(0, world.writerTimeLeft - LOOK_PENALTY);
      world.timeFlash = 1;
      world.stats.looks++;
      sfxPenalty();

      world.floatTexts.push({
        x: VW / 2, y: 78,
        text: '-' + LOOK_PENALTY + 's',
        life: 0.9, maxLife: 0.9
      });

      if (world.writerTimeLeft <= 0){
        world.writerTimeLeft = 0;
        sfxTimeUp();
        endGame('wolf', '写字人的时间耗尽了');
      }
    }

    for (let i = world.floatTexts.length - 1; i >= 0; i--){
      const ft = world.floatTexts[i];
      ft.life -= dt;
      ft.y -= dt * 26;
      if (ft.life <= 0) world.floatTexts.splice(i, 1);
    }
  }

  if (world.over && world.overlayDelay > 0){
    world.overlayDelay -= dt;
    if (world.overlayDelay <= 0){
      world.overlayDelay = 0;
      showResult();
    }
  }
}
