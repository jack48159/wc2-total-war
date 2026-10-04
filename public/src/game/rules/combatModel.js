// Port of CFight::NormalAttack in orig_easytech.so for ordinary land-unit attacks.
// Evidence: ARM/Thumb disassembly at 0x471c8; GetNumDices at 0x49e90 and
// GetNumDicesIfLostStrength at 0x49ec6. Specialized air/naval results and
// event/nation bonuses remain separate unfinished paths.
import { World } from '../world.js';
import { attackFacingKind } from '../direction.js';
import { EV } from '../events.js';
import { tacticalBonus } from '../army_groups.js';

export function armyDiceCount(hp, maxHp) {
  if (!(maxHp > 0)) return 1;
  // The native code uses integer division before comparing the thresholds.
  const percent = Math.trunc((Math.max(0, hp) * 100) / maxHp);
  // CArmy::GetNumDices uses <=5, <15, <25, <50, otherwise 5.
  if (percent >= 50) return 5;
  if (percent >= 25) return 4;
  if (percent >= 15) return 3;
  if (percent > 5) return 2;
  return 1;
}

export function armyDiceCountAfterLoss(hp, maxHp, damage) {
  // The native helper only returns zero when damage is strictly greater than
  // current HP; equality still runs the zero-HP dice threshold (one die).
  if (damage > hp) return 0;
  return armyDiceCount(hp - damage, maxHp);
}

// Observed directly in NormalAttack's class-id branches. `artillery` (2)
// and `rocket` (3) use explicit exceptions; ordinary classes follow the
// default path. This models counter eligibility only, not special multipliers.
const NAVAL_COUNTER_TYPES = new Set(['destroyer', 'cruiser', 'battleship', 'aircraftcarrier']);
export const isNavalCombatUnit = type => NAVAL_COUNTER_TYPES.has(type);
// Native/project enum ids 4/5 are TANK and HEAVY_TANK. PANZER is id 1 and
// follows the ordinary movement branch, so it intentionally is not included.
// CFight::ApplyResult movement branch (native RVA 0x46a80): ordinary units
// spend one movement point after an attack. Tanks retain it only when they
// destroy this defender while other defenders remain in the area. Entrenchment
// exhausts non-tank attackers regardless of the result.
export function movementAfterAttack(attacker, targetInstallation, defenderSurvived, defendersRemain, attackerDef = {}) {
  if (targetInstallation === 'entrenchment' && attackerDef.entrenchmentStopsMovement) return 0;
  if (!attackerDef.retainMovementOnKill || defenderSurvived || !defendersRemain) {
    return Math.max(0, (attacker.movement ?? 0) - Math.max(0, attackerDef.attackCost ?? 1));
  }
  return attacker.movement ?? 0;
}

// CArea::ReduceConstructionLevel (native RVA 0x4a1de). Area type comes from
// areatax1.xml's native 0..4 enum; construction values 1/2 are city/industry.
export function reduceConstructionLevel(area) {
  if (!area || area.construction === 'none' || !(area.level > 0)) return false;
  const kind = area.construction;
  area.level--;
  if (area.level === 0) {
    area.construction = 'none';
    return true;
  }

  let eraseAt = null;
  if (area.areaType === 1) eraseAt = kind === 'city' ? 3 : kind === 'industry' ? 2 : null;
  else if (area.areaType === 3) eraseAt = kind === 'city' ? 2 : kind === 'industry' ? 1 : null;
  else if (area.areaType === 4 && kind === 'city') eraseAt = 1;
  if (area.level === eraseAt) {
    area.level = 0;
    area.construction = 'none';
  }
  return true;
}

// CFight::ApplyResult only permits regular direct/air/navy classes to occupy;
// native class ids 2/3 (artillery/rocket) are excluded, and the raw sea flag
// must match between the source and target areas.
export function canOccupyAfterAttack(attacker, fromArea, toArea, attackerDef = null) {
  return (attackerDef ? attackerDef.canOccupy !== false : attacker.type !== 'artillery' && attacker.type !== 'rocket') &&
    typeof fromArea?.sea === 'boolean' && fromArea.sea === toArea?.sea;
}

export function canCounter(attackerType, defenderType, defenderArea = null) {
  // The native artillery class is exceptional in both directions: an
  // artillery attacker is countered by artillery, heavy armour, and surface
  // naval classes (native class ids 6..9); artillery defenders also pass the
  // counter gate against those incoming classes in NormalAttack.
  if (attackerType === 'artillery') {
    return defenderType === 'artillery' || defenderType === 'heavytank' || NAVAL_COUNTER_TYPES.has(defenderType) ||
      defenderArea?.installation === 'fort';
  }
  if (attackerType === 'rocket') return defenderType === 'rocket';
  if (defenderType === 'rocket') return false;
  return true;
}

const ATTACK_CLASS = { direct: 1, artillery: 2, rocket: 4, air: 8 };
function canCounterByDefs(attackerDef, defenderDef, defenderArea) {
  if (attackerDef?.attackClass === 'air' || attackerDef?.airForce) {
    return !!(defenderDef?.airForce || defenderArea?.installation === 'antiaircraft');
  }
  if (defenderDef?.airForce) return false;
  const mask = defenderDef?.counterMask;
  if (Number.isFinite(mask)) {
    const incoming = ATTACK_CLASS[attackerDef?.attackClass] || 1;
    if (!(mask & incoming) && attackerDef?.attackClass === 'artillery' && defenderArea?.installation === 'fort') return true;
    return !!(mask & incoming);
  }
  return canCounter(attackerDef?.type || '', defenderDef?.type || '', defenderArea);
}

function matchupMultiplier(attackerDef, defenderDef) {
  const attackMatch = (attackerDef?.matchups || []).find(m => m.target === (defenderDef?.type || ''));
  const defenceMatch = (defenderDef?.matchups || []).find(m => m.target === (attackerDef?.type || ''));
  const attackBonusPct = attackMatch?.attackBonus || 0;
  const damageReductionPct = defenceMatch?.damageReduction || 0;
  return { attackBonusPct, damageReductionPct, multiplier: (1 + attackBonusPct / 100) * (1 - damageReductionPct / 100) };
}

