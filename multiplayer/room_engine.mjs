import { gameModule } from './runtime.mjs';
const { Game } = await import(gameModule('game.js'));
const { HqAi } = await import(gameModule('ai/hq/index.js'));
const { beginCountry, endCountry, advanceRound, isDormantNeutral } = await import(gameModule('rules/turn.js'));
const { evaluateEvents } = await import(gameModule('rules/scenario_events.js'));
const { visibilityForCountry } = await import(gameModule('rules/visibility.js'));
const { EV } = await import(gameModule('events.js'));

const copy = value => structuredClone(value);
const walletFields = ['money', 'industry', 'tech', 'stability', 'hand', 'cardCooldowns', 'techTurn', 'ownedCommanders', 'medalLevels'];
const visualEvents = new Set([
  EV.UNIT_MOVED, EV.UNIT_DEPLOYED, EV.UNIT_ATTACKED,
  EV.AREA_CAPTURED, EV.ARMY_FRONTED, EV.CARD_USED,
]);

function walletOf(game) {
  return Object.fromEntries(walletFields.map(key => [key, copy(game[key])]));
}

function switchCountry(room, country) {
  const game = room.game;
  if (game.player === country) return;
  room.wallets[game.player] = walletOf(game);
  const previous = game.stage.countries.get(game.player);
  if (previous) Object.assign(previous, { money: game.money, industry: game.industry, techlevel: game.tech, stability: game.stability });
  game.stage.data.player = country;
  const info = game.stage.countries.get(country);
  const saved = room.wallets[country] || {};
  Object.assign(game, {
    money: saved.money ?? info.money,
    industry: saved.industry ?? info.industry,
    tech: saved.tech ?? info.techlevel,
    stability: saved.stability ?? info.stability ?? 100,
    hand: copy(saved.hand || {}),
    cardCooldowns: copy(saved.cardCooldowns || {}),
    techTurn: saved.techTurn || 0,
    ownedCommanders: copy(saved.ownedCommanders || []),
    medalLevels: copy(saved.medalLevels || {}),
  });
}

export async function startRoom(room, profiles = {}) {
  const host = room.members.find(member => member.userId === room.hostId);
  if (!host?.country) throw new Error('房主尚未选择国家');
  const hostProfile = profiles[host.userId] || {};
  room.game = await Game.create(room.stage, null, {
    ...(room.settings.sandboxConfig?{sandbox:true,sandboxCustom:true,sandboxConfig:room.settings.sandboxConfig,participatingCountries:room.settings.sandboxConfig.countries.map(c=>c.id),freeDiplomacy:true,historicalDiplomacy:false}:{}),
    player: host.country, fogOfWar: !!room.settings.fogOfWar,
    reparationRate: room.settings.reparationRate || 1.8,
    recruitWait: room.settings.recruitWait ?? 0,
    supplyByInfrastructure: room.settings.supplyByInfrastructure !== false,
    ownedCommanders: hostProfile.ownedCommanders || [], medalLevels: hostProfile.medalLevels || {},
    initialRelations: room.settings.initialRelations || {},
    logEnabled: false,
  });
  room.game.humanCountries = new Set(room.members.map(member => member.country).filter(Boolean));
  room.wallets = { [host.country]: walletOf(room.game) };
  for (const member of room.members) {
    if (member.country === host.country) continue;
    const profile = profiles[member.userId] || {};
    room.wallets[member.country] = { ownedCommanders: copy(profile.ownedCommanders || []), medalLevels: copy(profile.medalLevels || {}) };
  }
  room.turnOrder = room.settings.turnOrder?.length ? room.settings.turnOrder : room.game.stage.data.countries.map(c => c.id);
  room.turnIndex = -1;
  room.started = true;
  room.ai = new Map();
  try { await advanceTurn(room); }
  catch (error) {
    room.started = false;
    delete room.game;
    delete room.ai;
    delete room.wallets;
    delete room.turnOrder;
    delete room.turnIndex;
    throw error;
  }
}

