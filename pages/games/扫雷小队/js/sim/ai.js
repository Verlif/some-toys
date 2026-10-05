/**
 * AI 决策三层：生存（有限救援）→ 角色目标（冲刺 / 夺旗 / 排雷）→ 探索（扫描）。
 *
 * ── 角色分工（按队内座次轮转，保证每队三种角色都有）
 *   runner      直奔出口
 *   flagRunner  盯最近的旗，但只在「绕路可接受」时才去
 *   defuser     主动清理附近的已知雷，清完 / 有人到达后回归冲刺
 *
 * ── 遇到已知雷：排雷 vs 绕路
 *   两边都换算成**秒**再比：排雷 = 靠近时间 + DEFUSE_DURATION；绕路 = 额外格数 × TILE ÷ 速度。
 *   以 MINE_BEST_CHANCE 的概率取真正更优的一侧（剩下的随机，避免所有 AI 动作整齐划一）。
 *
 * ── 救援（修 bug）
 *   旧逻辑里任何人倒地，附近所有角色都会朝他跑过去，队形一瞬间散掉。
 *   现在：只救同队、每个倒地者最多一名救援者、半径与守候时间都有限。
 *
 * ── 终点冲刺
 *   直线距离进入 EXIT_RUSH_TILES 格后掷一次骰子：大概率锁定「直冲出口」
 *   （不再管旗和雷、遇到雷优先绕路），小概率继续按角色思考，过一会儿再评估。
 *   一旦锁定就不再重掷，避免同一个人在终点前反复横跳。
 *
 * ── 共享视野（修 bug：队友扫出雷之后，其他人还照着旧路径踩上去）
 *   known 位图是**队伍级**的，谁扫出来全队都知道。为此：
 *   1. team.minesFound 当版本号，一有新雷就检查自己的路径有没有被挡；
 *   2. 前瞻 MINE_LOOKAHEAD 格找已知雷，而不是只看下一格；
 *   3. 移动前的硬性保险：绝不主动踩进已知雷格（除非正要去拆它）。
 *
 * ── 出发区与入口走廊（修：进场前反复思考、把入口堵成一团）
 *   迷宫左侧的出发区里没有任何可决策的东西，AI 只朝自己的入口直线走。
 *   「是否在出发区」按**位置实时判定**，不用一次性标记——AI 进了迷宫也可能被
 *   绕回来 / 挤回来，那时同样该安静地走回入口，而不是在空地上又寻路又扫描，
 *   走一步思考一会。每次回到出发区只允许思考 STAGING_THINK_TIME 一次。
 *   跨过入口后进入「走廊模式」：路线只在第一次算一次（这就是「最多计算一次」），
 *   之后卡住了也只是静默重算，不再停下来思考，
 *   否则先到的人一停，后面整队人都堵在入口外。
 */
import {
  W, H, DIRS8, OUTSIDE_COLS, TILE, DEFUSE_DURATION,
  FLAG_MAX_DETOUR, DEFUSER_SEARCH_R, DEFUSER_MAX_JOBS,
  MINE_BEST_CHANCE, MINE_LOOKAHEAD, RESCUE_RADIUS, RESCUE_STANDOFF, RESCUE_MAX_TIME,
  EXIT_RUSH_TILES, EXIT_RUSH_CHANCE, EXIT_RUSH_RETRY,
  ENTRY_CORRIDOR_COLS, ENTRY_TIMEOUT, STAGING_THINK_TIME
} from '../core/config.js';
import { idx, inBounds, tileOf } from '../core/utils.js';
import { game } from '../core/state.js';
import { moveEntity, moveToward } from '../world/collision.js';
import { findPath } from '../world/pathfind.js';
import { startScan, revealScan, startDefuse, completeDefuse } from './scan.js';

/**
 * 让 AI 停顿一小会儿，制造「思考」的节奏感。
 *
 * 出发区与入口走廊里恒为 no-op：那里没有可决策的东西，停下来思考只会把后面的人堵住。
 * 返回是否真的进入了思考——调用方据此决定这一帧要不要就此返回。
 */
function triggerThink(e, fixed) {
  if (e.corridor) return false;
  e.thinkTimer = fixed !== undefined ? fixed : (0.5 + Math.random() * 1.5);
  return true;
}

