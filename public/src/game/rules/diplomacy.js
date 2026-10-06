// Port of formwork's DiplomacySystem (C++ DiplomacySystem.h / .cpp)
// Handles diplomatic relation states (war, peace, alliance), alliance components,
// betrayal policies, and integration with combat and movement rules.

import { register } from '../commands.js';
import { isSandbox } from '../sandbox_policy.js';
import { EV } from '../events.js';
import { reportFactKey } from '../report.js';
import { nativeAlliance } from './combatModel.js';
import { getCountryName } from '../api/names.js';
import { shopCards } from '../cards.js';
import { attackedRallySpec, ordinaryDeclareMultiplier, traitDef, peaceTuning } from './national_traits.js';

export const DIPLOMACY_STATE = {
  UNSET: 0,
  WAR: 1,
  PEACE: 2,
  ALLIANCE: 3,
};

export const RELATION_NAMES = {
  [DIPLOMACY_STATE.UNSET]: '未设定',
  [DIPLOMACY_STATE.WAR]: '战争',
  [DIPLOMACY_STATE.PEACE]: '和平',
  [DIPLOMACY_STATE.ALLIANCE]: '同盟',
};

// --- Peace Proposal Stability & Cooldown Tuning ---
export const DEFAULT_PEACE_PROPOSE_STABILITY_COST = 6;
export const DEFAULT_PEACE_REJECT_COOLDOWN_ROUNDS = 3;

/**
 * 提出停战扣除稳定度计算：
 * - 民主/厌战：国内民众支持和平，求和损失较少稳定度 (x0.6 -> 4点)；
 * - 极权/铁腕/扩张：政权依赖强权与不妥协形象，主动求和严重损害威望 (x1.5 -> 9点)；
 * - 威权/君主/中立：基础扣除 (x1.0 -> 6点)。
 */
export function peaceProposalStabilityCost(catalog, countryInfo) {
  const tuning = peaceTuning(catalog, countryInfo);
  const base = catalog?.peaceTuning?.proposeStabilityCost ?? DEFAULT_PEACE_PROPOSE_STABILITY_COST;
  const regime = tuning?.regime || 'authoritarian';
  const traits = tuning?.traits || [];

  let mul = catalog?.peaceTuning?.regimeScale?.[regime] ?? 1.0;
  if (regime === 'democracy' || traits.includes('war_weary')) {
    mul = Math.min(mul, 0.6);
  } else if (regime === 'totalitarian' || traits.includes('iron_fist') || traits.includes('expansionist')) {
    mul = Math.max(mul, 1.5);
  }
  return Math.max(1, Math.round(base * mul));
}

export const UNIT_BUILD_COSTS = {
  infantry: 75,
  armour: 140,
  armoredcar: 140,
  artillery: 125,
  rocket: 240,
  tank: 220,
  heavytank: 300,
  elite_infantry: 120,
  destroyer: 250,
  cruiser: 350,
  battleship: 450,
  aircraftcarrier: 600,
};

export function parseDiplomaticRelationState(val) {
  if (typeof val === 'number') return val;
  const s = String(val || '').toLowerCase();
  if (s === 'war' || s === '1') return DIPLOMACY_STATE.WAR;
  if (s === 'peace' || s === 'neutral' || s === '2') return DIPLOMACY_STATE.PEACE;
  if (s === 'alliance' || s === 'ally' || s === '3') return DIPLOMACY_STATE.ALLIANCE;
  return DIPLOMACY_STATE.UNSET;
}

export function relationToString(state) {
  if (state === DIPLOMACY_STATE.WAR) return 'war';
  if (state === DIPLOMACY_STATE.PEACE) return 'peace';
  if (state === DIPLOMACY_STATE.ALLIANCE) return 'alliance';
  return 'unset';
}

export function relationKey(a, b) {
  const sa = String(a), sb = String(b);
  return sa < sb ? `${sa}_${sb}` : `${sb}_${sa}`;
}

export function initDiplomacy(config = null) {
  const dip = {
    coalitionPeaceRequests: config?.coalitionPeaceRequests ? JSON.parse(JSON.stringify(config.coalitionPeaceRequests)) : {},
    enabled: !!(config && config.enabled),
    allowAlliedAttack: !!(config && config.allowAlliedAttack),
    betrayalPolicy: (config && config.betrayalPolicy) === 'none' ? 'none' : 'war',
    allowAlliedOccupation: !!(config && config.allowAlliedOccupation),
    alliedOccupationPolicy: (config && config.alliedOccupationPolicy) === 'none' ? 'none' : 'war',
    warInvitations: config?.warInvitations ? JSON.parse(JSON.stringify(config.warInvitations)) : {},
    relations: {}, // key -> state number
    warLosses: (config && config.warLosses) ? JSON.parse(JSON.stringify(config.warLosses)) : {}, // relationKey -> { [country]: totalCasualtyCost }
    warLossesInd: (config && config.warLossesInd) ? JSON.parse(JSON.stringify(config.warLossesInd)) : {}, // same, industry part of the build cost
    lastWarDeclaredRound: (config && config.lastWarDeclaredRound) ? { ...config.lastWarDeclaredRound } : {},
    pacts: (config && config.pacts) ? JSON.parse(JSON.stringify(config.pacts)) : {},
    warStartedRound: (config && config.warStartedRound) ? { ...config.warStartedRound } : {},
    capitals: (config && config.capitals) ? { ...config.capitals } : {},
    originalLands: (config && config.originalLands) ? { ...config.originalLands } : {},
    capitulated: (config && config.capitulated) ? JSON.parse(JSON.stringify(config.capitulated)) : {},
    capitalFallen: (config && config.capitalFallen) ? JSON.parse(JSON.stringify(config.capitalFallen)) : {},
    lastUnrestRound: (config && config.lastUnrestRound) ? { ...config.lastUnrestRound } : {},
    lastOfferRound: (config && config.lastOfferRound) ? { ...config.lastOfferRound } : {},
    peaceCooldown: (config && config.peaceCooldown) ? { ...config.peaceCooldown } : {},
    truceUntil: (config && config.truceUntil) ? { ...config.truceUntil } : {},
    revision: 0,
  };
  if (config && config.relations) {
    if (Array.isArray(config.relations)) {
      for (const item of config.relations) {
        if (item.from != null && item.to != null) {
          const st = parseDiplomaticRelationState(item.state);
          dip.relations[relationKey(item.from, item.to)] = st;
        }
      }
    } else {
      for (const [k, v] of Object.entries(config.relations)) {
        dip.relations[k] = parseDiplomaticRelationState(v);
      }
    }
  }
  return dip;
}

export function recordWarLoss(game, victimCountry, killerCountry, armyType) {
  if (!victimCountry || !killerCountry || victimCountry === killerCountry) return;
  const dip = game.diplomacy;
  if (!dip) return;
  const key = relationKey(victimCountry, killerCountry);
  if (!dip.warLosses) dip.warLosses = {};
  if (!dip.warLosses[key]) dip.warLosses[key] = {};
  const cost = unitBuildCost(game, victimCountry, armyType);
  dip.warLosses[key][victimCountry] = (dip.warLosses[key][victimCountry] || 0) + cost.money;
  if (!dip.warLossesInd) dip.warLossesInd = {};
  if (!dip.warLossesInd[key]) dip.warLossesInd[key] = {};
  dip.warLossesInd[key][victimCountry] = (dip.warLossesInd[key][victimCountry] || 0) + cost.industry;
}

// What the victim paid for this unit: the recruit card of that army type in the victim's own shop, at its tech level
// (money and industry). Falls back to the flat table when the card cannot be found.
const ARMY_TYPE_CARD = { infantry: 0, panzer: 1, armoredcar: 1, armour: 1, artillery: 2, rocket: 3, tank: 4, heavytank: 5, eliteinfantry: 28, elite_infantry: 28, destroyer: 6, cruiser: 7, battleship: 8, aircraftcarrier: 9 };
function unitBuildCost(game, country, armyType) {
  const id = ARMY_TYPE_CARD[armyType], info = game.stage?.countries?.get(country);
  const data = game.cardData;
  if (id != null && data && info) {
    const card = shopCards(data, info.flag).find(c => c.id === id) || (data.others || []).find(c => c.id === id);
    if (card && game.price && game.industryCost) return { money: game.price(card, country) || 0, industry: game.industryCost(card, country) || 0 };
  }
  return { money: UNIT_BUILD_COSTS[armyType] || 100, industry: 0 };
}

const MAJOR_POWERS = new Set(['de', 'gb', 'fr', 'ru', 'us', 'am', 'it', 'cn', 'ja']);
const STUBBORN_NEUTRALS = new Set(['ch', 'se', 'pt']);
const NEGOTIATED_REASONS = new Set([
  'player_action', 'ai_propose_alliance', 'propose_alliance',
  'ai_propose_peace', 'propose_peace', 'ai_low_stability_peace',
]);
const SKIP_WAR_STABILITY = new Set(['war_cascade', 'alliance_join_war']);

export function stabilityIncomeMultiplier(stab) {
  const n = Number(stab);
  if (!(n >= 0)) return 1;
  if (n >= 80) return 1;
  if (n >= 60) return 0.92;
  if (n >= 40) return 0.80;
  if (n >= 20) return 0.64;
  return 0.48;
}

export function declareWarStabilityCost(game, attacker, defender) {
  if (isSandbox(game)) return 0;
  const rel = getDiplomaticRelation(game, attacker, defender);
  if (rel === DIPLOMACY_STATE.ALLIANCE || hasNap(game, attacker, defender)) return 20;
  const info = game.stage?.countries?.get(attacker);
  const mul = ordinaryDeclareMultiplier(game.stage?.data?.traitCatalog, info);
  return Math.max(1, Math.round(12 * mul));
}

function applyAttackedRally(game, defender, reason) {
  if (!defender || reason === 'alliance_join_war') return;
  const info = game.stage?.countries?.get(defender);
  const spec = attackedRallySpec(game.stage?.data?.traitCatalog, info);
  if (!spec) return;
  const dip = game.diplomacy;
  if (!dip.rallyUntil) dip.rallyUntil = {};
  if (!dip.rallyBonus) dip.rallyBonus = {};
  if (spec.stability) game.changeStability?.(defender, spec.stability, 'rally');
  const until = (game.round || 1) + (spec.incomeTurns || 0);
  if (until > (dip.rallyUntil[defender] || 0)) {
    dip.rallyUntil[defender] = until;
    dip.rallyBonus[defender] = spec.incomeBonus || 0;
  }
}

function roundsAtWar(game, countryId) {
  const dip = game.diplomacy;
  if (!dip?.warStartedRound) return 0;
  const round = game.round || 1;
  let best = 0;
  for (const [key, started] of Object.entries(dip.warStartedRound)) {
    const parts = key.split('_');
    if (parts.length !== 2 || (parts[0] !== countryId && parts[1] !== countryId)) continue;
    const other = parts[0] === countryId ? parts[1] : parts[0];
    if (getDiplomaticRelation(game, countryId, other) !== DIPLOMACY_STATE.WAR) continue;
    best = Math.max(best, round - (started || round));
  }
  return best;
}

