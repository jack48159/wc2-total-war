// Installed Windows shell. Player data is deliberately outside update releases.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ORIGIN = 'https://208.87.207.49';
const BUCKET = 'https://wc2-1324086514.cos.ap-guangzhou.myqcloud.com';
const KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtwfLjT9ZSRBF0haS4Kl6
H8VsYtecwjFp6xC1WkpHYxBRiPCWWOBATugSDK6Y/nIMb+6wdt60i2xkYbN8E6I7
MOBGzvTquoqMLwQ7vTgTRktMU3MaDq4zeSWfXGqkJiVuvBMJjQ0R5x/6SknPsIwW
/HolFAkiRgRyLx4LF5e9JpRlQg9pTw3pfLOMtnAFq6X4zfN4b9Ut+crd+wCz72VZ
wZ4kDEa+SVbkY/mj05hPJR5WxVzQKY9Py/vUvIKIwxLQGpHBkwqOWp/7ON2r4GM2
HUspULeTw/ItQqCalKFt8MSAu2Lww/wVhL2zKbQZNKZq3DOVx0hgJ7cRRU+MgddT
WQIDAQAB
-----END PUBLIC KEY-----`;
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
function validPath(p) { return typeof p === 'string' && /^[A-Za-z0-9_@.\-/\u0080-\uFFFF]+$/.test(p) && !p.startsWith('/') && !p.split('/').some(s => !s || s === '.' || s === '..') && !p.includes('\\'); }
function verify(envelope) {
  const bytes = Buffer.from(envelope.payload, 'base64');
  if (!crypto.verify('sha256', bytes, KEY, Buffer.from(envelope.signature, 'base64'))) throw Error('更新签名无效');
  const m = JSON.parse(bytes);
  if (!/^\d{14}$/.test(m.release) || m.shell > 1 || m.protocol !== 'wc2-1' || new URL(m.base).origin !== BUCKET || !m.base.startsWith(BUCKET + '/web/releases/' + m.release + '/')) throw Error('需要安装新版程序');
  if (!Array.isArray(m.files) || m.files.length > 10000) throw Error('更新清单无效');
  const names = new Set(); let total = 0;
  for (const f of m.files) { if (!validPath(f.path) || names.has(f.path) || !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0 || f.size > 100000000) throw Error('更新文件无效'); names.add(f.path); total += f.size; }
  if (total > 2000000000 || !names.has('index.html') || !names.has('runtime-config.js')) throw Error('更新不完整');
  return m;
}
module.exports = function createUpdater(root, mime) {
  const dir = path.join(root, 'data', 'updates'), statePath = path.join(dir, 'state.json');
  fs.mkdirSync(dir, { recursive: true });
  let state = {}; try { state = JSON.parse(fs.readFileSync(statePath)); } catch {}
  for (const key of ['active', 'previous', 'ready']) if (state[key] && !/^\d{14}$/.test(state[key])) delete state[key];
  const save = () => { const t = statePath + '.next'; fs.writeFileSync(t, JSON.stringify(state)); fs.renameSync(t, statePath); };
  if (state.trial) { state.active = state.previous || null; state.trial = false; state.ready = null; save(); }
  let busy = false, progress = { running: false };
  const active = () => state.active ? path.join(dir, state.active) : null;
  const baseline = file => file.startsWith('assets/') ? [path.join(root, 'project/app/src/main/assets', file.slice(7)), path.join(root, 'public', file)] : file.startsWith('data/') ? [path.join(root, 'project/app/src/main/assets/remake/data', file.slice(5)), path.join(root, 'public', file)] : [path.join(root, 'public', file)];
  async function prepare() {
    if (busy) return;
    busy = true; progress = { running: true, done: 0, total: 0, downloaded: 0 };
    let staging;
    try {
      const response = await fetch(ORIGIN + '/updates/stable.json', { signal: AbortSignal.timeout(15000), redirect: 'error', cache: 'no-store' });
      if (!response.ok) throw Error('更新服务暂不可用');
      const m = verify(await response.json());
      if (m.release === state.active) { progress = { running: false, ready: m.release }; return; }
      staging = path.join(dir, m.release + '.staging'); fs.rmSync(staging, { recursive: true, force: true }); fs.mkdirSync(staging);
      progress.total = m.files.length;
      const queue = [...m.files];
      const worker = async () => {
        while (queue.length) {
          const f = queue.shift(), dest = path.join(staging, f.path); fs.mkdirSync(path.dirname(dest), { recursive: true });
          const sources = [...(active() ? [path.join(active(), f.path)] : []), ...baseline(f.path)];
          let reused = false;
          for (const src of sources) {
            if (!fs.existsSync(src) || fs.statSync(src).size !== f.size) continue;
            if (digest(fs.readFileSync(src)) !== f.sha256) continue;
            fs.copyFileSync(src, dest); reused = true; break;
          }
          if (!reused) {
            const r = await fetch(m.base + f.path.split('/').map(encodeURIComponent).join('/'), { signal: AbortSignal.timeout(60000), redirect: 'error' });
            if (!r.ok) throw Error('下载失败：' + f.path);
            const data = Buffer.from(await r.arrayBuffer());
            if (data.length !== f.size || digest(data) !== f.sha256) throw Error('文件校验失败：' + f.path);
            fs.writeFileSync(dest, data); progress.downloaded += data.length;
          }
          progress.done++;
        }
      };
      const results = await Promise.allSettled([worker(), worker(), worker(), worker()]);
      const failure = results.find(r => r.status === 'rejected'); if (failure) throw failure.reason;
      const final = path.join(dir, m.release); fs.rmSync(final, { recursive: true, force: true }); fs.renameSync(staging, final);
      state.ready = m.release; save(); progress = { ...progress, running: false, ready: m.release };
    } catch (e) { if (staging) fs.rmSync(staging, { recursive: true, force: true }); progress = { ...progress, running: false, error: e.message }; }
    finally { busy = false; }
  }
  return {
    handle(req, res, url) {
      if (url.startsWith('/api/update/')) {
        const origin = req.headers.origin;
        if (req.headers['x-wc2-update'] !== '1' || (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`)) { res.writeHead(403); res.end(); return true; }
        const reply = value => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
        if (url === '/api/update/status') reply({ ...progress, active: state.active, ready: state.ready, shell: 1 });
        else if (req.method !== 'POST') { res.writeHead(405); res.end(); }
        else if (url === '/api/update/prepare') { void prepare(); reply({ ok: true }); }
        else if (url === '/api/update/activate') { if (state.ready && !busy) { state.previous = state.active; state.active = state.ready; state.trial = true; state.ready = null; save(); setTimeout(() => { if (state.trial) { state.active = state.previous || null; state.trial = false; save(); } }, 120000).unref(); reply({ ok: true }); } else reply({ error: '更新尚未准备完成' }); }
        else if (url === '/api/update/ready') { state.trial = false; save(); for (const name of fs.readdirSync(dir)) if (/^\d{14}$/.test(name) && ![state.active, state.previous, state.ready].includes(name)) fs.rmSync(path.join(dir, name), { recursive: true, force: true }); reply({ ok: true }); }
        else { res.writeHead(404); res.end(); }
        return true;
      }
      if (!active() || url.startsWith('/api/') || url.startsWith('/remote/')) return false;
      let file; try { file = decodeURIComponent(url).replace(/^\//, ''); } catch { res.writeHead(400); res.end(); return true; }
      if (!file || file.endsWith('/')) file += 'index.html';
      if (!validPath(file)) { res.writeHead(403); res.end(); return true; }
      const p = path.join(active(), file);
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404); res.end(); return true; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(p).pipe(res); return true;
    }
  };
};
module.exports.verify = verify;
module.exports.validPath = validPath;