/** 出发区：朝自己的入口直线走过去。不走 A*、不扫描、不思考 */
function walkToEntrance(e, dt) {
  const entY = game.entranceYs[e.entranceId % game.entranceYs.length];
  const targetY = entY * TILE + TILE / 2;
  if (Math.abs(e.y - targetY) > 3) {
    moveEntity(e, 0, Math.sign(targetY - e.y) * e.speed * dt);
  } else {
    e.y = targetY;
    e.faceX = 1; e.faceY = 0;
    moveEntity(e, e.speed * dt, 0);
  }
}

/**
 * 寻路统一入口。人已经在迷宫里（起点 x >= OUTSIDE_COLS）时禁止路径绕回左侧出发区——
 * 那片空地没有出口，允许它走回去 AI 就会进进出出、在空地上反复决策。
 */
function route(team, sx, sy, gx, gy, extra) {
  return findPath(sx, sy, gx, gy, team,
    Object.assign({ noStaging: sx >= OUTSIDE_COLS }, extra || null));
}

/** 解除救援关系（双向引用都要清，否则倒地者会被永久占着） */
function releaseRescue(e) {
  if (e.rescueTarget) e.rescueTarget.rescuer = null;
  e.rescueTarget = null;
  e.rescueTimer = 0;
}

/** 沿路径推进；连续两帧几乎没动就判定卡住，清空路径重新决策 */
function moveAlongPath(e, team, dt) {
  if (!e.path || e.path.length === 0) return false;
  const n = e.path[0];
  const tx = n.x * TILE + TILE / 2;
  const ty = n.y * TILE + TILE / 2;

  const d = Math.hypot(tx - e.x, ty - e.y);
  if (d < 4) { e.path.shift(); e.stuckCounter = 0; return true; }

  const oldX = e.x, oldY = e.y;
  moveToward(e, tx, ty, dt);

  // 最后一道闸：这一步把身体带进了「本队已知有雷」的格子 → 退回去重算。
  // 覆盖侧向滑动、贴墙蹭角等 A* 看不到的情况。
  const ni = idx(tileOf(e.x), tileOf(e.y));
  if (team && isKnownMine(team, ni)) {
    e.x = oldX; e.y = oldY;
    e.path = null;
    e.pathTimer = 0;
    e.mineLockKey = null;
    e.stuckCounter = 0;
    triggerThink(e, 0.25);
    return false;
  }

  const moved = Math.hypot(e.x - oldX, e.y - oldY);
  if (moved < dt * e.speed * 0.15) {
    e.stuckCounter++;
    // 先尝试侧滑（沿垂直方向）
    const perpX = -(ty - e.y);
    const perpY = (tx - e.x);
    const pl = Math.hypot(perpX, perpY);
    if (pl > 0.1) {
      moveEntity(e, (perpX / pl) * e.speed * dt * 0.85, (perpY / pl) * e.speed * dt * 0.85);
    }
    if (e.stuckCounter >= 2) {
      e.path = null;
      e.pathTimer = 0;
      e.stuckCounter = 0;
      e.routeRepickCount++;
      triggerThink(e, 0.4 + Math.random() * 0.6);
      return false;
    }
  } else {
    e.stuckCounter = 0;
  }
  return true;
}

/** 统计半径内未知格占比，用来判断「这里值不值得扫」 */
function localUnknownRatio(cx, cy, team, r) {
  let unknown = 0, total = 0;
  const r2 = r * r + 0.5;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = cx + dx, y = cy + dy;
      if (!inBounds(x, y)) continue;
      const i = idx(x, y);
      if (game.walls[i]) continue;
      total++;
      if (team.known[i] === 0) unknown++;
    }
  }
  return total === 0 ? 0 : unknown / total;
}

const pathLen = (p) => (p ? p.length : Infinity);

/** 「确定有雷」：本队认知为雷，且雷还在场上（可能已被别人拆掉或炸掉） */
function isKnownMine(team, i) {
  return team.known[i] === 2 && game.mines[i] > 0;
}

/** 路径前 look 格里有已知雷吗？返回下标，没有则 -1 */
function mineAhead(path, team, look) {
  if (!path) return -1;
  const n = Math.min(look, path.length);
  for (let k = 0; k < n; k++) {
    if (isKnownMine(team, idx(path[k].x, path[k].y))) return k;
  }
  return -1;
}

/**
 * 队友扫出新雷后立刻重新评估：路径被新雷挡住就必须马上重算，
 * 否则会照着几秒前缓存的旧路径一脚踩上去。
 */
function reactToNewIntel(e, team) {
  if (e.intelVersion === team.minesFound) return;
  e.intelVersion = team.minesFound;
  if (mineAhead(e.path, team, MINE_LOOKAHEAD + 2) < 0) return;
  e.path = null;
  e.pathTimer = 0;
  e.mineDecisionLock = false;
  e.wantToDefuse = null;
  e.defuseApproachTimer = 0;
}

