/**
 * 「头像 + 名字」小胶囊 —— 农场日志与时报共用。
 *
 * 以前两边各写一份 `avatarPile()`：头像是一枚孤零零的圆片，名字混在正文里，
 * 读起来「这头像到底是谁」要靠猜。现在头像和名字合成一个整体，
 * 共用一层浅绿底，视觉上就是一个「人」。
 *
 * 一条事件可能涉及好几个人（小偷 + 被偷的农场主），
 * 那就叠几个头像、名字用「、」连起来 —— 仍然是一个胶囊。
 */
import { escapeHtml } from '../core/dom.js';
import { avatarOf, nameOf, PLAYER_ID } from '../store/state.js';

/**
 * 这条记录涉及的人。没写 who 表示玩家自己的操作，默认只有农场主。
 * @param {string[]} [who]
 * @returns {string[]}
 */
export function whoIds(who) {
  return who?.length ? who : [PLAYER_ID];
}

/**
 * 胶囊 HTML。
 * @param {string[]} [who] 农场 id 数组
 * @param {{small?: boolean}} [options] small 用于农场日志（行更密）
 * @returns {string}
 */
export function whoChipHTML(who, { small = false } = {}) {
  const ids = whoIds(who);
  const avatars = ids.map((id) => `<i class="ava">${avatarOf(id)}</i>`).join('');
  const names = ids.map((id) => escapeHtml(nameOf(id))).join('、');
  return `<span class="who-chip${small ? ' small' : ''}">${avatars}<b class="who-name">${names}</b></span>`;
}

/**
 * 正文里已经带了这个人的名字就削掉。
 *
 * 名字既然已经由胶囊给出，正文再重复一遍读着累；
 * 时报的多数文案都长成「X 的农场升到了 Lv.N」「农场主 偷 X 家…」这样。
 *
 * 名字后面紧跟的「的」也一起去掉：胶囊在上面已经点了名，
 * 正文再以「的农场…」开头等于把一句话拆成两半。
 * 削完什么都不剩（正文就是个名字）就原样返回，免得整行空掉。
 *
 * @param {string} text
 * @param {string[]} [who]
 * @returns {string}
 */
export function stripWhoName(text, who) {
  for (const id of whoIds(who)) {
    const name = nameOf(id);
    if (!name || !text.startsWith(name)) continue;
    const rest = text.slice(name.length)
      .replace(/^[\s·:：,，]+/, '')
      .replace(/^的/, '')
      .trim();
    if (rest) return rest;
  }
  return text;
}
