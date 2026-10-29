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
 *   stock     { 1..4: n } **玩家**手上还没投入的水晶，冒险挖到就进这里
 *            （邻居挖到的记在他们各自的 `npc.crystals` 上，第 53 轮分开）
 *   prayDay   { 谁: dayKey } 今天谁祈过 —— 只留今天，跨天就清
 *   logs      建设日志 [{ at, emoji, text }]，保留 7 天
 *
 * 这个模块不碰 DOM；提示走 notify()。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { dayKey, formatCoins } from '../core/utils.js';
import { PLAYER_ID, admitVillageNeighbours, state } from './state.js';
import { notify } from './notify.js';
import { addNews } from './news.js';
import * as player from './player.js';
import { add } from './inventory.js';
import { buildRewardPool } from '../data/adventure.js';
import { CROPS, HONOR_CROP_IDS } from '../data/crops.js';
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
  crystalSellPrice,
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
  if (!v.giveDay || typeof v.giveDay !== 'object') v.giveDay = {};
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
 * 冒险挖到一枚升级水晶。
 *
 * **谁挖到的就归谁**（第 53 轮）：玩家挖到的进村庄库存 `v.stock`（那是玩家
 * 自己的投入仓），邻居挖到的进他自己的 `npc.crystals`。
 *
 * 早先不分是谁，统统塞进 `v.stock`，于是村民能用「村里那一堆」去投共建 ——
 * 玩家看到的是「我仓库里一枚水晶都没有，怎么就被投出去了」。归谁所有之后，
 * 村民必须自己挖到才能投，玩家投的也必然是自己捡的那些。
 *
 * 仍然不进背包 / 道具表：它是村庄建设的材料，不是能送、能进图鉴的道具。
 * 第 55 轮起它**可以卖**（仓库 → 其他），但卖出入口直接读 `v.stock`，
 * 没有搬进 `state.bag` —— 搬一次要动存档结构、联机校验、图鉴、包裹，
 * 换来的只是「少一处读取」，不值。
 *
 * ⚠️ **这里不写建设日志**（第 55 轮用户要求）：挖到只是「捡到了」，
 * 还不算为村子做了什么；只有真正投进去才算建设。日志只由 `invest` /
 * `contributeCore` 写。
 *
 * @param {number} tier 1~4
 * @param {object} [who] 挖到的人（玩家不传）
 */
export function addCrystal(tier, who = null) {
  const v = villageState();
  const level = Math.min(4, Math.max(1, Math.floor(tier) || 1));
  if (who && who.id !== PLAYER_ID) {
    if (!who.crystals || typeof who.crystals !== 'object') who.crystals = {};
    who.crystals[level] = Math.max(0, Math.floor(who.crystals[level] || 0)) + 1;
  } else {
    v.stock[level] = (v.stock[level] || 0) + 1;
  }
  emit(EVENTS.VILLAGE);
  return level;
}

/**
 * 卖掉手上的升级水晶（第 55 轮）。
 *
 * 卖的是 `v.stock` —— 玩家自己挖到的那一份。村民的水晶不在这里，
 * 他们的卖出决策在 `contributeCore` 里按性格掷。
 *
 * 与 `invest` 的分工：投入推进村庄进度，卖出只换金币，**不动进度**。
 *
 * @param {number} tier 1~4
 * @param {number} [n] 数量，默认全卖
 * @returns {Promise<{ok: boolean, reason?: string, coins?: number, count?: number}>}
 */