// The custom group encirclement rule is ported from Wc2-own/cpp/mod_main.cpp.
// The native country alliance field is numeric; scenario data stores letters.
export function nativeAlliance(value) {
  if (Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^[a-z]$/.test(value)) {
    const id = value.charCodeAt(0) - 96;
    return id > 0 && id <= 26 && id !== 4 && id !== 14 ? id : 4;
  }
  return value ?? 4;
}

const MAX_POCKET_TILES = 2;
const MAX_SPLIT_GROUP = 40;
const FULL_RATIO_X100 = 200;
const HALF_RATIO_X100 = 150;
// A rear hit takes more setting up (get a unit onto the area directly behind the defender's facing,
// not just an adjacent side) than a plain flank, so it reads as more of a surprise and pays more.
const FLANK_PCT = 10, FLANK_REPEAT_PCT = 5;
const REAR_PCT = 15, REAR_REPEAT_PCT = 7;

function areaView(stage, id) {
  return stage.st(id) || { id, country: null, armies: [], installation: 'none', sea: !!World.areas[id]?.f };
}
function hasArmies(area) { return (area?.armies?.length || 0) > 0; }
function isWall(stage, area) { return !area || !stage.enabled.has(area.id) || !!area.sea; }
function friendlyArmyArea(stage, area, alliance) {
  return hasArmies(area) && area.country != null && nativeAlliance(stage.alliance(area.country)) === alliance;
}
function hostileArmyArea(stage, area, alliance) {
  if (!hasArmies(area) || area.country == null) return false;
  const other = nativeAlliance(stage.alliance(area.country));
  return other !== alliance && other !== 4;
}

function friendlyComponent(stage, origin, alliance, skipId = -1) {
  if (!origin || origin.id === skipId) return [];
  const members = [], seen = new Set([origin.id]);
  members.push(origin);
  for (let head = 0; head < members.length; head++) {
    const area = members[head];
    for (const id of stage.adjE.get(area.id) || []) {
      if (id === skipId || seen.has(id)) continue;
      const next = areaView(stage, id);
      if (isWall(stage, next) || !friendlyArmyArea(stage, next, alliance)) continue;
      seen.add(id); members.push(next);
    }
  }
  return members;
}

function armyPowerForEncirclement(stage, army, area) {
  const def = stage.armyDef(area.country, army.type), dice = armyDiceCount(army.hp, army.maxHp);
  const level = levelBonus(army), cards = Math.trunc(army.cards || 0);
  const attackBonus = level.attack + ((cards & 1) ? 1 : 0);
  const defenceBonus = level.defence + ((cards & 2) ? 1 : 0) +
    (area.installation === 'fort' || area.installation === 'entrenchment' || area.areaType === 1 ? 1 : 0);
  const min = Math.trunc(def.minAttack || 0), max = Math.trunc(def.maxAttack ?? min);
  return { attack: dice * (min + max + 2 * attackBonus), defence: dice * 2 * defenceBonus };
}

function cachedEmptyRegion(stage, edge, recomputeCache) {
  let region = recomputeCache.emptyRegions.get(edge.id);
  if (!region) {
    const ids = [], boundary = new Set(), visited = new Set([edge.id]), pending = [edge];
    for (let head = 0; head < pending.length; head++) {
      const current = pending[head]; ids.push(current.id);
      for (const nextId of stage.adjE.get(current.id) || []) {
        const next = areaView(stage, nextId);
        if (isWall(stage, next)) continue;
        if (hasArmies(next)) boundary.add(nextId);
        else if (!visited.has(nextId)) { visited.add(nextId); pending.push(next); }
      }
    }
    region = { ids, boundary: [...boundary] };
    for (const emptyId of ids) recomputeCache.emptyRegions.set(emptyId, region);
  }
  return region;
}

// True when a hostile army area touches the group or borders an empty region that touches it.
// Without one, neither the group nor any split-off part can have attackers, so level is 0.
function threatNearby(stage, members, alliance, recomputeCache) {
  const groupIds = new Set(members.map(area => area.id));
  for (const area of members) for (const id of stage.adjE.get(area.id) || []) {
    if (groupIds.has(id)) continue;
    const edge = areaView(stage, id);
    if (isWall(stage, edge)) continue;
    if (hostileArmyArea(stage, edge, alliance)) return true;
    if (hasArmies(edge)) continue;
    for (const nextId of cachedEmptyRegion(stage, edge, recomputeCache).boundary) {
      if (!groupIds.has(nextId) && hostileArmyArea(stage, areaView(stage, nextId), alliance)) return true;
    }
  }
  return false;
}

