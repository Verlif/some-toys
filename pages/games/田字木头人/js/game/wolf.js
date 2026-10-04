/**
 * 木头人：AI 行为与人类移动。
 *
 * AI 有两条关键行为：
 *   1. 预判暂停 —— 笔画快写完时，感觉「他快回头了」，先停一下；
 *   2. 回头反应 —— 写字人回头瞬间不立刻定住，而是滑行 0.12~0.46 秒再停，
 *      反应结束时若对方仍在看，判定被抓。
 */
import {
  MIN_DIST, CATCH_DIST, WOLF_SPEED, AI_WOLF_SPEED, AI_REACT_MIN, AI_REACT_MAX,
  GROUND_Y, NOISE_COOLDOWN, NOISE_ALERT, NOISE_FLASH
} from '../core/config.js';
import { lerp, rand } from '../core/utils.js';
import { sfxCatch, sfxNoise } from '../core/audio.js';
import { isWolfPressing, isNoisePressed } from '../input/input.js';
import { world } from './state.js';
import { endGame } from './match.js';

/* ================================================================
   更新 AI 木头人
================================================================ */
export function updateAIWolf(wolf, dt){
  const wr = world.writer;

  if (world.over){ wolf.moving = false; return; }
  if (!wolf.alive){
    wolf.fallT = Math.min(1, wolf.fallT + dt * 3);
    wolf.moving = false;
    return;
  }

  const writerLooking = !wr.writing;
  const tooClose = wolf.x <= wr.x + MIN_DIST + 0.5;

  if (!writerLooking){
    wolf.reacting = false;
    wolf.reactTimer = 0;

    if (wolf.pauseTimer > 0){
      wolf.pauseTimer -= dt;
      wolf.moving = false;
      wolf.bob = lerp(wolf.bob, 0, Math.min(1, dt * 10));
      if (wolf.x <= wr.x + CATCH_DIST){
        endGame('wolf', '木头人摸到了写字人的后背！');
      }
      return;
    }

    const frac = wr.writeProgress - Math.floor(wr.writeProgress);
    if (frac > 0.72 && frac < 1 && Math.random() < 1.8 * dt){
      wolf.pauseTimer = rand(0.35, 0.95);
      wolf.moving = false;
      wolf.bob = lerp(wolf.bob, 0, Math.min(1, dt * 10));
      if (wolf.x <= wr.x + CATCH_DIST){
        endGame('wolf', '木头人摸到了写字人的后背！');
      }
      return;
    }

    if (!tooClose){
      wolf.moving = true;
      wolf.x -= AI_WOLF_SPEED * dt;
      wolf.x = Math.max(wolf.x, wr.x + MIN_DIST);
      wolf.legPhase += dt * 13;
      wolf.bob = Math.sin(wolf.legPhase * 2) * 2.6;
    } else {
      wolf.moving = false;
      wolf.bob = lerp(wolf.bob, 0, Math.min(1, dt * 10));
    }

    if (wolf.x <= wr.x + CATCH_DIST){
      endGame('wolf', '木头人摸到了写字人的后背！');
    }
    return;
  }

  if (wolf.moving){
    if (!wolf.reacting){
      wolf.reacting = true;
      wolf.reactTimer = rand(AI_REACT_MIN, AI_REACT_MAX);
    }
    wolf.reactTimer -= dt;

    if (wolf.reactTimer > 0){
      wolf.x -= AI_WOLF_SPEED * dt * 0.55;
      wolf.x = Math.max(wolf.x, wr.x + MIN_DIST);
      wolf.legPhase += dt * 13;
      wolf.bob = Math.sin(wolf.legPhase * 2) * 2.6;

      if (wr.looking){
        wolf.alive = false;
        wolf.caught = true;
        wolf.moving = false;
        wolf.reacting = false;
        wolf.reactTimer = 0;
        sfxCatch();
        return;
      }
    } else {
      wolf.moving = false;
      wolf.reacting = false;
      wolf.reactTimer = 0;
      wolf.bob = lerp(wolf.bob, 0, Math.min(1, dt * 10));
    }
  } else {
    wolf.reacting = false;
    wolf.reactTimer = 0;
    wolf.bob = lerp(wolf.bob, 0, Math.min(1, dt * 10));
  }

  if (wolf.x <= wr.x + CATCH_DIST){
    endGame('wolf', '木头人摸到了写字人的后背！');
  }
}

/* ================================================================
   制造声响
   ----------------------------------------------------------------
   木头人主动弄出动静，惊扰写字人：
     · AI 写字人进入「警觉」，回头概率飙升 → 大概率立刻回头，再吃一次 -3 秒；
     · 人类写字人收到画面与音效提示，由他自己决定要不要松手回头。
   代价是 6 秒冷却，而且发声后写字人马上会转过来——
   这时如果你还在往前挪，就是送人头。
================================================================ */
function triggerNoise(wolf){
  wolf.noiseCd = NOISE_COOLDOWN;
  wolf.noiseFlash = NOISE_FLASH;
  world.writer.alertTimer = NOISE_ALERT;
  world.stats.noises++;
  sfxNoise();

  world.floatTexts.push({
    x: wolf.x, y: GROUND_Y - 200,
    text: '咚！', life: 0.8, maxLife: 0.8
  });
}

/* ================================================================
   更新人类木头人
================================================================ */
export function updateHumanWolf(wolf, dt){
  if (!wolf.alive){
    wolf.fallT = Math.min(1, wolf.fallT + dt * 3);
    wolf.moving = false;
    return;
  }
  if (world.over){ wolf.moving = false; return; }

  /* ---- 制造声响：取「按下瞬间」，按住不重复触发 ---- */
  const noiseHeld = isNoisePressed(wolf);
  if (noiseHeld && !wolf.noiseHeld && wolf.noiseCd <= 0) triggerNoise(wolf);
  wolf.noiseHeld = noiseHeld;
  if (wolf.noiseCd > 0) wolf.noiseCd = Math.max(0, wolf.noiseCd - dt);
  if (wolf.noiseFlash > 0) wolf.noiseFlash = Math.max(0, wolf.noiseFlash - dt);

  const pressing = isWolfPressing(wolf);
  const canMove  = wolf.x > world.writer.x + MIN_DIST + 0.5;

  if (pressing && canMove){
    wolf.x -= WOLF_SPEED * dt;
    wolf.x = Math.max(wolf.x, world.writer.x + MIN_DIST);
    wolf.legPhase += dt * 13;
    wolf.bob = Math.sin(wolf.legPhase * 2) * 2.6;
    wolf.moving = true;

    if (world.writer.looking){
      wolf.alive = false;
      wolf.caught = true;
      wolf.moving = false;
      sfxCatch();
    }
  } else {
    wolf.moving = false;
    wolf.bob = lerp(wolf.bob, 0, Math.min(1, dt * 10));
  }

  if (wolf.alive && wolf.x <= world.writer.x + CATCH_DIST){
    endGame('wolf', `${wolf.id} 摸到了写字人的后背！`);
  }
}

export function updateWolves(dt){
  for (const wolf of world.wolves){
    if (wolf.isAI) updateAIWolf(wolf, dt);
    else updateHumanWolf(wolf, dt);
  }
  if (!world.over && world.wolves.every(w => !w.alive)){
    endGame('writer', '所有木头人都被抓住了');
  }
}
