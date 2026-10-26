/**
 * 村庄建设：投入资源、每日祈福、升级、建设日志。
 *
 * 状态挂在 `state.farm.village` 上（和 `workshop` / `dogHouse` 一样）：
 * 村庄是全局唯一的一份，但为它单开一张表得改存档结构、读写路径、事务，
 * 而它每次变化都跟着玩家农场一起落盘 —— 挂在 farm 行上零成本。
 *
 *   { level, coins, crystals, pray, stock, prayDay, logs }
 *
 *   level     村庄等级 1~5
 *   coins     本期已投入的金币
 *   crystals  本期已投入的水晶数
 *   pray      本期祈福总次数（玩家 + 全部邻居）
 *   stock     { 1..4: n } 手上还没投入的水晶，冒险挖到就进这里
 *   prayDay   { 谁: dayKey } 今天谁祈过 —— 只留今天，跨天就清
 *   logs      建设日志 [{ at, emoji, text }]，保留 7 天
 *
 * 这个模块不碰 DOM；提示走 notify()。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { dayKey, formatCoins } from '../core/utils.js';
import { PLAYER_ID, state } from './state.js';
import { notify } from './notify.js';
import { addNews } from './news.js';
import * as player from './player.js';
import { add } from './inventory.js';
import { buildRewardPool } from '../data/adventure.js';
import { produceId, seedId } from '../data/keys.js';
import {
  CRYSTAL_TIERS,
  VILLAGE_LOG_CAP,
  VILLAGE_LOG_DAYS,
  VILLAGE_MAX_LEVEL,
  VILLAGE_NAME,
  VILLAGE_YIELD_PER_LEVEL,
  PRAY_CHANCE,
  crystalEmoji,
  crystalName,
  npcPrayValue,
  rollPrayReward,
  villageTier,
  villageYieldMul,
} from '../data/village.js';

const DAY = 24 * 3600_000;

/**
 * 取村庄状态，顺手补齐缺字段。
 *
 * 老存档完全没有这一块 —— 读档时补一次（state.js 的 normalizePlayerFarm），
 * 运行期再兜一次，任何路径拿到都是完整对象。
 * @returns {object}
 */
export function villageState() {
  const farm = state.farm;
  if (!farm.village || typeof farm.village !== 'object') farm.village = {};
  const v = farm.village;

  v.level = Math.min(VILLAGE_MAX_LEVEL, Math.max(1, Math.floor(v.level || 1)));
  v.coins = Math.max(0, Math.floor(v.coins || 0));
  v.crystals = Math.max(0, Math.floor(v.crystals || 0));
  v.pray = Math.max(0, Math.floor(v.pray || 0));

  if (!v.stock || typeof v.stock !== 'object') v.stock = {};
  for (const tier of CRYSTAL_TIERS) {
    v.stock[tier] = Math.max(0, Math.floor(v.stock[tier] || 0));
  }
  if (!v.prayDay || typeof v.prayDay !== 'object') v.prayDay = {};
  if (!Array.isArray(v.logs)) v.logs = [];
  return v;
}

/**
 * 给 UI 的一份只读快照。
 * @param {number} [now]
 */
export function villageSnapshot(now = Date.now()) {
  const v = villageState();
  const tier = villageTier(v.level);
  return {
    level: v.level,
    max: !tier,
    tier,
    coins: v.coins,
    crystals: v.crystals,
    pray: v.pray,
    /** 当前升级需要的那一档水晶还有几个没用出去 */
    crystalTier: tier?.crystal || 0,
    crystalStock: tier ? v.stock[tier.crystal] || 0 : 0,
    stock: { ...v.stock },
    prayedToday: v.prayDay[PLAYER_ID] === dayKey(now),
  };
}

/** 产量倍率（当前村庄等级）：玩家与邻居的收获都要乘它 */
export const villageYield = () => villageYieldMul(villageState().level);

/* ---------- 建设日志 ---------- */

/**
 * 记一条建设日志。
 *
 * 上限按「条数」压（`VILLAGE_LOG_CAP`）而不是按天删：祈福一天 33 条，
 * 7 天理论上有 230 条，不压会让存档里的日志盖过其它所有数据。
 * @param {number} at
 * @param {string} emoji
 * @param {string} text
 */
function note(at, emoji, text) {
  const v = villageState();
  v.logs.push({ at, emoji, text });
  if (v.logs.length > VILLAGE_LOG_CAP) v.logs = v.logs.slice(-VILLAGE_LOG_CAP);
}

