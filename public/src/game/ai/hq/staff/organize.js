// Army group formation and commander appointment staff module.
// Implements HOI4-style corps organization based on tactical fit maximization.

import { handlerFor } from '../../../commands.js';
import {
  countryCommanders,
  commanderYearAvailable,
  ownsCommander,
  isHuman,
  ARMOUR,
  armyRows,
  groupForArmy,
  commanderById
} from '../../../army_groups.js';
import { playerCountryName } from '../../../describe.js';
import { unitValue } from '../core/value.js';

// --- Named Constants with Explanations ---
import { loadStaffOverrides, STAFF_P } from './params_staff.js';

// Backward-compatible named exports sourced from centralized STAFF_P
export const MAX_GROUPS_PER_COUNTRY = STAFF_P.maxGroupsPerCountry;
export const MAX_UNITS_PER_GROUP = STAFF_P.maxUnitsPerGroup;
export const REORGANIZE_FIT_RATIO_THRESHOLD = STAFF_P.reorganizeFitRatio;
export const MIN_REORGANIZE_FIT_IMPROVEMENT = STAFF_P.minReorganizeFitImprovement;
export const MAX_REORGANIZE_COMMANDS_PER_TURN = STAFF_P.maxReorganizeCommandsPerTurn;
export const GROUP_UNIT_RECRUIT_DISTANCE = STAFF_P.groupRecruitDistance;

// Posture-dependent weighting coefficients for tactical bonus evaluation
export const POSTURE_TACTICAL_WEIGHTS = {
  attack: { wA: 1.0, wD: 0.3, wC: 0.3 },
  defend: { wA: 0.3, wD: 1.0, wC: 0.5 },
  balanced: { wA: 0.5, wD: 0.6, wC: 0.5 },
  screen: { wA: 0.3, wD: 0.8, wC: 0.7 },
  delay: { wA: 0.4, wD: 0.8, wC: 0.6 },
};

const UNIT_CLASS_MAP = {
  panzer: 'armour',
  tank: 'armour',
  heavytank: 'armour',
  infantry: 'infantry',
  eliteinfantry: 'infantry',
  artillery: 'artillery',
  rocket: 'artillery',
  destroyer: 'naval',
  cruiser: 'naval',
  battleship: 'naval',
  aircraftcarrier: 'naval',
};

/**
 * Calculates the tactical fit score for a specific unit under a commander specification:
 * fit_u = unitValue(u) * (wA * Δattack + wD * Δreceived + wC * Δcounter)
 */
export function unitFitScore(model, unit, commanderSpec, weights, totalArmourCount = 0) {
  if (!commanderSpec || !commanderSpec.mods) return 0;
  const mods = commanderSpec.mods;
  const u = unit.army || unit;
  const type = UNIT_CLASS_MAP[u.type] || 'infantry';

  const massArmourBonus = (type === 'armour' && totalArmourCount >= 3) ? (mods.massArmourAttack || 0) : 0;
  const supportBonus = type !== 'armour' ? (mods.supportAttack || 0) : 0;

  const deltaAttack = (mods.attack || 0) + (mods[type + 'Attack'] || 0) + massArmourBonus + supportBonus;
  const deltaCounter = (mods.attack || 0) + (mods.counter || 0);
  const deltaReceived = (mods.defence || 0) + (mods[type + 'Defence'] || 0);

  const uVal = unitValue(model, u);
  const score = uVal * (weights.wA * deltaAttack + weights.wD * deltaReceived + weights.wC * deltaCounter);
  return score;
}

/**
 * Calculates the total fit score for a group of units under a commander:
 * fit(c, G) = Σ_{u in G} unitFitScore(u)
 */
export function groupFitScore(model, units, commanderSpec, weights) {
  if (!units || !units.length || !commanderSpec) return 0;
  const armourCount = units.filter(u => ARMOUR.has((u.army || u).type)).length;
  let total = 0;
  for (const u of units) {
    total += unitFitScore(model, u, commanderSpec, weights, armourCount);
  }
  return total;
}

export const MIN_GROUP_UNITS = 4;

/**
 * Retrieves all eligible commanders for a country:
 * Checks year availability for all, and checks ownsCommander when controlling human seats.
 */
export function availableCommandersForCountry(game, country) {
  const all = countryCommanders(country);
  return all.filter(spec => commanderYearAvailable(game, spec));
}

/**
 * Main army group organization planner.
 * Assigns one army group per active front (up to 4), matching commanders and members via fit maximization.
 * Returns groups with stable IDs, validated commands, and unassignedUnits for direct HQ.
 */
