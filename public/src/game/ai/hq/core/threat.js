// Threat evaluation and defensive probability modeling.
import { armyDiceCount, estimateAttack } from '../../../rules/combatModel.js';
import { expectedExchange } from './estimate.js';

// --- Named Constants with Explanations ---

// Logistic steepness power for combat defeat calculation
export const THREAT_POWER_EXPONENT = 2.0;
// Baseline defensive fortification multiplier
export const FORTIFICATION_DEFENCE_BONUS = 0.25;
// Urban terrain defensive cover bonus
export const URBAN_DEFENCE_BONUS = 0.15;
// Entrenchment installation cover bonus
export const ENTRENCHMENT_DEFENCE_BONUS = 0.20;
// Minimum effective HP floor to prevent division by zero
export const MIN_EFFECTIVE_HP = 1.0;

const threatMapCache = new WeakMap();
const recaptureCache = new WeakMap();
export function invalidateThreatMap(model) { threatMapCache.delete(model); recaptureCache.delete(model); }

/**
 * Returns a map of areaId -> { atk, dice, units, soon }
 * representing enemy attack potential against friendly/allied territories.
 */
export function threatMap(model) {
  if (threatMapCache.has(model)) {
    return threatMapCache.get(model);
  }

  const result = new Map();
  const st = model.st;
  const game = model.game;
  const enemyUnits = model.units.enemy;
  const myAreaIds = new Set(model.mine.map(a => a.id));
  const isNearBorder = (sId) => {
    if (myAreaIds.has(sId)) return true;
    const adj1 = st.adjE.get(sId);
    if (!adj1) return false;
    if (adj1.some(id => myAreaIds.has(id))) return true;
    return adj1.some(n => (st.adjE.get(n) || []).some(id => myAreaIds.has(id)));
  };

  // Track each area's threatening attackers
  for (const enemyU of enemyUnits) {
    const sId = enemyU.area;
    if (!isNearBorder(sId)) continue;
    const startArea = st.st(sId);
    if (!startArea) continue;

    const threatenedDestinations = new Map(); // targetAreaId -> { soon: 1|2, stagingArea: id }

    // 1. Immediate threats from current position
    const immediateTargets = model.attackTargets(enemyU, sId);
    for (const tId of immediateTargets) {
      threatenedDestinations.set(tId, { soon: 1, stagingArea: sId });
    }

    // 2. Mobile threats from reachable staging positions
    const isAirOrCarrier = enemyU.type === 'aircraftcarrier';
    const reachMap = model.reach(enemyU);
    for (const [stagingId] of reachMap) {
      if (!isAirOrCarrier && !st.adjE.get(stagingId)?.some(id => myAreaIds.has(id))) continue;
      const mobileTargets = model.attackTargets(enemyU, stagingId);
      for (const tId of mobileTargets) {
        if (!threatenedDestinations.has(tId)) {
          threatenedDestinations.set(tId, { soon: 1, stagingArea: stagingId });
        }
      }
    }

    // Evaluate expected exchange against each threatened target
    for (const [tId, threatInfo] of threatenedDestinations) {
      const targetArea = st.st(tId);
      if (!targetArea || model.rel(targetArea.country) === 'enemy') continue;

      const ex = expectedExchange(model, enemyU, threatInfo.stagingArea, tId);
      const estDmg = ex.dmgDef > 0 ? ex.dmgDef : (enemyU.maxHp * 0.2);
      const dice = ex.dice ?? armyDiceCount(enemyU.hp, enemyU.maxHp);

      if (!result.has(tId)) {
        result.set(tId, {
          atk: 0,
          dice: 0,
          units: [],
          soon: threatInfo.soon,
        });
      }

      const entry = result.get(tId);
      entry.atk += estDmg;
      entry.dice += dice;
      entry.units.push(enemyU);
      if (threatInfo.soon < entry.soon) {
        entry.soon = threatInfo.soon;
      }
    }
  }

  threatMapCache.set(model, result);
  return result;
}

/**
 * Computes defensive holding strength for an area, optionally with hypothetical reinforcements.
 */
