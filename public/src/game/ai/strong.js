import { Controller } from '../controller_base.js';
import { nativeAlliance } from '../rules/combatModel.js';
import { World } from '../world.js';
import { shopCards } from '../cards.js';
import { handlerFor } from '../commands.js';
import { minDistanceToAirport } from '../rules/cardEffects.js';
import { warCascade } from '../rules/diplomacy.js';
import { declareTuning } from '../rules/national_traits.js';
import { countryGameView } from '../rules/visibility.js';

const RECRUIT_TYPES = new Map([
  [0, 'infantry'], [1, 'panzer'], [2, 'artillery'], [3, 'rocket'],
  [4, 'tank'], [5, 'heavytank'], [6, 'destroyer'], [7, 'cruiser'],
  [8, 'battleship'], [9, 'aircraftcarrier'], [28, 'eliteinfantry']
]);
const NAVY_TYPES = new Set(['destroyer', 'cruiser', 'battleship', 'aircraftcarrier']);

export function evaluateAiDeclareWar(game, country) {
  if (!game?.diplomacy?.enabled) return null;
  const st = game.stage;
  const dip = game.diplomacy;
  const cInfo = st.countries.get(country);
  if (!cInfo || cInfo.eliminated) return null;

  const aiRules = st.data?.ai_rules || dip?.ai_rules || {};
  const tuning = declareTuning(st.data?.traitCatalog, cInfo);
  if (tuning.neverDeclare) return null;
  const warCooldown = Math.max(1, (aiRules.war_cooldown ?? 4) + tuning.cooldownDelta);
  const minStability = (aiRules.min_stability ?? 55) + tuning.minStabilityDelta;
  const maxActiveMajorEnemies = (aiRules.max_active_major_enemies ?? 2) + (tuning.maxMajorBonus || 0);
  const specialRestraints = aiRules.special_restraints || [];
  const minWarRound = aiRules.min_war_round ?? 1;

  // Global earliest war round restraint (e.g. Cold War armed peace before round 12)
  if (game.round < minWarRound) return null;

  // 1. Stability requirement: must be >= minStability
  const stability = game.getStability ? game.getStability(country) : (cInfo.stability ?? 100);
  if (stability < minStability) return null;

  // 2. Cooldown check: at least warCooldown rounds since last declaration or war start
  const lastDeclared = dip?.lastWarDeclaredRound?.[country];
  if (lastDeclared != null && (game.round - lastDeclared) < warCooldown) {
    return null;
  }
  if (dip?.warStartedRound) {
    for (const [key, r] of Object.entries(dip.warStartedRound)) {
      if ((key.startsWith(country + '_') || key.endsWith('_' + country)) && (game.round - r) < warCooldown) {
        return null;
      }
    }
  }

  // Restraint against declaring new wars when a scripted war is imminent
  if (game.scenarioEvents?.definitions) {
    const history = new Set(game.scenarioEvents.history || []);
    for (const ev of game.scenarioEvents.definitions) {
      if (history.has(ev.id)) continue;
      const involvesWar = ev.actions?.some(a =>
        (a.type === 'setDiplomacy' || a.type === 'declareWar') &&
        (a.state === 'war' || a.reason === 'barbarossa') &&
        (a.first === country || a.second === country)
      );
      if (!involvesWar) continue;
      for (const cond of (ev.conditions || [])) {
        if (cond.type === 'round' && (cond.op === 'eq' || cond.op === 'gte')) {
          if (cond.value >= game.round && (cond.value - game.round) < warCooldown) {
            return null;
          }
        }
      }
    }
  }

  // 3. Analyze living war enemies and frontline pressure
  const myLands = st.areas.filter(a => a.country === country && !a.sea);
  if (myLands.length === 0) return null;
  const myArmies = myLands.flatMap(a => a.armies);
  const myPower = myArmies.reduce((sum, u) => sum + (u.hp || 50), 0);
  if (myPower <= 50) return null;

  const myAreaIds = new Set(myLands.map(a => a.id));
  const borderEnemyArmies = [];
  const borderFriendlyArmies = [];
  const majorEnemies = [];

  for (const c of st.countries.values()) {
    if (c.id === country || c.eliminated) continue;
    if (game.getDiplomaticRelation(country, c.id) === 1) { // 1 = WAR
      const eLands = st.areas.filter(a => a.country === c.id && !a.sea);
      if (eLands.length > 0) {
        const ePower = eLands.flatMap(a => a.armies).reduce((s, u) => s + (u.hp || 50), 0);
        // Direct land border contact?
        const hasBorder = eLands.some(ea => (st.adjE.get(ea.id) || []).some(nid => myAreaIds.has(nid)));
        if (hasBorder) {
          majorEnemies.push({ id: c.id, lands: eLands.length, power: ePower, border: true });
          for (const ea of eLands) {
            for (const nid of (st.adjE.get(ea.id) || [])) {
              if (myAreaIds.has(nid)) {
                borderEnemyArmies.push(...ea.armies);
                const fa = st.st(nid);
                if (fa) borderFriendlyArmies.push(...fa.armies);
              }
            }
          }
        } else if (eLands.length >= 8 || ePower >= 250) {
          // Major power even without direct border
          majorEnemies.push({ id: c.id, lands: eLands.length, power: ePower, border: false });
        }
      }
    }
  }

  // 4. Opponent count limit: do not open new front if already fighting too many major opponents
  if (majorEnemies.length >= maxActiveMajorEnemies) {
    return null;
  }

  // 5. Frontline pressure check ("正在与强国交战且战线吃紧时不开新战线")
  if (borderEnemyArmies.length > 0) {
    const contactEnemyPower = borderEnemyArmies.reduce((s, u) => s + (u.hp || 50), 0);
    const contactFriendlyPower = borderFriendlyArmies.reduce((s, u) => s + (u.hp || 50), 0);
    if (contactEnemyPower * 1.1 > contactFriendlyPower) {
      return null;
    }
  }

  // Helper to compute friendly power in the theater/direction of target
  const getDirectionFriendlyPower = targetIds => {
    const nearby = new Set();
    const queue = [];
    const dist = new Map();
    for (const tid of targetIds) {
      queue.push(tid);
      dist.set(tid, 0);
    }
    while (queue.length > 0) {
      const cur = queue.shift();
      const d = dist.get(cur);
      if (d < 4) {
        for (const n of (st.adjE.get(cur) || [])) {
          if (!dist.has(n)) {
            dist.set(n, d + 1);
            queue.push(n);
            nearby.add(n);
          }
        }
      }
    }
    const dirArmies = st.areas.filter(a => a.country === country && nearby.has(a.id)).flatMap(a => a.armies);
    return dirArmies.reduce((sum, u) => sum + (u.hp || 50), 0);
  };

  // 6. Evaluate Candidate Targets
  const candidateTargetIds = country === 'de'
    ? ['be', 'nl', 'dk', 'no', 'yu', 'gr', 'ru']
    : Array.from(st.countries.keys()).filter(id => id !== country && !game.areDiplomaticAllies(country, id));

  const permanentNeutrals = new Set(aiRules.permanent_neutrals || dip?.permanent_neutrals || []);

  for (const tid of candidateTargetIds) {
    const tInfo = st.countries.get(tid);
    if (!tInfo || tInfo.eliminated) continue;
    const rel = game.getDiplomaticRelation(country, tid);
    if (rel !== 2) continue; // 2 = PEACE

    const tLands = st.areas.filter(a => a.country === tid && !a.sea);
    if (tLands.length === 0) continue;

    // Permanent neutral protection: never declare war on permanent neutrals unless already involved in war
    if (permanentNeutrals.has(tid)) {
      const isAlreadyAtWar = Array.from(st.countries.values()).some(
        other => !other.eliminated && other.id !== tid && game.getDiplomaticRelation(tid, other.id) === 1
      );
      if (!isAlreadyAtWar) continue;
    }

    // Calculate total power of target AND its entire cascaded alliance
    const cascade = warCascade(game, country, tid);
    const allTargetCountries = [tid, ...cascade];
    let totalTargetPower = 0;
    const targetAreaIds = [];
    for (const cid of allTargetCountries) {
      const cLands = st.areas.filter(a => a.country === cid && !a.sea);
      targetAreaIds.push(...cLands.map(a => a.id));
      const cArmies = cLands.flatMap(a => a.armies);
      totalTargetPower += cArmies.reduce((sum, u) => sum + (u.hp || 50), 0);
    }
    totalTargetPower = Math.max(1, totalTargetPower);

    // Check special restraints from scenario data (e.g. Germany vs USSR, or never_declare)
    const restraint = specialRestraints.find(r =>
      (r.attacker === '*' || r.attacker === country) &&
      (r.target === '*' || r.target === tid)
    );
    if (restraint) {
      if (restraint.never_declare) {
        continue;
      }
      if (game.round < (restraint.min_round || 0)) {
        const reqRatio = restraint.overwhelming_power_ratio || 4.0;
        if (myPower < totalTargetPower * reqRatio) {
          continue; // not overwhelming enough before min_round
        }
      }
    }

    const allyEngaged = tuning.warWeary && Array.from(st.countries.values()).some(c =>
      c.id !== country && c.id !== tid && !c.eliminated &&
      game.getDiplomaticRelation(country, c.id) === 3 &&
      game.getDiplomaticRelation(c.id, tid) === 1
    );
    const powerRatio = allyEngaged ? tuning.relaxedPowerRatio : tuning.powerRatio;
    const dirRatio = allyEngaged ? tuning.relaxedDirectionRatio : tuning.directionRatio;

    // Direction/theater power comparison:
    // Friendly forces assembled in this direction must be clearly superior
    const dirPower = getDirectionFriendlyPower(targetAreaIds);
    if (dirPower < totalTargetPower * dirRatio) {
      continue;
    }

    // Overall power comparison:
    if (myPower < totalTargetPower * powerRatio) {
      continue;
    }

    return {
      type: 'setDiplomacy',
      first: country,
      second: tid,
      state: 'war',
      reason: tuning.expansionist ? 'ai_expansion' : 'ai_generic_war'
    };
  }

  return null;
}

