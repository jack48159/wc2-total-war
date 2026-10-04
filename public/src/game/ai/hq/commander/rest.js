// Casualty Rest & Evacuation System (伤兵后送休整)
// Implements priority evacuation for heavily damaged units to friendly cities and industrial zones.

import {
  REST_INFANTRY_TYPES,
  REST_EXCLUDE_TYPES,
  REST_HEAVY_TYPES
} from '../core/params.js';

/**
 * Calculates city level of an area consistent with turn.js rules.
 * @param {object} area
 * @returns {number}
 */
export function cityLevel(area) {
  if (!area) return 0;
  const base = area.areaType === 1 ? 3 : area.areaType === 3 ? 2 : area.areaType === 4 ? 1 : 0;
  const constr = area.construction === 'city' ? (area.level || 0) : 0;
  return Math.max(base, constr);
}

/**
 * Calculates industry level of an area consistent with turn.js rules.
 * @param {object} area
 * @returns {number}
 */
export function industryLevel(area) {
  if (!area) return 0;
  const base = area.areaType === 1 ? 2 : area.areaType === 3 ? 1 : 0;
  const constr = area.construction === 'industry' ? (area.level || 0) : 0;
  return Math.max(base, constr);
}

/**
 * Checks whether an army type is infantry.
 * @param {string} type
 * @returns {boolean}
 */
export function isInfantryUnit(type) {
  return REST_INFANTRY_TYPES.has(type);
}

/**
 * Checks whether an army type is artillery/rocket (explicitly excluded from heavy rest).
 * @param {string} type
 * @returns {boolean}
 */
export function isArtilleryUnit(type) {
  return REST_EXCLUDE_TYPES.has(type);
}

/**
 * Checks whether an army unit requires industry to produce (heavy equipment).
 * Excludes infantry and artillery.
 * @param {object} unit
 * @param {object} stage
 * @returns {boolean}
 */
