// General Staff Diplomacy Decision Module (V2 §5.7 & WP DIP)
// Responsible for general staff level diplomatic actions: war declaration valuation,
// peace sueing evaluation against war continuation expectation, and peace acceptance.

import {
  getDiplomaticRelation,
  DIPLOMACY_STATE,
  relationKey,
  computeReparations,
  evaluatePeaceAcceptance,
  declareWarStabilityCost,
  warCascade,
  countryPower,
  peaceProposalStabilityCost,
  DEFAULT_PEACE_REJECT_COOLDOWN_ROUNDS,
  hasNap,
  areDiplomaticAllies,
} from '../../../rules/diplomacy.js';
import { evaluateAiDeclareWar } from '../../strong.js';
import { peaceTuning, declareTuning } from '../../../rules/national_traits.js';
import { loadStaffOverrides, STAFF_P } from './params_staff.js';
import { identifyCountryProfile } from './profile.js';

export { identifyCountryProfile };

// Backward-compatible named exports sourced from centralized STAFF_P
export const STABILITY_POINT_CREDIT_VALUE = STAFF_P.stabilityCreditValue;
export const WAR_DECLARATION_GAIN_COST_RATIO = STAFF_P.warDeclarationGainCostRatio;

export function sharesLandBorder(model, targetId) {
  const st = model.st;
  const myLandIds = new Set(model.mine.filter(a => a.land).map(a => a.id));
  const targetLands = st.areas.filter(a => a.country === targetId && !a.sea);
  for (const a of targetLands) {
    for (const nid of (st.adjE?.get(a.id) || [])) {
      if (myLandIds.has(nid)) return true;
    }
  }
  return false;
}

/**
 * Checks if the country's capital is occupied or under direct frontline threat
 */
function isCapitalThreatened(model) {
  const game = model.game;
  const me = model.me;
  if (game.diplomacy?.capitalFallen?.[me]) return true;

  const capId = game.diplomacy?.capitals?.[me];
  if (capId == null) return false;
  const capArea = model.area(capId);
  if (!capArea || capArea.owner !== me) return true;

  for (const adjId of (capArea.adj || [])) {
    const na = model.area(adjId);
    if (na && na.owner && na.stackCount > 0 && model.rel(na.owner) === 'enemy') {
      return true;
    }
  }
  return false;
}

/**
 * Evaluates the strategic threat posed by an opponent country before declaring war or planning campaigns.
 *
 * @param {object} game - Active Game instance
 * @param {object} stage - Active Stage instance (game.stage)
 * @param {string|object} targetCountry - Target country identifier or country object
 * @param {string|object} myCountry - Own country identifier or country object
 * @returns {{
 *   threatLevel: number,
 *   alliesCost: number,
 *   futureExpansionBlock: number,
 *   recommendation: 'strike_early'|'delay_avoid'|'slow_conquest'|'balanced',
 *   details: object
 * }}
 */
