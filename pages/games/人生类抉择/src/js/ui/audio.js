/**
 * 音效：用 WebAudio 现场合成，不依赖任何音频文件
 * 浏览器要求首次播放必须由用户手势触发，故 init() 在第一次交互时调用
 */

let audio = null;
let muted = false;

export function init() {
  if (!audio) {
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { audio = null; }
  }
  if (audio && audio.state === 'suspended') {
    audio.resume().catch(() => {});
  }
}

export function isMuted() { return muted; }

/** 切换静音，返回切换后的状态 */
export function toggleMute() {
  muted = !muted;
  return muted;
}

/** 发出一个音符 */
function tone(freq, dur, type = 'sine', gain = 0.06, delay = 0) {
  if (!audio || muted) return;
  try {
    const osc = audio.createOscillator();
    const g = audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t = audio.currentTime + delay;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(audio.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  } catch (e) { /* 音频不可用时静默失败 */ }
}

/** 左右滑：左低右高，给方向一点听觉反馈 */
export function swipe(side) {
  tone(side === 'left' ? 150 : 340, 0.16, 'sine', 0.05);
  tone(side === 'left' ? 110 : 420, 0.22, 'sine', 0.04, 0.05);
}

export function milestone() {
  tone(660, 0.14, 'triangle', 0.06);
  tone(880, 0.20, 'triangle', 0.06, 0.12);
}

export function death() {
  tone(240, 0.35, 'sawtooth', 0.045);
  tone(150, 0.50, 'sawtooth', 0.045, 0.22);
}

export function win() {
  [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.06, i * 0.13));
}
