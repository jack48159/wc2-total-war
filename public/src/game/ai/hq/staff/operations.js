// Operational candidate order generation module.
// Generates advanced operational maneuvers: breakthrough, counterattack, envelop, support, and reserve concentrate.
// All candidate orders flow through allocate.js contract net auction without hardcoded priority overrides.

import { ARMOUR } from '../../../army_groups.js';
import { generateConcentrationOrders } from './aifc.js';
export { generateConcentrationOrders };

// --- Named Constants with Explanations ---

// Minimum force ratio R or main front status required for breakthrough
export const BREAKTHROUGH_MIN_R = 1.1;
// Operational penetration depth for breakthrough orders (in hops)
export const BREAKTHROUGH_DEPTH = 2;
// Risk tolerance for breakthrough spearhead operations
export const BREAKTHROUGH_RISK = 0.6;
// Default priority for breakthrough missions
export const BREAKTHROUGH_PRIORITY = 8;

// Risk tolerance for counterattack on exposed salients
export const COUNTERATTACK_RISK = 0.45;
// Priority for counterattack missions
export const COUNTERATTACK_PRIORITY = 7;

// Risk tolerance for double-envelopment pincer operations
export const ENVELOP_RISK = 0.5;
// Priority for double-envelopment pincer operations
export const ENVELOP_PRIORITY = 8;

// Risk tolerance for auxiliary support missions (fix/suppress/cut/flank)
export const SUPPORT_RISK = 0.35;

// Default operational order duration in turns before expiration
export const DEFAULT_OP_EXPIRES = 3;

// Minimum threat uncertainty threshold required to trigger theater reserve concentration
export const RESERVE_UNCERTAINTY_MIN = 4.0;

let opOrderSequence = 0;
function nextOpOrderId(model, prefix = 'op') {
  opOrderSequence += 1;
  const rnd = model?.game?.round ?? model?.round ?? 1;
  const c = model?.me ?? 'ai';
  return `${prefix}_r${rnd}_${c}_${opOrderSequence}`;
}

function isArmor(u) {
  const type = u.type || u.army?.type || '';
  return ARMOUR.has(type);
}

/**
 * Generates breakthrough orders:
 * Generated on main offensive fronts where friendly armor holds an advantage
 * and the first enemy defensive line is thin (<= 1 defender or low HP).
 */
export function generateBreakthroughOrders(model, front, options = {}) {
  const stage = model.game.stage;
  const ownCountry = model.me;
  const isMainFront = options.mainFrontId != null && front.id === options.mainFrontId;
  const R = front.R ?? 1.0;
  if (!isMainFront && R < BREAKTHROUGH_MIN_R) return [];

  // Verify armor advantage on this front
  const friendlyList = front.friendlyAreas || front.areas || [];
  let friendlyArmorVal = 0;
  for (const faId of friendlyList) {
    const a = stage.st(faId);
    if (!a) continue;
    for (const u of (a.armies || [])) {
      if (isArmor(u)) friendlyArmorVal += (model.unitValue?.(u) ?? u.maxHp);
    }
  }

  let enemyArmorVal = 0;
  for (const eaId of (front.enemyAreas || [])) {
    const a = stage.st(eaId);
    if (!a) continue;
    for (const u of (a.armies || [])) {
      if (isArmor(u)) enemyArmorVal += (model.unitValue?.(u) ?? u.maxHp);
    }
  }

  if (friendlyArmorVal <= 0 || friendlyArmorVal < enemyArmorVal * 0.8) {
    return [];
  }

  const results = [];
  for (const enemyAreaId of (front.enemyAreas || [])) {
    const enemyArea = stage.st(enemyAreaId);
    if (!enemyArea || enemyArea.country === ownCountry) continue;
    const defenders = enemyArea.armies || [];
    const isThinLine = defenders.length <= 1 || defenders.reduce((s, u) => s + (u.hp || 0), 0) < 120;
    if (!isThinLine) continue;

    const fromAreas = friendlyList.filter(faId => {
      const neighbors = stage.adjE.get(faId) || [];
      return neighbors.includes(enemyAreaId);
    });
    if (fromAreas.length === 0) continue;

    // Look for rear depth targets behind the first defensive line
    const depthTargets = (stage.adjE.get(enemyAreaId) || []).filter(nId => {
      const st = stage.st(nId);
      return st && st.country !== ownCountry && !friendlyList.includes(nId);
    });

    const targetAreaId = depthTargets.length > 0 ? depthTargets[0] : enemyAreaId;
    const baseVal = model.areaValue?.(targetAreaId) ?? 20;

    results.push({
      id: nextOpOrderId(model, 'brk'),
      verb: 'breakthrough',
      from: fromAreas,
      to: targetAreaId,
      depth: BREAKTHROUGH_DEPTH,
      risk: BREAKTHROUGH_RISK,
      priority: BREAKTHROUGH_PRIORITY,
      expires: DEFAULT_OP_EXPIRES,
      frontId: front.id,
      scoreVal: baseVal * 1.5,
    });
  }

  return results;
}