export function evaluateOpponentThreat(game, stage, targetCountry, myCountry) {
  const targetId = typeof targetCountry === 'string' ? targetCountry : targetCountry?.id;
  const myId = typeof myCountry === 'string' ? myCountry : myCountry?.id;
  if (!game || !targetId || !myId || targetId === myId) {
    return { threatLevel: 0, alliesCost: 0, futureExpansionBlock: 0, recommendation: 'balanced', details: {} };
  }

  const st = stage || game.stage;
  const myInfo = st?.countries?.get(myId);
  const targetInfo = st?.countries?.get(targetId);
  if (!targetInfo || targetInfo.eliminated || !myInfo || myInfo.eliminated) {
    return { threatLevel: 0, alliesCost: 0, futureExpansionBlock: 0, recommendation: 'balanced', details: {} };
  }

  // 1. 即时威胁 (Immediate Threat -> threatLevel)
  const myP = countryPower(game, myId);
  const targetP = countryPower(game, targetId);
  const myPower = Math.max(1, myP.power);
  const targetPower = Math.max(0, targetP.power);
  const relativePowerRatio = targetPower / myPower;

  // 领土与接壤接触
  const myLands = (st.areas || []).filter(a => a.country === myId && !a.sea);
  const targetLands = (st.areas || []).filter(a => a.country === targetId && !a.sea);
  const myLandIds = new Set(myLands.map(a => a.id));
  const targetLandIds = new Set(targetLands.map(a => a.id));

  let borderContactCount = 0;
  let targetBorderArmiesPower = 0;
  for (const ta of targetLands) {
    let touchesMe = false;
    for (const nid of (st.adjE?.get(ta.id) || [])) {
      if (myLandIds.has(nid)) {
        touchesMe = true;
        borderContactCount++;
      }
    }
    if (touchesMe) {
      targetBorderArmiesPower += (ta.armies || []).reduce((s, u) => s + (u.hp || 50), 0);
    }
  }

  // 首都威胁距离 (BFS 计算距离)
  const capId = game.diplomacy?.capitals?.[myId];
  let minDistanceToCapital = 99;
  if (capId != null) {
    const q = [capId];
    const visited = new Map([[capId, 0]]);
    while (q.length > 0) {
      const cur = q.shift();
      const d = visited.get(cur);
      if (targetLandIds.has(cur)) {
        minDistanceToCapital = d;
        break;
      }
      if (d < 4) {
        for (const nid of (st.adjE?.get(cur) || [])) {
          if (!visited.has(nid)) {
            visited.set(nid, d + 1);
            q.push(nid);
          }
        }
      }
    }
  }

  // 即时威胁评分 threatLevel (0 - 100)
  // - 军力维度: max 40
  const powerScore = Math.min(40, relativePowerRatio * 30);
  // - 边境接触与前线兵力: max 45
  const borderScore = borderContactCount > 0
    ? Math.min(45, borderContactCount * 6 + (targetBorderArmiesPower / Math.max(1, myPower)) * 25)
    : 0;
  // - 首都距离威胁: max 15 (相邻=15, 隔1格=8)
  const capitalThreatScore = minDistanceToCapital <= 1 ? 15 : (minDistanceToCapital <= 2 ? 8 : 0);
  const threatLevel = Math.round(powerScore + borderScore + capitalThreatScore);

  // 2. 联盟连锁 (Allies Cost -> alliesCost)
  // 对该国宣战会导致多少其他国家参战 (warCascade 的规模与战力)
  const cascade = warCascade(game, myId, targetId) || [];
  let cascadeTotalPower = 0;
  let cascadeBorderCount = 0;
  for (const allyId of cascade) {
    const ap = countryPower(game, allyId).power;
    cascadeTotalPower += ap;
    const allyLands = (st.areas || []).filter(a => a.country === allyId && !a.sea);
    const touchesMe = allyLands.some(la => (st.adjE?.get(la.id) || []).some(nid => myLandIds.has(nid)));
    if (touchesMe) {
      cascadeBorderCount++;
      cascadeTotalPower += ap * 0.5; // 接壤同盟威胁更大
    }
  }
  const alliesCost = Math.round(cascade.length * 15 + (cascadeTotalPower / Math.max(1, myPower)) * 30 + cascadeBorderCount * 10);

  // 3. 未来威胁与扩张阻碍 (Future Expansion Block -> futureExpansionBlock)
  const inc = game.income ? game.income(targetId) : { money: 0, industry: 0 };
  const targetStock = targetInfo.industry || 0;
  const industrialPotential = (inc?.industry || 0) * 3 + (inc?.money || 0) * 1.5 + targetStock * 0.2;
  const strategicFacilities = targetLands.filter(a =>
    a.construction === 'city' || a.construction === 'industry' || [1, 3, 4].includes(a.areaType)
  ).length;

  let routeBlockingScore = 0;
  if (borderContactCount > 0) {
    routeBlockingScore += 25;
    const hasSeaNeighbor = targetLands.some(a => (st.adjE?.get(a.id) || []).some(nid => st.st(nid)?.sea));
    if (hasSeaNeighbor) routeBlockingScore += 10;
  } else {
    const isNearby = targetLands.some(ta =>
      myLands.some(ma => (st.adjE?.get(ma.id) || []).some(nid => (st.adjE?.get(nid) || []).includes(ta.id)))
    );
    if (isNearby) routeBlockingScore += 10;
  }

  // 判定是否不可能成为盟友
  const areAllies = areDiplomaticAllies(game, myId, targetId);
  const hasNonAggression = hasNap(game, myId, targetId);
  let impossibleAllyMultiplier = 1.0;
  if (areAllies || hasNonAggression) {
    impossibleAllyMultiplier = 0.2;
  } else {
    const myTraits = st.data?.traitCatalog?.countries?.[myId]?.traits || [];
    const targetTraits = st.data?.traitCatalog?.countries?.[targetId]?.traits || [];
    if ((myTraits.includes('totalitarian') && targetTraits.includes('democracy')) ||
        (myTraits.includes('democracy') && targetTraits.includes('totalitarian'))) {
      impossibleAllyMultiplier = 1.3;
    }
  }

  const futureExpansionBlock = Math.round(
    (Math.min(45, industrialPotential * 0.8 + targetLands.length * 2 + strategicFacilities * 4) + routeBlockingScore) * impossibleAllyMultiplier
  );

  // 4. 战略建议 (Recommendation)
  // - 威胁低但会长大的（新兴国家）-> strike_early (提前宣战)
  // - 威胁高但联盟多 -> delay_avoid (延迟宣战或避战)
  // - 威胁低且不会长大 -> slow_conquest (可缓缓图之)
  let recommendation = 'balanced';
  const isHighGrowth = industrialPotential >= 20 || targetStock >= 75 || strategicFacilities >= 3;
  const isLowThreat = threatLevel < 35 && relativePowerRatio < 0.65;
  const isHighThreat = threatLevel >= 50 || relativePowerRatio >= 1.0;
  const isHighAlliesCost = alliesCost >= 40 || cascade.length >= 2;

  if (isLowThreat && isHighGrowth && borderContactCount > 0 && alliesCost < 30) {
    recommendation = 'strike_early';
  } else if (isHighThreat && isHighAlliesCost) {
    recommendation = 'delay_avoid';
  } else if (isLowThreat && !isHighGrowth) {
    recommendation = 'slow_conquest';
  }

  return {
    threatLevel,
    alliesCost,
    futureExpansionBlock,
    recommendation,
    details: {
      relativePowerRatio,
      borderContactCount,
      minDistanceToCapital,
      cascadeCount: cascade.length,
      cascadeAllies: cascade,
      industrialPotential,
      isHighGrowth
    }
  };
}