export function evaluatePotentialThreats(game, country, myAllAreas, totalArmiesCount, isHomeThreatened = false, historyMap = null) {
  const st = game.stage;
  const catalog = st.data?.traitCatalog;
  const myTraits = catalog?.countries?.[country]?.traits || [];
  const isCautiousOrWeary = myTraits.includes('war_weary') || myTraits.includes('permanent_neutral');

  // Budget constraint: Potential threat defense budget <= 30% of total armies.
  // If home is actively threatened under current war, lower to 12%.
  const maxThreatBudget = Math.max(1, Math.floor(totalArmiesCount * (isHomeThreatened ? 0.12 : (isCautiousOrWeary ? 0.35 : 0.28))));

  const neighbors = new Set();
  const borderToNeighbor = new Map(); // neighborId -> Set<mineAreaId>

  for (const a of myAllAreas) {
    if (a.sea) continue;
    for (const nid of (st.adjE.get(a.id) || [])) {
      const na = st.st(nid);
      if (!na || na.sea || !na.country || na.country === country) continue;
      const otherC = st.countries.get(na.country);
      if (!otherC || otherC.eliminated) continue;

      const rel = game.diplomacy?.enabled
        ? game.getDiplomaticRelation(country, na.country)
        : (st.areAllied(country, na.country) ? 3 : 1);

      // Do NOT prepare against peaceful allies: "对和平的同盟不做任何防范"
      if (rel === 3) continue;
      // Active war enemies are handled by primary frontline combat logic
      if (rel === 1) continue;

      neighbors.add(na.country);
      if (!borderToNeighbor.has(na.country)) borderToNeighbor.set(na.country, new Set());
      borderToNeighbor.get(na.country).add(a.id);
    }
  }

  const threatScores = new Map(); // neighborId -> score
  const threatChokePoints = new Set();
  const borderHoldAreas = new Map(); // areaId -> minHoldGarrison
  const threatBorderPriority = new Map(); // areaId -> priorityWeight

  let totalAllocatedBudget = 0;

  let myTotalPower = 0;
  for (const a of myAllAreas) {
    for (const u of (a.armies || [])) myTotalPower += (u.hp || 50);
  }

  for (const nid of neighbors) {
    let score = 25; // Base neutral peace

    // 1. Diplomatic factor
    const hasPactNap = game.diplomacy?.pacts?.[`${country}_${nid}`]?.type === 'nap' ||
                       game.diplomacy?.pacts?.[`${nid}_${country}`]?.type === 'nap';
    if (hasPactNap) score = 10;

    const myAlliance = nativeAlliance(st.alliance(country));
    const theirAlliance = nativeAlliance(st.alliance(nid));
    if (myAlliance != null && theirAlliance != null && myAlliance !== theirAlliance && myAlliance !== 0 && theirAlliance !== 0 && myAlliance !== 4 && theirAlliance !== 4) {
      score += 25;
    }

    const hasWar = Array.from(st.countries.values()).some(other =>
      !other.eliminated && other.id !== nid && other.id !== country &&
      (game.diplomacy?.enabled ? game.getDiplomaticRelation(nid, other.id) === 1 : !st.areAllied(nid, other.id))
    );
    if (hasWar) score += 15;

    // 2. Personality factor (national_traits)
    const nTraits = catalog?.countries?.[nid]?.traits || [];
    const nRegime = catalog?.countries?.[nid]?.regime;
    if (nTraits.includes('expansionist')) score += 30;
    if (nRegime === 'totalitarian') score += 20;
    else if (nRegime === 'authoritarian') score += 10;
    if (nTraits.includes('permanent_neutral')) score = 0;
    if (nTraits.includes('war_weary')) score = Math.max(0, score - 15);

    // 3. Scenario events / ai_rules scripted war countdown
    const seDefs = game.scenarioEvents?.definitions || st.data?.scenarioEvents || [];
    const curRound = game.round || 1;
    for (const def of seDefs) {
      const actions = def.actions || [];
      const warAction = actions.find(act =>
        act.type === 'setDiplomacy' &&
        act.state === 'war' &&
        ((act.first === country && act.second === nid) || (act.first === nid && act.second === country))
      );
      if (warAction) {
        const conds = def.conditions || [];
        const rCond = conds.find(c => c.type === 'round');
        if (rCond && rCond.value != null) {
          const delta = rCond.value - curRound;
          if (delta >= 0 && delta <= 3) {
            score += (4 - delta) * 35;
          }
        }
      }
    }

    const aiRules = st.data?.ai_rules || game.diplomacy?.ai_rules;
    if (aiRules?.special_restraints) {
      for (const res of aiRules.special_restraints) {
        if ((res.attacker === nid && res.target === country) || (res.attacker === country && res.target === nid)) {
          if (res.min_round != null) {
            const delta = res.min_round - curRound;
            if (delta >= 0 && delta <= 3) {
              score += (4 - delta) * 25;
            }
          }
        }
      }
    }

    // 4. Force comparison on shared border & total power
    const borderMine = borderToNeighbor.get(nid) || new Set();
    let borderEnemyPower = 0;
    let totalEnemyPower = 0;
    for (const area of st.areas) {
      if (area.country !== nid || area.sea) continue;
      const p = (area.armies || []).reduce((sum, u) => sum + (u.hp || 50), 0);
      totalEnemyPower += p;
      const isBorder = (st.adjE.get(area.id) || []).some(adjId => borderMine.has(adjId));
      if (isBorder) borderEnemyPower += p;
    }

    if (totalEnemyPower > 0) {
      const powerRatio = totalEnemyPower / Math.max(1, myTotalPower);
      if (powerRatio > 1.1) score += Math.min(30, Math.round((powerRatio - 1) * 20));
      if (borderEnemyPower > 0) score += Math.min(35, Math.round(borderEnemyPower / 25));
    }

    // 5. Recent troop buildup on border
    if (historyMap) {
      const histKey = `${country}_vs_${nid}`;
      const prevBorderPower = historyMap.get(histKey);
      if (prevBorderPower != null && borderEnemyPower > prevBorderPower + 25) {
        score += 25;
      }
      historyMap.set(histKey, borderEnemyPower);
    }

    threatScores.set(nid, score);

    if (score >= 40) {
      for (const bId of borderMine) {
        threatChokePoints.add(bId);
        const bArea = st.st(bId);
        const isCap = bArea?.areaType === 4;
        const isUrban = bArea?.areaType === 1 || bArea?.construction === 'city' || bArea?.construction === 'industry';
        const weight = score + (isCap ? 80 : isUrban ? 40 : 20);
        threatBorderPriority.set(bId, Math.max(threatBorderPriority.get(bId) || 0, weight));

        if (totalAllocatedBudget < maxThreatBudget) {
          const desired = isCap ? 2 : (borderEnemyPower > 120 ? 2 : 1);
          const allow = Math.min(desired, maxThreatBudget - totalAllocatedBudget);
          if (allow > 0) {
            borderHoldAreas.set(bId, Math.max(borderHoldAreas.get(bId) || 0, allow));
            totalAllocatedBudget += allow;
          }
        }
      }
    }
  }

  const reserveAreas = new Set();
  if (threatChokePoints.size > 0 && totalAllocatedBudget < maxThreatBudget) {
    for (const a of myAllAreas) {
      if (a.sea || threatChokePoints.has(a.id)) continue;
      let reachableThreats = 0;
      for (const nid of (st.adjE.get(a.id) || [])) {
        if (threatChokePoints.has(nid)) reachableThreats++;
        else {
          for (const nnid of (st.adjE.get(nid) || [])) {
            if (threatChokePoints.has(nnid)) reachableThreats++;
          }
        }
      }
      if (reachableThreats >= 2 || (reachableThreats >= 1 && (a.areaType === 4 || a.areaType === 1))) {
        reserveAreas.add(a.id);
      }
    }
  }

  return {
    threatScores,
    threatChokePoints,
    borderHoldAreas,
    threatBorderPriority,
    reserveAreas,
    maxThreatBudget,
  };
}

let _doctrineData = null;
if (typeof fetch === 'function') {
  fetch('data/ai_doctrines.json').then(r => r.ok ? r.json() : null).then(d => { if (d) _doctrineData = d; }).catch(() => {});
}

export function resolveDoctrineSync(game, country) {
  const data = _doctrineData || globalThis.__aiDoctrines;
  const defParams = data?.default?.parameters || {
    initiative: 0.35, mainEffort: 0.45, encirclement: 0.4, exploitation: 0.3, elasticDefence: 0.45,
    retreat: 0.45, peaceBias: 0.5, quality: 0.45, industry: 0.5, city: 0.5, fortification: 0.6,
    concentration: 0.45, armorMass: 0.35, firePreparation: 0.5, attritionTolerance: 0.4,
    amphibious: 0.2, navalPriority: 0.25, terrainUse: 0.6, allyCoordination: 0.5, reserve: 0.3,
    airBudgetShare: 0.08, airRoles: { groundSupport: 0.6, strategicBombing: 0.15, airSuperiority: 0.25 },
    targetUnitMix: { infantry: 0.5, armor: 0.12, artillery: 0.18, rocket: 0.03, elite: 0.12, navy: 0.05 }
  };
  if (!data) return defParams;

  const st = game?.stage;
  const countryInfo = st?.countries?.get?.(country);
  const flag = countryInfo?.flag || country;

  let year = 1939;
  const stageName = st?.name || st?.data?.name;
  if (data.scenarios?.[stageName]?.year) {
    year = data.scenarios[stageName].year;
  } else if (stageName?.startsWith('conquest_')) {
    const years = { conquest_1: 1939, conquest_2: 1942, conquest_3: 1943, conquest_4: 1942, conquest_5: 1945, conquest_6: 1950, conquest_7: 1955, conquest_8: 1973 };
    year = years[stageName] || 1939;
  } else if (stageName?.startsWith('battle_axis')) {
    year = 1939;
  }

  const periods = data.countries?.[flag]?.periods;
  if (periods) {
    for (const p of periods) {
      if (year >= p.fromYear && year < p.toYearExclusive) {
        return p.parameters || defParams;
      }
    }
  }
  return defParams;
}

