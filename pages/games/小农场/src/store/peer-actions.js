/**
 * 联机好友农场上的操作：浇水 / 杀虫 / 施肥 / 偷菜。
 *
 * 铁律：**农场主人是权威**。访客只发「我想在这块地上做这个」，
 * 由对方在自己的存档里校验并执行，再把结果回给访客；
 * 访客本地只做「自己这一侧」的记账（经验、扣道具、拿到收成）。
 *
 * 这样即使访客改了内存，也改不动别人家的地：
 *   - 每块地每轮只能偷 1 个 → 主人侧用 `stolen` 拦住，重放无效；
 *   - 被狗抓住 → 主人侧把**所有**作物标 `guarded`，本轮都偷不了；
 *   - 浇水 / 杀虫 / 施肥都先校验状态（真的缺水？这轮没施过肥？），
 *     状态不对直接回 `ok:false`。
 *
 * 被狗赶走**不罚款**（第 61 轮用户定死）：两边都不动钱，
 * 原先的「访客扣钱 → act:pay 报给主人入账」整条报文链路已删除。
 *
 * 请求带 `req` + 4 秒超时：对方掉线时不会让按钮一直转。
 */
import { on, emit, EVENTS } from '../core/bus.js';
import { PLAYER_ID, state } from './state.js';
import { notify } from './notify.js';
import * as player from './player.js';
import { bump } from './daily.js';
import { add, has, take } from './inventory.js';
import { CROPS } from '../data/crops.js';
import { ITEMS } from '../data/items.js';
import { produceId } from '../data/keys.js';
import { needsPest, needsWater, serveCare } from '../data/care.js';
import { stageBounds } from '../data/stages.js';
import { BOOST_CAP, PEST_YIELD_BONUS, WATER_SPEEDUP } from '../data/friends.js';
import { DOG_FOOD_SATIETY, DOG_SATIETY_MAX, catchChance, dogBreed, dogSatietyAt } from '../data/dogs.js';
import { isStealable } from './social.js';
import { completeGuide } from './codex.js';
import { commit } from '../core/storage.js';
import { peerList, sendToPeer } from './peers.js';
import { MSG } from '../net/protocol.js';

/** 等对方执行的时间 */
const ACT_TIMEOUT_MS = 4000;

/** 访客侧发出的请求：req → { resolve, timer } */
const pending = new Map();

let seq = 0;
let inited = false;

/**
 * 接上 `act` 报文。启动时调一次。
 */
export function initPeerActions() {
  if (inited) return;
  inited = true;
  on(EVENTS.PEER_MSG, ({ msg, peerId }) => {
    if (!msg || !peerId) return;
    if (msg.t === MSG.ACT) handleAct(msg, peerId);
    else if (msg.t === MSG.ACT_RES) handleResult(msg);
  });
}

/* ============================================================
   访客侧
   ============================================================ */

/**
 * 发一个操作请求。
 * @param {string} peerId
 * @param {'water'|'pest'|'fert'|'steal'|'feedDog'} kind
 * @param {number} index 地块序号（feedDog 传 -1 = 农场级操作）
 * @param {string} [itemId] 施肥用的道具
 * @returns {Promise<object|null>}
 */
function request(peerId, kind, index, itemId = '') {
  if (kind !== 'feedDog' && (!Number.isInteger(index) || index < 0 || index > 39)) return Promise.resolve(null);
  seq += 1;
  const req = `${state.farm.id}:a${seq}:${Date.now()}`;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(req);
      resolve(null);
    }, ACT_TIMEOUT_MS);
    pending.set(req, { resolve, timer });

    const sent = sendToPeer(peerId, { t: MSG.ACT, req, kind, plot: index, itemId });
    if (!sent) {
      clearTimeout(timer);
      pending.delete(req);
      resolve(null);
    }
  });
}