function evaluateEncirclementGroup(stage, members, alliance, recomputeCache = null) {
  const result = { level: 0, penaltyPct: 0, defenders: members, defenderUnits: 0, attackerUnits: 0, gaps: 0, pocketTiles: 0, ratioX100: 0 };
  const groupIds = new Set(members.map(area => area.id));
  for (const area of members) result.defenderUnits += area.armies.length;
  const attackerIds = new Set(), seenEmpty = new Set(), tileRegion = new Map(), regions = [];

  for (const area of members) for (const id of stage.adjE.get(area.id) || []) {
    const edge = areaView(stage, id);
    if (isWall(stage, edge) || groupIds.has(id)) continue;
    if (hostileArmyArea(stage, edge, alliance)) { attackerIds.add(id); continue; }
    if (friendlyArmyArea(stage, edge, alliance)) {
      if (!seenEmpty.has(id)) { seenEmpty.add(id); result.gaps++; }
      continue;
    }
    if (hasArmies(edge)) continue; // neutral occupied area is solid ring terrain
    if (seenEmpty.has(id)) continue;
    seenEmpty.add(id);

    let regionIndex = tileRegion.get(id);
    if (regionIndex == null) {
      let regionIds = [], regionAttackers = new Set();
      let friendEscape = false;
      if (recomputeCache) {
        // Empty connected regions do not depend on which occupied defender
        // group is examined. Discover each region once per board recomputation.
        const region = cachedEmptyRegion(stage, edge, recomputeCache);
        regionIds = region.ids;
        for (const nextId of region.boundary) {
          if (groupIds.has(nextId)) continue;
          const next = areaView(stage, nextId);
          if (hostileArmyArea(stage, next, alliance)) regionAttackers.add(nextId);
          else if (friendlyArmyArea(stage, next, alliance)) friendEscape = true;
        }
      } else {
        const visited = new Set([id]), pending = [edge];
        for (let head = 0; head < pending.length; head++) {
          const current = pending[head]; regionIds.push(current.id);
          for (const nextId of stage.adjE.get(current.id) || []) {
            const next = areaView(stage, nextId);
            if (isWall(stage, next) || groupIds.has(nextId)) continue;
            if (hostileArmyArea(stage, next, alliance)) regionAttackers.add(nextId);
            else if (friendlyArmyArea(stage, next, alliance)) friendEscape = true;
            else if (!hasArmies(next) && !visited.has(nextId)) { visited.add(nextId); pending.push(next); }
          }
        }
      }
      const pocket = !friendEscape && result.pocketTiles + regionIds.length <= MAX_POCKET_TILES;
      if (pocket) {
        result.pocketTiles += regionIds.length;
        for (const enemyId of regionAttackers) attackerIds.add(enemyId);
      }
      regionIndex = regions.length;
      regions.push({ pocket });
      for (const regionId of regionIds) tileRegion.set(regionId, regionIndex);
    }
    if (!regions[regionIndex].pocket) result.gaps++;
  }

  const powerOf = areas => areas.reduce((sum, area) => {
    for (const army of area.armies) {
      const p = armyPowerForEncirclement(stage, army, area);
      sum.attack += p.attack; sum.defence += p.defence;
    }
    return sum;
  }, { attack: 0, defence: 0 });
  const groupPower = powerOf(members), attackerAreas = [...attackerIds].map(id => areaView(stage, id));
  const ringPower = powerOf(attackerAreas);
  result.attackerUnits = attackerAreas.reduce((sum, area) => sum + area.armies.length, 0);
  const threat = ringPower.attack - groupPower.defence;
  const resist = Math.max(groupPower.attack - ringPower.defence, 2);
  if (result.defenderUnits > 0 && threat > 0) {
    result.ratioX100 = Math.min(100000, Math.trunc(threat * 100 / resist));
    let base = 0;
    if (result.gaps === 0 && result.ratioX100 >= FULL_RATIO_X100) { result.level = 2; base = 50; }
    else if (result.gaps === 1 && result.ratioX100 >= HALF_RATIO_X100) { result.level = 1; base = 20; }
    if (result.level) {
      const amp = Math.min(150, 100 + Math.trunc(Math.max(0, result.ratioX100 - FULL_RATIO_X100) / 4));
      result.penaltyPct = Math.trunc(base * amp / 100);
    }
  }
  return result;
}

function moreSevere(a, b) {
  if (a.level !== b.level) return a.level > b.level;
  if (!a.level) return false;
  if (a.penaltyPct !== b.penaltyPct) return a.penaltyPct > b.penaltyPct;
  return a.defenders.length < b.defenders.length;
}

export function evaluateEncirclement(stage, originId, recomputeCache = null) {
  const origin = stage.st(originId);
  if (!origin || origin.country == null || !hasArmies(origin)) return null;
  const alliance = nativeAlliance(stage.alliance(origin.country));
  const whole = friendlyComponent(stage, origin, alliance);
  const groupResult = members => {
    if (!recomputeCache) return evaluateEncirclementGroup(stage, members, alliance);
    // Traversal order affects pocket processing, so preserve the exact order
    // in the key rather than treating equal membership as interchangeable.
    const key = `${alliance}:${members.map(area => area.id).join(',')}`;
    if (!recomputeCache.groups.has(key)) recomputeCache.groups.set(key, evaluateEncirclementGroup(stage, members, alliance, recomputeCache));
    return recomputeCache.groups.get(key);
  };
  let best = groupResult(whole);
  if (best.level === 2 || whole.length < 2 || whole.length > MAX_SPLIT_GROUP) return best;
  if (recomputeCache && !threatNearby(stage, whole, alliance, recomputeCache)) return best;
  // Every friendly neighbour of a part member is in `whole`, so the split-offs can walk a local
  // adjacency list (same neighbour order as stage.adjE) instead of re-testing each tile.
  const byId = new Map(whole.map(area => [area.id, area]));
  const local = new Map();
  for (const area of whole) local.set(area.id, (stage.adjE.get(area.id) || []).filter(id => byId.has(id)));
  for (const cut of whole) {
    if (cut.id === originId) continue;
    const part = [origin], seen = new Set([originId]);
    for (let head = 0; head < part.length; head++) {
      for (const id of local.get(part[head].id)) {
        if (id === cut.id || seen.has(id)) continue;
        seen.add(id); part.push(byId.get(id));
      }
    }
    if (part.length + 1 >= whole.length) continue;
    const candidate = groupResult(part);
    if (moreSevere(candidate, best)) best = candidate;
  }
  return best;
}

function setEncirclementMorale(area, level, emit) {
  for (const army of area.armies) {
    const encircled = level > 0;
    army.encircled = encircled;
    // In this ruleset morale 1 is the encirclement debuff. Once the computed
    // ring is gone, clear it immediately so both combat and rendering recover.
    const next = encircled ? 1 : army.morale === 1 ? 0 : army.morale;
    const nextUpTurn = encircled || army.morale === 1 ? 0 : army.moraleUpTurn;
    if (next === army.morale && nextUpTurn === army.moraleUpTurn) continue;
    army.morale = next;
    army.moraleUpTurn = nextUpTurn;
    emit?.({ area: area.id, armyId: army.id, morale: next, moraleUpTurn: nextUpTurn });
  }
}

const encirclementCaches = new WeakMap();