export function ensureDiplomacyMeta(game) {
  const dip = game?.diplomacy;
  const st = game?.stage;
  if (!dip || !st) return dip;
  if (!dip.pacts) dip.pacts = {};
  if (!dip.warStartedRound) dip.warStartedRound = {};
  if (!dip.capitals) dip.capitals = {};
  if (!dip.originalLands) dip.originalLands = {};
  if (!dip.capitulated) dip.capitulated = {};
  if (!dip.capitalFallen) dip.capitalFallen = {};
  if (!dip.lastUnrestRound) dip.lastUnrestRound = {};
  if (!dip.lastOfferRound) dip.lastOfferRound = {};
  if (!dip.truceUntil) dip.truceUntil = {};
  if (!dip.landHistory) dip.landHistory = {};
  if (!dip.peaceCooldown) dip.peaceCooldown = {};
  if (!dip.peaceOffers) dip.peaceOffers = [];

  const round = game.round || 1;
  for (const c of st.countries.values()) {
    if (!c || c.eliminated) continue;
    const lands = st.areas.filter(a => (a.transitOwner||a.country) === c.id && !a.sea).length;
    if (dip.originalLands[c.id] == null) {
      dip.originalLands[c.id] = lands;
    }
    if (!dip.landHistory[c.id]) dip.landHistory[c.id] = [];
    if (!dip.landHistory[c.id].some(h => h.round === round)) {
      dip.landHistory[c.id].push({ round, lands });
    }
    if (dip.capitals[c.id] == null) {
      // 关卡可显式指定首都(stage.capitals: { 国家: 地块ID })，用于没有最高级城市的国家(否则会退而求其次选第一座小城市，可能正好在前线)
      const fixed = st.data?.capitals?.[c.id];
      if (fixed != null && st.st(fixed) && !st.st(fixed).sea) { dip.capitals[c.id] = fixed; continue; }
      const owned = st.areas.filter(a => (a.transitOwner||a.country) === c.id && !a.sea);
      const type1 = owned.find(a => a.areaType === 1);
      const type4 = owned.filter(a => a.areaType === 4);
      const cap = type1 || type4[0] || owned[0];
      if (cap) dip.capitals[c.id] = cap.id;
    }
  }
  if (dip.relations) {
    for (const [key, state] of Object.entries(dip.relations)) {
      const stNum = parseDiplomaticRelationState(state);
      if (stNum === DIPLOMACY_STATE.WAR && dip.warStartedRound[key] == null) {
        dip.warStartedRound[key] = 1;
      }
    }
  }
  return dip;
}

function countryAlive(c) {
  return !!(c && !c.eliminated);
}

// Stage data sometimes carries the bare country code as its name ("nl", "de2"); never show a code to the player.
function countryName(game, id) {
  const n = game.stage?.countries?.get(id)?.name;
  if (n && !/^[a-z]{2,3}\d*$/i.test(n) && n !== id) return n;
  const full = getCountryName(id, game.stage);
  return full.startsWith('国家 [') ? (n || id) : full;
}

function countryWallet(game, id) {
  return id === game.player ? game : game.stage.countries.get(id);
}

export function countLands(game, id) {
  return game.stage.areas.filter(a => (a.transitOwner||a.country) === id && !a.sea).length;
}

export function countryPower(game, id) {
  const lands = game.stage.areas.filter(a => (a.transitOwner||a.country) === id && !a.sea);
  const power = game.stage.areas.filter(a=>a.country===id).reduce((sum,a)=>sum+a.armies.reduce((t,u)=>t+(u.hp||50),0),0);
  return { lands: lands.length, power };
}

function shareBorder(game, a, b) {
  const st = game.stage;
  const mine = new Set(st.areas.filter(x => (x.transitOwner||x.country) === a && !x.sea).map(x => x.id));
  if (!mine.size) return false;
  for (const area of st.areas) {
    if ((area.transitOwner||area.country) !== b || area.sea) continue;
    for (const nid of (st.adjE.get(area.id) || [])) {
      if (mine.has(nid)) return true;
    }
  }
  return false;
}

export function hasNap(game, a, b) {
  const pact = game.diplomacy?.pacts?.[relationKey(a, b)];
  return !!(pact && pact.type === 'nap');
}

export function warDuration(game, a, b) {
  const started = game.diplomacy?.warStartedRound?.[relationKey(a, b)];
  if (started == null) return 0;
  return Math.max(0, (game.round || 1) - started);
}

function livingCountries(game) {
  return [...game.stage.countries.values()].filter(countryAlive);
}

function sharedWarEnemies(game, a, b) {
  let n = 0;
  for (const c of livingCountries(game)) {
    if (c.id === a || c.id === b) continue;
    if (getDiplomaticRelation(game, a, c.id) === DIPLOMACY_STATE.WAR &&
        getDiplomaticRelation(game, b, c.id) === DIPLOMACY_STATE.WAR) n++;
  }
  return n;
}

function otherMajorWars(game, countryId, exceptId) {
  let n = 0;
  for (const c of livingCountries(game)) {
    if (c.id === countryId || c.id === exceptId) continue;
    if (getDiplomaticRelation(game, countryId, c.id) !== DIPLOMACY_STATE.WAR) continue;
    const p = countryPower(game, c.id);
    if (p.lands >= 8 || MAJOR_POWERS.has(c.id)) n++;
  }
  return n;
}

export function getReparationRate(game) {
  const rate = game?.reparationRate;
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : 1.8;
}
export function computeReparations(game, proposer, opponent) {
  // Reparations = the build cost of every unit the OTHER side lost in this war x the match reparation rate, in money AND industry.
  // Always paid in full: a country that cannot cover it goes into debt (negative money / industry) - suing for peace
  // is never free, so a fake truce followed by a new attack is not a loophole.
  const dip = game.diplomacy;
  const key = relationKey(proposer, opponent);
  const book = dip?.warLosses?.[key] || {}, bookInd = dip?.warLossesInd?.[key] || {};
  const opponentLosses = book[opponent] || 0, opponentLossesInd = bookInd[opponent] || 0;
  const ownLosses = book[proposer] || 0;
  const wallet = countryWallet(game, proposer);
  const rate = getReparationRate(game);
  const raw = Math.ceil(opponentLosses * rate);
  const industry = Math.ceil(opponentLossesInd * rate);
  const isBroke = (wallet?.money || 0) < raw || (wallet?.industry || 0) < industry;
  return { raw, paid: raw, industry, rate, isBroke, casualtyBill: raw, tributeFloor: 0, opponentLosses, opponentLossesInd, ownLosses };
}

export function collectSurrenderReparations(game, defeated, victor) {
  const bill = computeReparations(game, defeated, victor);
  const loser = countryWallet(game, defeated), winner = countryWallet(game, victor);
  if (!loser || !winner) return bill;
  loser.money = (loser.money || 0) - bill.paid;
  loser.industry = (loser.industry || 0) - bill.industry;
  winner.money = (winner.money || 0) + bill.paid;
  winner.industry = (winner.industry || 0) + bill.industry;
  game.emit(EV.RESOURCES_CHANGED, { country: defeated, money: loser.money, industry: loser.industry });
  game.emit(EV.RESOURCES_CHANGED, { country: victor, money: winner.money, industry: winner.industry });
  game.emit(EV.WAR_REPARATIONS_PAID, { from: defeated, to: victor,
    reparations: bill.raw, paid: bill.paid, industry: bill.industry, isBroke: bill.isBroke,
    casualtyBill: bill.casualtyBill, tributeFloor: bill.tributeFloor });
  return bill;
}

function pushDiplomacyReport(game, id, title, body) {
  const se = game.scenarioEvents;
  if (!se) return;
  if (!se.history) se.history = [];
  if (!se.definitions) se.definitions = [];
  if (se.history.includes(id)) return;
  se.history.push(id);
  const def = { id, type: 'report', title, body };
  if (!se.definitions.some(d => d.id === id)) se.definitions.push(def);
  game.emit(EV.SCENARIO_EVENT, { event: def, phase: 'resolved' });
  return def;
}

function rejectOffer(game, first, second, action, decision) {
  if (action === 'peace') {
    const round = game.round || 1;
    const key = relationKey(first, second);
    const dirKey = `${first}_${second}`;
    if (!game.diplomacy.peaceCooldown) game.diplomacy.peaceCooldown = {};
    game.diplomacy.peaceCooldown[key] = round;
    game.diplomacy.peaceCooldown[dirKey] = round;
  }
  game.emit(EV.DIPLOMACY_OFFER_RESOLVED, {
    first, second, action, accepted: false, reason: 'rejected-by-player',
    score: decision?.score ?? 0, why: decision?.why || 'rejected',
  });
  const aName = countryName(game, first);
  const bName = countryName(game, second);
  const label = action === 'alliance' ? '结盟' : action === 'peace' ? '停战' : '互不侵犯';
  const round = game.round || 1;
  pushDiplomacyReport(
    game,
    `offer_reject_${action}_${first}_${second}_r${round}`,
    `${bName}拒绝${label}`,
    `${aName}向${bName}提出${label}，被对方拒绝。`,
  );
}

function queuePlayerDecision(game, def) {
  const se = game.scenarioEvents;
  if (!se) return false;
  if (!se.pending) se.pending = [];
  if (!se.definitions) se.definitions = [];
  if (se.pending.some(p => p.id === def.id) || se.history?.includes(def.id)) return false;
  se.pending.push(JSON.parse(JSON.stringify(def)));
  if (!se.definitions.some(d => d.id === def.id)) se.definitions.push(JSON.parse(JSON.stringify(def)));
  game.emit(EV.SCENARIO_EVENT, { event: def, phase: 'triggered' });
  return true;
}

function notifyPeaceAllies(game, first, second) {
  const recipients = new Map();
  for (const [signatory, opponent] of [[first, second], [second, first]]) {
    for (const ally of livingCountries(game)) {
      if (ally.id === first || ally.id === second) continue;
      if (getDiplomaticRelation(game, signatory, ally.id) !== DIPLOMACY_STATE.ALLIANCE) continue;
      if (!recipients.has(ally.id)) recipients.set(ally.id, { signatory, opponent });
    }
  }
  for (const [recipient, { signatory, opponent }] of recipients) {
    const title = '盟友停战通知';
    const body = `盟友${countryName(game, signatory)}已与${countryName(game, opponent)}达成和约，双方停止交战。贵国与该国的外交关系不随此和约改变。`;
    const id = `peace_ally_${relationKey(first, second)}_${recipient}_r${game.round || 1}_v${game.diplomacy.revision}`;
    game.addReport?.({ category: 'diplomacy', kind: 'allyPeaceNotice',
      actors: [first, second, recipient], detail: { first, second, recipient },
      text: `${countryName(game, recipient)}收到停战通知：${body}`, importance: 2 });
    if (isPlayerCountry(game, recipient)) {
      queuePlayerDecision(game, { id, type: 'notice', category: 'diplomacy',
        targetCountry: recipient, actors: [first, second], title, body });
    }
  }
}

