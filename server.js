const http = require('http'), fs = require('fs'), path = require('path'), { exec } = require('child_process');
const AuthStore = require('./auth_store.js');
const WEB_BASE = process.env.WEB_BASE ? '/' + process.env.WEB_BASE.replace(/^\/+|\/+$/g, '') + '/' : '';
const ROOT = path.join(__dirname, 'public'), HOST = WEB_BASE ? '0.0.0.0' : '127.0.0.1', PORT = 8642;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.bin': 'application/octet-stream',
  '.raw': 'application/octet-stream'
};

// 静态资源加载引擎核心路径绑定 (完全接入 project 目录)
const DATA = path.join(__dirname, 'data');
const GAME_LOGS = path.join(DATA, 'game_logs.json');
const PROJECT_ROOT = path.join(__dirname, 'project');
const ASSETS = path.join(PROJECT_ROOT, 'app', 'src', 'main', 'assets');
const REMAKE_DATA = path.join(ASSETS, 'remake', 'data');

// 导入即时转换器
let syncModule = null;
try {
  syncModule = require('./tools/sync_editor_assets.js');
} catch (e) {}

// 只读资产列表
const listAssets = (dir, base = '') => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? listAssets(path.join(dir, e.name), base + e.name + '/') : [{ path: base + e.name, size: fs.statSync(path.join(dir, e.name)).size }]
  );
};

const openWindow = url => {
  if (process.argv.includes('--no-open')) return;
  // borderless full screen by default (Options > 游戏 > 启动时全屏 can turn it off); the setting is in data/settings.json
  let full = true; try { full = JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).autoFullscreen !== false; } catch (e) {}
  exec(`start msedge --app=${url} ${full ? '--start-fullscreen' : '--window-size=1280,760'} || start ${url}`);
};


// 对战桥：开启接管时由本地游戏服务自动拉起桥进程(仅本机模式)，随游戏服务退出而结束
let bridgeProc = null;
const BRIDGE_PORT = Number(process.env.WC2_BRIDGE_PORT || 8651);
const bridgeAlive = () => new Promise(resolve => {
  const r = http.get({ host: '127.0.0.1', port: BRIDGE_PORT, path: '/bridge/status', timeout: 800 }, res => { res.resume(); resolve(res.statusCode === 200); });
  r.on('error', () => resolve(false)); r.on('timeout', () => { r.destroy(); resolve(false); });
});
const ensureBridge = async () => {
  if (await bridgeAlive()) return { ok: true, started: false };
  if (!bridgeProc) {
    bridgeProc = require('child_process').spawn(process.execPath, [path.join(__dirname, 'tools', 'mcp', 'bridge_server.mjs')], { stdio: 'ignore', windowsHide: true, env: { ...process.env, ...(tls ? { WC2_BRIDGE_HTTPS: '1' } : {}) } });
    bridgeProc.on('exit', () => { bridgeProc = null; });
  }
  for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 150)); if (await bridgeAlive()) return { ok: true, started: true }; }
  return { ok: false, error: '桥进程启动超时' };
};
process.on('exit', () => { try { bridgeProc?.kill(); } catch (e) {} });
// 本机模式下随游戏服务一起启动对战桥(监听 0.0.0.0)，iPhone 等设备不必依赖电脑端页面去拉起
if (!WEB_BASE) setTimeout(() => { ensureBridge().catch(() => {}); }, 1500);

