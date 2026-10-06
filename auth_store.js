const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive:true });
const db = new DatabaseSync(path.join(dir, 'users.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS user_data (user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,kind));`);

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const passwordHash = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');
const json = (res, status, body) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((resolve,reject) => {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 5_000_000) { reject(new Error('请求过大')); req.destroy(); } });
  req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('JSON 格式错误')); } });
  req.on('error', reject);
});
const userFor = req => {
  const token = /^Bearer ([0-9a-f]{64})$/i.exec(req.headers.authorization || '')?.[1];
  if (!token) return null;
  return db.prepare('SELECT users.id, users.username FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?').get(hash(token),Date.now()) || null;
};
const assetLibrary = require('./asset_library.js')(db,userFor,json);
function handle(req,res,urlPath) {
  if (assetLibrary(req,res,urlPath)) return true;
  if (!urlPath.startsWith('/api/auth/') && !['/api/profile','/api/saves'].includes(urlPath)) return false;
  (async () => {
    try {
      if (urlPath === '/api/auth/register' || urlPath === '/api/auth/login') {
        if (req.method !== 'POST') return json(res,405,{error:'请求方法错误'});
        const {username,password} = await readBody(req);
        if (typeof username !== 'string' || !/^[\p{L}\p{N}_-]{3,24}$/u.test(username) || typeof password !== 'string' || !password.length) return json(res,400,{error:'用户名需 3–24 字，密码不能为空'});
        let user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
        if (urlPath.endsWith('register')) {
          if (user) return json(res,409,{error:'用户名已存在'});
          const salt = crypto.randomBytes(16).toString('hex');
          const id = Number(db.prepare('INSERT INTO users (username,salt,password_hash) VALUES (?,?,?)').run(username,salt,passwordHash(password,salt)).lastInsertRowid);
          user = {id,username};
        } else {
          const computed = passwordHash(password,user?.salt || crypto.randomBytes(16).toString('hex'));
          if (!user || !crypto.timingSafeEqual(Buffer.from(computed,'hex'),Buffer.from(user.password_hash,'hex'))) return json(res,401,{error:'用户名或密码错误'});
        }
        const token = crypto.randomBytes(32).toString('hex');
        db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(hash(token),user.id,Date.now()+30*24*60*60*1000);
        return json(res,200,{token,user:{id:user.id,username:user.username}});
      }
      const user = userFor(req);
      if (!user) return json(res,401,{error:'请先登录'});
      if (urlPath === '/api/auth/me') return json(res,200,{user});
      if (urlPath === '/api/auth/logout') {
        const token = /^Bearer ([0-9a-f]{64})$/i.exec(req.headers.authorization || '')?.[1];
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));
        return json(res,200,{ok:true});
      }
      const kind = urlPath === '/api/profile' ? 'profile' : 'saves';
      if (req.method === 'GET') {
        const row = db.prepare('SELECT body FROM user_data WHERE user_id=? AND kind=?').get(user.id,kind);
        return json(res,200,row ? JSON.parse(row.body) : null);
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res,400,{error:'数据格式错误'});
        db.prepare('INSERT INTO user_data (user_id,kind,body) VALUES (?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET body=excluded.body,updated_at=CURRENT_TIMESTAMP').run(user.id,kind,JSON.stringify(body));
        return json(res,200,{ok:true});
      }
      return json(res,405,{error:'请求方法错误'});
    } catch (error) { if (!res.headersSent) json(res,500,{error:error.message}); }
  })();
  return true;
}
module.exports = {handle, userFor};