export function setNap(game, first, second, reason = 'nap') {
  const dip = ensureDiplomacyMeta(game);
  if (!dip) return false;
  dip.pacts[relationKey(first, second)] = { type: 'nap', sinceRound: game.round || 1, reason };
  dip.revision = (dip.revision || 0) + 1;
  game.emit(EV.DIPLOMACY_PACT, { first, second, pactType: 'nap', reason });
  const aName = countryName(game, first);
  const bName = countryName(game, second);
  pushDiplomacyReport(
    game,
    `nap_${first}_${second}_r${game.round || 1}`,
    `${aName}与${bName}签订互不侵犯条约`,
    `${aName}与${bName}达成互不侵犯协定。撕毁条约宣战将付出与背盟相当的稳定度代价。`,
  );
  return true;
}

function clearNap(game, first, second) {
  const dip = game.diplomacy;
  if (!dip?.pacts) return;
  if (dip.pacts[relationKey(first, second)]) game.addReport?.({ category: 'diplomacy', kind: 'pactBroken', actors: [first, second],
    text: `${countryName(game, first)}与${countryName(game, second)}的互不侵犯条约被撕毁。`, importance: 2 });
  delete dip.pacts[relationKey(first, second)];
}

export function evaluateAllianceAcceptance(game, proposer, target) {
  if (!proposer || !target || proposer === target) return { accept: false, score: -100, why: 'invalid' };
  const rel = getDiplomaticRelation(game, proposer, target);
  if (rel === DIPLOMACY_STATE.ALLIANCE) return { accept: false, score: 0, why: 'already-allied' };
  if (rel === DIPLOMACY_STATE.WAR) return { accept: false, score: -80, why: 'at-war' };
  const tInfo = game.stage.countries.get(target);
  if (!countryAlive(tInfo)) return { accept: false, score: -100, why: 'dead' };

  let score = 0;
  const shared = sharedWarEnemies(game, proposer, target);
  score += shared * 28;
  const p = countryPower(game, proposer);
  const t = countryPower(game, target);
  const origP = game.diplomacy?.originalLands?.[proposer] ?? p.lands;
  if (hasLivingWarOpponent(game, proposer) && (MAJOR_POWERS.has(target) || t.lands >= 12)) score += 18;
  if (p.lands < origP * 0.65 && hasLivingWarOpponent(game, proposer)) score += 16;
  if (shareBorder(game, proposer, target)) score += 6;
  if (shareBorder(game, proposer, target) && shared > 0) score += 8;
  if (hasLivingWarOpponent(game, target) && hasLivingWarOpponent(game, proposer) && shared > 0) score += 10;
  if ((MAJOR_POWERS.has(proposer) || p.lands >= 12) && t.lands <= 8 && p.power > t.power * 1.6 && !hasLivingWarOpponent(game, target)) {
    score += 22;
  }

  for (const c of livingCountries(game)) {
    if (c.id === proposer || c.id === target) continue;
    if (getDiplomaticRelation(game, proposer, c.id) !== DIPLOMACY_STATE.WAR) continue;
    if (hasNap(game, target, c.id)) score -= 50;
    if (getDiplomaticRelation(game, target, c.id) === DIPLOMACY_STATE.ALLIANCE) score -= 40;
  }

  if (target === 'ch') score -= 40;
  if (STUBBORN_NEUTRALS.has(target) && shared === 0) score -= 20;
  const stabT = game.getStability ? game.getStability(target) : 100;
  const stabP = game.getStability ? game.getStability(proposer) : 100;
  if (stabT < 25) score -= 15;
  if (stabP < 20 && shared === 0) score -= 10;
  return { accept: score >= 24, score, why: score >= 24 ? 'accept' : 'low-score' };
}

export function evaluateNapAcceptance(game, proposer, target) {
  if (!proposer || !target || proposer === target) return { accept: false, score: -100, why: 'invalid' };
  const rel = getDiplomaticRelation(game, proposer, target);
  if (rel !== DIPLOMACY_STATE.PEACE) return { accept: false, score: -80, why: 'not-peace' };
  if (hasNap(game, proposer, target)) return { accept: false, score: 0, why: 'already-nap' };
  let score = 10;
  const p = countryPower(game, proposer);
  const t = countryPower(game, target);
  const border = shareBorder(game, proposer, target);
  if (border) score += 10;
  if (border && t.power > 0 && p.power > t.power * 1.35) score += 25;
  if (hasLivingWarOpponent(game, target) && border) score += 20;
  if (hasLivingWarOpponent(game, proposer) && !hasLivingWarOpponent(game, target)) score += 8;
  if (STUBBORN_NEUTRALS.has(target)) score += 15;
  if (!hasLivingWarOpponent(game, target) && t.lands >= 15) score -= 15;
  return { accept: score >= 25, score, why: score >= 25 ? 'accept' : 'low-score' };
}

export function evaluatePeaceAcceptance(game, proposer, target) {
  if (!proposer || !target || proposer === target) return { accept: false, score: -100, why: 'invalid' };
  if (getDiplomaticRelation(game, proposer, target) !== DIPLOMACY_STATE.WAR) {
    return { accept: false, score: -80, why: 'not-at-war' };
  }
  const p = countryPower(game, proposer);
  const t = countryPower(game, target);
  const dur = warDuration(game, proposer, target);
  const origP = game.diplomacy?.originalLands?.[proposer] ?? p.lands;
  let score = 0;
  if (dur >= 12) score += 15;
  if (dur >= 8) score += 8;

  // Do not penalize if proposer is losing heavily or capital fallen/threatened
  const pLosingBadly = (p.lands < origP * 0.75) || game.diplomacy?.capitalFallen?.[proposer];
  if (dur < 5 && !pLosingBadly) score -= 20;

  // REMOVED: p.lands <= 2 && t.power > p.power * 2 penalty (removed per Problem 2 requirements)

  if (otherMajorWars(game, target, proposer) > 0) {
    score += (p.lands < origP * 0.75) ? 25 : 18;
  }
  if (game.diplomacy?.capitalFallen?.[target]) score += 20;
  if (game.diplomacy?.capitalFallen?.[proposer]) score += 12;
  const key = relationKey(proposer, target);
  const book = game.diplomacy?.warLosses?.[key] || {};
  const lossesP = book[proposer] || 0;
  const lossesT = book[target] || 0;
  if (lossesT > lossesP * 1.5 && dur >= 6) score += 10;
  const stabT = game.getStability ? game.getStability(target) : 100;
  const stabP = game.getStability ? game.getStability(proposer) : 100;
  if (stabT < 35) score += 15;
  if (stabP < 20) score += 8;
  if (p.power > t.power * 0.8 && p.lands > origP * 0.8 && dur < 8) score -= 15;
  return { accept: score >= 18, score, why: score >= 18 ? 'accept' : 'low-score' };
}

function directRelation(dip, a, b) {
  if (!dip || !dip.relations) return DIPLOMACY_STATE.UNSET;
  const k = relationKey(a, b);
  return dip.relations[k] ?? DIPLOMACY_STATE.UNSET;
}

// Find all alliance IDs connected to `start` via ALLIANCE relation
function collectAllianceComponent(dip, start, allAlliances) {
  const members = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const other of allAlliances) {
      if (other === cur || members.has(other)) continue;
      if (directRelation(dip, cur, other) === DIPLOMACY_STATE.ALLIANCE) {
        members.add(other);
        queue.push(other);
      }
    }
  }
  return members;
}

function allianceComponentsShareWar(dip, firstAlliance, secondAlliance, allAlliances) {
  const set1 = collectAllianceComponent(dip, firstAlliance, allAlliances);
  const set2 = collectAllianceComponent(dip, secondAlliance, allAlliances);
  for (const a1 of set1) {
    for (const a2 of set2) {
      if (directRelation(dip, a1, a2) === DIPLOMACY_STATE.WAR) {
        return true;
      }
    }
  }
  return false;
}

export function getDiplomaticRelation(game, firstCountryId, secondCountryId) {
  if (!firstCountryId || !secondCountryId) return DIPLOMACY_STATE.PEACE;
  if (firstCountryId === secondCountryId) return DIPLOMACY_STATE.ALLIANCE;

  const st = game.stage;
  const c1 = st.countries.get(firstCountryId);
  const c2 = st.countries.get(secondCountryId);
  if (!c1 || !c2) return DIPLOMACY_STATE.PEACE;

  const dip = game.diplomacy;
  // If diplomacy is not enabled, use legacy engine logic
  if (!dip || !dip.enabled) {
    const a1 = nativeAlliance(st.alliance(firstCountryId));
    const a2 = nativeAlliance(st.alliance(secondCountryId));
    if (a1 != null && a2 != null && a1 === a2) {
      return DIPLOMACY_STATE.ALLIANCE;
    }
    if (a1 !== a2 && a2 !== 0 && a1 !== 0) {
      return DIPLOMACY_STATE.WAR;
    }
    return DIPLOMACY_STATE.PEACE;
  }

  // Same native alliance defaults to ALLIANCE
  if (c1.alliance != null && c2.alliance != null && c1.alliance === c2.alliance) {
    // Check if directly overridden by country
    const directCountry = directRelation(dip, firstCountryId, secondCountryId);
    if (directCountry !== DIPLOMACY_STATE.UNSET) return directCountry;
    return DIPLOMACY_STATE.ALLIANCE;
  }

  // 1. Direct country-to-country check
  const directCountry = directRelation(dip, firstCountryId, secondCountryId);
  if (directCountry !== DIPLOMACY_STATE.UNSET) return directCountry;

  // 2. Direct alliance-to-alliance check
  const directAlliance = directRelation(dip, c1.alliance, c2.alliance);
  if (directAlliance === DIPLOMACY_STATE.WAR || directAlliance === DIPLOMACY_STATE.ALLIANCE) {
    return directAlliance;
  }

  // Wars require an explicit relation; an offensive ally must consent to joining.
  return DIPLOMACY_STATE.PEACE;
}

export function areDiplomaticAllies(game, firstCountryId, secondCountryId) {
  return getDiplomaticRelation(game, firstCountryId, secondCountryId) === DIPLOMACY_STATE.ALLIANCE;
}

export function hasLivingWarOpponent(game, countryId) {
  const st = game.stage;
  for (const other of st.countries.values()) {
    if (!other || other.id === countryId || other.eliminated) continue;
    if (getDiplomaticRelation(game, countryId, other.id) === DIPLOMACY_STATE.WAR) {
      return true;
    }
  }
  return false;
}

export function canCountryInitiateAttack(game, attackerId, targetId, aiControlled = false) {
  if (!attackerId || !targetId || attackerId === targetId) return false;
  if (!countryAlive(game.stage.countries.get(attackerId)) || !countryAlive(game.stage.countries.get(targetId))) return false;
  const dip = game.diplomacy;
  if (!dip || !dip.enabled) {
    const st = game.stage;
    return nativeAlliance(st.alliance(attackerId)) !== nativeAlliance(st.alliance(targetId));
  }
  const rel = getDiplomaticRelation(game, attackerId, targetId);
  if (rel === DIPLOMACY_STATE.WAR) return true;
  if (rel === DIPLOMACY_STATE.ALLIANCE) {
    const c1 = game.stage.countries.get(attackerId);
    const c2 = game.stage.countries.get(targetId);
    if (c1?.alliance === c2?.alliance) return false;
    return !aiControlled && dip.allowAlliedAttack;
  }
  // Peace state: Peace is strictly enforced. Cannot attack unless war is declared first.
  return false;
}

