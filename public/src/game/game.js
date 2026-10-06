import { restoreAlliedTransit } from './rules/movement.js';
import { sandboxCards } from './sandbox_features.js';
// The running game: a Stage plus the human player's economy and the turn structure.
// Everything that changes game state goes through Game.apply(command) so that the UI, an AI script, an LLM or an
// MCP client all drive the game the same way (and so a replay / undo log is just the command list).
//
// Implemented now: buyCard. The combat port adds the rest (see COMBAT_SPEC.md).
import { ReplayRecorder } from './replay.js';
import { reportForEvent, savedReportFactKey, resolveDiplomacySource, REPORT_LIMIT } from './report.js';
import { World } from './world.js';
import { areaIncome } from './economy.js';
import { Stage } from './stage.js';
import { cardPrice, cardIndustry, shopCards } from './cards.js';
import { Rng } from './rng.js';
import { Emitter, EV } from './events.js';
import { handlerFor } from './commands.js';
import { armyMaxHp } from './rules/combatModel.js';
import { checkVictory } from './rules/victory.js';
import { defaultControllers, strongAiControllers } from './controllers.js';
import { recordScenarioOccurrence } from './sandbox_conditions.js';
import { initScenarioEvents, evaluateEvents } from './rules/scenario_events.js';
import { initDiplomacy, getDiplomaticRelation, areDiplomaticAllies, canCountryInitiateAttack, canCountryOccupyTerritory, registerDiplomaticHostility, registerDiplomaticOccupation, setDiplomaticRelation, recordWarLoss, warCascade, ensureDiplomacyMeta, stabilityIncomeMultiplier, hasNap, proposeDiplomaticAction } from './rules/diplomacy.js';
import { traitDef } from './rules/national_traits.js';
import { readyCommanders, pruneArmyGroups, groupForArmy, commanderById } from './army_groups.js';
import { describeCountry } from './rules/visibility.js';
import { createTacticalOrderExecutor } from './ai/hq/order_executor.js';
import { isOtFix8Active, EN_ROUTE_MAX_STAGNANT_ROUNDS } from './ai/hq/commander/verb_profile.js';
import './rules/index.js';

export { areaIncome } from './economy.js';

const getJson = url => fetch(url).then(r => r.json());
const LOG_CATEGORY = {
  turnBegin: 'turn', turnEnd: 'turn', roundBegin: 'turn',
  cardBought: 'purchase',
  resources: 'economy',
  unitMoved: 'military', unitDeployed: 'military', areaCaptured: 'military', cardUsed: 'military',
  unitAttacked: 'combat', airStrike: 'combat', unitDamaged: 'combat', unitHealed: 'combat', unitDestroyed: 'combat',
  unitPromoted: 'combat', moraleChanged: 'combat',
  countryDefeated: 'turn', gameOver: 'turn',
  diplomacyChanged: 'turn', stabilityChanged: 'economy', warReparationsPaid: 'economy',
  diplomacyOfferResolved: 'turn', diplomacyPact: 'turn', countryCapitulated: 'turn',
};

function mergeReport(existing, incoming) {
  const scenario = existing.category === 'scenario' ? existing : incoming.category === 'scenario' ? incoming : null;
  const previousDetail = existing.detail || {};
  existing.detail = { ...previousDetail, ...(incoming.detail || {}) };
  if (scenario?.detail?.scenarioText) existing.detail.scenarioText = scenario.detail.scenarioText;
  if (scenario?.detail?.scenarioId) existing.detail.scenarioId = scenario.detail.scenarioId;
  existing.importance = Math.max(existing.importance || 1, incoming.importance || 1);
  if (incoming.source && (!existing.source || existing.source === 'unclassified' || existing.kind === 'offerProposed' || ['offerAccepted', 'offerRejected', 'pactSigned'].includes(incoming.kind))) {
    existing.source = incoming.source;
  }
  if (incoming.category === 'scenario') return existing;
  if (existing.category === 'scenario' || existing.kind === 'offerProposed' || incoming.kind === 'offerRejected') {
    Object.assign(existing, { category: incoming.category, kind: incoming.kind, actors: incoming.actors, text: incoming.text });
  } else if (incoming.kind === 'offerAccepted' && existing.kind === 'pactSigned') {
    existing.text = incoming.text;
  } else if (incoming.kind === 'pactSigned' && existing.kind === 'offerAccepted') {
    existing.kind = 'pactSigned';
  }
  return existing;
}

export class Game {
  // snapshot: what snapshot() returned earlier (restores a saved game)
  // opts.player: the country to play (conquest); a snapshot remembers its own
  static async create(stageName, snapshot = null, opts = {}) {
    const player = (snapshot && snapshot.player) || opts.player || null;
    const commanderLevel = snapshot?.commanderLevel ?? opts.commanderLevel;
    const historicalDiplomacy = snapshot ? (snapshot.historicalDiplomacy ?? true) : (opts.historicalDiplomacy !== false);
    const [stage, camp, cards, conq] = await Promise.all([Stage.load(stageName, snapshot && snapshot.areas, { stageEnabled:snapshot?.stageEnabled, sandboxFeatures:snapshot?.sandboxFeatures, player, commanderLevel, countries: snapshot?.countries, historicalDiplomacy: snapshot ? false : historicalDiplomacy, ...opts, sandboxBattle: snapshot?.sandboxBattle || opts.sandboxBattle, sandboxCustom: snapshot?.sandboxCustom || opts.sandboxCustom, diplomacy: snapshot?.diplomacy || opts.diplomacy }), getJson('data/campaigns.json'), getJson('data/cards.json'), getJson('data/conquests.json'), readyCommanders()]);
    let info = camp.factions.flatMap(f => f.battles.map(b => Object.assign({ faction: f.id }, b))).find(b => stageName === 'battle_' + b.id.replace('-', ''));
    if (stage.data.worldAssembly || opts.sandboxCustom || snapshot?.sandboxCustom) info = { faction: 'conquest', id: stageName, name: opts.sandboxConfig?.name || snapshot?.sandboxTitle || stage.data.name || stageName, conquest: true };
    if (stage.data.mapPatch || stage.data.duel) info = { faction: 'conquest', id: stageName, name: stageName, conquest: true };
    const cq = /^conquest_(\d+)$/.exec(stageName);
    if (!info && cq) { const q = conq.find(x => x.id === +cq[1]); if (q) info = { faction: 'conquest', id: q.id, name: q.name, age: q.region || q.age, year: q.year, conquest: true }; }   // no round limit, no dialogue
    return new Game(stage, { info, labels: camp.labels, cards }, snapshot, opts);
  }