/**
 * Ranks all non-ally countries by declare war priority into S, A, B, and C tiers.
 *
 * @param {object} game - Active Game instance
 * @param {object} model - Battlefield information model
 * @param {string|object} myCountry - Own country identifier or object
 * @returns {Array<object>} Sorted list of target candidates
 */
// Expansion priorities never replace the military feasibility check.
export function canAffordExpansionWar(game, model, targetId) {
  const me = model.me;
  const ownPower = countryPower(game, me).power;
  const targetPower = countryPower(game, targetId).power;
  const currentEnemies = Array.from(model.st.countries.values())
    .filter(c => !c.eliminated && c.id !== targetId && model.rel(c.id) === 'enemy');
  const committedPower = currentEnemies.reduce((sum, c) => sum + countryPower(game, c.id).power, 0);
  const extraPower = warCascade(game, me, targetId)
    .filter(id => id !== targetId && !currentEnemies.some(c => c.id === id))
    .reduce((sum, id) => sum + countryPower(game, id).power, 0);
  if (ownPower < targetPower * 1.2 + committedPower * 0.6 + extraPower * 0.75) return false;
  const border = model.mine.filter(a => a.land && a.adj.some(id => model.area(id)?.owner === targetId));
  if (!border.length) return false;
  const assembled = model.units.mine.filter(u => border.some(a => model.dist(u.area, a.id) <= 2))
    .reduce((sum, u) => sum + u.hp, 0);
  const opposing = model.st.areas.filter(a => a.country === targetId && !a.sea &&
    border.some(b => model.dist(a.id, b.id) <= 2))
    .reduce((sum, a) => sum + (a.armies || []).reduce((hp, u) => hp + (u.hp || 0), 0), 0);
  return assembled > 0 && assembled >= opposing * 1.1;
}

