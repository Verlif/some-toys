/**
 * 会话层：把「单机 / 房主 / 客户端」三种角色统一成同一个接口。
 *
 *   offline —— 直接推进本地模拟（现在的单机与本地双人）
 *   host    —— 推进权威模拟，并广播快照 / 事件 / 发声；同时吃下客户端的指令
 *   guest   —— 只发送自己的指令，接收快照覆盖本地状态（含声波重建与插值）
 *
 * 为什么现在就把三条路都写出来：
 *   等到写 WebSocket 服务器时，业务代码（main.js / render / ui）不需要任何改动 ——
 *   它们只认 session.step() / session.submitCommand()。
 *   本地用 createLoopbackPair() 就能把「房主 + 客户端」跑起来做自动化测试。
 *
 * ★ 权威模型：房主权威（host-authoritative），不是锁步。
 *   客户端不做预测，只做快照插值；这样实现简单、容错好，
 *   将来要加客户端预测，只需要在 guest 分支里补上本地预测与回滚。
 */
import { NET_SNAPSHOT_HZ } from '../core/config.js';
import { gstate } from '../core/state.js';
import { nowSec } from '../core/timer.js';
import { on, emit, EVT } from '../core/events.js';
import { normalizeCommand, commandsEqual } from '../core/command.js';
import { startMatch, stepMatch, applyRemoteStart } from '../sim/simulation.js';
import { updateSoundWaves, rebuildSoundFromEvent } from '../sim/sound.js';
import { serializeSnapshot, applySnapshot } from './snapshot.js';
import { MSG, makeMessage } from './protocol.js';
import { NullTransport } from './transport.js';

export const MODE = {
  OFFLINE: 'offline',
  HOST: 'host',
  GUEST: 'guest'
};

/** 客户端发送输入的最小间隔（秒）：60Hz 的输入没必要全发 */
const INPUT_SEND_INTERVAL = 1 / 30;
/** 待转发事件的缓冲上限，防止断线时无限堆积 */
const EVENT_BUFFER_MAX = 240;

