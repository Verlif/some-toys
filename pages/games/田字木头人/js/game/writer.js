/**
 * 写字人：AI 决策 + 人类输入 + 状态推进。
 *
 * AI 决策（updateAIWriterDecision）综合四件事：
 *   最近木头人的距离 / 是否在移动 / 剩余时间 / 当前书写进度，
 * 输出「何时回头」与「回头看多久」。
 */
import {
  MIN_DIST, WRITER_MAX_TIME, TOTAL_STROKES, STROKE_TIME, LOOK_GRACE,
  NOISE_ALERT, NOISE_LOOK_RATE
} from '../core/config.js';
import { clamp, lerp } from '../core/utils.js';
import { sfxTimeUp } from '../core/audio.js';
import { isWriterKeyHeld } from '../input/input.js';
import { world } from './state.js';
import { endGame } from './match.js';

/* ================================================================
   AI 写字人决策
   ----------------------------------------------------------------
   依据：
     · 最近木头人的距离（危险度）
     · 木头人是否在移动（威胁度）
     · 剩余时间（时间压力——每次回头消耗 3 秒）
     · 当前写字进度（快写完时优先写完）
   输出：
     · 何时回头（概率判定）
     · 回头持续多久（危险越高，看得越久）
================================================================ */
export function updateAIWriterDecision(wr, dt){
  const aliveWolves = world.wolves.filter(w => w.alive);

  /* 没有可抓的木头人——专心写字 */
  if (aliveWolves.length === 0){
    wr.writing = true;
    return;
  }

  /* ---- 收集威胁信息 ---- */
  let nearestDist = Infinity;
  let nearestMoving = false;
  let anyMoving = false;

  for (const wolf of aliveWolves){
    const d = wolf.x - wr.x;          // 木头人总在写字人右侧，d > 0
    if (d < nearestDist){
      nearestDist = d;
      nearestMoving = wolf.moving;
    }
    if (wolf.moving) anyMoving = true;
  }

  /* ---- 危险度：距离越近 + 正在移动 → 越危险 ---- */
  const DANGER_RANGE = 700;
  const distFactor = clamp((DANGER_RANGE - (nearestDist - MIN_DIST)) / DANGER_RANGE, 0, 1);
  const moveBonus   = nearestMoving ? 0.18 : 0;
  const anyMoveBonus = (anyMoving && !nearestMoving) ? 0.08 : 0;
  const danger = clamp(distFactor + moveBonus + anyMoveBonus, 0, 1);

  /* ---- 时间压力：剩余时间越少越紧张 ---- */
  const timeLeft = world.writerTimeLeft;
  const timePressure = clamp(1 - timeLeft / WRITER_MAX_TIME, 0, 1);

  /* ---- 书写进度 0..1 ---- */
  const progress = wr.writeProgress / TOTAL_STROKES;

  /* ---- 状态机 ---- */
  if (wr.writing){
    /* 每秒回头的期望概率 */
    let lookRate = 0.12;                  // 基础
    lookRate += danger * 0.85;            // 危险驱动

    /* 木头人已经贴到脸上——必须看 */
    if (nearestDist < MIN_DIST + 150) lookRate += 0.6;

    /* 刚被声响惊扰——大概率立刻回头（越近越灵，随时间衰减） */
    if (wr.alertTimer > 0) lookRate += NOISE_LOOK_RATE * (wr.alertTimer / NOISE_ALERT);

    /* 时间紧张时压低回头意愿（每次回头 -3 秒） */
    lookRate *= (1 - timePressure * 0.4);

    /* 快写完了，优先完成 */
    if (progress > 0.75) lookRate *= 0.55;

    /* 概率判定 */
    if (Math.random() < lookRate * dt){
      const startled = wr.alertTimer > 0;
      wr.writing = false;
      wr.lookTimer = 0;
      /* 被声响惊动：只是匆匆一瞥，看得短；否则危险越高看得越久 */
      wr.aiLookDur = startled
        ? 0.5 + Math.random() * 0.3
        : 0.5 + danger * 0.7 + Math.random() * 0.3;
      /* 一次声响只惊他一次，用完即清 */
      if (startled) wr.alertTimer = 0;
    }
  } else {
    /* 回头中——决定何时转回去 */
    const minDur = wr.aiLookDur || 0.5;
    const maxDur = minDur + 0.8;

    if (wr.lookTimer >= maxDur){
      /* 回头时间上限已到——必须转回去 */
      wr.writing = true;
      wr.aiLookDur = 0;
    } else if (wr.lookTimer >= minDur && !anyMoving){
      /* 木头人都停住了，回去写字 */
      wr.writing = true;
      wr.aiLookDur = 0;
    }
  }
}

/* ================================================================
   更新写字人
================================================================ */
export function updateWriter(dt){
  const wr = world.writer;

  if (wr.alertTimer > 0) wr.alertTimer = Math.max(0, wr.alertTimer - dt);

  if (!world.over){
    world.writerTimeLeft -= dt;
    if (world.writerTimeLeft <= 0){
      world.writerTimeLeft = 0;
      sfxTimeUp();
      endGame('wolf', '写字人的时间耗尽了');
      return;
    }
  }

  if (wr.isAI && !world.over){
    updateAIWriterDecision(wr, dt);
  }

  if (!wr.isAI && !world.over){
    wr.writing = isWriterKeyHeld();
  }

  const target = wr.writing ? 0 : 1;
  wr.facing = lerp(wr.facing, target, Math.min(1, dt * 14));

  if (!wr.writing){
    wr.lookTimer += dt;
    wr.looking = wr.lookTimer > LOOK_GRACE;
  } else {
    wr.lookTimer = 0;
    wr.looking = false;
  }

  if (wr.writing && !world.over){
    wr.writeProgress += dt / STROKE_TIME;
    if (wr.writeProgress >= TOTAL_STROKES){
      wr.writeProgress = TOTAL_STROKES;
      endGame('writer', '写字人写完了「田」字');
    }
  }
}