export function isHeavyUnit(unit, stage) {
  const type = unit.type;
  if (isArtilleryUnit(type) || isInfantryUnit(type)) return false;
  if (REST_HEAVY_TYPES.has(type)) return true;

  // Check unit cost definition
  if ((unit.cost?.industry ?? 0) > 0) return true;

  // Check stage army definition
  const country = unit.country || stage?.st?.(unit.area)?.country;
  const def = stage?.armyDef ? stage.armyDef(country, type) : null;
  if (def && ((def.industry ?? def.cost?.industry ?? 0) > 0)) return true;

  // Check card catalog if available
  const cards = stage?.data?.cards?.others || [];
  for (const c of cards) {
    if (c.type === 'army' && c.name?.toLowerCase().replace(/\s+/g, '') === type && (c.industry || 0) > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluates whether a unit needs casualty evacuation or rest, differentiated by tactical value.
 * - High-value units (Generals, Tanks, Heavies, Navy, Rockets) evacuate aggressively (< 40% HP) to avoid loss of heavy assets.
 * - Medium-value units (Artillery, Elite) evacuate when < 25% HP.
 * - Low-value units (Line Infantry) evacuate only when critical (< 18% HP) and never abandon a frontline position as sole defender.
 * @param {object} unit
 * @param {object} currentArea
 * @param {object} model
 * @param {object} P - parameters from loadOverrides()
 * @returns {{needsRest: boolean, alreadyAtRest: boolean, restType: 'city'|'industry'|null, priorityLevel: 'high'|'medium'|'low'|'none', hpRatio: number}}
 */
export function evaluateRestStatus(unit, currentArea, model, P) {
  const maxHp = unit.maxHp || 100;
  const hp = unit.hp ?? maxHp;
  const hpRatio = hp / maxHp;
  const ownCountry = model.me || unit.country;
  const isControlled = currentArea?.country === ownCountry;

  const type = String(unit.type || '').toLowerCase();
  const hasGeneral = Boolean((unit.cards & 8) || unit.general);
  const isHeavy = isHeavyUnit(unit, model.game?.stage);
  const isNavy = ['battleship', 'carrier', 'cruiser', 'destroyer', 'submarine'].some(t => type.includes(t));
  const isArtillery = isArtilleryUnit(unit.type);
  const isInfantry = isInfantryUnit(unit.type);

  // 1. High-value units: Generals, Tanks, Heavy armor, Navy, Rockets
  if (P.restEnableHeavy && (hasGeneral || isHeavy || isNavy || type.includes('rocket'))) {
    const heavyThreshold = hasGeneral ? 0.50 : (P.restHeavyHpRatio ?? 0.40);
    if (hpRatio < heavyThreshold) {
      const iLvl = industryLevel(currentArea);
      const cLvl = cityLevel(currentArea);
      const isRestBase = isControlled && (iLvl >= (P.restIndustryMinLevel ?? 1) || cLvl >= 2);
      return {
        needsRest: true,
        alreadyAtRest: isRestBase,
        restType: (isNavy || isHeavy) ? 'industry' : 'city',
        priorityLevel: 'high',
        hpRatio
      };
    }
  }

  // 2. Medium-value units: Artillery, Rockets, Elite
  if (isArtillery || type.includes('elite')) {
    if (hpRatio < 0.25) {
      const cLvl = cityLevel(currentArea);
      const iLvl = industryLevel(currentArea);
      const isRestBase = isControlled && (cLvl >= (P.restCityMinLevel ?? 1) || iLvl >= 1);
      return {
        needsRest: true,
        alreadyAtRest: isRestBase,
        restType: 'city',
        priorityLevel: 'medium',
        hpRatio
      };
    }
  }

  // 3. Low-value units: Basic frontline infantry
  // Accept higher attrition; never abandon an active frontline as sole defender
  if (P.restEnableInfantry && isInfantry) {
    const isSoleFrontDefender = isControlled && (currentArea?.armies?.length <= 1) && (model.isFront ? model.isFront(currentArea.id) : false);
    if (!isSoleFrontDefender && hpRatio < (P.restInfantryHpRatio ?? 0.18)) {
      const cLvl = cityLevel(currentArea);
      const iLvl = industryLevel(currentArea);
      const isRestBase = isControlled && (cLvl >= (P.restCityMinLevel ?? 1) || iLvl >= (P.restIndustryMinLevel ?? 1));
      return {
        needsRest: true,
        alreadyAtRest: isRestBase,
        restType: 'city',
        priorityLevel: 'low',
        hpRatio
      };
    }
  }

  return { needsRest: false, alreadyAtRest: false, restType: null, priorityLevel: 'none', hpRatio };
}

/**
 * Finds the best evacuation destination within reach, or a safe step toward the nearest qualifying base.
 * Reserves rear base capacity for high-value units by throttling low-value infantry evacuation if congested.
 * @param {object} unit
 * @param {number} originAreaId
 * @param {'city'|'industry'} restType
 * @param {object} model
 * @param {object} P
 * @param {object} row
 * @param {'high'|'medium'|'low'} priorityLevel
 * @returns {{id: number, cost: number, command: object}|null}
 */
export function findRestEvacuationTarget(unit, originAreaId, restType, model, P, row, priorityLevel = 'medium') {
  const stage = model.game?.stage;
  if (!stage) return null;
  const ownCountry = model.me || unit.country;
  const reachMap = model.reach ? model.reach(row) : null;
  if (!reachMap || reachMap.size === 0) return null;

  // --- Phase 1: Direct reach to qualifying friendly resting bases ---
  let bestDirect = null;
  let bestDirectScore = -Infinity;

  for (const [destId, route] of reachMap.entries()) {
    const destArea = stage.st(destId);
    if (!destArea || destArea.country !== ownCountry) continue;
    const maxA = stage.maxArmies(destId);
    if (destArea.armies.length >= maxA) continue;

    // Hospital capacity reservation: low-value infantry should not take the last remaining slot
    if (priorityLevel === 'low' && destArea.armies.length >= maxA - 1 && maxA > 1) {
      continue;
    }

    const cLvl = cityLevel(destArea);
    const iLvl = industryLevel(destArea);
    const isQualified = restType === 'industry'
      ? (iLvl >= P.restIndustryMinLevel)
      : (cLvl >= P.restCityMinLevel || iLvl >= P.restIndustryMinLevel);

    if (isQualified) {
      const baseLevel = restType === 'industry' ? iLvl : Math.max(cLvl, iLvl);
      // Extra bonus if remaining movement > 0 (triggers terrain recovery in turn.js upon turn end)
      const hasMovementLeft = (unit.movement - route.cost > 0) ? 50 : 0;
      const pLose = model.pLose ? (model.pLose(destId) || 0) : 0;
      const safetyBonus = (1 - pLose) * (P.restSafetyWeight || 50);
      const costPenalty = route.cost * 8;
      const score = baseLevel * 60 + hasMovementLeft + safetyBonus - costPenalty;

      if (score > bestDirectScore) {
        bestDirectScore = score;
        bestDirect = {
          id: destId,
          cost: route.cost,
          command: { type: 'move', from: originAreaId, to: destId, armyId: unit.id }
        };
      }
    }
  }

  if (bestDirect) {
    return bestDirect;
  }

  // --- Phase 2: If no direct base reachable this turn, find nearest base and step safely toward it ---
  const maxHops = P.restMaxHops || 6;
  let nearestBaseId = null;
  let minBaseDist = Infinity;

  for (const area of stage.areas) {
    if (area.country !== ownCountry) continue;
    const cLvl = cityLevel(area);
    const iLvl = industryLevel(area);
    const isQualified = restType === 'industry'
      ? (iLvl >= P.restIndustryMinLevel)
      : (cLvl >= P.restCityMinLevel || iLvl >= P.restIndustryMinLevel);

    if (isQualified) {
      const d = model.dist ? model.dist(originAreaId, area.id) : Infinity;
      if (d < minBaseDist) {
        minBaseDist = d;
        nearestBaseId = area.id;
      }
    }
  }

  if (nearestBaseId == null || minBaseDist > maxHops) {
    return null;
  }

  // Low-value units do not wander cross-country for multi-turn retreats if far away
  if (priorityLevel === 'low' && minBaseDist > 3) {
    return null;
  }

  // Evaluate reachable positions stepping closer to nearestBaseId
  let bestStep = null;
  let bestStepScore = -Infinity;

  for (const [destId, route] of reachMap.entries()) {
    const destArea = stage.st(destId);
    if (!destArea || destArea.country !== ownCountry) continue;
    if (destArea.armies.length >= stage.maxArmies(destId)) continue;

    const stepDist = model.dist ? model.dist(destId, nearestBaseId) : Infinity;
    if (stepDist >= minBaseDist) continue; // Must make tangible progress toward the base

    const pLose = model.pLose ? (model.pLose(destId) || 0) : 0;
    if (pLose > 0.40) continue; // Avoid stepping into active dangerous combat zones

    const progress = minBaseDist - stepDist;
    const safetyBonus = (1 - pLose) * 40;
    const costPenalty = route.cost * 5;
    const score = progress * 35 + safetyBonus - costPenalty;

    if (score > bestStepScore) {
      bestStepScore = score;
      bestStep = {
        id: destId,
        cost: route.cost,
        command: { type: 'move', from: originAreaId, to: destId, armyId: unit.id }
      };
    }
  }

  return bestStep;
}
