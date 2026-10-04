/**
 * 实体工厂：写字人与木头人的初始状态。
 * 只描述「一个对象长什么样」，不含任何推进逻辑。
 */
import { WRITER_X } from '../core/config.js';

export function makeWriter(isAI){
  return {
    x: WRITER_X,
    facing: 0,
    writing: isAI,
    isAI,
    writeProgress: 0,
    lookTimer: 0,
    looking: false,
    aiLookDur: 0,
    alertTimer: 0      // > 0 表示刚被声响惊扰，回头意愿大幅提高
  };
}

export function makeWolf(id, index, x, isAI){
  return {
    id, index, x,
    isAI: !!isAI,
    alive: true, caught: false,
    bob: 0, legPhase: 0, fallT: 0,
    moving: false,
    pauseTimer: 0, reactTimer: 0, reacting: false,
    noiseCd: 0,        // 制造声响的剩余冷却
    noiseHeld: false,  // 上一帧是否按着（用于取「按下瞬间」）
    noiseFlash: 0      // 声波特效剩余时间
  };
}