export function rankDeclareWarTargets(game, model, myCountry) {
  const myId = typeof myCountry === 'string' ? myCountry : myCountry?.id || model?.me;
  if (!game || !myId) return [];

  const stage = model?.st || game.stage;
  const candidates = [];

  for (const c of stage.countries.values()) {
    if (!c || c.id === myId || c.eliminated) continue;
    const cid = c.id;
    if (areDiplomaticAllies(game, myId, cid)) continue;
    if (hasNap(game, myId, cid)) continue;

    const rel = getDiplomaticRelation(game, myId, cid);
    if (rel === DIPLOMACY_STATE.WAR) continue;

    const aiRules = stage.data?.ai_rules || game.diplomacy?.ai_rules || {};
    const tuning = declareTuning(stage.data?.traitCatalog, stage.countries.get(myId));
    if (tuning.neverDeclare || game.round < (aiRules.min_war_round ?? 1)) continue;
    if ((aiRules.special_restraints || []).some(r =>
      (r.attacker === myId || r.attacker === '*') && (r.target === cid || r.target === '*') &&
      (r.never_declare || (game.round < (r.min_round ?? 1) &&
        countryPower(game, myId).power <
          [cid, ...warCascade(game, myId, cid)].reduce((sum, id) => sum + countryPower(game, id).power, 0) *
          (r.overwhelming_power_ratio ?? 4))))) continue;
    if ((game.diplomacy?.truceUntil?.[relationKey(myId, cid)] || 0) > game.round) continue;
    const permanentNeutrals = new Set(aiRules.permanent_neutrals || game.diplomacy?.permanent_neutrals || []);
    if (permanentNeutrals.has(cid)) {
      const atWarWithAny = Array.from(stage.countries.values()).some(
        other => !other.eliminated && other.id !== cid && getDiplomaticRelation(game, cid, other.id) === DIPLOMACY_STATE.WAR
      );
      if (!atWarWithAny) continue;
    }

    const targetLands = stage.areas.filter(a => a.country === cid && !a.sea);
    if (targetLands.length === 0) continue;

    const threatEval = evaluateOpponentThreat(game, stage, cid, myId);
    const tPower = countryPower(game, cid).power;
    const myPower = countryPower(game, myId).power;
    const hasBorder = threatEval.details.borderContactCount > 0;
    const isReachable = hasBorder || (model?.mine && targetLands.some(ta =>
      model.mine.some(ma => ma.land && model.dist && model.dist(ma.id, ta.id) <= 2)
    ));

    // 四级优先级判定：
    // - 优先级S：阻挡我扩张且不会成为盟友的国家 (futureExpansionBlock高，阻碍关键扩张，同盟连锁小)
    // - 优先级A：威胁较大且容易快速灭亡的国家 (即时威胁较大，但防守薄弱易速胜)
    // - 优先级B：经济/工业强且会威胁的国家 (工业强、有威胁，需准备充分)
    // - 优先级C：离我很远或暂时无威胁的国家
    let priorityTier = 'C';
    let rankScore = 0;

    const isWeakAndVulnerable = (tPower < 50 || targetLands.length <= 3) && (myPower > tPower * 1.4);
    const isExpansionBlocker = threatEval.futureExpansionBlock >= 30 && hasBorder;
    const isIndustrialThreat = threatEval.details.industrialPotential >= 20 || threatEval.threatLevel >= 45;

    if (isExpansionBlocker && threatEval.alliesCost <= 45 && isReachable) {
      priorityTier = 'S';
      rankScore = threatEval.futureExpansionBlock * 2 - threatEval.alliesCost + (hasBorder ? 30 : 0);
    } else if (threatEval.threatLevel >= 25 && isWeakAndVulnerable && isReachable) {
      priorityTier = 'A';
      rankScore = (100 - tPower) + threatEval.threatLevel - threatEval.alliesCost * 0.5;
    } else if (isIndustrialThreat && isReachable) {
      priorityTier = 'B';
      rankScore = threatEval.futureExpansionBlock + threatEval.threatLevel - threatEval.alliesCost;
    } else {
      priorityTier = 'C';
      rankScore = -threatEval.alliesCost - (hasBorder ? 0 : 30);
    }

    candidates.push({
      country: cid,
      priorityTier,
      rankScore,
      threatEval,
      tPower,
      hasBorder,
      isReachable
    });
  }

  const tierWeight = { 'S': 4000, 'A': 3000, 'B': 2000, 'C': 1000 };
  candidates.sort((a, b) => {
    const totalA = tierWeight[a.priorityTier] + a.rankScore;
    const totalB = tierWeight[b.priorityTier] + b.rankScore;
    return totalB - totalA;
  });

  return candidates;
}

// A second front has value even before it yields territory. Count only public
// diplomacy and power from the supplied visible model, never hidden formations.
function coalitionWarCandidate(game, model, ranked, capitalThreat) {
  if (capitalThreat) return null;
  const me = model.me, stage = model.st;
  const rules = stage.data?.ai_rules || game.diplomacy?.ai_rules || {};
  const tuning = declareTuning(stage.data?.traitCatalog, stage.countries.get(me));
  const stability = game.getStability?.(me) ?? 100;
  if (stability < Math.max(55, (rules.min_stability ?? 55) + tuning.minStabilityDelta)) return null;
  const lastWar = game.diplomacy?.lastWarDeclaredRound?.[me];
  if (lastWar != null && game.round - lastWar < Math.max(1, (rules.war_cooldown ?? 4) + tuning.cooldownDelta)) return null;
  const ownPower = countryPower(game, me).power;
  let currentEnemyPower = 0, majorEnemies = 0;
  for (const c of stage.countries.values()) {
    if (!c.eliminated && model.rel(c.id) === 'enemy') {
      const power = countryPower(game, c.id).power;
      currentEnemyPower += power;
      if (power >= 60) majorEnemies++;
    }
  }
  if (majorEnemies >= (rules.max_active_major_enemies ?? 2) + tuning.maxMajorBonus) return null;
  if (currentEnemyPower > ownPower * 0.65) return null;
  for (const candidate of ranked) {
    if (!candidate.hasBorder || !candidate.isReachable) continue;
    const border = model.mine.filter(a => a.land && a.adj.some(id => model.area(id)?.owner === candidate.country));
    const assembled = model.units.mine.filter(u => border.some(a => model.dist(u.area, a.id) <= 2))
      .reduce((sum, u) => sum + u.hp, 0);
    // The candidate is still neutral, so its troops are not in units.enemy.
    const opposing = stage.areas.filter(a => a.country === candidate.country && !a.sea &&
      border.some(b => model.dist(a.id, b.id) <= 2))
      .reduce((sum, a) => sum + (a.armies || []).reduce((hp, u) => hp + (u.hp || 0), 0), 0);
    // A diplomatic opportunity still needs troops ready on the actual frontier.
    if (!assembled || assembled < opposing) continue;
    let engagedPower = 0, opponents = 0, alliedOpponent = false;
    for (const c of stage.countries.values()) {
      if (c.eliminated || c.id === me || c.id === candidate.country) continue;
      if (getDiplomaticRelation(game, c.id, candidate.country) !== DIPLOMACY_STATE.WAR) continue;
      const power = countryPower(game, c.id).power;
      if (power <= 0) continue;
      opponents++;
      engagedPower += power;
      alliedOpponent ||= areDiplomaticAllies(game, me, c.id);
    }
    const industrialThreat = candidate.threatEval.details.industrialPotential >= 20;
    if (!alliedOpponent && !(opponents >= 2 && industrialThreat)) continue;
    if (ownPower < candidate.tPower * 0.85) continue;
    const extraEnemies = warCascade(game, me, candidate.country)
      .filter(id => id !== candidate.country && model.rel(id) !== 'enemy')
      .reduce((sum, id) => sum + countryPower(game, id).power, 0);
    const distraction = Math.min(candidate.tPower * 0.6, engagedPower * 0.5);
    if (ownPower + distraction < candidate.tPower + extraEnemies * 0.5) continue;
    if (stability - declareWarStabilityCost(game, me, candidate.country) < 35) continue;
    return { ...candidate, alliedOpponent };
  }
  return null;
}

