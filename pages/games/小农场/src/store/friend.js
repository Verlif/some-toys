/**
 * 好友关系（第 57 轮）：申请、答复、解除，以及 NPC 那一侧的自动判定。
 *
 * 关系本身存在 `relation` 表那一行的 `friend` 标记上（见 store/relation.js），
 * 这个模块只负责「什么时候翻这个标记、翻完通知谁」：
 *
 *   - **玩家 → NPC**：`requestFriend` 递申请。NPC 在线就隔 20 秒~4 分钟答复，
 *     按性格也可能「这次上线先不处理」；离线就一律等他下次上线（`decideAt = 0`）。
 *   - **NPC → 玩家**：`friendTick` 每次上线掷 20%，过了 0.8 倍门槛就往信箱寄一封
 *     `action: 'friend-request'` 的信，玩家点头才算成。
 *   - **NPC → NPC**：同样 20%、同样 0.8 倍门槛（两边取更难的），自动成，
 *     只寄一封「谁和谁成了好友」的消息让玩家知道村里发生了什么。
 *   - **解除**：玩家手动点，或者好感跌破门槛一半（见 store/relation.js）。
 *
 * NPC 那一侧是**纯函数 + 副作用注入**：npc-sim 不认识 store，它通过 `ctx` 拿到
 * `friendTick`（见 store/social.js 的 simCtx）。所以这个文件不 import npc-sim，
 * 方向只有一个，不会绕成环。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { randInt } from '../core/utils.js';
import { PLAYER_ID, state } from './state.js';
import { getRelation, isFriend, setFriend } from './relation.js';
import { findNotice, pushNotice } from './notices.js';
import { notify } from './notify.js';
import { addNews } from './news.js';
import { isNpcOnline, trimLog } from '../data/friends.js';
import {
  FRIEND_ASK_COOLDOWN,
  FRIEND_REPLY_MS,
  PROACTIVE_FRIEND_CHANCE,
  friendDeferChance,
  friendThreshold,
  proactiveFriendThreshold,
  relText,
} from '../data/relation.js';

/**
 * 按 id 找村民。
 * 只查 `state.friends` —— 联机真人（`peer:` 前缀）不在好友体系里，
 * 他们的「好友」是房间里的真人，靠握手，不走这套门槛。
 * @param {string} id
 */
const npcOf = (id) => state.friends.find((npc) => npc.id === id) || null;

/**
 * 这位村民现在能不能提「好友」这件事。
 * 冷却期里谁提都白搭：刚被拒、刚被删，缓半小时再说。
 * @param {object} npc
 * @param {number} at
 */
const inCooldown = (npc, at) => Boolean(npc.friendCoolAt && at < npc.friendCoolAt);

/** 给这位村民的动态里插一条（与 social.js 的 logFriend 同一套裁剪规则） */
function logNpc(npc, at, emoji, text) {
  npc.log ??= [];
  npc.log.unshift({ at, emoji, text });
  trimLog(npc.log);
}

/* ---------- 玩家 → NPC ---------- */

/**
 * 玩家递一张好友申请。
 *
 * @param {string} npcId
 * @returns {Promise<{ok: boolean, online?: boolean, reason?: string}>}
 */
export async function requestFriend(npcId) {
  const npc = npcOf(npcId);
  if (!npc) return { ok: false, reason: '找不到这位邻居' };
  if (isFriend(PLAYER_ID, npc.id)) {
    notify(`你和 ${npc.name} 已经是好友了`);
    return { ok: false, reason: 'friend' };
  }

  const now = Date.now();
  if (npc.friendAsk) {
    notify(`已经递过申请了，${npc.name} 还没答复`);
    return { ok: false, reason: 'pending' };
  }
  if (inCooldown(npc, now)) {
    notify(`${npc.name} 刚回绝过，过一会儿再问吧`);
    return { ok: false, reason: 'cooldown' };
  }

  const online = isNpcOnline(npc, now);
  // 在线：多半当场给答复，但按性格也可能「这次先不处理」，留到下次上线；
  // 离线：一律 `decideAt = 0`，等他下次上线那一刻判（用户要的就是这个）
  const defer = Math.random() < friendDeferChance(npc.personality);
  const decideAt = online && !defer
    ? now + randInt(FRIEND_REPLY_MS[0], FRIEND_REPLY_MS[1])
    : 0;

  npc.friendAsk = { at: now, decideAt };
  logNpc(npc, now, '💌', `${state.farm.name} 递来一张好友申请`);

  await commit({ farms: [npc] });
  emit(EVENTS.FRIENDS);
  notify(online
    ? `💌 申请递出去了，${npc.name} 说考虑一下`
    : `💌 申请递出去了，${npc.name} 不在家，等他下次上线`);
  return { ok: true, online };
}

