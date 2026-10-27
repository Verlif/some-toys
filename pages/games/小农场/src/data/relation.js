/**
 * 好感度（友好度）—— 镇上人与人之间的关系值。
 *
 * 每一对农场（玩家 ↔ 邻居、邻居 ↔ 邻居）之间只有一个值，范围 [-200, 200]：
 *
 * ```
 *  -200 ──── 结怨 ──── 疏远 ──── 平常 ──── 友好 ──── 亲近 ──── 挚交 ──── +200
 * ```
 *
 * 几条规则（全部是纯函数，谁都能读）：
 *   - **起点由性格决定**：`round((A 的性格值 + B 的性格值) / 2)`，玩家没有性格，按 0 算；
 *   - **偷菜不掉好感**：顺走一把菜只是「被偷的人心里有数」，不撕破脸；
 *   - **被守护犬抓住才掉好感**：按想偷的那个果实售价折算，`max(1, round(售价 / 10))`；
 *   - **打理加好感**：每照料一块地 +1；
 *   - **送礼加好感**：按送出的那份产出的等级，`round(等级 / 2)`，至少 1；
 *   - 好感低的人更爱来偷、好感高的人更愿意来帮忙与送礼（见下面的权重函数）；
 *   - **亲近档（≥100）是道坎**：NPC 上线会优先登门打理这些农场，
 *     打理完还按性格系数加权概率顺手送一份礼（见 REL_CARE_PRIORITY / closeGiftChanceFor）。
 *
 * 值本身存在 state.relations（`{ "a|b": v }`，a、b 按字典序排好，一对只有一条），
 * 落盘在 relation 表，见 core/storage.js。
 */
import { clamp } from '../core/utils.js';

export const REL_MIN = -200;
export const REL_MAX = 200;

/** 打理一次（浇水 / 杀虫）加多少好感 */
export const REL_PER_CARE = 1;

/**
 * 偷菜被守护犬抓住，掉的好感 = 想偷的那个果实售价 / 这个数（至少 1）。
 *
 * 只有**被抓住**才掉：顺利顺走不掉（见 stealWeightFor 的说明），
 * 但当场被狗逮住是另一回事 —— 钱也罚了、脸也丢了，关系自然破了个角。
 * 按售价折算是用户明确要的口径：高阶作物一份就上千，被抓一次掉上百，
 * 量级正好和「人赃并获」对得上。
 */
const CAUGHT_SELL_DIVISOR = 10;

/**
 * 被守护犬抓住之后，**其他**邻居各掉多少好感。
 *
 * 村里没有秘密：你半夜翻墙被人家狗逮住，第二天半个村子都在说。
 * 固定 1 点、**不乘在线双倍** —— 双倍是主人家的事（他家的菜被惦记了），
 * 旁人只是「听说了」，不该跟着翻倍；被偷那家已按售价折算，不重复扣。
 */
export const CAUGHT_RIPPLE_REL_LOSS = 1;

/** 送礼加的好感 = 产出等级 × 这个系数（至少 1） */
const GIFT_REL_RATIO = 0.5;

/** 一对关系的键：无序，a、b 按字典序归一 */
export const relKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** 把任意值夹进合法区间 */
export const clampRelation = (v) => clamp(Math.round(Number(v) || 0), REL_MIN, REL_MAX);

/**
 * 两个人的基础好感度：各人性格值的平均。
 * 玩家没有性格档案，按 0 算 —— 所以玩家与「热心」是 +38，与「爱占便宜」是 -22。
 * @param {number} friendlyA 性格里的 friendly 值
 * @param {number} [friendlyB]
 */
export const baseRelation = (friendlyA = 0, friendlyB = 0) =>
  clampRelation((friendlyA + friendlyB) / 2);

/** 偷菜被守护犬抓住，掉多少好感（按想偷的果实售价折算，最少 1） */
export const dogCaughtRelLoss = (sell) => Math.max(1, Math.round(sell / CAUGHT_SELL_DIVISOR));

/** 送出一份等级 lv 的产出，加多少好感 */
export const giftRelGain = (lv) => Math.max(1, Math.round(lv * GIFT_REL_RATIO));

/**
 * 跟邻居买一批产出，要花多少好感。
 *
 * 口径是用户定的：**产出等级 × 份数 / 2**，至少 1。
 * 与送礼（加好感）正好反向 —— 送礼是人情，交易是麻烦人家，
 * 高阶作物更金贵，一次买得多也就更耗交情。
 *
 * @param {number} lv 产出等级
 * @param {number} [qty] 份数
 */
export const tradeRelCost = (lv, qty = 1) =>
  Math.max(1, Math.round((Number(lv) || 1) * Math.max(1, Math.floor(qty) || 1) * 0.5));

/**
 * 好感分档：界面上的标签文字与配色。
 * @param {number} v
 * @returns {{key: string, label: string}}
 */
export function relTier(v) {
  if (v >= 150) return { key: 'best', label: '挚交' };
  if (v >= 80) return { key: 'close', label: '亲近' };
  if (v >= 30) return { key: 'good', label: '友好' };
  if (v > -30) return { key: 'plain', label: '平常' };
  if (v > -80) return { key: 'cold', label: '疏远' };
  return { key: 'bad', label: '结怨' };
}

