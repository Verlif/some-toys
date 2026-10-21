/**
 * 存档网关：把 IndexedDB 的「表 + 行」翻译成「农场对象」。
 *
 * 上层只认 state.farm / state.friends / state.bag / state.news，
 * 不需要知道它们分别落在哪张表、怎么关联：
 *
 *   farm      每座农场一行（玩家也是一行，kind 区分）
 *   plot      按 [farmId, 地块序号] 存，一座农场的地块永远只属于它
 *   log       按 [farmId, 序号] 存，0 是最新一条
 *   news      全镇一张表，farmId 只标明来源
 *   inventory 玩家农场的背包，一件一行
 *
 * 写库以「农场」为单位：一次提交把这座农场的行、全部地块、整段日志
 * 一起写掉。地块与日志条数很少（≤ 40 块地 / ≤ 60 条日志），
 * 整体重写比分条增量更容易保证一致，也不会漏字段。
 */
import { getAll, write } from './db.js';
import { idList } from './utils.js';

/** 复合主键里的序号上界：地块序号与日志序号都是小整数，不可能到十亿 */
const SEQ_MAX = 1e9;

/**
 * 某座农场在复合主键表里的整段主键区间。
 * @param {string} farmId
 * @returns {IDBKeyRange}
 */
const farmRange = (farmId) => IDBKeyRange.bound([farmId, 0], [farmId, SEQ_MAX]);

/** 按序号还原顺序（序号就是写入时的先后） */
const bySeq = (rows) => rows.sort((a, b) => a.seq - b.seq);

/**
 * 一次性读出整个存档。
 *
 * @returns {Promise<{farms: object[], plots: Record<string, object[]>,
 *                    logs: Record<string, object[]>, news: object[],
 *                    bag: Record<string, number>}>}
 */
export async function loadSave() {
  const [farmRows, plotRows, logRows, newsRows, invRows] = await Promise.all([
    getAll('farm'),
    getAll('plot'),
    getAll('log'),
    getAll('news'),
    getAll('inventory'),
  ]);

  const plots = {};
  for (const row of plotRows) {
    const { farmId, ...plot } = row;
    (plots[farmId] ??= []).push(plot);
  }

  const logs = {};
  for (const row of logRows) (logs[row.farmId] ??= []).push(row);

  const bag = {};
  for (const row of invRows) bag[row.itemId] = row.count;

  return {
    farms: farmRows,
    plots,
    logs: Object.fromEntries(Object.entries(logs).map(([id, rows]) => [
      id,
      bySeq(rows).map(({ at, emoji, text, who }) => ({ at, emoji, text, who: idList(who) })),
    ])),
    // 旧档时报只有 farmId（单个来源农场），读档时并入 who 数组；
    // crop / cat 是新字段，旧条目没有就留空（分类会按图标兜底）
    news: bySeq(newsRows).map(({ at, emoji, text, farmId, who, crop, cat }) => ({
      at,
      emoji,
      text,
      who: idList(who || farmId),
      crop: crop || '',
      cat: cat || '',
    })),
    bag,
  };
}

/**
 * 提交一次改动。
 *
 * @param {object} changes
 * @param {object[]} [changes.farms] 要写回的农场（行 + 全部地块 + 整段日志）
 * @param {Record<string, number>} [changes.bag] 背包（全量覆盖）
 * @param {object[]} [changes.news] 时报（全量覆盖）
 */
export function commit(changes = {}) {
  const farms = changes.farms || [];
  const stores = [];
  if (farms.length) stores.push('farm', 'plot', 'log');
  if (changes.bag) stores.push('inventory');
  if (changes.news) stores.push('news');
  if (!stores.length) return Promise.resolve();

  return write(stores, (tx) => {
    for (const farm of farms) writeFarm(tx, farm);
    if (changes.bag) writeBag(tx, changes.bag);
    if (changes.news) writeNews(tx, changes.news);
  });
}

/**
 * 写一座农场：行、全部地块、整段日志。
 * plots / log 是运行时挂上去的关联数据，不进行记录。
 * @param {IDBTransaction} tx
 * @param {object} farm
 */
function writeFarm(tx, farm) {
  const { plots = [], log = [], ...row } = farm;
  tx.objectStore('farm').put(row);

  const plotStore = tx.objectStore('plot');
  for (const plot of plots) plotStore.put({ ...plot, farmId: farm.id });

  const logStore = tx.objectStore('log');
  logStore.delete(farmRange(farm.id));
  log.forEach((entry, seq) => logStore.put({
    farmId: farm.id,
    seq,
    at: entry.at,
    emoji: entry.emoji,
    text: entry.text,
    // 涉及的人（带头像用）：玩家自己的操作不写，渲染时默认农场主
    who: idList(entry.who),
  }));
}

/** 背包全量覆盖：体量小，清空重写最不容易出错 */
function writeBag(tx, bag) {
  const store = tx.objectStore('inventory');
  store.clear();
  for (const [itemId, count] of Object.entries(bag)) {
    if (count > 0) store.put({ itemId, count });
  }
}

/** 时报全量覆盖：序号即排序，0 是最新一条 */
function writeNews(tx, news) {
  const store = tx.objectStore('news');
  store.clear();
  news.forEach((entry, seq) => store.put({
    seq,
    at: entry.at,
    emoji: entry.emoji,
    text: entry.text,
    // 这条新闻涉及的人（可能多个：小偷 + 被偷的农场主）
    who: idList(entry.who),
    // 相关的作物（有值时时报里那枚图标就是它，可点开详情）与筛选分类
    crop: entry.crop || '',
    cat: entry.cat || '',
  }));
}

/**
 * 删掉几座农场（连同它的地块与日志）。
 * 邻居名单缩水时由 initState 调用，避免留下没人认领的孤儿数据。
 * @param {string[]} ids
 */
export function dropFarms(ids) {
  if (!ids.length) return Promise.resolve();
  return write(['farm', 'plot', 'log'], (tx) => {
    for (const id of ids) {
      tx.objectStore('farm').delete(id);
      tx.objectStore('plot').delete(farmRange(id));
      tx.objectStore('log').delete(farmRange(id));
    }
  });
}

/** 清空全部存档（「重新开始」用） */
export function wipeSave() {
  const stores = ['farm', 'plot', 'log', 'news', 'inventory'];
  return write(stores, (tx) => {
    for (const store of stores) tx.objectStore(store).clear();
  });
}
