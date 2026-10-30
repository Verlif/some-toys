/**
 * 农场通知：NPC 寄来的信，玩家手动领取。
 *
 * 存在的理由（第 54 轮）：送礼和排行榜奖励原来都是「当场入账」——
 * 邻居送的东西直接进仓库，出榜的奖励直接进钱包。玩家看不到「谁给的、给了什么」，
 * 世界也就少了一层「有人在惦记你」的真实感。现在改成信箱：
 * 东西先挂在通知里，玩家点「收下」才进背包。
 *
 * 每条的形状：
 * ```
 * { id, at, kind, emoji, title, body, by, from, reward, claimText, read, claimed }
 * ```
 *   - `kind`   gift / award（后续可扩成 npc 的私信，见 docs）；
 *   - `by`     来源邻居 id，列表里点一下能打开那位邻居；
 *   - `reward` 领取时发的东西（形状见 store/reward.js），null = 纯消息；
 *   - `claimed` 没有 reward 的消息恒为 true（「已读即完成」）。
 *
 * 存放：`state.farm.progress.notices`，跟着 farm 行一起落盘 —— 不新开表，
 * 存档结构与导入导出都不用动。保留最近 30 天；**没领的不会被时间裁掉**，
 * 免得玩家离线一个月回来，东西已经被清空了。
 */
import { commit } from '../core/storage.js';
import { emit, EVENTS } from '../core/bus.js';
import { state } from './state.js';
import * as player from './player.js';
import { grantReward } from './reward.js';
import { NOTICE_CAP, NOTICE_KEEP_DAYS, cleanReward } from '../data/notice.js';

const DAY_MS = 86_400_000;

/** 自增序号，保证同一毫秒内推两条也不会撞 id */
let seq = 0;

/** 通知数组（总是按时间倒序） */
function list() {
  const progress = state.farm?.progress;
  if (!progress) return [];
  return progress.notices ?? (progress.notices = []);
}

/**
 * 裁掉过期的：领过的只留 30 天，没领的一直留着（直到 NOTICE_CAP）。
 * @param {object[]} entries 已按时间倒序
 * @param {number} now
 */
function trim(entries, now = Date.now()) {
  const cutoff = now - NOTICE_KEEP_DAYS * DAY_MS;
  return entries
    .filter((entry) => !entry.claimed || entry.at >= cutoff)
    .slice(0, NOTICE_CAP);
}

/** 生成一个不与现有条目重复的 id */
function nextId(at) {
  const taken = new Set(list().map((entry) => entry.id));
  let id = '';
  do {
    seq += 1;
    id = `nt${at.toString(36)}-${seq.toString(36)}`;
  } while (taken.has(id));
  return id;
}

/**
 * 推一条通知。
 *
 * @param {object} options
 * @param {string} options.kind gift / award / npc / friend
 * @param {string} options.emoji
 * @param {string} options.title 主文案
 * @param {string} [options.body] 副文案（时间与明细由 UI 拼，这里只写内容）
 * @param {string} [options.by] 来源邻居 id
 * @param {string} [options.from] 来源显示名（邻居名 / 「排行榜」）
 * @param {number} [options.at] 发生时刻（离线补算时是过去）
 * @param {?object} [options.reward] 领取时发放的奖励
 * @param {string} [options.claimText] 领取后写进农场日志的那句话
 * @param {string} [options.action] 需要玩家点按钮处理的动作（如 `friend-request`）
 * @param {boolean} [options.pending] 有动作但还没处理完 —— 让它留在「待办」里
 * @returns {string} 通知 id
 */
export function pushNotice({
  kind = 'npc',
  emoji = '📬',
  title = '',
  body = '',
  by = '',
  from = '',
  at = Date.now(),
  reward = null,
  claimText = '',
  action = '',
  pending = false,
} = {}) {
  const entries = list();
  const id = nextId(at);
  const clean = cleanReward(reward);

  entries.unshift({
    id,
    at,
    kind,
    emoji,
    title,
    body,
    by,
    from,
    reward: clean,
    claimText,
    action,
    read: false,
    // 没有奖励也没有待办动作的消息「已读即完成」
    claimed: pending ? false : !clean,
  });
  entries.sort((a, b) => b.at - a.at);
  state.farm.progress.notices = trim(entries);

  emit(EVENTS.NOTICE);
  return id;
}

/** 全部通知（按时间倒序） */
export function noticeList() {
  return list();
}

/**
 * 角标数字：**没领的条数**。
 *
 * 已读但没领的也要算 —— 玩家关掉列表却没点「收下」，东西还挂在那儿，
 * 角标消失了就再也不会想起来。
 * @returns {number}
 */
export function noticeUnclaimed() {
  return list().filter((entry) => !entry.claimed).length;
}

/** 未读条数（列表里的小圆点用） */
export function noticeUnread() {
  return list().filter((entry) => !entry.read).length;
}

/** 按 id 找一条 */
export function findNotice(id) {
  return list().find((entry) => entry.id === id) || null;
}

/**
 * 收下一条通知里的东西。
 *
 * 已经领过 / 不存在都返回 false（重复点不会发两次）。
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function claimNotice(id) {
  const notice = findNotice(id);
  if (!notice || notice.claimed) return false;

  const given = grantReward(notice.reward, Date.now());
  notice.claimed = true;
  notice.read = true;

  if (given && notice.claimText) player.addLog(notice.emoji, notice.claimText);

  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.NOTICE);
  emit(EVENTS.PLAYER);
  emit(EVENTS.INVENTORY);
  return given;
}

/**
 * 一键收下所有还能领的。
 *
 * **跳过带 `action` 的条目**（好友申请）：它们要玩家自己点头或摇头，
 * 「全部收下」替人做主就成了「全部同意」。
 * @returns {Promise<number>} 收下了几条
 */
export async function claimAllNotices() {
  const pending = list().filter((entry) => !entry.claimed && !entry.action);
  if (!pending.length) return 0;

  const now = Date.now();
  let claimed = 0;
  for (const notice of pending) {
    if (grantReward(notice.reward, now)) {
      if (notice.claimText) player.addLog(notice.emoji, notice.claimText);
      claimed += 1;
    }
    notice.claimed = true;
    notice.read = true;
  }

  await commit({ farms: [state.farm], bag: state.bag });
  emit(EVENTS.NOTICE);
  emit(EVENTS.PLAYER);
  emit(EVENTS.INVENTORY);
  return claimed;
}

/**
 * 全部标为已读（打开列表时调用）。
 * 只有真的从「未读」变过去才落盘，免得每开一次信箱都写一次库。
 * @returns {Promise<boolean>}
 */
export async function markNoticesRead() {
  let changed = false;
  for (const notice of list()) {
    if (!notice.read) {
      notice.read = true;
      changed = true;
    }
  }
  if (!changed) return false;
  await commit({ farms: [state.farm] });
  emit(EVENTS.NOTICE);
  return true;
}