/** 帮对方浇水。成功后自己拿经验（和帮 NPC 浇水一致） */
export async function waterPeer(peerId, index) {
  const peer = peerList().find((item) => item.connectId === peerId);
  const cropId = peer?.plots?.[index]?.cropId;
  if (!peer || !cropId) return false;

  const res = await request(peerId, 'water', index);
  if (!res?.ok) {
    notify(res?.reason || '浇水没有成功');
    return false;
  }
  // 主人回执里带着新的成熟时间：本地快照当场对齐，
  // 弹窗里的倒计时立刻降，不用等下一轮快照推送
  if (Number.isFinite(res.readyAt) && peer.plots?.[index]) {
    peer.plots[index].readyAt = res.readyAt;
  }
  const exp = CROPS[cropId].lv;
  player.addExpRaw(exp);
  // 最友善榜：帮真人打理和帮 NPC 打理是同一件事，口径必须一致
  bump(PLAYER_ID, 'care');
  player.addLog('💧', `帮 ${peer.name} 浇了 ${CROPS[cropId].name}（经验 +${exp}）`);
  await commit({ farms: [state.farm] });
  emit(EVENTS.FARM);
  emit(EVENTS.PLAYER);
  completeGuide('care');
  notify(`💧 帮 ${peer.name} 浇了水（经验 +${exp}）`);
  return true;
}

/** 帮对方杀虫 */
export async function pestPeer(peerId, index) {
  const peer = peerList().find((item) => item.connectId === peerId);
  const cropId = peer?.plots?.[index]?.cropId;
  if (!peer || !cropId) return false;

  const res = await request(peerId, 'pest', index);
  if (!res?.ok) {
    notify(res?.reason || '捉虫没有成功');
    return false;
  }
  const exp = CROPS[cropId].lv;
  player.addExpRaw(exp);
  bump(PLAYER_ID, 'care');
  player.addLog('🐛', `帮 ${peer.name} 捉了虫（经验 +${exp}）`);
  await commit({ farms: [state.farm] });
  emit(EVENTS.FARM);
  emit(EVENTS.PLAYER);
  completeGuide('care');
  notify(`🐛 帮 ${peer.name} 捉了虫（经验 +${exp}）`);
  return true;
}

/** 帮对方施肥：用**自己的**化肥，成功之后才扣 */
export async function fertPeer(peerId, index, itemId) {
  const peer = peerList().find((item) => item.connectId === peerId);
  if (!peer || !ITEMS[itemId]?.fert || !has(itemId)) return false;

  const res = await request(peerId, 'fert', index, itemId);
  if (!res?.ok) {
    notify(res?.reason || '施肥没有成功');
    return false;
  }
  take(itemId, 1);
  bump(PLAYER_ID, 'care');
  player.addLog(ITEMS[itemId].emoji, `帮 ${peer.name} 施了${ITEMS[itemId].name}`);
  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.FARM);
  emit(EVENTS.INVENTORY);
  completeGuide('fert');
  notify(`${ITEMS[itemId].emoji} 帮 ${peer.name} 施了肥`);
  return true;
}

/**
 * 偷对方的菜。主人判定能不能偷 / 有没有被狗抓住；
 * 访客只负责「拿到 1 个」或者「这趟白跑」。
 */
export async function stealPeer(peerId, index) {
  const peer = peerList().find((item) => item.connectId === peerId);
  const cropId = peer?.plots?.[index]?.cropId;
  if (!peer || !cropId) return { ok: false };

  const res = await request(peerId, 'steal', index);
  if (!res) {
    notify('对方没有响应');
    return { ok: false };
  }

  const crop = CROPS[cropId];
  if (res.caught) {
    player.addLog('🐕', `偷 ${peer.name} 家被守护犬赶了出来`);
    emit(EVENTS.DOG_CAUGHT, { breed: peer.dog?.breed, owner: peer.name });
    notify(`🐕 被 ${peer.name} 家的守护犬赶出来了！这一轮他家都偷不了`, 'gold');
    return { ok: false, caught: true };
  }

  if (!res.ok) {
    notify(res.reason || '这块地现在不能偷');
    return { ok: false };
  }

  add(produceId(cropId), 1);
  player.addLog('🥷', `从 ${peer.name} 家顺走了 ${crop.emoji}${crop.name} ×1`);
  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.INVENTORY);
  emit(EVENTS.FARM);
  completeGuide('steal');
  notify(`偷到 ${crop.emoji}${crop.name} ×1`, 'gold');
  return { ok: true, cropId };
}

