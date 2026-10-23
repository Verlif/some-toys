/**
 * IndexedDB 连接层。
 *
 * 表结构用 SCHEMA 声明，新增表只需加一行，升级逻辑自动生效。
 *
 * 设计原则：**没有「只有一条记录」的表**。
 * 每座农场都是 `farm` 里的一行（玩家自己也是其中一行），
 * 地块 / 日志各自成表、用 farmId 关联回农场 ——
 * 农场规模再怎么长，也不会把某一条记录撑成巨无霸。
 *
 * write() 的回调必须「同步」发出所有请求：IndexedDB 事务在
 * 事件循环回到空转时会自动提交，中途 await 会导致事务失效。
 */

/** 全新存档库名。旧库 sun_farm_v1 / homeland_farm_v2 原样留在浏览器里，不迁移也不复用 */
export const DB_NAME = 'sun_farm_v2';

/** 结构版本：字段不兼容时 +1，并在 upgrade 中补迁移逻辑 */
export const DB_VERSION = 3;

/**
 * 表结构声明：store 名 → 配置。
 *
 * 只有 farm 是「一个实体一行」的宽表，其余都是按 farmId 拆开的子表：
 *   farm      1 ── N plot（[farmId, 地块序号]）
 *   farm      1 ── N log （[farmId, 序号]，0 = 最新一条）
 *   news           全镇时报，farmId 只标明来源
 *   relation       两点之间的好感度（[a, b]，a < b），与农场数量无关的一对一关系
 *   daily         每日排行榜，一天一行（主键是本地日期键），最多留 8 行
 */
export const SCHEMA = {
  farm: { keyPath: 'id' },
  plot: { keyPath: ['farmId', 'id'] },
  log: { keyPath: ['farmId', 'seq'] },
  news: { keyPath: 'seq' },
  relation: { keyPath: ['a', 'b'] },
  inventory: { keyPath: 'itemId' },
  daily: { keyPath: 'date' },
};

let db = null;

/**
 * 打开（必要时创建）数据库
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase() {
  if (db) return Promise.resolve(db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const database = event.target.result;
      for (const [name, options] of Object.entries(SCHEMA)) {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name, options);
        }
      }
    };

    req.onsuccess = (event) => {
      db = event.target.result;
      // 其它标签页触发升级时主动让路，避免阻塞对方
      db.onversionchange = () => {
        db.close();
        db = null;
      };
      resolve(db);
    };

    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('数据库被其它标签页占用，请关闭后重试'));
  });
}

/**
 * IDBRequest → Promise
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 读取整张表 */
export function getAll(store) {
  return promisify(db.transaction(store, 'readonly').objectStore(store).getAll());
}

/**
 * 在单个事务里跨表写入，保证一次操作的数据一致性。
 * @param {string[]} stores
 * @param {(tx: IDBTransaction) => void} work 必须同步执行
 * @returns {Promise<void>} 事务提交后 resolve
 */
export function write(stores, work) {
  const t = db.transaction(stores, 'readwrite');
  work(t);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('事务被中断'));
  });
}
