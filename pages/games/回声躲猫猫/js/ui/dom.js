/**
 * DOM 引用集中缓存。
 *
 * 单独成一个模块，是为了让 hud / replay / panels 都能安全地取用 DOM，
 * 而不必互相 import（否则会形成模块循环）。
 */
export const dom = {
  canvas: null,
  ctx: null,
  wrap: null,
  overlay: null,
  panel: null,
  toast: null,
  timeText: null,
  aliveText: null,
  roleText: null,
  objectiveBadge: null,
  objectiveText: null,
  pauseOverlay: null,
  noiseMeter: null,
  noiseFill: null,
  countdownOverlay: null,
  countdownNum: null,
  countdownMsg: null,
  resultMinBtn: null,
  resultAnimation: null,
  fullscreenBtn: null,
  exitReplayHudBtn: null,
  replayBar: null,
  replayPlayBtn: null,
  replayRange: null,
  replayTime: null,
  replayExitBtn: null
};

/** 必须在任何模块使用 dom 之前调用一次（entry.js 里调用） */
export function initDom() {
  const $ = id => document.getElementById(id);
  dom.canvas = $('cv');
  dom.ctx = dom.canvas.getContext('2d');
  dom.wrap = $('wrap');
  dom.overlay = $('overlay');
  dom.panel = $('panel');
  dom.toast = $('toast');
  dom.timeText = $('timeText');
  dom.aliveText = $('aliveText');
  dom.roleText = $('roleText');
  dom.objectiveBadge = $('objectiveBadge');
  dom.objectiveText = $('objectiveText');
  dom.pauseOverlay = $('pauseOverlay');
  dom.noiseMeter = $('noiseMeter');
  dom.noiseFill = $('noiseFill');
  dom.countdownOverlay = $('countdownOverlay');
  dom.countdownNum = $('countdownNum');
  dom.countdownMsg = $('countdownMsg');
  dom.resultMinBtn = $('resultMinBtn');
  dom.resultAnimation = $('resultAnimation');
  dom.fullscreenBtn = $('fullscreenBtn');
  dom.exitReplayHudBtn = $('exitReplayHudBtn');
  dom.replayBar = $('replayBar');
  dom.replayPlayBtn = $('replayPlayBtn');
  dom.replayRange = $('replayRange');
  dom.replayTime = $('replayTime');
  dom.replayExitBtn = $('replayExitBtn');
  return dom;
}