export function organizeArmyGroups(model, fronts, options = {}) {
  const game = model.game;
  const country = model.me;
  const existingGroups = (game.armyGroups || []).filter(g => g.country === country);
  const availableCommanders = availableCommandersForCountry(game, country);
  const commands = [];

  // 1. Sort active fronts by strategic priority (mainEffort first, then investmentValue)
  const sortedFronts = [...(fronts || [])].sort((a, b) => {
    if (options.mainFrontId != null) {
      if (a.id === options.mainFrontId) return -1;
      if (b.id === options.mainFrontId) return 1;
    }
    return (b.investmentValue ?? (b.V_hold + b.V_gain)) - (a.investmentValue ?? (a.V_hold + a.V_gain));
  });
  const activeFronts = sortedFronts.slice(0, MAX_GROUPS_PER_COUNTRY);
  const activeFrontAreaIds = new Set(activeFronts.flatMap(f => f.areas || f.friendlyAreas || []));

  // Match existing groups to fronts by area overlap (stable association)
  const groupToFrontMap = new Map();
  const frontToGroupMap = new Map();
  const unmatchedExistingGroups = [];

  for (const g of existingGroups) {
    const liveUnitAreas = (g.unitIds || [])
      .map(id => model.units.mine.find(u => u.id === id)?.area)
      .filter(aId => aId != null);

    let bestFront = null;
    let maxOverlap = 0;
    for (const front of activeFronts) {
      const fAreas = new Set(front.areas || front.friendlyAreas || []);
      const overlap = liveUnitAreas.filter(aId => fAreas.has(aId)).length;
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        bestFront = front;
      }
    }

    if (bestFront && !frontToGroupMap.has(bestFront.id)) {
      groupToFrontMap.set(g.id, bestFront.id);
      frontToGroupMap.set(bestFront.id, g);
    } else {
      unmatchedExistingGroups.push(g);
    }
  }

  // Dissolve existing groups: apply hysteresis. Only dissolve if entirely wiped out or far detached
  for (const g of unmatchedExistingGroups) {
    const liveUnits = (g.unitIds || []).map(id => model.units.mine.find(u => u.id === id)).filter(Boolean);
    if (liveUnits.length === 0) {
      commands.push({ type: 'dissolveArmyGroup', country, groupId: g.id });
      continue;
    }
    // Dissolution hysteresis: retain army group if it still has at least 3 units or is within reasonable range
    let minFrontDist = Infinity;
    for (const u of liveUnits) {
      for (const fA of activeFrontAreaIds) {
        const d = model.dist ? model.dist(u.area, fA) : 1;
        if (d < minFrontDist) minFrontDist = d;
      }
    }
    if (minFrontDist > 4 && liveUnits.length < 3) {
      commands.push({ type: 'dissolveArmyGroup', country, groupId: g.id });
    }
  }

  const assignedCommanderIds = new Set();
  const assignedUnitIds = new Set();
  const plannedGroups = [];

  let nextPendingIdIndex = 1;
  const existingIdSet = new Set((game.armyGroups || []).map(g => g.id));
  const getNextFreeGroupId = () => {
    let nextNum = (game.nextArmyGroupId || 1);
    while (existingIdSet.has('group_' + nextNum)) {
      nextNum++;
    }
    const candidate = 'group_' + nextNum;
    existingIdSet.add(candidate);
    return candidate;
  };

  for (const front of activeFronts) {
    const existingGroup = frontToGroupMap.get(front.id);
    const weights = POSTURE_TACTICAL_WEIGHTS[front.planSpec?.posture || front.operationalPosture || front.posture] || POSTURE_TACTICAL_WEIGHTS.balanced;

    // Identify nearby candidate units (within GROUP_UNIT_RECRUIT_DISTANCE, excluding already assigned units)
    const fAreas = front.areas || front.friendlyAreas || [];
    const frontAreaSet = new Set(fAreas);
    const candidateUnits = model.units.mine.filter(u => {
      if (assignedUnitIds.has(u.id)) return false;
      return frontAreaSet.has(u.area) || fAreas.some(aId => model.dist(u.area, aId) <= GROUP_UNIT_RECRUIT_DISTANCE);
    });

    // Front-based reorganization only manages existing groups. New group formation is handled by autoOrganize.
    if (!existingGroup) continue;

    // Find best commander
    let bestCommander = existingGroup ? availableCommanders.find(c => c.id === existingGroup.commanderId) : null;
    let bestUnits = [];
    let bestFit = -Infinity;

    for (const spec of availableCommanders) {
      if (assignedCommanderIds.has(spec.id) && spec.id !== existingGroup?.commanderId) continue;

      const initialArmour = candidateUnits.filter(u => ARMOUR.has((u.army || u).type)).length;
      const sortedCandidates = [...candidateUnits]
        .map(u => ({ unit: u, score: unitFitScore(model, u, spec, weights, initialArmour) }))
        .sort((a, b) => b.score - a.score);

      const selected = [];
      for (const item of sortedCandidates) {
        if (selected.length >= MAX_UNITS_PER_GROUP) break;
        if (item.score > 0 || selected.length < 4) {
          selected.push(item.unit);
        }
      }

      const totalFit = groupFitScore(model, selected, spec, weights);
      if (totalFit > bestFit) {
        bestFit = totalFit;
        bestCommander = spec;
        bestUnits = selected;
      }
    }

    if (bestCommander) {
      // Must satisfy minimum group units for new army groups
      if (!existingGroup && bestUnits.length < MIN_GROUP_UNITS) {
        continue;
      }

      assignedCommanderIds.add(bestCommander.id);
      for (const u of bestUnits) assignedUnitIds.add(u.id);

      // Determine stable ID
      const stableGroupId = existingGroup ? existingGroup.id : getNextFreeGroupId();

      const plannedObj = {
        id: stableGroupId,
        frontId: front.id,
        commander: bestCommander,
        units: bestUnits.map(u => ({ army: u, area: game.stage.st(u.area) })),
        fit: Math.max(0, bestFit),
        weights,
        isNew: !existingGroup
      };
      plannedGroups.push(plannedObj);

      // Generate commands
      const newUnitIds = bestUnits.map(u => u.id);
      if (existingGroup) {
        // Hysteresis check
        const oldUnits = (existingGroup.unitIds || []).map(id => model.units.mine.find(u => u.id === id)).filter(Boolean);
        const oldCommanderSpec = availableCommanders.find(c => c.id === existingGroup.commanderId);
        const oldFit = groupFitScore(model, oldUnits, oldCommanderSpec, weights);

        const groupVal = bestUnits.reduce((acc, u) => acc + unitValue(model, u), 0);
        const dynThreshold = Math.max(MIN_REORGANIZE_FIT_IMPROVEMENT, groupVal * REORGANIZE_FIT_RATIO_THRESHOLD);

        if (bestFit - oldFit >= dynThreshold && newUnitIds.length > 0) {
          // Use setArmyGroup if supported, otherwise transferUnits / appointCommander
          const setHandler = handlerFor('setArmyGroup');
          const setCmd = {
            type: 'setArmyGroup',
            country,
            groupId: existingGroup.id,
            commanderId: bestCommander.id,
            unitIds: newUnitIds
          };
          if (setHandler && setHandler.validate(game, setCmd) == null) {
            commands.push(setCmd);
          } else {
            if (existingGroup.commanderId !== bestCommander.id) {
              commands.push({
                type: 'appointCommander',
                country,
                groupId: existingGroup.id,
                commanderId: bestCommander.id
              });
            }
            if (newUnitIds.length > 0) {
              commands.push({
                type: 'transferUnits',
                country,
                unitIds: newUnitIds,
                toGroupId: existingGroup.id
              });
            }
          }
        }
      } else if (newUnitIds.length >= MIN_GROUP_UNITS) {
        // Create new army group strictly with units via setArmyGroup; never fall back to empty createArmyGroup!
        const setHandler = handlerFor('setArmyGroup');
        const setCmd = {
          type: 'setArmyGroup',
          country,
          groupId: null,
          commanderId: bestCommander.id,
          unitIds: newUnitIds
        };
        if (setHandler && setHandler.validate(game, setCmd) == null) {
          commands.push(setCmd);
        } else {
          // Revert: do not create empty group or invalid group
          assignedCommanderIds.delete(bestCommander.id);
          for (const u of bestUnits) assignedUnitIds.delete(u.id);
          plannedGroups.pop();
        }
      }
    }
  }

  // Filter commands through validate
  const validCommands = [];
  for (const cmd of commands) {
    if (validCommands.length >= MAX_REORGANIZE_COMMANDS_PER_TURN) break;
    const err = handlerFor(cmd.type)?.validate(game, cmd);
    if (err == null) {
      validCommands.push(cmd);
    }
  }

  // Auto-organize unassigned units into army groups and ensure theaters exist
  const autoCmds = autoOrganize(game, country, model);
  for (const cmd of autoCmds) {
    if (validCommands.length >= MAX_REORGANIZE_COMMANDS_PER_TURN) break;
    validCommands.push(cmd);
  }
  if (autoCmds.plannedGroups) {
    for (const g of autoCmds.plannedGroups) {
      plannedGroups.push(g);
    }
  }

  // 3. Compute unassignedUnits for direct headquarters
  const assignedAllUnitIds = new Set(plannedGroups.flatMap(g => g.units.map(u => (u.army || u).id)));
  const unassignedUnits = model.units.mine
    .filter(u => !assignedAllUnitIds.has(u.id))
    .map(u => ({ army: u, area: game.stage.st(u.area) }));

  return {
    groups: plannedGroups,
    commands: validCommands,
    unassignedUnits
  };
}

