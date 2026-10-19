/**
 * 存档网关：把 IndexedDB 的「表 + 记录」翻译成「领域对象 + 字段」。
 * 上层（store / ui）只认 player / plots / bag / friends / pet，
 * 不需要知道它们分别存在哪张表、哪个 keyPath 里。
 */
import { get, getAll, put, remove, write } from './db.js';

export const PLAYER_ID = 'player';
export const PET_ID = 'dog';

/** 各表仓库：统一的 CRUD 入口 */
function createRepository(store) {
  return {
    store,
    get: (key) => get(store, key),
    all: () => getAll(store),
    save: (value) => put(store, value),
    remove: (key) => remove(store, key),
  };
}

export const repos = {
  player: createRepository('player'),
  plots: createRepository('plots'),
  inventory: createRepository('inventory'),
  friends: createRepository('friends'),
  pets: createRepository('pets'),
};

/* ============================================================
   领域级读写
   ============================================================ */

/**
 * 一次性读出整个存档
 * @returns {Promise<{player: object|null, plots: object[], bag: Record<string, number>, friends: object[], pet: object}>}
 */
export async function loadSave() {
  const [playerRow, plotRows, invRows, friendRows, petRow] = await Promise.all([
    repos.player.get(PLAYER_ID),
    repos.plots.all(),
    repos.inventory.all(),
    repos.friends.all(),
    repos.pets.get(PET_ID),
  ]);

  const bag = {};
  for (const row of invRows) bag[row.itemId] = row.count;

  return {
    player: playerRow || null,
    plots: plotRows.sort((a, b) => a.id - b.id),
    bag,
    friends: friendRows,
    pet: petRow || { id: PET_ID, fedUntil: 0 },
  };
}

export const savePlayer = (player) => put('player', player);

export const savePlot = (plot) => put('plots', plot);

export const saveFriend = (friend) => put('friends', friend);

export const savePet = (pet) => put('pets', pet);

/**
 * 全量覆盖背包（背包体量很小，清空 + 重写最不容易出错）
 * @param {Record<string, number>} bag
 */
export function saveInventory(bag) {
  const rows = Object.entries(bag)
    .filter(([, count]) => count > 0)
    .map(([itemId, count]) => ({ itemId, count }));
  return write('inventory', (tx) => {
    const store = tx.objectStore('inventory');
    store.clear();
    for (const row of rows) store.put(row);
  });
}

/**
 * 多表一次性提交（例如收获时同时更新地块、背包、金币、经验）
 * @param {{player?: object, pet?: object}} singles 单条记录
 * @param {{plots?: object[], bag?: Record<string, number>, friends?: object[]}} collections 集合
 */
export function commit(singles = {}, collections = {}) {
  const stores = new Set();
  if (singles.player) stores.add('player');
  if (singles.pet) stores.add('pets');
  if (collections.plots) stores.add('plots');
  if (collections.bag) stores.add('inventory');
  if (collections.friends) stores.add('friends');
  if (!stores.size) return Promise.resolve();

  return write([...stores], (tx) => {
    if (singles.player) tx.objectStore('player').put(singles.player);
    if (singles.pet) tx.objectStore('pets').put(singles.pet);
    if (collections.plots) {
      const os = tx.objectStore('plots');
      for (const plot of collections.plots) os.put(plot);
    }
    if (collections.friends) {
      const os = tx.objectStore('friends');
      for (const friend of collections.friends) os.put(friend);
    }
    if (collections.bag) {
      const os = tx.objectStore('inventory');
      os.clear();
      for (const [itemId, count] of Object.entries(collections.bag)) {
        if (count > 0) os.put({ itemId, count });
      }
    }
  });
}

/** 清空全部存档（设置页「重新开始」用） */
export async function wipeSave() {
  await Promise.all(
    Object.values(repos).map((repo) =>
      write(repo.store, (tx) => tx.objectStore(repo.store).clear())),
  );
}