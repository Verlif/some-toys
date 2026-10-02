/**
 * 碰撞与移动：圆 vs 格子 AABB + 最小平移解算（MTV）。
 *
 * ── 为什么不再用「逐轴移动、撞到就整步回退」
 * 旧做法只要目标点与墙有一点点相交（哪怕 0.01px），就把该轴的位移**全部**撤销：
 *   · 贴着墙走：与墙面始终轻微相交时，连沿墙方向的位移也被判成撞墙 → 一步都挪不动；
 *   · 斜着蹭墙：X、Y 两轴同时被撤销 → 直接顶死在墙角，必须松手重新对准方向。
 *
 * ── 现在怎么做
 *   1. 位移拆成不超过 COLLIDE_MAX_STEP 的小步推进（越小越细腻，也不会一步跨穿薄墙）；
 *   2. 每小步之后只把「陷进墙里的那部分」沿法线推出来 ——
 *      推力只作用于法线方向，切线方向的分量原样保留，于是贴墙、蹭墙都自然滑行；
 *   3. 通道口辅助：正面顶住门框（本步推进几乎全被吃掉、且只是浅浅擦到）时，
 *      沿墙面朝“更近的那个开口”蹭一点点，让小球自己滑进通道，而不是卡在门框上。
 *      判定很严（浅接触 + 8px 内就能脱离接触），顶着大片完整墙面时不会触发，
 *      所以不会变成“自动寻路”。
 */
import {
  TILE,
  COLLIDE_MAX_STEP, COLLIDE_RESOLVE_ITER, COLLIDE_SKIN,
  COLLIDE_ASSIST_MAX_DEPTH, COLLIDE_ASSIST_RANGE,
  COLLIDE_ASSIST_MAX_NUDGE, COLLIDE_ASSIST_NUDGE_MUL
} from '../core/config.js';
import { gstate } from '../core/state.js';
import { tx, ty, clamp } from '../core/utils.js';

/** 判定“已经脱离接触”的容差（px）：推开后的零头不算脱离 */
const CONTACT_TOL = 0.25;
/** 辅助位移的搜索精度（px） */
const ASSIST_SCAN_STEP = 0.5;

/** 统计一次移动里最多解算多少轮（够覆盖凹角 / 贴边等常见情况） */
const MAX_SUBSTEPS = 24;

/* ============================================================
   查询
   ============================================================ */