/** 释放旧目标声明，避免别的队友被「已有人去了」挡在外面 */
function releaseClaim(e) {
  if (e.flagTarget && e.flagTarget.claim === e) e.flagTarget.claim = null;
  e.flagTarget = null;
}

/** 夺旗手选目标：只接受「绕路不超过 FLAG_MAX_DETOUR 格」的旗 */
function pickFlag(e, team, cx, cy) {
  const base = pathLen(route(team, cx, cy, game.exitX, game.exitY));
  let best = null, bestCost = Infinity;

  for (const f of game.flags) {
    if (f.takenBy >= 0) continue;
    if (f.claim && f.claim !== e && f.claim.teamId === e.teamId) continue;   // 同队已有人盯上

    const toFlag = route(team, cx, cy, f.x, f.y);
    if (!toFlag) continue;
    const toExit = route(team, f.x, f.y, game.exitX, game.exitY);
    const cost = toFlag.length + pathLen(toExit);
    if (cost - base > FLAG_MAX_DETOUR) continue;      // 太绕了，不如直接冲出口
    if (cost < bestCost) { bestCost = cost; best = f; }
  }

  if (!best) { releaseClaim(e); return null; }
  if (e.flagTarget && e.flagTarget !== best) releaseClaim(e);
  best.claim = e;
  e.flagTarget = best;
  return best;
}

/** 排雷手选目标：最近的「已知有雷」格 */
function pickMineJob(e, team, cx, cy) {
  let best = null, bestD = Infinity;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      if (game.mines[i] === 0 || team.known[i] !== 2) continue;
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (d > DEFUSER_SEARCH_R || d >= bestD) continue;
      bestD = d; best = { x, y };
    }
  }
  e.mineJob = best;
  return best;
}

/**
 * 终点冲刺判定：进入终点圈后掷一次骰子决定「直冲」还是「继续思考」。
 * 用直线距离做判据（A* 太贵，这里每帧都要判），出口在迷宫最右侧，足够近似。
 * 返回 true = 本帧锁定直冲出口。
 */
function updateRushMode(e, cx, cy, dt) {
  const d = Math.hypot(game.exitX - cx, game.exitY - cy);

  if (d > EXIT_RUSH_TILES * 1.8) {          // 离终点还远，清掉上次的判断
    e.rushMode = false;
    e.rushRetry = 0;
    return false;
  }
  if (e.rushMode) return true;              // 已锁定直冲，不再反复掷骰
  if (e.rushRetry > 0) { e.rushRetry -= dt; return false; }
  if (d > EXIT_RUSH_TILES) { e.rushRetry = 0.4; return false; }

  // 进入终点圈：大概率直冲出口，小概率继续按角色权衡
  if (Math.random() < EXIT_RUSH_CHANCE) { e.rushMode = true; return true; }
  e.rushRetry = EXIT_RUSH_RETRY;
  return false;
}

/**
 * 当前角色该往哪走。返回 { x, y, kind }，kind ∈ exit | flag | mine。
 * 夺旗手与排雷手在「没活干」或「别人已到达、该收尾」时都退回冲出口。
 *
 * 角色目标要跑 A*，不能每帧算：缓存 0.6 秒，够用又不拖帧率。
 */
function computeGoal(e, team, cx, cy, rushing) {
  const exitGoal = { x: game.exitX, y: game.exitY, kind: 'exit' };
  const rush = game.endCountdown !== null;      // 有人到达 → 全队转入冲刺

  // 接近终点：高概率直冲出口（剩下的继续按角色思考）
  if (rushing) return exitGoal;

  if (e.role === 'flagRunner' && !rush) {
    const f = pickFlag(e, team, cx, cy);
    if (f) return { x: f.x, y: f.y, kind: 'flag' };
    return exitGoal;
  }

  if (e.role === 'defuser' && !rush && e.stats.minesDefused < DEFUSER_MAX_JOBS) {
    const m = pickMineJob(e, team, cx, cy);
    if (m) return { x: m.x, y: m.y, kind: 'mine' };
    return exitGoal;
  }

  return exitGoal;
}

/** 朝角色目标寻路；目标是雷格时放开终点限制（排雷手要走到雷跟前） */
function pathToGoal(e, team, cx, cy, goal) {
  return route(team, cx, cy, goal.x, goal.y,
    goal.kind === 'mine' ? { allowMineGoal: true } : null);
}

