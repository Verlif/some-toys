/**
 * 联机好友农场上的操作：浇水 / 杀虫 / 施肥 / 偷菜。
 *
 * 铁律：**农场主人是权威**。访客只发「我想在这块地上做这个」，
 * 由对方在自己的存档里校验并执行，再把结果回给访客；
 * 访客本地只做「自己这一侧」的记账（经验、扣道具、拿到收成、交罚款）。
 *
 * 这样即使访客改了内存，也改不动别人家的地：
 *   - 每块地每轮只能偷 1 个 → 主人侧用 `stolen` 拦住，重放无效；
 *   - 被狗抓住 → 主人侧把**所有**作物标 `guarded`，本轮都偷不了；
 *   - 浇水 / 杀虫 / 施肥都先校验状态（真的缺水？这轮没施过肥？），
 *     状态不对直接回 `ok:false`；
 *   - 罚款由访客扣、报给主人入账，钱不会凭空生出来。
 *
 * 请求带 `req` + 4 秒超时：对方掉线时不会让按钮一直转。
 */
import { on, emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';
import { notify } from './notify.js';
import * as player from './player.js';
import { add, has, take } from './inventory.js';
import { CROPS } from '../data/crops.js';
import { ITEMS } from '../data/items.js';
import { produceId } from '../data/keys.js';
import { needsPest, needsWater, serveCare } from '../data/care.js';
import { BOOST_CAP, PEST_YIELD_BONUS } from '../data/friends.js';
import { DOG_FINE_MULTIPLE, DOG_FOOD_SATIETY, DOG_SATIETY_MAX, catchChance, dogBreed, dogSatietyAt } from '../data/dogs.js';
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

/** 主人侧记下的罚款：req → 金额，防止对方事后报一个离谱的数字来「送钱/刷钱」 */
const fines = new Map();

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
    else if (msg.t === MSG.ACT_PAY) handlePay(msg, peerId);
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
  const exp = CROPS[cropId].lv;
  player.addExpRaw(exp);
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
 * 访客只负责「拿到 1 个」或「交罚款」。
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
    const fine = Math.max(0, Math.round(res.fine || 0));
    const paid = Math.min(state.farm.coins, fine);
    player.addCoins(-paid);
    player.addLog('🐕', `偷 ${peer.name} 家被守护犬抓住，罚款 ${paid} 金币`);
    await commit({ farms: [state.farm] });
    emit(EVENTS.PLAYER);
    // 罚款归对方：单独回一条，让对方入账
    sendToPeer(peerId, { t: MSG.ACT_PAY, req: res.req, paid });
    emit(EVENTS.DOG_CAUGHT, { breed: peer.dog?.breed, owner: peer.name, fine: paid });
    notify(`🐕 被 ${peer.name} 家的守护犬抓住了！罚款 ${paid} 金币，这一轮他家都偷不了`, 'gold');
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
    const next = Math.min(DOG_SATIETY_MAX, dogSatietyAt(state.farm.dog, now) + DOG_FOOD_SATIETY);
    state.farm.dog.satiety = next;
    state.farm.dog.fedAt = now;
    player.addLog('🦴', `${peer.name} 给你的守护犬添了狗粮`, now, peer.id);
    commit({ farms: [state.farm] }).then(() => emit(EVENTS.FARM));
    reply({ ok: true });
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
    serveCare(plot, 'water', now);
    player.addLog('💧', `${peer.name} 帮你给 ${crop.name} 浇了水`, now, peer.id);
    applyHostChange(reply);
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
      // 抓住一次，整座农场的作物这一轮都进不去
      for (const item of state.farm.plots) {
        if (item.cropId) item.guarded = true;
      }
      const fine = Math.round(crop.sell * DOG_FINE_MULTIPLE);
      fines.set(req, fine);
      player.addLog('🐕', `守护犬抓住了想偷菜的 ${peer.name}（罚款 ${fine} 金币）`, now, peer.id);
      commit({ farms: [state.farm] })
        .then(() => emit(EVENTS.FARM))
        .catch((error) => console.error(error));
      reply({ ok: false, caught: true, fine });
      return;
    }

    plot.stolen = true;
    plot.stolenCount = (plot.stolenCount || 0) + 1;
    player.addLog('🥷', `${peer.name} 顺走了 ${crop.emoji}${crop.name} ×1`, now, peer.id);
    applyHostChange(reply, { ok: true });
    return;
  }
}

/** 罚款到账 */
function handlePay(msg, peerId) {
  const peer = peerList().find((item) => item.connectId === peerId);
  if (!peer) return;
  // 罚款金额由对方报过来，但**上限是主人自己记下的那笔**：
  // 不夹的话对方可以报一个大数给自己刷金 / 给主人塞钱。
  const req = String(msg.req || '').slice(0, 64);
  const fine = fines.get(req) || 0;
  fines.delete(req);
  const paid = Math.max(0, Math.min(fine, Math.round(Number(msg.paid) || 0)));
  if (!paid) return;
  player.addCoins(paid);
  player.addLog('💰', `${peer.name} 交了 ${paid} 金币罚款`, Date.now(), peer.id);
  commit({ farms: [state.farm] })
    .then(() => {
      emit(EVENTS.PLAYER);
      emit(EVENTS.FARM);
    })
    .catch((error) => console.error(error));
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