/**
  * 战役长期宣战序列规划 (War Sequence Planning / Campaign Phasing):
  * 避免"全面开战"，规划"先对A国宣战 -> 媾和或灭亡后对B国宣战"的有序步骤，
  * 避免同时对多个强敌开战，并在陷入双线作战时协同外交部门启动预防性媾和。
  *
  * @param {Object} model - 战场模型
  * @param {Array<Object>} fronts - 战线分析结果
  * @param {Object} [doctrine] - 学说配置
  * @returns {Object} 宣战序列规划结果
  */
export function planWarSequence(model, fronts = [], doctrine = {}) {
  if (!model) {
    return {
      primaryEnemy: null,
      secondaryEnemies: [],
      multiFrontCrisis: false,
      recommendedPeaceTarget: null,
      warSequence: [],
      rankedTargets: [],
      allowNewWarDeclaration: false,
      primaryTargetToDeclare: null,
    };
  }

  const game = model.game;
  const me = model.me;
  const stage = model.st;

  // 1. 获取当前所有交战国
  const warEnemies = [];
  for (const c of stage.countries.values()) {
    if (!c || c.id === me || c.eliminated) continue;
    if (getDiplomaticRelation(game, me, c.id) === DIPLOMACY_STATE.WAR) {
      warEnemies.push(c.id);
    }
  }

  // 2. 识别主攻强敌 (Primary Enemy) 与次要交战国 (Secondary Enemies)
  let primaryEnemy = null;
  const secondaryEnemies = [];
  const majorEnemies = [];

  const myPower = countryPower(game, me).power;
  let totalEnemyPower = 0;

  for (const eid of warEnemies) {
    const ep = countryPower(game, eid).power;
    totalEnemyPower += ep;
    const eLands = stage.areas.filter(a => a.country === eid && !a.sea);
    const isMajor = ep >= 60 || eLands.length >= 4;
    if (isMajor) {
      majorEnemies.push({ id: eid, power: ep, lands: eLands.length });
    }
  }

  // 结合战线找出面对主力方向的敌人
  if (fronts.length > 0 && fronts[0]?.facingCountries?.length > 0) {
    primaryEnemy = fronts[0].facingCountries[0];
  } else if (majorEnemies.length > 0) {
    majorEnemies.sort((a, b) => b.power - a.power);
    primaryEnemy = majorEnemies[0].id;
  } else if (warEnemies.length > 0) {
    primaryEnemy = warEnemies[0];
  }

  for (const eid of warEnemies) {
    if (eid !== primaryEnemy) {
      secondaryEnemies.push(eid);
    }
  }

  // 3. 检查多线作战危机 (Multi-Front War Crisis)
  // 如果同时面对2个及以上强敌，且我方战力比紧张 (myPower < totalEnemyPower * 0.95 或有多条防守前线)
  const isPowerInferior = myPower < totalEnemyPower * 0.95;
  const hasDefensiveFronts = fronts.filter(f => f.posture === 'defend').length >= 2;
  const multiFrontCrisis = majorEnemies.length >= 2 && (isPowerInferior || hasDefensiveFronts);

  let recommendedPeaceTarget = null;
  if (multiFrontCrisis && secondaryEnemies.length > 0) {
    // 推荐向次要战线的强敌求和，以便集中兵力突破主要方向
    const sortedSec = [...secondaryEnemies].sort((a, b) => {
      const pa = countryPower(game, a).power;
      const pb = countryPower(game, b).power;
      return pb - pa;
    });
    recommendedPeaceTarget = sortedSec[0];
  }

  // 4. 规划宣战序列
  const rankedTargets = rankDeclareWarTargets(game, model, me);
  const warSequence = rankedTargets.map(t => t.country);

  // 5. 宣战节律控制 (避免同时与多个强敌作战)
  // 规则：若当前已有主要强敌在打且尚未压制，不允许开辟新的强敌战场！
  let allowNewWarDeclaration = false;
  let primaryTargetToDeclare = null;

  if (rankedTargets.length > 0) {
    const topCandidate = rankedTargets[0];
    const topId = topCandidate.country;
    const topThreat = topCandidate.threatEval;

    if (warEnemies.length === 0) {
      if (topThreat?.recommendation !== 'delay_avoid') {
        allowNewWarDeclaration = true;
        primaryTargetToDeclare = topId;
      }
    } else if (!multiFrontCrisis && majorEnemies.length < 2) {
      // 当前只有1个主要敌人，且主战场占据绝对优势 (R >= 1.5) 或候选目标为易灭亡的脆弱小国(Tier A/S, tPower < 35)
      const primaryFrontR = fronts[0]?.R || 1.0;
      const isQuickHarvestTarget = ['S', 'A'].includes(topCandidate.priorityTier) && topCandidate.tPower < myPower * 0.65;
      const isSuperDominant = primaryFrontR >= 1.15 && topCandidate.priorityTier === 'S' && topThreat.alliesCost <= 25;

      if ((isQuickHarvestTarget || isSuperDominant) && topThreat?.recommendation !== 'delay_avoid') {
        allowNewWarDeclaration = true;
        primaryTargetToDeclare = topId;
      }
    }
  }

  return {
    primaryEnemy,
    secondaryEnemies,
    multiFrontCrisis,
    recommendedPeaceTarget,
    warSequence,
    rankedTargets,
    allowNewWarDeclaration,
    primaryTargetToDeclare,
  };
}