/**
 * 玩家答复 NPC 寄来的好友申请（信箱里那两颗按钮）。
 *
 * @param {string} noticeId 通知 id
 * @param {boolean} accept 同意 / 拒绝
 * @returns {Promise<boolean>} 有没有真的处理掉一条
 */
export async function answerFriendRequest(noticeId, accept) {
  const notice = findNotice(noticeId);
  if (!notice || notice.action !== 'friend-request' || notice.claimed) return false;

  const now = Date.now();
  notice.claimed = true;
  notice.read = true;

  const npc = npcOf(notice.by);
  if (!npc) {
    await commit({ farms: [state.farm] });
    emit(EVENTS.NOTICE);
    return false;
  }

  if (!accept) {
    npc.friendCoolAt = now + FRIEND_ASK_COOLDOWN;
    logNpc(npc, now, '🙅', `${state.farm.name} 婉拒了他的好友申请`);
    await commit({ farms: [state.farm, npc] });
    emit(EVENTS.NOTICE);
    emit(EVENTS.FRIENDS);
    notify(`回绝了 ${npc.name} 的好友申请`);
    return true;
  }

  setFriend(PLAYER_ID, npc.id, true);
  logNpc(npc, now, '🤝', `跟 ${state.farm.name} 成了好友`);
  addNews('🤝', `${state.farm.name} 和 ${npc.name} 成了好友`, { at: now });
  await commit({ farms: [state.farm, npc], news: state.news, relations: state.relations });
  emit(EVENTS.NOTICE);
  emit(EVENTS.FRIENDS);
  emit(EVENTS.RELATION);
  emit(EVENTS.NEWS);
  notify(`🤝 你和 ${npc.name} 成了好友`, 'gold');
  return true;
}

/**
 * 玩家手动解除好友（好友详情里那颗按钮）。
 *
 * 解除之后给一段冷却：否则「热心」那类村民下次上线又会主动申请一遍，
 * 玩家删了等于没删。
 *
 * @param {string} npcId
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function unfriend(npcId) {
  const npc = npcOf(npcId);
  if (!npc || !isFriend(PLAYER_ID, npc.id)) return { ok: false, reason: '不是好友' };

  const now = Date.now();
  setFriend(PLAYER_ID, npc.id, false);
  npc.friendCoolAt = now + FRIEND_ASK_COOLDOWN;
  logNpc(npc, now, '💔', `${state.farm.name} 把他从好友里移除了`);

  await commit({ farms: [state.farm, npc], relations: state.relations });
  emit(EVENTS.FRIENDS);
  emit(EVENTS.RELATION);
  notify(`解除了和 ${npc.name} 的好友关系`);
  return { ok: true };
}

/* ---------- NPC 那一侧（由 npc-sim 的 friend 动作调用） ---------- */

/** 信箱里有没有这位村民还没被答复的申请 */
function hasPendingRequest(npcId) {
  return (state.farm.progress?.notices || [])
    .some((notice) => notice.action === 'friend-request' && notice.by === npcId && !notice.claimed);
}

/**
 * 一次上线的「好友事务」：先看看有没有欠玩家的答复，再掷一次主动申请。
 *
 * @param {object} npc
 * @param {number} at 这一次上线的时刻（补算时是过去）
 * @returns {?{emoji: string, text: string}} 写进邻居动态的一条，没有就是 null
 */
export function friendTick(npc, at) {
  return resolvePendingAsk(npc, at) || proactiveTry(npc, at);
}

