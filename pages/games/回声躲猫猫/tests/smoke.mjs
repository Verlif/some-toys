/**
 * 临时：端到端冒烟测试（走 main.js 的完整应用层，DOM 用桩）。
 * 覆盖：倒计时 → 对局 → 道具 → 抓捕 → 结算 → 回放数据。
 * 用法：node --experimental-default-type=module .tmp-smoke.mjs
 */
import { frame } from './dom-stub.mjs';
const { startGame } = await import('../js/main.js');
const { gstate, keys } = await import('../js/core/state.js');
const { dom } = await import('../js/ui/dom.js');
const { circleHitsWall } = await import('../js/world/collision.js');
const { replayFrameCount } = await import('../js/sim/replay.js');

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  PASS  ${name}${extra ? '  ' + extra : ''}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? '  ' + extra : ''}`); }
}
console.log('== 端到端冒烟测试 ==');

let error = null;
let overlapFrames = 0;
let maxItems = 0;
const emitters = new Set();
let frozenSeen = 0;
let hasteSeen = 0;
let revealSeen = 0;

try {
  check('入口已启动主循环', !!dom.panel.innerHTML);
  startGame('hider');
  check('开局进入倒计时', gstate.state === 'countdown');

  for (let i = 0; i < 240 && gstate.state === 'countdown'; i++) frame();
  check('倒计时后进入对局', gstate.state === 'playing', `state=${gstate.state}`);

  const me = gstate.player;
  check('玩家是躲藏者', !!me && me.type === 'hider' && me.isPlayer);

  // 走一段：验证输入 → 指令 → 模拟这条链路。
  // 出生点可能正对着墙角，所以四个方向各试一次，只要有一个方向真的走起来即可。
  let bestMove = 0;
  for (const [kx, ky] of [['w', null], ['s', null], ['a', null], ['d', null]]) {
    const sx = me.x, sy = me.y;
    keys[kx] = true;
    for (let i = 0; i < 90; i++) frame();
    keys[kx] = false;
    bestMove = Math.max(bestMove, Math.hypot(me.x - sx, me.y - sy));
    if (bestMove > 20) break;
  }
  check('玩家按键会真的位移', bestMove > 20, `最大位移 ${bestMove.toFixed(1)}px`);

  // 跑到结算
  let guard = 0;
  while (gstate.state !== 'over' && guard < 60 * 220) {
    frame();
    guard++;
    for (const e of gstate.entities) {
      if (e.type === 'hider' && !e.alive) continue;
      if (circleHitsWall(e.x, e.y, e.r)) overlapFrames++;
      if ((e.frozenUntil || 0) > 0) frozenSeen++;
      if ((e.hasteUntil || 0) > 0) hasteSeen++;
      if ((e.revealedUntil || 0) > 0) revealSeen++;
    }
    maxItems = Math.max(maxItems, gstate.items.length);
    for (const wm of gstate.wallMemoryMap.values()) emitters.add(wm.emitterId);
  }
  check('对局能走到结算', gstate.state === 'over', `跑了 ${(guard / 60).toFixed(1)}s`);
  check('结算面板已渲染', dom.panel.innerHTML.includes('result-hero'));
} catch (e) {
  error = e;
}
check('全程没有抛异常', !error, error ? `${error.stack}` : '');

check('整局没有任何角色陷进墙里', overlapFrames === 0, `违规帧 ${overlapFrames}`);
check('道具在局内按时刷新', (gstate.stats.itemsSpawned || gstate.itemLog.length + maxItems) >= 1,
  `场上最多 ${maxItems} 个，拾取 ${gstate.itemLog.length} 次`);
check('墙壁记忆来自多个发射者（队友共享）', emitters.size >= 2, `${emitters.size} 个发射者`);
console.log(`  说明  道具效果帧：定格 ${frozenSeen} / 加速 ${hasteSeen} / 显形 ${revealSeen}`);
check('回放采样有数据', replayFrameCount() > 10, `${replayFrameCount()} 帧`);

console.log(`\n${failures === 0 ? '全部通过 ✅' : `失败 ${failures} 项 ❌`}`);
process.exit(failures === 0 ? 0 : 1);
