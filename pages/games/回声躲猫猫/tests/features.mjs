/**
 * 临时：道具系统 + 联机会话验证（无 DOM，直接驱动模拟层）。
 * 用法：node --experimental-default-type=module .tmp-features.mjs
 */
import { SIM_HZ, ITEM_SPAWN_INTERVAL, ITEM_TYPES, ITEM_HASTE_MUL } from '../js/core/config.js';
import { gstate } from '../js/core/state.js';
import { setSeed } from '../js/core/rng.js';
import { on, EVT, clearEvents } from '../js/core/events.js';
import { startMatch, stepMatch } from '../js/sim/simulation.js';
import { spawnItem, updateItemSpawns } from '../js/world/items.js';
import { applyItemEffect } from '../js/sim/effects.js';
import { speedMultiplier } from '../js/sim/movement.js';
import { canSeeEntity } from '../js/core/vision.js';
import { isFrozen } from '../js/core/status.js';
import { teamOf } from '../js/core/teams.js';
import { computePathFor, hasPath } from '../js/world/pathfind.js';
import { createSession, MODE } from '../js/net/session.js';
import { createLoopbackPair } from '../js/net/transport.js';

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  PASS  ${name}${extra ? '  ' + extra : ''}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? '  ' + extra : ''}`); }
}
const section = t => console.log(`\n== ${t} ==`);
const DT = 1 / SIM_HZ;
const tick = n => { for (let i = 0; i < n; i++) stepMatch(DT); };

/* ============================================================
   1. 道具刷新节奏
   ============================================================ */
section('1. 道具每 20 秒随机刷新');
gstate.cfgSeekerCount = 1;
gstate.cfgHiderCount = 6;
gstate.cfgPlayerCount = 1;
gstate.cfgMapSize = 'medium';
gstate.cfgGameTime = 300;
gstate.selectedRole = 'hider';

const spawnTimes = [];
clearEvents();
on(EVT.ITEM_SPAWN, ({ item }) => spawnTimes.push({ t: 300 - gstate.timeLeft, type: item.type }));

startMatch('hider', { seed: 12345 });
gstate.state = 'playing';              // 跳过倒计时，专测道具
tick(60 * 70);                          // 跑 70 秒

check('70 秒内刷新了 3 个道具', spawnTimes.length === 3, `实际 ${spawnTimes.length}`);
const gaps = spawnTimes.slice(1).map((s, i) => s.t - spawnTimes[i].t);
check('刷新间隔都是 20 秒', gaps.every(g => Math.abs(g - ITEM_SPAWN_INTERVAL) < 0.05),
  gaps.map(g => g.toFixed(2)).join(', '));
check('刷新出来的类型都在道具池里', spawnTimes.every(s => !!ITEM_TYPES[s.type]),
  spawnTimes.map(s => s.type).join(', '));
check('道具不会立刻消失（生命周期 > 刷新间隔）', gstate.items.length + spawnTimes.length >= 3);

/* ============================================================
   2. 四种道具效果
   ============================================================ */
section('2. 四种道具效果');
// 重新开一局：上一局跑 70 秒后玩家很可能已经被抓，死掉的躲藏者没有“敌人”
startMatch('hider', { seed: 999 });
gstate.state = 'playing';
const me = gstate.hiders.find(h => h.alive && h.isPlayer) || gstate.hiders.find(h => h.alive);
const enemies = () => gstate.entities.filter(e => e.type !== me.type && (e.type === 'seeker' || e.alive));
check('找一个存活的本方角色作为拾取者', !!me && me.alive, me ? `#${me.id} ${me.type}` : '-');
clearEvents();