/**
 * Decides diplomatic commands for the General Staff.
 * Incorporates dynamic preventive peace and coordinated strategic war declaration sequencing.
 *
 * @param {object} model - Battlefield information model from buildModel
 * @param {object} staffState - Staff state containing fronts, reports, doctrine, warSequence
 * @returns {Array<object>} Array of diplomatic commands
 */
export function decideDiplomacy(model, staffState = {}) {
  const game = model.game;
  if (!game?.diplomacy?.enabled) return [];

  const me = model.me;
  const stage = model.st;
  const myInfo = stage?.countries?.get(me);
  if (!myInfo || myInfo.eliminated) return [];

  const commands = [];
  const catalog = stage?.data?.traitCatalog;
  const tuning = peaceTuning(catalog, myInfo);

  // -------------------------------------------------------------
  // 1. Process pending inbound diplomatic decisions (e.g. from player or script)
  // -------------------------------------------------------------
  const pendingEvents = game.scenarioEvents?.pending || [];
  for (const ev of pendingEvents) {
    if (!ev?.choices || ev.choices.length === 0) continue;
    const parts = (ev.id || '').split('_');
    if (parts[0] === 'offer' && parts.length >= 4) {
      const action = parts[1];
      const proposer = parts[2];
      const target = parts[3];
      if (target === me) {
        if (action === 'peace') {
          const decision = evaluatePeaceAcceptance(game, proposer, me);
          const choiceId = decision.accept ? 'accept' : 'reject';
          commands.push({
            type: 'resolveEventDecision',
            eventId: ev.id,
            choiceId,
          });
        }
      }
    }
  }

  // -------------------------------------------------------------
  // 2. Dynamic Peace Strategy (动态媾和与早期预防性求和)
  // -------------------------------------------------------------
  const myLands = model.mine.filter(a => a.land);
  const origLands = game.diplomacy?.originalLands?.[me] ?? myLands.length;
  const currentLands = myLands.length;
  const landLostRatio = origLands > 0 ? (origLands - currentLands) / origLands : 0;
  const capitalThreat = isCapitalThreatened(model);
  const myPower = countryPower(game, me).power;

  // 协调战役长期宣战序列规划
  const warSeq = staffState?.warSequence || planWarSequence(model, staffState?.fronts, staffState?.doctrine);

  // Find all active war enemies
  const warEnemies = [];
  for (const c of stage.countries.values()) {
    if (!c || c.id === me || c.eliminated) continue;
    if (getDiplomaticRelation(game, me, c.id) === DIPLOMACY_STATE.WAR) {
      warEnemies.push(c.id);
    }
  }

  // 检查核心领土受独占/包围危机
  const capId = game.diplomacy?.capitals?.[me];
  const capArea = capId != null ? model.area(capId) : null;
  let coreEncirclementThreat = false;
  let encirclingEnemyId = null;
  if (capArea && capArea.owner === me) {
    let enemyAdjCount = 0;
    const adjs = capArea.adj || [];
    for (const nid of adjs) {
      const na = model.area(nid);
      if (na && na.owner && model.rel(na.owner) === 'enemy') {
        enemyAdjCount++;
        encirclingEnemyId = na.owner;
      }
    }
    if (adjs.length > 0 && (enemyAdjCount / adjs.length >= 0.5)) {
      coreEncirclementThreat = true;
    }
  }

  const isMultiFrontCrisis = Boolean(warSeq?.multiFrontCrisis);
  const isEarlyPreventiveCrisis = isMultiFrontCrisis || coreEncirclementThreat || capitalThreat;

  let bestPeaceOffer = null;

  for (const enemyId of warEnemies) {
    const peaceKey = relationKey(me, enemyId);
    const dirKey = `${me}_${enemyId}`;
    const lastReject = Math.max(
      game.diplomacy?.peaceCooldown?.[dirKey] || -99,
      game.diplomacy?.peaceCooldown?.[peaceKey] || -99
    );
    if ((model.round - lastReject) < DEFAULT_PEACE_REJECT_COOLDOWN_ROUNDS) {
      continue;
    }

    const enemyPower = countryPower(game, enemyId).power;
    const powerRatio = enemyPower > 0 ? (myPower / enemyPower) : 1.0;

    const situationDeteriorating = (landLostRatio >= (tuning?.lossThreshold || 0.15)) ||
      (powerRatio < (tuning?.powerRatioThreshold || 0.50)) ||
      capitalThreat;

    // 早期预防性主动求和触发：
    // 若正在遭遇2个+强敌夹击(多线危机) 或 核心领土受包围，即使失地尚未达到15%，也主动求和！
    if (!situationDeteriorating && !isEarlyPreventiveCrisis) {
      continue;
    }

    // 求和代价评估: 赔款 + 稳定度扣除价值
    const bill = computeReparations(game, me, enemyId);
    const repCost = bill.paid + bill.industry * model.wI;
    const stabCost = peaceProposalStabilityCost(catalog, myInfo);
    const stabLossValue = stabCost * STABILITY_POINT_CREDIT_VALUE;
    const totalPeaceCost = repCost + stabLossValue;

    // 继续打下去的预期损失：
    // 1. 领土预期损失
    let expectedTerritoryLossValue = 0;
    for (const a of model.mine) {
      if (!a.land) continue;
      const pL = model.pLose(a.id);
      if (pL > 0.25) {
        const hasEnemyNeighbor = (a.adj || []).some(nid => {
          const na = model.area(nid);
          return na && na.owner === enemyId;
        });
        if (hasEnemyNeighbor) {
          expectedTerritoryLossValue += pL * model.areaValue(a.id);
        }
      }
    }

    // 2. 战损消耗
    let expectedAttritionValue = 0;
    const tMap = model.threatMap ? model.threatMap() : new Map();
    for (const [aId, threat] of tMap.entries()) {
      const aObj = model.area(aId);
      if (aObj && aObj.owner === me && threat.atk > threat.def) {
        expectedAttritionValue += (threat.atk - threat.def) * 1.5;
      }
    }

    // 3. 早期危机风险增量 (Preventive Crisis Risk Premium)
    let crisisRiskBonus = 0;
    if (isMultiFrontCrisis) {
      if (warSeq?.recommendedPeaceTarget === enemyId) {
        crisisRiskBonus += 180; // 优先向建议脱离的次要对手求和
      } else {
        crisisRiskBonus += 80;
      }
    }
    if (coreEncirclementThreat) {
      crisisRiskBonus += 150;
    }

    const expectedContinuationNetLoss = expectedTerritoryLossValue + expectedAttritionValue + crisisRiskBonus;

    // 对工业强国的耗战权衡
    const enemyProfile = identifyCountryProfile(game, enemyId);
    const isIndustrialEnemy = enemyProfile?.profile?.isIndustrialPower;
    const peaceCostMultiplier = isIndustrialEnemy && !isEarlyPreventiveCrisis ? 1.35 : 1.0;

    // 早期预防性决策：如果继续打会被包围/多线击垮，主动求和以集中火力消灭另一个
    const shouldSuePeace = (expectedContinuationNetLoss > totalPeaceCost * peaceCostMultiplier) ||
      (capitalThreat && powerRatio < 0.6) ||
      (isMultiFrontCrisis && warSeq?.recommendedPeaceTarget === enemyId);

    if (shouldSuePeace) {
      const netBenefitOfPeace = expectedContinuationNetLoss - totalPeaceCost;
      if (!bestPeaceOffer || netBenefitOfPeace > bestPeaceOffer.benefit) {
        bestPeaceOffer = {
          enemyId,
          benefit: netBenefitOfPeace,
          isPreventive: isEarlyPreventiveCrisis
        };
      }
    }
  }

  if (bestPeaceOffer) {
    commands.push({
      type: 'setDiplomacy',
      first: me,
      second: bestPeaceOffer.enemyId,
      state: 'peace',
      reason: bestPeaceOffer.isPreventive ? 'ai_preventive_peace' : 'ai_propose_peace',
    });
    return commands;
  }

  // -------------------------------------------------------------
  // 3. Strategic War Declaration (宣战时机与优先级序列考量)
  // -------------------------------------------------------------

  // 若战役规划明确指示避免同时对多个强敌开战，则压制新宣战
  const freshRanked = rankDeclareWarTargets(game, model, me);
  const coalitionTarget = coalitionWarCandidate(game, model, freshRanked, capitalThreat);
  if (coalitionTarget) {
    commands.push({ type: 'setDiplomacy', first: me, second: coalitionTarget.country, state: 'war',
      reason: coalitionTarget.alliedOpponent
        ? '敌军正与盟友交战，我军战备足够，主动开辟第二战场分担压力。'
        : '邻国工业强敌已卷入多国战争，趁其兵力分散主动开辟战线。' });
    return commands;
  }
  if (warSeq && !warSeq.allowNewWarDeclaration) {
    return commands;
  }

  // 获取多维度宣战目标优先级排序 (S > A > B > C)
  const ranked = freshRanked.filter(candidate => canAffordExpansionWar(game, model, candidate.country));

  if (ranked.length === 0) return commands;

  // 选取最高顺位候选国家
  const bestCandidate = ranked[0];
  const targetId = bestCandidate.country;
  const threatEval = bestCandidate.threatEval;

  // 避战检查：若对手威胁评估建议 delay_avoid (高威胁且同盟众多)，绝不主动挑衅
  if (threatEval.recommendation === 'delay_avoid') {
    return commands;
  }

  // 稳定性与国力基础要求
  const myStability = game.getStability ? game.getStability(me) : (myInfo.stability ?? 100);
  if (myStability < 45) return commands;

  // 针对性宣战价值与同盟连锁成本核算
  const stabCost = declareWarStabilityCost(game, me, targetId);
  const stabValue = stabCost * STABILITY_POINT_CREDIT_VALUE;

  const cascade = warCascade(game, me, targetId);
  let cascadePowerPenalty = 0;
  for (const allyId of cascade) {
    const p = countryPower(game, allyId).power;
    cascadePowerPenalty += p * 0.35;
  }

  const totalWarCost = stabValue + cascadePowerPenalty;

  // 预期征服价值
  let expectedConquestValue = 0;
  const targetLands = stage.areas.filter(a => a.country === targetId && !a.sea);
  for (const a of targetLands) {
    let val = model.areaValue(a.id);
    let minDistance = 999;
    for (const myArea of model.mine) {
      if (!myArea.land) continue;
      const d = model.dist(myArea.id, a.id);
      if (d < minDistance) minDistance = d;
    }
    if (minDistance <= 2) {
      expectedConquestValue += val * (minDistance === 1 ? 0.7 : 0.4);
    }
  }

  // 门槛根据目标优先级分级：
  // 优先级S (阻挡扩张): 大幅放宽门槛 (0.75x)，接壤时优先果断拔除阻碍
  // 优先级A (脆弱易灭): 放宽门槛 (0.80x)，快速收割
  // 优先级B (经济工业强国): 门槛适度提高 (1.20x)，确保战备充分
  // 优先级C: 不主动挑起战争
  let ratioReq = WAR_DECLARATION_GAIN_COST_RATIO;
  if (bestCandidate.priorityTier === 'S') ratioReq *= 0.75;
  else if (bestCandidate.priorityTier === 'A') ratioReq *= 0.80;
  else if (bestCandidate.priorityTier === 'B') ratioReq *= 1.20;
  else if (bestCandidate.priorityTier === 'C') { if (!bestCandidate.hasBorder || myPower < bestCandidate.tPower * 1.35) return commands; ratioReq *= 1.05; }

  if (threatEval.recommendation === 'strike_early') {
    ratioReq *= 0.85; // 威胁低但会长大 -> 提前宣战先发制人
  }

  if (expectedConquestValue >= totalWarCost * ratioReq || (bestCandidate.priorityTier === 'S' && bestCandidate.hasBorder && threatEval.alliesCost <= 30)) {
    commands.push({
      type: 'setDiplomacy',
      first: me,
      second: targetId,
      state: 'war',
      reason: bestCandidate.priorityTier === 'S' ? 'ai_expansion_blocker_war'
            : bestCandidate.priorityTier === 'A' ? 'ai_quick_elimination_war'
            : 'ai_strategic_war',
      priorityTier: bestCandidate.priorityTier,
    });
  }

  return commands;
}