export function createSession(options = {}) {
  const mode = options.mode || MODE.OFFLINE;
  const transport = options.transport || new NullTransport();
  const localPlayerIndex = options.localPlayerIndex ?? 0;
  const snapshotInterval = 1 / NET_SNAPSHOT_HZ;

  let snapshotTimer = 0;
  let inputTimer = 0;
  let lastSnapshotAt = nowSec();
  let lastSentCommand = null;
  let seq = 0;
  const remoteCommands = new Map();   // 玩家槽位 → 最新指令
  const eventBuffer = [];
  const unsubs = [];
  let disposed = false;

  gstate.net.mode = mode;
  gstate.net.connected = mode !== MODE.GUEST || transport.isOpen;

  /* ---------- 网络 → 本地 ---------- */

  const forwardEventLocally = (type, payload) => {
    if (type === 'sound') rebuildSoundFromEvent(payload);
  };

  const onMessage = msg => {
    switch (msg.type) {
      case MSG.SNAPSHOT:
        applySnapshot(msg.payload);
        lastSnapshotAt = nowSec();
        break;

      case MSG.EVENT:
        for (const item of msg.payload?.events || []) {
          // 客户端没有跑模拟，把事件重新派发给 UI（结算、提示条等）
          if (item.type !== 'sound') emit(item.type, item.payload);
          else forwardEventLocally(item.type, item.payload);
        }
        break;

      case MSG.SOUND:
        rebuildSoundFromEvent(msg.payload);
        break;

      case MSG.INPUT:
        if (mode === MODE.HOST && msg.payload?.cmd) {
          const cmd = normalizeCommand(msg.payload.cmd);
          remoteCommands.set(cmd.p, cmd);
        }
        break;

      case MSG.START:
        if (mode === MODE.GUEST) {
          applyRemoteStart(msg.payload);
          lastSnapshotAt = nowSec();
        }
        break;

      case MSG.PING:
        transport.send(makeMessage(MSG.PONG, { t: msg.payload?.t ?? 0 }, ++seq));
        break;

      case MSG.PONG:
        if (msg.payload?.t) {
          gstate.net.ping = Math.max(0, Date.now() - msg.payload.t);
        }
        break;

      default:
        break;
    }
  };

  if (mode !== MODE.OFFLINE) {
    unsubs.push(transport.onMessage(onMessage));
    unsubs.push(transport.onOpen(() => { gstate.net.connected = true; }));
    unsubs.push(transport.onClose(() => { gstate.net.connected = false; }));
    unsubs.push(transport.onError(err => {
      console.warn('[net] transport error:', err?.message || err);
    }));
  }

  /* ---------- 房主：把事件与发声搬上网 ---------- */

  const queueEvent = (type, payload) => {
    eventBuffer.push({ type, payload });
    if (eventBuffer.length > EVENT_BUFFER_MAX) eventBuffer.splice(0, eventBuffer.length - EVENT_BUFFER_MAX);
  };

  if (mode === MODE.HOST) {
    const netEvents = [
      EVT.MATCH_START, EVT.MATCH_END, EVT.COUNTDOWN_END,
      EVT.HIDER_CAUGHT, EVT.ITEM_SPAWN, EVT.ITEM_EXPIRE, EVT.ITEM_PICKUP, EVT.ITEM_EFFECT
    ];
    for (const type of netEvents) {
      unsubs.push(on(type, payload => queueEvent(type, payload)));
    }
    // 发声用专门的短消息（客户端本地重建射线）
    unsubs.push(on(EVT.SOUND_EMITTED, payload => {
      transport.send(makeMessage(MSG.SOUND, payload, ++seq));
    }));
  }

  /* ---------- 对外接口 ---------- */

  const session = {
    mode,
    transport,
    localPlayerIndex,

    /** 开始一局。房主会广播种子与配置，客户端据此本地生成同一张地图。 */
    startMatch(role, opts = {}) {
      if (mode === MODE.GUEST) return null;
      const result = startMatch(role, opts);
      if (mode === MODE.HOST) {
        transport.send(makeMessage(MSG.START, {
          seed: gstate.seed,
          role,
          cfg: {
            seekerCount: gstate.cfgSeekerCount,
            hiderCount: gstate.cfgHiderCount,
            playerCount: gstate.cfgPlayerCount,
            mapSize: gstate.cfgMapSize,
            gameTime: gstate.cfgGameTime
          }
        }, ++seq));
        snapshotTimer = 0;
      }
      return result;
    },

    /** 本地玩家产生的指令 */
    submitCommand(cmd) {
      const c = normalizeCommand(cmd);
      if (mode === MODE.GUEST) {
        remoteInputLatch(c);
        return c;
      }
      gstate.commands[c.p] = c;
      return c;
    },

    /**
     * 推进一帧。
     * @param {number} dt 固定步长（秒）
     */
    step(dt) {
      if (disposed) return;

      if (mode === MODE.GUEST) {
        // 客户端：只推进表现（声波年龄），世界状态完全由快照决定
        updateSoundWaves(dt);
        gstate.renderAlpha = Math.min(1, (nowSec() - lastSnapshotAt) / snapshotInterval);
        return;
      }

      if (mode === MODE.HOST) {
        // 合并远端指令（远端槽位不与本地冲突，这里直接覆盖同槽位）
        for (const [p, cmd] of remoteCommands) gstate.commands[p] = cmd;
      }

      stepMatch(dt);

      if (mode === MODE.HOST) {
        snapshotTimer -= dt;
        if (snapshotTimer <= 0) {
          snapshotTimer = snapshotInterval;
          transport.send(makeMessage(MSG.SNAPSHOT, serializeSnapshot(), ++seq));
          if (eventBuffer.length) {
            transport.send(makeMessage(MSG.EVENT, { events: eventBuffer.splice(0, eventBuffer.length) }, ++seq));
          }
        }
      }
    },

    /** 直接投喂一条消息（测试与自定义服务器用） */
    handleMessage: onMessage,

    dispose() {
      disposed = true;
      for (const off of unsubs) off();
      unsubs.length = 0;
      if (transport) transport.close();
      gstate.net.connected = false;
    }
  };

  /** 客户端输入节流：有变化或每 1/30 秒发一次 */
  function remoteInputLatch(cmd) {
    const changed = !commandsEqual(lastSentCommand, cmd);
    const nowT = nowSec();
    if (!changed && nowT - inputTimer < INPUT_SEND_INTERVAL) return;
    inputTimer = nowT;
    lastSentCommand = { ...cmd };
    transport.send(makeMessage(MSG.INPUT, { cmd }, ++seq));
    if (cmd.noise) lastSentCommand.noise = false;   // 一次性动作不重复发
  }

  return session;
}
