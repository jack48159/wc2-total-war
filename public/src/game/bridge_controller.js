const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newBridgeGameId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const part = (start) => Array.from(bytes.slice(start, start + 4), b => ALPHABET[b % ALPHABET.length]).join('');
  return `WC2-${part(0)}-${part(4)}`;
}

export function bridgeStateHash(game) {
  const snapshot = game.snapshot();
  // Operation explanations and wall-clock log timestamps do not affect simulation state.
  delete snapshot.gameLog; delete snapshot.nextGameLogId;
  delete snapshot.log; delete snapshot.reportLog; delete snapshot.reportRevision;
  delete snapshot.replay; delete snapshot.nextReportId; delete snapshot.visibilityMemory;
  if (snapshot.diplomacy) { delete snapshot.diplomacy.revision; delete snapshot.diplomacy.landHistory; } // landHistory 在回合开始时记录，快照与回放的时机不同
  // 单位朝向：关卡加载/快照恢复时会给缺省朝向的单位补默认值，副本与浏览器实时对局补的时机不同，不参与一致性校验
  for (const area of snapshot.areas || []) for (const army of area.armies || []) delete army.facing;
  for (const country of snapshot.countries || []) delete country.ai;
  const data = JSON.stringify(snapshot);
  let hash = 2166136261;
  for (let i = 0; i < data.length; i++) { hash ^= data.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

import { playerCountryName } from './describe.js';

// 用户 ID：每个浏览器/设备固定一个，agent 只需绑定一次，之后无论开多少局，桥都自动对到该用户最新的对战桥对局
export function bridgeUserId() {
  const key = 'wc2.bridgeUserId';
  try {
    let id = localStorage.getItem(key);
    if (/^WC2U-[A-HJ-NP-Z2-9]{6}$/.test(id || '')) return id;
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    id = 'WC2U-' + Array.from({ length: 6 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
    localStorage.setItem(key, id); return id;
  } catch { return 'WC2U-NOSTOR'.slice(0, 11); }
}

// 保留用户填写的桥地址；本机页面通过游戏服务转发，不另行要求信任桥端口证书。
export function bridgeUrlFor(url) {
  return url || 'http://127.0.0.1:8651';
}

export function bridgeTransportUrl(url) {
  const address = bridgeUrlFor(url).replace(/\/$/, '');
  try {
    const bridge = new URL(address);
    const loopback = host => /^(localhost|127\.0\.0\.1)$/.test(host);
    if (loopback(location.hostname) && ['8642', '8644'].includes(location.port)
        && loopback(bridge.hostname) && bridge.port === '8651'
        && /^https?:$/.test(bridge.protocol) && bridge.pathname === '/') {
      return `${location.origin}/api/bridge`;
    }
  } catch {}
  return address;
}

export function bridgePrompt({ country, countryName, stage, player, url }) {
  const userId = bridgeUserId();
  const cName = countryName ? `${countryName}（${country}）` : country;
  return `请使用 wc2-mcp-commander skill，进入桥接对战模式，接管我正在进行的对战桥对局里的席位国家：${cName}。
用户ID：${userId}
接管国家：${country}（${countryName || ''}，当前关卡：${stage}，玩家国家：${player}）
桥地址：${url}
（本会话只需绑定一次：之后我开新局，桥会自动对到我最新的对战桥对局，无需重新发指令或重启会话。）

【工作循环】
1. 调用 wc2_bridge_attach 绑定用户与席位：wc2_bridge_attach({ user_id: "${userId}", country: "${country}" })
2. 进入每回合循环：
   a. 调用 wc2_bridge_wait_turn 等待轮到本国行动并拉取最新战局快照（返回里的 gameId 是当前对局，可能随新局变化）；
   b. 查看战局视图（wc2_get_strategic_view 等），进行军务决策并下达命令（每个操作须填写真实中文 reason，遵守战争迷雾，严禁越权操作其他国家）；
   c. 决策完毕后调用 wc2_bridge_submit_turn 提交本国行动指令与摘要；
   d. 继续等待下一回合；对局结束(gameOver)后发完感言，继续 wait_turn 等我开下一局。`;
}

export class BridgeController {
  constructor(battle, country) { this.battle = battle; this.country = country; this.maxActions = 1000; }
  get url() { return bridgeTransportUrl(this.battle.bridgeUrl); }
  async request(path, data) {
    const res = await fetch(`${this.url}/bridge/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const value = await res.json(); if (!res.ok) throw new Error(value.error || `HTTP ${res.status}`); return value;
  }
  async register() {
    const g = this.battle.game;
    const countries = this.battle.bridgeCountries || (this.country ? [this.country] : []);
    const controlled = countries.map(c => ({
      country: c,
      name: playerCountryName(c, g?.stage) || c
    }));
    return this.request('register', {
      gameId: g.gameId,
      userId: bridgeUserId(),
      stage: g.name,
      controlled,
      opponentCountry: this.country,
      playerCountry: g.player,
      round: g.round,
      createdAt: this.battle.bridgeCreatedAt
    });
  }
  // 心跳失败(桥重启过、对局记录丢了)时自动重新登记，不让对局从桥上消失
  async heartbeat() {
    try { return await this.request('heartbeat', { gameId: this.battle.game.gameId, round: this.battle.game.round, country: this.country }); }
    catch (error) { return this.register(); }
  }
  async fallback(turnId) {
    return this.request('fallback', { gameId: this.battle.game.gameId, country: this.country, turnId }).catch(() => {});
  }
  async cancel(turnId) {
    return this.request('cancel', { turnId }).catch(() => {});
  }
  async startTurn() {
    const g = this.battle.game;
    await this.register();
    // Only authoritative simulation fields cross the bridge. Draft UI orders stay in the browser.
    const snapshot = g.snapshot();
    const { turnId } = await this.request('turn', { gameId: g.gameId, round: g.round, country: this.country, snapshot, config: { timeoutMinutes: this.battle.bridgeTimeoutMinutes, controlledCountries: [...this.battle.bridgeCountries] } });
    return turnId;
  }
  async result(turnId) {
    const res = await fetch(`${this.url}/bridge/result?turnId=${encodeURIComponent(turnId)}&timeout=20`);
    if (res.status === 404) throw Object.assign(new Error('桥上找不到该回合(桥可能重启过)'), { code: 'turn-lost' });
    if (!res.ok) throw new Error(`桥返回 HTTP ${res.status}`);
    return res.json();
  }
}