export function canCountryOccupyTerritory(game, attackerId, targetId, aiControlled = false) {
  if (!attackerId) return false;
  if (!countryAlive(game.stage.countries.get(attackerId))) return false;
  if (targetId && !countryAlive(game.stage.countries.get(targetId))) return false;
  if (!targetId || attackerId === targetId) return true;
  const dip = game.diplomacy;
  if (!dip || !dip.enabled) {
    const st = game.stage;
    return nativeAlliance(st.alliance(attackerId)) !== nativeAlliance(st.alliance(targetId));
  }
  const rel = getDiplomaticRelation(game, attackerId, targetId);
  if (rel === DIPLOMACY_STATE.WAR) return true;
  if (rel === DIPLOMACY_STATE.ALLIANCE) {
    const c1 = game.stage.countries.get(attackerId);
    const c2 = game.stage.countries.get(targetId);
    return c1?.alliance !== c2?.alliance && dip.allowAlliedOccupation;
  }
  // Peace state: Peace is strictly enforced. Cannot occupy neutral/peace territories.
  return false;
}

function removeDirectAlliances(dip, targetId) {
  const sTarget = String(targetId);
  let removed = 0;
  for (const [k, v] of Object.entries(dip.relations)) {
    if (v === DIPLOMACY_STATE.ALLIANCE) {
      const parts = k.split('_');
      if (parts[0] === sTarget || parts[1] === sTarget) {
        dip.relations[k] = DIPLOMACY_STATE.PEACE;
        removed++;
      }
    }
  }
  return removed;
}

export function warCascade(game, attacker, target) {
  if (!game || !attacker || !target || attacker === target) return [];
  const dip = game.diplomacy;
  if (!dip) return [];

  const st = game.stage;
  if (!st || !st.countries) return [];

  const allCountries = Array.from(st.countries.keys());
  if (!allCountries.includes(target)) return [];

  // Transitive closure of ALLIANCE relations starting from target, strictly excluding attacker
  const component = new Set([target]);
  const queue = [target];

  while (queue.length > 0) {
    const cur = queue.shift();
    for (const other of allCountries) {
      if (other === cur || other === attacker || component.has(other)) continue;
      const otherCountry = st.countries.get(other);
      if (otherCountry?.eliminated) continue;

      // Check if cur and other are allies
      if (getDiplomaticRelation(game, cur, other) === DIPLOMACY_STATE.ALLIANCE) {
        component.add(other);
        queue.push(other);
      }
    }
  }

  // Filter countries that will cascade into war with attacker:
  // Must not be target, must not be attacker, and must not ALREADY be at war with attacker
  const cascade = [];
  for (const c of component) {
    if (c === target || c === attacker) continue;
    if (getDiplomaticRelation(game, attacker, c) !== DIPLOMACY_STATE.WAR) {
      cascade.push(c);
    }
  }
  return cascade;
}

