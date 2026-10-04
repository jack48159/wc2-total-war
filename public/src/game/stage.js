// One stage's map state and the movement / attack rules on it (ports of CScene::CheckMoveable / CheckAttackable /
// SetSelAreaTargets). Pure logic: no canvas, no UI. Targets are returned as area id -> kind, see TARGET.
import { facingToward } from './direction.js';
import { World } from './world.js';
import { nativeAlliance } from './rules/combatModel.js';
import { loadNationalTraits, resolveCountryProfile } from './rules/national_traits.js';
import { relationColor } from './relation_color.js';
import { visibilityForCountry } from './rules/visibility.js';

export const TARGET = { ROCKET: 2, MOVE: 3, ATTACK: 4 };   // numbering follows the original arrow types
const NAVY_TYPES = new Set(['destroyer', 'cruiser', 'battleship', 'aircraftcarrier']);

  // Country-specific `armydef.xml` overrides are wired; missing types fall back to `others`.
export const PORTED = { countryArmyDefs: true };

const getJson = url => fetch(url).then(r => r.json());

// Original armydef.xml is the source of max strength, movement, and attack dice.
async function loadArmyDefs() {
  const xml = await (await fetch('assets/armydef.xml')).text(), countries = {};
  const defaults = type => {
    const d = { targetingMode: 'adjacent', attackClass: 'direct', minRange: 1, maxRange: 1,
      counterMask: 1, retainMovementOnKill: false, constructionDamageChance: 0, fortSecondAttack: false,
      canOccupy: true, attackMultiplier: 1, receivedDamageMultiplier: 1, radarDamageMultiplier: 1,
      attackCost: 1, entrenchmentStopsMovement: false, adjacentSplashPercent: 0, matchups: [],
      airForce: false, transportUnit: false, combatRadius: 0, radiusPerTech: 0, radiusMedalBonus: 0,
      maxCombatRadius: 0, stackSplashFalloff: 0 };
    if (type === 'infantry') d.receivedDamageMultiplier = 1.3, d.entrenchmentStopsMovement = true;
    if (type === 'panzer') d.attackMultiplier = 1.3, d.entrenchmentStopsMovement = true;
    if (type === 'artillery') d.attackClass = 'artillery', d.counterMask = 1 | 2, d.canOccupy = false;
    if (type === 'rocket') d.targetingMode = 'range', d.attackClass = 'rocket', d.minRange = 2, d.maxRange = 2, d.counterMask = 4, d.canOccupy = false, d.radarDamageMultiplier = 0.5;
    if (type === 'tank' || type === 'heavytank') d.retainMovementOnKill = true;
    if (type === 'heavytank') d.counterMask = 1 | 2;
    if (['destroyer','cruiser','battleship','aircraftcarrier'].includes(type)) d.counterMask = 1 | 2, d.fortSecondAttack = true;
    if (type === 'battleship') d.constructionDamageChance = 30;
    if (type === 'aircraftcarrier') d.targetingMode = 'airstrike';
    return d;
  };
  const number = (a, key, fallback) => a[key] == null || a[key] === '' ? fallback : Number(a[key]);
  for (const block of xml.matchAll(/<country\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/country>/g)) {
    const defs = {};
    for (const m of block[2].matchAll(/<army\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/army>)/g)) {
      const attrs = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(x => [x[1], x[2]]));
      if (attrs.type) {
        const d = { ...defaults(attrs.type), type: attrs.type, maxHp: +attrs.strength || 0, movement: +attrs.movement || 0, minAttack: +attrs.minatk || 0, maxAttack: +attrs.maxatk || 0 };
        for (const [key, out] of [['minrange','minRange'],['maxrange','maxRange'],['attackcost','attackCost'],['constructiondamagechance','constructionDamageChance'],['adjacentsplashpercent','adjacentSplashPercent']]) if (attrs[key] != null) d[out] = Math.max(0, number(attrs, key, d[out]));
        for (const [key, out] of [['attackmultiplier','attackMultiplier'],['receiveddamagemultiplier','receivedDamageMultiplier'],['radardamagemultiplier','radarDamageMultiplier'],['stacksplashfalloff','stackSplashFalloff'],['splashfalloff','stackSplashFalloff']]) if (attrs[key] != null) d[out] = Math.max(0, Math.min(10, number(attrs, key, d[out])));
        for (const [key, out] of [['retainmoveonkill','retainMovementOnKill'],['fortsecondattack','fortSecondAttack'],['canoccupy','canOccupy'],['entrenchmentstop','entrenchmentStopsMovement'],['airforce','airForce'],['airunit','airForce'],['transportunit','transportUnit']]) if (attrs[key] != null) d[out] = !!Number(attrs[key]);
        if (attrs.targeting) d.targetingMode = attrs.targeting === 'remotecombat' ? 'remote' : attrs.targeting;
        if (attrs.attackclass) d.attackClass = attrs.attackclass;
        if (attrs.counterclasses) {
          const text = attrs.counterclasses.toLowerCase();
          d.counterMask = text === 'none' ? 0 : (text.includes('direct') ? 1 : 0) | (text.includes('artillery') ? 2 : 0) | (text.includes('rocket') ? 4 : 0) | (text.includes('air') ? 8 : 0);
        }
        d.maxRange = Math.max(d.minRange, d.maxRange);
        const body = m[2] || '';
        const matchups = [...body.matchAll(/<matchup\s+([^>]+?)\s*\/?>(?:<\/matchup>)?/g)].map(x => Object.fromEntries([...x[1].matchAll(/(\w+)="([^"]*)"/g)].map(y => [y[1], y[2]])));
        d.matchups = matchups.filter(x => x.target).map(x => ({ target: x.target, attackBonus: Math.max(0, Math.min(1000, number(x, 'attackbonus', 0))), damageReduction: Math.max(0, Math.min(100, number(x, 'damagereduction', 0))) }));
        defs[attrs.type] = d;
      }
    }
    countries[block[1]] = defs;
  }
  return countries;
}