export async function restoreRoom(room) {
  room.spectators = [];
  room.settings ||= {};
  if(room.settings.allowSpectators==null)room.settings.allowSpectators=true;
  room.settings.spectatorLimit=Number(room.settings.spectatorLimit)||20;
  if (!room.started || !room.snapshot) return room;
  room.game = await Game.create(room.stage, room.snapshot, { logEnabled: false });
  room.game.humanCountries = new Set(room.members.map(member => member.country).filter(Boolean));
  room.ai = new Map();
  return room;
}

function blockedKey(command) {
  if (command.type === 'useCard') return `card:${command.target}:${command.card}`;
  if (command.type === 'buyCard') return `buy:${command.card}`;
  return `${command.type}:${command.from}:${command.to}:${command.armyId}`;
}

async function runAi(room, country) {
  const ai = room.ai.get(country) || new HqAi();
  room.ai.set(country, ai);
  const blocked = new Set();
  for (let action = 0; action < Math.min(ai.maxActions || 40, 80) && room.game.phase === 'playing'; action++) {
    const command = ai.commandsForTurn(room.game, country, blocked)?.[0];
    if (!command) break;
    const key = blockedKey(command);
    if (blocked.has(key)) break;
    const result = room.game.apply({ ...command, country, aiIssued: true });
    if (room.game.humanCountries?.has(command.second) && !room.game.humanCountries.has(country) &&
        ((command.type === 'setDiplomacy' && ['peace', 'alliance'].includes(command.state)) ||
         (command.type === 'proposeDiplomacy' && ['peace', 'alliance', 'nap'].includes(command.action)))) {
      blocked.add(`consent:${command.type}:${command.first}:${command.second}:${command.state || command.action}`);
    }
    if (!result.ok) {
      blocked.add(key);
      if (command.armyId != null) blocked.add(command.armyId);
    }
  }
}

export async function advanceTurn(room) {
  const game = room.game;
  room.turnDeadlineAt = null;
  if (game.phase === 'finished') return;
  for (let guard = 0; guard < room.turnOrder.length * 2; guard++) {
    const previousIndex = room.turnIndex;
    room.turnIndex = (room.turnIndex + 1) % room.turnOrder.length;
    if (room.turnIndex === 0 && previousIndex >= 0) {
      advanceRound(game);
      if (game.phase === 'finished') return;
      game.emit(EV.ROUND_BEGIN, { round: game.round, income: game.income() });
      evaluateEvents(game, 'roundBegin');
    }
    const country = room.turnOrder[room.turnIndex];
    const human = room.members.some(member => member.country === country);
    if (!game.stage.countries.has(country) || game.stage.countries.get(country).eliminated || (!human && isDormantNeutral(game, country))) continue;
    switchCountry(room, country);
    beginCountry(game, country, !human);
    if (human) {
      game.executeAutoOrders(country, 'turnStart');
      if (game.phase === 'playing' && room.settings.turnSeconds) room.turnDeadlineAt = Date.now() + room.settings.turnSeconds * 1000;
      return;
    }
    await runAi(room, country);
    if (game.phase === 'finished') return;
    endCountry(game, country, true);
  }
  throw new Error('无法找到可行动国家');
}