export function holdStrength(model, areaId, extraUnits = [], occupants = null) {
  const targetArea = model.st.st(areaId);
  const existingArmies = occupants || targetArea?.armies || [];
  const allArmies = [...existingArmies, ...extraUnits.map(u => u.army || u)];

  let totalHp = 0;
  let totalDef = 0;

  for (const army of allArmies) {
    const hp = army.hp ?? 100;
    totalHp += hp;
    const def = model.st.armyDef ? model.st.armyDef(army.country || model.me, army) : {};
    const baseDefence = def.defence ?? def.cost?.defence ?? 2;
    totalDef += baseDefence + (army.level || 0);
  }

  return {
    def: totalDef,
    hp: totalHp,
    units: allArmies,
  };
}

/**
 * Estimates the probability of losing areaId next turn (0..1).
 * Strictly monotonic with respect to extraUnits reinforcements.
 */
function lossProbability(model, areaId, hold) {
  const tMap = threatMap(model);
  const threat = tMap.get(areaId);

  // If no enemy can reach or attack this area, loss probability is zero
  if (!threat || threat.atk <= 0 || threat.units.length === 0) {
    return 0;
  }

  // If completely undefended and under threat, guaranteed loss
  if (hold.hp <= 0) {
    return 1.0;
  }

  const area = model.area(areaId);
  let terrainMultiplier = 1.0;
  if (area?.installation === 'fort') terrainMultiplier += FORTIFICATION_DEFENCE_BONUS;
  if (area?.installation === 'entrenchment') terrainMultiplier += ENTRENCHMENT_DEFENCE_BONUS;
  if (area?.areaType === 1 || area?.construction === 'city') terrainMultiplier += URBAN_DEFENCE_BONUS;

  const effectiveHp = Math.max(MIN_EFFECTIVE_HP, hold.hp * terrainMultiplier * (1 + 0.05 * hold.def));
  const incomingDamage = threat.atk;

  // Closed-form ratio-squared logistic: D^2 / (D^2 + H^2)
  // Strictly monotonic decreasing with respect to H (defenders)
  const dSq = Math.pow(incomingDamage, THREAT_POWER_EXPONENT);
  const hSq = Math.pow(effectiveHp, THREAT_POWER_EXPONENT);
  const prob = dSq / (dSq + hSq);

  return Math.max(0, Math.min(1, prob));
}

export function pLose(model, areaId, extraUnits = []) {
  return lossProbability(model, areaId, holdStrength(model, areaId, extraUnits));
}

export function pLoseWithOccupants(model, areaId, occupants) {
  return lossProbability(model, areaId, holdStrength(model, areaId, [], occupants));
}

/** Estimate recapture risk with the target treated as friendly and occupied only by these units. */
export function pLoseAfterCapture(model, areaId, occupants = []) {
  const area = model.st.st(areaId);
  if (!area) return 0;
  const own = occupants.map(u => u.army || u);
  if (!own.length) return 1;
  let cache = recaptureCache.get(model);
  if (!cache) { cache = new Map(); recaptureCache.set(model, cache); }
  const cacheKey = `${areaId}|${own.map(u => `${u.id}:${u.hp}`).sort().join(',')}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const hypothetical = { ...area, country: model.me, armies: own };
  let incoming = 0;
  for (const neighbor of model.st.adjE.get(areaId) || []) {
    const from = model.st.st(neighbor);
    if (!from || model.rel(from.country) !== 'enemy') continue;
    for (const enemy of from.armies || []) {
      const estimate = estimateAttack(model.game, enemy, own[0], from, hypothetical, from.country, model.encirclementMemo);
      incoming += Math.max(0, estimate.dmgDef || 0);
    }
  }
  if (!incoming) { cache.set(cacheKey, 0); return 0; }
  const hp = own.reduce((sum, u) => sum + (u.hp || 0), 0);
  const defence = own.reduce((sum, u) => sum + (model.st.armyDef?.(u.country || model.me, u.type)?.defence || 0), 0);
  const effective = Math.max(MIN_EFFECTIVE_HP, hp * (1 + .05 * defence));
  const attackSq = incoming ** THREAT_POWER_EXPONENT;
  const probability = attackSq / (attackSq + effective ** THREAT_POWER_EXPONENT);
  cache.set(cacheKey, probability);
  return probability;
}