  constructor(stage, meta, snapshot = null, opts = {}) {
    this.sandboxCustom = snapshot?.sandboxCustom || !!opts.sandboxCustom;
    this.sandboxTitle=snapshot?.sandboxTitle||opts.sandboxConfig?.name||stage.data.name;
    this.sandboxBattle = snapshot?.sandboxBattle || opts.sandboxBattle || null;
    this.stage = stage; this.info = meta.info; this.labels = meta.labels; this.cardData = structuredClone(meta.cards);this.cardData.others.push(...sandboxCards(stage.data.sandboxFeatures));
    this.historicalDiplomacy = snapshot ? (snapshot.historicalDiplomacy ?? true) : (opts.historicalDiplomacy !== false);
    const me = stage.countries.get(stage.player);
    this.round = 1; this.money = me.money; this.industry = me.industry; this.tech = me.techlevel; this.hand = {};
    this.activeCountry = snapshot?.activeCountry || stage.player;
    this.turnOrder = snapshot?.turnOrder || opts.turnOrder || 'first';
    this.gameId = snapshot?.gameId || opts.gameId || `${stage.name}:${Date.now()}`;
    this.bridgeOpponentCountry = snapshot?.bridgeOpponentCountry || null;
    this.logEnabled = opts.logEnabled ?? true;
    this.fogOfWar = snapshot ? !!snapshot.fogOfWar : !!opts.fogOfWar;
    const reparationRate = (snapshot || opts).reparationRate;
    this.reparationRate = typeof reparationRate === 'number' && Number.isFinite(reparationRate) && reparationRate > 0 ? reparationRate : 1.8;
    this.supplyByInfrastructure = (snapshot || opts).supplyByInfrastructure ?? !snapshot; // New matches default on; old saves retain fixed supply.
    const rw = Math.round(Number((snapshot || opts).recruitWait)); this.recruitWait = Number.isFinite(rw) ? Math.min(8, Math.max(0, rw)) : 0; // 新占领地需等待的回合数(0=立即征兵)
    this.capturedAt = snapshot?.capturedAt ? { ...snapshot.capturedAt } : {};
    this.visibilityMemory = snapshot?.visibilityMemory ? JSON.parse(JSON.stringify(snapshot.visibilityMemory)) : {};
    this.logSink = opts.logSink || null;
    this.log = snapshot?.log ? JSON.parse(JSON.stringify(snapshot.log)) : []; // successful commands, for replay
    const savedGameLog = snapshot?.gameLog || [], persistedGameLog = opts.initialGameLog || [];
    this.gameLog = JSON.parse(JSON.stringify([...savedGameLog, ...persistedGameLog.filter(a => !savedGameLog.some(b => b.id === a.id))]));
    this.nextGameLogId = snapshot?.nextGameLogId || (this.gameLog.reduce((n, e) => Math.max(n, e.id || 0), 0) + 1);
    const savedReports = Array.isArray(snapshot?.reportLog) ? snapshot.reportLog : [];
    this.reportLog = [];
    for (const saved of savedReports) {
      const row = { ...saved, ...(saved.detail ? { detail: { ...saved.detail } } : {}) };
      const key = savedReportFactKey(row);
      if (key) row.factKey = key;
      const existing = key && this.reportLog.findLast(item => item.factKey === key);
      if (existing) mergeReport(existing, row);
      else this.reportLog.push(row);
    }
    this.reportLog = this.reportLog.slice(-REPORT_LIMIT);
    this.nextReportId = Math.max(snapshot?.nextReportId || 1, savedReports.reduce((n, e) => Math.max(n, e.id || 0), 0) + 1);
    this.reportRevision = snapshot?.reportRevision || 0;
    this.rng = snapshot && snapshot.rng ? Rng.restore(snapshot.rng) : (opts.seed != null ? new Rng(opts.seed) : new Rng());   // all randomness comes from here
    this.events = new Emitter();
    this.events.on(EV.AREA_CAPTURED, e => { const p = e.payload || e; if (p.area != null) this.capturedAt[p.area] = this.round; });
    this.sandboxState=structuredClone(snapshot?.sandboxState||{holdSince:{},intel:{},falseIntel:{},escortIds:{}});
    this.campaignRun=structuredClone(snapshot?.campaignRun||opts.campaignRun||null);
    const campaign=stage.data.sandboxFeatures?.campaign;if(!this.campaignRun&&campaign?.chapters?.length)this.campaignRun={index:0,chapters:[{title:opts.sandboxConfig?.name||stage.data.name,config:null},...campaign.chapters],carry:campaign.carry||{}};
    this.stage.game = this;
    this.diplomacy = initDiplomacy(snapshot?.diplomacy || stage.data?.diplomacy || opts.diplomacy);
    this.scenarioEvents = initScenarioEvents(snapshot?.scenarioEvents || stage.data?.scenarioEvents || stage.data?.events || opts.scenarioEvents);
    if (this.diplomacy?.enabled || this.name.startsWith('battle_')) ensureDiplomacyMeta(this);
    const useStrong = opts.strongAi || (opts.takeoverScheme === 0) || (typeof window !== 'undefined' && window.E?.aiConfig?.scheme === 0);
    this.controllers = opts.controllers || (useStrong ? strongAiControllers(stage) : defaultControllers(stage));
    this.phase = snapshot?.phase || 'playing';                   // see COMBAT_SPEC.md: turn state machine
    this.result = snapshot?.result || null;
    this.medalLevels = { ...(snapshot?.medalLevels || opts.medalLevels || {}) };
    this.cardCooldowns = { ...(snapshot?.cardCooldowns || {}) };
    this.techTurn = snapshot?.techTurn || 0;
    this.nextArmyId = snapshot?.nextArmyId || 1;
    this.initArmies();
    if(!snapshot)for(const goal of stage.data.sandboxFeatures?.objectives?.goals||[])if(goal.type==='escort')this.sandboxState.escortIds[goal.id]=stage.st(goal.sourceArea)?.armies?.[goal.unitIndex||0]?.id;
    this.armyGroups = JSON.parse(JSON.stringify(snapshot?.armyGroups || []));
    for (const group of this.armyGroups) group.commanderId = commanderById(group.country, group.commanderId)?.id || group.commanderId;
    pruneArmyGroups(this);
    this.nextArmyGroupId = Math.max(snapshot?.nextArmyGroupId || 1, 1 + this.armyGroups.reduce((n, group) => Math.max(n, Number(String(group.id).replace('group_', '')) || 0), 0));
    this.theatres = structuredClone(snapshot?.theatres || []);
    for (const theatre of this.theatres) theatre.marshalId = commanderById(theatre.country, theatre.marshalId)?.id || theatre.marshalId;
    this.nextTheaterId = Math.max(snapshot?.nextTheaterId || 1, 1 + this.theatres.reduce((n, t) => Math.max(n, Number(String(t.id).replace('theater_', '')) || 0), 0));
    this.orders = structuredClone(snapshot?.orders || []);
    this.nextOrderId = snapshot?.nextOrderId || 1;
    this.coordination = structuredClone(snapshot?.coordination || { attacks: {}, manual: [] });
    this.orderExecutor = createTacticalOrderExecutor(this);
    this.ownedCommanders = [...new Set(snapshot?.ownedCommanders || opts.ownedCommanders || [])];
    const playerCountry = this.stage.countries.get(this.stage.player);
    this.stability = snapshot?.stability ?? playerCountry?.stability ?? 100;
    if (playerCountry) playerCountry.stability = this.stability;
    if (snapshot) {
      for (const k of ['round', 'money', 'industry', 'tech', 'stability']) if (snapshot[k] != null) this[k] = snapshot[k];
      if (snapshot.hand) this.hand = JSON.parse(JSON.stringify(snapshot.hand));
    }
    this.replayRecorder = new ReplayRecorder(this, snapshot?.replay);
    this.replay = this.replayRecorder.data;
    this.dialogueIndex = snapshot?.dialogueIndex ?? (snapshot ? (stage.data.extra?.dialogue?.length || 0) : 0);
    if(!snapshot){Object.assign(this.scenarioEvents.variables,opts.campaignVariables||{});this._initializingReports=true;evaluateEvents(this,'gameStart');evaluateEvents(this,'roundBegin');this._initializingReports=false;}
  }