/**
 * Generates counterattack orders:
 * Targets enemy salients (penetrations surrounded by friendly lines)
 * or recently advanced, fatigued enemy units (movement = 0).
 */
export function generateCounterattackOrders(model, front, options = {}) {
  const stage = model.game.stage;
  const ownCountry = model.me;
  const friendlySet = new Set(front.friendlyAreas || front.areas || []);
  const results = [];

  for (const enemyAreaId of (front.enemyAreas || [])) {
    const enemyArea = stage.st(enemyAreaId);
    if (!enemyArea || enemyArea.country === ownCountry) continue;

    const neighbors = stage.adjE.get(enemyAreaId) || [];
    const friendlyNeighbors = neighbors.filter(id => friendlySet.has(id));
    if (friendlyNeighbors.length < 2) continue; // Must be a salient protruding into friendly territory

    const defenders = enemyArea.armies || [];
    const isFatigued = defenders.some(u => (u.movement ?? 0) === 0);
    const trigger = friendlyNeighbors.length >= 3 ? 'exposed_salient' : (isFatigued ? 'fatigued_advance' : 'counter_opportunity');

    const baseVal = model.areaValue?.(enemyAreaId) ?? 15;
    const enemyDefVal = defenders.reduce((acc, u) => acc + (model.unitValue?.(u) ?? u.maxHp), 0);

    results.push({
      id: nextOpOrderId(model, 'cnt'),
      verb: 'counterattack',
      from: friendlyNeighbors,
      to: enemyAreaId,
      trigger,
      risk: COUNTERATTACK_RISK,
      priority: COUNTERATTACK_PRIORITY,
      expires: 2,
      frontId: front.id,
      scoreVal: (baseVal * 1.2) - (enemyDefVal * 0.15),
    });
  }

  return results;
}

/**
 * Generates envelopment (pincer) orders:
 * Requires an enemy pocket with at least 2 distinct friendly staging axes
 * capable of advancing to enclose or encircle the target.
 */
