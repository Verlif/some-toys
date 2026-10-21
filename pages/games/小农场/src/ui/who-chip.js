/**
 * 句中的人物标签 —— 农场日志与时报共用。
 *
 * 需求是「在这段话里就能看出谁是谁」：把正文中出现的农场名替换成
 * **名字 + 头像共用一个浅绿底**的小标签，头像贴在名字右边，
 * 读句子的时候不用回头去找「刚才那个圆片是谁」。
 *
 * ```
 * 偷 石头 家被守护犬抓住，罚了 500 金币
 *   ↓
 * 偷 [石头🧒] 家被守护犬抓住，罚了 500 金币
 * ```
 *
 * 为什么按「全文匹配名字」而不是只认 `who` 字段：
 * 文案里的主语常常是玩家（`state.farm.name`），而 `who` 只记了涉及者的 id；
 * 直接扫名字能让「农场主偷石头家」「石头来你的农场」这类句子自然成立，
 * 也不用要求每个 store 调用点都记得传 who。
 */
import { escapeHtml } from '../core/dom.js';
import { state } from '../store/state.js';

/** 文本里可能出现的所有人：玩家自己 + 全部邻居 */
function people() {
  const out = [];
  if (state.farm?.name) {
    out.push({ name: state.farm.name, avatar: state.farm.avatar || '🧑‍🌾' });
  }
  for (const friend of state.friends || []) {
    if (friend.name) out.push({ name: friend.name, avatar: friend.avatar || '🧑‍🌾' });
  }
  // 长名字优先：「小雨点」不能被「小雨」先吃掉半截
  return out.sort((a, b) => b.name.length - a.name.length);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 名字 → 头像，按名字串缓存（每次渲染日志不用重建正则） */
let cachedKey = '';
let cachedRe = null;
let cachedMap = null;

function matcher() {
  const list = people();
  const key = list.map((p) => `${p.name}\u0000${p.avatar}`).join('\u0001');
  if (key === cachedKey && cachedRe) return { re: cachedRe, map: cachedMap };

  const map = new Map();
  for (const p of list) map.set(escapeHtml(p.name), p.avatar);
  // 名字两侧的空格一起吃掉：文案里写 `${name} 家` 是为了分隔，
  // 名字变成标签之后这些空格只会让句子断开（只吃空格与制表符，不动换行）
  const re = new RegExp(`[ \\t]*(${[...map.keys()].map(escapeRe).join('|')})[ \\t]*`, 'g');
  cachedKey = key;
  cachedRe = re;
  cachedMap = map;
  return { re, map };
}

/**
 * 正文 → HTML，其中的人名变成「名字 + 头像」标签。
 * @param {string} text 原始文案（未转义）
 * @returns {string} 可安全插入的 HTML
 */
export function inlineWhoHTML(text) {
  const safe = escapeHtml(String(text ?? ''));
  const { re, map } = matcher();
  if (!map.size) return safe;

  return safe.replace(re, (_all, name) => {
    const avatar = map.get(name);
    return `<span class="who-tag">${name}<i class="ava">${avatar}</i></span>`;
  });
}