/**
 * 近 7 天的建设日志（按时间倒序由 UI 排，这里只筛窗口）。
 * @param {number} [now]
 */
export function villageLogs(now = Date.now()) {
  const since = now - VILLAGE_LOG_DAYS * DAY;
  return villageState().logs.filter((entry) => entry.at >= since);
}

/* ---------- 水晶 ---------- */

/**
 * 冒险挖到一枚升级水晶（玩家与邻居共用）。
 *
 * 直接进村庄库存，不进背包：它是村庄建设的材料，不是能卖、能送、
 * 能进图鉴的道具 —— 塞进道具表会让商店、包裹、图鉴、联机校验全都要跟着改。
 *
 * @param {number} tier 1~4
 * @param {object} [who] 挖到的人（玩家不传）
 * @param {number} [at]
 */
export function addCrystal(tier, who = null, at = Date.now()) {
  const v = villageState();
  const level = Math.min(4, Math.max(1, Math.floor(tier) || 1));
  v.stock[level] = (v.stock[level] || 0) + 1;
  note(at, crystalEmoji(level), `${who?.name || state.farm.name} 挖到了 ${crystalName(level)} ×1`);
  emit(EVENTS.VILLAGE);
  return level;
}

/* ---------- 升级 ---------- */

/**
 * 三项都够了就升级，一次可能连升（正常不会，但别写死只升一级）。
 *
 * @param {number} at
 * @returns {number} 升了几级
 */
function checkUpgrade(at) {
  const v = villageState();
  let leveled = 0;

  for (let guard = 0; guard < VILLAGE_MAX_LEVEL; guard += 1) {
    const tier = villageTier(v.level);
    if (!tier) break;
    if (v.coins < tier.coins || v.crystals < tier.crystals || v.pray < tier.prayers) break;

    v.level += 1;
    v.coins = 0;
    v.crystals = 0;
    v.pray = 0;
    leveled += 1;

    note(at, '🏘️', `村庄升到了 Lv.${v.level}，全村产量加成 +${Math.round(v.level * VILLAGE_YIELD_PER_LEVEL * 100)}%`);
    addNews('🏘️', `${VILLAGE_NAME}升到了 Lv.${v.level}，全村作物产量 +${Math.round(v.level * VILLAGE_YIELD_PER_LEVEL * 100)}%`, { at });
    notify(`🏘️ 村庄升到 Lv.${v.level}！全村产量 +${Math.round(v.level * VILLAGE_YIELD_PER_LEVEL * 100)}%`, 'gold');
  }

  if (leveled) emit(EVENTS.VILLAGE);
  return leveled;
}

/* ---------- 投入资源 ---------- */

/**
 * 玩家投入金币与水晶。
 *
 * 只允许投**当前升级需要的那一档**水晶 —— 投别的档等于白扔，
 * 升级时它们会一起清零。旧档水晶留着也没用，但那是设计的一部分：
 * 水晶的档位跟着藏宝图的档位走，后期自然只掉高级的。
 *
 * @param {{coins?: number, crystals?: number}} input
 * @param {number} [at]
 * @returns {Promise<{ok: boolean, reason?: string, leveled?: number}>}
 */
export async function invest(input = {}, at = Date.now()) {
  const v = villageState();
  const tier = villageTier(v.level);
  if (!tier) return { ok: false, reason: '村庄已经满级了' };

  const coins = Math.max(0, Math.floor(Number(input.coins) || 0));
  const crystals = Math.max(0, Math.floor(Number(input.crystals) || 0));
  if (!coins && !crystals) return { ok: false, reason: '至少要投一点东西' };

  if (coins > state.farm.coins) return { ok: false, reason: '金币不够' };
  if (crystals > (v.stock[tier.crystal] || 0)) {
    return { ok: false, reason: `没有${crystalName(tier.crystal)}了` };
  }

  if (coins) {
    player.addCoins(-coins);
    v.coins += coins;
  }
  if (crystals) {
    v.stock[tier.crystal] -= crystals;
    v.crystals += crystals;
  }

  const parts = [];
  if (coins) parts.push(`💰 ${formatCoins(coins)} 金币`);
  if (crystals) parts.push(`${crystalEmoji(tier.crystal)} ${crystalName(tier.crystal)} ×${crystals}`);
  note(at, '🧱', `${state.farm.name} 投入了 ${parts.join(' 与 ')}`);

  const leveled = checkUpgrade(at);
  await commit({ farms: [state.farm] });
  emit(EVENTS.VILLAGE);
  emit(EVENTS.PLAYER);
  if (!leveled) notify(`🧱 已投入 ${parts.join('、')}`);
  return { ok: true, leveled };
}