  // Give every army the runtime fields the rules need (armies that already have them, e.g. from a save, are kept).
  initArmies() {
    const st = this.stage; let next = 0;
    for (const a of st.areas) for (const ar of a.armies) if (ar.id != null) next = Math.max(next, ar.id);
    for (const a of st.areas) for (const ar of a.armies) {
      if (ar.id == null) ar.id = ++next;
      const def = st.armyDef(a.country, ar);                 // per-country army table (armydef.xml)
      const country = st.countries.get(a.country);
      if (ar.maxHp == null) ar.maxHp = armyMaxHp(def.maxHp || 100, ar.level, country?.commanderLevel, !!(ar.cards & 8));
      if (ar.hp == null) ar.hp = ar.maxHp;
      ar.maxMovement = def.movement || 0;
      if (ar.movement == null) ar.movement = def.movement || 0;
      if (ar.exp == null) ar.exp = 0;
      if (ar.morale == null) ar.morale = 0;
      if (ar.moraleUpTurn == null) ar.moraleUpTurn = 0;
      if (ar.active == null) ar.active = true;
    }
    this.nextArmyId = Math.max(next + 1, this.nextArmyId);
  }

  // Create a unit with the same runtime fields as scenario-loaded armies.
  // The monotonic id counter is included in snapshots for deterministic replay.
  spawnArmy(area, type, templateId=null) {
    const country = this.stage.countries.get(area.country), def = this.stage.armyDef(area.country, {type,templateId});
    const maxHp = armyMaxHp(def.maxHp || 100, 0, country?.commanderLevel, false);
    const maxMovement = def.movement || 0;
    const army = { id: this.nextArmyId++, type, templateId, level: 0, cards: 0, hp: maxHp, maxHp,
      movement: 0, maxMovement, exp: 0, morale: 0, moraleUpTurn: 0, active: false };
    area.armies.unshift(army);
    return army;
  }

  on(type, fn) { return this.events.on(type, fn); }               // type or '*'
  addReport(entry) {
    try {
      if (!entry?.text || !['diplomacy', 'military', 'scenario', 'operation'].includes(entry.category)) return;
      const opening = !!this._initializingReports && (entry.category === 'diplomacy' || !!entry.factKey);
      const factKey = entry.factKey ? `${opening ? 'opening:' : ''}${entry.factKey}` : null;
      if (factKey) {
        const existing = this.reportLog.findLast(row => row.factKey === factKey);
        if (existing) { this.reportRevision++; return mergeReport(existing, entry); }
      }
      const isDiplo = entry.category === 'diplomacy';
      let source = entry.source;
      if (!source && isDiplo) {
        source = resolveDiplomacySource(entry.detail?.reason, { game: this, actors: entry.actors, first: entry.actors?.[0], second: entry.actors?.[1] }) || 'unclassified';
      }
      const detail = { ...(entry.detail || {}) };
      if (isDiplo && detail.reason == null) {
        detail.reason = source || 'unclassified';
      }
      const row = { id: this.nextReportId++, round: this.round || 1, turnCountry: this.activeCountry || null,
        category: entry.category, kind: entry.kind || 'notice', actors: entry.actors || [], text: entry.text,
        importance: entry.importance || 1, ...(Object.keys(detail).length ? { detail } : {}),
        ...(source ? { source } : {}),
        factKey, ...(opening ? { opening: true } : {}) };
      this.reportLog.push(row);
      this.reportRevision++;
      if (this.reportLog.length > REPORT_LIMIT) {
        const low = Math.min(...this.reportLog.map(item => item.importance || 1));
        this.reportLog.splice(this.reportLog.findIndex(item => (item.importance || 1) === low), 1);
      }
    } catch (error) { console.warn('战报写入失败', error); }
  }
  emit(type, payload = {}) {
    recordScenarioOccurrence(this, type, payload);
    const event = { ...payload, type }, category = LOG_CATEGORY[type];
    if (category && this.logEnabled) this.gameLog.push({
      schemaVersion: 2, id: this.nextGameLogId++, timestamp: new Date().toISOString(),
      gameId: this.gameId, round: this.round, phase: this.phase,
      actorCountry: payload.country || payload.attackerCountry || this.player,
      category, event: type, data: JSON.parse(JSON.stringify(payload)),
    });
    try { const report = reportForEvent(this, type, payload); for (const row of Array.isArray(report) ? report : report ? [report] : []) this.addReport(row); }
    catch (error) { console.warn('战报事件处理失败', type, error); }
    if (type === EV.UNIT_DESTROYED) for (const group of this.armyGroups || []) group.unitIds = (group.unitIds || []).filter(id => id !== payload.armyId);
    this.replayRecorder?.event(event);
    this.events.emit(event);
    if (this.sandboxCustom && !this._applyingCommand && !this._inScenarioEvent && [EV.DIPLOMACY_CHANGED, EV.COUNTRY_DEFEATED, EV.COUNTRY_CAPITULATED, EV.AREA_CAPTURED, EV.RESOURCES_CHANGED, EV.STABILITY_CHANGED, EV.UNIT_DEPLOYED, EV.UNIT_DESTROYED, EV.SCENARIO_EVENT].includes(type)) evaluateEvents(this, 'stateChanged');
  }      // `type` is always the event name, whatever the payload holds
  getGameLog(category = null) {
    const rows = category ? this.gameLog.filter(entry => entry.category === category) : this.gameLog;
    return JSON.parse(JSON.stringify(rows));
  }
  flushGameLog() {
    if (window.GameLogger?.isDebug?.()) console.info('[WC2 log] flushGameLog', { enabled: this.logEnabled, hasSink: !!this.logSink, gameId: this.gameId, entries: this.gameLog.length, round: this.round });
    if (this.logEnabled && this.logSink) this.logSink(this.gameId, {
      flush: true, stage: this.name, entries: this.gameLog,
    });
  }
  findCard(card, country = this.player) {
    if (typeof card === 'object') return card;
    return shopCards(this.cardData, this.stage.countries.get(country)?.flag).find(c => c.id === card);
  }