async function loadCommanderRanks() {
  const xml = await (await fetch('assets/commanderdef.xml')).text(), ranks = {};
  for (const m of xml.matchAll(/<commander\s+([^>]+?)\s*\/>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/([\w]+)="([^"]*)"/g)].map(x => [x[1], x[2]]));
    if (a.name) ranks[a.name] = +a.rank || 0;
  }
  return ranks;
}

export class Stage {
  // opts.player: country id the human plays (conquest scenarios have no fixed player: every country is AI in the data)
  static async load(name, areasOverride = null, opts = {}) {
    const [, data, defs, commanderRanks] = await Promise.all([World.load(), getJson(`data/stages/${name}.json`), loadArmyDefs(), loadCommanderRanks()]);
    if (data.mapPatch) World.applyPatch(data.mapPatch, data.mirror);
    if (areasOverride) data.areas = JSON.parse(JSON.stringify(areasOverride));
    let scenarioOverride = null;
    if (opts.historicalDiplomacy !== false && !opts.freeDiplomacy && name.startsWith('conquest_')) {
      try {
        const scenario = await getJson(`scenarios/${name}.json`);
        if (scenario) {
          if (scenario.diplomacy) data.diplomacy = JSON.parse(JSON.stringify(scenario.diplomacy));
          if (scenario.scenarioEvents) data.scenarioEvents = JSON.parse(JSON.stringify(scenario.scenarioEvents));
          if (scenario.ai_rules) data.ai_rules = JSON.parse(JSON.stringify(scenario.ai_rules));
          if (scenario.nationalTraits) scenarioOverride = JSON.parse(JSON.stringify(scenario.nationalTraits));
        }
      } catch (e) {
        // No scenario file for this stage; ignore and keep data untouched
      }
    }
    if (opts.diplomacy?.enabled) data.diplomacy = JSON.parse(JSON.stringify(opts.diplomacy));
    if (opts.initialRelations && Object.keys(opts.initialRelations).length) {
      data.diplomacy = {
        ...(data.diplomacy || {}), enabled: true,
        relations: { ...(data.diplomacy?.relations || {}), ...opts.initialRelations },
      };
    }
    try {
      data.traitCatalog = await loadNationalTraits();
    } catch (e) {
      data.traitCatalog = null;
    }
    if (!opts.countries && data.diplomacy?.enabled && data.traitCatalog) {
      data.traitProfiles = {};
      for (const country of data.countries) {
        data.traitProfiles[country.id] = resolveCountryProfile(data.traitCatalog, name, country, scenarioOverride);
      }
    }
    if (opts.countries) data.countries = JSON.parse(JSON.stringify(opts.countries));
    if (opts.freeDiplomacy && name.startsWith('conquest_') && !areasOverride && !opts.countries) {
      data.diplomacy = { enabled: true, relations: {}, pacts: {} };
      // Each country starts independently; legacy coalition IDs must not imply alliances.
      for (const country of data.countries) country.alliance = country.id;
      delete data.scenarioEvents;
      delete data.events;
      delete data.ai_rules;
    }
    if (opts.player) {
      data.player = opts.player;
      for (const c of data.countries) c.ai = c.id !== opts.player;
      if (Number.isFinite(opts.commanderLevel)) data.countries.find(c => c.id === opts.player).commanderLevel = opts.commanderLevel;
    } else if (Number.isFinite(opts.commanderLevel)) {
      const human = data.countries.find(c => !c.ai);
      if (human) human.commanderLevel = opts.commanderLevel;
    }
    // CGameManager::InitBattle calls MovePlayerCountryToFront before the first
    // turn. Country order is also the turn queue, not merely display data.
    const playerId = data.player || data.countries.find(c => !c.ai)?.id || data.countries[0]?.id;
    const playerIndex = data.countries.findIndex(c => c.id === playerId);
    if (playerIndex > 0) data.countries.unshift(...data.countries.splice(playerIndex, 1));
    return new Stage(name, data, defs, commanderRanks);
  }