// 显形
{
  for (const e of gstate.entities) { e.revealedUntil = 0; e.revealedFor = null; }
  const far = gstate.entities.find(e => e.type === 'seeker');
  far.x = 30; far.y = 30;                 // 挪到很远的地方
  me.x = 900; me.y = 560;
  check('正常情况下看不到远处敌人', !canSeeEntity(me, far));
  applyItemEffect(me, { type: 'reveal' });
  check('显形后远处敌人可见', canSeeEntity(me, far));
  check('显形只对本方阵营生效', far.revealedFor === teamOf(me));
  check('显形持续时间 ≈ 1 秒', Math.abs(ITEM_TYPES.reveal.duration - 1) < 1e-9);
}

// 定格
{
  const targets = enemies();
  for (const e of targets) { e.frozenUntil = 0; }
  applyItemEffect(me, { type: 'freeze' });
  check('敌方全部被定格', targets.every(e => isFrozen(e)));
  const seeker = targets.find(e => e.type === 'seeker');
  if (seeker) {
    const px = seeker.x, py = seeker.y;
    computePathFor(seeker, px + 100, py + 100);
    tick(30);
    check('定格期间敌人无法移动', Math.hypot(seeker.x - px, seeker.y - py) < 0.5,
      `位移 ${Math.hypot(seeker.x - px, seeker.y - py).toFixed(2)}px`);
  }
  // 解冻后恢复
  for (const e of targets) e.frozenUntil = 0;
  const seeker2 = targets.find(e => e.type === 'seeker');
  if (seeker2) {
    const px = seeker2.x, py = seeker2.y;
    computePathFor(seeker2, px + 60, py + 60);
    tick(30);
    check('解冻后恢复移动', Math.hypot(seeker2.x - px, seeker2.y - py) > 1);
  }
}

// 噪声
{
  for (const e of gstate.entities) e.noiseCooldownUntil = 999999;   // 全部处于冷却，验证“无视冷却”
  const before = gstate.soundWaves.length;
  const targets = enemies();
  applyItemEffect(me, { type: 'noise' });
  check('敌方全体立刻发出噪声', gstate.soundWaves.length > before,
    `声波 ${before} → ${gstate.soundWaves.length}`);
  const big = gstate.soundWaves.slice(-targets.length);
  check('噪声声波强度为噪声级', big.every(w => w.isNoise === true));
}

// 加速
{
  me.hasteUntil = 0;
  const normal = speedMultiplier(me, 'run');
  applyItemEffect(me, { type: 'haste' });
  const hasted = speedMultiplier(me, 'run');
  check('加速后速度倍率提升', hasted > normal, `${normal.toFixed(2)} → ${hasted.toFixed(2)}`);
  check('加速倍率符合配置', Math.abs(hasted / normal - ITEM_HASTE_MUL) < 1e-6);
  check('加速持续 5 秒', Math.abs(ITEM_TYPES.haste.duration - 5) < 1e-9);
}

/* ============================================================
   3. 拾取（碰到即捡）
   ============================================================ */
section('3. 拾取判定');
{
  const before = gstate.items.length;
  const item = spawnItem('haste');
  check('道具出现在地图上', gstate.items.length === before + 1);
  const hider = gstate.hiders.find(h => h.alive);
  hider.x = item.x; hider.y = item.y;      // 直接踩上去
  hider.hasteUntil = 0;
  tick(1);
  check('角色踩上去即被拾取', !gstate.items.includes(item));
  check('拾取后效果立即生效', (hider.hasteUntil || 0) > 0);
  check('统计记录了拾取', (gstate.stats.itemsCollected || 0) > 0, `itemsCollected=${gstate.stats.itemsCollected}`);
}

/* ============================================================
   4. 联机会话（回环传输，房主 + 客户端）
   ============================================================ */
section('4. 联机会话（房主 / 客户端 走回环传输）');
const flush = () => new Promise(r => setTimeout(r, 0));