function ensureGoal(e, team, cx, cy, dt, rushing) {
  if (e.goalTimer > 0) e.goalTimer -= dt;
  if (!e.goal || e.goalTimer <= 0 || (rushing && e.goal.kind !== 'exit')) {
    // 直冲状态下目标恒为出口，缓存可以放久一点，省掉重复的 A*
    e.goal = computeGoal(e, team, cx, cy, rushing);
    e.goalTimer = rushing ? 1.5 : 0.6;
  }
  return e.goal;
}

/**
 * 救援：只救同队、每个倒地者最多一名救援者、半径与守候时长都有限。
 * 返回 true 表示这一帧已经被救援占用。
 */
function tryRescue(e, dt) {
  if (e.rescueCooldown > 0) { e.rescueCooldown -= dt; return false; }

  let target = null, bestD = Infinity;
  for (const o of game.entities) {
    if (o === e || !o.downed || o.teamId !== e.teamId) continue;
    if (o.rescuer && o.rescuer !== e) continue;              // 已经有人去救了
    if (tileOf(o.x) < OUTSIDE_COLS) continue;                // 还在出发区的队友不用救，他自己会走进来
    const d = Math.hypot(o.x - e.x, o.y - e.y);
    if (d > RESCUE_RADIUS || d >= bestD) continue;
    bestD = d; target = o;
  }

  if (!target) {
    if (e.rescueTarget) { e.rescueTarget.rescuer = null; e.rescueTarget = null; e.rescueTimer = 0; }
    return false;
  }

  if (e.rescueTarget !== target) {
    if (e.rescueTarget) e.rescueTarget.rescuer = null;
    e.rescueTarget = target;
    target.rescuer = e;
    e.rescueTimer = 0;
  }

  e.rescueTimer += dt;
  if (e.rescueTimer > RESCUE_MAX_TIME) {          // 守一会儿就够了，别站着不动等全场
    target.rescuer = null;
    e.rescueTarget = null;
    e.rescueTimer = 0;
    e.rescueCooldown = 8;
    e.path = null;
    triggerThink(e, 0.3);
    return false;
  }

  if (bestD > RESCUE_STANDOFF) moveToward(e, target.x, target.y, dt);
  return true;
}