export const NAVAL = new Set(['destroyer', 'cruiser', 'battleship', 'aircraftcarrier']);
export const ARTILLERY = new Set(['artillery', 'rocket']);
export const INFANTRY = new Set(['infantry', 'eliteinfantry']);

/**
 * Simple distance helper between two areas
 */
function getAreaDistance(game, model, a1, a2) {
  if (a1 === a2) return 0;
  if (model?.dist) {
    try {
      const d = model.dist(a1, a2);
      if (typeof d === 'number' && Number.isFinite(d)) return d;
    } catch {}
  }
  if (game?.stage?.dist) {
    try {
      const d = game.stage.dist(a1, a2);
      if (typeof d === 'number' && Number.isFinite(d)) return d;
    } catch {}
  }
  return 1;
}

/**
 * 指挥官专精分类：扫描 commanderById/countryCommanders 拿到的 spec.mods 对象，
 * 找出数值最大的专精方向：
 * - 'armour': armourAttack 或 massArmourAttack 突出
 * - 'infantry': infantryAttack 突出
 * - 'artillery': artilleryAttack 突出
 * - 'naval': navalAttack 突出
 * - 'defence': defence/infantryDefence/armourDefence 等防御类 mods 突出，且无明显进攻类专精
 * - 'general': 没有明显专精或通用平衡型
 */
export function classifyCommander(spec) {
  if (!spec || !spec.mods) return 'general';
  const mods = spec.mods;
  const armourVal = Math.max(mods.armourAttack || 0, mods.massArmourAttack || 0);
  const infantryVal = mods.infantryAttack || 0;
  const artilleryVal = mods.artilleryAttack || 0;
  const navalVal = mods.navalAttack || 0;
  const defVal = Math.max(mods.defence || 0, mods.infantryDefence || 0, mods.armourDefence || 0, mods.navalDefence || 0);

  const attackMax = Math.max(armourVal, infantryVal, artilleryVal, navalVal);

  if (defVal > 0.05 && defVal > attackMax) {
    return 'defence';
  }
  if (attackMax <= 0.05) {
    return 'general';
  }
  if (armourVal === attackMax) return 'armour';
  if (navalVal === attackMax) return 'naval';
  if (artilleryVal === attackMax) return 'artillery';
  if (infantryVal === attackMax) return 'infantry';
  return 'general';
}