// Everything the encirclement result of a unit's friendly group reads, apart from static stage data.
function tileSignature(stage, id) {
  const area = stage.st(id);
  if (!area) return '';
  let signature = `${area.country}|${area.installation}|${area.areaType}|${nativeAlliance(stage.alliance(area.country))}`;
  for (const army of area.armies || []) signature += `|${army.type},${army.hp},${army.maxHp},${army.level},${army.cards}`;
  return signature;
}

function dependencyTiles(stage, whole, recomputeCache) {
  const deps = new Set();
  for (const area of whole) deps.add(area.id);
  for (const area of whole) for (const id of stage.adjE.get(area.id) || []) {
    deps.add(id);
    const edge = areaView(stage, id);
    if (isWall(stage, edge) || hasArmies(edge)) continue;
    const region = cachedEmptyRegion(stage, edge, recomputeCache);
    for (const regionId of region.ids) deps.add(regionId);
    for (const boundaryId of region.boundary) deps.add(boundaryId);
  }
  return deps;
}

export function recomputeAdjacentEncirclement(stage, areaId, emit) {
  if (!stage.st(areaId)) return;
  const levels = new Map();
  const recomputeCache = { emptyRegions: new Map(), groups: new Map(), deps: new Map() };
  for (const id of stage.enabled || []) levels.set(id, 0);
  // Attackers must belong to another, non-neutral alliance; with none on the board nothing can be encircled.
  const present = new Set();
  for (const id of stage.enabled || []) {
    const area = stage.st(id);
    if (area?.country != null && hasArmies(area)) present.add(nativeAlliance(stage.alliance(area.country)));
  }
  present.delete(4);
  // An origin's result only depends on the tiles in its dependency set (group, its neighbours and the empty
  // regions touching it with their borders). Reuse last call's result while none of those tiles changed.
  const signatures = new Map();
  for (const id of stage.enabled || []) signatures.set(id, tileSignature(stage, id));
  const previous = encirclementCaches.get(stage);
  const changed = [];
  if (previous) for (const [id, signature] of signatures) if (previous.signatures.get(id) !== signature) changed.push(id);
  const entries = new Map();
  for (const id of stage.enabled || []) {
    const origin = stage.st(id);
    if (origin?.country != null && hasArmies(origin)) {
      const alliance = nativeAlliance(stage.alliance(origin.country));
      if (!present.size || (present.size === 1 && present.has(alliance))) continue;
    }
    let entry = previous?.entries.get(id);
    if (entry && changed.some(tile => entry.deps.has(tile))) entry = null;
    if (!entry) {
      const result = evaluateEncirclement(stage, id, recomputeCache);
      if (!result) continue;
      let deps = recomputeCache.deps.get(id);
      if (!deps) {
        const whole = friendlyComponent(stage, origin, nativeAlliance(stage.alliance(origin.country)));
        deps = dependencyTiles(stage, whole, recomputeCache);
        for (const member of whole) recomputeCache.deps.set(member.id, deps);
      }
      entry = { level: result.level, ids: result.level ? result.defenders.map(member => member.id) : [], deps };
    }
    entries.set(id, entry);
    if (!entry.level) continue;
    for (const memberId of entry.ids)
      if (entry.level > (levels.get(memberId) || 0)) levels.set(memberId, entry.level);
  }
  encirclementCaches.set(stage, { signatures, entries });
  for (const id of stage.enabled || []) {
    const area = stage.st(id);
    if (area?.armies?.length) setEncirclementMorale(area, levels.get(id) || 0, emit);
  }
}

// CFight::AirStrikesAttack (native RVA 0x46954). This is shared by air-force
// cards and aircraft-carrier attacks (the latter set ApplyResult type 4).
export function resolveAirStrike(stage, country, area, type, medalLevel, rng) {
  const def = type === 1 ? stage.armyDef(country, 'airstrike') :
    type === 2 ? stage.armyDef(country, 'bomber') : null;
  const bonus = medalLevel > 0 ? 1 : 0;
  const min = (def?.minAttack || 0) + bonus;
  const max = (def?.maxAttack || 0) + bonus;
  const roll = min + rng.int(max - min + 1);
  let damage = roll * 5;
  if (type === 3) damage = 0;
  else if (area.installation === 'antiaircraft') damage = Math.trunc(roll * 3 / 2);
  else if (area.installation === 'radar') damage = Math.trunc(damage / 2);
  return { roll, damage };
}

// Read from the original .so's GetArmyAbility table at RVA 0x87244.
// Native 20-byte rows: attack, defence, turn recovery, instant recovery, max-HP %.
const ARMY_LEVELS = [
  [0, 0, 0, 0, 0], [1, 0, 0, 10, 0], [1, 1, 0, 20, 0],
  [1, 1, 0, 30, 20], [1, 1, 2, 40, 20],
];
// Original GetCommanderAbility table at .data RVA 0x870dc, 24-byte rows:
// attack, defence, recovery, instant recovery, max-HP %, cooldown.
const COMMANDER_LEVELS = [
  [0, 0, 0, 10, 5, 4], [0, 0, 0, 15, 10, 4], [0, 0, 0, 20, 15, 4],
  [1, 0, 0, 25, 20, 4], [1, 0, 0, 30, 25, 4], [1, 0, 1, 35, 30, 3],
  [1, 1, 2, 40, 35, 3], [1, 1, 3, 45, 40, 3], [1, 1, 4, 50, 45, 3],
  [2, 1, 5, 55, 50, 3], [2, 1, 6, 60, 55, 2], [2, 1, 7, 65, 60, 2],
  [3, 1, 8, 70, 65, 2], [3, 1, 9, 75, 70, 2], [3, 2, 10, 80, 75, 2],
];

function commanderBonus(commanderLevel) {
  const index = Math.max(0, Math.min(14, Math.trunc(commanderLevel ?? 8)));
  return COMMANDER_LEVELS[index];
}

function levelBonus(army) {
  const level = Math.max(0, Math.min(4, Math.trunc(army.level || 0)));
  const [attack, defence] = ARMY_LEVELS[level];
  return { attack, defence };
}