  get name() { return this.stage.name; }
  get player() { return this.stage.player; }
  get playerInfo() { return this.stage.countries.get(this.stage.player); }
  get totalRounds() { return this.info && this.info.conquest ? null : (this.info && this.info.victory) || 10; }   // null = no limit (conquest)
  handCount() { return Object.values(this.hand).reduce((a, b) => a + b, 0); }

  setOrderExecutor(fn) { this.orderExecutor = typeof fn === 'function' ? fn : createTacticalOrderExecutor(this); }
  setStandingOrder(level, id, order) {
    const old = this.orders.find(o => o.level === level && o.targetId === id && !['cancelled', 'achieved', 'failed'].includes(o.status));
    if (old) old.status = 'cancelled';
    if (order) this.orders.push({ id: 'order_' + this.nextOrderId++, country: level === 'country' ? id : level === 'army' ? this.armyGroups.find(g => g.id === id)?.country : this.theatres.find(t => t.id === id)?.country,
      level, targetId: id, order: structuredClone(order), status: 'progressing', progress: 0, report: null, issuedRound: this.round, auto: true });
  }
  executeOrders({ level, id, mode = 'now' }) {
    if (!['army', 'theater', 'country'].includes(level) || !['now', 'turnStart', 'endTurn'].includes(mode)) return { ok: false, reason: '命令参数无效' };
    const target = level === 'country' ? { country: id } : level === 'army' ? this.armyGroups.find(g => g.id === id) : this.theatres.find(t => t.id === id);
    if (!target || target.country !== this.activeCountry || this.phase !== 'playing') return { ok: false, reason: '不是本国回合或目标不存在' };
    const entry = this.orders.findLast(o => o.level === level && o.targetId === id && o.status !== 'cancelled');
    if (!entry) return { ok: false, reason: '无当前命令' };
    if (entry.paused) return { ok: false, reason: '命令已暂停' };
    const groupIds = level === 'army' ? [id] : target.armyIds || [];
    const allowedArmyIds = new Set(level === 'country' ? this.stage.areas.filter(a => a.country === id).flatMap(a => a.armies.map(u => u.id))
      : this.armyGroups.filter(group => group.country === target.country && groupIds.includes(group.id)).flatMap(group => group.unitIds || []));
    const rejected = [];
    let appliedCount = 0;
    let result = {};
    const maxSteps = entry.order.verb === 'allout' ? Math.min(2000, Math.max(20, allowedArmyIds.size * 24)) : Math.min(40, (level === 'army' ? this.armyGroups.find(g => g.id === id)?.unitIds?.length || 0
      : this.theatres.find(t => t.id === id)?.armyIds?.reduce((n, gid) => n + (this.armyGroups.find(g => g.id === gid)?.unitIds?.length || 0), 0) || 0) * 2 + 2);
    const alloutBefore = entry.order.verb === 'allout' ? {
      own: this.stage.areas.filter(a => a.country === target.country).flatMap(a => a.armies).reduce((n, u) => n + u.hp, 0),
      enemy: this.stage.areas.filter(a => a.country && a.country !== target.country).flatMap(a => a.armies).reduce((n, u) => n + u.hp, 0),
      owned: new Set(this.stage.areas.filter(a => a.country === target.country).map(a => a.id)) } : null;
    let attacks = 0, captures = 0;
    const seenRejectedArmies = new Set();
    const warnings = [];
    for (let step = 0; step < maxSteps; step++) {
      result = this.orderExecutor({ game: this, country: target.country, level, id, order: structuredClone(entry.order), mode }) || {};
      const commands = result.commands || [];
      if (!commands.length) break;
      if (commands.every(c => c.armyId != null && seenRejectedArmies.has(c.armyId))) break;
      let applied = false;
      for (const command of commands) {
        if (command.armyId != null && this.coordination.manual.includes(command.armyId)) {
          rejected.push({ command, reason: 'manual-action-priority' });
          seenRejectedArmies.add(command.armyId);
          continue;
        }
        if (allowedArmyIds.size > 0 && !allowedArmyIds.has(command.armyId)) {
          rejected.push({ command, reason: 'order-outside-target-groups' });
          seenRejectedArmies.add(command.armyId);
          continue;
        }
        this.emit('orderCommandStarting', { command, country: target.country, level, id, mode });
        const outcome = this.apply({ ...command, orderExecution: true });
        if (!outcome.ok) {
          const altMoves = (command.from != null ? this.stage.adjE.get(command.from) || [] : []).filter(id => {
            const a = this.stage.st(id);
            return a && a.armies.length < this.stage.maxArmies(id) && (a.country === target.country || !a.armies.length);
          });
          rejected.push({
            command,
            unitId: command.armyId,
            from: command.from,
            to: command.to,
            reason: outcome.reason,
            alternative: altMoves.length > 0 ? altMoves : null
          });
          if (outcome.reason === 'illegal-target') {
            warnings.push(`单位[${command.armyId}]执行[${command.from}->${command.to}]目标不合法(illegal-target)${altMoves.length ? `，建议替代地块: [${altMoves.slice(0, 3).join(',')}]` : ''}`);
          }
          if (command.armyId != null) seenRejectedArmies.add(command.armyId);
        } else { applied = true; appliedCount++; if (command.type === 'attack') attacks++; }
      }
      if (this.phase === 'finished') break;
      if (commands.length > 1 && !applied) break;
    }
    entry._actionsThisRound = (entry._actionsThisRound || 0) + appliedCount;
    if (entry.order?.expires != null && entry.order.initialExpires == null) entry.order.initialExpires = entry.order.expires;
    if (result.plan) entry.plan = { ...(entry.plan || {}), ...result.plan };
    entry.roundsActive = (entry.roundsActive || 0) + (mode === 'turnStart' || !entry.roundsActive ? 1 : 0);
    warnings.push(...(result.report?.warnings || []));
    if (entry.order.risk > .66) warnings.push('\u672c\u547d\u4ee4\u98ce\u9669\u9ad8\uff1a\u9884\u8ba1\u635f\u5931\u53ef\u80fd\u8f83\u5927');
    entry.report = { ...(result.report || {}), warnings, rejected: [...(result.report?.rejected || []), ...rejected] };
    if (alloutBefore) {
      captures = this.stage.areas.filter(a => a.country === target.country && !alloutBefore.owned.has(a.id)).length;
      const ownAfter = this.stage.areas.filter(a => a.country === target.country).flatMap(a => a.armies).reduce((n, u) => n + u.hp, 0);
      const enemyAfter = this.stage.areas.filter(a => a.country && a.country !== target.country).flatMap(a => a.armies).reduce((n, u) => n + u.hp, 0);
      const remainingMovement = this.stage.areas.filter(a => a.country === target.country).flatMap(a => a.armies)
        .filter(u => allowedArmyIds.has(u.id)).reduce((n, u) => n + Math.max(0, u.movement || 0), 0);
      const summary = `全线总攻：发动${attacks}次攻击，占领${captures}处，己方损失${Math.max(0, alloutBefore.own - ownAfter)}，敌方损失${Math.max(0, alloutBefore.enemy - enemyAfter)}；剩余移动力${remainingMovement}${remainingMovement ? '（无可用的合法行动或达到执行步数上限）' : ''}。`;
      entry.report = { ...entry.report, summary, attacks, captures, ownLoss: Math.max(0, alloutBefore.own - ownAfter), enemyLoss: Math.max(0, alloutBefore.enemy - enemyAfter), remainingMovement,
        warning: '将不计损失全面进攻，直到移动力耗尽，可能造成重大伤亡' };
      this.addReport?.({ category: 'operation', kind: 'allout', actors: [target.country], text: summary, importance: 2 });
    }
    entry.status = ['pending', 'progressing', 'achieved', 'stalled', 'failed', 'cancelled'].includes(entry.report.status) ? entry.report.status : 'progressing';
    entry.progress = Math.max(0, Math.min(1, Number(entry.report.progress) || 0));
    this.replayRecorder?.capture();
    return { ok: true, report: entry.report, appliedCount };
  }
  executeAutoOrders(country = this.activeCountry, mode = 'endTurn') {
    const results=[];
    for(const entry of [...this.orders])if(entry.auto&&!entry.paused&&['pending','progressing','stalled'].includes(entry.status)){
      const target=entry.level==='country'?{country:entry.targetId}:entry.level==='army'?this.armyGroups.find(g=>g.id===entry.targetId):this.theatres.find(t=>t.id===entry.targetId);
      if(target?.country===country){ const execKey = `${this.round}_${mode}`; if (entry._lastExecKey === execKey) continue; entry._lastExecKey = execKey; results.push(this.executeOrders({level:entry.level,id:entry.targetId,mode})); }
    }
    return results;
  }
  expireOrders() {
    const MAX_STALLED_ROUNDS = 3; for (const entry of this.orders) { if (!['pending', 'progressing', 'stalled'].includes(entry.status)) continue;
      if (entry.order.verb === 'allout') {
        entry._actionsThisRound = 0;
        if (entry.order.expires == null || --entry.order.expires <= 0) {
          entry.status = 'achieved';
          entry.report = { ...(entry.report || {}), status: 'achieved' };
        }
        continue;
      }
      const isDefensive = ['defend', 'delay', 'screen'].includes(entry.order.verb);
      const progressGrown = (entry.progress || 0) > (entry._lastProgress || 0) + 0.001;
      const hadActions = (entry._actionsThisRound || 0) > 0;
      let hasProgress = progressGrown || hadActions;
      if (isOtFix8Active(entry.order)) {
        const hasLiveEnRoute = Boolean(entry.plan && Object.values(entry.plan).some(p =>
          p && (p.state === 'en_route' || p.state === 'engaged') && !p.stagnant &&
          p.lastProgressRound != null && (this.round - p.lastProgressRound < EN_ROUTE_MAX_STAGNANT_ROUNDS)
        ));
        hasProgress = progressGrown || (hadActions && hasLiveEnRoute);
      }
      entry._lastProgress = entry.progress || 0;
      entry._actionsThisRound = 0;
      if (hasProgress) {
        entry.noProgressRounds = 0;
        if (entry.status === 'stalled') entry.status = 'progressing';
        if (entry.order.expires != null && entry.order.expires < (entry.order.initialExpires || 3)) entry.order.expires += 1;
      } else {
        entry.noProgressRounds = (entry.noProgressRounds || 0) + 1;
        if (entry.order.expires != null) entry.order.expires -= 1;
      }
      if (entry.order.expires != null && entry.order.expires <= 0) {
        if (['defend', 'delay', 'screen'].includes(entry.order.verb)) {
          const goals = Array.isArray(entry.order.to) ? entry.order.to : (entry.order.to != null ? [entry.order.to] : []);
          const checkAreas = entry.order.mustHold || entry.order.line || goals;
          const held = checkAreas.length > 0 && checkAreas.every(id => this.stage.st(id)?.country === entry.country);
          if (held) {
            entry.status = 'achieved';
            entry.report = { ...(entry.report || {}), status: 'achieved', warnings: ['防守任务圆满完成：坚守防线直至命令期限'] };
            continue;
          }
        }
        entry.status = 'failed';
        const pct = Math.round((entry.progress || 0) * 100);
        entry.report = { status: 'failed', warnings: [`指令已到期，未完成：当前进度 ${pct}%`] };
        continue;
      }
      if (entry.noProgressRounds >= MAX_STALLED_ROUNDS && entry.status !== 'stalled') {
        entry.status = 'stalled';
        const reason = entry.report?.warnings?.[0] || '连续3回合无实质进展，行动受阻';
        const existingWarnings = entry.report?.warnings || [];
        entry.report = { ...(entry.report || {}), status: 'stalled', warnings: existingWarnings.length ? existingWarnings : [reason] };
      }
    }
    this.coordination = { attacks: {}, manual: [], roundTargetHits: {} };
  }

