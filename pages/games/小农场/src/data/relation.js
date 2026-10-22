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
 *   - **偷菜掉好感**：`max(1, round(作物等级 / 3))`；
 *   - **打理加好感**：每照料一块地 +1；
 *   - **送礼加好感**：按送出的那份产出的等级，`round(等级 / 2)`，至少 1；
 *   - 好感低的人更爱来偷、好感高的人更愿意来帮忙与送礼（见下面的权重函数）。
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
 * 偷菜掉的好感 = 作物等级 / 这个数（至少 1）。
 *
 * 早先按**售价**折算（售价 / 10），高阶作物一份就上千，偷一次掉几十上百，
 * 一晚上就能把交情偷成结怨 —— 惩罚跟「偷一把菜」完全不匹配。
 * 改成按等级以后，Lv10 掉 3、Lv60 掉 20，量级终于和「一件事」对得上。
 */
const STEAL_LV_DIVISOR = 3;

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

/** 偷走一份等级 lv 的产出，掉多少好感（最少 1） */
export const stealRelLoss = (lv) => Math.max(1, Math.round(lv / STEAL_LV_DIVISOR));

/** 送出一份等级 lv 的产出，加多少好感 */
export const giftRelGain = (lv) => Math.max(1, Math.round(lv * GIFT_REL_RATIO));

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
 * 60 分以下免谈，越高越容易 —— 但整体仍然是一件稀罕事。
 * @param {number} rel
 */
export const giftChanceFor = (rel) => (
  rel < 60 ? 0 : clamp(0.04 + (rel - 60) / 140 * 0.26, 0, 0.3)
);
