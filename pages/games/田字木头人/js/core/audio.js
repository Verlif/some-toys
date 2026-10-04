/**
 * 音效：Web Audio 实时合成，不依赖任何音频文件。
 *
 * 浏览器要求「用户手势之后」才允许播放，因此 initAudio() 在点「开始游戏」
 * 与触屏按下时调用，其余地方只管调用 sfx*()。
 */

/* ================================================================
   音效
================================================================ */
export let actx = null;
export function initAudio(){
  if (!actx){
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){}
  }
  if (actx && actx.state === 'suspended') actx.resume();
}
export function tone(freq, dur, type, vol, delay){
  if (!actx) return;
  const t0 = actx.currentTime + (delay || 0);
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol || 0.1, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(actx.destination);
  o.start(t0); o.stop(t0 + dur + 0.03);
}
export const sfxCatch    = () => { tone(190,0.16,'sawtooth',0.09); tone(110,0.34,'sawtooth',0.09,0.13); };
export const sfxWriterWin= () => { [392,523.25,659.25,783.99].forEach((f,i)=>tone(f,0.3,'triangle',0.08,i*0.1)); };
export const sfxWolfWin  = () => { [523.25,659.25,783.99,1046.5].forEach((f,i)=>tone(f,0.28,'triangle',0.085,i*0.09)); };
export const sfxPenalty  = () => { tone(220,0.12,'square',0.055); tone(165,0.18,'square',0.055,0.10); };
export const sfxNoise    = () => { tone(150,0.10,'square',0.07); tone(96,0.28,'sine',0.075,0.06); };
export const sfxTimeUp   = () => { tone(330,0.3,'sawtooth',0.08); tone(220,0.5,'sawtooth',0.09,0.25); };
export const sfxCountdown= (n) => {
  if (n > 0) tone(660,0.14,'triangle',0.07);
  else       tone(880,0.32,'triangle',0.09);
};