function combatBonus(army, area, commanderLevel) {
  const level = levelBonus(army), cards = Math.trunc(army.cards || 0);
  let attack = level.attack, defence = level.defence;
  if (cards & 8) {
    const commander = commanderBonus(commanderLevel);
    attack = Math.max(attack, commander[0]);
    defence = Math.max(defence, commander[1]);
  }
  // Native CArmy::HasCard uses 1 << ARMY_CARD: assault=1, defence=2,
  // carrier=4, commander=8. Commander takes the stronger level/rank bonus.
  // The imported Wc2-own hook replaces native low-morale per-die damage with
  // its group encirclement percentage. Breakthrough morale keeps its +1 bonus.
  const moraleAttack = army.morale === 2 ? 1 : (army.morale === 1 ? -1 : 0);
  const areaDefence = area.installation === 'fort' || area.installation === 'entrenchment' || area.areaType === 1 ? 1 : 0;
  return {
    attack: attack + ((cards & 1) ? 1 : 0) + moraleAttack,
    defence: defence + ((cards & 2) ? 1 : 0) + areaDefence,
  };
}

export function armyMaxHp(baseHp, level, commanderLevel = 8, hasCommander = false) {
  const clamped = Math.max(0, Math.min(4, Math.trunc(level || 0)));
  let maxHpPct = ARMY_LEVELS[clamped][4];
  if (hasCommander) maxHpPct = Math.max(maxHpPct, commanderBonus(commanderLevel)[4]);
  return Math.trunc(baseHp * (100 + maxHpPct) / 100);
}

// CArea::TurnEnd uses the original GetArmyAbility/GetCommanderAbility tables.
export function armyTurnRecovery(army, commanderLevel = 8) {
  const level = Math.max(0, Math.min(4, Math.trunc(army.level || 0)));
  const recovery = ARMY_LEVELS[level][2];
  return (army.cards & 8) ? Math.max(recovery, commanderBonus(commanderLevel)[2]) : recovery;
}

export function commanderInstantRecovery(commanderLevel = 8) {
  return commanderBonus(commanderLevel)[3];
}

export function commanderCooldown(commanderLevel = 8) {
  const index = Math.max(0, Math.min(14, Math.trunc(commanderLevel ?? 8)));
  return COMMANDER_LEVELS[index][5] ?? 3;
}

// CActionAI::getMedal (RVA 0x4864c).
// Generates random combat medals based on city importance and damage.
export function rollCombatMedal(damage, targetArea, rng) {
  if (damage <= 0) return false;
  let r = rng.int(100);
  if (targetArea) {
    if (targetArea.areaType === 1) r += 12;      // CAPITAL
    else if (targetArea.areaType === 3) r += 8; // LARGE_CITY
    else if (targetArea.areaType === 4) r += 4; // NORMAL_CITY
  }
  if (damage <= 24) return r >= 95;
  if (damage <= 29) return r >= 91;
  if (damage <= 34) return r >= 87;
  return r >= 82;
}

// CArea::LostArmyStrength & CCountry::CommanderDie.
// Updates commander cooldown state, emits commanderDied event, and records destruction stats.
export function handleUnitKilled(game, area, army, killerCountry, cause = 'attack', sourceId = null) {
  const st = game.stage;
  const victimCountry = area?.country;
  if (victimCountry && (army.cards & 8)) {
    const info = st.countries.get(victimCountry);
    if (info) {
      info.commanderAlive = false;
      const isAi = victimCountry !== game.player && (info.ai !== false);
      info.commanderTurn = isAi ? 5 : commanderCooldown(info.commanderLevel);
      game.emit(EV.COMMANDER_DIED, { country: victimCountry, area: area.id, armyId: army.id, commanderTurn: info.commanderTurn });
    }
  }
  if (killerCountry) {
    const killer = st.countries.get(killerCountry);
    if (killer) {
      killer.destroyCount = killer.destroyCount || {};
      killer.destroyCount[army.type] = (killer.destroyCount[army.type] || 0) + 1;
    }
  }
  if (game?.recordWarLoss && victimCountry && killerCountry) {
    game.recordWarLoss(victimCountry, killerCountry, army?.type);
  }
}

const EXP_TO_PROMOTE = [100, 150, 200, 250];

// CArmy::AddExp / Upgrade / ResetMaxStrength from the original binary.
// Each call promotes at most one level; naval units need 150% experience.
export function addCombatExperience(stage, area, army, gained) {
  army.exp = (army.exp || 0) + Math.trunc(gained);
  const level = Math.max(0, Math.min(4, Math.trunc(army.level || 0)));
  if (level >= 4) return false;
  let needed = EXP_TO_PROMOTE[level];
  if (NAVAL_COUNTER_TYPES.has(army.type)) needed = Math.floor(needed * 3 / 2);
  if (army.exp < needed) return false;

  army.exp -= needed;
  return upgradeArmy(stage, area, army);
}

// CArmy::Upgrade: also used by the Ace Forces card, without an EXP check.
export function upgradeArmy(stage, area, army) {
  const level = Math.max(0, Math.min(4, Math.trunc(army.level || 0)));
  if (level >= 4) return false;
  const oldMaxHp = army.maxHp || 1;
  const nextLevel = level + 1;
  army.level = nextLevel;
  // Upgrade adds the new level's instant recovery against the old max first;
  // ResetMaxStrength(false) then scales current HP proportionally to new max.
  army.hp = Math.min(oldMaxHp, Math.max(0, army.hp || 0) + ARMY_LEVELS[nextLevel][3]);
  const country = stage.countries?.get(area.country);
  const def = stage.armyDef(area.country, army.type);
  const newMaxHp = armyMaxHp(def.maxHp || 100, nextLevel, country?.commanderLevel, !!(army.cards & 8));
  army.hp = Math.min(newMaxHp, Math.trunc(newMaxHp * army.hp / oldMaxHp));
  army.maxHp = newMaxHp;
  return true;
}