export function updateAI(e, dt) {
  if (e.downed || e.arrived) return;

  // 排雷中（AI 自动完成，不需要按住）
  if (e.defuseTimer > 0) {
    e.defuseTimer -= dt;
    if (e.defuseTimer <= 0) completeDefuse(e);
    return;
  }

  // 扫描中
  if (e.scanTimer > 0) {
    e.scanTimer -= dt;
    if (e.scanTimer <= 0) {
      e.scanTimer = 0;
      revealScan(e);
      e.scanCooldown = 0.2;
    }
    return;
  }

  const team = game.teams[e.teamId];
  const cx = tileOf(e.x), cy = tileOf(e.y);

  /* ── 出发区（迷宫左侧空地）──
     判定按**位置实时**算，不用一次性标记：AI 进了迷宫之后也可能被绕回 / 挤回这里，
     那时同样该安静地走回入口，而不是在空地上又寻路又扫描，走一步思考一会。
     每次回到出发区只允许思考一次（STAGING_THINK_TIME），用完就不再想。 */
  const inStaging = cx < OUTSIDE_COLS;
  if (inStaging !== e.inStaging) {
    e.inStaging = inStaging;
    if (inStaging) {
      // 回到出发区：清掉迷宫里残留的意图，下次跨过入口重新走一遍走廊模式
      e.stagingThinkUsed = false;
      e.corridor = false;
      releaseRescue(e);
      e.path = null; e.pathTimer = 0;
      e.wantToDefuse = null; e.defuseApproachTimer = 0;
      e.mineDecisionLock = false; e.mineLockKey = null;
      e.goal = null; e.goalTimer = 0;
      e.lastJunctionCell = null;
    } else {
      // 刚跨过入口 → 走廊模式（重新进场也要重算一次初始路线）
      e.corridor = true;
      e.corridorTimer = 0;
      e.thinkTimer = 0;
      e.initialRouteChosen = false;
      e.goal = null; e.goalTimer = 0;
      e.lastJunctionCell = null;
      e.mineLockKey = null;
    }
  }

  if (inStaging) {
    if (!e.stagingThinkUsed) {
      e.stagingThinkUsed = true;      // 唯一的一次，之后只管往入口走
      e.thinkTimer = STAGING_THINK_TIME;
    }
    if (e.thinkTimer > 0) { e.thinkTimer -= dt; return; }
    walkToEntrance(e, dt);
    return;
  }

  /* ── 入口走廊：走完这段就转回正常 AI ──
     走廊里唯一的「计算」是第一次算路线；之后就算被同伴挤住也只静默重算，
     不会再触发思考停顿（以前先到的人一停，整队堵在入口外反复思考）。 */
  if (e.corridor) {
    e.corridorTimer += dt;
    if (cx > OUTSIDE_COLS + ENTRY_CORRIDOR_COLS || e.corridorTimer > ENTRY_TIMEOUT) {
      e.corridor = false;
      e.thinkTimer = 0;
      e.goal = null; e.goalTimer = 0;              // 出了走廊再按分工重新选目标
      e.aiScanTimer = 0.8 + Math.random() * 1.2;   // 也别一到就扫，留点缓冲
    } else {
      e.thinkTimer = 0;
    }
  }

  // 思考等待
  if (e.thinkTimer > 0) { e.thinkTimer -= dt; return; }

  // 生存：有限救援（走廊里不救，先把人带进去再说）
  if (!e.corridor && tryRescue(e, dt)) return;

  // 共享视野：队友扫出新雷 → 挡到我路上了就立刻重算
  reactToNewIntel(e, team);

  // 终点冲刺判定（很便宜，每帧都算），决定这一帧是直冲还是继续思考
  const rushing = !e.corridor && updateRushMode(e, cx, cy, dt);
  // 走廊里目标恒为出口：不跑「夺旗 / 排雷」那套 A*，全场最多算一次路线
  const goal = e.corridor
    ? { x: game.exitX, y: game.exitY, kind: 'exit' }
    : ensureGoal(e, team, cx, cy, dt, rushing);

  /* ========== 重大决策 1：首次路线选择 ========== */
  if (!e.initialRouteChosen) {
    e.initialRouteChosen = true;
    e.path = pathToGoal(e, team, cx, cy, goal) || [];
    e.pathTimer = 3.0;
    // 走廊里 triggerThink 是 no-op，于是这一帧会继续往下走，不会杵在门口
    if (triggerThink(e, 1.0 + Math.random() * 1.0)) return;
  }

  /* ========== 重大决策 2：前方已知有雷 → 排雷 vs 绕路 ========== */
  if (e.path && e.path.length > 0) {
    // 前瞻 MINE_LOOKAHEAD 格：只看下一格来不及（路径最长 3 秒才重算一次）
    const mi = mineAhead(e.path, team, MINE_LOOKAHEAD);

    if (mi < 0) {
      e.mineLockKey = null;
    } else {
      // 对「同一颗雷的同一阶段」只决策一次，避免站着反复掷骰
      const next = e.path[mi];
      const key = `${next.x},${next.y},${mi === 0 ? 'adj' : 'far'}`;

      if (e.mineLockKey !== key) {
        e.mineLockKey = key;

        if (mi === 0) {
          // 雷就在脚边：这才需要「排雷 vs 绕路」的取舍
          const altPath = pathToGoal(e, team, cx, cy, goal);

          // 两种方案统一折算成秒再比
          const approachTiles = Math.hypot(next.x - cx, next.y - cy);
          const defuseSec = DEFUSE_DURATION + (approachTiles * TILE) / e.speed;
          const detourExtra = pathLen(altPath) - e.path.length;
          const detourSec = detourExtra > 0 ? (detourExtra * TILE) / e.speed : Infinity;

          let defuse;
          if (!altPath || altPath.length === 0) {
            defuse = true;                                 // 无路可绕
          } else if (rushing) {
            defuse = false;                                // 直冲终点：能绕就绕，别停下来拆
          } else {
            const optimal = defuseSec < detourSec;         // 真正更优的一侧
            defuse = Math.random() < MINE_BEST_CHANCE ? optimal : !optimal;
          }

          if (defuse) {
            e.wantToDefuse = { x: next.x, y: next.y };
            e.defuseApproachTimer = 0;
          } else {
            e.path = altPath;
            e.pathTimer = 2.0;
            e.wantToDefuse = null;
          }
          if (triggerThink(e)) return;      // 走廊里不真的停下，直接继续走
        }

        // 雷还在几格之外：先重新绕开它，等它变成 path[0] 再决定拆不拆
        const detourPath = pathToGoal(e, team, cx, cy, goal);
        if (detourPath && detourPath.length > 0) {
          e.path = detourPath;
          e.pathTimer = 1.5;
        }
        return;
      }
    }
  }

  /* ========== 处理排雷意图 ========== */
  if (e.wantToDefuse) {
    // 冷却没好就原地等：这时候照着路径走等于自己踩上去
    if (e.defuseTimer <= 0 && e.defuseCooldown > 0) {
      e.defuseApproachTimer += dt;
      if (e.defuseApproachTimer > 4.0) {
        e.wantToDefuse = null;
        e.defuseApproachTimer = 0;
        e.mineDecisionLock = false;
        e.path = null;
      }
      return;
    }

    if (e.defuseTimer <= 0) {
      const tgt = e.wantToDefuse;
      const tx = tgt.x * TILE + TILE / 2;
      const ty = tgt.y * TILE + TILE / 2;
      const d = Math.hypot(tx - e.x, ty - e.y);
      const reachDist = TILE * e.scanRadius * 0.85;

      if (d < reachDist) {
        e.wantToDefuse = null;
        e.defuseApproachTimer = 0;
        startDefuse(e);
        return;
      }

      e.defuseApproachTimer += dt;
      if (e.defuseApproachTimer > 4.0) {
        // 无法接近 → 放弃，重新决策
        e.wantToDefuse = null;
        e.defuseApproachTimer = 0;
        e.mineDecisionLock = false;
        e.path = null;
        if (triggerThink(e, 0.6)) return;
      }

      moveToward(e, tx, ty, dt);
      return;
    }
  }

  /* ========== 重大决策 3：复杂岔路口 → 重新评估路径 ========== */
  const cellKey = cx + ',' + cy;
  if (!e.corridor && e.path && e.path.length > 0 && e.lastJunctionCell !== cellKey) {
    let openDirs = 0, unknownDirs = 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DIRS8[d][0], ny = cy + DIRS8[d][1];
      if (!inBounds(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (game.walls[ni]) continue;
      if (team.known[ni] === 2) continue;
      openDirs++;
      if (team.known[ni] === 0) unknownDirs++;
    }
    if (openDirs >= 4 && unknownDirs >= 2) {
      e.lastJunctionCell = cellKey;
      const newPath = pathToGoal(e, team, cx, cy, goal);
      if (newPath && newPath.length > 0) {
        e.path = newPath;
        e.pathTimer = 2.5;
      }
      if (!rushing) triggerThink(e);      // 直冲时不磨蹭，路口也不停下思考
      return;
    }
  }

  /* ========== 常规：智能扫描（走廊里不扫，先走进去） ========== */
  if (!e.corridor) {
    e.aiScanTimer -= dt;
    if (e.aiScanTimer <= 0 && e.scanCooldown <= 0) {
      const ratio = localUnknownRatio(cx, cy, team, 2);
      const sameCell = e.lastScanCell === cellKey;
      const recent = (game.elapsed - e.lastScanTime) < 4.0;

      if (ratio > 0.4 && !(sameCell && recent)) {
        startScan(e);
        e.lastScanCell = cellKey;
        e.lastScanTime = game.elapsed;
        e.aiScanTimer = 2.5 + Math.random() * 2.5;
        return;
      }
      e.aiScanTimer = 1;
    }
  }

  /* ========== 常规：朝角色目标寻路 ========== */
  e.pathTimer -= dt;
  if (!e.path || e.pathTimer <= 0 || e.path.length === 0) {
    // 严格绕不开（雷把走廊封死了）时退回「软」路径：把雷当成很贵的一步先走过去，
    // 等它进入 path[0] 自然会触发排雷决策，总比原地罚站着不动好
    e.path = pathToGoal(e, team, cx, cy, goal)
          || route(team, cx, cy, goal.x, goal.y, { softMines: true })
          || [];
    e.pathTimer = 0.8 + Math.random() * 0.4;
  }

  /* ========== 保险：绝不主动踩进已知雷格 ========== */
  // 走到这一步说明「严格绕不开」（雷把路封死了，走的是软路径），
  // 那就别硬闯，转成排雷意图：靠近 → 拆掉 → 继续走。
  if (!e.wantToDefuse && e.path && e.path.length > 0) {
    const n0 = e.path[0];
    if (isKnownMine(team, idx(n0.x, n0.y))) {
      e.wantToDefuse = { x: n0.x, y: n0.y };
      e.defuseApproachTimer = 0;
      e.mineLockKey = `${n0.x},${n0.y},adj`;
      return;
    }
  }

  moveAlongPath(e, team, dt);
}