/** 圆是否与任意墙格相交（严格重叠判定；AI 的可走性 / 视线查询继续用它） */
export function circleHitsWall(x, y, r) {
  const grid = gstate.grid;
  if (!grid) return false;
  const minTx = tx(x - r), maxTx = tx(x + r);
  const minTy = ty(y - r), maxTy = ty(y + r);
  for (let cyy = minTy; cyy <= maxTy; cyy++) {
    for (let cxx = minTx; cxx <= maxTx; cxx++) {
      if (grid[cyy][cxx] !== 1) continue;
      const rx = cxx * TILE, ry = cyy * TILE;
      const nx = clamp(x, rx, rx + TILE);
      const ny = clamp(y, ry, ry + TILE);
      const dx = x - nx, dy = y - ny;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

/**
 * 圆与附近墙格中“最深的那一次接触”。
 *
 * 只取最深的一次（而不是把各格推力相加）有两个原因：
 *   · 同一面墙由多个格子拼成时，逐格相加会额外产生沿墙面的假推力，角色会莫名其妙侧滑；
 *   · 对角相邻的两格墙，两侧推力相加会互相抵消，角色能从零宽缝隙穿模。
 * 逐轮只解算最深的那一次，配合多次迭代，凹角/凸角都能收敛。
 *
 * @returns {{nx:number, ny:number, depth:number}|null}
 *          nx/ny = 从墙面最近点指向圆心的单位法线；depth = 陷入深度（>0 表示相交）。
 */
function deepestContact(x, y, r) {
  const grid = gstate.grid;
  if (!grid) return null;
  const minTx = tx(x - r), maxTx = tx(x + r);
  const minTy = ty(y - r), maxTy = ty(y + r);
  let best = null;
  for (let cyy = minTy; cyy <= maxTy; cyy++) {
    for (let cxx = minTx; cxx <= maxTx; cxx++) {
      if (grid[cyy][cxx] !== 1) continue;
      const rx = cxx * TILE, ry = cyy * TILE;
      const nx = clamp(x, rx, rx + TILE);
      const ny = clamp(y, ry, ry + TILE);
      const dx = x - nx, dy = y - ny;
      const d = Math.hypot(dx, dy);
      let depth, ux, uy;
      if (d > 1e-6) {
        depth = r - d;
        if (depth <= 0) continue;
        ux = dx / d; uy = dy / d;
      } else {
        // 圆心落在墙格内部：朝最近的一条边推出去
        const left = x - rx, right = rx + TILE - x;
        const top = y - ry, bottom = ry + TILE - y;
        const m = Math.min(left, right, top, bottom);
        depth = r + m;
        ux = 0; uy = 0;
        if (m === left) ux = -1;
        else if (m === right) ux = 1;
        else if (m === top) uy = -1;
        else uy = 1;
      }
      if (!best || depth > best.depth) best = { nx: ux, ny: uy, depth };
    }
  }
  return best;
}

/**
 * 圆在 (x,y) 处离墙“脱离接触”了没有（留出 CONTACT_TOL 的余量）。
 * 沿墙面平移时接触深度几乎不变，所以它天然不会把“贴墙滑行”误判成脱离。
 */
function contactFree(x, y, r) {
  const grid = gstate.grid;
  if (!grid) return true;
  const rr = r - CONTACT_TOL;
  const minTx = tx(x - r), maxTx = tx(x + r);
  const minTy = ty(y - r), maxTy = ty(y + r);
  for (let cyy = minTy; cyy <= maxTy; cyy++) {
    for (let cxx = minTx; cxx <= maxTx; cxx++) {
      if (grid[cyy][cxx] !== 1) continue;
      const rx = cxx * TILE, ry = cyy * TILE;
      const nx = clamp(x, rx, rx + TILE);
      const ny = clamp(y, ry, ry + TILE);
      const dx = x - nx, dy = y - ny;
      if (dx * dx + dy * dy < rr * rr) return false;
    }
  }
  return true;
}

/* ============================================================
   解算
   ============================================================ */

/**
 * 把实体从墙里推出来：每轮解算当前最深的那一次接触，最多 maxIter 轮。
 * @returns {{nx:number, ny:number, depth:number}|null} 解算前的第一次（最深）接触
 */
export function resolveCircleWalls(e, maxIter = COLLIDE_RESOLVE_ITER) {
  if (!gstate.grid) return null;
  let first = null;
  for (let i = 0; i < maxIter; i++) {
    const c = deepestContact(e.x, e.y, e.r);
    if (!c) break;
    if (!first) first = c;
    const push = c.depth + COLLIDE_SKIN;
    e.x += c.nx * push;
    e.y += c.ny * push;
  }
  return first;
}

/* ============================================================
   通道口辅助
   ============================================================ */

/**
 * 从接触点 (px,py) 沿 (ux,uy) 方向找“多远之后算脱离接触”。
 * 注意是从**发生重叠的那一步**量起（而不是被推出来之后的落点）：
 * 被推出来时本来就不算接触，拿它做基准会让“贴着整面墙”也满足条件。
 * @returns {number} 距离（px）；在 range 之内找不到就返回 -1
 */
function freeOffsetAlong(px, py, ux, uy, r, range) {
  for (let d = ASSIST_SCAN_STEP; d <= range + 1e-6; d += ASSIST_SCAN_STEP) {
    if (contactFree(px + ux * d, py + uy * d, r)) return d;
  }
  return -1;
}

/**
 * 正面顶住墙角 / 门框时的“送进门”辅助。
 *
 * 触发条件（缺一不可，避免变成自动寻路）：
 *   · 本步在预期方向上的推进几乎被墙吃光；
 *   · 接触很浅（深度 ≤ COLLIDE_ASSIST_MAX_DEPTH）；
 *   · 沿墙面 COLLIDE_ASSIST_RANGE 之内真的能脱离接触（说明是墙角 / 门框，不是大片墙面）。
 *
 * @returns {boolean} 是否施加了辅助位移
 */
function assistIntoOpening(e, contact, px, py, stepLen) {
  if (!contact) return false;
  if (contact.depth > COLLIDE_ASSIST_MAX_DEPTH) return false;

  const cap = Math.min(stepLen * COLLIDE_ASSIST_NUDGE_MUL, COLLIDE_ASSIST_MAX_NUDGE);
  if (cap < ASSIST_SCAN_STEP * 0.5) return false;

  // 墙面切线方向（法线的两个垂直方向都试）
  const tx1 = -contact.ny, ty1 = contact.nx;
  const range = Math.min(COLLIDE_ASSIST_RANGE, e.r);

  const freePos = freeOffsetAlong(px, py, tx1, ty1, e.r, range);
  const freeNeg = freeOffsetAlong(px, py, -tx1, -ty1, e.r, range);
  if (freePos < 0 && freeNeg < 0) return false;      // 两边都被墙挡着：老老实实顶住

  // 选更近的那个开口；两侧一样近时固定取 + 方向，避免左右抖动
  let sign = 1, free = freePos;
  if (freePos < 0 || (freeNeg >= 0 && freeNeg < freePos)) { sign = -1; free = freeNeg; }

  const nudge = Math.min(cap, free + ASSIST_SCAN_STEP);
  e.x += tx1 * sign * nudge;
  e.y += ty1 * sign * nudge;
  if (circleHitsWall(e.x, e.y, e.r)) resolveCircleWalls(e);
  return true;
}

/* ============================================================
   移动
   ============================================================ */

/**
 * 按 (dx, dy) 移动实体。
 *
 * 位移拆成小步推进，每步之后解算重叠 ——「撞墙」于是只剩法线方向被吃掉，
 * 切线方向继续前进：贴墙走、斜着蹭墙都不会再一步卡死。
 */
export function moveEntity(e, dx, dy) {
  if (!dx && !dy) return;
  const dist = Math.hypot(dx, dy);
  if (!(dist > 1e-6)) return;

  const maxStep = Math.max(0.5, Math.min(COLLIDE_MAX_STEP, TILE * 0.25));
  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dist / maxStep)));
  const stepLen = dist / steps;
  const ux = dx / dist, uy = dy / dist;

  for (let i = 0; i < steps; i++) {
    const bx = e.x, by = e.y;
    e.x += ux * stepLen;
    e.y += uy * stepLen;

    // 重叠发生的位置要留一份：通道口辅助以它为基准判断“往旁边让一点是否就能过去”
    const hitX = e.x, hitY = e.y;
    const contact = circleHitsWall(e.x, e.y, e.r) ? resolveCircleWalls(e) : null;
    if (!contact) continue;

    // 本步在预期方向上的真实推进；走得动就不需要辅助
    const progress = (e.x - bx) * ux + (e.y - by) * uy;
    if (progress >= stepLen * 0.4) continue;

    assistIntoOpening(e, contact, hitX, hitY, stepLen);
  }
}
