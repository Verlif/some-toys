/**
 * IndexedDB 连接层。
 *
 * 设计要点：
 * 1. 表结构用 SCHEMA 声明，新增表只需加一行，升级逻辑自动生效；
 * 2. 所有请求包装为 Promise，并提供事务级的 write() 以便一次提交多张表；
 * 3. write() 的回调必须「同步」发出所有请求——IndexedDB 事务在
 *    事件循环回到空转时会自动提交，中途 await 会导致事务失效。
 */

/** 全新存档库名（本次重构不复用旧库，旧库 homeland_farm_v2 保留在浏览器中不动） */
export const DB_NAME = 'sun_farm_v1';

/** 结构版本：字段不兼容时 +1，并在 upgrade 中补迁移逻辑 */
export const DB_VERSION = 1;

/** 表结构声明：store 名 → 配置 */
export const SCHEMA = {
  player: { keyPath: 'id' },
  plots: { keyPath: 'id' },
  inventory: { keyPath: 'itemId' },
  friends: { keyPath: 'id' },
  pets: { keyPath: 'id' },
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

function tx(stores, mode) {
  return db.transaction(stores, mode);
}

/** 读取单条 */
export function get(store, key) {
  return promisify(tx(store, 'readonly').objectStore(store).get(key));
}

/** 读取全表 */
export function getAll(store) {
  return promisify(tx(store, 'readonly').objectStore(store).getAll());
}

/** 写入/覆盖单条 */
export function put(store, value) {
  return promisify(tx(store, 'readwrite').objectStore(store).put(value));
}

/** 删除单条 */
export function remove(store, key) {
  return promisify(tx(store, 'readwrite').objectStore(store).delete(key));
}

/**
 * 在单个事务里跨表写入，保证一次操作的数据一致性。
 * @param {string|string[]} stores
 * @param {(tx: IDBTransaction) => any} work 必须同步执行
 * @returns {Promise<any>} 事务提交后 resolve
 */
export function write(stores, work) {
  const t = tx(stores, 'readwrite');
  const result = work(t);
  return transactionDone(t, result);
}

function transactionDone(t, result) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('事务被中断'));
  });
}