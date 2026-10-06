import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { WebSocketServer } from 'ws';
import { startRoom, restoreRoom, submitCommand, roomSnapshot, spectatorSnapshot, roomVisualEvents, storedRoom } from './room_engine.mjs';
import { stageDirectory, scenarioDirectory, gameModule } from './runtime.mjs';
const { validateSandbox } = await import(gameModule('sandbox_config.js'));
const { World } = await import(gameModule('world.js'));
const { COUNTRY_NAMES } = await import(gameModule('api/names.js'));
const { getDiplomaticRelation, initDiplomacy, relationKey, relationToString } = await import(gameModule('rules/diplomacy.js'));

const require = createRequire(import.meta.url);
const auth = require('../auth_store.js');
const root = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(root, 'data');
await fs.mkdir(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'multiplayer.sqlite'));
const userDb = new DatabaseSync(path.join(dataDir, 'users.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at INTEGER NOT NULL);`);
const rooms = new Map();
const sockets = new Map();
const queues = new Map();
const changingRooms=new Set();
const ROOM_IDLE_MS=7*24*60*60*1000;
const turnTimers = new Map();
const PORT = Number(process.env.PORT || 8643);
const HOST = process.env.HOST || '0.0.0.0';
const ACCESS_KEY = process.env.ACCESS_KEY || 'DUA5DN8AG4A';
const maxRooms = Number(process.env.MAX_ROOMS || 24);
const assetStages = stageDirectory;

function recruitWait(value) {
  const rounds = Number(value);
  if (!Number.isInteger(rounds) || rounds < 0 || rounds > 8) throw new Error('征兵等待需为 0 至 8 回合');
  return rounds;
}

function turnSeconds(value) {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 3600) throw new Error('回合时限需为 30 至 3600 秒');
  return seconds;
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function cors(req, res) {
  // Bearer tokens are explicitly supplied in headers; no browser cookies are used.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Game-Access, X-WC2-Protocol, X-Asset-Name, X-WC2-Version');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
}
async function bodyOf(req) {
  let body = '';
  for await (const part of req) {
    body += part;
    if (body.length > 8_000_000) throw new Error('请求过大');
  }
  return body ? JSON.parse(body) : {};
}
function supportedCustomVersion(value){const nums=String(value||'').split('.').map(Number);return nums.length===3&&nums.every(Number.isInteger)&&(nums[0]>1||nums[0]===1&&(nums[1]>0||nums[1]===0&&nums[2]>=14));}
function publicRoom(room) {
  const {sandboxConfig,...publicSettings}=room.settings;
  return { id: room.id, name: room.name, stage: room.stage, hostId: room.hostId, started: room.started,
    members: room.members, spectators: (room.spectators || []).map(({ userId, username, viewCountry }) => ({ userId, username, viewCountry })), spectatorCount: room.spectators?.length || 0, settings: publicSettings, turnOrder: room.turnOrder,
    activeCountry: room.started ? room.turnOrder[room.turnIndex] : null,
    round: room.game?.round || room.snapshot?.round || 1,
    phase: room.game?.phase || room.snapshot?.phase || 'lobby', revision: room.revision || 0,
    paused: !!room.paused, turnDeadlineAt: room.turnDeadlineAt || null, serverNow: Date.now() };
}
function send(ws, packet) { if (ws.readyState === 1) ws.send(JSON.stringify(packet)); }
function spectatorOf(room, user) { return (room.spectators || []).find(item => item.userId === user.id); }
function notify(room, message) { for (const ws of sockets.get(room.id) || []) send(ws, { type:'notice', message, roomId:room.id }); }
function publish(room, events = [], eventActor = null, includeActor = false) {
  const clients = sockets.get(room.id);
  if (!clients) return;
  for (const ws of clients) {
    const member = room.members.find(item => item.userId === ws.userId), spectator = spectatorOf(room, { id:ws.userId });
    if (!member && !spectator) continue;
    const country=member?.country||spectator?.viewCountry||null, watching=!!spectator;
    send(ws, { type: 'room', role:watching?'spectator':'player', room: publicRoom(room), snapshot: room.started ? (watching?spectatorSnapshot(room,country):roomSnapshot(room,country)) : null,
      events: ws.userId !== eventActor || includeActor ? roomVisualEvents(room, country, events, watching) : [] });
  }
}
function save(room) {
  db.prepare('INSERT INTO rooms (id,body,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at')
    .run(room.id, JSON.stringify(storedRoom(room)), Date.now());
}
function change(room, work) {
  const pending = (queues.get(room.id) || Promise.resolve()).catch(() => {}).then(async () => {
    if (rooms.get(room.id) !== room) throw new Error('房间不存在');
    changingRooms.add(room.id);let result;try{result=await work();}finally{changingRooms.delete(room.id);}
    if (result?.skipChange) { scheduleTurnTimer(room); return result; }
    if (result?.dissolve) {
      db.prepare('DELETE FROM rooms WHERE id=?').run(room.id);
      rooms.delete(room.id);
      clearTimeout(turnTimers.get(room.id)); turnTimers.delete(room.id);
      for (const ws of sockets.get(room.id) || []) { send(ws, { type: 'roomClosed', roomId: room.id, reason: '房主已解散房间' }); ws.close(); }
      sockets.delete(room.id);
      return { ok: true };
    }
    if (room.game?.phase === 'finished') room.turnDeadlineAt = null;
    if(room.game?.phase==='finished'&&room.spectators?.length){
      const ids=new Set(room.spectators.map(item=>item.userId));
      for(const ws of sockets.get(room.id)||[])if(ids.has(ws.userId)){send(ws,{type:'roomClosed',roomId:room.id,reason:'对局已结束，观战已关闭'});ws.close();}
      room.spectators=[];
    }
    room.revision = (room.revision || 0) + 1;
    save(room);
    publish(room, result?.events, result?.eventActor, result?.includeActor);
    scheduleTurnTimer(room);
    return result;
  });
  queues.set(room.id, pending);
  pending.finally(()=>{if(queues.get(room.id)===pending)queues.delete(room.id);}).catch(()=>{});
  return pending;
}
function roomExpired(room,now=Date.now()){return now-(room.lastPlayedAt||room.createdAt||now)>=ROOM_IDLE_MS;}
function expireRooms(){const now=Date.now();for(const room of rooms.values()){if(changingRooms.has(room.id)||!roomExpired(room,now))continue;db.prepare('DELETE FROM rooms WHERE id=?').run(room.id);rooms.delete(room.id);clearTimeout(turnTimers.get(room.id));turnTimers.delete(room.id);queues.delete(room.id);for(const ws of sockets.get(room.id)||[]){send(ws,{type:'roomClosed',roomId:room.id,reason:'房间连续 7 天无人游玩，已自动销毁'});ws.close();}sockets.delete(room.id);}}
function scheduleTurnTimer(room) {
  clearTimeout(turnTimers.get(room.id));
  turnTimers.delete(room.id);
  const deadline = room.started && !room.paused && room.game?.phase === 'playing' && room.settings.turnSeconds && room.turnDeadlineAt;
  if (!deadline) return;
  const timer = setTimeout(() => {
    turnTimers.delete(room.id);
    if (room.turnDeadlineAt !== deadline) return;
    change(room, async () => {
      if (room.turnDeadlineAt !== deadline || room.paused || room.game.phase !== 'playing' || Date.now() < deadline) return { skipChange: true };
      const country = room.turnOrder[room.turnIndex];
      const member = room.members.find(item => item.country === country);
      if (!member) return { skipChange: true };
      const { events } = await submitCommand(room, member.userId, { type: 'endTurn' });
      return { events, includeActor: true };
    }).catch(error => {
      console.error('Turn timer failed:', error);
      setTimeout(() => scheduleTurnTimer(room), 1000);
    });
  }, Math.max(0, deadline - Date.now()));
  turnTimers.set(room.id, timer);
}
function memberOf(room, user) { return room.members.find(item => item.userId === user.id); }
function stageName(value) { return typeof value === 'string' && /^(?:(?:battle|conquest)_[a-z0-9_]+|sandbox_world)$/.test(value) ? value : null; }
async function stageData(name) {
  const data = JSON.parse(await fs.readFile(path.join(assetStages, `${name}.json`), 'utf8'));
  let diplomacy = data.diplomacy || null;
  if (name.startsWith('conquest_')) {
    try {
      const scenario = JSON.parse(await fs.readFile(path.join(scenarioDirectory, `${name}.json`), 'utf8'));
      diplomacy = scenario.diplomacy || diplomacy;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { data, diplomacy };
}
function stageSummary(name, data, diplomacy) {
  const countries = data.countries.map(country => ({ id: country.id, flag: country.flag,
    name: COUNTRY_NAMES[country.id] || COUNTRY_NAMES[country.flag] || (country.name && country.name !== country.id ? country.name : country.id) }));
  const byId = new Map(data.countries.map(country => [country.id, country]));
  const game = { diplomacy: initDiplomacy(diplomacy), stage: { countries: byId, alliance: id => byId.get(id)?.alliance } };
  const initialRelations = {};
  for (let i = 0; i < countries.length; i++) for (let j = i + 1; j < countries.length; j++) {
    const first = countries[i].id, second = countries[j].id;
    initialRelations[relationKey(first, second)] = relationToString(getDiplomaticRelation(game, first, second));
  }
  return { id: name, countries, player: data.player, initialRelations };
}
function validInitialRelations(input, countries) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('初始外交关系格式错误');
  const ids = countries.map(country => country.id), valid = new Set();
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) valid.add(relationKey(ids[i], ids[j]));
  const relations = {};
  for (const [key, value] of Object.entries(input)) {
    if (!valid.has(key) || !['war', 'peace', 'alliance'].includes(value)) throw new Error('初始外交关系无效');
    relations[key] = value;
  }
  return relations;
}

for (const row of db.prepare('SELECT id,body,updated_at FROM rooms').all()) {
  try { const saved=JSON.parse(row.body);saved.lastPlayedAt??=row.updated_at;saved.createdAt??=row.updated_at;if(roomExpired(saved)){db.prepare('DELETE FROM rooms WHERE id=?').run(row.id);continue;}const room = await restoreRoom(saved); rooms.set(room.id, room);save(room); }
  catch (error) { console.error('Failed to restore room:', error); }
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (req.method === 'GET' && /^\/api\/library\/files\/[0-9a-f-]{36}$/.test(new URL(req.url, 'http://localhost').pathname) && auth.handle(req,res,new URL(req.url,'http://localhost').pathname)) return;
  if (req.headers['x-game-access'] !== ACCESS_KEY) return json(res, 404, { error: 'Not found' });
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, rooms: rooms.size });
  if (url.pathname === '/api/mp/version') return json(res, 200, { protocol: 'wc2-1' });
  if (url.pathname.startsWith('/api/mp/') && req.headers['x-wc2-protocol'] && req.headers['x-wc2-protocol'] !== 'wc2-1') return json(res, 409, { error: '游戏规则版本不一致，请回到首页更新后再联机。', code: 'version_mismatch' });
  if (auth.handle(req, res, url.pathname)) return;
  const user = auth.userFor(req);
  if (!user) return json(res, 401, { error: '请先登录' });
  try {
    if (url.pathname === '/api/mp/stages' && req.method === 'GET') {
      const names = (await fs.readdir(assetStages)).filter(name => /^(battle|conquest)_[a-z0-9_]+\.json$/.test(name));
      const stages = await Promise.all(names.map(async name => {
        const id = name.slice(0, -5), { data, diplomacy } = await stageData(id);
        return stageSummary(id, data, diplomacy);
      }));
      return json(res, 200, { stages });
    }
    if(url.pathname.startsWith('/api/mp/rooms'))expireRooms();
    if (url.pathname === '/api/mp/rooms' && req.method === 'GET')
      return json(res, 200, { rooms: [...rooms.values()].filter(room => !room.settings.private).map(publicRoom) });
    if (url.pathname === '/api/mp/rooms' && req.method === 'POST') {
      if (rooms.size >= maxRooms) throw new Error('房间数量已达上限');
      const input = await bodyOf(req), stage = stageName(input.stage);
      if (!stage) throw new Error('关卡名称无效');
      let data = JSON.parse(await fs.readFile(path.join(assetStages, `${stage}.json`), 'utf8'));
      const custom=input.sandboxConfig;if(custom){if(input.customContentEnabled!==true||custom.stage!==stage)throw Error('房主必须明确启用此沙盒配置');await World.load();if(data.mapPatch)World.applyPatch(data.mapPatch,data.mirror);validateSandbox(custom);if(custom.features?.campaign?.chapters?.length)throw Error('连续战役请在单人模式游玩；可复制单章创建联机');data={...data,countries:custom.countries,player:custom.player};}
      const playerLimit = Number(input.playerLimit || 2);
      if (!Number.isInteger(playerLimit) || playerLimit < 2 || playerLimit > Math.min(20, data.countries.length)) throw new Error('真人席位数量无效');
      const id = crypto.randomBytes(4).toString('hex').toUpperCase();
      const room = { id,createdAt:Date.now(),lastPlayedAt:Date.now(), name: String(input.name || `${user.username}的房间`).slice(0, 40), stage,
        hostId: user.id, members: [{ userId: user.id, username: user.username, country: custom?custom.player:null }],
        settings: { playerLimit, turnSeconds: turnSeconds(input.turnSeconds ?? 180), fogOfWar: !!input.fogOfWar, private: !!input.private,
          ...(custom?{sandboxConfig:structuredClone(custom),customContentEnabled:true,configHash:crypto.createHash('sha256').update(JSON.stringify(custom)).digest('hex'),customCountries:custom.countries.map(c=>({id:c.id,flag:c.flag,name:COUNTRY_NAMES[c.id]||c.id,dormant:!!c.dormant})),workName:custom.name}:{}),
          allowSpectators: input.allowSpectators !== false, spectatorLimit: 20,
          reparationRate: Number(input.reparationRate) || 1.8,
          recruitWait: recruitWait(input.recruitWait ?? 0),
          supplyByInfrastructure: input.supplyByInfrastructure !== false,
          initialRelations: validInitialRelations(input.initialRelations || {}, data.countries),
          turnOrder: data.countries.map(c => c.id) }, started: false, revision: 1 };
      rooms.set(id, room); save(room);
      return json(res, 201, { room: publicRoom(room) });
    }
    const match = /^\/api\/mp\/rooms\/([A-F0-9]{8})(?:\/(join|spectate|leave-spectate|spectator-view|country|settings|start|command|pause))?$/.exec(url.pathname);
    if (!match) return json(res, 404, { error: '接口不存在' });
    const room = rooms.get(match[1]);
    if (!room) return json(res, 404, { error: '房间不存在' });
    if(room.settings.customContentEnabled&&!supportedCustomVersion(req.headers['x-wc2-version']))return json(res,409,{error:'此沙盒包含自定义内容，请先更新至 1.0.14 或更高版本',code:'version_mismatch'});
    if (match[2] === 'join' && req.method === 'POST') {
      return json(res, 200, await change(room, async () => {
        if (room.started) throw new Error('对局已开始');
        if (!memberOf(room, user)) {
          if (room.members.length >= room.settings.playerLimit) throw new Error('房间已满');
          room.members.push({ userId: user.id, username: user.username, country: null });
          room.spectators = (room.spectators || []).filter(item => item.userId !== user.id);
        }
        return { room: publicRoom(room) };
      }));
    }
    if (match[2] === 'spectate' && req.method === 'POST') return json(res, 200, await change(room, async () => {
      if (!room.settings.allowSpectators) throw new Error('房主未允许观战');
      if(room.game?.phase==='finished')throw new Error('对局已经结束，无法加入观战');
      if (memberOf(room,user)) throw new Error('参战玩家不能同时作为观战者');
      room.spectators ||= [];
      let spectator=spectatorOf(room,user);
      if(!spectator){if(room.spectators.length>=(room.settings.spectatorLimit||20))throw new Error('观战人数已达上限');spectator={userId:user.id,username:user.username,viewCountry:null};room.spectators.push(spectator);notify(room,`${user.username} 加入观战`);}
      return { room:publicRoom(room),role:'spectator',snapshot:room.started?spectatorSnapshot(room,spectator.viewCountry):null };
    }));
    const member=memberOf(room,user), spectator=spectatorOf(room,user);
    if (!member&&!spectator) return json(res, 403, { code: 'not_in_room', error: '尚未加入房间', hint: '可选择加入席位或观战' });
    if (match[2] === 'leave-spectate' && req.method === 'POST') return json(res,200,await change(room,async()=>{
      if(!spectator)throw new Error('当前不是观战者');room.spectators=room.spectators.filter(item=>item.userId!==user.id);notify(room,`${user.username} 退出观战`);return {room:publicRoom(room)};
    }));
    if (match[2] === 'spectator-view' && req.method === 'POST') return json(res,200,await change(room,async()=>{
      if(!spectator)throw new Error('只有观战者能切换视角');const input=await bodyOf(req),country=input.country==null?null:String(input.country);
      if(country&&!room.game?.stage.countries.has(country))throw new Error('观战视角国家不存在');spectator.viewCountry=country;
      return {room:publicRoom(room),role:'spectator',snapshot:room.started?spectatorSnapshot(room,country):null};
    }));
    if(spectator&&match[2])return json(res,403,{error:'观战者为只读身份，不能执行房间或游戏写操作'});
    if (!match[2] && req.method === 'DELETE') return json(res, 200, await change(room, async () => {
      if (room.hostId !== user.id) throw new Error('只有房主能解散房间');
      return { dissolve: true };
    }));
    if (!match[2] && req.method === 'GET') {
      return json(res, 200, { room: publicRoom(room), role:spectator?'spectator':'player', snapshot: room.started ? (spectator?spectatorSnapshot(room,spectator.viewCountry):roomSnapshot(room,member.country)) : null });
    }
    if (req.method !== 'POST') return json(res, 405, { error: '请求方法错误' });
    const input = await bodyOf(req);
    if (match[2] === 'pause') return json(res, 200, await change(room, async () => {
      if (room.hostId !== user.id) throw new Error('只有房主能暂停联机');
      if (!room.started || room.game.phase !== 'playing') throw new Error('对局尚未开始或已经结束');
      if (typeof input.paused !== 'boolean') throw new Error('暂停状态无效');
      if (room.paused === input.paused) return { skipChange: true, room: publicRoom(room) };
      if (input.paused) {
        room.pausedRemainingMs = room.turnDeadlineAt == null ? null : Math.max(0, room.turnDeadlineAt - Date.now());
        room.turnDeadlineAt = null;
      } else {
        room.turnDeadlineAt = room.settings.turnSeconds ? Date.now() + (room.pausedRemainingMs ?? room.settings.turnSeconds * 1000) : null;
        room.pausedRemainingMs = null;
      }
      room.paused = input.paused;
      return { room: publicRoom(room) };
    }));
    if (match[2] === 'country') return json(res, 200, await change(room, async () => {
      if (room.started) throw new Error('对局已开始');
      const stage = room.settings.sandboxConfig||JSON.parse(await fs.readFile(path.join(assetStages, `${room.stage}.json`), 'utf8'));
      if (!stage.countries.some(c => c.id === input.country && !c.dormant)) throw new Error('国家不存在');
      if (room.members.some(m => m.userId !== user.id && m.country === input.country)) throw new Error('国家已被选择');
      memberOf(room, user).country = input.country;
      return { room: publicRoom(room) };
    }));
    if (match[2] === 'settings') return json(res, 200, await change(room, async () => {
      if (room.hostId !== user.id || room.started) throw new Error('只有房主能修改开局设置');
      if ('name' in input) {
        const name = String(input.name || '').trim();
        if (!name || name.length > 40) throw new Error('房间名称需为 1 至 40 字');
        room.name = name;
      }
      if ('private' in input) room.settings.private = !!input.private;
      if ('allowSpectators' in input) room.settings.allowSpectators = !!input.allowSpectators;
      const order = input.turnOrder;
      if (order) {
        const stage = room.settings.sandboxConfig||JSON.parse(await fs.readFile(path.join(assetStages, `${room.stage}.json`), 'utf8'));
        const actual = stage.countries.map(c => c.id);
        if (!Array.isArray(order) || order.length !== actual.length || new Set(order).size !== actual.length || order.some(id => !actual.includes(id))) throw new Error('国家顺序无效');
        room.settings.turnOrder = order;
      }
      if ('fogOfWar' in input) room.settings.fogOfWar = !!input.fogOfWar;
      if ('recruitWait' in input) room.settings.recruitWait = recruitWait(input.recruitWait);
      if ('supplyByInfrastructure' in input) room.settings.supplyByInfrastructure = !!input.supplyByInfrastructure;
      if ('turnSeconds' in input) room.settings.turnSeconds = turnSeconds(input.turnSeconds);
      if ('playerLimit' in input) {
        const stage = room.settings.sandboxConfig||JSON.parse(await fs.readFile(path.join(assetStages, `${room.stage}.json`), 'utf8'));
        const limit = Number(input.playerLimit);
        if (!Number.isInteger(limit) || limit < Math.max(2, room.members.length) || limit > Math.min(20, stage.countries.length)) throw new Error('真人席位数量无效');
        room.settings.playerLimit = limit;
      }
      if ('reparationRate' in input) {
        const rate = Number(input.reparationRate);
        if (!Number.isFinite(rate) || rate <= 0 || rate > 10) throw new Error('赔款倍率无效');
        room.settings.reparationRate = rate;
      }
      if ('initialRelations' in input) {
        if(room.settings.sandboxConfig)throw Error('沙盒初始外交由作品确定，请编辑作品后重新建房');
        const { data } = await stageData(room.stage);
        room.settings.initialRelations = validInitialRelations(input.initialRelations, data.countries);
      }
      return { room: publicRoom(room) };
    }));
    if (match[2] === 'start') return json(res, 200, await change(room, async () => {
      if (room.hostId !== user.id || room.started) throw new Error('只有房主能开始对局');
      if (room.members.some(m => !m.country)) throw new Error('还有玩家没有选择国家');
      const profiles = {};
      for (const member of room.members) {
        const row = userDb.prepare("SELECT body FROM user_data WHERE user_id=? AND kind='profile'").get(member.userId);
        try { profiles[member.userId] = row ? JSON.parse(row.body) : {}; } catch { profiles[member.userId] = {}; }
      }
      await startRoom(room, profiles);
      room.lastPlayedAt=Date.now();
      return { room: publicRoom(room) };
    }));
    if (match[2] === 'command') {
      if(spectator)return json(res,403,{error:'观战者为只读身份，不能发送任何游戏命令'});
      const outcome = await change(room, async () => {
        if (room.turnDeadlineAt && Date.now() >= room.turnDeadlineAt) {
          const country = room.turnOrder[room.turnIndex];
          const member = room.members.find(item => item.country === country);
          if (member) {
            const { events } = await submitCommand(room, member.userId, { type: 'endTurn' });
            return { timedOut: true, events, includeActor: true };
          }
        }
        const { result, events } = await submitCommand(room, user.id, input.command);
        if(result?.ok)room.lastPlayedAt=Date.now();
        return { result, events, eventActor: user.id, includeActor: input.command?.type === 'endTurn', room: publicRoom(room) };
      });
      if (outcome.timedOut) return json(res, 409, { error: '本回合操作时间已结束' });
      return json(res, 200, outcome);
    }
    return json(res, 404, { error: '接口不存在' });
  } catch (error) {
    console.error(error);
    return json(res, error?.code === 'ENOENT' ? 404 : 400, { error: error.message || '服务器错误' });
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/api/mp/live') return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => {
    let authenticated = false;
    const timer = setTimeout(() => { if (!authenticated) ws.close(1008); }, 5000);
    ws.on('message', raw => {
      if (authenticated) return;
      try {
        const packet = JSON.parse(raw.toString());
        if (packet.type !== 'subscribe' || packet.accessKey !== ACCESS_KEY || !/^[A-F0-9]{8}$/.test(packet.roomId) || !/^[a-f0-9]{64}$/i.test(packet.token)) throw new Error('订阅参数无效');
        expireRooms();const room = rooms.get(packet.roomId);
        if(room?.settings.customContentEnabled&&!supportedCustomVersion(packet.version))throw Error('自定义沙盒需要更新至 1.0.14');
        const user = auth.userFor({ headers: { authorization: `Bearer ${packet.token}` } });
        if (!room || !user) throw new Error('无权进入房间');
        let member=memberOf(room,user), spectator=spectatorOf(room,user);
        if(!member&&!spectator&&packet.spectator===true){
          if(!room.settings.allowSpectators)throw new Error('房主未允许观战');
          room.spectators||=[];if(room.spectators.length>=(room.settings.spectatorLimit||20))throw new Error('观战人数已达上限');
          spectator={userId:user.id,username:user.username,viewCountry:null};room.spectators.push(spectator);notify(room,`${user.username} 重新加入观战`);
        }
        if(!member&&!spectator)throw new Error('无权进入房间');
        authenticated = true; clearTimeout(timer);
        ws.userId = user.id;
        const clients = sockets.get(room.id) || new Set();
        clients.add(ws); sockets.set(room.id, clients);
        const watching=!!spectator,country=member?.country||spectator?.viewCountry||null;
        send(ws, { type: 'room', role:watching?'spectator':'player', room: publicRoom(room), snapshot: room.started ? (watching?spectatorSnapshot(room,country):roomSnapshot(room,country)) : null });
        ws.on('close', () => clients.delete(ws));
      } catch(error) { console.error('WebSocket subscribe rejected:',error.message); ws.close(1008,String(error.message||'订阅失败').slice(0,120)); }
    });
    ws.on('close', () => clearTimeout(timer));
  });
});
server.listen(PORT, HOST, () => console.info(`WC2 multiplayer listening on ${HOST}:${PORT}`));
for (const room of rooms.values()) scheduleTurnTimer(room);
setInterval(expireRooms,15*60*1000).unref();