  // ---- save / load ----
  snapshot() {
    this.replayRecorder?.capture();
    return JSON.parse(JSON.stringify({ stageEnabled:[...this.stage.enabled],sandboxFeatures:this.stage.data.sandboxFeatures?{...this.stage.data.sandboxFeatures,campaign:undefined}:null, sandboxTitle:this.sandboxTitle,sandboxState:this.sandboxState, campaignRun:this.campaignRun, coordination: this.coordination, theatres: this.theatres, nextTheaterId: this.nextTheaterId, orders: this.orders, nextOrderId: this.nextOrderId, armyGroups: this.armyGroups, nextArmyGroupId: this.nextArmyGroupId, ownedCommanders: this.ownedCommanders, stage: this.name, sandboxBattle: this.sandboxBattle, sandboxCustom: this.sandboxCustom, player: this.player, activeCountry: this.activeCountry, phase: this.phase, result: this.result, gameId: this.gameId, bridgeOpponentCountry: this.bridgeOpponentCountry, fogOfWar: this.fogOfWar, turnOrder: this.turnOrder, reparationRate: this.reparationRate, recruitWait: this.recruitWait, supplyByInfrastructure: this.supplyByInfrastructure, capturedAt: this.capturedAt, visibilityMemory: this.visibilityMemory, historicalDiplomacy: this.historicalDiplomacy, commanderLevel: this.playerInfo.commanderLevel, medalLevels: this.medalLevels, cardCooldowns: this.cardCooldowns, techTurn: this.techTurn, nextArmyId: this.nextArmyId, round: this.round, dialogueIndex: this.dialogueIndex, money: this.money, industry: this.industry, tech: this.tech, stability: this.getStability(this.player), hand: this.hand, countries: this.stage.data.countries.map(c => c.id === this.player ? { ...c, money: this.money, industry: this.industry, techlevel: this.tech, stability: this.getStability(c.id) } : { ...c, stability: this.getStability(c.id) }), areas: this.stage.areas, diplomacy: this.diplomacy ? JSON.parse(JSON.stringify(this.diplomacy)) : null,
      scenarioEvents: this.scenarioEvents ? JSON.parse(JSON.stringify(this.scenarioEvents)) : null, rng: this.rng.save(), replay: this.replay, log: this.log, gameLog: this.gameLog, nextGameLogId: this.nextGameLogId, reportLog: this.reportLog, nextReportId: this.nextReportId, reportRevision: this.reportRevision }));
  }