function attackRow(army, def, rng, extraAttack = 0) {
  const count = armyDiceCount(army.hp, army.maxHp);
  const min = Math.max(0, Math.trunc(def.minAttack || 0));
  const max = Math.max(min, Math.trunc(def.maxAttack ?? min));
  const dice = [];
  for (let i = 0; i < count; i++) dice.push(min + rng.int(max - min + 1));
  return { count, dice, sum: dice.reduce((n, d) => n + d + extraAttack, 0) };
}

// Direct port of CFight::NormalAttack in orig_easytech.so (0x47424 - 0x47564).
function nativeDamage(row, defenderDefence, attackerDef, defenderDef, defenderArea = null, isCounter = false) {
  let dmg = row.sum - row.count * (defenderDefence || 0);
  // orig_easytech.so (0x4748a - 0x47498 & 0x47540 - 0x47544):
  // If targetArea is RADAR (installation 4) and incoming attack is artillery (1) or rocket (2):
  if (!isCounter && defenderArea?.installation === 'radar' &&
      (attackerDef?.attackClass === 'artillery' || attackerDef?.attackClass === 'rocket')) {
    dmg = Math.trunc(dmg / 2);
  }
  // orig_easytech.so (0x4749a - 0x474a8 & 0x4754a - 0x47564, 0x47526 - 0x4753e):
  // Float at 0x47564 is 1.4f.
  // Attack: if attacker is artillery (1) OR defender is direct (0) -> dmg = trunc(dmg * 1.4)
  // Counter: if defender is artillery (1) OR attacker is direct (0) -> dmg = trunc(dmg * 1.4)
  const attackerClass = attackerDef?.attackClass || 'direct';
  const defenderClass = defenderDef?.attackClass || 'direct';
  const multiplierApplies = isCounter
    ? (defenderClass === 'artillery' || attackerClass === 'direct')
    : (attackerClass === 'artillery' || defenderClass === 'direct');
  if (multiplierApplies) {
    dmg = Math.trunc(dmg * 1.4);
  }
  return Math.max(1, dmg);
}

