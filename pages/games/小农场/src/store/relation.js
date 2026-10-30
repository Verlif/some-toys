/**
 * 好感度与好友关系的读写入口。
 *
 * 数据放 `state.relations`（`{ "a|b": { v, friend } }`，a、b 按字典序归一，
 * 一对只有一条），落盘进 `relation` 表（`[a, b]` 复合主键）。规则与阈值在
 * data/relation.js，这里只做「取 / 存 / 加减 / 加好友」，不掺业务判断
 * （谁该主动申请、申请怎么答，见 store/friend.js）。
 *
 * 好友为什么跟好感挤同一行：好友是「同一对关系的一种状态」，不是另一张表。
 * 好处是复合主键、备份导出、commit 全量覆盖全都不用动；代价是
 * **好感归 0 不能连行一起删** —— 0 好感的好友是合法的，见 setRelation。
 *
 * 注意：改了好感度的那次 commit 必须带上 `relations: state.relations`
 * （整表覆盖，和 news / bag 一个路子），否则关掉页面就白加了。
 */
import { PLAYER_ID, state } from './state.js';
import { pushNotice } from './notices.js';
import { autoUnfriendThreshold, clampRelation, relKey, relText, relTier } from '../data/relation.js';

/**
 * 某个农场 id 的性格键。
 * 玩家与联机真人没有性格档案，返回空串 —— 门槛那边会当 0 处理。
 * @param {string} id
 * @returns {string}
 */
function personalityOf(id) {
  if (!id || id === PLAYER_ID) return '';
  return state.friends.find((npc) => npc.id === id)?.personality || '';
}

/**
 * 一对关系的原始行（没有就是 undefined）。
 * @param {string} a
 * @param {string} b
 */
const entryOf = (a, b) => state.relations[relKey(a, b)];

/**
 * 两个人之间的好感度。
 * @param {string} a 农场 id
 * @param {string} b 农场 id
 * @returns {number} -200 ~ 200，没有记录时是 0
 */
export function getRelation(a, b) {
  if (!a || !b || a === b) return 0;
  return entryOf(a, b)?.v || 0;
}

/**
 * 两个人现在是不是好友。
 * @param {string} a
 * @param {string} b
 */
export function isFriend(a, b) {
  if (!a || !b || a === b) return false;
  return entryOf(a, b)?.friend === true;
}

/**
 * 直接设一个值（会夹到 [-200, 200]），顺带做一次「自动解除好友」检查。
 * @returns {number} 落定后的值
 */
export function setRelation(a, b, value) {
  if (!a || !b || a === b) return 0;
  const key = relKey(a, b);
  const next = clampRelation(value);
  const row = state.relations[key];

  // 0 好感 + 不是好友 = 这一行没有意义，删掉（和以前一样）；
  // 但只要还挂着好友，就必须留着 —— 删了等于顺手解除好友
  if (!next && !row?.friend) {
    delete state.relations[key];
    return next;
  }
  state.relations[key] = { v: next, friend: row?.friend === true };
  checkAutoUnfriend(a, b, key);
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
 * 改好友标记（不动好感）。
 *
 * 加好友只写标记、不补好感：门槛是「够不够格」，不是「加了送多少」。
 * @param {string} a
 * @param {string} b
 * @param {boolean} on
 * @returns {boolean} 落定后的标记
 */
export function setFriend(a, b, on) {
  if (!a || !b || a === b) return false;
  const key = relKey(a, b);
  const v = getRelation(a, b);
  if (!on) {
    if (!state.relations[key]) return false;
    if (!v) {
      delete state.relations[key];
      return false;
    }
    state.relations[key] = { v, friend: false };
    return false;
  }
  state.relations[key] = { v, friend: true };
  return true;
}

/**
 * 好感跌破「门槛的一半」就自动解除好友（用户定死的口径）。
 *
 * 只在**已经是好友**的那一行上判：路人好感掉到 -200 也不会「解除」什么。
 * NPC 把玩家解除掉要寄信 —— 玩家得知道「我什么时候被谁删了」，
 * 否则好友列表里少一个人只会莫名其妙。
 *
 * @param {string} a
 * @param {string} b
 * @param {string} key
 */
function checkAutoUnfriend(a, b, key) {
  const row = state.relations[key];
  if (!row?.friend) return;
  const limit = autoUnfriendThreshold(personalityOf(a), personalityOf(b));
  if (row.v >= limit) return;

  row.friend = false;
  if (!row.v) delete state.relations[key];

  // 只有「一方是玩家」才寄信：NPC 之间的散伙不该占玩家的信箱
  const npcId = a === PLAYER_ID ? b : b === PLAYER_ID ? a : '';
  if (!npcId) return;
  const npc = state.friends.find((item) => item.id === npcId);
  if (!npc) return;
  pushNotice({
    kind: 'friend',
    emoji: '💔',
    title: `${npc.name} 把你从好友里移除了`,
    body: `好感 ${relText(row.v)}，低于 ${limit}`,
    by: npc.id,
    from: npc.name,
  });
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