  // Adopt a validated Agent result in place, keeping UI listeners and controllers attached.
  adoptBridgeSnapshot(snapshot, country) {
    if (!snapshot || snapshot.stage !== this.name || snapshot.gameId !== this.gameId
        || snapshot.round !== this.round || snapshot.activeCountry !== country
        || snapshot.player !== this.player || !snapshot.rng
        || !Array.isArray(snapshot.areas) || !Array.isArray(snapshot.countries)) {
      throw new Error('桥提交状态与当前对局、回合或席位不匹配');
    }
    const snap = structuredClone(snapshot);
    if (snap.areas.length !== this.stage.areas.length
        || snap.countries.length !== this.stage.countries.size
        || new Set(snap.areas.map(a => a.id)).size !== snap.areas.length
        || new Set(snap.countries.map(c => c.id)).size !== snap.countries.length
        || snap.areas.some(a => !this.stage.byArea.has(a.id))
        || snap.countries.some(c => !this.stage.countries.has(c.id))) {
      throw new Error('桥提交状态的地图或国家列表不匹配');
    }
    const rng = Rng.restore(snap.rng);
    for (const incoming of snap.areas) Object.assign(this.stage.byArea.get(incoming.id), incoming);
    for (const incoming of snap.countries) Object.assign(this.stage.countries.get(incoming.id), incoming);
    const special = new Set(['stage', 'player', 'commanderLevel', 'areas', 'countries', 'rng', 'replay']);
    for (const [key, value] of Object.entries(snap)) if (!special.has(key)) this[key] = value;
    this.rng = rng;
    // Preserve the browser's animation replay and record the authoritative correction as a frame.
    this.replayRecorder?.capture();
  }

  // ---- economy ----
  // CArea::GetRealTax / GetIndustry and CCountry's per-area tax rate.
  // The configured commerce medal applies after base income is collected.
  // ---- diplomacy & stability ----
  getDiplomaticRelation(first, second) { return getDiplomaticRelation(this, first, second); }
  areDiplomaticAllies(first, second) { return areDiplomaticAllies(this, first, second); }
  canInitiateAttack(attacker, target, aiControlled = false) { return canCountryInitiateAttack(this, attacker, target, aiControlled); }
  canOccupyTerritory(attacker, target, aiControlled = false) { return canCountryOccupyTerritory(this, attacker, target, aiControlled); }
  registerDiplomaticHostility(attacker, target, reason) { return registerDiplomaticHostility(this, attacker, target, reason); }
  registerDiplomaticOccupation(attacker, target, reason) { return registerDiplomaticOccupation(this, attacker, target, reason); }
  setDiplomaticRelation(first, second, state, reason) { return setDiplomaticRelation(this, first, second, state, reason); }
  recordWarLoss(victimCountry, killerCountry, armyType) { return recordWarLoss(this, victimCountry, killerCountry, armyType); }
  warCascade(attacker, target) { return warCascade(this, attacker, target); }
  hasNap(first, second) { return hasNap(this, first, second); }
  proposeDiplomacy(first, second, action, reason) { return proposeDiplomaticAction(this, first, second, action, reason); }