/**
 * 玩家递过申请、还没答复的那一单。
 * `decideAt = 0` 表示「等他上线再判」，所以任何上线时刻都算到点。
 */
function resolvePendingAsk(npc, at) {
  const ask = npc.friendAsk;
  if (!ask) return null;
  if (ask.decideAt && ask.decideAt > at) return null;

  npc.friendAsk = null;
  // 这中间已经因为别的原因成了好友（比如他反过来申请、玩家点了同意）：
  // 申请就算自动完成，不再寄一封「同意 / 拒绝」
  if (isFriend(PLAYER_ID, npc.id)) return null;

  const rel = getRelation(PLAYER_ID, npc.id);
  const need = friendThreshold(npc.personality);

  if (rel >= need) {
    setFriend(PLAYER_ID, npc.id, true);
    pushNotice({
      kind: 'friend',
      emoji: '🤝',
      title: `${npc.name} 同意了你的好友申请`,
      body: `好感 ${relText(rel)}，已经够 ${need} 了`,
      by: npc.id,
      from: npc.name,
      at,
    });
    return { emoji: '🤝', text: `答应了 ${state.farm.name} 的好友申请` };
  }

  // 门槛没到就回绝，并记一段冷却 —— 免得玩家一秒钟后再问一遍
  npc.friendCoolAt = at + FRIEND_ASK_COOLDOWN;
  pushNotice({
    kind: 'friend',
    emoji: '🙅',
    title: `${npc.name} 回绝了你的好友申请`,
    body: `还差一点交情（现在 ${relText(rel)}，要 ${need}）`,
    by: npc.id,
    from: npc.name,
    at,
  });
  return { emoji: '🙅', text: `回绝了 ${state.farm.name} 的好友申请` };
}

/**
 * 每次上线 20% 的主动申请：先试玩家，玩家那边没戏就去找别的村民。
 */
function proactiveTry(npc, at) {
  if (inCooldown(npc, at)) return null;
  // 玩家的申请还压在他手上：先把这个答复完，别反过来又去申请一遍
  if (npc.friendAsk) return null;
  if (Math.random() >= PROACTIVE_FRIEND_CHANCE) return null;

  if (!isFriend(PLAYER_ID, npc.id)) {
    const rel = getRelation(PLAYER_ID, npc.id);
    if (rel >= proactiveFriendThreshold(npc.personality)) {
      // 信箱里已经躺着一封就不重复寄：玩家还没看，再寄一封只是刷屏
      if (hasPendingRequest(npc.id)) return null;
      pushNotice({
        kind: 'friend',
        action: 'friend-request',
        pending: true,
        emoji: '💌',
        title: `${npc.name} 想加你为好友`,
        body: `好感 ${relText(rel)}，他觉得你们处得来`,
        by: npc.id,
        from: npc.name,
        at,
      });
      return { emoji: '💌', text: `给 ${state.farm.name} 递了好友申请` };
    }
  }

  return npcToNpc(npc, at);
}

/**
 * NPC 之间互相加好友（用户定死：也进信箱）。
 *
 * 门槛同样按 0.8 倍、两边各判各的（取更难的那位）—— 自动成，不用谁点头，
 * 但玩家在信箱里看得见「谁和谁处到了一起」，村庄才像活的。
 */
function npcToNpc(npc, at) {
  const pool = state.friends.filter((other) => other.id !== npc.id
    && !isFriend(npc.id, other.id)
    && !inCooldown(other, at));
  if (!pool.length) return null;

  const target = pool[randInt(0, pool.length - 1)];
  const rel = getRelation(npc.id, target.id);
  if (rel < proactiveFriendThreshold(npc.personality, target.personality)) return null;

  setFriend(npc.id, target.id, true);
  pushNotice({
    kind: 'friend',
    emoji: '🤝',
    title: `${npc.name} 和 ${target.name} 成了好友`,
    body: '两位村民处到了一起',
    by: target.id,
    from: '村庄',
    at,
  });
  return { emoji: '🤝', text: `跟 ${target.name} 成了好友` };
}
