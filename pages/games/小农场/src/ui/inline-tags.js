/**
 * 记录正文里的行内标签 —— 人名与作物名共用一套。
 *
 * 需求是「在这段话里就能看出谁是谁、是什么」：
 *   ```
 *   偷 石头 家被守护犬抓住，罚了 500 金币
 *     ↓
 *   偷 [石头🧒] 家被守护犬抓住，罚了 500 金币
 *
 *   [石头🧒] 来你的农场，顺走了 [🥕胡萝卜] ×1
 *   ```
 *
 * 两类标签都同时是**入口**：点人名打开那座邻居农场的拜访弹窗，
 * 点作物打开作物信息弹窗。动作名写在 class 之外（`data-action`），
 * 由 `ui/inline-actions.js` 在 document 上统一接管 ——
 * 所以日志、时报、邻居卡片……任何一处渲染出来的标签都自动可点，
 * 不需要每个视图各自再绑一次。
 *
 * 为什么按「全文匹配名字」而不是只认 `who` 字段：
 * 文案里的主语常常是玩家（`state.farm.name`），而 `who` 只记了涉及者的 id；
 * 直接扫名字能让「农场主偷石头家」「石头来你的农场」这类句子自然成立，
 * 也不用要求每个 store 调用点都记得传 who。
 */
import { escapeHtml } from '../core/dom.js';
import { CROPS } from '../data/crops.js';
import { state } from '../store/state.js';

/** 文本里可能出现的所有人：玩家自己 + 全部邻居 */
function people() {
  const out = [];
  if (state.farm?.name) {
    out.push({
      name: state.farm.name,
      avatar: state.farm.avatar || '🧑‍🌾',
      id: state.farm.id,
      self: true,
    });
  }
  for (const friend of state.friends || []) {
    if (friend.name) {
      out.push({
        name: friend.name,
        avatar: friend.avatar || '🧑‍🌾',
        id: friend.id,
        self: false,
      });
    }
  }
  // 长名字优先：「小雨点」不能被「小雨」先吃掉半截
  return out.sort((a, b) => b.name.length - a.name.length);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 词条表与正则按「人名签名」缓存：作物表是静态的，
 * 只有玩家/邻居改名换头像时才需要重建（每次渲染日志重建一遍 220 条太浪费）。
 */
let cache = null;
let cacheKey = '';

function matcher() {
  const list = people();
  const key = list.map((p) => `${p.id}\u0000${p.name}\u0000${p.avatar}`).join('\u0001');
  if (cache && key === cacheKey) return cache;

  /** @type {Array<{key:string, type:'person'|'crop'}>} */
  const tokens = [];
  // 人排在前面：同名的作物与农场主撞车时，优先当成人（「谁家的」才是句子的重点）
  for (const person of list) {
    tokens.push({ key: escapeHtml(person.name), type: 'person', person });
  }
  for (const [cropId, crop] of Object.entries(CROPS)) {
    const name = escapeHtml(crop.name);
    // 文案里作物通常写成「🥕胡萝卜」，连图标一起吃掉，标签本身再带上图标；
    // 单独出现的名字也要能认出来（「胡萝卜地」这类写法）
    tokens.push({ key: `${crop.emoji}${name}`, type: 'crop', cropId, label: `${crop.emoji}${name}` });
    tokens.push({ key: name, type: 'crop', cropId, label: name });
  }
  // 长的先匹配，短名才不会把长名咬掉一截
  tokens.sort((a, b) => b.key.length - a.key.length);

  const map = new Map();
  for (const token of tokens) if (!map.has(token.key)) map.set(token.key, token);

  // 名字两侧的空格一起吃掉：文案里写 `${name} 家` 是为了分隔，
  // 名字变成标签之后这些空格只会让句子断开（只吃空格与制表符，不动换行）
  const re = new RegExp(`[ \\t]*(${[...map.keys()].map(escapeRe).join('|')})[ \\t]*`, 'g');
  cache = { re, map };
  cacheKey = key;
  return cache;
}

/**
 * 正文 → HTML，其中的人名与作物名变成可点的行内标签。
 * @param {string} text 原始文案（未转义）
 * @returns {string} 可安全插入的 HTML
 */
export function inlineTagsHTML(text) {
  const safe = escapeHtml(String(text ?? ''));
  const { re, map } = matcher();
  if (!map.size) return safe;

  return safe.replace(re, (all, token) => {
    const hit = map.get(token);
    if (!hit) return all;

    if (hit.type === 'person') {
      const { person } = hit;
      const ava = `<i class="ava">${person.avatar}</i>`;
      // 自己那座农场点不开 —— 不加动作属性，样式上也就没有可点的暗示
      return person.self
        ? `<span class="who-tag me">${token}${ava}</span>`
        : `<span class="who-tag" data-action="open-farm" data-id="${escapeHtml(person.id)}">${token}${ava}</span>`;
    }
    return `<span class="crop-tag" data-action="crop-detail" data-crop="${escapeHtml(hit.cropId)}">${hit.label}</span>`;
  });
}
