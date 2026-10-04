/**
 * 实体创建：按「队伍 × 每队人数」生成角色，真人玩家优先分配到前几支队伍，
 * 其余全部为 AI。所有人从左侧出发区随机位置起步（带轻微抖动避免完全重叠）。
 */
import { H, TILE, SCAN_DURATION, DEFUSE_DURATION } from '../core/config.js';
import { shuffle } from '../core/utils.js';
import { settings, game } from '../core/state.js';

export function createEntities() {
  game.entities = [];

  const spawnPoints = [];
  for (let y = 2; y < H - 2; y++) spawnPoints.push({ x: 1, y });
  shuffle(spawnPoints);

  let humanAssigned = 0;
  let entIdx = 0;

  for (let t = 0; t < settings.teamCount; t++) {
    for (let s = 0; s < settings.teamSize; s++) {
      let isPlayer = false, playerIndex = -1;
      if (humanAssigned < settings.playerCount && t === humanAssigned) {
        isPlayer = true;
        playerIndex = humanAssigned;
        humanAssigned++;
      }

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
        initialRouteChosen: false,
        mineDecisionLock: false,
        wantToDefuse: null,
        defuseApproachTimer: 0,
        lastJunctionCell: null,
        stuckCounter: 0,
        lastScanCell: null,
        lastScanTime: -10,
        routeRepickCount: 0,
        // 状态
        downed: false, respawnTimer: 0, invuln: 0,
        path: null, pathTimer: 0,
        bob: Math.random() * 6,
        arrived: false, arrivedAt: 0,
        pendingExplosions: [],
        entranceId: entIdx % game.entranceYs.length,
        enteredMaze: false,

        // 本局统计（结算面板用）
        stats: {
          minesDefused: 0,   // 排雷数
          scans: 0,          // 扫描次数
          downs: 0,          // 被炸倒地次数
          distance: 0        // 行走距离（像素）
        }
      };

      game.entities.push(e);
      game.teams[t].members.push(e);
      entIdx++;
    }
  }
}