{
  const { a, b } = createLoopbackPair();
  const host = createSession({ mode: MODE.HOST, transport: a });
  const guest = createSession({ mode: MODE.GUEST, transport: b, localPlayerIndex: 0 });

  gstate.cfgGameTime = 120;
  host.startMatch('hider', { seed: 777 });
  const hostGridHash = gstate.grid.flat().join('');
  const hostSeed = gstate.seed;
  await flush();

  check('客户端收到了 START', guest.mode === MODE.GUEST && gstate.seed === hostSeed, `seed=${gstate.seed}`);
  check('客户端本地生成了同一张地图（种子一致 → 地图一致）',
    gstate.grid && gstate.grid.flat().join('') === hostGridHash);

  // 先跑过 3 秒开局倒计时：倒计时阶段世界不推进，指令也不会被消费
  for (let i = 0; i < 60 * 4; i++) { host.step(DT); guest.step(DT); await flush(); }
  check('房主已进入 playing', gstate.state === 'playing', `state=${gstate.state}`);

  // 再跑 1 秒：房主推进并广播，客户端只接收
  for (let i = 0; i < 60; i++) { host.step(DT); guest.step(DT); await flush(); }

  const hostSeeker = gstate.seekers[0];
  const guestSeeker = gstate.entities.find(e => e.id === hostSeeker.id);
  check('客户端收到快照并同步了实体', !!guestSeeker);
  check('客户端位置与房主基本一致',
    guestSeeker && Math.hypot(guestSeeker.x - hostSeeker.x, guestSeeker.y - hostSeeker.y) < 40,
    guestSeeker ? `差 ${Math.hypot(guestSeeker.x - hostSeeker.x, guestSeeker.y - hostSeeker.y).toFixed(1)}px` : '-');

  // 客户端发指令 → 房主合并
  const cmdPlayer = gstate.players[0];
  const before = { x: cmdPlayer.x, y: cmdPlayer.y };
  for (let i = 0; i < 30; i++) {
    guest.submitCommand({ p: 0, mx: 1, my: 0, run: true, noise: false });
    host.step(DT); guest.step(DT);
    await flush();
  }
  const movedByRemote = Math.hypot(cmdPlayer.x - before.x, cmdPlayer.y - before.y);
  check('房主执行了客户端发来的指令', movedByRemote > 5, `位移 ${movedByRemote.toFixed(1)}px`);

  // 发声广播 → 客户端本地重建声波
  const guestWavesBefore = gstate.soundWaves.length;
  // 让房主的某个角色发一次声：直接推进即可（AI 移动会发声）
  for (let i = 0; i < 60; i++) { host.step(DT); await flush(); }
  check('客户端能重建房主广播的声波', gstate.soundWaves.length > 0,
    `客户端声波数 ${gstate.soundWaves.length}（此前 ${guestWavesBefore}）`);

  host.dispose();
  guest.dispose();
}

/* ============================================================
   5. 去掉了 AI 抓捕冷却
   ============================================================ */
section('5. AI 无抓捕冷却');
{
  gstate.cfgGameTime = 300;
  startMatch('hider', { seed: 4242 });
  gstate.state = 'playing';
  const seeker = gstate.seekers[0];
  seeker.isPlayer = false;
  seeker.catchCooldownUntil = 0;
  const caugthCounts = [];
  for (let round = 0; round < 3; round++) {
    const victim = gstate.hiders.find(h => h.alive);
    if (!victim) break;
    seeker.x = victim.x; seeker.y = victim.y;
    const before = gstate.stats.hidersCaught;
    tick(1);
    caugthCounts.push(gstate.stats.hidersCaught - before);
    check(`连续第 ${round + 1} 次抓捕生效（无冷却）`, gstate.stats.hidersCaught > before);
  }
  check('AI 抓捕后不会进入冷却', (seeker.catchCooldownUntil || 0) === 0,
    `catchCooldownUntil=${seeker.catchCooldownUntil}`);
}

console.log(`\n${failures === 0 ? '全部通过 ✅' : `失败 ${failures} 项 ❌`}`);
process.exit(failures === 0 ? 0 : 1);