/* ---------- 祈福 ---------- */

/**
 * 把一份祈福奖励发到玩家身上。
 * @param {object} reward
 */
function grantPrayReward(reward) {
  if (!reward) return;
  if (reward.kind === 'coin') player.addCoins(reward.n);
  else if (reward.kind === 'produce') add(produceId(reward.id), reward.n);
  else if (reward.kind === 'item') add(reward.id, reward.n);
  else add(seedId(reward.id), reward.n);
}

/** 奖励的展示文案 */
const rewardLabel = (reward) => (reward ? `${reward.emoji}${reward.name} ×${reward.n}` : '');

/**
 * 祈福的**同步内核**：玩家与邻居共用这一段。
 *
 * 每人每天一次（`prayDay[谁] === 今天` 就挡掉）——
 * **必须在世界时钟里按真实时刻判断**：离线补算时同一位邻居可能连着
 * 多天多次上线，每一天各祈一次是对的，同一天祈两次不行。
 *
 * 拆成同步内核是为了让 npc-sim 能直接调：模拟层是纯计算、跑在时钟循环里，
 * 不能掺 async（一趟上线十几个动作，每个都 await 会把补算拖垮）。
 *
 * @param {string} who 农场 id（玩家传 PLAYER_ID）
 * @param {number} at 发生时刻（补算时是过去，不是 now）
 * @param {?object} npc 邻居本人；玩家不传
 * @returns {{ok: boolean, reason?: string, reward?: ?object, leveled?: number}}
 */
export function prayCore(who, at, npc = null) {
  const v = villageState();
  const day = dayKey(at);
  if (v.prayDay[who] === day) return { ok: false, reason: '今天已经祈福过了' };

  // 只留今天：昨天的标记没有任何用处，留着会让 prayDay 长成一张 33 × N 的表
  for (const key of Object.keys(v.prayDay)) {
    if (v.prayDay[key] !== day) delete v.prayDay[key];
  }
  v.prayDay[who] = day;
  v.pray += 1;

  const won = Math.random() < PRAY_CHANCE ? rollPrayReward(v.level, buildRewardPool) : null;
  const isPlayer = who === PLAYER_ID;
  const name = npc?.name || state.farm.name;

  if (won) {
    if (isPlayer) {
      grantPrayReward(won);
      note(at, '✨', `${name} 祈福抽到了 ${rewardLabel(won)}`);
      notify(`🙏 祈福抽到了 ${rewardLabel(won)}！`, 'gold');
      addNews('🙏', `${name} 在村中心祈福，抽到了 ${rewardLabel(won)}`, { at });
    } else {
      npc.coins += npcPrayValue(won);
      note(at, '✨', `${name} 祈福抽到了 ${rewardLabel(won)}`);
    }
  } else if (isPlayer) {
    note(at, '🙏', `${name} 在村中心祈福`);
  }

  const leveled = checkUpgrade(at);
  emit(EVENTS.VILLAGE);
  return { ok: true, reward: won, leveled };
}

/**
 * 玩家祈福：内核跑完再落盘（奖励进了背包 / 金币）。
 * @param {number} [at]
 * @returns {Promise<{ok: boolean, reason?: string, reward?: ?object, leveled?: number}>}
 */
export async function pray(at = Date.now()) {
  const out = prayCore(PLAYER_ID, at);
  if (!out.ok) return out;

  await commit({ farms: [state.farm], bag: state.bag, news: state.news });
  emit(EVENTS.PLAYER);
  emit(EVENTS.INVENTORY);
  return out;
}

/**
 * 邻居祈福（NPC 上线时由 ACTIONS 的 pray 调用）。
 *
 * **不落盘**：村庄数据在玩家农场那一行上，而邻居的动作由世界时钟批量跑，
 * 补算期间每条都 commit 会把启动拖垮（第 46 轮的教训）。落盘交给调用方
 * —— 在线演出那一步的 commit 本来就带 `state.farm`，离线则由 persistFriends 统一写。
 *
 * @param {object} npc
 * @param {number} at
 */
export const prayNpc = (npc, at = Date.now()) => prayCore(npc.id, at, npc);