export function generateEnvelopOrders(model, front, options = {}) {
  const stage = model.game.stage;
  const ownCountry = model.me;
  const friendlyList = front.friendlyAreas || front.areas || [];
  const results = [];

  for (const enemyAreaId of (front.enemyAreas || [])) {
    const enemyArea = stage.st(enemyAreaId);
    if (!enemyArea || enemyArea.country === ownCountry) continue;
    if (!enemyArea.armies || enemyArea.armies.length === 0) continue;

    const neighbors = stage.adjE.get(enemyAreaId) || [];
    const friendlyNeighbors = neighbors.filter(id => friendlyList.includes(id));
    if (friendlyNeighbors.length < 2) continue; // Need at least two staging axes

    // Pick two distinct axes that are not directly adjacent to ensure a true pincer
    let axisA = friendlyNeighbors[0];
    let axisB = friendlyNeighbors[friendlyNeighbors.length - 1];
    for (let i = 0; i < friendlyNeighbors.length; i++) {
      for (let j = i + 1; j < friendlyNeighbors.length; j++) {
        const adj = stage.adjE.get(friendlyNeighbors[i]) || [];
        if (!adj.includes(friendlyNeighbors[j])) {
          axisA = friendlyNeighbors[i];
          axisB = friendlyNeighbors[j];
          break;
        }
      }
    }

    const opId = `op_env_${enemyAreaId}_r${model.game?.round ?? 1}`;
    const baseVal = model.areaValue?.(enemyAreaId) ?? 20;
    const enemyUnitsVal = enemyArea.armies.reduce((sum, u) => sum + (model.unitValue?.(u) ?? u.maxHp), 0);

    results.push({
      id: nextOpOrderId(model, 'env'),
      opId,
      verb: 'envelop',
      to: enemyAreaId,
      axes: [axisA, axisB],
      sync: true,
      risk: ENVELOP_RISK,
      priority: ENVELOP_PRIORITY,
      expires: DEFAULT_OP_EXPIRES,
      frontId: front.id,
      scoreVal: (baseVal + enemyUnitsVal) * 0.8,
    });
  }

  return results;
}

/**
 * Generates support orders paired with primary offensive operations (attack, breakthrough, envelop).
 * Missions: 'fix' (pin reserves), 'suppress' (soften target), 'cut' (sever reinforcement), 'flank' (cover flank).
 * Marginal value delta estimated via target exposure and adjacent reserve pinning.
 */
export function generateSupportOrders(model, primaryOrders = [], options = {}) {
  const stage = model.game.stage;
  const ownCountry = model.me;
  const supportCandidates = [];

  for (const pOrder of primaryOrders) {
    if (!['attack', 'breakthrough', 'envelop'].includes(pOrder.verb)) continue;
    const targetId = Array.isArray(pOrder.to) ? pOrder.to[0] : pOrder.to;
    if (targetId == null) continue;

    const targetArea = stage.st(targetId);
    if (!targetArea) continue;

    const neighbors = stage.adjE.get(targetId) || [];
    const enemyNeighbors = neighbors.filter(id => {
      const st = stage.st(id);
      return st && st.country !== ownCountry;
    });

    // 1. Mission 'fix' (effect: 'pin_reserves'): pin enemy units in adjacent areas to prevent reinforcement
    for (const resAreaId of enemyNeighbors) {
      const resSt = stage.st(resAreaId);
      if (!resSt || !resSt.armies || resSt.armies.length === 0) continue;

      supportCandidates.push({
        id: nextOpOrderId(model, 'sup'),
        verb: 'support',
        with: pOrder.id,
        mission: 'fix',
        effect: 'pin_reserves',
        to: resAreaId,
        from: pOrder.from,
        risk: SUPPORT_RISK,
        priority: Math.max(1, (pOrder.priority ?? 6) - 1),
        expires: pOrder.expires ?? DEFAULT_OP_EXPIRES,
        frontId: pOrder.frontId,
        scoreVal: (pOrder.scoreVal || 20) * 0.65,
      });
      break; // One pinning candidate per primary order
    }

    // 2. Mission 'suppress' (effect: 'soften_target'): prep target defense prior to assault
    if (targetArea.armies && targetArea.armies.length >= 2) {
      supportCandidates.push({
        id: nextOpOrderId(model, 'sup'),
        verb: 'support',
        with: pOrder.id,
        mission: 'suppress',
        effect: 'soften_target',
        to: targetId,
        from: pOrder.from,
        risk: SUPPORT_RISK,
        priority: Math.max(1, (pOrder.priority ?? 6) - 1),
        expires: pOrder.expires ?? DEFAULT_OP_EXPIRES,
        frontId: pOrder.frontId,
        scoreVal: (pOrder.scoreVal || 20) * 0.6,
      });
    }

    // 3. Mission 'flank' (effect: 'cover_flank'): cover spearhead's flank on breakthrough
    if (pOrder.verb === 'breakthrough' && enemyNeighbors.length > 0) {
      supportCandidates.push({
        id: nextOpOrderId(model, 'sup'),
        verb: 'support',
        with: pOrder.id,
        mission: 'flank',
        effect: 'cover_flank',
        to: enemyNeighbors[0],
        from: pOrder.from,
        risk: SUPPORT_RISK,
        priority: Math.max(1, (pOrder.priority ?? 6) - 1),
        expires: pOrder.expires ?? DEFAULT_OP_EXPIRES,
        frontId: pOrder.frontId,
        scoreVal: (pOrder.scoreVal || 20) * 0.7,
      });
    }
  }

  return supportCandidates;
}

