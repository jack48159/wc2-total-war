// Keep the storage key stable so existing browser-side logs remain readable;
// individual entries and POST envelopes carry schemaVersion=2.
const KEY = 'wc2.remake.game-logs.v1';
const PENDING_KEY = 'wc2.remake.pending-game-log-sync.v1';

// The whole log store used to be parsed from localStorage, changed, and stringified back synchronously for EVERY logged event; a fight logs
// dozens of them, which showed up as a chain of 150-250 ms main-thread stalls. Now it lives in memory and is saved once, shortly after the last change.
let mem = null, timer = null;
const read = () => mem || (mem = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } })());
const save = () => { timer = null; try { localStorage.setItem(KEY, JSON.stringify(mem || {})); } catch (e) {} };
const write = value => { mem = value; if (!timer) timer = setTimeout(save, 1000); };
addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); save(); } });
const markPending = value => { try { localStorage.setItem(PENDING_KEY, JSON.stringify(value)); } catch (e) {} };
const clearPending = () => { try { localStorage.removeItem(PENDING_KEY); } catch (e) {} };

export const LogStore = {
  newId(stage) { return `${stage}:${Date.now()}`; },
  load(gameId) { return read()[gameId]?.entries || []; },
  append(gameId, entry, meta = {}) {
    const all = read(), item = all[gameId] || { schemaVersion: 2, gameId, stage: meta.stage || '', createdAt: new Date().toISOString(), entries: [] };
    item.schemaVersion = 2;
    item.updatedAt = new Date().toISOString();
    if (item.entries.some(existing => existing.id === entry.id)) return;
    item.entries.push(entry); all[gameId] = item; write(all);
  },
  sync(gameId, entries, meta = {}) {
    if (timer) clearTimeout(timer);
    save(); clearPending();
    return Promise.resolve(null);
  },
  clearAll() {
    write({}); clearPending();
  },
};