/** 带正负号的值，例：+156 / -12 / 0 */
export const relText = (v) => (v > 0 ? `+${v}` : String(v));

/**
 * 把 relation 表里的行读成 `{ "a|b": v }`。
 *
 * 只认当前还存在的一对（换过邻居名单之后，孤儿关系直接丢掉）；
 * 0 不落键 —— 「没有记录」和「正好 0」是同一件事。
 *
 * @param {Array<{a: string, b: string, v: number}>} rows
 * @param {Set<string>} ids 当前所有农场 id
 * @returns {Record<string, number>}
 */
export function readRelations(rows, ids) {
  const out = {};
  for (const row of rows || []) {
    if (!ids.has(row.a) || !ids.has(row.b) || row.a === row.b) continue;
    const v = clampRelation(row.v);
    if (v) out[relKey(row.a, row.b)] = v;
  }
  return out;
}

/* ---------- 好感度如何影响邻居的行为 ---------- */

/**
 * 偷菜时给某个农场的权重：好感越低越容易被盯上。
 *
 * 200 → 0.2（几乎不动手）/ −200 → 2.2（逮着就偷），
 * 也就是「仇家」被偷的概率是「挚交」的十倍左右。
 * @param {number} rel
 */
export const stealWeightFor = (rel) => clamp(1.2 - rel / 200, 0.2, 2.2);

/**
 * 帮忙打理 / 送礼时给某个农场的权重：好感越高越愿意帮。
 * 200 → 2.0 / −200 → 0.2。
 * @param {number} rel
 */
export const helpWeightFor = (rel) => clamp(1 + rel / 200, 0.2, 2);

/**
 * 送礼的门槛：好感不够的人不会收到礼物。
 * 60 分以下免谈，越高越容易。
 * @param {number} rel
 */
export const giftChanceFor = (rel) => (
  rel < 60 ? 0 : clamp(0.08 + (rel - 60) / 140 * 0.42, 0, 0.5)
);

/**
 * 「登门打理」的优先门槛：好感 ≥100（亲近档）的农场，
 * NPC 上线时会优先去照顾它；一个 ≥100 的都没有才按老逻辑全量挑。
 */
export const REL_CARE_PRIORITY = 100;

/**
 * 亲近档的送礼概率：100 → 0.25，200 → 0.55，线性递增。
 *
 * 与 giftChanceFor（60 分起、封顶 0.5）是两档不同的交情：
 * 老门槛管「偶尔念着你」，这个管「登门造访之后顺手带一份」。
 * @param {number} rel
 */
export const closeGiftChanceFor = (rel) => (
  rel < REL_CARE_PRIORITY ? 0 : clamp(0.25 + (rel - REL_CARE_PRIORITY) / 100 * 0.3, 0, 0.55)
);

/** 性格对亲近档送礼概率的修正：热心的最爱送，爱占便宜的最不爱 */
const GIFT_PERSONALITY_FACTOR = {
  friendly: 1.4,
  diligent: 1.2,
  scholar: 1.2,
  boss: 1.1,
  leisurely: 0.9,
  thrifty: 1.0,
  merchant: 0.7,
  greedy: 0.5,
};

/**
 * 送礼性格系数（只作用于亲近档的新概率，老门槛不受影响）。
 * @param {string} personality data/friends.js 里 PERSONALITIES 的键
 * @returns {number}
 */
export const giftPersonalityFactor = (personality) => GIFT_PERSONALITY_FACTOR[personality] ?? 1;

/* ---------- 催上线 ---------- */

/**
 * 「催促上线」要花多少好感。
 *
 * 交情是有限资源：催一次就像上门敲一次门，敲多了人家烦。
 * 10 点按当前口径大约等于「送 4~5 份高阶产出」或「帮浇 10 块地」，
 * 一次催促就该有分量，但也不至于高到没人用。
 */
export const SUMMON_REL_COST = 10;

/**
 * 催促之后，他多久才会出现（毫秒区间）。
 *
 * 交情决定响应速度，两端是用户定死的：
 *   - 好感 **−200（结怨）**：5~10 分钟才肯露面，还得磨蹭一会儿；
 *   - 好感 **+200（挚交）**：1~30 秒，几乎一喊就到。
 *
 * 中间不按线性插值，按**指数**插 —— 交情是「越往上越难得」的，
 * 每多 100 点好感带来的提速应该越来越明显（0 分时约 17 秒~2 分钟，
 * 而不是线性的 2.5 分钟~5 分钟：那等于谁都在磨洋工）。
 *
 * ```
 * t  = (rel + 200) / 400         ∈ [0, 1]，200 → 1
 * 下限 = 1000 × 300^(1-t)         t=1 → 1s     t=0 → 300s
 * 上限 = 30000 × 20^(1-t)         t=1 → 30s    t=0 → 600s
 * ```
 *
 * @param {number} rel −200 ~ 200
 * @returns {{min: number, max: number}} 毫秒，已按秒取整
 */
export function summonDelayRange(rel) {
  const t = clamp(((Number(rel) || 0) - REL_MIN) / (REL_MAX - REL_MIN), 0, 1);
  const sec = (ms) => Math.max(1, Math.round(ms / 1000)) * 1000;
  return {
    min: sec(1000 * 300 ** (1 - t)),
    max: sec(30000 * 20 ** (1 - t)),
  };
}