// ctx = { game, attacker, defender, fromArea, toArea, kind, rng }
// Damage rates and class gates mirror CFight::GetAttackDmgParameters /
// GetCounterDmgParameters and ArmyDef::CanCounter from the native port.
// The JavaScript model consumes the same armydef ability fields parsed from
// the original asset and keeps custom flank/encirclement rules as a separate
// post-rate layer.
export function resolveAttack({ game, attacker, defender, fromArea, toArea, kind, rng, suppressDefenderDamage = false }) {
  const st = game.stage;
  const attackerDef = st.armyDef(fromArea.country, attacker.type);
  const defenderDef = st.armyDef(toArea.country, defender.type);
  const stackSplash = (attackerDef.stackSplashFalloff || 0) > 0;
  const canDefenderCounter = !stackSplash && canCounterByDefs(attackerDef, defenderDef, toArea);

  // Native NormalAttack rolls the defender's row first (for counter damage),
  // then the attacker's row. Both sides' dice counts are taken before losses.
  // Native code rolls and records the target's dice even when its counter is
  // later suppressed. Keeping those draws also preserves the seeded RNG stream.
  const attackerTactics = tacticalBonus(game, fromArea.country, attacker, { role: 'attack', fromAreaId: fromArea.id, toAreaId: toArea.id });
  const defenderTactics = tacticalBonus(game, toArea.country, defender, { role: 'defend', fromAreaId: toArea.id, toAreaId: fromArea.id });
  // A named group commander replaces the legacy general card's combat bonus;
  // card HP and recovery are preserved, but offensive/defensive bonuses cannot stack.
  const attackerBonus = combatBonus(attackerTactics.commander ? { ...attacker, cards: attacker.cards & ~8 } : attacker, fromArea, st.countries?.get(fromArea.country)?.commanderLevel);
  const defenderBonus = combatBonus(defenderTactics.commander ? { ...defender, cards: defender.cards & ~8 } : defender, toArea, st.countries?.get(toArea.country)?.commanderLevel);
  const counterRow = attackRow(defender, defenderDef, rng, defenderBonus.attack);
  const attackRowResult = attackRow(attacker, attackerDef, rng, attackerBonus.attack);
  const defenderFatigued = defender.movement === 0;
  const attackerEncirclement = evaluateEncirclement(st, fromArea.id);
  const defenderEncirclement = evaluateEncirclement(st, toArea.id);
  // Encirclement and flank/rear penalties never stack. Alternating back to the direction faced before
  // the previous flank/rear hit receives only the repeat rate — the defender has already braced that way.
  const attackKind = defenderEncirclement?.level ? 'front' : attackFacingKind(st, defender.facing, fromArea.id, toArea.id);
  const flankRepeat = defender.flankGuardArea === fromArea.id;
  const flankPct = attackKind === 'rear' ? (flankRepeat ? REAR_REPEAT_PCT : REAR_PCT)
    : attackKind === 'flank' ? (flankRepeat ? FLANK_REPEAT_PCT : FLANK_PCT)
    : 0;
  const attackMatchup = matchupMultiplier(attackerDef, defenderDef);
  const counterMatchup = matchupMultiplier(defenderDef, attackerDef);
  const attackerDamageRate = (attackerDef.attackMultiplier ?? 1) * (defenderDef.receivedDamageMultiplier ?? 1) * attackMatchup.multiplier * (flankPct > 0 ? (100 + flankPct) / 100 : 1);
  const counterDamageRate = (defenderDef.attackMultiplier ?? 1) * (attackerDef.receivedDamageMultiplier ?? 1) * counterMatchup.multiplier * (defenderFatigued ? 0.9 : 1);
  const rawAttackerLoss = canDefenderCounter
    ? Math.max(1, Math.trunc(nativeDamage(counterRow, attackerBonus.defence, defenderDef, attackerDef, fromArea, true) * defenderTactics.counter * attackerTactics.received))
    : 0;
  const rawDefenderLoss = Math.max(1, Math.trunc(nativeDamage(attackRowResult, defenderBonus.defence, attackerDef, defenderDef, toArea, false) * attackerTactics.attack * defenderTactics.received));
  // Normal attack damage belongs to the source group; counter damage belongs
  // to the defending group, matching Wc2-own's patched damage sites.
  const attackerLoss = defenderEncirclement?.level
    ? Math.trunc(rawAttackerLoss * (100 - defenderEncirclement.penaltyPct) / 100) : rawAttackerLoss;
  const scaledDefenderLoss = attackerEncirclement?.level
    ? Math.trunc(rawDefenderLoss * (100 - attackerEncirclement.penaltyPct) / 100) : rawDefenderLoss;
  const defenderLoss = suppressDefenderDamage ? 0 : scaledDefenderLoss;

  // Keep the complete calculation trace with the result.  The UI only needs
  // defenderLoss/attackerLoss, but a replay or balance audit needs to know
  // which rule changed the raw native result and by how much.
  const attackerEncirclementInfo = attackerEncirclement ? {
    level: attackerEncirclement.level, penaltyPct: attackerEncirclement.penaltyPct,
    ratioX100: attackerEncirclement.ratioX100, gaps: attackerEncirclement.gaps,
    pocketTiles: attackerEncirclement.pocketTiles, attackerUnits: attackerEncirclement.attackerUnits,
    defenderUnits: attackerEncirclement.defenderUnits,
  } : { level: 0, penaltyPct: 0 };
  const defenderEncirclementInfo = defenderEncirclement ? {
    level: defenderEncirclement.level, penaltyPct: defenderEncirclement.penaltyPct,
    ratioX100: defenderEncirclement.ratioX100, gaps: defenderEncirclement.gaps,
    pocketTiles: defenderEncirclement.pocketTiles, attackerUnits: defenderEncirclement.attackerUnits,
    defenderUnits: defenderEncirclement.defenderUnits,
  } : { level: 0, penaltyPct: 0 };
  const attackerFatiguePct = defenderFatigued ? 10 : 0;
  const flankRule = attackKind === 'front' ? 'none' : flankRepeat ? `repeat_${attackKind}_guard` : `${attackKind === 'rear' ? 'rear' : 'side'}_flank`;

  return {
    defenderLoss,
    attackerLoss,
    flankPct,
    attackKind,
    diagnostics: {
      formula: 'nativeDamage -> fatigue -> flank -> encirclement -> suppression',
      attacker: {
        groupTactics: attackerTactics,
        hpBefore: attacker.hp, maxHp: attacker.maxHp, movementBefore: attacker.movement,
        type: attacker.type, level: attacker.level || 0, morale: attacker.morale || 0,
        cards: attacker.cards || 0, dice: attackRowResult.dice, diceCount: attackRowResult.count,
        attackBonus: attackerBonus.attack, defenceBonus: attackerBonus.defence,
        attackMultiplier: attackerDef.attackMultiplier ?? 1, receivedDamageMultiplier: attackerDef.receivedDamageMultiplier ?? 1,
        matchup: attackMatchup,
        attackRowSum: attackRowResult.sum,
        encirclement: attackerEncirclementInfo,
      },
      defender: {
        groupTactics: defenderTactics,
        hpBefore: defender.hp, maxHp: defender.maxHp, movementBefore: defender.movement,
        type: defender.type, level: defender.level || 0, morale: defender.morale || 0,
        cards: defender.cards || 0, dice: counterRow.dice, diceCount: counterRow.count,
        attackBonus: defenderBonus.attack, defenceBonus: defenderBonus.defence,
        counterRowSum: counterRow.sum, canCounter: canDefenderCounter,
        stackSplash: { applied: stackSplash, falloff: attackerDef.stackSplashFalloff || 0 },
        attackMultiplier: defenderDef.attackMultiplier ?? 1, receivedDamageMultiplier: defenderDef.receivedDamageMultiplier ?? 1,
        matchup: counterMatchup,
        encirclement: defenderEncirclementInfo,
      },
      modifiers: {
        fatigue: { applied: defenderFatigued, pct: attackerFatiguePct, target: 'counterattack' },
        flank: { applied: flankPct > 0, pct: flankPct, rule: flankRule, suppressedByEncirclement: !!defenderEncirclement?.level },
        matchup: { attackRate: attackerDamageRate, counterRate: counterDamageRate, attack: attackMatchup, counter: counterMatchup },
        encirclement: {
          attackerLossPenaltyPct: defenderEncirclement?.penaltyPct || 0,
          defenderLossPenaltyPct: attackerEncirclement?.penaltyPct || 0,
          attackerSide: attackerEncirclementInfo,
          defenderSide: defenderEncirclementInfo,
        },
        suppression: { defenderDamageSuppressed: !!suppressDefenderDamage, reason: suppressDefenderDamage ? 'fort_counter' : null },
      },
      results: {
        attackerLossRaw: rawAttackerLoss, attackerLossAfterModifiers: attackerLoss,
        defenderLossRaw: rawDefenderLoss, defenderLossAfterModifiers: scaledDefenderLoss,
        defenderLossApplied: defenderLoss,
        attackerHpAfter: Math.max(0, attacker.hp - attackerLoss),
        defenderHpAfter: Math.max(0, defender.hp - defenderLoss),
        attackerMovementAfter: null,
      },
    },
    rolls: {
      attacker: attackRowResult.dice,
      defender: counterRow.dice,
      attackerDice: attackRowResult.count,
      defenderDice: counterRow.count,
      attackerDiceLost: attackRowResult.count - armyDiceCountAfterLoss(attacker.hp, attacker.maxHp, attackerLoss),
      defenderDiceLost: counterRow.count - armyDiceCountAfterLoss(defender.hp, defender.maxHp, defenderLoss),
      canCounter: canDefenderCounter,
      attackerEncirclement: attackerEncirclement?.level || 0,
      defenderEncirclement: defenderEncirclement?.level || 0,
      kind,
    },
  };
}

