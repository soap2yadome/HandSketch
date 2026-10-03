// Tiny IndexedDB wrapper for autosave. Every call is best-effort: private windows or
// blocked storage must never break the editor.
const DB = 'handsketch';
const STORE = 'kv';

let conn: Promise<IDBDatabase> | null = null;

/** One shared connection; reopened if the browser closes it. */
function open(): Promise<IDBDatabase> {
  if (!conn) {
    conn = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => {
        req.result.onclose = () => (conn = null);
        req.result.onversionchange = () => {
          req.result.close();
          conn = null;
        };
        resolve(req.result);
      };
      req.onerror = () => {
        conn = null;
        reject(req.error);
      };
    });
  }
  return conn;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve, reject) => {
      const r = db.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result as T | undefined);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return undefined;
  }
}

/** Resolves true when the value was durably written (false on quota/blocked storage). */
export async function kvSet(key: string, value: unknown): Promise<boolean> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

export async function kvDelete(key: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}
