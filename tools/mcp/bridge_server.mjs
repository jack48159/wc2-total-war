#!/usr/bin/env node
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
const dumpDir = new URL('../../scratch/ai_lab/bridge_turns/', import.meta.url);
// 每局的回合操作说明(弹幕历史)追加写到磁盘，桥重启也不丢
const histUrl = gid => new URL(`history_${String(gid).replace(/[^\w-]/g, '')}.json`, dumpDir);
const readHistory = gid => { try { return JSON.parse(fs.readFileSync(histUrl(gid), 'utf8')); } catch { return []; } };
const appendHistory = (gid, row) => { try { fs.mkdirSync(dumpDir, { recursive: true }); const list = readHistory(gid); list.push(row); fs.writeFileSync(histUrl(gid), JSON.stringify(list.slice(-400))); } catch {} };
// 战报(看海模式的旁白文稿)：每局一份，agent 在对局结束后写入，浏览器的看海模式取走播放(字幕+配音)
const narrUrl = gid => new URL(`narration_${String(gid).replace(/[^\w-]/g, '')}.json`, dumpDir);
const readNarration = gid => { try { return JSON.parse(fs.readFileSync(narrUrl(gid), 'utf8')); } catch { return null; } };
const dump = (name, value) => { try { fs.mkdirSync(dumpDir, { recursive: true }); fs.writeFileSync(new URL(name, dumpDir), JSON.stringify(value)); } catch {} };

// 默认监听所有网卡，iPhone 等局域网设备才能连上；只要本机用，可设 WC2_BRIDGE_HOST=127.0.0.1
const host = process.env.WC2_BRIDGE_HOST || '0.0.0.0';
const lanAddresses = () => Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
const port = Number(process.env.WC2_BRIDGE_PORT || 8651);
const liveMs = Number(process.env.WC2_BRIDGE_LIVE_MS || 30000);
const games = new Map();
const overs = new Map();   // 已结束的对局 gameId -> { result, round, at }
const turns = new Map();
const overDelivered = new Set();   // 用户模式下，gameOver 对同一会话只送达一次(之后继续等玩家开新局)
let lastPoll = 0;
const origins = new Set(['http://localhost:8642', 'http://127.0.0.1:8642']);
for (const origin of (process.env.WC2_BRIDGE_TEST_ORIGINS || '').split(',').filter(Boolean)) origins.add(origin);
const validId = id => /^WC2-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(id || '');
// 用户 ID：浏览器端固定不变，agent 只绑定用户 ID，对局由桥自动选该用户最新的、带该国席位的在线对战桥对局
const validUser = id => /^WC2U-[A-HJ-NP-Z2-9]{6}$/.test(id || '');
const online = row => !!row && Date.now() - row.seenAt < liveMs;
// 允许：本机游戏页、iOS 应用内页面(capacitor/ionic)、局域网内的页面
const privateHost = h => /^(localhost|127.|10.|192.168.|172.(1[6-9]|2d|3[01]).)/.test(h) || h.endsWith('.local');
const originAllowed = origin => {
  if (origins.has(origin)) return true;
  try { const u = new URL(origin); if (u.protocol === 'capacitor:' || u.protocol === 'ionic:') return true; return (u.protocol === 'http:' || u.protocol === 'https:') && privateHost(u.hostname); } catch { return false; }
};
const reply = (res, code, data, origin) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    ...(origin && originAllowed(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' } : {}) });
  res.end(JSON.stringify(data));
};
async function body(req) {
  let raw = '';
  for await (const part of req) { raw += part; if (raw.length > 8_000_000) throw new Error('请求过大'); }
  return JSON.parse(raw || '{}');
}
const latestGameOf = (userId, country) => [...games.values()].filter(g => g.userId === userId && online(g) && (!country || g.seats?.has(country)))
  .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || b.seenAt - a.seenAt)[0] || null;
