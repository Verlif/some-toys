/**
 * 道具（世界层：刷新点、生命周期、拾取判定）。
 *
 * 规则来自需求：
 *   · 每 ITEM_SPAWN_INTERVAL（20 秒）随机刷出一个；
 *   · **所有角色都看得见**（渲染层无条件画出来，不做可见性过滤）；
 *   · 任何角色碰到就能捡（人类玩家与 AI 都会捡）。
 *
 * “捡到之后发生什么”属于模拟规则，放在 sim/effects.js。
 */
import {
  TILE, ITEM_RADIUS, ITEM_SPAWN_INTERVAL, ITEM_LIFETIME,
  ITEM_POOL, ITEM_TYPES, ITEM_SPAWN_MIN_DIST, ITEM_PICKUP_PAD
} from '../core/config.js';
import { gstate } from '../core/state.js';
import { rng, pickOne } from '../core/rng.js';
import { nowSec } from '../core/timer.js';
import { emit, EVT } from '../core/events.js';
import { isActive } from '../core/teams.js';
import { getOpenCells } from './map.js';

/** 新开一局时清空道具，并把第一个道具的刷新倒计时重置 */
export function resetItems() {
  gstate.items.length = 0;
  gstate.itemLog.length = 0;
  gstate.itemTimer = ITEM_SPAWN_INTERVAL;
  gstate.nextItemId = 1;
}

/** 找一个“离所有角色与已有道具都够远”的空地 */
function pickSpawnPosition() {
  const cells = getOpenCells();
  if (!cells.length) return { x: TILE * 1.5, y: TILE * 1.5 };
  const farEnough = (x, y) => {
    for (const e of gstate.entities) {
      if (!isActive(e)) continue;
      if (Math.hypot(e.x - x, e.y - y) < ITEM_SPAWN_MIN_DIST) return false;
    }
    for (const it of gstate.items) {
      if (Math.hypot(it.x - x, it.y - y) < ITEM_SPAWN_MIN_DIST) return false;
    }
    return true;
  };

  for (let attempt = 0; attempt < 40; attempt++) {
    const c = cells[(rng() * cells.length) | 0];
    const x = c.x * TILE + TILE / 2, y = c.y * TILE + TILE / 2;
    if (farEnough(x, y)) return { x, y };
  }
  const c = cells[(rng() * cells.length) | 0];
  return { x: c.x * TILE + TILE / 2, y: c.y * TILE + TILE / 2 };
}

/**
 * 刷出一个道具。
 * @param {string} [typeId] 指定类型，缺省从 ITEM_POOL 随机
 */
export function spawnItem(typeId) {
  const id = typeId || pickOne(ITEM_POOL);
  const type = ITEM_TYPES[id] || ITEM_TYPES[ITEM_POOL[0]];
  const pos = pickSpawnPosition();
  const nowT = nowSec();
  const item = {
    id: gstate.nextItemId++,
    type: type.id,
    x: pos.x, y: pos.y,
    prevX: pos.x, prevY: pos.y,
    r: ITEM_RADIUS,
    bornAt: nowT,
    expireAt: nowT + ITEM_LIFETIME
  };
  gstate.items.push(item);
  emit(EVT.ITEM_SPAWN, { item, type });
  return item;
}

/** 推进刷新计时；到点就刷一个 */
export function updateItemSpawns(dt) {
  gstate.itemTimer -= dt;
  while (gstate.itemTimer <= 0) {
    gstate.itemTimer += ITEM_SPAWN_INTERVAL;   // 用累加而不是重置，掉帧也不会让节奏漂移
    spawnItem();
  }
}

/** 清掉到期道具 */
export function updateItemExpiry() {
  const nowT = nowSec();
  for (let i = gstate.items.length - 1; i >= 0; i--) {
    const item = gstate.items[i];
    if (item.expireAt <= nowT) {
      gstate.items.splice(i, 1);
      emit(EVT.ITEM_EXPIRE, { item });
    }
  }
}

/**
 * 拾取判定：角色圆与道具圆相交即算捡到。
 * @returns {{item:object, holder:object}[]}
 */
export function collectPickups() {
  const picked = [];
  if (!gstate.items.length) return picked;
  for (let i = gstate.items.length - 1; i >= 0; i--) {
    const item = gstate.items[i];
    let holder = null;
    for (const e of gstate.entities) {
      if (!isActive(e)) continue;
      const reach = e.r + item.r + ITEM_PICKUP_PAD;
      if (Math.hypot(e.x - item.x, e.y - item.y) <= reach) { holder = e; break; }
    }
    if (holder) {
      gstate.items.splice(i, 1);
      picked.push({ item, holder });
    }
  }
  return picked;
}

/**
 * 离某个角色最近的道具（AI 决定要不要绕路去捡时用）。
 * @param {object} entity
 * @param {number} maxDist 超过这个距离就不感兴趣
 */
export function nearestItemTo(entity, maxDist) {
  let best = null, bestD = maxDist ?? Infinity;
  for (const item of gstate.items) {
    const d = Math.hypot(item.x - entity.x, item.y - entity.y);
    if (d < bestD) { bestD = d; best = item; }
  }
  return best;
}

/** 道具类型的展示信息 */
export function itemTypeOf(item) {
  return ITEM_TYPES[item?.type] || null;
}
