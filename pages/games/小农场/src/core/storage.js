/**
 * 存档网关：把 IndexedDB 的「表 + 行」翻译成「农场对象」。
 *
 * 上层只认 state.farm / state.friends / state.bag / state.news，
 * 不需要知道它们分别落在哪张表、怎么关联：
 *
 *   farm      每座农场一行（玩家也是一行，kind 区分）
 *   plot      按 [farmId, 地块序号] 存，一座农场的地块永远只属于它
 *   log       按 [farmId, 序号] 存，0 是最新一条
 *   news      全镇一张表，文案里自带人名（渲染时扫描匹配头像）
 *   relation  两点之间的好感度，[a, b] 复合主键（a < b，一对只有一条）
 *   inventory 玩家农场的背包，一件一行
 *   daily     每日排行榜，一天一行（主键是本地日期键，见 store/daily.js）
 *
 * 写库以「农场」为单位：一次提交把这座农场的行、全部地块、整段日志
 * 一起写掉。地块与日志条数很少（≤ 40 块地 / ≤ 60 条日志），
 * 整体重写比分条增量更容易保证一致，也不会漏字段。
 */
import { getAll, write } from './db.js';

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
 *                    bag: Record<string, number>,
 *                    dailyRows: Record<string, object>}>}
 */
export async function loadSave() {
  const [farmRows, plotRows, logRows, newsRows, relRows, invRows, dailyRows] = await Promise.all([
    getAll('farm'),
    getAll('plot'),
    getAll('log'),
    getAll('news'),
    getAll('relation'),
    getAll('inventory'),
    getAll('daily'),
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
      // by 是「这件事是谁干的」：邻居对玩家农场的操作才带（邻居农场 id），
      // 旧档没有这个字段，一律按玩家自己的操作算（见 ui/log-sheet.js 的两个 tab）
      bySeq(rows).map(({ at, emoji, text, by }) => ({ at, emoji, text, by: by || '' })),
    ])),
    // 旧档时报可能没有 crop / cat：分类字段留空（读时按图标兜底）
    relations: relRows.map(({ a, b, v }) => ({ a, b, v })),
    news: bySeq(newsRows).map(({ at, emoji, text, crop, cat }) => ({
      at,
      emoji,
      text,
      crop: crop || '',
      cat: cat || '',
    })),
    bag,
    // 每日排行榜：一天一行，旧档没有这个字段返回空表（见 store/daily.js）
    dailyRows: Object.fromEntries(
      dailyRows.map(({ date, start, settled, stats }) => [
        date,
        { date, start: Number(start) || 0, settled: Boolean(settled), stats: stats || {} },
      ]),
    ),
  };
}

/**
 * 提交一次改动。
 *
 * @param {object} changes
 * @param {object[]} [changes.farms] 要写回的农场（行 + 全部地块 + 整段日志）
 * @param {Record<string, number>} [changes.bag] 背包（全量覆盖）
 * @param {object[]} [changes.news] 时报（全量覆盖）
 * @param {Record<string, number>} [changes.relations] 好感度（全量覆盖，键是 `a|b`）
 * @param {Record<string, object>} [changes.dailyRows] 每日排行榜（全量覆盖，键是日期）
 */
export function commit(changes = {}) {
  const farms = changes.farms || [];
  const stores = [];
  if (farms.length) stores.push('farm', 'plot', 'log');
  if (changes.bag) stores.push('inventory');
  if (changes.news) stores.push('news');
  if (changes.relations) stores.push('relation');
  if (changes.dailyRows) stores.push('daily');
  if (!stores.length) return Promise.resolve();

  return write(stores, (tx) => {
    for (const farm of farms) writeFarm(tx, farm);
    if (changes.bag) writeBag(tx, changes.bag);
    if (changes.news) writeNews(tx, changes.news);
    if (changes.relations) writeRelations(tx, changes.relations);
    if (changes.dailyRows) writeDailyRows(tx, changes.dailyRows);
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
    // 邻居对玩家农场的操作带着邻居的 id，玩家自己的操作留空
    by: entry.by || '',
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
    // 相关的作物（有值时时报里那枚图标就是它，可点开详情）与筛选分类
    crop: entry.crop || '',
    cat: entry.cat || '',
  }));
}

/**
 * 好感度全量覆盖：只写非 0 的，几百行的表清空重写最不容易出错。
 * 键是 `a|b`（见 data/relation.js 的 relKey），这里拆回两段存成复合主键。
 * @param {IDBTransaction} tx
 * @param {Record<string, number>} relations
 */
function writeRelations(tx, relations) {
  const store = tx.objectStore('relation');
  store.clear();
  for (const [key, value] of Object.entries(relations)) {
    if (!value) continue;
    const [a, b] = key.split('|');
    if (!a || !b) continue;
    store.put({ a, b, v: value });
  }
}

/**
 * 每日排行榜全量覆盖：一天一行（最多留 8 行），清空重写最不容易出错。
 * @param {IDBTransaction} tx
 * @param {Record<string, object>} dailyRows 键是本地日期键，见 store/daily.js
 */
function writeDailyRows(tx, dailyRows) {
  const store = tx.objectStore('daily');
  store.clear();
  for (const row of Object.values(dailyRows)) {
    if (!row?.date) continue;
    // start 是账期起点（date 14:00），用来识别旧账期留下的同键行
    store.put({
      date: row.date,
      start: Number(row.start) || 0,
      settled: Boolean(row.settled),
      stats: row.stats || {},
    });
  }
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
  const stores = ['farm', 'plot', 'log', 'news', 'relation', 'inventory', 'daily'];
  return write(stores, (tx) => {
    for (const store of stores) tx.objectStore(store).clear();
  });
}