// 把 /remote/* 转发给公网游戏服务器(仅作为客户端访问，不改动它)：https 页面不能直接请求 http 的公网服务器
const REMOTE = { host: process.env.WC2_REMOTE_HOST || '208.87.207.49', port: Number(process.env.WC2_REMOTE_PORT || 8643) };
function proxyRemote(req, res) {
  const headers = { ...req.headers, host: `${REMOTE.host}:${REMOTE.port}` }; delete headers.origin; delete headers.referer;
  const up = http.request({ ...REMOTE, path: req.url.slice('/remote'.length), method: req.method, headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', e => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: '无法连接公网服务器：' + e.message })); });
  req.pipe(up);
}
function proxyRemoteUpgrade(req, socket, head) {
  const up = require('net').connect(REMOTE.port, REMOTE.host, () => {
    const headers = { ...req.headers, host: `${REMOTE.host}:${REMOTE.port}` }; delete headers.origin;
    const CRLF = String.fromCharCode(13, 10);
    up.write(`${req.method} ${req.url.slice('/remote'.length)} HTTP/1.1` + CRLF + Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join(CRLF) + CRLF + CRLF);
    if (head?.length) up.write(head); socket.pipe(up); up.pipe(socket);
  });
  up.on('error', () => socket.destroy()); socket.on('error', () => up.destroy());
}
const hotUpdater = require('./tools/hot_update.cjs')(__dirname, MIME);
const handler = (req, res) => {
  if (!WEB_BASE && hotUpdater.handle(req, res, req.url.split('?')[0])) return;
  if (!WEB_BASE && req.url.startsWith('/remote/')) return proxyRemote(req, res);
  let urlPath = req.url.split('?')[0];
  if (WEB_BASE) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (urlPath === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('User-agent: *\nDisallow: /\n');
    }
    if (urlPath === WEB_BASE.slice(0, -1)) { res.writeHead(302, { Location: WEB_BASE }); return res.end(); }
    if (urlPath.startsWith(WEB_BASE)) urlPath = '/' + urlPath.slice(WEB_BASE.length);
    else {
      let permittedApi = false;
      try {
        const ref = new URL(req.headers.referer || '');
        permittedApi = urlPath.startsWith('/api/') && ref.host === req.headers.host && ref.pathname.startsWith(WEB_BASE);
      } catch (e) {}
      if (!permittedApi) { res.writeHead(404); return res.end(); }
    }
  }
  if (AuthStore.handle(req, res, urlPath)) return;

  // API 路由
  if (urlPath === '/api/bridge/ensure' && req.method === 'POST') {
    if (WEB_BASE) { res.writeHead(404); return res.end(); }
    return ensureBridge().then(r => { res.writeHead(r.ok ? 200 : 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r)); });
  }
  if (urlPath === '/api/assets') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(listAssets(ASSETS)));
  }

  // 性能监控：战斗页把慢帧 / 慢事件的记录定期写到 data/perf_report.json
  if (urlPath === '/api/perf' && req.method === 'POST') {
    let body = ''; req.on('data', d => body += d); req.on('end', () => { try { fs.writeFileSync(path.join(DATA, 'perf_report.json'), body); } catch (e) {} res.writeHead(200); res.end('ok'); });
    return;
  }

  if (urlPath === '/api/debug-log' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }

  // 摆件：Accessories 目录里的全部 PNG（游戏暂停页 > 摆件 自动加载）
  if (urlPath === '/api/accessories') {
    const dir = path.join(ASSETS, 'Accessories');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.png$/i.test(f)).sort() : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(files));
  }

  // 领袖立绘：每个国旗代码有几套人像可选（<flag>_front.png 是第 1 套，<flag>_front_v2.png / _v3.png ... 是额外的备选套），
  // 供 render/leaders.js 的 loadLeaders() 每次进对局随机挑一套。同一国旗的三个朝向（front/left/right）套数以最多的为准。
  if (urlPath === '/api/leaders') {
    const dir = path.join(ROOT, 'leaders');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.png$/i.test(f) && !f.endsWith('.prev.png')) : [];
    const counts = {};
    for (const f of files) {
      const m = /^([a-z0-9]+)_(front|left|right)(?:_v(\d+))?\.png$/i.exec(f);
      if (!m) continue;
      const [, flag, , v] = m, n = v ? +v : 1;
      counts[flag] = Math.max(counts[flag] || 0, n);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(counts));
  }

  if (urlPath === '/api/desktops') {
    const desktopDir = path.join(ASSETS, 'desktop');
    if (!fs.existsSync(desktopDir)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('[]');
    }
    const files = fs.readdirSync(desktopDir).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
    const items = files.map(file => ({
      id: path.parse(file).name,
      file: file === 'desktop_cowhide_brown_aged_2x.png'
        ? 'assets/desktop/variants/desktop_cowhide_brown_smooth.png'
        : `assets/desktop/${file}`,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(items));
  }

  if (urlPath === '/api/logs') {
    if (req.method === 'GET') {
      return fs.readFile(GAME_LOGS, (e, d) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(e ? '{}' : d);
      });
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', d => (body += d));
      req.on('end', () => {
        try {
          const input = JSON.parse(body);
          const all = input.clear
            ? {}
            : (() => {
                try {
                  return JSON.parse(fs.readFileSync(GAME_LOGS, 'utf8'));
                } catch (e) {
                  return {};
                }
              })();
          if (!input.clear && input.gameId && Array.isArray(input.entries)) {
            all[input.gameId] = {
              schemaVersion: input.schemaVersion || 2,
              gameId: input.gameId,
              stage: input.stage || '',
              syncedAt: input.syncedAt || new Date().toISOString(),
              entries: input.entries
            };
          } else if (!input.clear && input.gameId && input.entry) {
            const item = all[input.gameId] || {
              schemaVersion: input.schemaVersion || 2,
              gameId: input.gameId,
              stage: input.stage || '',
              entries: []
            };
            if (!item.entries.some(x => x.id === input.entry.id)) item.entries.push(input.entry);
            all[input.gameId] = item;
          }
          fs.mkdirSync(DATA, { recursive: true });
          fs.writeFileSync(GAME_LOGS, JSON.stringify(all, null, 2));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, gameId: input.gameId || null }));
        } catch (e) {
          res.writeHead(400);
          res.end('bad json');
        }
      });
      return;
    }
  }

  const store = { '/api/aiconfig': 'ai_config.json', '/api/settings': 'settings.json', '/api/game-config': 'game_config.json' }[urlPath];
  if (urlPath.startsWith('/api/layouts')) {
    const dir = path.join(DATA, 'layouts');
    const [pth, qs] = req.url.split('?');
    const raw = decodeURIComponent(pth.slice('/api/layouts'.length).replace(/^\//, ''));
    const name = raw.replace(/[^0-9A-Za-z_一-鿿 -]/g, '_').replace(/^[.]+/, '_').slice(0, 60);
    const f = path.join(dir, name + '.json');
    if (!name) {
      fs.mkdirSync(dir, { recursive: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(fs.readdirSync(dir).filter(x => x.endsWith('.json')).map(x => x.slice(0, -5))));
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', d => (body += d));
      req.on('end', () => {
        try {
          JSON.parse(body);
        } catch (e) {
          res.writeHead(400);
          return res.end('bad json');
        }
        if (fs.existsSync(f) && !/overwrite=1/.test(qs || '')) {
          res.writeHead(409);
          return res.end('exists');
        }
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(f, body);
        res.writeHead(200);
        res.end('ok');
      });
    } else {
      fs.readFile(f, (e, d) => {
        if (e) {
          res.writeHead(404);
          return res.end();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(d);
      });
    }
    return;
  }

  if (store) {
    const f = path.join(DATA, store);
    if (req.method === 'POST') {
      let body = '';
      req.on('data', d => (body += d));
      req.on('end', () => {
        try {
          JSON.parse(body);
          fs.mkdirSync(DATA, { recursive: true });
          fs.writeFileSync(f, body);
          res.writeHead(200);
          res.end('ok');
        } catch (e) {
          res.writeHead(400);
          res.end('bad json');
        }
      });
    } else {
      fs.readFile(f, (e, d) => {
        if (e) {
          res.writeHead(404);
          return res.end();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(d);
      });
    }
    return;
  }

  // 静态文件与即时转译引擎
  let rel = decodeURIComponent(urlPath);
  if (rel.endsWith('/')) rel += 'index.html';

  // 1. 关卡请求即时热转译: /data/stages/:name.json
  const stageMatch = rel.match(/^\/data\/stages\/([^/]+)\.json$/);
  if (stageMatch && syncModule) {
    const stageName = stageMatch[1];
    const xmlFile = path.join(ASSETS, `${stageName}.xml`);
    const jsonFile = path.join(REMAKE_DATA, 'stages', `${stageName}.json`);

    // 如果 XML 存在，且比 JSON 更新或 JSON 不存在，即时转译
    let shouldSync = false;
    if (fs.existsSync(xmlFile)) {
      if (!fs.existsSync(jsonFile)) {
        shouldSync = true;
      } else {
        const xStat = fs.statSync(xmlFile);
        const jStat = fs.statSync(jsonFile);
        if (xStat.mtimeMs > jStat.mtimeMs) shouldSync = true;
      }
    }

    if (shouldSync) {
      try {
        syncModule.syncStage(stageName);
      } catch (err) {
        console.error('即时转译关卡失败:', err);
      }
    }
  }

  // 2. 地图数据即时热转译: /data/areas.json
  if (rel === '/data/areas.json' && syncModule) {
    const areaBin = path.join(ASSETS, 'area1.bin');
    const areasJson = path.join(REMAKE_DATA, 'areas.json');
    if (fs.existsSync(areaBin)) {
      if (!fs.existsSync(areasJson) || fs.statSync(areaBin).mtimeMs > fs.statSync(areasJson).mtimeMs) {
        try {
          syncModule.syncMapData(1);
        } catch (err) {
          console.error('即时转译地图失败:', err);
        }
      }
    }
  }

  // 路由基准映射
  const base = rel.startsWith('/assets/') ? ASSETS : rel.startsWith('/data/') ? REMAKE_DATA : ROOT;
  const requested = base === ASSETS ? rel.slice('/assets/'.length) : base === REMAKE_DATA ? rel.slice('/data/'.length) : rel.slice(1);
  const p = path.resolve(base, requested);

  if (!p.startsWith(base + path.sep) && p !== base) {
    res.writeHead(403);
    return res.end();
  }

  fs.readFile(p, (err, data) => {
    if (err) {
      if (base === ASSETS) {
        const publicAssetRoot = path.resolve(ROOT, 'assets');
        const publicAsset = path.resolve(publicAssetRoot, requested);
        if (publicAsset.startsWith(publicAssetRoot + path.sep) && fs.existsSync(publicAsset)) {
          return fs.readFile(publicAsset, (publicErr, publicData) => {
            if (publicErr) { res.writeHead(404); return res.end('404 Not Found: ' + rel); }
            res.writeHead(200, {
              'Content-Type': MIME[path.extname(publicAsset).toLowerCase()] || 'application/octet-stream',
              'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
            });
            res.end(publicData);
          });
        }
        const alt = /^desktop[\\/]/.test(requested)
          ? path.resolve(ASSETS, requested.slice('desktop'.length + 1))
          : path.resolve(ASSETS, 'desktop', requested);
        if (fs.existsSync(alt)) {
          return fs.readFile(alt, (err2, data2) => {
            if (!err2) {
              res.writeHead(200, {
                'Content-Type': MIME[path.extname(alt).toLowerCase()] || 'application/octet-stream',
                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', 'Pragma': 'no-cache', 'Expires': '0'
              });
              return res.end(data2);
            }
            res.writeHead(404);
            res.end('404 Not Found: ' + rel);
          });
        }
      }
      if (base === REMAKE_DATA) {
        const pubRoot = path.resolve(path.join(ROOT, 'data'));
        const pub = path.resolve(pubRoot, requested);
        if ((pub === pubRoot || pub.startsWith(pubRoot + path.sep)) && fs.existsSync(pub)) {
          return fs.readFile(pub, (err2, data2) => {
            if (err2) {
              res.writeHead(404);
              return res.end('404 Not Found: ' + rel);
            }
            res.writeHead(200, {
              'Content-Type': MIME[path.extname(pub).toLowerCase()] || 'application/octet-stream',
              'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', 'Pragma': 'no-cache', 'Expires': '0'
            });
            res.end(data2);
          });
        }
      }
      res.writeHead(404);
      return res.end('404 Not Found: ' + rel);
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', 'Pragma': 'no-cache', 'Expires': '0'
    });
    res.end(data);
  });
};

// HTTPS：证书放在 certs/，缺失时用 openssl 生成本机自签证书(含 localhost/127.0.0.1/局域网 IP)；失败则退回 http。WC2_HTTP=1 强制 http。
// 另开一个纯 http 端口(HTTP_PORT，默认 8644)给命令行测试脚本使用。
const HTTP_PORT = Number(process.env.WC2_HTTP_PORT || 8644);
function loadTls() {
  if (process.env.WC2_HTTP === '1') return null;
  const dir = path.join(__dirname, 'certs'), key = path.join(dir, 'localhost-key.pem'), crt = path.join(dir, 'localhost-cert.pem');
  try {
    if (!fs.existsSync(key) || !fs.existsSync(crt)) {
      fs.mkdirSync(dir, { recursive: true });
      const ips = Object.values(require('os').networkInterfaces()).flat().filter(i => i && i.family === 'IPv4').map(i => 'IP:' + i.address);
      const san = ['DNS:localhost', ...new Set(['IP:127.0.0.1', ...ips])].join(',');
      require('child_process').execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-keyout', key, '-out', crt, '-subj', '/CN=localhost', '-addext', 'subjectAltName=' + san], { stdio: 'ignore' });
    }
    return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
  } catch (e) { console.log('HTTPS 证书不可用，退回 http：' + e.message); return null; }
}
const tls = loadTls();
const onUpgrade = (req, socket, head) => { if (!WEB_BASE && req.url.startsWith('/remote/')) proxyRemoteUpgrade(req, socket, head); else socket.destroy(); };
const server = tls ? require('https').createServer(tls, handler) : http.createServer(handler);
if (tls) { const h = http.createServer(handler); h.on('upgrade', onUpgrade); h.listen(HTTP_PORT, HOST, () => console.log(`HTTP(测试脚本用) http://localhost:${HTTP_PORT}/`)); }
server.on('upgrade', onUpgrade);
// 手机预览：WC2_LAN_PREVIEW=1 时另开一个局域网 http 端口(默认 8645)，手机 Safari 直接打开电脑上的开发版页面，改完刷新即可看效果，不用编译安装。
// 只放行只读 GET(静态页面 + 几个资源列表接口) 和 /remote/ 转发；日志/布局写入等本机接口一律拒绝。
if (process.env.WC2_LAN_PREVIEW === '1' && !WEB_BASE) {
  const LAN_PORT = Number(process.env.WC2_LAN_PORT || 8645), allowApi = new Set(['/api/assets', '/api/accessories', '/api/leaders', '/api/desktops']);
  const lan = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    if (p.startsWith('/remote/')) return proxyRemote(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (p.startsWith('/api/') && !allowApi.has(p)) { res.writeHead(403); return res.end(); }
    return handler(req, res);
  });
  lan.on('upgrade', (req, socket, head) => { if (req.url.startsWith('/remote/')) proxyRemoteUpgrade(req, socket, head); else socket.destroy(); });
  lan.listen(LAN_PORT, '0.0.0.0', () => {
    const ips = Object.values(require('os').networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
    console.log('手机预览(同一 Wi-Fi 下用 Safari 打开)：' + ips.map(ip => `http://${ip}:${LAN_PORT}/`).join('  '));
  });
}

// 维护活动连接以确保退出时彻底释放端口
const activeSockets = new Set();
server.on('connection', socket => {
  activeSockets.add(socket);
  socket.on('close', () => activeSockets.delete(socket));
});

function releasePort() {
  for (const s of activeSockets) {
    try { s.destroy(); } catch (e) {}
  }
  activeSockets.clear();
  try {
    if (server.listening) server.close();
  } catch (e) {}
}

const handleExit = () => {
  releasePort();
  process.exit(0);
};

process.on('SIGINT', handleExit);
process.on('SIGTERM', handleExit);
process.on('SIGBREAK', handleExit);
process.on('exit', () => releasePort());

// 清理占用指定端口的旧残留进程
function killProcessOnPort(port) {
  try {
    const { execSync } = require('child_process');
    const out = execSync(`netstat -ano -p tcp | findstr :${port}`).toString();
    const lines = out.trim().split('\n');
    for (const line of lines) {
      if (line.includes('LISTENING') || line.includes('Listen')) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && pid !== String(process.pid)) {
          console.log(`自动释放端口 ${port}，结束残留进程 PID: ${pid}`);
          execSync(`taskkill /F /PID ${pid}`);
        }
      }
    }
  } catch (e) {}
}

let retried = false;
server.on('error', err => {
  if (err.code === 'EADDRINUSE' && !retried) {
    retried = true;
    killProcessOnPort(PORT);
    setTimeout(() => {
      server.listen(PORT, HOST);
    }, 500);
    return;
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  // 服务启动时确保地图和关卡数据已与 project 保持最新
  if (syncModule) {
    try {
      syncModule.syncAll();
    } catch (e) {}
  }
  const isDebug = process.argv.includes('--debug');
  const url = `${tls ? 'https' : 'http'}://localhost:${PORT}/${isDebug ? '?debug' : ''}`;
  console.log('WC2 remake running at ' + url);
  openWindow(url);
});
