/**
 * 对局生命周期：开局 startGame() 与结束 endGame()。
 *
 * startGame 负责：重置输入 → 按模式组建双方 → 建世界 → 收起菜单；
 * endGame 负责：锁定胜负 → 统计 → 播放音效（结算面板由 simulation 延迟弹出）。
 */
import {
  MODE, HUMAN_WOLF_COUNT, WOLF_START_X, WOLF_SPACING,
  WRITER_MAX_TIME, COUNTDOWN_TIME
} from '../core/config.js';
import { initAudio, sfxWriterWin, sfxWolfWin } from '../core/audio.js';
import { clearKeys } from '../input/keyboard.js';
import { clearTouch, setTouchLayout } from '../input/touch.js';
import { world, setWorld, wolfTotalCount } from './state.js';
import { makeWriter, makeWolf } from './entities.js';
import { hideOverlay } from '../ui/overlay.js';

export function startGame(mode){
  initAudio();
  clearKeys();
  clearTouch();

  const w = {
    mode, active: true, paused: false, over: false,
    winner: null, reason: '', overlayDelay: 0,
    time: 0, wolves: [], writer: null, shake: 0,
    writerTimeLeft: WRITER_MAX_TIME,
    floatTexts: [], timeFlash: 0,
    countdown: COUNTDOWN_TIME,
    started: false,
    startFlash: 0,
    lastCountdownNum: -1,
    stats: { looks: 0, strokesDone: 0, wolvesCaught: 0, wolvesTotal: 0, noises: 0 }
  };

  const aiWriter = (mode === MODE.SOLO_WOLF || mode === MODE.TWOW);
  w.writer = makeWriter(aiWriter);

  const h = HUMAN_WOLF_COUNT[mode] || 0;
  const total = Math.max(wolfTotalCount, h);
  const a = total - h;

  const wolfSpecs = [];

  if (mode === MODE.SOLO_WOLF){
    wolfSpecs.push({ id:'P1', idx:0, isAI:false });
  } else if (mode === MODE.P1W){
    wolfSpecs.push({ id:'P2', idx:1, isAI:false });
  } else if (mode === MODE.P2W){
    wolfSpecs.push({ id:'P1', idx:0, isAI:false });
  } else if (mode === MODE.TWOW){
    wolfSpecs.push({ id:'P1', idx:0, isAI:false });
    wolfSpecs.push({ id:'P2', idx:1, isAI:false });
  }

  setTouchLayout(mode);

  for (let i = 0; i < a; i++){
    wolfSpecs.push({ id:'AI-' + (i+1), idx:(h + i) % 2, isAI:true });
  }

  wolfSpecs.forEach((spec, i) => {
    const offset = (i - (wolfSpecs.length - 1) / 2) * WOLF_SPACING;
    const x = WOLF_START_X + offset;
    w.wolves.push(makeWolf(spec.id, spec.idx, x, spec.isAI));
  });

  w.stats.wolvesTotal = w.wolves.length;
  setWorld(w);
  hideOverlay();
}

/* ================================================================
   结束
================================================================ */
export function endGame(winner, reason){
  if (!world || world.over) return;
  world.over   = true;
  world.winner = winner;
  world.reason = reason;
  world.overlayDelay = 0.95;
  world.shake = winner === 'writer' ? 0.7 : 0;

  world.stats.strokesDone = Math.floor(world.writer.writeProgress);
  world.stats.wolvesCaught = world.wolves.filter(w => !w.alive).length;

  if (winner === 'writer') sfxWriterWin();
  else sfxWolfWin();
}
