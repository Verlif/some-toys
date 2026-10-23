/**
 * 三件「省手」工具的取用规则。
 *
 * 每件工具都有两个版本：
 *   - 消耗版（洒水器 / 杀虫剂 / 采收机）：用一次扣一个；
 *   - 永久版（… · 永久）：买断一次，之后永不消耗。
 *
 * 判定顺序永远是**先看永久版，再看消耗版** —— 手上有永久版的时候，
 * 背包里的消耗品一个都不该动，否则玩家会莫名其妙地少东西。
 *
 * 自家农场（store/farm.js）与邻居家的一键照料（store/social.js）
 * 共用这一套，所以「买过永久洒水器，帮邻居浇水也不扣道具」是自动成立的。
 */
import * as inventory from './inventory.js';
import { TOOL_KINDS } from '../data/items.js';

/** 某个动作对应的两个道具 id；不认识的动作返回 null */
const toolIds = (kind) => TOOL_KINDS[kind] || null;

/** 买断过永久版没有（toolUses 内部用，界面只看 toolUses 的 Infinity） */
function isPermanent(kind) {
  const tool = toolIds(kind);
  return Boolean(tool) && inventory.has(tool.permanent);
}

/**
 * 还剩几次可用：永久版是 `Infinity`，否则是背包里的数量。
 * 界面上的存量规则：只标消耗版余量，永久版不显示数字（见 ui/views/farm.js）。
 */
export function toolUses(kind) {
  if (isPermanent(kind)) return Infinity;
  const tool = toolIds(kind);
  return tool ? inventory.count(tool.consumable) : 0;
}

/** 现在能不能用：有永久版，或者消耗版还有货 */
export function hasTool(kind) {
  const tool = toolIds(kind);
  if (!tool) return false;
  return inventory.has(tool.permanent) || inventory.has(tool.consumable);
}

/**
 * 用掉一次。永久版什么都不扣。
 * @returns {boolean} 是否真的用掉了（没货时 false，且不改动背包）
 */
export function useTool(kind) {
  const tool = toolIds(kind);
  if (!tool) return false;
  if (inventory.has(tool.permanent)) return true;
  return inventory.take(tool.consumable, 1);
}