/**
 * 依据集团军定位与兵种主力需求，从可用指挥官中挑选最契合的将领
 */
export function pickCommanderForRole(candidates, role, options = {}) {
  if (!candidates || candidates.length === 0) return null;
  const scored = candidates.map(spec => {
    const specType = classifyCommander(spec);
    const mods = spec.mods || {};
    let score = 0;
    if (role === 'armour') {
      if (specType === 'armour') {
        score = 1000 + (mods.massArmourAttack || 0) * 100 + (mods.armourAttack || 0) * 100 + (mods.attack || 0) * 50;
      } else if (specType === 'general') {
        score = 200 + (mods.attack || 0) * 50;
      } else {
        score = 50;
      }
    } else if (role === 'naval') {
      if (specType === 'naval') {
        score = 1000 + (mods.navalAttack || 0) * 100 + (mods.attack || 0) * 50;
      } else if (specType === 'general') {
        score = 200 + (mods.attack || 0) * 50;
      } else {
        score = 50;
      }
    } else if (role === 'defence') {
      if (specType === 'defence') {
        score = 1000 + (mods.defence || 0) * 100 + (mods.counter || 0) * 50;
      } else if (specType === 'infantry') {
        score = 500 + (mods.infantryDefence || 0) * 100 + (mods.infantryAttack || 0) * 50;
      } else if (specType === 'general') {
        score = 200 + (mods.defence || 0) * 50;
      } else {
        score = 50;
      }
    } else if (role === 'infantry') {
      if (specType === 'infantry') {
        score = 1000 + (mods.infantryAttack || 0) * 100 + (mods.attack || 0) * 50;
      } else if (specType === 'defence') {
        score = 400 + (mods.defence || 0) * 50;
      } else if (specType === 'general') {
        score = 200 + (mods.attack || 0) * 50;
      } else {
        score = 50;
      }
    } else {
      if (specType === 'general') {
        score = 500 + (mods.attack || 0) * 50 + (mods.defence || 0) * 50;
      } else {
        score = 200;
      }
    }
    // 具有实际专精词条的有名将领明显优于 0 词条白板军官
    if (Object.keys(mods).length > 0) {
      score += 100;
    }
    // 集团军优先选择非元帅，给战区保留元帅人选
    if (options.preferNonMarshal && spec.marshal) {
      score -= 30;
    }
    return { spec, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.spec || null;
}

/**
 * 为战区挑选最适合的元帅：依据战区姿态考量 coordination.attack 与 coordination.defence
 */
export function pickMarshalForTheater(candidates, posture = 'attack') {
  if (!candidates || candidates.length === 0) return null;
  const scored = candidates.map(spec => {
    const coord = spec.coordination || {};
    const attackCoord = coord.attack || 0;
    const defCoord = coord.defence || 0;
    let score = 0;
    if (spec.marshal) score += 500;
    if (posture === 'defend' || posture === 'defensive') {
      score += defCoord * 2000 + attackCoord * 500;
    } else {
      score += attackCoord * 2000 + defCoord * 500;
    }
    if (Object.keys(spec.mods || {}).length > 0) score += 50;
    return { spec, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.spec || null;
}

/**
 * 自动组建集团军与战区：按真实的兵种-指挥官匹配逻辑定向编组
 */
export function autoOrganize(game, country, model = null) {
  const commands = [];
  const newlyPlannedGroups = [];
  commands.plannedGroups = newlyPlannedGroups;
  if (!game || !country) return commands;

  const allRows = armyRows(game, country);
  const unassignedCount = allRows.filter(r => r.army && r.army.hp > 0 && !groupForArmy(game, country, r.army.id)).length;
  console.log(`[HqOrganize] 国家${country} 开始编组: 总单位=${allRows.length}, 已入编=${allRows.length - unassignedCount}, 散兵=${unassignedCount}`);

  const staffParams = loadStaffOverrides ? loadStaffOverrides() : STAFF_P;
  const maxGroups = staffParams.autoOrganizeMaxGroups || STAFF_P.autoOrganizeMaxGroups || 4;
  const minUnits = staffParams.autoOrganizeMinUnits || STAFF_P.autoOrganizeMinUnits || 3;
  const clusterDist = staffParams.autoOrganizeClusterDist || STAFF_P.autoOrganizeClusterDist || 4;
  const armourClusterDist = staffParams.armourClusterDist || STAFF_P.armourClusterDist || 6;
  const navalClusterDist = staffParams.navalClusterDist || STAFF_P.navalClusterDist || 6;
  const maxClusterDist = staffParams.autoOrganizeMaxClusterDist || STAFF_P.autoOrganizeMaxClusterDist || 10;
  const distStep = staffParams.autoOrganizeDistStep || STAFF_P.autoOrganizeDistStep || 2;
  const maxUnitsPerGroup = staffParams.maxUnitsPerGroup || STAFF_P.maxUnitsPerGroup || 16;
  const minArmour = staffParams.armourGroupMinArmour || STAFF_P.armourGroupMinArmour || 3;
  const maxArmourSupport = staffParams.armourGroupMaxSupport || STAFF_P.armourGroupMaxSupport || 2;
  const minNaval = staffParams.navalGroupMinUnits || STAFF_P.navalGroupMinUnits || 2;
  const maxNavalUnits = staffParams.navalGroupMaxUnits || STAFF_P.navalGroupMaxUnits || 8;

  const existingGroups = (game.armyGroups || []).filter(g => g.country === country);
  const usedCommanderIds = new Set(existingGroups.map(g => g.commanderId).filter(Boolean));
  for (const t of (game.theatres || [])) {
    if (t.country === country && t.marshalId) usedCommanderIds.add(t.marshalId);
  }

  // 1. 获取本国未编组的所有存活作战单位
  const aliveRows = allRows.filter(r => r.army && r.army.hp > 0);
  let unassigned = aliveRows.filter(r => !groupForArmy(game, country, r.army.id));

  let currentGroupCount = existingGroups.length;
  let nextGroupIdx = game.nextArmyGroupId || 1;
  const countryName = playerCountryName(country, game.stage) || '我军';

  // 1. 编组开始日志
  const totalUnits = aliveRows.length;
  const assignedCount = totalUnits - unassigned.length;
  console.log(`[HqOrganize] ${country} 编组开始: 开始自动编组，国家=${country}，总单位=${totalUnits}, 已入编=${assignedCount}, 散兵总数=${unassigned.length}`);

  // 人类国家候选指挥官必须已购买（或免费），AI国家无需检查购买状态
  const human = isHuman(game, country);
  const getAvailableCandidates = () => {
    const all = countryCommanders(country);
    return all.filter(spec => {
      if (usedCommanderIds.has(spec.id)) return false;
      if (human && !ownsCommander(game, spec)) return false;
      if (!commanderYearAvailable(game, spec)) return false;
      return true;
    });
  };

  // 待分配指挥官的新建集团军计划项
  const pendingFormations = [];

  // --- Step 1: 优先尝试组建装甲集群 (Armour Group) ---
  // 优先级0：渐进式/自适应聚类距离（4/6 -> 8 -> 10），避免机动装甲分散时无法成军
  let unassignedArmour = unassigned.filter(r => ARMOUR.has(r.army.type));
  while (currentGroupCount + pendingFormations.length < maxGroups && unassignedArmour.length >= minArmour) {
    let bestArmourCluster = null;
    let bestSeed = null;
    let effectiveDist = armourClusterDist;

    for (let curDist = armourClusterDist; curDist <= maxClusterDist; curDist += distStep) {
      let curDistBest = null;
      let curDistSeed = null;

      for (const seed of unassignedArmour) {
        const cluster = unassignedArmour.filter(item => getAreaDistance(game, model, seed.area.id, item.area.id) <= curDist);
        if (!curDistBest || cluster.length > curDistBest.length) {
          curDistBest = cluster;
          curDistSeed = seed;
        }
        if (cluster.length >= minArmour) {
          if (!bestArmourCluster || cluster.length > bestArmourCluster.length) {
            bestArmourCluster = cluster;
            bestSeed = seed;
            effectiveDist = curDist;
          }
        }
      }

      // 获取当前聚类尝试下扫到的装甲与支援兵
      const sampleSeed = bestSeed || curDistSeed;
      const sampleTanks = (bestArmourCluster || curDistBest || []).slice(0, 6);
      const sampleTankIds = new Set(sampleTanks.map(r => r.army.id));
      let sampleSupport = [];
      if (sampleSeed) {
        sampleSupport = unassigned.filter(r => {
          if (sampleTankIds.has(r.army.id)) return false;
          if (NAVAL.has(r.army.type) || ARMOUR.has(r.army.type)) return false;
          return getAreaDistance(game, model, sampleSeed.area.id, r.area.id) <= curDist;
        }).slice(0, maxArmourSupport);
      }

      const armourIds = sampleTanks.map(r => r.army.id);
      const supportIds = sampleSupport.map(r => r.army.id);
      console.log(`[HqOrganize-Armor] 尝试距离=${curDist}: 扫到装甲[${armourIds.join(',')}], 支援步兵[${supportIds.join(',')}]`);

      if (bestArmourCluster && bestArmourCluster.length >= minArmour) {
        break; // 当前自适应距离已满足门槛
      }
    }

    if (!bestArmourCluster || bestArmourCluster.length < minArmour) {
      break;
    }

    // 装甲为主力（3-6辆坦克）
    const tanks = bestArmourCluster.slice(0, 6);
    const tankIds = new Set(tanks.map(r => r.army.id));

    // 优先级2：装甲集群搭配兵种看战场态势
    // 判断种子地块是否处于前线/高威胁区域（复用 model.pLose > 0.35 或邻接敌军判断）
    let isFrontlineThreat = false;
    if (model?.pLose && typeof model.pLose === 'function') {
      try { isFrontlineThreat = model.pLose(bestSeed.area.id) > 0.35; } catch {}
    }
    if (!isFrontlineThreat && game.stage?.adjE) {
      const neighbors = game.stage.adjE.get(bestSeed.area.id) || [];
      for (const nId of neighbors) {
        const nArea = game.stage.st(nId);
        if (nArea && nArea.country && nArea.country !== country && (nArea.armies || []).length > 0) {
          isFrontlineThreat = true;
          break;
        }
      }
    }

    // 就近搭配支援兵种（在自适应有效范围内搜索）
    const nearbySupport = unassigned.filter(r => {
      if (tankIds.has(r.army.id)) return false;
      if (NAVAL.has(r.army.type) || ARMOUR.has(r.army.type)) return false;
      return getAreaDistance(game, model, bestSeed.area.id, r.area.id) <= effectiveDist;
    });

    if (isFrontlineThreat) {
      // 前线高威胁：优先搭配步兵吸收伤害/掩护侧翼
      nearbySupport.sort((a, b) => (INFANTRY.has(b.army.type) ? 1 : 0) - (INFANTRY.has(a.army.type) ? 1 : 0));
    } else {
      // 后方/进攻出发阵地：优先搭配炮兵远程火力攻坚
      nearbySupport.sort((a, b) => (ARTILLERY.has(b.army.type) ? 1 : 0) - (ARTILLERY.has(a.army.type) ? 1 : 0));
    }
    const supportUnits = nearbySupport.slice(0, maxArmourSupport);
    const groupUnits = [...tanks, ...supportUnits];

    const chosen = pickCommanderForRole(getAvailableCandidates(), 'armour', { preferNonMarshal: true });
    if (!chosen) {
      console.log(`[HqOrganize-Armor] ✗ 聚类成功但无可用装甲指挥官，跳过创建`);
      break;
    }
    usedCommanderIds.add(chosen.id);

    const commanderDisplayName = chosen.name || chosen.id;
    const groupName = chosen.name ? `${chosen.name}装甲集群` : `${countryName}装甲集群`;
    const memberIds = groupUnits.map(r => r.army.id);
    console.log(`[HqOrganize-Armor] ✓ 规划集团军: ${groupName} [${memberIds.join(',')}], 指挥官=${commanderDisplayName}`);

    const assignedIds = new Set(memberIds);
    unassigned = unassigned.filter(r => !assignedIds.has(r.army.id));
    unassignedArmour = unassigned.filter(r => ARMOUR.has(r.army.type));

    pendingFormations.push({
      role: 'armour',
      name: groupName,
      groupUnits,
      seedAreaId: bestSeed.area.id,
      chosenCommander: chosen
    });
  }

  // --- Step 2: 组建海军舰队 (Naval Group) ---
  // 同样使用渐进式聚类，以应对大洋分散舰艇
  let unassignedNaval = unassigned.filter(r => NAVAL.has(r.army.type));
  while (currentGroupCount + pendingFormations.length < maxGroups && unassignedNaval.length >= minNaval) {
    let bestNavalCluster = null;
    let bestSeed = null;

    for (let curDist = navalClusterDist; curDist <= maxClusterDist; curDist += distStep) {
      let curDistBest = null;
      let curDistSeed = null;
      for (const seed of unassignedNaval) {
        const cluster = unassignedNaval.filter(item => getAreaDistance(game, model, seed.area.id, item.area.id) <= curDist);
        if (!curDistBest || cluster.length > curDistBest.length) {
          curDistBest = cluster;
          curDistSeed = seed;
        }
        if (cluster.length >= minNaval) {
          if (!bestNavalCluster || cluster.length > bestNavalCluster.length) {
            bestNavalCluster = cluster;
            bestSeed = seed;
          }
        }
      }

      const sampleCluster = (bestNavalCluster || curDistBest || []).slice(0, maxNavalUnits);
      const navalIds = sampleCluster.map(r => r.army.id);
      console.log(`[HqOrganize-Naval] 尝试距离=${curDist}: 扫到舰艇[${navalIds.join(',')}]`);

      if (bestNavalCluster && bestNavalCluster.length >= minNaval) break;
    }

    if (!bestNavalCluster || bestNavalCluster.length < minNaval) {
      break;
    }

    const cluster = bestNavalCluster.slice(0, maxNavalUnits);
    const chosen = pickCommanderForRole(getAvailableCandidates(), 'naval', { preferNonMarshal: true });
    if (!chosen) {
      console.log(`[HqOrganize-Naval] ✗ 聚类成功但无可用海军指挥官，跳过创建`);
      break;
    }
    usedCommanderIds.add(chosen.id);

    const commanderDisplayName = chosen.name || chosen.id;
    const groupName = chosen.name ? `${chosen.name}舰队` : `${countryName}海军舰队`;
    const memberIds = cluster.map(r => r.army.id);
    console.log(`[HqOrganize-Naval] ✓ 规划集团军: ${groupName} [${memberIds.join(',')}], 指挥官=${commanderDisplayName}`);

    const assignedIds = new Set(memberIds);
    unassigned = unassigned.filter(r => !assignedIds.has(r.army.id));
    unassignedNaval = unassigned.filter(r => NAVAL.has(r.army.type));

    pendingFormations.push({
      role: 'naval',
      name: groupName,
      groupUnits: cluster,
      seedAreaId: bestSeed.area.id,
      chosenCommander: chosen
    });
  }

  // --- Step 3: 剩余陆军组建通用/防御集团军 ---
  // 同样使用自适应渐进式聚类扩展
  let unassignedLand = unassigned.filter(r => !NAVAL.has(r.army.type));
  while (currentGroupCount + pendingFormations.length < maxGroups && unassignedLand.length >= minUnits) {
    let bestCluster = null;
    let bestSeed = null;
    let bestRemaining = null;

    for (let curDist = clusterDist; curDist <= maxClusterDist; curDist += distStep) {
      let curDistBest = null;
      let curDistSeed = null;
      let curDistRemaining = null;

      for (const seed of unassignedLand) {
        const cluster = [];
        const remaining = [];
        for (const item of unassignedLand) {
          if (cluster.length >= maxUnitsPerGroup) {
            remaining.push(item);
            continue;
          }
          const d = getAreaDistance(game, model, seed.area.id, item.area.id);
          if (d <= curDist) {
            cluster.push(item);
          } else {
            remaining.push(item);
          }
        }
        if (!curDistBest || cluster.length > curDistBest.length) {
          curDistBest = cluster;
          curDistSeed = seed;
          curDistRemaining = remaining;
        }
        if (cluster.length >= minUnits) {
          if (!bestCluster || cluster.length > bestCluster.length) {
            bestCluster = cluster;
            bestSeed = seed;
            bestRemaining = remaining;
          }
        }
      }

      const sampleCluster = bestCluster || curDistBest || [];
      const landIds = sampleCluster.map(r => r.army.id);
      console.log(`[HqOrganize-General] 尝试距离=${curDist}: 扫到陆军[${landIds.join(',')}]`);

      if (bestCluster && bestCluster.length >= minUnits) break;
    }

    if (!bestCluster || bestCluster.length < minUnits) {
      break;
    }

    let isHighThreat = false;
    if (model?.pLose && typeof model.pLose === 'function') {
      try { isHighThreat = model.pLose(bestSeed.area.id) > 0.35; } catch {}
    }
    if (!isHighThreat && game.stage?.adjE) {
      const neighbors = game.stage.adjE.get(bestSeed.area.id) || [];
      for (const nId of neighbors) {
        const nArea = game.stage.st(nId);
        if (nArea && nArea.country && nArea.country !== country && (nArea.armies || []).length > 0) {
          isHighThreat = true;
          break;
        }
      }
    }

    const role = isHighThreat ? 'defence' : 'infantry';
    const tag = role === 'defence' ? 'HqOrganize-Defense' : 'HqOrganize-General';
    const chosen = pickCommanderForRole(getAvailableCandidates(), role, { preferNonMarshal: true });
    if (!chosen) {
      console.log(`[${tag}] ✗ 聚类成功但无可用指挥官，跳过创建`);
      break;
    }
    usedCommanderIds.add(chosen.id);

    const commanderDisplayName = chosen.name || chosen.id;
    const groupName = role === 'defence' 
      ? (chosen.name ? `${chosen.name}防御军` : `${countryName}防御军`)
      : (chosen.name ? `${chosen.name}集团军` : `${countryName}第${currentGroupCount + pendingFormations.length + 1}集团军`);

    const memberIds = bestCluster.map(r => r.army.id);
    console.log(`[${tag}] ✓ 规划集团军: ${groupName} [${memberIds.join(',')}], 指挥官=${commanderDisplayName}`);

    const assignedIds = new Set(bestCluster.map(r => r.army.id));
    unassigned = unassigned.filter(r => !assignedIds.has(r.army.id));
    unassignedLand = bestRemaining;

    pendingFormations.push({
      role,
      name: groupName,
      groupUnits: bestCluster,
      seedAreaId: bestSeed.area.id,
      chosenCommander: chosen
    });
  }

  // --- 优先级1：散兵不够门槛时，优先塞进现有/新建集团军而不是放弃 ---
  if (unassigned.length > 0) {
    // 构造当前所有可接纳散兵的集团军视图（包含已有集团军和本轮新建集群）
    const recipientPool = [];

    // 1. 已有集团军
    for (const g of existingGroups) {
      const live = (g.unitIds || []).map(id => allRows.find(r => r.army.id === id)).filter(Boolean);
      const spec = commanderById(country, g.commanderId);
      const specType = classifyCommander(spec);
      recipientPool.push({
        type: 'existing',
        id: g.id,
        groupRef: g,
        units: live,
        unitIds: [...(g.unitIds || [])],
        role: specType,
      });
    }

    // 2. 本轮新建集团军
    for (const pf of pendingFormations) {
      const actualRole = (pf.chosenCommander && human) ? classifyCommander(pf.chosenCommander) : pf.role;
      recipientPool.push({
        type: 'pending',
        pendingRef: pf,
        units: pf.groupUnits,
        unitIds: pf.groupUnits.map(r => r.army.id),
        role: actualRole,
      });
    }

    const remainingUnassigned = [];
    for (const stray of unassigned) {
      const isNaval = NAVAL.has(stray.army.type);
      const isArmour = ARMOUR.has(stray.army.type);

      let bestTarget = null;
      let minDistance = Infinity;

      for (const rec of recipientPool) {
        if (rec.unitIds.length >= maxUnitsPerGroup) continue;

        // 兵种兼容性判断
        if (isNaval) {
          if (rec.role !== 'naval') continue;
        } else {
          if (rec.role === 'naval') continue;
          if (rec.role === 'armour' && !isArmour) {
            // 装甲集群非装甲支援不能超额
            const supportCount = rec.units.filter(r => !ARMOUR.has(r.army.type)).length;
            if (supportCount >= maxArmourSupport) continue;
          }
        }

        // 距离判断：散兵与目标集群任意单位的最近跳数距离
        let distToGroup = Infinity;
        for (const u of rec.units) {
          const d = getAreaDistance(game, model, stray.area.id, u.area.id);
          if (d < distToGroup) distToGroup = d;
        }

        if (distToGroup <= maxClusterDist && distToGroup < minDistance) {
          minDistance = distToGroup;
          bestTarget = rec;
        }
      }

      // 对人类玩家：若在正常距离内未匹配，放宽距离归入最近的可接纳集团军，保证尽量少散兵
      if (!bestTarget && human) {
        let minGlobalDist = Infinity;
        for (const rec of recipientPool) {
          if (rec.unitIds.length >= maxUnitsPerGroup) continue;
          if (isNaval) {
            if (rec.role !== 'naval') continue;
          } else {
            if (rec.role === 'naval') continue;
            if (rec.role === 'armour' && !isArmour) {
              const hasAlternativeLandGroup = recipientPool.some(r => r !== rec && r.role !== 'naval' && r.unitIds.length < maxUnitsPerGroup);
              if (hasAlternativeLandGroup) {
                const supportCount = rec.units.filter(r => !ARMOUR.has(r.army.type)).length;
                if (supportCount >= maxArmourSupport) continue;
              }
            }
          }
          let distToGroup = Infinity;
          for (const u of rec.units) {
            const d = getAreaDistance(game, model, stray.area.id, u.area.id);
            if (d < distToGroup) distToGroup = d;
          }
          if (distToGroup < minGlobalDist) {
            minGlobalDist = distToGroup;
            bestTarget = rec;
          }
        }
      }

      if (bestTarget) {
        bestTarget.units.push(stray);
        bestTarget.unitIds.push(stray.army.id);
        const targetName = bestTarget.pendingRef?.name || bestTarget.groupRef?.name || bestTarget.id;
        console.log(`[HqOrganize] 散兵收拢: 单位[${stray.army.id}] (${stray.army.type}) 归入 ${targetName}`);

        if (bestTarget.type === 'existing') {
          // 对已有集团军生成 transferUnits 命令追加
          commands.push({
            type: 'transferUnits',
            country,
            toGroupId: bestTarget.id,
            unitIds: [stray.army.id]
          });
        }
      } else {
        remainingUnassigned.push(stray);
      }
    }
    unassigned = remainingUnassigned;
    if (unassigned.length > 0) {
      console.log(`[HqOrganize] 散兵收拢完毕，未编组散兵: [${unassigned.map(r => r.army.id).join(',')}]`);
    } else {
      console.log(`[HqOrganize] 散兵收拢完毕，所有散兵均已入编 (未编组散兵: [])`);
    }
  }

  // --- 指挥官补充校验/备选（优先使用扫描阶段已匹配的指挥官） ---
  for (const pf of pendingFormations) {
    if (!pf.chosenCommander) {
      const candidates = getAvailableCandidates();
      const chosen = pickCommanderForRole(candidates, pf.role, { preferNonMarshal: true });
      if (chosen) {
        pf.chosenCommander = chosen;
        usedCommanderIds.add(chosen.id);
      }
    }
  }

  // 生成新建集团军 commands 与 newlyPlannedGroups
  for (const pf of pendingFormations) {
    if (!pf.chosenCommander) continue;
    const plannedGroupId = 'group_' + nextGroupIdx++;
    commands.push({
      type: 'setArmyGroup',
      country,
      groupId: null,
      commanderId: pf.chosenCommander.id,
      unitIds: pf.groupUnits.map(r => r.army.id),
      name: pf.name
    });

    newlyPlannedGroups.push({
      id: plannedGroupId,
      commander: pf.chosenCommander,
      units: pf.groupUnits.map(u => ({ army: u.army, area: game.stage.st(u.area.id) }))
    });

    currentGroupCount++;
  }

  // --- Step 4: 战区与元帅管理 ---
  const totalGroups = [...existingGroups.map(g => g.id), ...newlyPlannedGroups.map(g => g.id)];
  if (totalGroups.length > 0) {
    const myTheatres = (game.theatres || []).filter(t => t.country === country);
    let targetTheaterId = null;

    if (myTheatres.length === 0) {
      const nextTheaterIdx = game.nextTheaterId || 1;
      targetTheaterId = 'theater_' + nextTheaterIdx;
      commands.push({
        type: 'createTheater',
        country,
        name: `${countryName}第1战区`
      });

      const marshalCandidates = getAvailableCandidates().filter(s => s.marshal);
      const chosenMarshal = pickMarshalForTheater(marshalCandidates, 'attack');
      if (chosenMarshal) {
        commands.push({
          type: 'appointMarshal',
          country,
          theaterId: targetTheaterId,
          marshalId: chosenMarshal.id
        });
        usedCommanderIds.add(chosenMarshal.id);
      }
    } else {
      targetTheaterId = myTheatres[0].id;

      for (const t of myTheatres) {
        if (!t.marshalId) {
          const marshalCandidates = getAvailableCandidates().filter(s => s.marshal);
          const chosenMarshal = pickMarshalForTheater(marshalCandidates, 'attack');
          if (chosenMarshal) {
            commands.push({
              type: 'appointMarshal',
              country,
              theaterId: t.id,
              marshalId: chosenMarshal.id
            });
            usedCommanderIds.add(chosenMarshal.id);
          }
        }
      }
    }

    for (const gid of totalGroups) {
      const assigned = (game.theatres || []).some(t => t.country === country && (t.armyIds || []).includes(gid));
      if (!assigned && targetTheaterId) {
        commands.push({
          type: 'assignArmyToTheater',
          country,
          groupId: gid,
          theaterId: targetTheaterId
        });
      }
    }
  }

  // 6. 编组完成日志
  console.log(`[HqOrganize] ${country} 编组完成: 规划创建${newlyPlannedGroups.length}个集团军, 未编组散兵${unassigned.length}个`);

  return commands;
}
