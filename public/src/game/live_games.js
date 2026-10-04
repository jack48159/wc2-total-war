// 进行中对局的本地自动存档：URL 里带着对局 ID(#battle/<关卡>/<对局ID>)，刷新页面后按 ID 恢复原对局，
// 对战桥/MCP 用的对局 ID 也保持不变。只保存在本机浏览器(IndexedDB)，未手动存档的对局最多保留 3 天。
const DB_NAME = 'wc2-live', STORE = 'games', MAX_AGE_MS = 3 * 24 * 3600 * 1000;
let dbPromise = null;

const open = () => dbPromise || (dbPromise = new Promise(resolve => {
  try {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'gameId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  } catch (e) { resolve(null); }
}));
const run = async (mode, fn) => {
  const db = await open(); if (!db) return null;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, mode), store = tx.objectStore(STORE), req = fn(store);
      if (req) { req.onsuccess = () => resolve(req.result ?? null); req.onerror = () => resolve(null); }
      tx.oncomplete = () => { if (!req) resolve(true); };
      tx.onerror = tx.onabort = () => resolve(null);
    } catch (e) { resolve(null); }
  });
};

export const LiveGames = {
  MAX_AGE_MS,
  // rec: { gameId, stageName, options, snapshot }
  async put(rec) { if (!rec?.gameId) return false; return !!(await run('readwrite', s => s.put({ ...rec, savedAt: Date.now() }))); },
  async get(gameId) {
    const rec = await run('readonly', s => s.get(gameId));
    if (rec && Date.now() - (rec.savedAt || 0) > MAX_AGE_MS) { await this.remove(gameId); return null; }
    return rec || null;
  },
  async remove(gameId) { return !!(await run('readwrite', s => s.delete(gameId))); },
  // 清理超过 3 天没有更新的未存档对局
  async purge() {
    const db = await open(); if (!db) return 0;
    return new Promise(resolve => {
      let removed = 0;
      try {
        const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE), cur = store.openCursor();
        cur.onsuccess = () => {
          const c = cur.result; if (!c) return;
          if (Date.now() - (c.value.savedAt || 0) > MAX_AGE_MS) { c.delete(); removed++; }
          c.continue();
        };
        tx.oncomplete = () => resolve(removed); tx.onerror = tx.onabort = () => resolve(removed);
      } catch (e) { resolve(removed); }
    });
  }
};
