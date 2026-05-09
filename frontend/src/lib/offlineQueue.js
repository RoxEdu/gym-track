/** Outbound queue for offline set logging.
 * Stores failed POST /sets payloads in IndexedDB and retries when back online.
 */
const DB_NAME = "gymtrack_offline";
const STORE = "outbound";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function enqueueSet(payload) {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const req = tx.objectStore(STORE).add({ payload, queued_at: Date.now() });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn("[offlineQueue] enqueue failed", e);
  }
}

export async function getQueueSize() {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
  } catch { return 0; }
}

export async function flushQueue(postFn) {
  if (!navigator.onLine) return { flushed: 0 };
  let flushed = 0;
  try {
    const db = await openDb();
    const items = await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    for (const item of items) {
      try {
        await postFn("/sets", item.payload);
        await new Promise((res) => {
          const tx = db.transaction(STORE, "readwrite");
          const req = tx.objectStore(STORE).delete(item.id);
          req.onsuccess = () => res();
          req.onerror = () => res();
        });
        flushed++;
      } catch (e) {
        // network still failing — leave in queue
        break;
      }
    }
  } catch (e) { console.warn("[offlineQueue] flush err", e); }
  return { flushed };
}