  getStability(country = this.player) {
    if (country === this.player && this.stability != null) return this.stability;
    const info = this.stage.countries.get(country);
    return info ? (info.stability ?? 100) : 100;
  }
  setStability(country, val, reason = '') {
    const clamped = Math.max(0, Math.min(100, Math.round(val)));
    const old = this.getStability(country);
    if (country === this.player) {
      this.stability = clamped;
    }
    const info = this.stage.countries.get(country);
    if (info) info.stability = clamped;
    if (old !== clamped) {
      this.emit(EV.STABILITY_CHANGED, { country, stability: clamped, previous: old, reason });
    }
    return clamped;
  }
  changeStability(country, delta, reason = '') {
    return this.setStability(country, this.getStability(country) + delta, reason);
  }

  income(country = this.player) {
    const me = this.stage.countries.get(country); if (!me) return { money: 0, industry: 0 };
    let tax = 0, ind = 0;
    for (const area of this.stage.areas) {
      const owner=area.transitOwner||area.country;if(owner!==country||area.sea)continue;
      const inc = areaIncome(this,area.transitOwner?{...area,country:owner}:area);
      tax += inc.money;
      ind += inc.industry;
    }
    const commerce = country === this.player ? Math.max(0, Math.min(3, this.medalLevels.commerce || 0)) : 0;
    let money = tax + Math.trunc(tax * commerce / 10);
    let industry = ind + Math.trunc(ind * commerce / 10);
    if (this.diplomacy?.enabled) {
      let mul = stabilityIncomeMultiplier(this.getStability(country));
      const info = this.stage.countries.get(country);
      const iron = traitDef(this.stage.data?.traitCatalog, info, 'iron_fist');
      if (iron && mul < 1) mul = 1 - (1 - mul) * (iron.incomePenaltyScale ?? 0.4);
      if (mul < 1) {
        money = Math.trunc(money * mul);
        industry = Math.trunc(industry * mul);
      }
      const until = this.diplomacy.rallyUntil?.[country] || 0;
      const bonus = until > (this.round || 1) ? (this.diplomacy.rallyBonus?.[country] || 0) : 0;
      if (bonus) {
        money = Math.trunc(money * (1 + bonus));
        industry = Math.trunc(industry * (1 + bonus));
      }
    }
    return { money, industry };
  }
  price(card, country = this.player) {
    const info = this.stage.countries.get(country);
    const tech = country === this.player ? this.tech : info?.techlevel || 1;
    if (card?.id === 21 && tech >= 5) return 0;
    let cost = cardPrice(card, tech) + (card?.id === 25 ? 5 * (info?.commanderLevel || 0) : 0);
    return this.applyPopulationDiscount(card, country, cost);
  }
  industryCost(card, country = this.player) {
    const tech = country === this.player ? this.tech : this.stage.countries.get(country)?.techlevel || 1;
    const cost = card?.id === 21 && tech >= 5 ? 0 : cardIndustry(card, tech);
    return this.applyPopulationDiscount(card, country, cost);
  }
  applyPopulationDiscount(card, country, cost) {
    if (!this.diplomacy?.enabled || !card || !cost) return cost;
    const pop = traitDef(this.stage.data?.traitCatalog, this.stage.countries.get(country), 'population');
    const ids = pop?.infantryCardIds || [0, 28];
    if (!pop || !ids.includes(card.id)) return cost;
    return Math.max(1, Math.round(cost * (pop.infantryPriceScale ?? 0.75)));
  }
  // null when buyable, otherwise why not: 'tech' | 'money' | 'industry'
  whyNot(card, country = this.player) {
    if (!card) return 'unknown-card';
    const info = this.stage.countries.get(country), player = country === this.player;
    if (!info) return 'unknown-country';
    const tech = player ? this.tech : info.techlevel;
    const money = player ? this.money : info.money;
    const industry = player ? this.industry : info.industry;
    const cooldowns = player ? this.cardCooldowns : (info.cardCooldowns || {});
    if (card.id === 21 && tech >= 5) return 'max-tech';
    if (card.id === 21 && (player ? this.techTurn : info.techTurn || 0) > 0) return 'tech-in-progress';
    if (card.id === 25 && (info.commanderAlive || (info.commanderTurn || 0) > 0)) return 'commander-unavailable';
    if ((cooldowns[card.id] || 0) > 0) return 'cooldown';
    if (card.tech > tech) return 'tech';
    if (money < this.price(card, country)) return 'money';
    if (industry < this.industryCost(card, country)) return 'industry';
    return null;
  }

  // bombing / paratrooper range in map units (CCountry::AirstrikeRadius); medalLevels = the profile's medal upgrades
  airstrikeRadius(medalLevels = this.medalLevels) { return (medalLevels.airforce || 0) > 1 ? 400 : 300; }