  constructor(name, data, armyDefs = {}, commanderRanks = {}) {
    this.name = name; this.data = data; this.armyDefs = armyDefs;
    this.move = armyDefs.others || {}; this.strength = Object.fromEntries(Object.entries(this.move).map(([type, d]) => [type, d.maxHp]));
    this.areas = data.areas;                                     // per-area state: country, armies[], construction, level, installation
    // These immutable map traits come from the original area1.bin / areatax1.xml
    // tables (not scenario guesses) and drive native combat capture rules.
    for (const area of this.areas) {
      const mapArea = World.areas[area.id];
      area.sea = mapArea?.f === 1;
      area.areaType = mapArea?.areaType ?? 0;
    }
    this.enabled = new Set(data.enabled);                        // areas that take part in this stage
    this.byArea = new Map(this.areas.map(a => [a.id, a]));
    this.countries = new Map(data.countries.map(c => [c.id, c]));
    const profiles = data.traitProfiles || {};
    const diplomacyOn = !!data.diplomacy?.enabled;
    for (const country of this.countries.values()) {
      const profile = profiles[country.id];
      if (diplomacyOn && profile && !Array.isArray(country.traits)) {
        country.regime = profile.regime;
        country.traits = profile.traits.slice();
        country.traitNote = profile.note;
      }
      if (country.commanderLevel == null) country.commanderLevel = commanderRanks[country.commander] ?? 8;
      if (country.stability == null) country.stability = diplomacyOn && profile ? profile.baseStability : 100;
    }
    this.adjE = new Map(data.enabled.map(id => [id, World.adj[id].filter(n => this.enabled.has(n))]));
    this.initFacings();
    // Scene rect = bounding box of the enabled areas + immediately adjacent unoccupied/neutral areas (1 ring)
    const renderAreas = new Set(data.enabled);
    for (const id of data.enabled) {
      for (const n of World.adj[id] || []) {
        renderAreas.add(n);
      }
    }

    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const id of renderAreas) {
      const a = World.areas[id];
      if (!a) continue;
      x0 = Math.min(x0, a.x);
      y0 = Math.min(y0, a.y);
      x1 = Math.max(x1, a.x + a.w);
      y1 = Math.max(y1, a.y + a.h);
    }