export async function submitCommand(room, userId, command) {
  if (!room.started || room.game.phase !== 'playing') throw new Error('对局尚未开始或已经结束');
  if (room.paused) throw new Error('联机已暂停，等待房主继续');
  const country = room.turnOrder[room.turnIndex];
  if (!room.members.some(member => member.userId === userId && member.country === country)) throw new Error('还没轮到你的国家');
  if (!command || typeof command !== 'object' || typeof command.type !== 'string') throw new Error('命令格式错误');
  if (command.country && command.country !== country) throw new Error('不能控制其它国家');
  const events = [];
  const stopRecording = room.game.on('*', event => {
    if (visualEvents.has(event.type)) events.push(copy(event));
  });
  try {
    if (command.type === 'endTurn') {
      room.game.executeAutoOrders(country);
      endCountry(room.game, country);
      await advanceTurn(room);
      return { result: { ok: true }, events };
    }
    if (command.type === 'resolveEventDecision' || command.type === 'resolveEventNotice') {
      const pending = room.game.scenarioEvents?.pending?.find(event => event.id === command.eventId);
      if (pending?.targetCountry && pending.targetCountry !== country) throw new Error('这项外交决策属于其它国家');
    }
    const result = room.game.apply({ ...command, country });
    if (!result.ok) throw new Error(result.reason || '命令未通过规则校验');
    return { result, events };
  } finally {
    stopRecording();
  }
}

export function roomVisualEvents(room, country, events, spectator = false) {
  if (!events?.length) return [];
  if (spectator && !country) return events;
  if (!room.game.fogOfWar && !spectator) return events;
  const visible = visibilityForCountry(room.game, country);
  return events.filter(event => ['from', 'to', 'area', 'target']
    .every(key => !Number.isInteger(event[key]) || visible.has(event[key])));
}

function stripSpectatorPrivateState(snapshot) {
  if(snapshot.scenarioEvents)delete snapshot.scenarioEvents.scheduled;
  snapshot.campaignRun=null;
  if(snapshot.sandboxFeatures)delete snapshot.sandboxFeatures.campaign;
  snapshot.sandboxState={intel:{},falseIntel:{}};
  if (snapshot.scenarioEvents?.pending) snapshot.scenarioEvents.pending = snapshot.scenarioEvents.pending.filter(event => !event.targetCountry);
  if (snapshot.scenarioEvents?.definitions) snapshot.scenarioEvents.definitions = snapshot.scenarioEvents.definitions.filter(event => !event.targetCountry);
  snapshot.money = snapshot.industry = snapshot.tech = snapshot.stability = null;
  snapshot.hand = {};
  snapshot.cardCooldowns = {};
  snapshot.techTurn = 0;
  snapshot.ownedCommanders = [];
  snapshot.medalLevels = {};
  snapshot.orders = [];
  snapshot.coordination = { attacks: {}, manual: [] };
  snapshot.armyGroups = snapshot.armyGroups.map(group => Object.fromEntries(Object.entries(group).filter(([key]) => !/order|plan|target|intent/i.test(key))));
  snapshot.theatres = snapshot.theatres.map(theater => Object.fromEntries(Object.entries(theater).filter(([key]) => !/order|plan|target|intent/i.test(key))));
  snapshot.log = [];
  snapshot.gameLog = [];
  snapshot.reportLog = (snapshot.reportLog || []).filter(row => row.category !== 'operation');
  snapshot.replay = null;
  return snapshot;
}

export function spectatorSnapshot(room, followCountry = null) {
  if (!room.started) return null;
  const game = room.game, base = game.snapshot();
  const country = followCountry || room.turnOrder?.[room.turnIndex] || game.player;
  base.player = country;
  if (followCountry) {
    const visible = visibilityForCountry(game, followCountry);
    base.fogOfWar = true;
    base.visibilityMemory = { [followCountry]: copy(game.visibilityMemory?.[followCountry] || {}) };
    base.areas = base.areas.map(area => visible.has(area.id) ? area : { ...area, country: game.visibilityMemory?.[followCountry]?.[area.id]?.country ?? null, armies: [], construction: 'none', installation: 'none', level: 0 });
  } else {
    base.fogOfWar = false;
    base.visibilityMemory = {};
  }
  base.spectator = { readOnly: true, viewCountry: followCountry, omniscient: !followCountry, showUncommittedOrders: false };
  return stripSpectatorPrivateState(base);
}