export async function sellCrystal(tier, n) {
  const v = villageState();
  const level = Math.min(4, Math.max(1, Math.floor(tier) || 1));
  const have = Math.max(0, Math.floor(v.stock[level] || 0));
  const price = crystalSellPrice(level);
  if (!price) return { ok: false, reason: '这个档位的水晶卖不出去' };
  if (have <= 0) return { ok: false, reason: `没有${crystalName(level)}了` };

  const qty = Math.max(0, Math.min(have, Math.floor(Number(n) || have)));
  if (qty <= 0) return { ok: false, reason: '至少要卖一枚' };

  const income = qty * price;
  v.stock[level] = have - qty;
  player.addCoins(income);
  player.addLog('💰', `卖出 ${crystalEmoji(level)}${crystalName(level)} ×${qty}，+${income} 💰`);
  // 水晶挂在 `farm.village` 上，不碰背包 —— 只写 farms 这一张表
  await commit({ farms: [state.farm] });
  // ⚠️ 这里必须发 INVENTORY：仓库页（「💠 其他」那一档）靠它重绘。
  // 只发 VILLAGE 的话，列表会停在卖之前的样子 —— 水晶已经没了，
  // 行还在原地，玩家会以为没卖出去。
  emit(EVENTS.INVENTORY);
  emit(EVENTS.VILLAGE);
  emit(EVENTS.PLAYER);
  notify(`卖出 ${crystalEmoji(level)}${crystalName(level)} ×${qty}，+${income} 💰`);
  return { ok: true, coins: income, count: qty };
}

/* ---------- 升级 ---------- */

/**
 * 村庄升到某一级时，全村发一颗「荣耀种子」（第 52 轮）。
 *
 * 需求：村庄升级时给**所有人**都发唯一的【西米村荣耀】限定种子。
 * 玩家进背包（能种、能看图鉴），邻居进自己的仓库 —— 他们不种限定作物
 * （`cropsNearLevel` 会把 special 全滤掉），这颗种子对他们是「村里发的纪念品」，
 * 但既然是「发给所有人」，就不能只发玩家一个人。
 *
 * @param {number} level 升到的村庄等级（2~5）
 * @param {number} at
 * @returns {?{name: string, emoji: string, cropId: string}} 发了哪种，没有则 null
 */