/**
 * 给对方的狗添一份狗粮（从自己包裹扣）。
 * 主人侧校验并加饱腹度；访客侧扣狗粮、记日志。
 */
export async function feedPeerDog(peerId) {
  const peer = peerList().find((item) => item.connectId === peerId);
  if (!peer?.dog?.breed) {
    notify('对方没有养狗');
    return false;
  }
  // 先用快照预判：满了就别白扣一份狗粮、也别白打扰对方一次请求
  if (dogSatietyAt(peer.dog, Date.now()) >= DOG_SATIETY_MAX - 1) {
    notify(`🐕 ${peer.name} 的狗粮槽已经满了`);
    return false;
  }
  if (!take('dogFood', 1)) {
    notify('没有狗粮，去商店买吧');
    return false;
  }
  const res = await request(peerId, 'feedDog', -1);
  if (!res?.ok) {
    // 失败退回狗粮
    add('dogFood', 1);
    notify(res?.reason || '对方没有响应');
    return false;
  }
  // 主人回执里带着新存量：先把本地快照对齐，弹窗上的数字立刻就对，
  // 不用等 1.2 秒后那次快照推送
  if (Number.isFinite(res.satiety)) {
    peer.dog.satiety = res.satiety;
    peer.dog.at = Date.now();
  }
  // 和给 NPC 家狗添粮同一个口径：也算一次「帮邻里打理」
  bump(PLAYER_ID, 'care');
  player.addLog('🦴', `给 ${peer.name} 的守护犬添了狗粮`);
  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.INVENTORY);
  notify(`🐕 给 ${peer.name} 的狗添了狗粮`, 'gold');
  return true;
}

/** 对方回话了 */
function handleResult(msg) {
  const req = String(msg.req || '').slice(0, 64);
  const item = pending.get(req);
  if (!item) return;
  clearTimeout(item.timer);
  pending.delete(req);
  item.resolve(msg);
}

/* ============================================================
   主人侧：校验 + 执行
   ============================================================ */