export function setDiplomaticRelation(game, first, second, state, reason = 'manual') {
  if (!first || !second || first === second) return false;
  if (!countryAlive(game.stage?.countries?.get(first)) || !countryAlive(game.stage?.countries?.get(second))) return false;
  const dip = ensureDiplomacyMeta(game);
  if (!dip) return false;
  const stVal = parseDiplomaticRelationState(state);
  if (stVal < DIPLOMACY_STATE.WAR || stVal > DIPLOMACY_STATE.ALLIANCE) return false;

  const key = relationKey(first, second);
  const prevRelation = getDiplomaticRelation(game, first, second);
  const old = dip.relations[key];
  dip.enabled = true;

  if (NEGOTIATED_REASONS.has(reason) && stVal !== prevRelation &&
      (stVal === DIPLOMACY_STATE.ALLIANCE || (stVal === DIPLOMACY_STATE.PEACE && prevRelation === DIPLOMACY_STATE.WAR))) {
    game.addReport?.({ category: 'diplomacy', kind: 'offerProposed', actors: [first, second],
      detail: { reason },
      factKey: reportFactKey(game.round, stVal === DIPLOMACY_STATE.ALLIANCE ? 'alliance' : 'peace', first, second),
      text: `${countryName(game, first)}向${countryName(game, second)}提出${stVal === DIPLOMACY_STATE.ALLIANCE ? '结盟提议' : '停战请求'}。`, importance: 2 });
  }

  if (NEGOTIATED_REASONS.has(reason) && stVal === DIPLOMACY_STATE.ALLIANCE) {
    const decision = evaluateAllianceAcceptance(game, first, second);
    if (!decision.accept) {
      rejectOffer(game, first, second, 'alliance', decision);
      return true;
    }
  }
  if (NEGOTIATED_REASONS.has(reason) && stVal === DIPLOMACY_STATE.PEACE && prevRelation === DIPLOMACY_STATE.WAR) {
    const decision = evaluatePeaceAcceptance(game, first, second);
    if (!decision.accept) {
      rejectOffer(game, first, second, 'peace', decision);
      return true;
    }
  }

  if (stVal === DIPLOMACY_STATE.WAR) {
    const truceUntil = dip.truceUntil?.[key] || 0;
    if (truceUntil > (game.round || 1) && reason !== 'war_cascade') {
      return true;
    }
  }

  if (stVal === DIPLOMACY_STATE.PEACE && prevRelation === DIPLOMACY_STATE.WAR && !coalitionPeaceAuthorized(game, first, second)) {
    requestCoalitionPeace(game, first, second, reason);
    return true;
  }

  // Calculate cascade before state mutation if this is a primary war declaration
  const cascadeTargets = (stVal === DIPLOMACY_STATE.WAR && reason !== 'war_cascade' && reason !== 'alliance_join_war')
    ? warCascade(game, first, second).filter(c => (dip.truceUntil?.[relationKey(first, c)] || 0) <= (game.round || 1))
    : [];

  dip.relations[key] = stVal;
  dip.revision = (dip.revision || 0) + 1;

  if (old !== stVal) {
    // 1. Declare War (WAR): deduct stability and initialize bilateral casualty ledger
    if (stVal === DIPLOMACY_STATE.WAR) {
      if (!dip.warLosses) dip.warLosses = {};
      dip.warLosses[key] = { [first]: 0, [second]: 0 };
      if (!dip.warLossesInd) dip.warLossesInd = {};
      dip.warLossesInd[key] = { [first]: 0, [second]: 0 };
      dip.warStartedRound[key] = game.round || 1;
      const hadNap = hasNap(game, first, second);
      clearNap(game, first, second);

      // Deduct stability only once for the primary declaration (not for cascades / alliance join)
      if (!SKIP_WAR_STABILITY.has(reason)) {
        if (!dip.lastWarDeclaredRound) dip.lastWarDeclaredRound = {};
        dip.lastWarDeclaredRound[first] = game.round || 1;

        const isBetrayal = (prevRelation === DIPLOMACY_STATE.ALLIANCE || old === DIPLOMACY_STATE.ALLIANCE) ||
          cascadeTargets.some(c => getDiplomaticRelation(game, first, c) === DIPLOMACY_STATE.ALLIANCE);
        if (isBetrayal || hadNap) {
          game.changeStability?.(first, -20, isBetrayal ? 'alliance_betrayal' : 'nap_betrayal');
        } else {
          const mul = ordinaryDeclareMultiplier(game.stage?.data?.traitCatalog, game.stage?.countries?.get(first));
          game.changeStability?.(first, -Math.max(1, Math.round(12 * mul)), 'declare_war');
        }
        applyAttackedRally(game, second, reason);
      }

      // Execute cascade war declarations and write war reports
      if (reason !== 'war_cascade' && cascadeTargets.length > 0) {
        for (const c of cascadeTargets) {
          // Record war report into scenarioEvents history and definitions
          const se = game.scenarioEvents;
          if (se) {
            const round = game.round || 1;
            const evtId = `war_cascade_${first}_${c}_r${round}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            if (!se.history) se.history = [];
            se.history.push(evtId);
            const attackerName = countryName(game, first);
            const targetName = countryName(game, second);
            const cascadedName = countryName(game, c);
            const def = {
              id: evtId,
              type: 'report',
              title: `同盟参战：${cascadedName}`,
              body: `${attackerName}对${targetName}宣战，同盟国${cascadedName}依据同盟条约对${attackerName}宣战。`
            };
            if (!se.definitions) se.definitions = [];
            se.definitions.push(def);
            game.emit(EV.SCENARIO_EVENT, { event: def, phase: 'resolved' });
          }

          // Enter war with cascaded ally (reason: 'war_cascade' prevents recursion and duplicate stability deduction)
          setDiplomaticRelation(game, first, c, DIPLOMACY_STATE.WAR, 'war_cascade');
        }
      }

      // Historical scenario responses:
      const p1 = first, p2 = second;
      const isGermanWar = (p1 === 'de' || p2 === 'de');
      const other = (p1 === 'de' ? p2 : p1);
      const neutrals = ['nl', 'be', 'dk', 'no', 'yu', 'gr'];

      // §3.4: German declaration of war on neutral country -> GB & FR ally with that country
      if (isGermanWar && neutrals.includes(other)) {
        const se = game.scenarioEvents;
        const evtId = `neutral_allied_${other}`;
        if (se && !se.history.includes(evtId)) {
          se.history.push(evtId);
          const cName = countryName(game, other);
          const def = {
            id: evtId,
            type: 'report',
            title: `英法驰援${cName}`,
            body: `德国向${cName}宣战，英国与法国正式与该国结盟。`
          };
          if (!se.definitions.some(d => d.id === evtId)) se.definitions.push(def);
          setDiplomaticRelation(game, 'gb', other, DIPLOMACY_STATE.ALLIANCE, 'allies_protect_neutral');
          setDiplomaticRelation(game, 'fr', other, DIPLOMACY_STATE.ALLIANCE, 'allies_protect_neutral');
          game.emit(EV.SCENARIO_EVENT, { event: def, phase: 'resolved' });
        }
      }

      // §3.3: German-Soviet war -> GB & FR ally with USSR
      if ((p1 === 'de' && p2 === 'ru') || (p1 === 'ru' && p2 === 'de')) {
        const se = game.scenarioEvents;
        const evtId = 'ussr_allied_west';
        if (se && !se.history.includes(evtId)) {
          se.history.push(evtId);
          const def = {
            id: evtId,
            type: 'report',
            title: '反法西斯同盟建立',
            body: '苏德战争爆发，英国、法国与苏联正式结为同盟。'
          };
          if (!se.definitions.some(d => d.id === evtId)) se.definitions.push(def);
          setDiplomaticRelation(game, 'gb', 'ru', DIPLOMACY_STATE.ALLIANCE, 'barbarossa_allies_ussr');
          setDiplomaticRelation(game, 'fr', 'ru', DIPLOMACY_STATE.ALLIANCE, 'barbarossa_allies_ussr');
          game.emit(EV.SCENARIO_EVENT, { event: def, phase: 'resolved' });
        }
      }
    }
    // 2. Sue for Peace (PEACE): pay war reparations to opponent and deduct stability
    else if (stVal === DIPLOMACY_STATE.PEACE && (old === DIPLOMACY_STATE.WAR || prevRelation === DIPLOMACY_STATE.WAR)) {
      const bill = computeReparations(game, first, second);
      const proposerWallet = countryWallet(game, first);
      const opponentWallet = countryWallet(game, second);
      if (proposerWallet && opponentWallet) {
        proposerWallet.money = (proposerWallet.money || 0) - bill.paid;                 // may go negative: always paid in full
        proposerWallet.industry = (proposerWallet.industry || 0) - bill.industry;
        opponentWallet.money = (opponentWallet.money || 0) + bill.paid;
        opponentWallet.industry = (opponentWallet.industry || 0) + bill.industry;
        game.emit(EV.RESOURCES_CHANGED, { country: first, money: proposerWallet.money, industry: proposerWallet.industry });
        game.emit(EV.RESOURCES_CHANGED, { country: second, money: opponentWallet.money, industry: opponentWallet.industry });
        const stabPenalty = bill.isBroke ? -15 : (reason && String(reason).startsWith('capitulation') ? -8 : -10);
        game.changeStability?.(first, stabPenalty, bill.isBroke ? 'peace_concession_bankruptcy' : 'peace_concession');
        if (!String(reason || '').startsWith('capitulation')) {
          game.changeStability?.(second, 6, 'peace_victor');
        }
        game.emit(EV.WAR_REPARATIONS_PAID, {
          from: first, to: second,
          reparations: bill.raw, paid: bill.paid, industry: bill.industry, isBroke: bill.isBroke,
          casualtyBill: bill.casualtyBill, tributeFloor: bill.tributeFloor,
        });
      }
      if (dip.warLosses) {
        dip.warLosses[key] = { [first]: 0, [second]: 0 };
      }
      if (dip.warLossesInd) dip.warLossesInd[key] = { [first]: 0, [second]: 0 };
      if (dip.warStartedRound) delete dip.warStartedRound[key];
      dip.truceUntil[key] = (game.round || 1) + 5;
      notifyPeaceAllies(game, first, second);
    } else if (stVal === DIPLOMACY_STATE.ALLIANCE && prevRelation !== DIPLOMACY_STATE.ALLIANCE) {
      joinAllianceWars(game, first, second);
    }

    game.emit(EV.DIPLOMACY_CHANGED, {
      first,
      second,
      state: stVal,
      previousState: prevRelation,
      stateName: relationToString(stVal),
      reason,
    });
  }
  return true;
}

export function registerDiplomaticHostility(game, attackerId, targetId, reason = 'hostile action') {
  if (!attackerId || !targetId || attackerId === targetId) return false;
  const dip = game.diplomacy;
  if (!dip || !dip.enabled) return true;

  const rel = getDiplomaticRelation(game, attackerId, targetId);
  if (rel === DIPLOMACY_STATE.WAR) return true;
  if (rel === DIPLOMACY_STATE.PEACE) {
    setDiplomaticRelation(game, attackerId, targetId, DIPLOMACY_STATE.WAR, reason);
    return true;
  }
  // If they were allies
  if (!dip.allowAlliedAttack) return false;
  if (dip.betrayalPolicy === 'war') {
    removeDirectAlliances(dip, attackerId);
    setDiplomaticRelation(game, attackerId, targetId, DIPLOMACY_STATE.WAR, reason || 'alliance betrayal');
    return true;
  }
  return true;
}

export function registerDiplomaticOccupation(game, attackerId, targetId, reason = 'occupation') {
  if (!attackerId || !targetId || attackerId === targetId) return false;
  const dip = game.diplomacy;
  if (!dip || !dip.enabled) return true;

  const rel = getDiplomaticRelation(game, attackerId, targetId);
  if (rel !== DIPLOMACY_STATE.ALLIANCE) {
    return registerDiplomaticHostility(game, attackerId, targetId, reason);
  }
  if (!dip.allowAlliedOccupation) return false;
  if (dip.alliedOccupationPolicy === 'war') {
    removeDirectAlliances(dip, attackerId);
    setDiplomaticRelation(game, attackerId, targetId, DIPLOMACY_STATE.WAR, reason || 'allied territory occupation');
    return true;
  }
  return true;
}

function joinAllianceWars(game, a, b) {
  const toWar = [];
  const round = game.round || 1;
  for (const c of livingCountries(game)) {
    if (c.id === a || c.id === b) continue;
    const aRel = getDiplomaticRelation(game, a, c.id);
    const bRel = getDiplomaticRelation(game, b, c.id);
    if (aRel === DIPLOMACY_STATE.ALLIANCE || bRel === DIPLOMACY_STATE.ALLIANCE) continue;
    if (hasNap(game, a, c.id) || hasNap(game, b, c.id)) continue;
    const aWar = aRel === DIPLOMACY_STATE.WAR;
    const bWar = bRel === DIPLOMACY_STATE.WAR;
    const truce = (game.diplomacy.truceUntil?.[relationKey(a, c.id)] || 0) > round
      || (game.diplomacy.truceUntil?.[relationKey(b, c.id)] || 0) > round;
    if (truce) continue;
    if (aWar && !bWar) toWar.push([b, c.id]);
    if (bWar && !aWar) toWar.push([a, c.id]);
  }
  for (const [x, y] of toWar) {
    setDiplomaticRelation(game, x, y, DIPLOMACY_STATE.WAR, 'alliance_join_war');
  }
}

function isPlayerCountry(game, id) {
  // 桥接(LLM)接管的国家也要经"同意"才能被 AI 强行停战/结盟/互不侵犯：提议变成待决事件，由接管方 resolveEventDecision 接受或拒绝
  if (Array.isArray(game.bridgeOpponentCountries) && game.bridgeOpponentCountries.includes(id)) return true;
  return game.humanCountries ? game.humanCountries.has(id) : id === game.player;
}

function offerOnCooldown(game, countryId, minGap = 3) {
  const last = game.diplomacy?.lastOfferRound?.[countryId];
  if (last == null) return false;
  return (game.round || 1) - last < minGap;
}

function markOffer(game, countryId) {
  if (!game.diplomacy.lastOfferRound) game.diplomacy.lastOfferRound = {};
  game.diplomacy.lastOfferRound[countryId] = game.round || 1;
}

export function registerCapitalFall(game, countryId) {
  const dip = ensureDiplomacyMeta(game);
  if (!dip || dip.capitalFallen[countryId]) return false;
  const capId = dip.capitals[countryId];
  const area = capId == null ? null : game.stage.st(capId);
  const occupier = area?.transitOwner||area?.country;
  if (!occupier || occupier === countryId ||
      getDiplomaticRelation(game, countryId, occupier) !== DIPLOMACY_STATE.WAR) return false;
  const info = game.stage.countries.get(countryId);
  const catalog = game.stage?.data?.traitCatalog;
  const depth = traitDef(catalog, info, 'depth');
  const basePen = catalog?.occupation?.capitalPenalty ?? 35;
  const pen = depth?.capitalPenaltyScale != null ? Math.max(1, Math.round(basePen * depth.capitalPenaltyScale)) : basePen;
  dip.capitalFallen[countryId] = { round: game.round || 1, by: occupier };
  game.changeStability(countryId, -pen, 'capital_fallen');
  game.changeStability(occupier, 4, 'enemy_capital_taken');
  pushDiplomacyReport(game, `capital_fallen_${countryId}_r${game.round || 1}`,
    `${countryName(game, countryId)}首都沦陷`,
    `${countryName(game, occupier)}占领了${countryName(game, countryId)}的首都。${isSandbox(game)?'是否灭亡由沙盒国家失败条件决定。':'该国稳定度大幅下滑。'}`);
  return true;
}

export function tickCountryStability(game, countryId) {
  if (isSandbox(game)) return;
  const dip = ensureDiplomacyMeta(game);
  if (!dip || !game.changeStability) return;
  const info = game.stage.countries.get(countryId);
  if (!countryAlive(info)) return;

  registerCapitalFall(game, countryId);
  const capitalId = dip.capitals[countryId];
  if (capitalId != null && game.stage.territoryOwner(capitalId) === countryId) delete dip.capitalFallen[countryId];

  const atWar = hasLivingWarOpponent(game, countryId);
  const stab = game.getStability(countryId);
  if (!atWar && stab < 100) {
    game.changeStability(countryId, stab < 40 ? 3 : 2, 'peacetime_recovery');
  }

  const catalog = game.stage?.data?.traitCatalog;
  if (dip.capitalFallen?.[countryId]) {
    const depth = traitDef(catalog, info, 'depth');
    const every = depth?.occupyDrainEvery ?? catalog?.occupation?.drainEvery ?? 2;
    const drain = depth?.occupyDrain ?? catalog?.occupation?.drain ?? 1;
    if (every > 0 && drain > 0 && (game.round || 1) % every === 0) {
      game.changeStability(countryId, -drain, 'occupied_homeland');
    }
  }

  const weary = traitDef(catalog, info, 'war_weary');
  if (weary && atWar) {
    const fought = roundsAtWar(game, countryId);
    const every = weary.drainEvery || 3;
    if (fought >= (weary.drainAfter ?? 8) && every > 0 && fought % every === 0) {
      game.changeStability(countryId, -(weary.drainPerTurn || 1), 'war_weariness');
    }
  }

  const newStab = game.getStability(countryId);
  if (newStab < 30) {
    const last = dip.lastUnrestRound[countryId] || 0;
    if ((game.round || 1) - last >= 4) {
      dip.lastUnrestRound[countryId] = game.round || 1;
      const wallet = countryWallet(game, countryId);
      const iron = traitDef(catalog, info, 'iron_fist');
      let leak = Math.min(wallet?.money || 0, Math.max(8, Math.floor((wallet?.money || 0) * 0.06)));
      if (iron?.unrestLeakScale != null) leak = Math.floor(leak * iron.unrestLeakScale);
      if (wallet && leak > 0) {
        wallet.money -= leak;
        game.emit(EV.RESOURCES_CHANGED, { country: countryId, money: wallet.money, industry: wallet.industry });
      }
      pushDiplomacyReport(
        game,
        `unrest_${countryId}_r${game.round || 1}`,
        `${countryName(game, countryId)}国内动荡`,
        `稳定度过低，${countryName(game, countryId)}出现抗议与逃税，金库流失 $${leak}。`,
      );
      const defectBelow = iron?.defectBelow ?? 15;
      if (newStab < defectBelow) maybeDefectLand(game, countryId);
    }
  }
}

function maybeDefectLand(game, countryId) {
  const capId = game.diplomacy?.capitals?.[countryId];
  const st = game.stage;
  const candidates = st.areas.filter(a => (a.transitOwner||a.country) === countryId && !a.sea && a.id !== capId && (!a.armies || a.armies.length === 0));
  if (!candidates.length) return;
  const area = game.rng?.pick ? game.rng.pick(candidates) : candidates[0];
  let occupier = null;
  for (const nid of (st.adjE.get(area.id) || [])) {
    const n = st.st(nid);
    if (!n || n.sea || !n.country || n.country === countryId) continue;
    if (getDiplomaticRelation(game, countryId, n.country) === DIPLOMACY_STATE.WAR) {
      occupier = n.country;
      break;
    }
  }
  if (!occupier) return;
  const prev = area.country;
  area.country = occupier;
  game.emit(EV.AREA_CAPTURED, { area: area.id, from: prev, to: occupier, cause: 'unrestDefect' });
  pushDiplomacyReport(
    game,
    `defect_${countryId}_${area.id}_r${game.round || 1}`,
    `${countryName(game, countryId)}边地脱离`,
    `动荡中的无守备地区落入交战国${countryName(game, occupier)}之手。`,
  );
}

export function evaluateAiCapitulation(game, countryId) {
  if (isSandbox(game)) return null;
  const dip = ensureDiplomacyMeta(game);
  if (!dip) return null;
  const info = game.stage.countries.get(countryId);
  if (!countryAlive(info) || dip.capitulated[countryId]) return null;
  const capId = dip.capitals[countryId];
  if (capId == null) return null;
  const area = game.stage.st(capId);
  const occupier=area?.transitOwner||area?.country;
  if (!occupier || occupier === countryId) return null;
  if (getDiplomaticRelation(game, countryId, occupier) !== DIPLOMACY_STATE.WAR) return null;
  const lands = countLands(game, countryId);
  const orig = dip.originalLands[countryId] || lands;
  if (lands > 3 && lands > orig * 0.25) return null;
  return { occupier, lands, orig };
}

export function applyCapitulation(game, countryId, occupier) {
  if (isSandbox(game)) return false;
  const dip = ensureDiplomacyMeta(game);
  if (!dip) return false;
  setDiplomaticRelation(game, countryId, occupier, DIPLOMACY_STATE.PEACE, 'capitulation');
  for (const c of livingCountries(game)) {
    if (c.id === countryId || c.id === occupier) continue;
    if (getDiplomaticRelation(game, countryId, c.id) !== DIPLOMACY_STATE.WAR) continue;
    if (getDiplomaticRelation(game, occupier, c.id) === DIPLOMACY_STATE.ALLIANCE) {
      setDiplomaticRelation(game, countryId, c.id, DIPLOMACY_STATE.PEACE, 'capitulation_ally');
    }
  }
  dip.capitulated[countryId] = { to: occupier, round: game.round || 1 };
  const crushed = Math.min(game.getStability(countryId), 28);
  game.setStability?.(countryId, crushed, 'capitulation');
  game.changeStability?.(occupier, 8, 'accepted_capitulation');
  game.emit(EV.COUNTRY_CAPITULATED, { country: countryId, to: occupier, round: game.round || 1 });
  pushDiplomacyReport(
    game,
    `capitulation_${countryId}_${occupier}_r${game.round || 1}`,
    `${countryName(game, countryId)}投降`,
    `${countryName(game, countryId)}在首都沦陷后向${countryName(game, occupier)}求和停战，残存领地仍由其管辖。`,
  );
  return true;
}

function getRecentNetLandLoss(game, countryId) {
  const dip = game.diplomacy;
  const hist = dip?.landHistory?.[countryId] || [];
  const currentLands = game.stage.areas.filter(a => (a.transitOwner||a.country) === countryId && !a.sea).length;
  if (!hist.length) return 0;
  const round = game.round || 1;
  const targetRound = Math.max(1, round - 3);
  let refLands = hist[0].lands;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].round <= targetRound) {
      refLands = hist[i].lands;
      break;
    }
  }
  return Math.max(0, refLands - currentLands);
}

function isCapitalThreatenedOrFallen(game, countryId) {
  const dip = game.diplomacy;
  if (dip?.capitalFallen?.[countryId]) return true;
  const capId = dip?.capitals?.[countryId];
  if (capId == null) return false;
  const capArea = game.stage.st(capId);
  if (!capArea || (capArea.transitOwner||capArea.country) !== countryId) return true;
  for (const nid of (game.stage.adjE.get(capId) || [])) {
    const na = game.stage.st(nid);
    if (na && na.country && na.armies.length > 0 && getDiplomaticRelation(game, countryId, na.country) === DIPLOMACY_STATE.WAR) {
      return true;
    }
  }
  return false;
}

export function evaluateAiPeaceOffer(game, countryId) {
  const info = game.stage.countries.get(countryId);
  if (!countryAlive(info)) return null;
  const stability = game.getStability ? game.getStability(countryId) : 100;
  const p = countryPower(game, countryId);
  const orig = game.diplomacy?.originalLands?.[countryId] ?? p.lands;

  const tuning = peaceTuning(game.stage?.data?.traitCatalog, info);
  const lossThreshold = tuning?.lossThreshold || 0.15;
  const powerRatioThreshold = tuning?.powerRatioThreshold || 0.50;

  const netLostRecent = getRecentNetLandLoss(game, countryId);
  const lostRatio = orig > 0 ? (netLostRecent / orig) : 0;
  const capId = game.diplomacy?.capitals?.[countryId];
  const capArea = capId != null ? game.stage.st(capId) : null;
  const capitalFallen = Boolean(game.diplomacy?.capitalFallen?.[countryId] || (capArea && (capArea.transitOwner||capArea.country) !== countryId));
  const capitalThreat = isCapitalThreatenedOrFallen(game, countryId);
  const desperate = stability < 22 || (p.lands <= 2 && hasLivingWarOpponent(game, countryId));

  let best = null;
  for (const other of livingCountries(game)) {
    if (other.id === countryId) continue;
    if (getDiplomaticRelation(game, countryId, other.id) !== DIPLOMACY_STATE.WAR) continue;

    const dur = warDuration(game, countryId, other.id);
    // 战争至少要持续 3 回合；只有首都已经沦陷时，才允许提前求和。
    if (dur < 3 && !capitalFallen) continue;

    // 已经欠债很深或赔款会导致重债的国家，如果并未濒临亡国，更谨慎（不轻率求和）
    const bill = computeReparations(game, countryId, other.id);
    const wallet = countryWallet(game, countryId);
    const curMoney = wallet?.money || 0;
    const curInd = wallet?.industry || 0;
    const postMoney = curMoney - bill.paid;
    const postInd = curInd - bill.industry;
    const isDeepInDebt = curMoney < -200 || curInd < -100 || postMoney < -400 || postInd < -200;
    if (isDeepInDebt && !desperate && !capitalFallen) continue;

    const peaceKey = relationKey(countryId, other.id);
    const dirKey = `${countryId}_${other.id}`;
    const lastOffer = Math.max(
      game.diplomacy?.peaceCooldown?.[dirKey] || -99,
      game.diplomacy?.peaceCooldown?.[peaceKey] || -99
    );
    if ((game.round || 1) - lastOffer < DEFAULT_PEACE_REJECT_COOLDOWN_ROUNDS) continue;

    const t = countryPower(game, other.id);
    const powerRatio = t.power > 0 ? (p.power / t.power) : 1.0;

    const wantsPeace = (lostRatio >= lossThreshold) ||
                       (powerRatio < powerRatioThreshold && (netLostRecent > 0 || p.lands < orig * 0.85)) ||
                       capitalThreat ||
                       desperate;

    if (!wantsPeace) continue;

    const isPlayer = isPlayerCountry(game, other.id);
    if (isPlayer) {
      const score = 100 + (capitalThreat ? 50 : 0) + (desperate ? 40 : 0) + Math.round((1 - powerRatio) * 30);
      if (!best || score > best.score) {
        best = {
          other: other.id,
          score,
          decision: { accept: true, score: 50, why: 'player-decision-popup' },
          desperate,
          isPlayer: true
        };
      }
      continue;
    }

    const decision = evaluatePeaceAcceptance(game, countryId, other.id);
    if (!decision.accept && !desperate) continue;

    const score = decision.score + dur + (desperate ? 10 : 0) + (capitalThreat ? 20 : 0);
    if (!best || score > best.score) {
      best = { other: other.id, score, decision, desperate, isPlayer: false };
    }
  }

  if (!best) return null;

  const offerKey = relationKey(countryId, best.other);
  const dirOfferKey = `${countryId}_${best.other}`;
  if (!game.diplomacy.peaceCooldown) game.diplomacy.peaceCooldown = {};
  game.diplomacy.peaceCooldown[offerKey] = game.round || 1;
  game.diplomacy.peaceCooldown[dirOfferKey] = game.round || 1;

  if (!game.diplomacy.peaceOffers) game.diplomacy.peaceOffers = [];
  game.diplomacy.peaceOffers.push({
    round: game.round || 1,
    proposer: countryId,
    target: best.other,
    origLands: orig,
    currentLands: p.lands,
    landRatio: +(p.lands / Math.max(1, orig)).toFixed(2),
  });

  return {
    type: 'setDiplomacy',
    first: countryId,
    second: best.other,
    state: 'peace',
    reason: stability < 30 ? 'ai_low_stability_peace' : 'ai_propose_peace',
    decision: best.decision,
  };
}

export function evaluateAiAllianceProposal(game, countryId) {
  const info = game.stage.countries.get(countryId);
  if (!countryAlive(info)) return null;
  if (!hasLivingWarOpponent(game, countryId)) return null;
  const p = countryPower(game, countryId);
  const orig = game.diplomacy?.originalLands?.[countryId] ?? p.lands;
  if (p.lands > orig * 0.85 && countryPower(game, countryId).power > 400) return null;

  let best = null;
  for (const other of livingCountries(game)) {
    if (other.id === countryId) continue;
    const rel = getDiplomaticRelation(game, countryId, other.id);
    if (rel !== DIPLOMACY_STATE.PEACE) continue;
    const decision = evaluateAllianceAcceptance(game, countryId, other.id);
    if (!decision.accept) continue;
    if (!best || decision.score > best.score) best = { other: other.id, score: decision.score, decision };
  }
  if (!best) return null;
  return {
    type: 'setDiplomacy',
    first: countryId,
    second: best.other,
    state: 'alliance',
    reason: 'ai_propose_alliance',
    decision: best.decision,
  };
}

export function evaluateAiNapProposal(game, countryId) {
  const info = game.stage.countries.get(countryId);
  if (!countryAlive(info)) return null;
  if (!hasLivingWarOpponent(game, countryId)) return null;
  let best = null;
  for (const other of livingCountries(game)) {
    if (other.id === countryId) continue;
    if (getDiplomaticRelation(game, countryId, other.id) !== DIPLOMACY_STATE.PEACE) continue;
    if (hasNap(game, countryId, other.id)) continue;
    if (!shareBorder(game, countryId, other.id) && !STUBBORN_NEUTRALS.has(other.id)) continue;
    const decision = evaluateNapAcceptance(game, countryId, other.id);
    if (!decision.accept) continue;
    if (!best || decision.score > best.score) best = { other: other.id, score: decision.score, decision };
  }
  if (!best) return null;
  return { type: 'proposeDiplomacy', first: countryId, second: best.other, action: 'nap', reason: 'ai_propose_nap', decision: best.decision };
}

function needsHumanConsent(game, cmd) {
  // 需要双方同意的外交(停战/结盟/互不侵犯)：只要"被提议方"不是内置 AI(人类玩家 或 LLM&MCP 接管国)，就必须它自己点头才生效；
  // 与提议方是谁无关(内置 AI→人类、内置 AI→LLM、LLM→人类、人类→LLM 都要经对方同意)。被提议方是内置 AI 时仍由 AI 自己评估。
  if (!cmd.first || !cmd.second || cmd.first === cmd.second || !isPlayerCountry(game, cmd.second)) return false;
  if (cmd.reason === 'event_action' || cmd.reason === 'player_accepted_offer') return false;   // 对方已同意/剧本强制
  return (cmd.type === 'setDiplomacy' && ['peace', 'alliance'].includes(cmd.state)) ||
    (cmd.type === 'proposeDiplomacy' && ['peace', 'alliance', 'nap'].includes(cmd.action));
}

function consentOfferReady(game, first, second, action) {
  const key = `${first}_${second}_${action}`;
  const last = game.diplomacy?.lastOfferRound?.[key];
  if (last != null && (game.round || 1) - last < DEFAULT_PEACE_REJECT_COOLDOWN_ROUNDS) return false;
  if (action === 'peace') {
    const pair = relationKey(first, second);
    const rejected = Math.max(game.diplomacy?.peaceCooldown?.[`${first}_${second}`] ?? -99,
      game.diplomacy?.peaceCooldown?.[pair] ?? -99);
    if ((game.round || 1) - rejected < DEFAULT_PEACE_REJECT_COOLDOWN_ROUNDS) return false;
  }
  game.diplomacy.lastOfferRound ||= {};
  game.diplomacy.lastOfferRound[key] = game.round || 1;
  return true;
}

function deliverOfferToTarget(game, cmd) {
  const target = cmd.second;
  if (isPlayerCountry(game, target) && cmd.type === 'setDiplomacy') {
    const action = cmd.state === 'peace' ? 'peace' : cmd.state === 'alliance' ? 'alliance' : null;
    if (action) {
      if (!consentOfferReady(game, cmd.first, target, action)) return false;
      const bill = action === 'peace' ? computeReparations(game, cmd.first, target) : null, reparations = bill ? bill.raw : 0, repInd = bill ? bill.industry : 0;
      const aName = countryName(game, cmd.first);
      const title = action === 'peace' ? `${aName}请求停战` : `${aName}提议结盟`;
      const body = action === 'peace'
        ? `${aName}请求停战，将支付赔款 $${reparations}、工业 ${repInd}（其在战争中击毁我方部队造价的 ${bill.rate.toFixed(1)} 倍，不足部分以负债支付）。是否接受？`
        : `${aName}提议缔结同盟。一旦结盟，双方将共同对现有敌人作战。`;
      queuePlayerDecision(game, {
        id: `offer_${action}_${cmd.first}_${target}_r${game.round || 1}`,
        type: 'decision',
        targetCountry: target,
        title,
        body,
        choices: [
          {
            id: 'accept',
            text: action === 'peace' ? '接受和约' : '接受结盟',
            actions: [{ type: 'setDiplomacy', first: cmd.first, second: target, state: cmd.state, reason: 'player_accepted_offer' }],
          },
          { id: 'reject', text: '拒绝', actions: [{ type: 'rejectPeaceOffer', first: cmd.first, second: target, action }] },
        ],
      });
      game.addReport?.({ category: 'diplomacy', kind: 'offerProposed', actors: [cmd.first, target],
        detail: { reason: cmd.reason || 'ai_propose_' + action },
        factKey: reportFactKey(game.round, action, cmd.first, target),
        text: `${aName}向${countryName(game, target)}提出${action === 'peace' ? '停战请求' : '结盟提议'}。`, importance: 2 });
      if (action === 'peace') {
        const catalog = game.stage?.data?.traitCatalog;
        const proposerInfo = game.stage?.countries?.get(cmd.first);
        const cost = peaceProposalStabilityCost(catalog, proposerInfo);
        game.changeStability?.(cmd.first, -cost, 'propose_peace');
      }
      markOffer(game, cmd.first);
      return true;
    }
  }
  if (cmd.type === 'proposeDiplomacy' && cmd.action === 'nap') {
    if (isPlayerCountry(game, target) && !consentOfferReady(game, cmd.first, target, 'nap')) return false;
    proposeDiplomaticAction(game, cmd.first, cmd.second, 'nap', cmd.reason || 'ai_propose_nap');
    markOffer(game, cmd.first);
    return true;
  }
  if (cmd.type === 'setDiplomacy' && cmd.state === 'peace') {
    const catalog = game.stage?.data?.traitCatalog;
    const proposerInfo = game.stage?.countries?.get(cmd.first);
    const cost = peaceProposalStabilityCost(catalog, proposerInfo);
    game.changeStability?.(cmd.first, -cost, 'propose_peace');
  }
  setDiplomaticRelation(game, cmd.first, cmd.second, cmd.state, cmd.reason);
  markOffer(game, cmd.first);
  return true;
}

export function proposeDiplomaticAction(game, first, second, action, reason = 'propose') {
  if (!countryAlive(game.stage?.countries?.get(first)) || !countryAlive(game.stage?.countries?.get(second))) return { ok: false, reason: 'country-eliminated' };
  if (!first || !second || first === second) return { ok: false, reason: 'invalid' };
  ensureDiplomacyMeta(game);
  if (action === 'nap') {
    if (getDiplomaticRelation(game, first, second) !== DIPLOMACY_STATE.PEACE) return { ok: false, reason: 'not-peace' };
    if (hasNap(game, first, second)) return { ok: false, reason: 'already-nap' };
    const force = reason === 'player_accepted_offer' || reason === 'event_action';
    if (isPlayerCountry(game, second) && !force) {
      const aName = countryName(game, first);
      queuePlayerDecision(game, {
        id: `offer_nap_${first}_${second}_r${game.round || 1}`,
        type: 'decision',
        targetCountry: second,
        title: `${aName}提议互不侵犯`,
        body: `${aName}希望签订互不侵犯条约。撕毁条约再宣战将付出背盟级别的稳定度代价。`,
        choices: [
          { id: 'accept', text: '签署条约', actions: [{ type: 'setPact', first, second, pact: 'nap', reason: 'player_accepted_offer' }] },
          { id: 'reject', text: '拒绝', actions: [{ type: 'rejectPeaceOffer', first, second, action: 'nap' }] },
        ],
      });
      game.addReport?.({ category: 'diplomacy', kind: 'offerProposed', actors: [first, second],
        detail: { reason: reason || 'ai_propose_nap' },
        factKey: reportFactKey(game.round, 'nap', first, second),
        text: `${aName}向${countryName(game, second)}提出互不侵犯条约。`, importance: 2 });
      return { ok: true, accepted: 'pending' };
    }
    const decision = evaluateNapAcceptance(game, first, second);
    if (!decision.accept && !force) {
      rejectOffer(game, first, second, 'nap', decision);
      return { ok: true, accepted: false, decision };
    }
    setNap(game, first, second, reason);
    game.emit(EV.DIPLOMACY_OFFER_RESOLVED, { first, second, action: 'nap', accepted: true, score: decision.score, why: decision.why });
    return { ok: true, accepted: true, decision };
  }
  if (action === 'alliance') {
    const before = getDiplomaticRelation(game, first, second);
    setDiplomaticRelation(game, first, second, DIPLOMACY_STATE.ALLIANCE, reason === 'player_action' ? 'player_action' : 'ai_propose_alliance');
    const after = getDiplomaticRelation(game, first, second);
    return { ok: true, accepted: after === DIPLOMACY_STATE.ALLIANCE && before !== DIPLOMACY_STATE.ALLIANCE };
  }
  if (action === 'peace') {
    if (getDiplomaticRelation(game, first, second) !== DIPLOMACY_STATE.WAR) return { ok: false, reason: 'not-at-war' };

    // 玩家提议不受 AI 冷却影响；AI 提议需尊重被拒后的冷却期
    const isPlayer = isPlayerCountry(game, first);
    if (!isPlayer) {
      const peaceKey = relationKey(first, second);
      const dirKey = `${first}_${second}`;
      const lastReject = Math.max(
        game.diplomacy?.peaceCooldown?.[dirKey] || -99,
        game.diplomacy?.peaceCooldown?.[peaceKey] || -99
      );
      if ((game.round || 1) - lastReject < DEFAULT_PEACE_REJECT_COOLDOWN_ROUNDS) {
        return { ok: false, reason: 'cooldown' };
      }
    }

    // 提出停战扣除稳定度
    const catalog = game.stage?.data?.traitCatalog;
    const proposerInfo = game.stage?.countries?.get(first);
    const cost = peaceProposalStabilityCost(catalog, proposerInfo);
    game.changeStability?.(first, -cost, 'propose_peace');

    const force = reason === 'player_accepted_offer' || reason === 'event_action';
    if (!force) {
      const decision = evaluatePeaceAcceptance(game, first, second);
      if (!decision.accept) {
        rejectOffer(game, first, second, 'peace', decision);
        return { ok: true, accepted: false, decision };
      }
    }
    const before = getDiplomaticRelation(game, first, second);
    setDiplomaticRelation(game, first, second, DIPLOMACY_STATE.PEACE, reason === 'player_action' ? 'player_action' : 'ai_propose_peace');
    const after = getDiplomaticRelation(game, first, second);
    return { ok: true, accepted: after === DIPLOMACY_STATE.PEACE && before === DIPLOMACY_STATE.WAR };
  }
  return { ok: false, reason: 'unknown-action' };
}

// Register `setDiplomacy` command

function finishWarInvitation(game, invitation, accepted) {
  if (invitation.status !== 'pending') return;
  const { inviter, ally, enemy } = invitation;
  const valid = countryAlive(game.stage.countries.get(inviter)) && countryAlive(game.stage.countries.get(ally))
    && countryAlive(game.stage.countries.get(enemy))
    && getDiplomaticRelation(game, inviter, ally) === DIPLOMACY_STATE.ALLIANCE
    && getDiplomaticRelation(game, inviter, enemy) === DIPLOMACY_STATE.WAR
    && getDiplomaticRelation(game, ally, enemy) !== DIPLOMACY_STATE.ALLIANCE
    && !hasNap(game, ally, enemy)
    && (game.diplomacy.truceUntil?.[relationKey(ally, enemy)] || 0) <= (game.round || 1);
  invitation.status = accepted && valid ? 'accepted' : accepted ? 'expired' : 'declined';
  if (invitation.status === 'accepted') setDiplomaticRelation(game, ally, enemy, 'war', 'alliance_join_war');
  game.addReport?.({ category: 'diplomacy', kind: 'warInvitation', actors: [inviter, ally, enemy],
    detail: { invitationId: invitation.id, status: invitation.status },
    factKey: invitation.id + '_' + invitation.status, importance: 2,
    text: `${countryName(game, ally)}${invitation.status === 'accepted' ? '响应盟友邀请，加入对' : invitation.status === 'expired' ? '的参战邀请已失效，目标：' : '拒绝参加对'}${countryName(game, enemy)}的战争。` });
}

export function inviteWarAllies(game, inviter, enemy, selected = true) {
  if (getDiplomaticRelation(game, inviter, enemy) !== DIPLOMACY_STATE.WAR) return;
  const records = game.diplomacy.warInvitations ||= {};
  for (const country of livingCountries(game)) {
    const ally = country.id;
    if (ally === inviter || ally === enemy || (Array.isArray(selected) && !selected.includes(ally))) continue;
    if (getDiplomaticRelation(game, inviter, ally) !== DIPLOMACY_STATE.ALLIANCE
      || getDiplomaticRelation(game, ally, enemy) === DIPLOMACY_STATE.WAR) continue;
    const previous = Object.values(records).find(x => x.inviter === inviter && x.ally === ally && x.enemy === enemy
      && (x.status === 'pending' || (game.round || 1) - x.round < 3));
    if (previous) continue;
    const id = `war_invite_${inviter}_${ally}_${enemy}_r${game.round || 1}`;
    const invitation = records[id] = { id, inviter, ally, enemy, round: game.round || 1, status: 'pending' };
    if (isPlayerCountry(game, ally)) {
      queuePlayerDecision(game, { id, type: 'decision', category: 'diplomacy', targetCountry: ally,
        title: `${countryName(game, inviter)}邀请共同参战`,
        body: `${countryName(game, inviter)}邀请你对${countryName(game, enemy)}宣战。你可以接受或拒绝；未经你的同意不会参战。`,
        choices: [{ id: 'accept', text: '同意参战', actions: [{ type: 'respondWarInvitation', country: ally, invitationId: id, accepted: true }] },
          { id: 'reject', text: '拒绝参战', actions: [{ type: 'respondWarInvitation', country: ally, invitationId: id, accepted: false }] }] });
    } else {
      const ours = countryPower(game, ally).power + countryPower(game, inviter).power;
      const theirs = Math.max(1, countryPower(game, enemy).power);
      const wars = livingCountries(game).filter(c => c.id !== ally && getDiplomaticRelation(game, ally, c.id) === DIPLOMACY_STATE.WAR).length;
      // The alliance is a strong positive incentive, while severe instability and hopeless odds can still lead to refusal.
      const score = 75 + Math.max(-55, Math.min(25, (ours / theirs - 1) * 35))
        - Math.max(0, wars - 1) * 12 - Math.max(0, 35 - (game.getStability?.(ally) ?? 100));
      finishWarInvitation(game, invitation, score >= 40);
    }
  }
}

function peaceCoalition(game, first, second) {
  const required = new Map();
  for (const c of livingCountries(game)) {
    if (c.id === first || c.id === second) continue;
    if (areDiplomaticAllies(game, first, c.id) && getDiplomaticRelation(game, c.id, second) === DIPLOMACY_STATE.WAR) required.set(c.id, second);
    if (areDiplomaticAllies(game, second, c.id) && getDiplomaticRelation(game, c.id, first) === DIPLOMACY_STATE.WAR) required.set(c.id, first);
  }
  return required;
}
function coalitionPeaceAuthorized(game, first, second) {
  const required = peaceCoalition(game, first, second);
  if (!required.size) return true;
  const request = game.diplomacy?.coalitionPeaceRequests?.[game._approvedCoalitionPeace];
  return !!request && request.status === 'approved' && relationKey(request.first, request.second) === relationKey(first, second)
    && [...required.keys()].every(country => request.approvals[country] === true);
}
function peaceApprovalReport(game, request, text, status) {
  game.addReport?.({ category: 'diplomacy', kind: 'coalitionPeace', actors: [request.first, request.second, ...Object.keys(request.approvals)],
    detail: { requestId: request.id, status }, factKey: request.id + '_' + status, importance: 2, text });
}
function advanceCoalitionPeace(game, request) {
  if (request.status !== 'pending') return;
  if (getDiplomaticRelation(game, request.first, request.second) !== DIPLOMACY_STATE.WAR
    || !countryAlive(game.stage.countries.get(request.first)) || !countryAlive(game.stage.countries.get(request.second))) { request.status = 'expired'; return; }
  const required = peaceCoalition(game, request.first, request.second);
  for (const [country, enemy] of required) {
    if (request.approvals[country] !== undefined) continue;
    if (isPlayerCountry(game, country)) {
      request.approvals[country] = null;
      queuePlayerDecision(game, { id: `${request.id}_approval_${country}`, type: 'decision', category: 'diplomacy', targetCountry: country,
        title: '盟友请求批准停战',
        body: `${countryName(game, request.first)}与${countryName(game, request.second)}准备停战。你仍在与${countryName(game, enemy)}交战；所有相关盟友同意后和约才生效。批准不会让你自动停战。`,
        choices: [{ id: 'accept', text: '同意和约', actions: [{ type: 'respondCoalitionPeace', requestId: request.id, country, accepted: true }] },
          { id: 'reject', text: '反对单独停战', actions: [{ type: 'respondCoalitionPeace', requestId: request.id, country, accepted: false }] }] });
    } else { request.approvals[country] = evaluatePeaceAcceptance(game, enemy, country).accept; }
  }
  if ([...required.keys()].some(country => request.approvals[country] === false)) {
    request.status = 'rejected'; peaceApprovalReport(game, request, '相关盟友未全部同意，和约未生效，原有战争状态保持。', 'rejected'); return;
  }
  if (![...required.keys()].every(country => request.approvals[country] === true)) return;
  request.status = 'approved';
  const previous = game._approvedCoalitionPeace;
  game._approvedCoalitionPeace = request.id;
  try {
    setDiplomaticRelation(game, request.first, request.second, 'peace', request.reason);
    request.status = getDiplomaticRelation(game, request.first, request.second) === DIPLOMACY_STATE.PEACE ? 'completed' : 'expired';
    if (request.status === 'completed') peaceApprovalReport(game, request, '所有相关交战盟友已批准，和约正式生效。', 'completed');
  } finally { game._approvedCoalitionPeace = previous; }
}
function requestCoalitionPeace(game, first, second, reason) {
  const requests = game.diplomacy.coalitionPeaceRequests ||= {};
  const pair = relationKey(first, second), round = game.round || 1;
  const existing = Object.values(requests).find(request => relationKey(request.first, request.second) === pair
    && (request.status === 'pending' || (request.status === 'rejected' && round - request.round < 3)));
  if (existing) { advanceCoalitionPeace(game, existing); return; }
  const id = `coalition_peace_${first}_${second}_r${round}`;
  const request = requests[id] = { id, first, second, reason, round, status: 'pending', approvals: {} };
  peaceApprovalReport(game, request, `${countryName(game, first)}与${countryName(game, second)}的和约等待所有相关交战盟友批准。`, 'pending');
  advanceCoalitionPeace(game, request);
}
register('respondCoalitionPeace', {
  validate(game, cmd) {
    const request = game.diplomacy?.coalitionPeaceRequests?.[cmd.requestId];
    if (!game._inScenarioEvent) return 'consent-required';
    if (!request || request.status !== 'pending') return 'peace-request-not-pending';
    if (request.approvals[cmd.country || game.activeCountry] !== null) return 'not-approval-recipient';
    if (typeof cmd.accepted !== 'boolean') return 'invalid-response';
    return null;
  },
  execute(game, cmd) {
    const request = game.diplomacy.coalitionPeaceRequests[cmd.requestId];
    request.approvals[cmd.country || game.activeCountry] = cmd.accepted;
    advanceCoalitionPeace(game, request);
  },
});

register('respondWarInvitation', {
  validate(game, cmd) {
    const invitation = game.diplomacy?.warInvitations?.[cmd.invitationId];
    if (!game._inScenarioEvent) return 'consent-required';
    if (!invitation || invitation.status !== 'pending') return 'invitation-not-pending';
    if ((cmd.country || game.activeCountry) !== invitation.ally) return 'not-invitation-recipient';
    if (typeof cmd.accepted !== 'boolean') return 'invalid-response';
    return null;
  },
  execute(game, cmd) { finishWarInvitation(game, game.diplomacy.warInvitations[cmd.invitationId], cmd.accepted); },
});

register('setDiplomacy', {
  validate(game, cmd) {
    if (!cmd.first || !cmd.second) return 'missing-targets';
    if (cmd.inviteAllies && cmd.first !== (cmd.country || game.activeCountry)) return 'not-own-country';
    if (cmd.first === cmd.second) return 'same-target';
    if (!countryAlive(game.stage?.countries?.get(cmd.first)) || !countryAlive(game.stage?.countries?.get(cmd.second))) return 'country-eliminated';
    const stVal = parseDiplomaticRelationState(cmd.state);
    if (stVal < DIPLOMACY_STATE.WAR || stVal > DIPLOMACY_STATE.ALLIANCE) return 'invalid-state';
    return null;
  },
  execute(game, cmd) {
    if (needsHumanConsent(game, cmd)) { deliverOfferToTarget(game, cmd); return; }
    setDiplomaticRelation(game, cmd.first, cmd.second, cmd.state, cmd.reason || 'command');
    if (cmd.inviteAllies && parseDiplomaticRelationState(cmd.state) === DIPLOMACY_STATE.WAR) inviteWarAllies(game, cmd.first, cmd.second, cmd.inviteAllies);
    if (cmd.reason === 'player_accepted_offer') game.emit(EV.DIPLOMACY_OFFER_RESOLVED, {
      first: cmd.first, second: cmd.second, action: cmd.state, accepted: true, reason: cmd.reason,
    });
  },
});

register('proposeDiplomacy', {
  validate(game, cmd) {
    if (!cmd.first || !cmd.second) return 'missing-targets';
    if (cmd.first === cmd.second) return 'same-target';
    if (!countryAlive(game.stage?.countries?.get(cmd.first)) || !countryAlive(game.stage?.countries?.get(cmd.second))) return 'country-eliminated';
    if (!['nap', 'alliance', 'peace'].includes(cmd.action)) return 'invalid-action';
    return null;
  },
  execute(game, cmd) {
    if (needsHumanConsent(game, cmd)) {
      deliverOfferToTarget(game, cmd.action === 'nap' ? cmd : { ...cmd, type: 'setDiplomacy', state: cmd.action });
      return;
    }
    proposeDiplomaticAction(game, cmd.first, cmd.second, cmd.action, cmd.reason || 'command');
  },
});

register('rejectPeaceOffer', {
  validate(game, cmd) {
    if (!cmd.first || !cmd.second) return 'missing-targets';
    if (!countryAlive(game.stage?.countries?.get(cmd.first)) || !countryAlive(game.stage?.countries?.get(cmd.second))) return 'country-eliminated';
    return null;
  },
  execute(game, cmd) {
    rejectOffer(game, cmd.first, cmd.second, ['peace', 'alliance', 'nap'].includes(cmd.action) ? cmd.action : 'peace', { score: 0, why: 'rejected-by-player' });
  },
});

export function evaluateAiDiplomacy(game, countryId) {
  if (!game?.diplomacy?.enabled) return;
  const info = game.stage?.countries?.get(countryId);
  if (!countryAlive(info)) return;
  ensureDiplomacyMeta(game);
  tickCountryStability(game, countryId);

  if (offerOnCooldown(game, countryId)) return;

  const peace = evaluateAiPeaceOffer(game, countryId);
  if (peace) {
    deliverOfferToTarget(game, peace);
    return;
  }
  const ally = evaluateAiAllianceProposal(game, countryId);
  if (ally) {
    deliverOfferToTarget(game, ally);
    return;
  }
  const nap = evaluateAiNapProposal(game, countryId);
  if (nap) deliverOfferToTarget(game, nap);
}
