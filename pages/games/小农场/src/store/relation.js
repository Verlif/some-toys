/**
 * 好感度的读写入口。
 *
 * 数据放 `state.relations`（`{ "a|b": v }`，a、b 按字典序归一，一对只有一条），
 * 落盘进 `relation` 表（`[a, b]` 复合主键）。规则与阈值在 data/relation.js，
 * 这里只做「取 / 存 / 加减」，不掺任何业务判断。
 *
 * 注意：改了好感度的那次 commit 必须带上 `relations: state.relations`
 * （整表覆盖，和 news / bag 一个路子），否则关掉页面就白加了。
 */
import { state } from './state.js';
import { clampRelation, relKey, relText, relTier } from '../data/relation.js';

/**
 * 两个人之间的好感度。
 * @param {string} a 农场 id
 * @param {string} b 农场 id
 * @returns {number} -200 ~ 200，没有记录时是 0
 */
export function getRelation(a, b) {
  if (!a || !b || a === b) return 0;
  return state.relations[relKey(a, b)] || 0;
}

/**
 * 直接设一个值（会夹到 [-200, 200]）。
 * @returns {number} 落定后的值
 */
export function setRelation(a, b, value) {
  if (!a || !b || a === b) return 0;
  const key = relKey(a, b);
  const next = clampRelation(value);
  if (next === 0) delete state.relations[key];
  else state.relations[key] = next;
  return next;
}

/**
 * 加减好感度。
 * @param {string} a
 * @param {string} b
 * @param {number} delta
 * @returns {number} 落定后的值
 */
export function adjustRelation(a, b, delta) {
  return setRelation(a, b, getRelation(a, b) + delta);
}

/**
 * 界面用的一段文字：`挚交 +156`
 * @param {number} value
 * @returns {{key: string, label: string, text: string, full: string}}
 */
export function relationBadge(value) {
  const tier = relTier(value);
  const text = relText(value);
  return { ...tier, text, full: `${tier.label} ${text}` };
}