function grantHonorSeeds(level, at) {
  const cropId = HONOR_CROP_IDS.find((id) => CROPS[id].honor === level);
  if (!cropId) return null;
  const crop = CROPS[cropId];

  add(seedId(cropId), 1);
  for (const npc of state.friends) {
    if (!npc?.bag) continue;
    const key = seedId(cropId);
    npc.bag[key] = (npc.bag[key] || 0) + 1;
  }

  player.addLog('🏅', `村子升到 Lv.${level}，全村都领到了「${crop.name}」种子`, at);
  note(at, crop.emoji, `全村发放「${crop.name}」种子 —— 5 茬、长得慢、一次收一大包`);
  addNews(crop.emoji, `村子升到 Lv.${level}，全村都领到了「${crop.name}」种子`, { at });
  notify(`🏅 村子升到 Lv.${level}！全村都领到了 ${crop.emoji}${crop.name} 种子`, 'gold');
  return { name: crop.name, emoji: crop.emoji, cropId };
}
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

    // 每升一级发一颗荣耀种子（连升几级就发几颗，各不重复）
    grantHonorSeeds(v.level, at);

    // 每升一级搬进来 5 户新人家（第 53 轮，名单见 data/friends.js 的 arrive）
    const arrived = admitVillageNeighbours(v.level, at);
    if (arrived.length) {
      const names = arrived.map((npc) => `${npc.avatar}${npc.name}`).join('、');
      note(at, '🏡', `${names} 搬进了 ${VILLAGE_NAME}`);
      addNews('🏡', `${VILLAGE_NAME}热闹起来了：${names} 搬进了村子`, { at });
      notify(`🏡 ${arrived.length} 户新人家搬进了村子`, 'gold');
      emit(EVENTS.FRIENDS);
    }
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

  // 只收「还差的那点」：多投的部分会在升级时被一起清零，等于白扔。
  // 第 49 轮村民也会投入之后，这一道夹取变得必要 —— 进度条可能已经被
  // 邻居推到 100%，玩家再往里塞 500 金币就是纯亏。
  const needCoins = Math.max(0, tier.coins - v.coins);
  const needCrystals = Math.max(0, tier.crystals - v.crystals);
  const coins = Math.min(needCoins, Math.max(0, Math.floor(Number(input.coins) || 0)));
  const crystals = Math.min(needCrystals, Math.max(0, Math.floor(Number(input.crystals) || 0)));
  if (!coins && !crystals) {
    return { ok: false, reason: needCoins || needCrystals ? '至少要投一点东西' : '这一档已经够了' };
  }

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
  note(at, '🚧', `${state.farm.name} 投入了 ${parts.join(' 与 ')}`);

  const leveled = checkUpgrade(at);
  // 连邻居一起落盘：升级可能刚请进来 5 户新人家（第 53 轮），
  // 只写 state.farm 的话他们只活在内存里，刷新就没了。
  await commit({ farms: [state.farm, ...state.friends], relations: state.relations });
  emit(EVENTS.VILLAGE);
  emit(EVENTS.PLAYER);
  if (!leveled) notify(`🚧 已投入 ${parts.join('、')}`);
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

  // 只留今天：昨天的标记没有任何用处，留着会让 prayDay 长成一张「人数 × N」的表。
  //
  // ⚠️ 这里必须同时保住「真实今天」那一格（第 53 轮修的 bug）：
  // 邻居祈福是离线补算跑出来的，`at` 可能是昨天甚至前天的时刻，
  // 早先按 `day` 清理，于是村民在补算里祈一次福，就把玩家「今天已祈过」
  // 的标记一起抹掉 —— 表现就是「我明明祈过了，过一会儿又能再祈一次」。
  const today = dayKey(Date.now());
  for (const key of Object.keys(v.prayDay)) {
    if (v.prayDay[key] !== day && v.prayDay[key] !== today) delete v.prayDay[key];
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
  } else {
    // 没抽到也要记一笔（第 53 轮）：早先只给玩家写，村民那 95% 的
    // 「祈了个风调雨顺」全被吞掉，日志里只剩抽奖的少数几条，
    // 玩家自然觉得「怎么没见村民祈福，祈福数却已经几十了」。
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

  // 同 invest：升级可能刚请进来新人家，一起落盘
  await commit({ farms: [state.farm, ...state.friends], bag: state.bag, news: state.news, relations: state.relations });
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

/* ---------- 邻居投入 ---------- */

/** 村民手头留的周转金：留够买种子、喂狗、买藏宝图的，不全捐出去 */
export const NPC_KEEP_COINS = 1200;

/** 闲钱里拿出多少投进村建设（基准值，实际按性格浮动，见 CONTRIB_STYLE） */
export const NPC_GIVE_RATIO = 0.35;

/** 一趟上线最多投多少金币：不封顶的话高等级村民一上来就把整档填满 */
export const NPC_GIVE_CAP = 800;

/**
 * 性格 → 出钱出力时的态度（第 51 轮）。
 *
 * 早先所有人一个模子：闲钱的 35%、封顶 800。玩家看下来觉得
 * 「这 32 个人像同一个人」，尤其热心肠的老好人跟爱占便宜的赵六
 * 掏一样多，人物设定就白写了。
 *
 * 三档口径：
 *   - `eager` 积极参与：ratio 更高、封顶更高，水晶也更舍得拿
 *   - `normal` 按本分来：原值不动
 *   - `half` 意思意思：意思一下就走，钱和水晶都少得多
 *
 * 数值上刻意让 `eager` 大约是 `half` 的四五倍 —— 差距要看得出来，
 * 但不能让「意思意思」的那几位干脆不掏（那又变成「只有几个人在建村」）。
 *
 * 第 55 轮加了 `crystalInvest`：手上**有当前档位**的水晶时，选择「投进村」
 * 而不是「卖掉换钱」的概率。水晶能卖了之后必须给一个倾向值，否则村民
 * 会一拿到就卖光，村庄进度反而更慢 —— 所以**最低也给到 0.3**，
 * 爱占便宜的赵六也是三次里投一次。
 */
const CONTRIB_STYLE = {
  // 热心 / 勤勉 / 场面人：村里的事当自己的事
  friendly: { tier: 'eager', ratio: 0.55, cap: 1400, crystal: 0.7, crystalInvest: 0.85 },
  diligent: { tier: 'eager', ratio: 0.5, cap: 1200, crystal: 0.65, crystalInvest: 0.8 },
  boss: { tier: 'eager', ratio: 0.5, cap: 1200, crystal: 0.6, crystalInvest: 0.7 },
  // 爱钻研 / 精打细算：算得清楚，出得起也愿意出
  scholar: { tier: 'normal', ratio: 0.4, cap: 900, crystal: 0.5, crystalInvest: 0.65 },
  thrifty: { tier: 'normal', ratio: 0.35, cap: 800, crystal: 0.5, crystalInvest: 0.55 },
  // 悠闲 / 生意人 / 爱占便宜：意思意思
  leisurely: { tier: 'half', ratio: 0.18, cap: 300, crystal: 0.25, crystalInvest: 0.45 },
  merchant: { tier: 'half', ratio: 0.15, cap: 260, crystal: 0.2, crystalInvest: 0.35 },
  greedy: { tier: 'half', ratio: 0.1, cap: 180, crystal: 0.15, crystalInvest: 0.3 },
};

/** 默认档位（名单里出现新性格时用） */
const CONTRIB_DEFAULT = {
  tier: 'normal', ratio: NPC_GIVE_RATIO, cap: NPC_GIVE_CAP, crystal: 0.5, crystalInvest: 0.6,
};

/** 这个邻居出钱出力的风格 */
export function contribStyle(npc) {
  return CONTRIB_STYLE[npc?.personality] || CONTRIB_DEFAULT;
}

/**
 * 邻居往村建设里投一笔（第 49 轮）。
 *
 * 为什么要有：早先只有玩家能投，村庄就从「全村共建」变成了
 * 「一个人凑 63 万金币 + 75 枚水晶」—— 玩家会觉得这村子只有自己在乎，
 * 而 `docs` 里写的「每个村民都在出力」也落了空。
 *
 * 两条自我克制（不然 32 位村民会把每一档瞬间填满，玩家毫无参与感）：
 *   - **留周转金**：`npc.coins - NPC_KEEP_COINS` 的若干成，单次封顶；
 *     具体几成、封顶多少由性格决定（见 CONTRIB_STYLE，第 51 轮）；
 *   - **水晶只投库存的一部分**：玩家自己挖到的那几枚还留得下来，
 *     不会出现「刚捡到两枚，一回头被村民花光了」的憋屈。
 *
 * 需求为 0（这一项已经达标）时什么都不做 —— 所以每次升级后村民会
 * 安静一阵，等下一档的门槛露出来才会再动，日志不会被同一个动作刷满。
 *
 * 不落盘：理由同 `prayNpc`（补算期间每条 commit 会把启动拖垮），
 * 落盘交给调用方的 persistFriends / 在线演出那一步。
 *
 * @param {object} npc
 * @param {number} [at]
 * @returns {?{coins: number, crystals: number, soldCount: number, soldCoins: number}}
 *   投了多少、另外卖了多少枚水晶换了多少金币；什么都没做返回 null
 */
export function contributeCore(npc, at = Date.now()) {
  const v = villageState();
  const tier = villageTier(v.level);
  if (!tier || !npc) return null;

  // 一人一天只投一次：跟祈福同一个节奏。不限次数的话，离线补算的 16 小时里
  // 几十位村民会各自投五六趟，第一档 20,000 金币在玩家进游戏之前就填满了，
  // 这张卡片的「金币」一行永远一开始就是满的，共建感全无。
  const day = dayKey(at);
  if (v.giveDay[npc.id] === day) return null;

  const needCoins = Math.max(0, tier.coins - v.coins);
  const needCrystals = Math.max(0, tier.crystals - v.crystals);

  // 性格决定掏多少（第 51 轮）：热心的多出，爱占便宜的意思一下
  const style = contribStyle(npc);

  let coins = 0;
  if (needCoins > 0) {
    const spare = Math.max(0, npc.coins - NPC_KEEP_COINS);
    coins = Math.min(needCoins, style.cap, Math.floor(spare * style.ratio));
  }
  // ① 用不上的旧档水晶（第 55 轮）：村庄这一档只认 `tier.crystal`，
  //    别的档位留着永远不会被用上，升级时还会一起清零 —— 能卖就卖掉换钱。
  //    实测「1 级水晶囤了 99 枚、村庄却在要 3 级」正是从这里堵死的。
  let soldCount = 0;
  let soldCoins = 0;
  for (const key of Object.keys(npc.crystals || {})) {
    const t = Number(key);
    if (t === tier.crystal) continue;
    const n = Math.max(0, Math.floor(npc.crystals[key] || 0));
    const price = crystalSellPrice(t);
    if (n <= 0 || price <= 0) continue;
    soldCount += n;
    soldCoins += n * price;
    delete npc.crystals[key];
  }
  if (soldCoins) npc.coins += soldCoins;

  // ② 当前档位：按性格掷一次「投进村」还是「卖掉换钱」。
  //    `crystalInvest` 最低也是 0.3 —— 水晶能卖之后不能让村民一拿到就卖光，
  //    否则村庄进度反而比改动前更慢。
  let crystals = 0;
  if (needCrystals > 0) {
    // 只掏自己挖到的那些（第 53 轮）。早先从 v.stock 里拿，等于村民
    // 用玩家捡的水晶做人情 —— 玩家那边「仓库里一枚都没有却被投出去」的 bug。
    const mine = Math.max(0, Math.floor(npc.crystals?.[tier.crystal] || 0));
    // 仍然至少留 1 枚给自己：`mine >= 2` 才动手
    if (mine >= 2) {
      if (Math.random() < style.crystalInvest) {
        // 投：性格越热心掏得越多，但**至少 1 枚** ——
        // `floor(2 × 0.15)` 是 0，等于「愿意投却投不出去」，白掷一次
        crystals = Math.min(needCrystals, Math.max(1, Math.floor(mine * style.crystal)));
      } else {
        // 卖：留 1 枚在手上，下一天还有机会投
        const n = mine - 1;
        soldCount += n;
        soldCoins += n * crystalSellPrice(tier.crystal);
        npc.crystals[tier.crystal] = 1;
      }
    }
  }
  if (!coins && !crystals && !soldCount) return null;

  if (coins) {
    npc.coins -= coins;
    v.coins += coins;
  }
  if (crystals) {
    npc.crystals[tier.crystal] = Math.max(0, Math.floor(npc.crystals[tier.crystal] || 0)) - crystals;
    if (npc.crystals[tier.crystal] <= 0) delete npc.crystals[tier.crystal];
    v.crystals += crystals;
  }

  // 只有「投进村」才写建设日志（第 55 轮）：挖到只是捡到，卖出只是买卖，
  // 都不算为村子做了什么。日志里每一条都必须是实打实的进度。
  if (coins || crystals) {
    const parts = [];
    if (coins) parts.push(`💰 ${formatCoins(coins)} 金币`);
    if (crystals) parts.push(`${crystalEmoji(tier.crystal)} ${crystalName(tier.crystal)} ×${crystals}`);
    // 只记投入了什么（第 53 轮）：早先还带「（很上心）」「（意思意思）」，
    // 玩家读日志时以为那是 bug 提示，其实只是想说明性格差异 —— 但差异
    // 本来就体现在数量上，写出来反而喧宾夺主。
    note(at, '🚧', `${npc.name} 投入了 ${parts.join(' 与 ')}`);
  }

  // 记账并只留今天（理由同 prayDay：留着历史会长成「人数 × N」的表）
  //
  // ⚠️ 与 prayDay 同一个坑：邻居投入也是离线补算跑出来的，`at` 可能是昨天。
  // 早先按 `day` 清理，村民在补算里投一次就把别人「今天已投过」的标记抹掉，
  // 于是同一户一天能投好几次。这里同样要保住「真实今天」那一格。
  const today = dayKey(Date.now());
  for (const key of Object.keys(v.giveDay)) {
    if (v.giveDay[key] !== day && v.giveDay[key] !== today) delete v.giveDay[key];
  }
  v.giveDay[npc.id] = day;

  checkUpgrade(at);
  emit(EVENTS.VILLAGE);
  return { coins, crystals, soldCount, soldCoins };
}