export function roomSnapshot(room, country) {
  if (!room.started) return null;
  const game = room.game;
  const snapshot = game.snapshot();
  snapshot.campaignRun=null;if(snapshot.sandboxFeatures)delete snapshot.sandboxFeatures.campaign;
  if(snapshot.scenarioEvents){delete snapshot.scenarioEvents.scheduled;if(snapshot.fogOfWar)snapshot.scenarioEvents.definitions=snapshot.scenarioEvents.definitions.filter(e=>snapshot.scenarioEvents.history.includes(e.id)||snapshot.scenarioEvents.pending.some(p=>p.id===e.id));}
  snapshot.sandboxState={activated:copy(game.sandboxState?.activated||{}),holdSince:copy(game.sandboxState?.holdSince||{}),escortIds:copy(game.sandboxState?.escortIds||{}),intel:{[country]:copy(game.sandboxState?.intel?.[country]||[])},falseIntel:{[country]:copy(game.sandboxState?.falseIntel?.[country]||[])}};
  if (snapshot.scenarioEvents?.pending) snapshot.scenarioEvents.pending = snapshot.scenarioEvents.pending.filter(event => !event.targetCountry || event.targetCountry === country);
  if (snapshot.scenarioEvents?.definitions) snapshot.scenarioEvents.definitions = snapshot.scenarioEvents.definitions.filter(event => !event.targetCountry || event.targetCountry === country);
  room.wallets[game.player] = walletOf(game);
  const viewer = room.wallets[country] || {};
  snapshot.player = country;
  snapshot.money = viewer.money ?? game.stage.countries.get(country)?.money ?? 0;
  snapshot.industry = viewer.industry ?? game.stage.countries.get(country)?.industry ?? 0;
  snapshot.tech = viewer.tech ?? game.stage.countries.get(country)?.techlevel ?? 1;
  snapshot.stability = viewer.stability ?? game.stage.countries.get(country)?.stability ?? 100;
  snapshot.hand = copy(viewer.hand || {});
  snapshot.cardCooldowns = copy(viewer.cardCooldowns || {});
  snapshot.techTurn = viewer.techTurn || 0;
  snapshot.ownedCommanders = copy(viewer.ownedCommanders || []);
  snapshot.medalLevels = copy(viewer.medalLevels || {});
  snapshot.countries = snapshot.countries.map(item => item.id === country ? item : { ...item, money: null, industry: null, techlevel: null, cardCooldowns: {} });
  const ownGroupIds = new Set(snapshot.armyGroups.filter(group => group.country === country).map(group => group.id));
  const ownTheaterIds = new Set(snapshot.theatres.filter(theater => theater.country === country).map(theater => theater.id));
  snapshot.armyGroups = snapshot.armyGroups.map(group => group.country === country ? group : Object.fromEntries(Object.entries(group).filter(([key]) => !/order|plan|target|intent/i.test(key))));
  snapshot.theatres = snapshot.theatres.map(theater => theater.country === country ? theater : Object.fromEntries(Object.entries(theater).filter(([key]) => !/order|plan|target|intent/i.test(key))));
  snapshot.orders = snapshot.orders.filter(order => ownGroupIds.has(order.targetId) || ownTheaterIds.has(order.targetId));
  snapshot.coordination = { attacks: {}, manual: [] };
  snapshot.log = [];
  snapshot.gameLog = [];
  snapshot.reportLog = (snapshot.reportLog || []).filter(row => row.category !== 'operation' || row.actors?.includes(country));
  snapshot.replay = null;
  snapshot.visibilityMemory = { [country]: copy(game.visibilityMemory?.[country] || {}) };
  if (snapshot.fogOfWar) {
    const visible = visibilityForCountry(game, country);
    snapshot.areas = snapshot.areas.map(area => visible.has(area.id) ? area : { ...area, armies: [], construction: 'none', installation: 'none', level: 0 });
  }
  return snapshot;
}

export function storedRoom(room) {
  const { game, ai, spectators, ...plain } = room;
  return { ...plain, snapshot: game?.snapshot() || plain.snapshot || null };
}