  // ---- commands ----
  // apply({ type, ...payload }) -> { ok: true } | { ok: false, reason }.  Handlers live in game/rules/* (see commands.js).
  apply(cmd) {
    if (this.spectating) return { ok: false, reason: 'replay-read-only' };
    if (this.phase === 'finished') return { ok: false, reason: 'game-over' };
    if (cmd.type === 'endTurn' && window.GameLogger?.isDebug?.()) console.info('[WC2 log] endTurn apply:start', { round: this.round, logEnabled: this.logEnabled });
    const h = handlerFor(cmd.type);
    if (!h) return { ok: false, reason: 'not-implemented' };
    const why = h.validate ? h.validate(this, cmd) : null;
    if (why) return { ok: false, reason: why };
    // 事件决策归属于事件的目标国家(例如发给接管国的停战提议由接管国表态)，不要记到人类玩家名下
    const eventOwner = (cmd.type === 'resolveEventDecision' || cmd.type === 'resolveEventNotice')
      ? this.scenarioEvents?.pending?.find(p => p.id === cmd.eventId)?.targetCountry : null;
    const commandCountry = cmd.country || eventOwner || (cmd.from != null ? this.stage.st(cmd.from)?.country : null) || this.player;
    const actorBefore = commandCountry === this.player ? this : this.stage.countries.get(commandCountry);
    const commandBefore = { round: this.round, phase: this.phase, money: this.money, industry: this.industry,
      actorMoney: actorBefore?.money, actorIndustry: actorBefore?.industry,
      actorTech: commandCountry === this.player ? this.tech : actorBefore?.techlevel,
      from: cmd.from, to: cmd.to, armyId: cmd.armyId,
      fromArmies: cmd.from != null ? this.stage.st(cmd.from)?.armies?.map(a => ({ id: a.id, hp: a.hp, movement: a.movement })) : undefined,
      toArmies: cmd.to != null ? this.stage.st(cmd.to)?.armies?.map(a => ({ id: a.id, hp: a.hp, movement: a.movement })) : undefined };
    this.replayRecorder?.capture();
    const attackingGroup = cmd.type === 'attack' ? groupForArmy(this, commandCountry, cmd.armyId) : null;
    if (cmd.type === 'endTurn') this.executeAutoOrders(this.player);
    const previousApplying=this._applyingCommand;this._applyingCommand=true;try{h.execute(this,cmd);}finally{this._applyingCommand=previousApplying;}
    let orderExecution = null;
    if (['setArmyOrder', 'setTheaterOrder', 'setCountryOrder'].includes(cmd.type) && cmd.order && commandCountry === this.player && !cmd.aiIssued) {
      const level = cmd.type === 'setArmyOrder' ? 'army' : cmd.type === 'setTheaterOrder' ? 'theater' : 'country';
      const id = cmd.groupId || cmd.theaterId || cmd.country;
      // Issuing a standing order hands this formation to its commander. Earlier
      // manual actions must not prevent units with movement left from obeying it.
      const target = level === 'country' ? { country: id } : level === 'army' ? this.armyGroups.find(group => group.id === id) : this.theatres.find(theater => theater.id === id);
      const groupIds = level === 'army' ? [id] : target?.armyIds || [];
      const ordered = new Set(level === 'country' ? this.stage.areas.filter(a => a.country === id).flatMap(a => a.armies.map(u => u.id))
        : this.armyGroups.filter(group => groupIds.includes(group.id)).flatMap(group => group.unitIds || []));
      this.coordination.manual = (this.coordination.manual || []).filter(armyId => !ordered.has(armyId));
      orderExecution = this.executeOrders({ level, id, mode: 'now' });
    }
    if (cmd.type === 'attack') {
      if (attackingGroup) {
        const hits = this.coordination.attacks[cmd.to] ||= [];
        if (!hits.includes(attackingGroup.id)) hits.push(attackingGroup.id);
      }
    }
    if (commandCountry === this.player && ['move', 'attack', 'useCard'].includes(cmd.type) && cmd.armyId != null && !cmd.orderExecution) this.coordination.manual.push(cmd.armyId);
    restoreAlliedTransit(this);
    if (this.phase !== 'finished' && (this.sandboxCustom || ['move', 'attack', 'useCard', 'endTurn'].includes(cmd.type))) checkVictory(this, commandCountry);
    restoreAlliedTransit(this);
    if (this.logEnabled) this.gameLog.push({ schemaVersion: 2, id: this.nextGameLogId++, timestamp: new Date().toISOString(),
      gameId: this.gameId, round: this.round, phase: this.phase, actorCountry: commandCountry, category: 'command', event: 'commandApplied',
      data: { command: JSON.parse(JSON.stringify(cmd)), before: commandBefore,
        after: { round: this.round, phase: this.phase, money: this.money, industry: this.industry,
          actorMoney: commandCountry === this.player ? this.money : this.stage.countries.get(commandCountry)?.money,
          actorIndustry: commandCountry === this.player ? this.industry : this.stage.countries.get(commandCountry)?.industry,
          actorTech: commandCountry === this.player ? this.tech : this.stage.countries.get(commandCountry)?.techlevel,
          fromArmies: cmd.from != null ? this.stage.st(cmd.from)?.armies?.map(a => ({ id: a.id, hp: a.hp, movement: a.movement })) : undefined,
          toArmies: cmd.to != null ? this.stage.st(cmd.to)?.armies?.map(a => ({ id: a.id, hp: a.hp, movement: a.movement })) : undefined } } });
    if (this.sandboxCustom) evaluateEvents(this, 'stateChanged');
    this.replayRecorder?.capture(cmd);
    this.log.push({ ...cmd, card: typeof cmd.card === 'object' ? cmd.card.id : cmd.card, round: this.round });
    if (cmd.type === 'endTurn' || this.phase === 'finished') this.flushGameLog();
    if (cmd.type === 'endTurn') console.info('[WC2 log] endTurn apply:flushed', { round: this.round });
    return { ok: true, ...(orderExecution ? { orderExecution } : {}) };
  }

  // Plain-data view of the state for AI / LLM / MCP controllers.
  describe() {
    if (this.fogOfWar) return describeCountry(this, this.player);
    return this.describeFull();
  }
  describeFull() {
    const s = this.stage;
    return { stage: this.name, round: this.round, totalRounds: this.totalRounds, player: this.player, activeCountry: this.activeCountry, money: this.money, industry: this.industry, tech: this.tech, stability: this.getStability(this.player), hand: this.hand, countries: this.stage.data.countries.map(c => ({ id: c.id, money: c.id === this.player ? this.money : c.money, industry: c.id === this.player ? this.industry : c.industry, techlevel: c.id === this.player ? this.tech : c.techlevel, stability: this.getStability(c.id) })), gameLog: this.getGameLog(), diplomacy: this.diplomacy ? JSON.parse(JSON.stringify(this.diplomacy)) : null,
      scenarioEvents: this.scenarioEvents ? JSON.parse(JSON.stringify(this.scenarioEvents)) : null,
      areas: s.areas.filter(a => s.enabled.has(a.id)).map(a => ({ id: a.id, country: a.country, armies: a.armies, construction: a.construction, level: a.level, installation: a.installation, neighbours: s.adjE.get(a.id) })) };
  }
}
