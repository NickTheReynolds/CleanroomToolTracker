// @ts-check
/**
 * Thin promise wrapper around IndexedDB: open and upgrade the database and
 * run transactions. Everything else goes through records.js and repo.js.
 */
import { DB_NAME, DB_VERSION, MIGRATIONS } from './schema.js';

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;
/** @type {(message: string) => void} */
let notify = (message) => console.warn(message);

/**
 * Where to report "another tab blocks the upgrade" style messages.
 * @param {(message: string) => void} fn
 */
export function setDbNotifier(fn) {
  notify = fn;
}

/**
 * Promise for one IDBRequest.
 * @template T
 * @param {IDBRequest<T>} r
 * @returns {Promise<T>}
 */
export function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/**
 * Open (and create or upgrade) the database once per page.
 * @returns {Promise<IDBDatabase>}
 */
export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('This browser has no IndexedDB storage, so the app cannot save data.'));
      return;
    }
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = (e) => {
      const db = r.result;
      const tx = /** @type {IDBTransaction} */ (r.transaction);
      for (const m of MIGRATIONS) {
        if (m.version <= e.oldVersion || m.version > DB_VERSION) continue;
        for (const [name, def] of Object.entries(m.stores)) {
          const store = db.objectStoreNames.contains(name)
            ? tx.objectStore(name)
            : db.createObjectStore(name, { keyPath: def.keyPath });
          for (const [index, keyPath] of def.indexes) {
            if (!store.indexNames.contains(index)) store.createIndex(index, keyPath, { unique: false });
          }
        }
      }
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
        notify('A newer version of the app opened in another tab. Reload this tab.');
      };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    r.onerror = () => {
      dbPromise = null;
      reject(r.error || new Error('Could not open the database.'));
    };
    r.onblocked = () => notify('Close other tabs of this app so the database can upgrade.');
  });
  return dbPromise;
}

/**
 * Run `fn` in one transaction and resolve with its result once the
 * transaction has committed. Writes request strict durability so a save
 * survives a crash or power loss right after it reports success.
 * Inside `fn`, only await IndexedDB requests (via `req`).
 * @template T
 * @param {string[]} stores
 * @param {IDBTransactionMode} mode
 * @param {(tx: IDBTransaction) => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTx(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    /** @type {IDBTransaction} */
    let tx;
    try {
      tx = mode === 'readwrite'
        ? db.transaction(stores, mode, { durability: 'strict' })
        : db.transaction(stores, mode);
    } catch (err) {
      reject(err);
      return;
    }
    /** @type {any} */
    let value;
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('The database transaction was aborted.'));
    const fail = (/** @type {unknown} */ err) => {
      try { tx.abort(); } catch { /* already finished */ }
      reject(err);
    };
    try {
      Promise.resolve(fn(tx)).then((v) => { value = v; }, fail);
    } catch (err) {
      fail(err);
    }
  });
}

/**
 * All records of a store, optionally through an index and key range.
 * @param {string} store
 * @param {string} [index]
 * @param {IDBValidKey | IDBKeyRange} [query]
 * @returns {Promise<any[]>}
 */
export function getAll(store, index, query) {
  return withTx([store], 'readonly', (tx) => {
    const s = tx.objectStore(store);
    return req(index ? s.index(index).getAll(query) : s.getAll(query));
  });
}

/**
 * @param {string} store
 * @param {IDBValidKey} key
 * @returns {Promise<any>} the record, or undefined
 */
export function getOne(store, key) {
  return withTx([store], 'readonly', (tx) => req(tx.objectStore(store).get(key)));
}

/**
 * Write records to one or more stores atomically.
 * @param {Record<string, any[]>} byStore e.g. {runs: [run], photos: [p1, p2]}
 * @returns {Promise<void>}
 */
export function putAll(byStore) {
  const stores = Object.keys(byStore).filter((s) => byStore[s].length);
  if (!stores.length) return Promise.resolve();
  return withTx(stores, 'readwrite', (tx) => {
    for (const s of stores) {
      const os = tx.objectStore(s);
      for (const rec of byStore[s]) os.put(rec);
    }
  });
}

/**
 * @param {string} store
 * @param {any} record
 * @returns {Promise<void>}
 */
export function putOne(store, record) {
  return putAll({ [store]: [record] });
}

/**
 * Physically delete one key. Used only for meta entries such as form
 * drafts; user records are soft-deleted instead.
 * @param {string} store
 * @param {IDBValidKey} key
 * @returns {Promise<void>}
 */
export function deleteKey(store, key) {
  return withTx([store], 'readwrite', (tx) => { tx.objectStore(store).delete(key); });
}

/**
 * Delete the whole database (Settings -> Erase all data).
 * @returns {Promise<void>}
 */
export async function deleteDatabase() {
  if (dbPromise) {
    try { (await dbPromise).close(); } catch { /* not open */ }
  }
  dbPromise = null;
  await new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => resolve(undefined);
    r.onerror = () => reject(r.error);
    r.onblocked = () => notify('Close other tabs of this app to finish erasing.');
  });
}