/** 收到别人的操作请求 */
function handleAct(msg, peerId) {
  const peer = peerList().find((item) => item.connectId === peerId);
  const index = Number(msg.plot);
  const req = typeof msg.req === 'string' ? msg.req.slice(0, 64) : '';
  if (!peer || !req) return;

  const reply = (payload) => sendToPeer(peerId, { t: MSG.ACT_RES, req, ...payload });

  // 农场级操作：给狗添狗粮（不走地块校验）
  if (msg.kind === 'feedDog') {
    if (!state.farm.dog?.breed) {
      reply({ ok: false, reason: '我家没有养狗' });
      return;
    }
    const now = Date.now();
    const before = dogSatietyAt(state.farm.dog, now);
    if (before >= DOG_SATIETY_MAX - 1) {
      // 满了就明确拒收，访客那边会把狗粮退回去，别让人白花一份
      reply({ ok: false, reason: '狗粮槽已经满了' });
      return;
    }
    const next = Math.min(DOG_SATIETY_MAX, before + DOG_FOOD_SATIETY);
    state.farm.dog.satiety = next;
    // ⚠️ 必须是 `at`（衰减基准时刻），不是 `fedAt` —— 见 social.feedFriendDog 的注释
    state.farm.dog.at = now;
    player.addLog('🦴', `${peer.name} 给你的守护犬添了狗粮`, now, peer.id);
    commit({ farms: [state.farm] }).then(() => emit(EVENTS.FARM));
    reply({ ok: true, satiety: Math.round(next) });
    return;
  }

  if (!Number.isInteger(index) || index < 0 || index > 39) return;

  const plot = state.farm.plots[index];
  if (!plot?.usable || !plot.cropId) {
    reply({ ok: false, reason: '这块地没有作物' });
    return;
  }

  const now = Date.now();
  const growing = now < plot.readyAt;
  const crop = CROPS[plot.cropId];

  if (msg.kind === 'water') {
    if (!growing || !needsWater(plot, now)) {
      reply({ ok: false, reason: '这块地不缺水' });
      return;
    }
    // 与自家农场 / NPC 家同一套：当前阶段砍 10%，别让浇水只剩交情没有效果
    const bounds = stageBounds(plot, crop, now);
    const saved = Math.max(0, Math.round((bounds.stageEnd - bounds.stageStart) * WATER_SPEEDUP));
    plot.readyAt = Math.max(now, plot.readyAt - saved);
    serveCare(plot, 'water', now);
    player.addLog('💧', `${peer.name} 帮你给 ${crop.name} 浇了水`, now, peer.id);
    // 回执带上新成熟时间：访客拿它就地对齐本地快照，倒计时当场降
    applyHostChange(reply, { ok: true, readyAt: plot.readyAt });
    return;
  }

  if (msg.kind === 'pest') {
    if (!growing || !needsPest(plot, now)) {
      reply({ ok: false, reason: '这块地没有虫子' });
      return;
    }
    plot.boost = Math.min(BOOST_CAP, (plot.boost || 0) + PEST_YIELD_BONUS);
    serveCare(plot, 'pest', now);
    player.addLog('🐛', `${peer.name} 帮你给 ${crop.name} 捉了虫`, now, peer.id);
    applyHostChange(reply);
    return;
  }

  if (msg.kind === 'fert') {
    const item = ITEMS[msg.itemId];
    if (!item?.fert || !growing || plot.fert) {
      reply({ ok: false, reason: plot.fert ? '这块地这轮已经施过肥了' : '现在不能施肥' });
      return;
    }
    // 效果与自己的 fertilize 一致：增产剂加产量，化肥缩短成熟
    if (item.boost) {
      plot.yieldBonus = item.boost;
    } else {
      const before = Math.max(0, plot.readyAt - now);
      const saved = item.instant ? before : Math.min(before, item.minutes * 60_000);
      plot.readyAt = item.instant ? now : Math.max(now, plot.readyAt - saved);
    }
    plot.fert = true;
    player.addLog(item.emoji, `${peer.name} 帮你给 ${crop.name} 施了${item.name}`, now, peer.id);
    applyHostChange(reply);
    return;
  }

  if (msg.kind === 'steal') {
    if (!isStealable(plot, now)) {
      reply({ ok: false, reason: '这块地现在不能偷' });
      return;
    }
    const breed = dogBreed(state.farm.dog?.breed);
    const chance = breed ? catchChance(breed.rate, dogSatietyAt(state.farm.dog, now)) : 0;
    if (chance > 0 && Math.random() < chance) {
      // 抓住一次，整座农场的作物这一轮都进不去（第 61 轮起不再罚款）
      for (const item of state.farm.plots) {
        if (item.cropId) item.guarded = true;
      }
      // 狗狗王：我家的狗拦下了真人访客 —— 和拦下 NPC 是同一件事
      bump(PLAYER_ID, 'dog', 1, now);
      player.addLog('🐕', `守护犬把想偷菜的 ${peer.name} 赶了出去`, now, peer.id);
      commit({ farms: [state.farm] })
        .then(() => emit(EVENTS.FARM))
        .catch((error) => console.error(error));
      reply({ ok: false, caught: true });
      return;
    }

    plot.stolen = true;
    plot.stolenCount = (plot.stolenCount || 0) + 1;
    player.addLog('🥷', `${peer.name} 顺走了 ${crop.emoji}${crop.name} ×1`, now, peer.id);
    applyHostChange(reply, { ok: true });
    return;
  }
}

/** 主人改完自己的地：落盘、回执、让推送把新快照发出去 */
function applyHostChange(reply, payload = { ok: true }) {
  commit({ farms: [state.farm] })
    .then(() => {
      emit(EVENTS.FARM);
      reply(payload);
    })
    .catch((error) => {
      console.error(error);
      reply({ ok: false, reason: '操作没能保存' });
    });
}