export class StrongAi extends Controller {
  constructor(options = {}) {
    super();
    this.maxActions = options.maxActions || 40;
    this._turnCache = null;
    this.cardUsageStats = { 14: 0, 15: 0, 17: 0, 18: 0 };
    this.targetSiegeAttempts = new Map(); // targetId -> { attempts, lastRound }
    this.unitMoveHistory = new Map(); // unitId -> lastFromId (persists across turns to prevent A-B-A oscillation)
    this.neighborBorderPowerHistory = new Map(); // country_vs_neighbor -> power
  }

  async takeTurn(game, country) {
    return this.commandsForTurn(game, country);
  }

  commandsForTurn(game, country, blocked = new Set()) {
    if (game.fogOfWar) game = countryGameView(game, country);
    const st = game.stage;
    const doctrine = resolveDoctrineSync(game, country);
    if (!this._turnCache || this._turnCache.round !== game.round || this._turnCache.country !== country) {
      this._turnCache = { round: game.round, country, stepCache: new Map(), econCardCount: 0 };
    }
    const isPhonyWarActive = () => {
      const se = game.scenarioEvents;
      if (!se) return false;
      if (se.variables?.phony_war_active === false) return false;
      const def = se.definitions?.find(d => d.id === 'phony_war_end');
      if (def && se.history?.includes('phony_war_end')) return false;
      return true;
    };

    const myAlliance = nativeAlliance(st.alliance(country));
    const enemy = a => {
      if (!a || a.country == null || a.country === country) return false;
      if ((country === 'gb' || country === 'fr') && a.country === 'de' && isPhonyWarActive()) {
        return false;
      }
      if (game?.diplomacy?.enabled) {
        return game.getDiplomaticRelation(country, a.country) === 1; // 1 = WAR
      }
      return nativeAlliance(st.alliance(a.country)) !== myAlliance && nativeAlliance(st.alliance(a.country)) !== 4;
    };
    const isHostileOrFree = a => a && !a.sea && (enemy(a) || a.country == null);
    const hasAnyEnemy = game.diplomacy?.enabled
      ? Array.from(st.countries.keys()).some(c => c !== country && !st.countries.get(c)?.eliminated && game.getDiplomaticRelation(country, c) === 1)
      : true;

    // AI autonomous war declaration
    if (game.diplomacy?.enabled && !blocked.has('ai_declare_war')) {
      const warCmd = evaluateAiDeclareWar(game, country);
      if (warCmd) {
        blocked.add('ai_declare_war');
        return [warCmd];
      }
    }

    if (this.targetSiegeAttempts) {
      for (const [tid, rec] of this.targetSiegeAttempts) {
        const a = st.st(tid);
        if (!a || a.country === country || a.armies.length === 0 || !enemy(a)) {
          this.targetSiegeAttempts.delete(tid);
          continue;
        }
        // Round decay: reset if >= 2 rounds elapsed, decay if 1 round elapsed
        const elapsed = game.round - (rec.lastRound ?? game.round);
        if (elapsed >= 2) {
          this.targetSiegeAttempts.delete(tid);
        } else if (elapsed === 1) {
          rec.attempts = Math.max(0, rec.attempts - 1);
        }
      }
    }
    const value = a => {
      if (!a) return 0;
      let score = (a.areaType === 4 ? 900 : a.construction === 'city' ? 450 + (a.level || 0) * 50 : a.construction === 'industry' ? 380 + (a.level || 0) * 40 : a.areaType === 1 ? 350 : a.areaType === 3 ? 240 : 50);
      return score;
    };
    const areaAt = id => st.st(id) || { id, country: null, armies: [], construction: 'none', level: 0, areaType: World.areas[id]?.areaType ?? 0, sea: World.areas[id]?.f === 1 };

    const areas = st.areas.filter(a => a.country === country && a.armies?.length);
    const myAllAreas = st.areas.filter(a => a.country === country);
    const countryInfo = st.countries.get(country);
    const wallet = country === game.player ? game : countryInfo;

    const cityLevel = a => Math.max(a.areaType === 1 ? 3 : a.areaType === 3 ? 2 : a.areaType === 4 ? 1 : 0,
      a.construction === 'city' ? (a.level || 0) : 0);
    const industryLevel = a => Math.max(a.areaType === 1 ? 2 : a.areaType === 3 ? 1 : 0,
      a.construction === 'industry' ? (a.level || 0) : 0);
    const techLevel = country === game.player ? game.tech : (countryInfo?.techlevel || 1);
    const hasHeavyBase = myAllAreas.some(a => industryLevel(a) >= 2);
    const hasAnyIndustryBase = myAllAreas.some(a => industryLevel(a) >= 1);
    const hasTankInCatalog = techLevel >= 3;
    const hasArtilleryInCatalog = techLevel >= 2;
    const minReserveIndustry = (hasHeavyBase && hasTankInCatalog) ? 80 : (hasAnyIndustryBase && hasArtilleryInCatalog) ? 40 : 0;

    const canAfford = cardId => {
      const card = game.findCard(cardId, country);
      if (!card) return false;
      const mCost = game.price(card, country);
      const iCost = game.industryCost(card, country);
      if ((wallet?.money || 0) < mCost || (wallet?.industry || 0) < iCost) return false;
      return !game.whyNot(card, country);
    };

    // =============================================================
    // STEP 0: ABSOLUTE TOP PRIORITY — OCCUPATION OF ADJACENT UNGUARDED ENEMY CAPITALS
    // (Takes strict precedence over all cards, construction, and combat)
    // =============================================================
    for (const from of areas) {
      for (let unitIdx = 0; unitIdx < from.armies.length; unitIdx++) {
        const unit = from.armies[unitIdx];
        if (!unit || !st.canAct(unit) || blocked.has(unit.id)) continue;
        for (const id of (st.adjE.get(from.id) || [])) {
          const to = areaAt(id);
          if (to && !to.sea && enemy(to) && to.areaType === 4 && to.armies.length === 0) {
            if (st.moveable(from.id, to.id, unitIdx)) {
              return [{ type: 'move', from: from.id, to: to.id, armyId: unit.id }];
            }
          }
        }
      }
    }

    // =============================================================
    // STEP 0.5: CAPITAL PRESERVATION & DEFENSE RETREAT
    // If our own capital is empty or under imminent enemy attack, prioritize moving nearby friendly unit into it
    // =============================================================
    const myCapital = myAllAreas.find(a => a.areaType === 4);
    if (myCapital && myCapital.armies.length < 2) {
      for (const from of areas) {
        if (from.id === myCapital.id) continue;
        const isFromContact = (st.adjE.get(from.id) || []).some(nid => enemy(st.st(nid)));
        if (isFromContact && from.armies.length <= 1) continue;
        for (let unitIdx = 0; unitIdx < from.armies.length; unitIdx++) {
          const unit = from.armies[unitIdx];
          if (!unit || !st.canAct(unit) || blocked.has(unit.id)) continue;
          if (st.moveable(from.id, myCapital.id, unitIdx)) {
            return [{ type: 'move', from: from.id, to: myCapital.id, armyId: unit.id }];
          }
        }
      }
    }

    // -------------------------------------------------------------
    // STEP 1: PARATROOPER OVERSEAS & EMPTY-LAND EXPEDITIONS (Card 12)
    // -------------------------------------------------------------
    if (!this._turnCache.airborneUsed && canAfford(12)) {
      let bestDrop = null, bestDropScore = -Infinity;
      for (const targetId of st.enabled) {
        const target = st.st(targetId);
        if (!target || target.sea || !enemy(target) || target.armies.length > 0) continue;

        // Airborne rules: STRICTLY FORBIDDEN to drop behind enemy lines on major mainland territory!
        // A target is only eligible for airborne expedition if it is an isolated island landmass (<= 3 hexes).
        const islandQueue = [targetId];
        const islandSeen = new Set([targetId]);
        let landmassSize = 1;
        while (islandQueue.length) {
          const currLandId = islandQueue.shift();
          for (const neighborId of (st.adjE.get(currLandId) || [])) {
            if (islandSeen.has(neighborId)) continue;
            const neighborArea = st.st(neighborId);
            if (neighborArea && !neighborArea.sea) {
              islandSeen.add(neighborId);
              islandQueue.push(neighborId);
              landmassSize++;
              if (landmassSize > 3) break;
            }
          }
          if (landmassSize > 3) break;
        }
        if (landmassSize > 3) continue; // Major continent / peninsula: regular ground warfare applies; NO paratrooper backstabbing!

        const dist = minDistanceToAirport(st, country, targetId);
        if (dist <= 0 || dist >= game.airstrikeRadius()) continue;

        let score = value(target) + 1500;
        if (score > bestDropScore) {
          bestDropScore = score;
          bestDrop = targetId;
        }
      }

      if (bestDrop != null && bestDropScore >= 800) {
        const cmd = { type: 'useCard', country, card: 12, target: bestDrop, pendingPurchase: true };
        if (!handlerFor('useCard')?.validate(game, cmd)) {
          this._turnCache.airborneUsed = true;
          return [cmd];
        }
      }
    }

    // -------------------------------------------------------------
    // STEP 2: AMPHIBIOUS TRANSPORT EMBARKATION (Card 22 Carrier)
    // When facing overseas targets, grant coastal land units transport capability
    // -------------------------------------------------------------
    if (!this._turnCache.homeLandmass) {
      const hl = new Set();
      if (myCapital) {
        const q = [myCapital.id];
        hl.add(myCapital.id);
        while (q.length) {
          const cId = q.shift();
          for (const nId of (st.adjE.get(cId) || [])) {
            if (hl.has(nId)) continue;
            const nArea = areaAt(nId);
            if (nArea && !nArea.sea && nArea.country === country) {
              hl.add(nId);
              q.push(nId);
            }
          }
        }
      }
      this._turnCache.homeLandmass = hl;
    }
    const homeLandmass = this._turnCache.homeLandmass;
    const homeLandCount = homeLandmass.size;
    const homeTroopCount = areas.filter(a => homeLandmass.has(a.id)).reduce((sum, a) => sum + a.armies.length, 0);
    const hasOverlandThreat = Array.from(homeLandmass).some(hId => (st.adjE.get(hId) || []).some(nId => {
      const nArea = st.st(nId);
      return nArea && !nArea.sea && enemy(nArea);
    }));
    const isCapitalThreatened = myCapital && (st.adjE.get(myCapital.id) || []).some(id => {
      const nArea = st.st(id);
      return nArea && !nArea.sea && enemy(nArea);
    });
    const isHomeThreatened = hasOverlandThreat || isCapitalThreatened;

    if (!this._turnCache.threatAssessment) {
      const totalArmiesCount = areas.reduce((sum, a) => sum + (a.armies?.length || 0), 0);
      this._turnCache.threatAssessment = evaluatePotentialThreats(
        game, country, myAllAreas, totalArmiesCount, isHomeThreatened, this.neighborBorderPowerHistory
      );
    }
    const threatAssessment = this._turnCache.threatAssessment;

    const activeTransportCount = areas.reduce((sum, a) => sum + a.armies.filter(u => (u.cards & 4) && !NAVY_TYPES.has(u.type)).length, 0);
    const maxTransports = wallet.money >= 350 ? 5 : wallet.money >= 200 ? 3 : 2;
    if (activeTransportCount < maxTransports && canAfford(22) && wallet.money >= 40 && !isHomeThreatened) {
      for (const from of areas) {
        if (from.sea) continue;
        if (homeLandmass.has(from.id)) {
          if (from.areaType === 4 && from.armies.length <= 2) continue; // Keep at least 2 in capital
          if (from.armies.length <= 1 && hasOverlandThreat) continue; // Never empty home territory when threatened
        } else if (from.areaType === 4 && from.armies.length <= 1) continue;
        let eligibleUnit = null;
        for (const u of from.armies) {
          if (u && !NAVY_TYPES.has(u.type) && !(u.cards & 4) && st.canAct(u)) {
            eligibleUnit = u;
            break;
          }
        }
        if (!eligibleUnit) continue;

        const adjList = st.adjE.get(from.id) || [];
        const hasAdjacentSea = adjList.some(id => st.st(id)?.sea);
        if (!hasAdjacentSea) continue;

        // Check if there are overland reachable hostile/unclaimed targets for this unit
        let hasOverlandTarget = false;
        const landQueue = [from.id];
        const landSeen = new Set([from.id]);
        while (landQueue.length) {
          const currId = landQueue.shift();
          const currArea = areaAt(currId);
          if (currId !== from.id && isHostileOrFree(currArea)) {
            hasOverlandTarget = true;
            break;
          }
          for (const nextId of (st.adjE.get(currId) || [])) {
            if (landSeen.has(nextId)) continue;
            const nextArea = areaAt(nextId);
            if (!nextArea || nextArea.sea) continue;
            if (nextArea.country && nextArea.country !== country) {
              if (game?.diplomacy?.enabled) {
                if (!game.canOccupyTerritory(country, nextArea.country, true)) continue;
              } else if (st.areAllied(country, nextArea.country)) {
                continue;
              }
            }
            landSeen.add(nextId);
            landQueue.push(nextId);
          }
        }
        if (hasOverlandTarget) continue; // Continent/land theater has active targets; NEVER buy transport ship!

        // Home Island / Homeland Garrison Protection:
        // Do not allow units from capital or chokepoint to embark
        if (from.areaType === 4) continue;
        if (from.id === 26 && from.armies.length <= 2) continue;

        // If unit belongs to an island nation (home landmass <= 25 hexes without land borders),
        // ensure home island maintains sufficient defensive army presence!
        const isIslandNation = homeLandmass.size > 0 && homeLandmass.size <= 25;
        if (isIslandNation && homeLandmass.has(from.id)) {
          let homeArmiesCount = 0;
          for (const aid of homeLandmass) {
            const a = areaAt(aid);
            if (a && a.country === country) {
              homeArmiesCount += a.armies.length;
            }
          }
          const minHomeDefenders = Math.max(8, Math.floor(homeLandmass.size * 0.5));
          if (homeArmiesCount <= minHomeDefenders) {
            continue; // Keep troops defending home island!
          }
        }

        // Only healthy, non-critical units may embark on overseas expeditions
        if (eligibleUnit.hp < 70) continue;

        // If there are enemies in the world, eligible coastal units with surplus can embark to project power!
        let shouldEmbark = hasAnyEnemy;
        if (!shouldEmbark) {
          // Check if there is an overseas target across adjacent sea (within 1-16 hexes)
          const seaQueue = [[from.id, 0]];
          const seaSeen = new Set([from.id]);
          while (seaQueue.length) {
            const [currId, dist] = seaQueue.shift();
            if (dist >= 16) continue;
            for (const nextId of (st.adjE.get(currId) || [])) {
              if (seaSeen.has(nextId)) continue;
              seaSeen.add(nextId);
              const nextArea = areaAt(nextId);
              if (nextArea.sea) {
                seaQueue.push([nextId, dist + 1]);
              } else if (isHostileOrFree(nextArea)) {
                shouldEmbark = true;
                break;
              }
            }
            if (shouldEmbark) break;
          }
        }

        if (shouldEmbark && !blocked.has(`card22:${from.id}`)) {
          const cmd = { type: 'useCard', country, card: 22, target: from.id, pendingPurchase: true };
          if (!handlerFor('useCard')?.validate(game, cmd)) {
            return [cmd];
          }
        }
      }
    }

    // -------------------------------------------------------------
    // STEP 2.5: FORWARD AIRFIELD EXPANSION (Card 16)
    // -------------------------------------------------------------
    if (!this._turnCache.builtAirport && canAfford(16) && wallet.money >= 140) {
      const card16 = game.findCard(16, country);
      const indCost16 = card16 ? game.industryCost(card16, country) : 40;
      // Do not spend industry on secondary airfields if industry is needed for mechanized armies
      if (wallet.industry - indCost16 >= Math.max(60, minReserveIndustry)) {
        for (const a of myAllAreas) {
          if (a.sea || a.construction !== 'none' || a.areaType === 4 || a.areaType === 1) continue;
          const distToExisting = minDistanceToAirport(st, country, a.id);
          if (distToExisting < 0 || distToExisting > 250) {
            const hasFrontier = (st.adjE.get(a.id) || []).some(id => enemy(st.st(id)));
            if (hasFrontier) {
              const cmd = { type: 'useCard', country, card: 16, target: a.id, pendingPurchase: true };
              if (!handlerFor('useCard')?.validate(game, cmd)) {
                this._turnCache.builtAirport = true;
                return [cmd];
              }
            }
          }
        }
      }
    }

    // -------------------------------------------------------------
    // STEP 3: TACTICAL CARDS (Tech 21, General 25, Heal 26, Air Strike)
    // -------------------------------------------------------------
    if (canAfford(21) && techLevel < 4 && wallet.money >= 240) {
      if (!handlerFor('buyCard')?.validate(game, { type: 'buyCard', country, card: 21 })) {
        return [{ type: 'buyCard', country, card: 21 }];
      }
    }

    if (canAfford(25) && countryInfo && !countryInfo.commanderAlive && (countryInfo.commanderTurn || 0) <= 0) {
      let bestUnitArea = null, bestScore = 0;
      for (const area of areas) {
        const unit = area.armies[0];
        if (!unit || (unit.cards & 8)) continue;
        const rankScore = ['heavytank', 'tank', 'battleship'].includes(unit.type) ? 500 :
                          ['artillery', 'rocket', 'cruiser', 'panzer'].includes(unit.type) ? 300 : 100;
        const score = rankScore + (unit.hp || 0) + (unit.level || 0) * 30;
        if (score > bestScore) {
          bestScore = score;
          bestUnitArea = area;
        }
      }
      if (bestUnitArea && bestScore > 200) {
        const cmd = { type: 'useCard', country, card: 25, target: bestUnitArea.id, pendingPurchase: true };
        if (!handlerFor('useCard')?.validate(game, cmd)) {
          return [cmd];
        }
      }
    }

    if (!this._turnCache.healUsed && canAfford(26) && wallet.industry >= 120) {
      for (const area of areas) {
        const unit = area.armies[0];
        if (!unit) continue;
        const hasGeneral = area.armies.some(a => a.cards & 8);
        const isSuperArmor = ['heavytank', 'tank'].includes(unit.type) && unit.hp < (unit.maxHp || 100) * 0.4;
        if ((hasGeneral && unit.hp < (unit.maxHp || 100) * 0.5) || isSuperArmor) {
          const cmd = { type: 'useCard', country, card: 26, target: area.id, pendingPurchase: true };
          if (!handlerFor('useCard')?.validate(game, cmd)) {
            this._turnCache.healUsed = true;
            return [cmd];
          }
        }
      }
    }

    const airCards = [13, 11, 10].filter(id => canAfford(id));
    if (airCards.length > 0) {
      let bestAirTarget = null;
      let bestAirScore = -Infinity;
      let bestAirCard = null;

      for (const targetId of st.enabled) {
        const target = st.st(targetId);
        if (!target || !enemy(target) || target.armies.length === 0) continue;
        const dist = minDistanceToAirport(st, country, targetId);
        if (dist <= 0 || dist >= game.airstrikeRadius()) continue;

        const armies = target.armies;
        const hasGeneral = armies.some(a => a.cards & 8);
        const totalHp = armies.reduce((sum, u) => sum + (u.hp || 0), 0);
        const hasArmor = armies.some(a => ['heavytank', 'tank', 'battleship'].includes(a.type));
        const isCapital = target.areaType === 4;
        const hasContact = (st.adjE.get(targetId) || []).some(nid => st.st(nid)?.country === country);

        // High value threshold: capital, general, multiple units, armored unit, high HP, or combat contact
        if (!hasGeneral && !isCapital && armies.length < 2 && !hasArmor && totalHp < 75 && !hasContact) {
          continue;
        }

        let targetScore = 0;
        if (isCapital) targetScore += 500;
        if (hasGeneral) targetScore += 600;
        if (hasArmor) targetScore += 400;
        targetScore += armies.length * 150 + Math.min(300, totalHp);
        if (hasContact) targetScore += 300; // soft up targets before ground assault

        // Select suitable air card:
        // Multi-stack targets -> Bombing (Card 11, area) or Strategic Bombing (Card 13)
        // High HP single target -> Card 13 or Card 10
        let cardId = airCards[0];
        if (armies.length >= 2 && airCards.includes(11)) {
          cardId = 11;
        } else if (airCards.includes(13)) {
          cardId = 13;
        } else {
          cardId = airCards.find(c => c === 10) || airCards[0];
        }

        if (targetScore > bestAirScore) {
          bestAirScore = targetScore;
          bestAirTarget = targetId;
          bestAirCard = cardId;
        }
      }

      const maxAirStrikes = wallet.money >= 400 ? 5 : wallet.money >= 200 ? 3 : 2;
      if ((this._turnCache.airStrikeCount || 0) < maxAirStrikes && bestAirTarget != null && bestAirScore > 0) {
        const cardObj = game.findCard(bestAirCard, country);
        const airIndCost = cardObj ? game.industryCost(cardObj, country) : 40;
        const targetArea = st.st(bestAirTarget);
        const isUrgent = targetArea && (targetArea.areaType === 4 || targetArea.armies.some(u => (u.cards & 8)));
        if (wallet.industry - airIndCost >= (isUrgent || wallet.money >= 300 ? 20 : minReserveIndustry)) {
          const cmd = { type: 'useCard', country, card: bestAirCard, target: bestAirTarget, pendingPurchase: true };
          if (!handlerFor('useCard')?.validate(game, cmd)) {
            this._turnCache.airStrikeCount = (this._turnCache.airStrikeCount || 0) + 1;
            return [cmd];
          }
        }
      }
    }



    // -------------------------------------------------------------
    // STEP 4: IMMEDIATE OCCUPATION OF ADJACENT ENEMY EMPTY / UNCLAIMED LANDS
    // (Strictly prioritized over melee combat: free land grabs carry zero risk & expand economy)
    // -------------------------------------------------------------
    let bestAdjacentCapture = null, bestAdjacentCaptureScore = -Infinity;
    for (const from of areas) {
      for (let unitIdx = 0; unitIdx < from.armies.length; unitIdx++) {
        const unit = from.armies[unitIdx];
        if (!unit || !st.canAct(unit) || blocked.has(unit.id)) continue;

        for (const id of (st.adjE.get(from.id) || [])) {
          const to = areaAt(id);
          if (to && !to.sea && (to.country == null || (enemy(to) && to.armies.length === 0))) {
            if (st.moveable(from.id, to.id, unitIdx)) {
              let score = 100;
              if (enemy(to)) {
                if (to.areaType === 4) score = 100000; // Capital: highest priority!
                else if (to.construction === 'city' || to.areaType === 1) score = 10000 + (to.level || 0) * 500;
                else if (to.construction === 'industry' || to.areaType === 3) score = 8000 + (to.level || 0) * 400;
                else score = 2000;
              } else if (to.country == null) {
                if (to.construction === 'city' || to.areaType === 1) score = 5000;
                else score = 500;
              }
              if (score > bestAdjacentCaptureScore) {
                bestAdjacentCaptureScore = score;
                bestAdjacentCapture = { type: 'move', from: from.id, to: to.id, armyId: unit.id };
              }
            }
          }
        }
      }
    }
    if (bestAdjacentCapture) {
      return [{ type: 'move', from: bestAdjacentCapture.from, to: bestAdjacentCapture.to, armyId: bestAdjacentCapture.armyId }];
    }

    // -------------------------------------------------------------
    // STEP 5: TACTICAL COMBAT & ATTACKS (With Overwhelming Force Focus, Pursuit & Siege Target Shift)
    // -------------------------------------------------------------
    let bestAttack = null, bestAttackScore = -Infinity;
    for (const from of areas) {
      for (let unitIdx = 0; unitIdx < from.armies.length; unitIdx++) {
        const unit = from.armies[unitIdx];
        if (!unit || !st.canAct(unit) || blocked.has(unit.id)) continue;

        const targets = unit.type === 'rocket' || unit.type === 'aircraftcarrier'
          ? st.enabled
          : (st.adjE.get(from.id) || []);

        for (const toId of targets) {
          const to = st.st(toId);
          if (!to || !enemy(to) || !st.attackable(from.id, to.id, unitIdx, game.airstrikeRadius())) continue;

          const targetUnit = to.armies[0];
          if (!targetUnit) continue;

          let score = value(to);
          const targetHp = targetUnit.hp || 1;
          const targetMaxHp = targetUnit.maxHp || 100;
          if (targetUnit.cards & 8) score += 500;

          // Local force comparison: sum friendly force in surrounding hexes vs enemy defenders
          const myAtk = (unit.minAttack || 10) + (unit.maxAttack || 20);
          let localFriendlyPower = (unit.hp || 50) + myAtk * 1.5; // Always include attacking unit itself!
          for (const fId of (st.adjE.get(to.id) || [])) {
            const fArea = st.st(fId);
            if (fArea && fArea.country === country) {
              for (const a of fArea.armies) {
                localFriendlyPower += (a.hp || 50) + ((a.minAttack || 10) + (a.maxAttack || 20)) * 1.5;
              }
            }
          }
          let localEnemyPower = 0;
          for (const e of to.armies) {
            localEnemyPower += (e.hp || 50);
          }

          const isRanged = unit.type === 'artillery' || unit.type === 'rocket' || unit.type === 'aircraftcarrier';
          const isAmphibiousLanding = from.sea && !to.sea;
          const estDmg = Math.trunc(myAtk * 0.75);

          // Melee safety check: avoid futile suicide attack into overwhelming entrenched defense
          if (!isRanged) {
            if (isAmphibiousLanding) {
              // Amphibious assault beachhead check: avoid suicidal landing against overwhelming defense!
              const isLandingSuicide = localEnemyPower > localFriendlyPower * 1.5 || ((unit.hp || 50) < 45 && localEnemyPower > localFriendlyPower);
              if (estDmg < targetHp && isLandingSuicide) {
                continue; // Do not throw away precious expeditionary forces into a meat grinder!
              }
            } else {
              const suicideHp = 50 - 20 * (doctrine.attritionTolerance ?? 0.4);
              const suicideRatio = 1.15 + 0.3 * (doctrine.attritionTolerance ?? 0.4);
              const isSuicide = (unit.hp || 50) < suicideHp && localEnemyPower > localFriendlyPower * suicideRatio;
              const isOverwhelmed = localEnemyPower > localFriendlyPower * (1.3 + 0.5 * (doctrine.attritionTolerance ?? 0.4));
              if (estDmg < targetHp && (isSuicide || isOverwhelmed)) {
                continue; // Do not throw away severely outmatched troops
              }
            }
          }

          // Initiative bias
          score += Math.round(600 * ((doctrine.initiative ?? 0.5) - 0.5));

          // Amphibious landing strategic bonus: prioritize establishing footholds when viable
          if (isAmphibiousLanding) {
            if (localFriendlyPower >= localEnemyPower * 0.8) {
              score += Math.round(2000 * (0.5 + (doctrine.amphibious ?? 0.2)));
            } else {
              score -= 1000; // Beachhead is hostile and heavily defended, do not force reckless landing
            }
          }

          // Overwhelming / clear superiority bonus: ALWAYS attack when our forces crush the enemy!
          if (localFriendlyPower >= localEnemyPower) {
            score += 2500 + Math.min(2000, (localFriendlyPower - localEnemyPower) * 5);
          }

          // Pursuit bonus: prioritize hunting retreating or exposed low-health units
          if (targetHp / targetMaxHp < 0.4 || targetHp <= 40) {
            score += 550;
          }

          if (estDmg >= targetHp) {
            score += 1200;
            if (unit.type === 'tank' || unit.type === 'heavytank') {
              score += Math.round(800 * (0.5 + (doctrine.exploitation ?? 0.3))); // retainMovementOnKill
            }
          } else {
            score += Math.max(0, 300 - targetHp);
          }

          // Ranged attack bonus (0 counterattack damage)
          if (isRanged) {
            score += Math.round(1000 * (0.5 + (doctrine.firePreparation ?? 0.5)));
          }

          // Siege attempt tracking: deprioritize targets that have resisted multiple attacks
          // EXEMPTION 1: Last stronghold (target country has <= 2 land areas) -> do not penalize, finish the country!
          // EXEMPTION 2: Overwhelming local power superiority (friendly power >= enemy power * 1.6) -> push through!
          // EXEMPTION 3: Amphibious assault landing -> keep pounding the beachhead!
          const targetCountry = to.country;
          const targetLandCount = targetCountry
            ? st.areas.filter(a => a.country === targetCountry && !a.sea).length
            : 0;
          const isLastStronghold = targetLandCount <= 2;
          const hasOverwhelmingSuperiority = localFriendlyPower >= (localEnemyPower * 1.6);

          if (this.targetSiegeAttempts && !isLastStronghold && !hasOverwhelmingSuperiority && !isAmphibiousLanding) {
            const siege = this.targetSiegeAttempts.get(to.id);
            if (siege && siege.attempts >= 1) {
              score -= Math.min(2500, siege.attempts * 800);
            }
          } else if (isLastStronghold && hasOverwhelmingSuperiority) {
            score += 1000; // Decisive finishing strike bonus!
          }

          if (score > bestAttackScore) {
            bestAttackScore = score;
            bestAttack = { type: 'attack', from: from.id, to: to.id, armyId: unit.id, score };
          }
        }
      }
    }

    if (bestAttack && bestAttackScore > 0) {
      if (this.targetSiegeAttempts) {
        const rec = this.targetSiegeAttempts.get(bestAttack.to) || { attempts: 0, lastRound: game.round };
        if (rec.lastRound !== game.round) {
          rec.attempts += 1;
          rec.lastRound = game.round;
        }
        this.targetSiegeAttempts.set(bestAttack.to, rec);
      }
      return [bestAttack];
    }

    // -------------------------------------------------------------
    // STEP 6: SMART PRODUCTION & HEAVY ARMOR/ARTILLERY SAVING
    // -------------------------------------------------------------
    const isValidIndustryCandidate = a => !a.sea && (a.construction === 'none' || (a.construction === 'industry' && (a.level || 0) < 3));
    const hasHomeHeavyBase = myAllAreas.some(a => (homeLandmass.size ? homeLandmass.has(a.id) : true) && industryLevel(a) >= 2);
    if (!hasHomeHeavyBase && canAfford(15) && wallet.money >= 90) {
      const candidates = myAllAreas.filter(isValidIndustryCandidate).sort((a, b) => {
        const aInd = a.construction === 'industry' ? 10 : 0;
        const bInd = b.construction === 'industry' ? 10 : 0;
        if (aInd !== bInd) return bInd - aInd;
        const aHome = homeLandmass.has(a.id) ? 5 : 0;
        const bHome = homeLandmass.has(b.id) ? 5 : 0;
        if (aHome !== bHome) return bHome - aHome;
        const aSafe = (st.adjE.get(a.id) || []).some(id => enemy(st.st(id))) ? 0 : 5;
        const bSafe = (st.adjE.get(b.id) || []).some(id => enemy(st.st(id))) ? 0 : 5;
        return (bHome + bSafe) - (aHome + aSafe);
      });
      const upgradeTarget = candidates[0];
      if (upgradeTarget && !blocked.has(`dev:${upgradeTarget.id}:15`)) {
        const cmd = { type: 'useCard', country, card: 15, target: upgradeTarget.id, pendingPurchase: true };
        if (!handlerFor('useCard')?.validate(game, cmd)) {
          return [cmd];
        }
      }
    }

    const flag = countryInfo?.flag;
    const allShopCards = shopCards(game.cardData, flag);
    const catalogRecruits = allShopCards.filter(c => RECRUIT_TYPES.has(c.id));
    const availableRecruits = catalogRecruits.filter(c => {
      const mCost = game.price(c, country);
      const iCost = game.industryCost(c, country);
      if ((wallet?.money || 0) < mCost || (wallet?.industry || 0) < iCost) return false;
      return !game.whyNot(c, country);
    });
    const income = game.income(country);
    const incMoney = Math.max(20, income?.money || 60);
    const incInd = Math.max(10, income?.industry || 20);
    const safeM = Math.max(0, wallet?.money || 0);
    const safeI = Math.max(0, wallet?.industry || 0);
    const moneyTurns = incMoney > 0 ? safeM / incMoney : 0;
    const indTurns = incInd > 0 ? safeI / incInd : 0;
    const moneyToIndRatio = (safeM + 1) / (safeI + 1);

    const categoryOf = id => {
      const type = RECRUIT_TYPES.get(id);
      if (['panzer', 'tank', 'heavytank'].includes(type)) return 'armor';
      if (type === 'artillery') return 'artillery';
      if (type === 'rocket') return 'rocket';
      if (type === 'eliteinfantry') return 'elite';
      if (NAVY_TYPES.has(type)) return 'navy';
      return 'infantry';
    };
    const totalArmies = myAllAreas.reduce((s, a) => s + (a.armies?.length || 0), 0) || 1;
    const catCounts = { infantry: 0, armor: 0, artillery: 0, rocket: 0, elite: 0, navy: 0 };
    for (const a of myAllAreas) {
      for (const u of a.armies) {
        const cat = categoryOf(u.type);
        catCounts[cat] = (catCounts[cat] || 0) + 1;
      }
    }

    const rankWeight = id => {
      let base = 50;
      // If we have industry and heavy base or good industry reserve, prioritize tanks/artillery over basic infantry!
      if (wallet.industry >= 80 || indTurns >= 1.5) {
        base = { 5: 100, 4: 95, 3: 85, 2: 80, 1: 75, 28: 60, 0: 35, 8: 30, 7: 25 }[id] || 0;
      } else if (wallet.industry >= 40) {
        base = { 2: 100, 1: 95, 4: 90, 5: 85, 3: 80, 28: 70, 0: 45, 8: 30, 7: 25 }[id] || 0;
      } else if (moneyTurns >= 2.0 && wallet.industry < 40) {
        // Industry shortage: use surplus money for elite/regular infantry
        base = { 28: 100, 0: 95, 2: 80, 1: 75, 4: 70, 5: 65, 3: 60, 8: 50, 7: 45 }[id] || 0;
      } else {
        base = { 5: 100, 4: 95, 3: 85, 2: 80, 1: 75, 28: 65, 0: 50, 8: 40, 7: 35 }[id] || 0;
      }

      // Doctrine weighting
      const cat = categoryOf(id);
      const currShare = (catCounts[cat] || 0) / totalArmies;
      const targetShare = doctrine.targetUnitMix?.[cat] ?? 0.2;
      const deficit = targetShare - currShare;
      let doctrineBonus = deficit * 80;
      if (cat === 'navy') doctrineBonus += (doctrine.navalPriority || 0.25) * 35;
      if (cat === 'armor') doctrineBonus += (doctrine.armorMass || 0.35) * 35;
      if (cat === 'infantry' && targetShare >= 0.5) doctrineBonus += 25;
      return base + doctrineBonus;
    };
    const sortedRecruits = [...availableRecruits].sort((a, b) => rankWeight(b.id) - rankWeight(a.id));

    const capital = myAllAreas.find(a => a.areaType === 4);
    const capitalThreatened = capital && (
      (st.adjE.get(capital.id) || []).some(id => enemy(st.st(id))) ||
      capital.armies.length === 0
    );

    // Armor / Artillery / Elite aspiration check:
    const moneySurplus = moneyTurns >= 1.5 || wallet.money >= 250;
    const extremeSurplus = moneyTurns >= 2.5 || wallet.money >= 450;

    // Saving threshold for tanks, artillery or technology research:
    const shouldSaveForTech = techLevel < 4 && wallet.money >= 200;
    const hasIndustrySurplus = wallet.industry >= 60 && (hasHeavyBase || hasAnyIndustryBase);
    const shouldSaveForArmor = !capitalThreatened && !moneySurplus && (
      hasIndustrySurplus ||
      (hasHeavyBase && hasTankInCatalog && (wallet.money < 220 || wallet.industry < 80)) ||
      (hasAnyIndustryBase && hasArtilleryInCatalog && (wallet.money < 125 || wallet.industry < 40))
    );

    // Check if the best card in sortedRecruits can be produced somewhere in our country
    const topCard = sortedRecruits[0];
    const isTopCardElite = topCard && [1, 2, 3, 4, 5, 28].includes(topCard.id);
    const canProduceTopCardSomewhere = isTopCardElite && myAllAreas.some(area =>
      !area.sea && area.armies.length < 4 &&
      !handlerFor('useCard')?.validate(game, { type: 'useCard', country, card: topCard.id, target: area.id, pendingPurchase: true })
    );

    // Prioritize recruitment areas:
    // 1. Threatened capital
    // 2. Heavy industrial base (if producing armor)
    // 3. Frontline industrial city
    // 4. Frontline regular city
    // 5. Rear industrial base / city
    const prioritizedAreas = [...myAllAreas].filter(a => !a.sea && a.armies.length < 4).sort((a, b) => {
      const aNeedCap = (a.areaType === 4 && a.armies.length < 2) ? 1 : 0;
      const bNeedCap = (b.areaType === 4 && b.armies.length < 2) ? 1 : 0;
      if (aNeedCap !== bNeedCap) return bNeedCap - aNeedCap;

      const aChokeNeed = (homeLandmass.has(a.id) && (st.adjE.get(a.id) || []).some(id => enemy(st.st(id))) && a.armies.length < 3) ? 1 : 0;
      const bChokeNeed = (homeLandmass.has(b.id) && (st.adjE.get(b.id) || []).some(id => enemy(st.st(id))) && b.armies.length < 3) ? 1 : 0;
      if (aChokeNeed !== bChokeNeed) return bChokeNeed - aChokeNeed;

      const aThreatNeed = (threatAssessment?.threatChokePoints?.has(a.id) && a.armies.length < (threatAssessment.borderHoldAreas.get(a.id) || 1)) ? 1 : 0;
      const bThreatNeed = (threatAssessment?.threatChokePoints?.has(b.id) && b.armies.length < (threatAssessment.borderHoldAreas.get(b.id) || 1)) ? 1 : 0;
      if (aThreatNeed !== bThreatNeed) return bThreatNeed - aThreatNeed;

      if (capitalThreatened) {
        const aIsCapital = a.areaType === 4 ? 1 : 0;
        const bIsCapital = b.areaType === 4 ? 1 : 0;
        if (aIsCapital !== bIsCapital) return bIsCapital - aIsCapital;
      }

      if (isHomeThreatened) {
        const aHome = homeLandmass.has(a.id) ? 1 : 0;
        const bHome = homeLandmass.has(b.id) ? 1 : 0;
        if (aHome !== bHome) return bHome - aHome;
      }

      if (isTopCardElite) {
        const requiredInd = [4, 5].includes(topCard.id) ? 2 : 1;
        const aCan = industryLevel(a) >= requiredInd ? 1 : 0;
        const bCan = industryLevel(b) >= requiredInd ? 1 : 0;
        if (aCan !== bCan) return bCan - aCan;
      }

      const aIsCapital = a.areaType === 4 ? 1 : 0;
      const bIsCapital = b.areaType === 4 ? 1 : 0;
      if (aIsCapital !== bIsCapital) return bIsCapital - aIsCapital;

      const aContact = ((st.adjE.get(a.id) || []).some(id => isHostileOrFree(st.st(id))) || threatAssessment?.threatChokePoints?.has(a.id)) ? 1 : 0;
      const bContact = ((st.adjE.get(b.id) || []).some(id => isHostileOrFree(st.st(id))) || threatAssessment?.threatChokePoints?.has(b.id)) ? 1 : 0;
      if (aContact !== bContact) return bContact - aContact;

      const aInd = industryLevel(a);
      const bInd = industryLevel(b);
      if (aInd !== bInd) return bInd - aInd;

      return (b.level || 0) - (a.level || 0);
    });

    for (const a of prioritizedAreas) {
      const isThreatChoke = threatAssessment?.threatChokePoints?.has(a.id);
      const isContact = (st.adjE.get(a.id) || []).some(id => isHostileOrFree(st.st(id))) || isThreatChoke;
      const isUrban = a.construction === 'city' || a.construction === 'industry' || [1, 3, 4].includes(a.areaType);

      if (!isContact && !isUrban && !extremeSurplus) continue;
      const maxRearGarrison = (extremeSurplus || moneySurplus) ? 4 : (wallet.money >= 200 || myAllAreas.length <= 15) ? 3 : 2;
      if (!isContact && a.armies.length >= maxRearGarrison) continue;

      // If we have the resources for our topCard, and topCard can be produced in an industrial base elsewhere,
      // don't let this area settle for an inferior unit and drain the treasury (unless capital threatened or money surplus)
      if (canProduceTopCardSomewhere && !capitalThreatened && !moneySurplus) {
        const aCanProduceTop = !handlerFor('useCard')?.validate(game, {
          type: 'useCard', country, card: topCard.id, target: a.id, pendingPurchase: true
        });
        if (!aCanProduceTop) {
          continue; // Leave the budget for the qualified base!
        }
      }

      for (const card of sortedRecruits) {
        // Reserve industry for tech research (Card 21) if tech is below 4
        if (shouldSaveForTech && !capitalThreatened && card.id !== 0) {
          const cardInd = game.industryCost(card, country);
          if (cardInd > 0 && wallet.industry - cardInd < 120 && wallet.money >= 240) {
            continue; // Reserve 120 industry for tech research!
          }
        }

        if (card.id !== 5 && hasHeavyBase && availableRecruits.some(c => c.id === 5) && industryLevel(a) >= 2 && !capitalThreatened) {
          if (wallet.industry >= 80 && wallet.money < 120) {
            continue; // Save money to build Heavy Tank in this heavy industrial base!
          }
        }

        // Do not spawn basic infantry if treasury is tight and we need to save budget for armor/artillery
        if (card.id === 0 && !capitalThreatened && !moneySurplus) {
          if (shouldSaveForArmor && wallet.money < 220) {
            continue; // Only save budget for armor if money is constrained
          }
        }

        if (blocked.has(`recruit:${a.id}:${card.id}`)) continue;
        const cmd = { type: 'useCard', country, card: card.id, target: a.id, pendingPurchase: true };
        if (!handlerFor('useCard')?.validate(game, cmd)) {
          return [cmd];
        }
      }
    }

    // -------------------------------------------------------------
    // STEP 7: ECONOMIC CONSTRUCTION & DEFENSIVE FORTIFICATIONS
    // (Card 14 City, Card 15 Industry, Card 17 Fort, Card 18 Entrenchment)
    // -------------------------------------------------------------
    // 7.1 Fortification on frontline or exposed nodes: Entrenchment (18) and Fort (17)
    if (canAfford(18) || canAfford(17)) {
      const fortifyCandidates = [...myAllAreas].filter(a => !a.sea && a.installation === 'none').sort((a, b) => {
        const aThreat = threatAssessment?.threatChokePoints?.has(a.id) ? 1 : 0;
        const bThreat = threatAssessment?.threatChokePoints?.has(b.id) ? 1 : 0;
        if (aThreat !== bThreat) return bThreat - aThreat;

        const aHomeContact = (homeLandmass.has(a.id) && (st.adjE.get(a.id) || []).some(id => enemy(st.st(id)))) ? 1 : 0;
        const bHomeContact = (homeLandmass.has(b.id) && (st.adjE.get(b.id) || []).some(id => enemy(st.st(id)))) ? 1 : 0;
        if (aHomeContact !== bHomeContact) return bHomeContact - aHomeContact;
        const aIsCapital = a.areaType === 4 ? 1 : 0;
        const bIsCapital = b.areaType === 4 ? 1 : 0;
        return bIsCapital - aIsCapital;
      });

      for (const a of fortifyCandidates) {
        const isContact = (st.adjE.get(a.id) || []).some(id => enemy(st.st(id)));
        const isThreatChoke = threatAssessment?.threatChokePoints?.has(a.id);
        if (isContact || isThreatChoke || a.areaType === 4 || a.areaType === 1) {
          // Preserve industry reserves for heavy armor & artillery unless defending threatened capital or home frontline or threat choke
          const isUrgent = (a.areaType === 4 && capitalThreatened) || (homeLandmass.has(a.id) && isContact) || isThreatChoke;
          const fortThreshold = Math.round(120 - 80 * (doctrine.fortification ?? 0.6));
          if (!isUrgent && (wallet?.industry || 0) < fortThreshold && !extremeSurplus) continue;

          // Prefer fort for key cities if affordable, otherwise entrenchment
          const fortCard = canAfford(17) ? 17 : (canAfford(18) ? 18 : null);
          if (fortCard && !blocked.has(`dev:${a.id}:${fortCard}`)) {
            const cmd = { type: 'useCard', country, card: fortCard, target: a.id, pendingPurchase: true };
            if (!handlerFor('useCard')?.validate(game, cmd)) {
              this.cardUsageStats[fortCard] = (this.cardUsageStats[fortCard] || 0) + 1;
              return [cmd];
            }
          }
        }
      }
    }

    // 7.2 Economic upgrading when money/industry has surplus
    // Dynamic economic balancing based on relative ratio of money to industry
    const maxEconCards = moneyTurns >= 3.5 ? 12 : extremeSurplus ? 8 : moneySurplus ? 5 : 2;
    if ((this._turnCache.econCardCount || 0) < maxEconCards && (canAfford(14) || canAfford(15)) && wallet.money >= 100) {
      const indIncomeRatio = incInd / incMoney;
      const wantIndustryThreshold = 0.25 + 0.3 * (doctrine.industry ?? 0.5);
      const wantIndustry = !hasHomeHeavyBase || indIncomeRatio < wantIndustryThreshold || (wallet.industry < 100 && moneyToIndRatio >= 1.2) || (moneyTurns >= 2.5 && indIncomeRatio < (wantIndustryThreshold + 0.15));

      if (wantIndustry && canAfford(15)) {
        const indCandidates = myAllAreas.filter(isValidIndustryCandidate).sort((a, b) => {
          const aInd = a.construction === 'industry' ? 10 : 0;
          const bInd = b.construction === 'industry' ? 10 : 0;
          if (aInd !== bInd) return bInd - aInd;
          const aHome = homeLandmass.has(a.id) ? 5 : 0;
          const bHome = homeLandmass.has(b.id) ? 5 : 0;
          if (aHome !== bHome) return bHome - aHome;
          const aSafe = (st.adjE.get(a.id) || []).some(id => enemy(st.st(id))) ? 0 : 5;
          const bSafe = (st.adjE.get(b.id) || []).some(id => enemy(st.st(id))) ? 0 : 5;
          return (bHome + bSafe) - (aHome + aSafe);
        });
        for (const a of indCandidates) {
          if (!blocked.has(`dev:${a.id}:15`)) {
            const cmd = { type: 'useCard', country, card: 15, target: a.id, pendingPurchase: true };
            if (!handlerFor('useCard')?.validate(game, cmd)) {
              this._turnCache.econCardCount = (this._turnCache.econCardCount || 0) + 1;
              this.cardUsageStats[15] = (this.cardUsageStats[15] || 0) + 1;
              return [cmd];
            }
          }
        }
      }

      if (canAfford(14) && (!wantIndustry || indIncomeRatio >= 0.4 || wallet.money >= 250)) {
        for (const a of myAllAreas) {
          if (a.sea) continue;
          if (a.construction === 'none' || (a.construction === 'city' && a.level < 4)) {
            if (!blocked.has(`dev:${a.id}:14`)) {
              const cmd = { type: 'useCard', country, card: 14, target: a.id, pendingPurchase: true };
              if (!handlerFor('useCard')?.validate(game, cmd)) {
                this._turnCache.econCardCount = (this._turnCache.econCardCount || 0) + 1;
                this.cardUsageStats[14] = (this.cardUsageStats[14] || 0) + 1;
                return [cmd];
              }
            }
          }
        }
      }
    }

    // -------------------------------------------------------------
    // STEP 8: STRATEGIC MANOEUVRE WITH POWER COMPARISON & HIGH-VALUE TARGET VECTOR
    // (Empty/unguarded lands are unconditional top priority; power comparison for occupied lands)
    // -------------------------------------------------------------
    const hasAnyUnclaimedLand = st.areas.some(a => !a.sea && a.country == null);
    if (!hasAnyEnemy && !hasAnyUnclaimedLand) {
      return [];
    }

    const countryLandCount = new Map();
    for (const a of st.areas) {
      if (!a.sea && a.country) {
        countryLandCount.set(a.country, (countryLandCount.get(a.country) || 0) + 1);
      }
    }

    const nearestStep = (from, unitIndex) => {
      const unit = from.armies[unitIndex];
      if (!unit) return null;
      const isNavy = NAVY_TYPES.has(unit.type);
      const canSea = isNavy || !!(unit.cards & 4);
      const isEmbarkedInSea = !isNavy && from.sea && from.areaType !== 2;
      const myPower = (unit.hp || 50) + ((unit.minAttack || 10) + (unit.maxAttack || 20)) * 2;

      // Precompute single-action reachable steps to avoid calling expensive Dijkstra inside search loop
      const validStep1 = new Set();
      for (const nid of (st.adjE.get(from.id) || [])) {
        if (st.moveable(from.id, nid, unitIndex)) validStep1.add(nid);
      }
      const uMovement = unit.movement ?? st.armyDef(country, unit.type).movement ?? 1;
      if (uMovement > 1) {
        for (const mid of (st.adjE.get(from.id) || [])) {
          for (const nid of (st.adjE.get(mid) || [])) {
            if (!validStep1.has(nid) && st.moveable(from.id, nid, unitIndex)) validStep1.add(nid);
          }
        }
      }

      const farthestReachable = route => {
        for (let i = route.length - 1; i > 0; i--) {
          const id = route[i];
          if (validStep1.has(id)) {
            const cand = st.st(id);
            if (cand?.country === country && cand.armies.length >= st.maxArmies(cand.id)) continue;
            return id;
          }
        }
        return null;
      };

      const seen = new Set([from.id]);
      const queue = [[from, [from.id], 0]];
      let bestCandidate = null, bestScore = -Infinity;
      let bestPortStep = null, bestPortScore = -Infinity;
      let head = 0;

      while (head < queue.length) {
        const [curr, route, depth] = queue[head++];
        if (depth > 16) continue;

        // If unit cannot sea-travel, record reachable friendly coastal port areas as fallback vector
        if (!canSea && curr !== from && curr.country === country && !curr.sea) {
          const adjList = st.adjE.get(curr.id) || [];
          const isCoastal = adjList.some(id => st.st(id)?.sea);
          if (isCoastal) {
            const isFull = curr.armies.length >= st.maxArmies(curr.id);
            const portScore = 1000 - depth * 20 - (isFull ? 350 : 0);
            if (portScore > bestPortScore) {
              const step = farthestReachable(route);
              if (step != null) {
                bestPortScore = portScore;
                bestPortStep = step;
              }
            }
          }
        }

        if (curr !== from && curr.country === country && !curr.sea && threatAssessment?.threatChokePoints?.has(curr.id)) {
          const needed = threatAssessment.borderHoldAreas?.get(curr.id) || 1;
          if (curr.armies.length < needed) {
            const stagingScore = 3200 + (threatAssessment.threatBorderPriority?.get(curr.id) || 50) * 10 - depth * 15;
            if (stagingScore > bestScore) {
              const step = farthestReachable(route);
              if (step != null) {
                bestScore = stagingScore;
                bestCandidate = step;
              }
            }
          }
        }

        if (curr !== from && isHostileOrFree(curr)) {
          let targetScore = value(curr);
          
          if (curr.armies.length === 0) {
            // Unoccupied/unguarded target: 100% zero combat risk, unconditional highest priority!
            targetScore += 3000;
            if (curr.areaType === 4) targetScore += 12000; // Capital: supreme objective!
            else if (curr.construction === 'city' || curr.areaType === 1) targetScore += 5000;
            else if (curr.construction === 'industry' || curr.areaType === 3) targetScore += 4000;
          } else {
            // Guarded enemy target: power comparison applies
            const enemyHp = curr.armies[0]?.hp || 100;
            if (myPower > enemyHp * 1.2) targetScore += 1500; // Superiority pursuit
            if (myPower > 100 && (curr.areaType === 4 || curr.areaType === 1 || curr.construction === 'city')) {
              targetScore += 800;
            }
          }

          const currCountry = curr.country;
          const isLastStronghold = currCountry && (countryLandCount.get(currCountry) || 0) <= 2;
          if (this.targetSiegeAttempts && !isLastStronghold) {
            const siege = this.targetSiegeAttempts.get(curr.id);
            if (siege && siege.attempts >= 1) {
              targetScore -= Math.min(2500, siege.attempts * 800);
            }
          }

          if (isEmbarkedInSea && !curr.sea) {
            targetScore += 5000;
          }

          const score = targetScore - depth * 15;
          if (score > bestScore) {
            const step = farthestReachable(route);
            if (step != null) {
              bestScore = score;
              bestCandidate = step;
            }
          }
        }

        for (const nextId of (st.adjE.get(curr.id) || [])) {
          if (seen.has(nextId)) continue;
          const next = areaAt(nextId);
          if (!next) continue;

          if (next.armies.length && enemy(next)) {
            seen.add(nextId);
            const step = farthestReachable([...route, nextId]);
            let enemyTargetScore = value(next) + (myPower > (next.armies[0]?.hp || 100) ? 2000 : 800);
            if (next.areaType === 4) enemyTargetScore += 6000;
            const nextCountry = next.country;
            const isNextLastStronghold = nextCountry && (countryLandCount.get(nextCountry) || 0) <= 2;
            if (this.targetSiegeAttempts && !isNextLastStronghold) {
              const siege = this.targetSiegeAttempts.get(next.id);
              if (siege && siege.attempts >= 1) {
                enemyTargetScore -= Math.min(2500, siege.attempts * 800);
              }
            }
            if (isEmbarkedInSea) {
              if (!next.sea) enemyTargetScore += 5000;
              else enemyTargetScore -= 1500;
            }
            const score = enemyTargetScore - depth * 15;
            if (step != null && score > bestScore) {
              bestScore = score;
              bestCandidate = step;
            }
            continue;
          }

          // Sea navigation: non-transport land units cannot enter sea; navy cannot enter non-port land
          if (!canSea && next.sea && next.areaType !== 2) continue;
          if (isNavy && !next.sea && next.areaType !== 2) continue;
          if (homeLandmass.has(from.id) && isHomeThreatened && next.sea && !isNavy) continue;

          // Embarked land units in open sea should never retreat/wander back into domestic land
          if (isEmbarkedInSea && next.country === country && !next.sea) continue;

          // AI rules: cannot traverse allied or peace country territory
          if (next.country && next.country !== country && !next.sea) {
            if (game?.diplomacy?.enabled) {
              if (!game.canOccupyTerritory(country, next.country, true)) continue;
            } else if (st.areAllied(country, next.country)) {
              continue;
            }
          }

          // Cannot end turn at a full friendly area; allow search to traverse through with penalty
          // so rear units can still find paths to the front without getting deadlocked by friendly choke points
          const isFriendlyFull = next.country === country && next.armies.length >= st.maxArmies(next.id);
          seen.add(nextId);
          queue.push([next, [...route, nextId], depth + (isFriendlyFull ? 2 : 1)]);
        }
      }
      if (bestCandidate != null) return bestCandidate;
      const fromIsCoastal = (st.adjE.get(from.id) || []).some(id => st.st(id)?.sea);
      if (!canSea && !fromIsCoastal && bestPortStep != null) {
        return bestPortStep;
      }
      return null;
    };

    if (!this._turnCache.unitLastFrom) {
      this._turnCache.unitLastFrom = new Map();
    }

    for (const from of areas) {
      const isCapital = from.areaType === 4 || from.id === myCapital?.id;
      if (isCapital && from.armies.length <= 2 && myAllAreas.length > 1) {
        continue; // Keep at least two garrisons defending the capital!
      }
      if (homeLandmass.has(from.id) && from.areaType === 2 && from.armies.length <= 1 && myAllAreas.length > 2) {
        continue; // Keep at least one garrison defending the home port!
      }
      if (homeLandmass.has(from.id) && (st.adjE.get(from.id) || []).some(id => enemy(st.st(id))) && from.armies.length <= 2) {
        continue; // Keep at least two garrisons defending frontline home choke points!
      }
      if (threatAssessment?.borderHoldAreas?.has(from.id)) {
        const holdCount = threatAssessment.borderHoldAreas.get(from.id) || 1;
        if (from.armies.length <= holdCount) {
          continue; // Keep garrison defending high threat border!
        }
      }
      // Ensure rear depth reserves: keep at least reserveTarget units in rear non-contact positions
      const isFromContact = (st.adjE.get(from.id) || []).some(nid => enemy(st.st(nid)));
      const reserveTarget = Math.max(2, Math.floor(myAllAreas.length * 0.25 * (doctrine.reserve ?? 0.3)));
      if (!isFromContact && !from.sea && !isCapital) {
        let rearArmies = 0;
        for (const a of myAllAreas) {
          if (a.sea || a.id === myCapital?.id) continue;
          const isAContact = (st.adjE.get(a.id) || []).some(nid => enemy(st.st(nid)));
          if (!isAContact) rearArmies += a.armies.length;
        }
        if (rearArmies <= reserveTarget) {
          continue; // Maintain at least reserve units in rear depth!
        }
      }
      for (let unitIdx = 0; unitIdx < from.armies.length; unitIdx++) {
        const unit = from.armies[unitIdx];
        if (!unit || !st.canAct(unit) || blocked.has(unit.id)) continue;

        let dest = null;
        const isNavy = NAVY_TYPES.has(unit.type);
        const canSea = isNavy || !!(unit.cards & 4);
        const cacheKey = `${from.id}:${canSea ? 'sea' : 'land'}:${isNavy ? 'navy' : 'army'}`;
        if (this._turnCache.stepCache.has(cacheKey)) {
          const cachedDest = this._turnCache.stepCache.get(cacheKey);
          if (cachedDest === -1) continue;
          if (cachedDest != null && st.moveable(from.id, cachedDest, unitIdx)) {
            dest = cachedDest;
          } else {
            this._turnCache.stepCache.delete(cacheKey);
          }
        }

        if (dest == null) {
          dest = nearestStep(from, unitIdx);
          this._turnCache.stepCache.set(cacheKey, dest != null ? dest : -1);
        }

        if (dest != null && dest !== -1 && st.moveable(from.id, dest, unitIdx)) {
          if (this._turnCache.unitLastFrom.get(unit.id) === dest || this.unitMoveHistory?.get(unit.id) === dest) {
            continue; // Prevent futile same-turn or cross-turn A-B-A backtracking
          }
          this._turnCache.unitLastFrom.set(unit.id, from.id);
          this.unitMoveHistory?.set(unit.id, from.id);
          return [{ type: 'move', from: from.id, to: dest, armyId: unit.id }];
        }
      }
    }

    return [];
  }
}