    // Expand unoccupied areas symmetrically so the final map bounds strictly maintain a 16:9 aspect ratio
    const curW = x1 - x0, curH = y1 - y0;
    let unit = Math.ceil(Math.max(curW / 16, curH / 9));
    const maxUnit = Math.floor(Math.min(8000 / 16, 3500 / 9));
    if (unit > maxUnit) unit = maxUnit;

    const targetW = unit * 16;
    const targetH = unit * 9;

    const midX = (x0 + x1) / 2, midY = (y0 + y1) / 2;
    let finalX0 = Math.round(midX - targetW / 2);
    let finalY0 = Math.round(midY - targetH / 2);

    if (finalX0 < 0) finalX0 = 0;
    if (finalX0 + targetW > 8000) finalX0 = 8000 - targetW;
    if (finalY0 < 0) finalY0 = 0;
    if (finalY0 + targetH > 3500) finalY0 = 3500 - targetH;

    this.bounds = { x0: finalX0, y0: finalY0, x1: finalX0 + targetW, y1: finalY0 + targetH };
  }

  get player() { return this.data.player || (this.data.countries.find(c => !c.ai) || this.data.countries[0]).id; }
  // Scenario ai flags do not grant the local player control of allied armies.
  get humanCountries() { return this._human || (this._human = new Set([this.player])); }

  st(id) { return this.byArea.get(id); }
  ownerOf(id) { const s = this.st(id); return s && s.country; }
  isHumanArea(id) { return this.humanCountries.has(this.ownerOf(id)); }
  alliance(country) { const c = this.countries.get(country); return c && c.alliance; }
  friendly(country) { return this.alliance(country) === this.alliance(this.player); }
  areAllied(a, b) { return !a || !b ? false : (this.game?.diplomacy?.enabled ? this.game.areDiplomaticAllies(a, b) : this.alliance(a) === this.alliance(b)); }
  // The unit base / carrier-pin colour for a country, relative to the player (assets: unitbase_<colour>_N, mark_carriers_<colour>).
  // Same table as relationColor: green = player, blue = ally / cobelligerent, red = war, amber = tense, gray = neutral.
  unitColor(country) {
    return relationColor({ stage: this, diplomacy: this.game?.diplomacy }, country);
  }
  // Army stats for a country, including its `armydef.xml` override when present.
  armyDef(countryId, type) {
    const flag = PORTED.countryArmyDefs ? this.countries.get(countryId)?.flag : null;
    return (flag && this.armyDefs[flag]?.[type]) || this.armyDefs.others?.[type] || { maxHp: 100, movement: 1, minAttack: 0, maxAttack: 0 };
  }
  adjacent(a, b) { return (this.adjE.get(a) || []).includes(b); }
  graphDistance(a, b, max = 99) {
    if (a === b) return 0;
    const seen = new Set([a]), queue = [[a, 0]];
    while (queue.length) {
      const [id, distance] = queue.shift();
      if (distance >= max) continue;
      for (const next of this.adjE.get(id) || []) {
        if (next === b) return distance + 1;
        if (!seen.has(next)) { seen.add(next); queue.push([next, distance + 1]); }
      }
    }
    return -1;
  }
  // The scenario files carry no unit direction, so units start facing the enemy: toward the nearest hostile area (an adjacent one if there is
  // one), snapped to one of the area's own links. Armies that already have a facing (a saved game) keep it.
  initFacings() {
    const hostile = [];
    for (const a of this.areas) {
      const al = this.alliance(a.country), p = World.areas[a.id]?.pts?.[0];
      if (al != null && p) hostile.push({ id: a.id, al, x: p[0], y: p[1] });
    }
    for (const a of this.areas) {
      if (!a.armies.some(r => r.facing == null)) continue;
      const al = this.alliance(a.country), me = World.areas[a.id]?.pts?.[0]; if (!me) continue;
      let best = null, bd = Infinity;
      for (const h of hostile) {
        if (h.al === al || h.id === a.id) continue;
        const d = Math.hypot(h.x - me[0], h.y - me[1]) * ((this.adjE.get(a.id) || []).includes(h.id) ? 0.25 : 1);
        if (d < bd) { bd = d; best = h.id; }
      }
      if (best == null) continue;
      const f = facingToward(this, a.id, best);
      for (const r of a.armies) if (r.facing == null && f != null) r.facing = f;
    }
  }
  snapshotAreas() { return JSON.parse(JSON.stringify(this.areas)); }

  // an army with runtime movement left (armies not yet initialised count as able)
  canAct(a) { return a.movement == null || a.movement > 0; }
  // area state, created on demand for enabled areas the scenario data leaves empty (sea, wasteland)
  ensureArea(id, country) {
    let s = this.byArea.get(id);
    if (!s) {
      const mapArea = World.areas[id];
      s = { id, country, armies: [], construction: 'none', level: 0, installation: 'none', sea: mapArea?.f === 1, areaType: mapArea?.areaType ?? 0 };
      this.areas.push(s); this.byArea.set(id, s);
    }
    return s;
  }

  maxArmies(areaOrId) {
    const a = typeof areaOrId === 'number' ? this.st(areaOrId) : areaOrId;
    const id = typeof areaOrId === 'number' ? areaOrId : a?.id;
    return a?.maxArmies ?? World.areas[id]?.unitCapacity ?? this.maxArmiesPerArea ?? 4;
  }

  // CScene::GetMoveDistancesFrom: shortest reachable path within the current
  // army's movement budget. The returned cost is spent by the move command.
  movementPath(sId, tId, idx) {
    const start = this.st(sId), army = start?.armies[idx];
    if (!army || sId === tId || !this.enabled.has(sId) || !this.enabled.has(tId)) return null;
    const budget = army.movement ?? this.armyDef(start.country, army.type).movement;
    if (budget <= 0) return null;
    const navy = NAVY_TYPES.has(army.type), ai = start.country !== this.player;
    const view = id => this.st(id) || { id, country: null, armies: [], sea: World.areas[id]?.f === 1 };
    const canEnter = (area, id) => {
      if (!this.enabled.has(id) || area.armies.length >= this.maxArmies(id)) return false;
      if (area.armies.length && area.country !== start.country) return false;
      if (area.sea ? !navy && !(army.cards & 4) : navy) return false;
      if (area.country && area.country !== start.country && !area.sea) {
        if (this.game?.diplomacy?.enabled) {
          if (!this.game.canOccupyTerritory(start.country, area.country, ai)) return false;
        } else if (ai && this.areAllied(start.country, area.country)) {
          return false;
        }
      }
      if (ai && this.armyDef(start.country, army.type).transportUnit && area.country !== start.country) return false;
      return true;
    };
    const canContinue = area => area.sea ? navy : area.country === start.country || area.armies.length === 0;
    const distance = new Map([[sId, 0]]), previous = new Map(), pending = [[0, sId]];
    while (pending.length) {
      pending.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const [cost, current] = pending.shift();
      if (cost !== distance.get(current)) continue;
      if (current === tId) break;
      if (cost >= budget) continue;
      for (const next of this.adjE.get(current) || []) {
        const trait = World.areas[next];
        const entryCost = trait?.entryCosts?.[current] ?? trait?.movementCost ?? 1;
        const nextCost = cost + entryCost;
        if (nextCost > budget || (distance.has(next) && distance.get(next) <= nextCost)) continue;
        const area = view(next);
        if (!canEnter(area, next)) continue;
        distance.set(next, nextCost); previous.set(next, current);
        if (canContinue(area)) pending.push([nextCost, next]);
      }
    }
    if (!distance.has(tId)) return null;
    const ids = [tId];
    for (let id = tId; id !== sId;) {
      id = previous.get(id);
      if (id == null) return null;
      ids.unshift(id);
    }
    return { ids, cost: distance.get(tId) };
  }
  moveable(sId, tId, idx) { return !!this.movementPath(sId, tId, idx); }
  attackable(sId, tId, idx, airstrikeRadius = 300) {
    const s = this.st(sId), t = this.st(tId);
    if (!s || !t || idx >= s.armies.length || t.armies.length === 0) return false;
    if (this.game?.fogOfWar && !visibilityForCountry(this.game, s.country).has(tId)) return false;
    if (this.game?.diplomacy?.enabled) {
      if (!this.game.canInitiateAttack(s.country, t.country, s.country !== this.game.player)) return false;
    } else if (nativeAlliance(this.alliance(s.country)) === nativeAlliance(this.alliance(t.country))) {
      return false;
    }
    const a = s.armies[idx]; if (!(a.movement ?? this.armyDef(s.country, a.type).movement) || !this.canAct(a)) return false;
    const def = this.armyDef(s.country, a.type);
    if (def.targetingMode === 'airstrike' || def.combatRadius > 0 || a.type === 'aircraftcarrier') {
      const from = World.areas[sId]?.pts?.[0], to = World.areas[tId]?.pts?.[0];
      if (!from || !to) return false;
      const distance = Math.hypot(from[0] - to[0], from[1] - to[1]);
      const radius = Math.min(def.maxCombatRadius || Infinity, def.combatRadius || airstrikeRadius);
      return distance > 0 && distance < radius;
    }
    if (def.targetingMode === 'range' || a.type === 'rocket') {
      const distance = this.graphDistance(sId, tId, def.maxRange || 2);
      return distance >= (def.minRange || 1) && distance <= (def.maxRange || 2);
    }
    return def.targetingMode === 'adjacent' ? this.adjacent(sId, tId) : this.adjacent(sId, tId);
  }
  // Arrow targets for the front army of a human-owned area.
  targetsFor(sId, airstrikeRadius = 300) {
    const out = new Map(); if (sId < 0) return out;
    const s = this.st(sId); if (!s || !s.armies.length || !this.isHumanArea(sId)) return out;
    const front = s.armies[0], frontDef = this.armyDef(s.country, front.type);
    const rocket = frontDef.targetingMode === 'range' || front.type === 'rocket';
    // like the original CScene::SetSelAreaTargets: arrows only to the ADJACENT areas (a unit with more movement still gets one arrow per neighbour,
    // not one to every area it could reach)
    for (const id of this.adjE.get(sId) || []) if (this.moveable(sId, id, 0)) out.set(id, TARGET.MOVE);
    for (const n of this.adjE.get(sId) || []) {
      if (!out.has(n) && !rocket && s.armies[0].type !== 'aircraftcarrier' && this.attackable(sId, n, 0, airstrikeRadius)) out.set(n, TARGET.ATTACK);
      if (rocket) for (const m of this.adjE.get(n) || []) if (this.attackable(sId, m, 0, airstrikeRadius)) out.set(m, TARGET.ROCKET);
    }
    if (s.armies[0].type === 'aircraftcarrier') {
      for (const id of this.enabled) if (this.attackable(sId, id, 0, airstrikeRadius)) out.set(id, TARGET.ROCKET);
    }
    return out;
  }
}
