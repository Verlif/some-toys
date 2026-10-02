/**
 * 碰撞手感回归测试（无 DOM，直接驱动 world/collision.js）。
 *
 * 覆盖：
 *   · 贴着墙走：沿墙方向的位移必须保留（旧实现会整步撤销 → 一步都走不动）
 *   · 斜着蹭墙：法线方向被吃掉，切线方向继续走
 *   · 顶着整面墙：必须停住，且不能被“辅助”带着横向漂移
 *   · 进入 1 格宽通道：横向偏一点也应该滑进去，而不是卡在门框上
 *   · 穿模：高速撞薄墙 / 对角缝隙都不能过去
 *   · 随机压力：2 万步后不能留在墙里、不能出现 NaN
 *
 * 用法：node --experimental-default-type=module tests/collision.mjs
 */
import { setWorldSize, COLS, ROWS, TILE, BASE_SPEED, WALK_MUL, RUN_MUL } from '../js/core/config.js';
import { gstate } from '../js/core/state.js';
import { moveEntity, circleHitsWall } from '../js/world/collision.js';

setWorldSize('medium');

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  PASS  ${name}${extra ? '  ' + extra : ''}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? '  ' + extra : ''}`); }
}
function section(t) { console.log(`\n== ${t} ==`); }

function blankGrid() {
  const g = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  for (let x = 0; x < COLS; x++) { g[0][x] = 1; g[ROWS - 1][x] = 1; }
  for (let y = 0; y < ROWS; y++) { g[y][0] = 1; g[y][COLS - 1] = 1; }
  return g;
}
const use = g => { gstate.grid = g; };
const ball = (x, y, r = 8) => ({ x, y, r });
const walkStep = dt => BASE_SPEED * WALK_MUL * dt;
const runStep = dt => BASE_SPEED * RUN_MUL * dt;

section('1. 贴墙滑行（旧实现会整步撤销）');
{
  const g = blankGrid();
  for (let y = 1; y < ROWS - 1; y++) g[y][5] = 1;   // 竖墙，墙面在 x = 120
  use(g);
  const e = ball(120 - 8 + 0.5, 300);               // 陷进墙里 0.5px
  const y0 = e.y;
  moveEntity(e, 0, -10);
  check('沿墙平移整个 10px 都保住了', Math.abs((e.y - y0) + 10) < 0.05, `dy=${(e.y - y0).toFixed(3)}`);
  check('被推出墙面外', e.x <= 120 - 8 + 0.02, `x=${e.x.toFixed(3)}`);
  check('没有穿进墙里', !circleHitsWall(e.x, e.y, e.r));
}

section('2. 斜向蹭墙（朝墙里斜插）');
{
  const g = blankGrid();
  for (let y = 1; y < ROWS - 1; y++) g[y][5] = 1;
  use(g);
  const e = ball(120 - 8 + 0.5, 300);
  const x0 = e.x, y0 = e.y;
  moveEntity(e, 5, -5);
  check('纵向分量完整保留', (y0 - e.y) > 4.9, `dy=${(e.y - y0).toFixed(3)}`);
  check('横向被墙挡住', e.x <= 120 - 8 + 0.02 && (e.x - x0) > -1.5, `dx=${(e.x - x0).toFixed(3)}`);
  check('仍然没有陷进墙里', !circleHitsWall(e.x, e.y, e.r));
}

section('3. 顶着整面墙（不许自动横向漂移）');
{
  const g = blankGrid();
  for (let x = 1; x < COLS - 1; x++) g[10][x] = 1;
  use(g);
  const wallBottom = 10 * TILE + TILE;
  const e = ball(600.5, wallBottom + 8 - 0.6);
  const x0 = e.x;
  for (let i = 0; i < 120; i++) moveEntity(e, 0, -walkStep(1 / 60));
  check('纵向被墙挡住（停在墙面外）', Math.abs(e.y - (wallBottom + 8)) < 0.6, `y=${e.y.toFixed(3)}`);
  check('横向没有漂移', Math.abs(e.x - x0) < 0.01, `dx=${(e.x - x0).toFixed(4)}`);
  check('没有陷进墙里', !circleHitsWall(e.x, e.y, e.r));
}

section('4. 进入 1 格宽通道（只按“上”）');
for (const off of [1, 2, 3.5, 5, 5.9]) {
  const g = blankGrid();
  for (let x = 1; x < COLS - 1; x++) g[10][x] = 1;
  g[10][10] = 0;                                     // 门：x ∈ [240, 264]
  use(g);
  const doorCenter = 10 * TILE + TILE / 2;
  const e = ball(doorCenter + off, 10 * TILE + TILE + 7);
  let frames = 0;
  for (; frames < 600; frames++) {
    moveEntity(e, 0, -walkStep(1 / 60));
    if (e.y < 10 * TILE - 8) break;
  }
  check(`横向偏 ${off}px：按“上”自行滑进通道`, frames < 600, `用了 ${frames} 帧，终点 x=${e.x.toFixed(2)}`);
  check(`横向偏 ${off}px：过程中没有陷在墙里`, !circleHitsWall(e.x, e.y, e.r));
}

section('4b. 快步进入 1 格宽通道');
for (const off of [1, 3, 5, 6]) {
  const g = blankGrid();
  for (let x = 1; x < COLS - 1; x++) g[10][x] = 1;
  g[10][10] = 0;
  use(g);
  const e = ball(10 * TILE + TILE / 2 + off, 10 * TILE + TILE + 7);
  let frames = 0;
  for (; frames < 600; frames++) {
    moveEntity(e, 0, -runStep(1 / 60));
    if (e.y < 10 * TILE - 8) break;
  }
  check(`快步 · 横向偏 ${off}px：也能进通道`, frames < 600, `用了 ${frames} 帧`);
}

section('5. 斜向进入通道');
{
  const g = blankGrid();
  for (let x = 1; x < COLS - 1; x++) g[10][x] = 1;
  g[10][10] = 0;
  use(g);
  const e = ball(10 * TILE + TILE / 2 + 7, 10 * TILE + TILE + 10);
  let frames = 0, stuckInWall = 0;
  for (; frames < 600; frames++) {
    moveEntity(e, -walkStep(1 / 60) * 0.7, -walkStep(1 / 60) * 0.7);
    if (circleHitsWall(e.x, e.y, e.r)) stuckInWall++;
    if (e.y < 10 * TILE - 8) break;
  }
  check('斜向推进也能进通道', frames < 600, `用了 ${frames} 帧`);
  check('斜向推进全程没有陷进墙里', stuckInWall === 0);
}

section('6. 穿模检查');
{
  const g = blankGrid();
  for (let y = 1; y < ROWS - 1; y++) g[y][5] = 1;
  use(g);
  const e = ball(120 - 60, 300);
  for (let i = 0; i < 200; i++) moveEntity(e, runStep(1 / 30) * 1.12, 0);
  check('高速撞单格厚墙不会穿过去', e.x < 120 - 8 + 0.02, `x=${e.x.toFixed(2)}`);
}
{
  const g = blankGrid();
  g[10][10] = 1; g[11][11] = 1;                      // 对角相邻的两格墙
  use(g);
  const e = ball(11 * TILE + TILE / 2, 10 * TILE + TILE / 2);
  let worstOverlap = 0;
  for (let i = 0; i < 300; i++) {
    moveEntity(e, -1.5, 1.5);
    if (circleHitsWall(e.x, e.y, e.r)) worstOverlap++;
  }
  const crossed = e.x < 10 * TILE + TILE / 2 - 4 && e.y > 11 * TILE + TILE / 2 + 4;
  check('不会从零宽对角缝隙穿到另一侧', !crossed, `终点 (${e.x.toFixed(1)}, ${e.y.toFixed(1)})`);
  check('对角顶墙时没有陷进墙里', worstOverlap === 0);
}

section('7. 随机压力测试（2 万步）');
{
  const g = blankGrid();
  for (let i = 0; i < 120; i++) {
    const x = 1 + ((Math.random() * (COLS - 2)) | 0);
    const y = 1 + ((Math.random() * (ROWS - 2)) | 0);
    g[y][x] = 1;
  }
  use(g);
  let sx = 0, sy = 0;
  outer: for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
    if (g[y][x] === 0) { sx = x * TILE + TILE / 2; sy = y * TILE + TILE / 2; break outer; }
  }
  const e = ball(sx, sy);
  let insideWall = 0, nan = false;
  for (let i = 0; i < 20000; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (Math.random() < 0.3 ? runStep(1 / 30) : walkStep(1 / 60)) * 1.2;
    moveEntity(e, Math.cos(a) * sp, Math.sin(a) * sp);
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) { nan = true; break; }
    if (circleHitsWall(e.x, e.y, e.r)) insideWall++;
  }
  check('没有 NaN', !nan, `终点 (${e.x.toFixed(1)}, ${e.y.toFixed(1)})`);
  check('每一步结束后都不会留在墙里', insideWall === 0, `insideWall=${insideWall}`);
}

console.log(`\n${failures === 0 ? '全部通过 ✅' : `失败 ${failures} 项 ❌`}`);
process.exit(failures === 0 ? 0 : 1);