const pending = (gameId, country) => [...turns.values()].find(t => t.gameId === gameId && (!country || t.country === country) && t.state === 'pending');
const seatOnline = s => !!s && !!s.sessionId && (Date.now() - (s.lastHeartbeat || 0) < liveMs);
const viewSeat = s => ({
  country: s.country,
  name: s.name || '',
  status: s.status === 'fallback' ? 'fallback' : (seatOnline(s) ? s.status : 'offline'),
  online: seatOnline(s),
  lastHeartbeat: s.lastHeartbeat || 0
});
const view = row => {
  const seats = [...(row.seats?.values() || [])].map(viewSeat);
  const controlled = row.controlled || (row.opponentCountry ? [{ country: row.opponentCountry, name: '' }] : []);
  return {
    gameId: row.gameId, stage: row.stage, controlled,
    opponentCountry: controlled[0]?.country || row.opponentCountry || '',
    playerCountry: row.playerCountry, round: row.round, createdAt: row.createdAt, seenAt: row.seenAt,
    seats,
    pending: [...turns.values()].some(t => t.gameId === row.gameId && t.state === 'pending')
  };
};

process.on('uncaughtException', e => console.error('[WC2 bridge] uncaughtException', e));
process.on('unhandledRejection', e => console.error('[WC2 bridge] unhandledRejection', e));
const handler = async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !originAllowed(origin)) return reply(res, 403, { error: '来源不允许' });
  if (req.method === 'OPTIONS') return reply(res, 200, {}, origin);
  const url = new URL(req.url, `http://${host}:${port}`);
  try {
    if (url.pathname === '/bridge/register' && req.method === 'POST') {
      const data = await body(req);
      if (!validId(data.gameId)) return reply(res, 400, { error: '对局 ID 格式错误' }, origin);
      const old = games.get(data.gameId);
      if (old && (old.stage !== data.stage || old.playerCountry !== data.playerCountry)) return reply(res, 409, { error: '对局 ID 已被其他对局占用' }, origin);

      let controlled = Array.isArray(data.controlled) && data.controlled.length > 0 ? data.controlled : [];
      if (!controlled.length && data.opponentCountry) controlled = [{ country: data.opponentCountry, name: '' }];

      const seats = old?.seats || new Map();
      for (const item of controlled) {
        const prev = seats.get(item.country);
        seats.set(item.country, {
          country: item.country,
          name: item.name || prev?.name || '',
          status: prev ? (seatOnline(prev) ? prev.status : (prev.status === 'fallback' ? 'fallback' : 'offline')) : 'offline',
          sessionId: prev ? (seatOnline(prev) ? prev.sessionId : null) : null,
          lastHeartbeat: prev?.lastHeartbeat || 0,
          preemptedSessionId: prev?.preemptedSessionId || null
        });
      }

      const row = {
        ...data,
        controlled,
        opponentCountry: controlled[0]?.country || data.opponentCountry || '',
        seats,
        seenAt: Date.now()
      };
      games.set(data.gameId, row);
      return reply(res, 200, { ok: true, game: view(row) }, origin);
    }
    if (url.pathname === '/bridge/heartbeat' && req.method === 'POST') {
      const data = await body(req), row = games.get(data.gameId);
      if (!row) return reply(res, 404, { error: '对局未登记' }, origin);
      row.seenAt = Date.now(); row.round = data.round ?? row.round;
      if (data.country && row.seats?.has(data.country)) {
        const s = row.seats.get(data.country);
        s.lastHeartbeat = Date.now();
      }
      return reply(res, 200, { ok: true }, origin);
    }
    if (url.pathname === '/bridge/attach' && req.method === 'POST') {
      const data = await body(req);
      if (!data.gameId && data.userId) {
        // 按用户 ID 绑定：不要求此刻已有对局，之后每次等回合都会自动跟到该用户最新的对战桥对局
        if (!validUser(data.userId)) return reply(res, 400, { error: '用户 ID 格式错误(应形如 WC2U-XXXXXX)' }, origin);
        const latest = latestGameOf(data.userId, data.country);
        if (!latest) return reply(res, 200, { ok: true, userId: data.userId, country: data.country || null, gameId: null, hint: '用户已绑定，暂无进行中的对战桥对局，等待玩家开局' }, origin);
        data.gameId = latest.gameId;
      }
      const row = games.get(data.gameId);
      if (!row) return reply(res, 404, { error: '找不到该对局 ID' }, origin);
      if (!online(row)) return reply(res, 410, { error: '该对局的浏览器已离线' }, origin);

      let country = data.country;
      const controlled = row.controlled || [];
      if (!country) {
        if (controlled.length === 1) country = controlled[0].country;
        else if (controlled.length > 1) {
          return reply(res, 400, {
            error: '请指定 country',
            candidates: controlled.map(c => ({ country: c.country, name: c.name || '' }))
          }, origin);
        } else {
          return reply(res, 400, { error: '该对局没有受控席位' }, origin);
        }
      }

      const seat = row.seats?.get(country);
      if (!seat) return reply(res, 400, { error: `对局中未找到席位国家：${country}` }, origin);

      const sessionId = data.sessionId || 'session-' + randomBytes(8).toString('hex');
      const isOnline = seatOnline(seat);

      if (isOnline && seat.sessionId !== sessionId) {
        if (!data.force) {
          return reply(res, 409, { error: `席位 ${country} 已有在线会话，不可重复绑定。如需强制接管请指定 force: true` }, origin);
        }
        seat.preemptedSessionId = seat.sessionId;
      }

      // 同一席位换了新会话(MCP 重连/重新绑定)：旧会话领走但没提交的回合立刻放回待领取，不要等心跳过期
      if (seat.sessionId && seat.sessionId !== sessionId) {
        for (const t of turns.values()) if (t.gameId === row.gameId && t.country === country && t.state === 'claimed') t.state = 'pending';
      }
      seat.sessionId = sessionId;
      seat.lastHeartbeat = Date.now();
      if (seat.status !== 'thinking') seat.status = 'attached';
      return reply(res, 200, {
        ok: true,
        gameId: row.gameId,
        country,
        sessionId,
        seat: viewSeat(seat),
        game: view(row)
      }, origin);
    }
    if (url.pathname === '/bridge/fallback' && req.method === 'POST') {
      const data = await body(req), row = games.get(data.gameId);
      if (row && data.country && row.seats?.has(data.country)) {
        const seat = row.seats.get(data.country);
        seat.status = 'fallback';
      }
      if (data.turnId && turns.has(data.turnId)) {
        turns.delete(data.turnId);
      }
      return reply(res, 200, { ok: true }, origin);
    }
    if (url.pathname === '/bridge/games' && req.method === 'GET') {
      return reply(res, 200, { games: [...games.values()].filter(online).map(view) }, origin);
    }
    if (url.pathname === '/bridge/game' && req.method === 'GET') {
      const row = games.get(url.searchParams.get('gameId'));
      if (!row) return reply(res, 404, { error: '找不到该对局 ID' }, origin);
      if (!online(row)) return reply(res, 410, { error: '该对局的浏览器已离线' }, origin);
      return reply(res, 200, { game: view(row) }, origin);
    }
    if (url.pathname === '/bridge/status' && req.method === 'GET') {
      let activeSessions = 0;
      for (const g of games.values()) {
        if (online(g) && g.seats) {
          for (const s of g.seats.values()) {
            if (seatOnline(s)) activeSessions++;
          }
        }
      }
      return reply(res, 200, {
        bridgeOnline: true,
        lanAddresses: lanAddresses(),
        port,
        llmOnline: activeSessions > 0 || (Date.now() - lastPoll < liveMs),
        activeSessions,
        pending: [...turns.values()].filter(t => t.state === 'pending').length,
        games: [...games.values()].filter(online).length
      }, origin);
    }
    if (url.pathname === '/bridge/turn' && req.method === 'POST') {
      const data = await body(req), row = games.get(data.gameId);
      if (!online(row)) return reply(res, 409, { error: '对局未登记或浏览器已离线' }, origin);
      const isControlled = row.controlled?.some(c => c.country === data.country) || data.country === row.opponentCountry;
      if (!isControlled || data.snapshot?.gameId !== data.gameId || data.snapshot?.stage !== row.stage || data.snapshot?.round !== data.round) {
        return reply(res, 400, { error: '对局快照与登记信息不符' }, origin);
      }
      // 幂等：同一对局/国家/回合已有进行中(待领取或已被领取)的回合，直接复用它，不再新建(浏览器重复请求时不会产生第二个回合)
      const existing = [...turns.values()].find(t => t.gameId === data.gameId && t.country === data.country && (t.state === 'pending' || t.state === 'claimed'));
      if (existing && existing.round === data.round) return reply(res, 200, { turnId: existing.turnId, reused: true }, origin);
      if (existing) { turns.delete(existing.turnId); }   // 旧回合(上一轮残留)作废
      overs.delete(data.gameId);   // 同一个对局 ID 重新开始：清掉上一局遗留的“已结束”标记
      for (const k of [...overDelivered]) if (k.startsWith(data.gameId + '|')) overDelivered.delete(k);   // 也要清掉“已送达”记录，否则重开后的 gameOver 送不出去
      const turnId = randomBytes(16).toString('hex');
      turns.set(turnId, { ...data, turnId, state: 'pending', created: Date.now() });

      const seat = row.seats?.get(data.country);
      if (seat) seat.status = 'thinking';

      return reply(res, 200, { turnId }, origin);
    }
    if (url.pathname === '/bridge/next' && req.method === 'GET') {
      lastPoll = Date.now();
      const userId = url.searchParams.get('userId');
      let gameId = url.searchParams.get('gameId');
      const country = url.searchParams.get('country');
      const sessionId = url.searchParams.get('sessionId');
      if (!gameId && userId) gameId = latestGameOf(userId, country)?.gameId || null;
      let row = gameId ? games.get(gameId) : null;

      if (row && country && sessionId && row.seats?.has(country)) {
        const seat = row.seats.get(country);
        if (seat.preemptedSessionId === sessionId && seat.sessionId !== sessionId) {
          return reply(res, 409, { error: '席位已被其他会话抢占' }, origin);
        }
        if (seat.sessionId === sessionId) {
          seat.lastHeartbeat = Date.now();
        }
      }

      // 单次长轮询最多 240 秒(MCP 端循环调用以实现最长 10 分钟的等待)
      // 被领取但会话早已掉线(>2×存活期)的回合重新放回待领取，换个会话也能接着做
      for (const t of turns.values()) {
        if (t.state !== 'claimed' || t.gameId !== gameId) continue;
        const seat0 = games.get(t.gameId)?.seats?.get(t.country);
        if (seat0 && Date.now() - (seat0.lastHeartbeat || 0) > liveMs * 2 && seat0.sessionId !== sessionId) { t.state = 'pending'; }
      }
      const until = Date.now() + Math.min(240000, Math.max(0, Number(url.searchParams.get('timeout') || 20) * 1000));
      while (Date.now() < until) {
        if (userId && !url.searchParams.get('gameId')) {
          // 用户模式：每轮重新选最新对局(玩家中途新开一局也能接上)；旧局若还有未处理回合也先处理
          const live = latestGameOf(userId, country);
          const pend = [...turns.values()].find(t => t.state === 'pending' && games.get(t.gameId)?.userId === userId && (!country || t.country === country));
          // 旧局(已结束或已被更新的对局取代)遗留的待处理回合不再抢先，避免新局切换后卡在死局上
          const pendLive = pend && (!live || pend.gameId === live.gameId || !online(games.get(pend.gameId)) || overs.has(pend.gameId)) ? (live && pend.gameId !== live.gameId ? null : pend) : null;
          const target = pendLive?.gameId || live?.gameId || pend?.gameId;
          if (target && target !== gameId) { gameId = target; row = games.get(gameId); }
        }
        const waitSeat = row && country && sessionId ? row.seats?.get(country) : null;
        if (waitSeat && waitSeat.sessionId === sessionId) waitSeat.lastHeartbeat = Date.now();
        const turn = pending(gameId, country);
        if (!turn && overs.has(gameId) && !(userId && overDelivered.has(gameId + '|' + sessionId))) {
          if (userId) overDelivered.add(gameId + '|' + sessionId);
          return reply(res, 200, { gameOver: true, gameId, ...overs.get(gameId) }, origin);
        }
        if (turn) {
          turn.state = 'claimed';
          const r = games.get(turn.gameId);
          const seat = r?.seats?.get(turn.country);
          if (seat) {
            seat.status = 'thinking';
            if (sessionId && (!seat.sessionId || !seatOnline(seat))) seat.sessionId = sessionId;
            seat.lastHeartbeat = Date.now();
          }
          return reply(res, 200, {
            turn: {
              turnId: turn.turnId,
              gameId: turn.gameId,
              round: turn.round,
              country: turn.country,
              snapshot: turn.snapshot,
              config: turn.config
            }
          }, origin);
        }
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      return reply(res, 200, { waiting: true }, origin);
    }
    if (url.pathname === '/bridge/submit' && req.method === 'POST') {
      const data = await body(req), turn = turns.get(data.turnId);
      if (!turn || turn.state !== 'claimed') return reply(res, 409, { error: '回合不存在或未被领取' }, origin);
      if (!Array.isArray(data.commands) || !data.endStateHash) return reply(res, 400, { error: '缺少命令或状态哈希' }, origin);

      const row = games.get(turn.gameId);
      const seat = row?.seats?.get(turn.country);
      if (seat && data.sessionId && seat.preemptedSessionId === data.sessionId && seat.sessionId !== data.sessionId) {
        return reply(res, 409, { error: '席位已被其他会话抢占' }, origin);
      }

      // 防越权操作校验：不允许出现其他国家的指令
      for (const cmd of data.commands) {
        if (cmd.country && cmd.country !== turn.country) {
          return reply(res, 403, { error: `越权命令被拒绝：命令属于国家 ${cmd.country}，当前席位国家为 ${turn.country}` }, origin);
        }
        if (cmd.actorCountry && cmd.actorCountry !== turn.country) {
          return reply(res, 403, { error: `越权命令被拒绝：命令发起方为 ${cmd.actorCountry}，当前席位国家为 ${turn.country}` }, origin);
        }
      }

      turn.result = {
        commands: data.commands,
        endState: { hash: data.endStateHash, round: turn.round },
        endSnapshot: data.endSnapshot,
        reasons: data.reasons || [],
        notes: Array.isArray(data.notes) ? data.notes.slice(0, 40) : [],
        summary: data.summary || ''
      };
      turn.state = 'done';
      appendHistory(turn.gameId, { turnId: turn.turnId, round: turn.round, country: turn.country, created: Date.now(), notes: turn.result.notes || [], summary: turn.result.summary || '' });
      dump(`${turn.turnId}.json`, { turnId: turn.turnId, country: turn.country, round: turn.round, snapshot: turn.snapshot, commands: data.commands, endStateHash: data.endStateHash, endSnapshot: data.endSnapshot });
      if (seat) {
        seat.status = 'done';
        seat.lastHeartbeat = Date.now();
      }
      return reply(res, 200, { ok: true }, origin);
    }
    // 某局已完成回合的弹幕历史(浏览器刷新/恢复对局后用它重建弹幕)
    if (url.pathname === '/bridge/history' && req.method === 'GET') {
      const gid = url.searchParams.get('gameId');
      const rows = readHistory(gid);
      return reply(res, 200, { turns: rows.filter(r => !r.kind), says: rows.filter(r => r.kind === 'say') }, origin);
    }
    // 浏览器在对局结束时通知桥；之后 agent 的 wait_turn 会立刻得到 gameOver
    if (url.pathname === '/bridge/gameover' && req.method === 'POST') {
      const data = await body(req);
      if (!validId(data.gameId)) return reply(res, 400, { error: '对局 ID 格式错误' }, origin);
      overs.set(data.gameId, { result: String(data.result || ''), round: data.round ?? null, at: Date.now() });
      for (const k of [...overDelivered]) if (k.startsWith(data.gameId + '|')) overDelivered.delete(k);   // 新的一局结束：允许重新送达
      return reply(res, 200, { ok: true }, origin);
    }
    // 战报：POST 写入 {gameId, title, intro, items:[{round,title,text}], outro, voice:{rate,pitch,gender}}，GET 取回
    if (url.pathname === '/bridge/narration' && req.method === 'POST') {
      const data = await body(req);
      if (!validId(data.gameId)) return reply(res, 400, { error: '对局 ID 格式错误' }, origin);
      const clean = t => String(t || '').trim().slice(0, 2000);
      const items = (Array.isArray(data.items) ? data.items : []).slice(0, 200).map(i => ({ round: Number(i.round) || 0, title: clean(i.title).slice(0, 60), text: clean(i.text) })).filter(i => i.text);
      const doc = { gameId: data.gameId, title: clean(data.title).slice(0, 80), intro: data.intro ? { title: clean(data.intro.title).slice(0, 60), text: clean(data.intro.text) } : null,
        items, outro: data.outro ? { title: clean(data.outro.title).slice(0, 60), text: clean(data.outro.text) } : null,
        voice: data.voice && typeof data.voice === 'object' ? { rate: Number(data.voice.rate) || 0.92, pitch: Number(data.voice.pitch) || 0.8, gender: data.voice.gender === 'female' ? 'female' : 'male' } : { rate: 0.92, pitch: 0.8, gender: 'male' },
        at: Date.now() };
      try { fs.mkdirSync(dumpDir, { recursive: true }); fs.writeFileSync(narrUrl(data.gameId), JSON.stringify(doc)); } catch (e) { return reply(res, 500, { error: '写入失败：' + e.message }, origin); }
      return reply(res, 200, { ok: true, items: items.length }, origin);
    }
    if (url.pathname === '/bridge/narration' && req.method === 'GET') {
      const doc = readNarration(url.searchParams.get('gameId'));
      return reply(res, doc ? 200 : 404, doc || { error: '该局还没有战报' }, origin);
    }
    // agent 发话(弹幕)：写入该局记录，浏览器轮询取走显示；刷新后也能从历史重建
    if (url.pathname === '/bridge/say' && req.method === 'POST') {
      const data = await body(req);
      if (!validId(data.gameId)) return reply(res, 400, { error: '对局 ID 格式错误' }, origin);
      const row = games.get(data.gameId), seat = row?.seats?.get(data.country);
      if (!seat || !data.sessionId || seat.sessionId !== data.sessionId) return reply(res, 403, { error: '弹幕发送席位与会话不匹配' }, origin);
      const visibility = data.visibility ?? 'user';
      if (!['user', 'broadcast', 'direct'].includes(visibility)) return reply(res, 400, { error: '可见范围无效' }, origin);
      const recipients = visibility === 'direct' && Array.isArray(data.recipients) ? [...new Set(data.recipients)] : [];
      if (visibility === 'direct' && (!recipients.length || recipients.some(c => !row.seats.has(c) || c === data.country))) return reply(res, 400, { error: '定向消息需指定其他 Agent 席位国家' }, origin);
      const text = String(data.text || '').trim().slice(0, 1200);
      if (!text) return reply(res, 400, { error: '内容为空' }, origin);
      const rows = readHistory(data.gameId), id = rows.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
      appendHistory(data.gameId, { kind: 'say', id, created: Date.now(), country: data.country || '', label: String(data.label || '').slice(0, 20), text, visibility, recipients });
      return reply(res, 200, { ok: true, id, visibility, recipients }, origin);
    }
    if (url.pathname === '/bridge/says' && req.method === 'GET') {
      const gid = url.searchParams.get('gameId'), since = Number(url.searchParams.get('since') || 0);
      const country = url.searchParams.get('country');
      if (country) {
        const seat = games.get(gid)?.seats?.get(country);
        if (!seat || seat.sessionId !== url.searchParams.get('sessionId')) return reply(res, 403, { error: '弹幕接收席位与会话不匹配' }, origin);
      }
      const says = readHistory(gid).filter(r => r.kind === 'say' && (r.id || 0) > since);
      const visible = r => !country || (r.country !== country && (r.visibility === 'broadcast' || (r.visibility === 'direct' && r.recipients?.includes(country))));
      return reply(res, 200, { says: says.filter(visible), cursor: says.reduce((m, r) => Math.max(m, r.id || 0), since) }, origin);
    }
    if (url.pathname === '/bridge/debug' && req.method === 'POST') {
      const data = await body(req);
      dump(`${String(data.turnId || 'unknown').replace(/[^w-]/g, '')}.browser.json`, data);
      return reply(res, 200, { ok: true }, origin);
    }
    if (url.pathname === '/bridge/cancel' && req.method === 'POST') {
      const data = await body(req), turn = turns.get(data.turnId);
      if (!turn) return reply(res, 404, { error: '找不到回合' }, origin);
      const row = games.get(turn.gameId);
      const seat = row?.seats?.get(turn.country);
      if (seat && seat.status === 'thinking') seat.status = 'attached';
      turns.delete(data.turnId);
      return reply(res, 200, { ok: true }, origin);
    }
    if (url.pathname === '/bridge/result' && req.method === 'GET') {
      const turn = turns.get(url.searchParams.get('turnId'));
      if (!turn) return reply(res, 404, { error: '找不到回合' }, origin);
      const until = Date.now() + Math.min(25000, Math.max(0, Number(url.searchParams.get('timeout') || 20) * 1000));
      while (turn.state !== 'done' && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 150));
      return reply(res, 200, turn.result || { waiting: true }, origin);
    }
    return reply(res, 404, { error: '未知接口' }, origin);
  } catch (error) { return reply(res, 400, { error: error.message }, origin); }
};
// WC2_BRIDGE_HTTPS=1(游戏服务拉起时设置)：同一个端口同时支持 https 与 http(按首字节判断是否 TLS)。
// https 用游戏服务生成的自签证书(certs/)，供 https 页面使用；http 保留给 MCP、测试和旧页面。
let tls = null;
if (process.env.WC2_BRIDGE_HTTPS === '1') {
  try { tls = { key: fs.readFileSync(new URL('../../certs/localhost-key.pem', import.meta.url)), cert: fs.readFileSync(new URL('../../certs/localhost-cert.pem', import.meta.url)) }; } catch { tls = null; }
}
const server = http.createServer(handler);
const secure = tls ? https.createServer(tls, handler) : null;
const badRequest = (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request' + String.fromCharCode(13, 10, 13, 10)); } catch {} };
server.on('clientError', badRequest);
secure?.on('clientError', badRequest);
setInterval(() => { const cutoff = Date.now() - 6 * 3600 * 1000; for (const [id, t] of turns) if (t.state === 'done' && (t.created || 0) < cutoff) turns.delete(id); }, 600000).unref();
if (!secure) server.listen(port, host, () => console.error(`[WC2 bridge] http://${host}:${port}`));
else {
  const mux = net.createServer(socket => {
    socket.once('error', () => {});
    socket.once('data', first => { socket.pause(); socket.unshift(first); (first[0] === 0x16 ? secure : server).emit('connection', socket); process.nextTick(() => socket.resume()); });
  });
  mux.listen(port, host, () => console.error(`[WC2 bridge] http+https://${host}:${port}`));
}
