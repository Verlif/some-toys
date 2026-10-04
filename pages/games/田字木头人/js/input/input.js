/**
 * 输入语义层：把「按键 / 触摸」翻译成游戏语义
 * —— 写字人是否在写？某个木头人是否在前进？
 *
 * 模式 → 按键的映射全部集中在这里，别处不再判断 keyState。
 */
import { MODE } from '../core/config.js';
import { keyState } from './keyboard.js';
import { touch } from './touch.js';
import { world } from '../game/state.js';

/* ================================================================
   输入判断
================================================================ */
export function isWriterKeyHeld(){
  if (!world || world.writer.isAI) return false;
  if (world.mode === MODE.SOLO_WRITER){
    return touch.write || !!keyState[' '] || !!keyState['arrowup'] || !!keyState['arrowdown'];
  }
  if (world.mode === MODE.P1W) return touch.write || !!keyState[' '];
  if (world.mode === MODE.P2W) return touch.write || !!(keyState['arrowup'] || keyState['arrowdown']);
  return false;
}

/**
 * 木头人是否在按「制造声响」。
 * P1 用 W，P2 用 ↑；冷却与触发判定在 game/wolf.js 里做，这里只管「键是否被按着」。
 */
export function isNoisePressed(wolf){
  if (!world || wolf.isAI) return false;
  if (wolf.index === 0) return touch.noise1 || !!keyState['w'];
  return touch.noise2 || !!keyState['arrowup'];
}

export function isWolfPressing(wolf){
  if (!world || wolf.isAI) return false;
  const p1 = touch.p1, p2 = touch.p2;

  if (world.mode === MODE.SOLO_WOLF){
    return p1 || !!keyState['a'] || !!keyState['d'] ||
           !!keyState['arrowleft'] || !!keyState['arrowright'];
  }
  if (world.mode === MODE.P1W){
    return p2 || !!keyState['arrowleft'] || !!keyState['arrowright'] ||
           !!keyState['a'] || !!keyState['d'];
  }
  if (world.mode === MODE.P2W){
    return p1 || !!keyState['a'] || !!keyState['d'] ||
           !!keyState['arrowleft'] || !!keyState['arrowright'];
  }
  if (world.mode === MODE.TWOW){
    if (wolf.index === 0) return p1 || !!keyState['a'] || !!keyState['d'];
    return p2 || !!keyState['arrowleft'] || !!keyState['arrowright'];
  }
  return false;
}
