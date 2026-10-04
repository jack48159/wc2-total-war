// Device-local player data shared by the browser and packaged mobile apps.
let database;
const open = () => database ||= new Promise((resolve, reject) => {
  const request = indexedDB.open('wc2-player-local', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('data');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('本地数据库被其他窗口占用'));
});
export async function localRead(key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('data').objectStore('data').get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}
export async function localWrite(key, value) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('data', 'readwrite');
    transaction.objectStore('data').put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('本地数据写入失败'));
  });
}
export async function localDataRequest(url, options = {}) {
  const key = url === '/api/profile' ? 'profile' : 'saves';
  const method = (options.method || 'GET').toUpperCase();
  if (method === 'POST') {
    await localWrite(key, JSON.parse(options.body));
    return Response.json({ ok: true });
  }
  if (method !== 'GET') return Response.json({ error: '请求方法错误' }, { status: 405 });
  return Response.json(await localRead(key) || {});
}
