/**
 * 玩家指令（Command）。
 *
 * 指令是**唯一**从「人的操作」进入「模拟」的通道：
 *   · 本地键盘 → 指令 → 模拟；
 *   · 联机时客户端把同一份指令发给房主（见 net/protocol.js）。
 *
 * 所以指令必须是纯数据、可 JSON 序列化、可校验：
 * normalizeCommand() 会把任何来源（本地键盘、网络包、回放记录）的输入
 * 夹到合法范围内，模拟层永远假设指令是干净的。
 */
import { clamp } from './utils.js';

/** 单个玩家的指令字段（改这里就等于改协议，记得同步 PROTOCOL_VERSION） */
export function emptyCommand(playerIndex = 0) {
  return {
    p: playerIndex,      // 玩家序号 0/1（双人模式）
    mx: 0,               // 移动方向（已归一化前的分量，-1/0/1）
    my: 0,
    run: false,          // 是否快步
    noise: false         // 本 tick 是否请求发出主动噪声
  };
}

/** 从原始输入构造指令 */
export function makeCommand(playerIndex, { moveX = 0, moveY = 0, run = false, noise = false } = {}) {
  return normalizeCommand({ p: playerIndex, mx: moveX, my: moveY, run, noise });
}

/**
 * 规范化 + 校验。任何越界值都会被夹回合法范围，
 * 非法结构直接退化成空指令，绝不让网络包污染模拟。
 */
export function normalizeCommand(raw) {
  const cmd = emptyCommand(0);
  if (!raw || typeof raw !== 'object') return cmd;

  const p = Number(raw.p);
  cmd.p = Number.isFinite(p) ? clamp(Math.floor(p), 0, 1) : 0;

  const mx = Number(raw.mx), my = Number(raw.my);
  cmd.mx = Number.isFinite(mx) ? clamp(mx, -1, 1) : 0;
  cmd.my = Number.isFinite(my) ? clamp(my, -1, 1) : 0;
  cmd.run = !!raw.run;
  cmd.noise = !!raw.noise;
  return cmd;
}

export function commandsEqual(a, b) {
  if (!a || !b) return a === b;
  return a.p === b.p && a.mx === b.mx && a.my === b.my && a.run === b.run && a.noise === b.noise;
}

/** 把一组指令整理成「按下标索引」的数组，模拟层按玩家序号取用 */
export function indexCommands(list) {
  const out = [];
  for (const raw of list || []) {
    const cmd = normalizeCommand(raw);
    out[cmd.p] = cmd;
  }
  return out;
}
