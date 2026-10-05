/**
 * 实体创建：按「队伍 × 每队人数」生成角色，真人玩家按 settings.playerTeams 落座，
 * 其余全部为 AI。所有人从左侧出发区随机位置起步（带轻微抖动避免完全重叠）。
 *
 * 双人落座方案：
 *   各带一队 → P1 在 0 队、P2 在 1 队，各占队内第一个座位
 *   并肩同队 → 两人都在 0 队的前两个座位（队内不足 2 座时自动退回各带一队）
 */
import { H, TILE, SCAN_DURATION, DEFUSE_DURATION, AI_ROLES, PLAYER_TEAM_SAME } from '../core/config.js';
import { shuffle } from '../core/utils.js';
import { settings, game } from '../core/state.js';

/** 返回 Map：座次键 "队伍,队内序号" → 玩家序号 */
function playerSeats() {
  const seats = new Map();
  if (settings.playerCount < 1) return seats;

  const sameTeam = settings.playerCount === 2 &&
                   settings.playerTeams === PLAYER_TEAM_SAME &&
                   settings.teamSize >= 2 &&
                   settings.teamCount >= 1;

  for (let i = 0; i < settings.playerCount; i++) {
    seats.set(sameTeam ? `0,${i}` : `${i},0`, i);
  }
  return seats;
}

export function createEntities() {
  game.entities = [];

  const spawnPoints = [];
  for (let y = 2; y < H - 2; y++) spawnPoints.push({ x: 1, y });
  shuffle(spawnPoints);

  const seats = playerSeats();
  let entIdx = 0;

  for (let t = 0; t < settings.teamCount; t++) {
    for (let s = 0; s < settings.teamSize; s++) {
      const seat = seats.get(`${t},${s}`);
      const isPlayer = seat !== undefined;
      const playerIndex = isPlayer ? seat : -1;

      const sp = spawnPoints[entIdx % spawnPoints.length];
      const offsetX = (Math.random() - 0.5) * TILE * 0.7;
      const offsetY = (Math.random() - 0.5) * TILE * 0.7;

      const e = {
        teamId: t, isPlayer, playerIndex,
        x: sp.x * TILE + TILE / 2 + offsetX,
        y: sp.y * TILE + TILE / 2 + offsetY,
        radius: 5, speed: 72,
        faceX: 1, faceY: 0,
        scanRadius: 2,
        scanTimer: 0, scanMax: SCAN_DURATION, scanCooldown: 0,
        // 共用按键
        actionKeyHeld: false,
        actionKeyHoldTime: 0,
        actionKeyTriggered: false,
        // 排雷
        defuseTimer: 0, defuseMax: DEFUSE_DURATION, defuseTarget: null, defuseCooldown: 0,
        // AI
        aiScanTimer: 1.5 + Math.random() * 2,
        thinkTimer: 0,
        // 分工：冲刺 / 夺旗 / 排雷，按队内座次轮转，保证小队里三种角色都有
        role: AI_ROLES[s % AI_ROLES.length],
        flagTarget: null,        // 当前盯上的旗（同时作为「已有人去」的声明）
        mineJob: null,           // 排雷手当前的作业目标
        goal: null,              // 角色目标缓存（含 flag / mine），靠 goalTimer 限流
        goalTimer: 0,
        initialRouteChosen: false,
        mineDecisionLock: false,
        mineLockKey: null,       // 对「同一颗雷的同一阶段」只决策一次
        // 终点冲刺：接近出口时高概率锁定直冲，小概率继续按角色思考
        rushMode: false,
        rushRetry: 0,
        // 共享视野：记录本队「已知雷」的版本号，一有新雷就检查自己的路径
        intelVersion: 0,
        wantToDefuse: null,
        defuseApproachTimer: 0,
        lastJunctionCell: null,
        stuckCounter: 0,
        lastScanCell: null,
        lastScanTime: -10,
        routeRepickCount: 0,
        // 救援（严格限量，避免一人倒地全队围观）
        rescuer: null,           // 倒地者身上：谁在救我
        rescueTarget: null,      // 救援者身上：我在救谁
        rescueTimer: 0,
        rescueCooldown: 0,
        // 状态
        downed: false, respawnTimer: 0, invuln: 0,
        path: null, pathTimer: 0,
        bob: Math.random() * 6,
        arrived: false, arrivedAt: 0,
        pendingExplosions: [],
        entranceId: entIdx % game.entranceYs.length,
        // 出发区（迷宫左侧空地）：按位置实时判定，不做一次性标记，
        // 这样进去之后又被绕回来也能正确地走回入口，而不是在空地上反复决策
        inStaging: true,
        stagingThinkUsed: false,   // 本次待在出发区期间，那唯一一次思考是否已用掉
        // 入口走廊：刚跨过入口的这一小段只管往里走，不思考、不扫描
        corridor: false,
        corridorTimer: 0,

        // 本局统计（结算面板用）
        stats: {
          minesDefused: 0,   // 排雷数
          scans: 0,          // 扫描次数
          downs: 0,          // 被炸倒地次数
          flags: 0,          // 亲手夺旗数
          distance: 0        // 行走距离（像素）
        }
      };

      game.entities.push(e);
      game.teams[t].members.push(e);
      entIdx++;
    }
  }
}