// Exact dice-sum distribution. Enumerating sums, rather than individual rolls,
// keeps the estimator deterministic and cheap even for five dice.
function rowDistribution(army, def, bonus) {
  const count = armyDiceCount(army.hp, army.maxHp);
  const min = Math.max(0, Math.trunc(def.minAttack || 0));
  const max = Math.max(min, Math.trunc(def.maxAttack ?? min));
  let distribution = new Map([[0, 1]]);
  for (let die = 0; die < count; die++) {
    const next = new Map();
    for (const [sum, probability] of distribution)
      for (let face = min; face <= max; face++)
        next.set(sum + face + bonus, (next.get(sum + face + bonus) || 0) + probability / (max - min + 1));
    distribution = next;
  }
  return { count, distribution };
}

export function estimateAttack(game, attacker, defender, fromArea, toArea, attackerCountry = null, encirclementMemo = null) {
  const stage = game.stage;
  const attackingCountry = attackerCountry || attacker.country || fromArea.country;
  const attackerDef = stage.armyDef(attackingCountry, attacker.type);
  const defenderDef = stage.armyDef(toArea.country, defender.type);
  const attackerTactics = tacticalBonus(game, attackingCountry, attacker, { role: 'attack', fromAreaId: fromArea.id, toAreaId: toArea.id });
  const defenderTactics = tacticalBonus(game, toArea.country, defender, { role: 'defend', fromAreaId: toArea.id, toAreaId: fromArea.id });
  if (attacker.type === 'aircraftcarrier') {
    const airDef = stage.armyDef(attackingCountry, 'airstrike');
    const medalBonus = (game.medalLevels?.airforce || 0) > 0 ? 1 : 0;
    const min = (airDef?.minAttack || 0) + medalBonus;
    const max = Math.max(min, (airDef?.maxAttack || 0) + medalBonus);
    const damageDistribution = new Map();
    let dmgDef = 0, pKillFront = 0;
    for (let roll = min; roll <= max; roll++) {
      const base = toArea.installation === 'antiaircraft' ? Math.trunc(roll * 3 / 2) :
        toArea.installation === 'radar' ? Math.trunc(roll * 5 / 2) : roll * 5;
      const damage = Math.trunc(base * attackerTactics.attack * defenderTactics.received);
      const chance = 1 / (max - min + 1);
      damageDistribution.set(damage, (damageDistribution.get(damage) || 0) + chance);
      dmgDef += chance * damage;
      if (damage >= defender.hp) pKillFront += chance;
    }
    return { dmgDef, dmgAtt: 0, pKillFront, pAttackerDies: 0, canCounter: false,
      flankPct: 0, encircle: { atk: 0, def: 0 }, damageDistribution,
      constructionDamageChance: (attackerDef.constructionDamageChance || 0) / 100 };
  }
  const attackerBonus = combatBonus(attackerTactics.commander ? { ...attacker, cards: attacker.cards & ~8 } : attacker, fromArea, stage.countries?.get(attackingCountry)?.commanderLevel);
  const defenderBonus = combatBonus(defenderTactics.commander ? { ...defender, cards: defender.cards & ~8 } : defender, toArea, stage.countries?.get(toArea.country)?.commanderLevel);
  const attack = rowDistribution(attacker, attackerDef, attackerBonus.attack);
  const counter = rowDistribution(defender, defenderDef, defenderBonus.attack);
  const encirclement = areaId => {
    if (!encirclementMemo) return evaluateEncirclement(stage, areaId);
    if (!encirclementMemo.has(areaId)) encirclementMemo.set(areaId, evaluateEncirclement(stage, areaId));
    return encirclementMemo.get(areaId);
  };
  const attackerEncirclement = encirclement(fromArea.id);
  const defenderEncirclement = encirclement(toArea.id);
  const attackKind = defenderEncirclement?.level ? 'front' : attackFacingKind(stage, defender.facing, fromArea.id, toArea.id);
  const flankRepeat = defender.flankGuardArea === fromArea.id;
  const flankPct = attackKind === 'rear' ? (flankRepeat ? REAR_REPEAT_PCT : REAR_PCT)
    : attackKind === 'flank' ? (flankRepeat ? FLANK_REPEAT_PCT : FLANK_PCT)
    : 0;
  const canCounter = !(attackerDef.stackSplashFalloff > 0) && canCounterByDefs(attackerDef, defenderDef, toArea);
  let dmgDef = 0, dmgAtt = 0, pKillFront = 0, pAttackerDies = 0;
  const damageDistribution = new Map();
  for (const [sum, p] of attack.distribution) {
    const native = nativeDamage({ sum, count: attack.count }, defenderBonus.defence, attackerDef, defenderDef, toArea, false);
    const raw = Math.max(1, Math.trunc(native * attackerTactics.attack * defenderTactics.received));
    const damage = attackerEncirclement?.level ? Math.trunc(raw * (100 - attackerEncirclement.penaltyPct) / 100) : raw;
    dmgDef += p * damage;
    damageDistribution.set(damage, (damageDistribution.get(damage) || 0) + p);
    if (damage >= defender.hp) pKillFront += p;
  }
  if (canCounter) for (const [sum, p] of counter.distribution) {
    const native = nativeDamage({ sum, count: counter.count }, attackerBonus.defence, defenderDef, attackerDef, fromArea, true);
    const raw = Math.max(1, Math.trunc(native * defenderTactics.counter * attackerTactics.received));
    const damage = defenderEncirclement?.level ? Math.trunc(raw * (100 - defenderEncirclement.penaltyPct) / 100) : raw;
    dmgAtt += p * damage;
    if (damage >= attacker.hp) pAttackerDies += p;
  }
  if (canCounter && attackerDef.fortSecondAttack && toArea.installation === 'fort' && defenderDef.attackClass !== 'rocket') {
    const survives = (1 - pKillFront) * (1 - pAttackerDies);
    dmgAtt += survives * dmgAtt;
    pAttackerDies = 1 - (1 - pAttackerDies) * (1 - survives * pAttackerDies);
  }
  return { dmgDef, dmgAtt, pKillFront, pAttackerDies, canCounter, flankPct, damageDistribution,
    constructionDamageChance: (attackerDef.constructionDamageChance || 0) / 100,
    encircle: { atk: attackerEncirclement?.level || 0, def: defenderEncirclement?.level || 0 } };
}