/**
 * Generates theater reserve concentrate orders driven by threat uncertainty (V2 §5.5).
 * Reserve scale and positioning are determined by threat distribution variance rather than fixed ratios.
 */
export function generateReserveConcentrateOrders(model, fronts, options = {}) {
  const stage = model.game.stage;
  const tmMap = typeof model.threatMap === 'function' ? model.threatMap() : null;
  const myAreaIds = model.mine ? model.mine.map(a => a.id) : [];
  if (myAreaIds.length === 0) return [];

  // Calculate threat uncertainty across friendly territories
  const threats = [];
  for (const aId of myAreaIds) {
    const atk = tmMap?.get(aId)?.atk || 0;
    if (atk > 0) threats.push(atk);
  }

  let threatUncertainty = 0;
  if (threats.length > 1) {
    const mean = threats.reduce((a, b) => a + b, 0) / threats.length;
    const variance = threats.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / threats.length;
    threatUncertainty = Math.sqrt(variance);
  } else if (threats.length === 1) {
    threatUncertainty = threats[0] * 0.5;
  }

  // When threat uncertainty is high, identify central staging node in rear with high connectivity
  if (threatUncertainty >= RESERVE_UNCERTAINTY_MIN || options.forceReserve) {
    // Score friendly areas by centrality: distance to all fronts / threatened areas
    let bestHubId = myAreaIds[0];
    let bestHubScore = -Infinity;

    for (const aId of myAreaIds) {
      const area = stage.st(aId);
      if (!area || area.armies?.length >= stage.maxArmies(aId)) continue;

      let connectivity = (stage.adjE.get(aId) || []).length;
      let isIndustrial = (area.areaType === 1 || area.construction === 'city' || area.construction === 'industry') ? 10 : 0;
      // Prefer 1 hop behind front line
      let nearFront = model.isFront?.(aId) ? -5 : 5;
      let score = connectivity + isIndustrial + nearFront;

      if (score > bestHubScore) {
        bestHubScore = score;
        bestHubId = aId;
      }
    }

    return [{
      id: nextOpOrderId(model, 'con'),
      verb: 'concentrate',
      to: bestHubId,
      risk: 0.3,
      priority: Math.min(6, Math.max(3, Math.trunc(threatUncertainty * 0.5))),
      expires: DEFAULT_OP_EXPIRES,
      frontId: null, // Theater reserve
      scoreVal: 15 + threatUncertainty * 2,
    }];
  }

  return [];
}

/**
 * Combines all advanced operational candidate orders for integration into general staff allocation.
 */
export function generateOperationalOrders(model, fronts, options = {}) {
  const opCandidates = [];
  const activeFronts = fronts || [];

  // AIFC: AI Force Concentration orders evaluated first (top value fronts with hold guarantee)
  const aifcOrders = generateConcentrationOrders(model, activeFronts, options);
  if (aifcOrders.length > 0) {
    opCandidates.push(...aifcOrders);
  }

  for (const front of activeFronts) {
    opCandidates.push(...generateBreakthroughOrders(model, front, options));
    opCandidates.push(...generateCounterattackOrders(model, front, options));
    opCandidates.push(...generateEnvelopOrders(model, front, options));
  }

  // Add support orders paired with offensive candidates
  const supportCandidates = generateSupportOrders(model, opCandidates, options);
  opCandidates.push(...supportCandidates);

  // Add theater reserve concentrate orders
  opCandidates.push(...generateReserveConcentrateOrders(model, activeFronts, options));

  return opCandidates;
}
