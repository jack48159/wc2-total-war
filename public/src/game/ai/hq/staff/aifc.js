// AI Force Concentration (AIFC, Hearts of Iron IV style) for HqAi
// Implements:
// 1. Hold requirement evaluation (defend line first, surplus only for offense)
// 2. Strike group selection (best offensive/armor/mobile/experienced units)
// 3. Strategic target valuation (hubs, chokepoints, ports, cities, encirclement)
// 4. Operational path planning (A* through weak points, valid order schema)
// 5. Cross-turn commitment & state machine (gather -> strike -> exploit -> reform)

import { ARMOUR } from '../../../army_groups.js';
import { loadStaffOverrides } from './params_staff.js';
import { chokepointValue, areaValue, unitValue } from '../core/value.js';
import { evaluateEncirclement } from '../../../rules/combatModel.js';

let aifcOrderSequence = 0;
function nextAifcOrderId(model, prefix = 'aifc') {
  aifcOrderSequence += 1;
  const rnd = model?.game?.round ?? model?.round ?? 1;
  const c = model?.me ?? 'ai';
  return `${prefix}_r${rnd}_${c}_${aifcOrderSequence}`;
}

function isArmor(u) {
  const type = u.type || u.army?.type || '';
  return ARMOUR.has(type);
}

export const aifcProbeStats = {
  ordersGenerated: 0,
  ordersAssigned: 0,
  strikeGroupSizes: [],
  triggerRounds: new Set(),
  skipReasons: {
    disabled: 0,
    noSurplus: 0,
    noTargets: 0,
    noValidFromArea: 0,
    insufficientStrikeUnits: 0,
  },
  reset() {
    this.ordersGenerated = 0;
    this.ordersAssigned = 0;
    this.strikeGroupSizes = [];
    this.triggerRounds.clear();
    this.skipReasons = {
      disabled: 0,
      noSurplus: 0,
      noTargets: 0,
      noValidFromArea: 0,
      insufficientStrikeUnits: 0,
    };
  },
  recordAssigned(order, model) {
    this.ordersAssigned++;
    const count = order.preferredUnits ? order.preferredUnits.length : (order.strikeUnits ? order.strikeUnits.length : 3);
    this.strikeGroupSizes.push(count);
    const r = model?.game?.round ?? model?.round ?? 1;
    this.triggerRounds.add(r);
  },
  snapshot() {
    return {
      ordersGenerated: this.ordersGenerated,
      ordersAssigned: this.ordersAssigned,
      avgStrikeSize: this.strikeGroupSizes.length
        ? Number((this.strikeGroupSizes.reduce((a, b) => a + b, 0) / this.strikeGroupSizes.length).toFixed(2))
        : 0,
      triggerRounds: Array.from(this.triggerRounds).sort((a, b) => a - b),
      skipReasons: { ...this.skipReasons }
    };
  }
};

/**
 * 1. 守线需求评估 (Hold requirement)
 * 计算战线上各守备地块压制 pLose 到阈值以下所需的最少守军。
 * 返回该战线的守线必需单位集合 (lockedDefenders) 与可抽调富余单位列表 (surplusUnits)。
 */
export function evaluateFrontHoldRequirement(model, front, options = {}) {
  const p = loadStaffOverrides();
  const stage = model.game.stage;
  const ownCountry = model.me;
  const friendlyList = front.friendlyAreas || front.areas || [];
  const holdPLoseThreshold = p.aifcHoldPLoseThreshold ?? 0.25;

  const lockedUnitIds = new Set();
  const allFrontUnits = [];
  const frontAreaSet = new Set(friendlyList);

  for (const faId of friendlyList) {
    const area = stage.st(faId);
    if (!area || area.country !== ownCountry) continue;

    const occupants = area.armies || [];
    for (const u of occupants) {
      allFrontUnits.push({ unit: u, areaId: faId });
    }

    // 若消融实验关闭守线需求，则不锁定守军
    if (!p.aifcEnableHoldRequirement) continue;

    // 检查在完全无守军时的失守概率
    const pLoseEmpty = model.pLoseWithOccupants ? model.pLoseWithOccupants(faId, []) : (model.pLose ? model.pLose(faId) : 0);
    if (pLoseEmpty <= holdPLoseThreshold) {
      // 该地块无敌军威胁或极其安全，无需锁定守军
      continue;
    }

    // 按照单位的攻坚/装甲价值从低到高排序，优先把弱单位/防守单位作为守线军锁定
    // 从而把最强的装甲与进攻精锐留给富余单位（集中军）
    const sortedForDefense = [...occupants].sort((a, b) => {
      const aArmor = isArmor(a) ? 1 : 0;
      const bArmor = isArmor(b) ? 1 : 0;
      if (aArmor !== bArmor) return aArmor - bArmor; // 装甲排在后面
      const aVal = unitValue(model, a);
      const bVal = unitValue(model, b);
      return aVal - bVal;
    });

    const holdGroup = [];
    for (const u of sortedForDefense) {
      holdGroup.push(u);
      lockedUnitIds.add(u.id);

      const currentPLose = model.pLoseWithOccupants
        ? model.pLoseWithOccupants(faId, holdGroup)
        : (model.pLose ? model.pLose(faId, holdGroup) : 0);

      if (currentPLose <= holdPLoseThreshold) {
        // 已达到守线安全标准，剩余单位可释放为富余兵力
        break;
      }
    }
  }

  // 纳入战线后方纵深预备队 (若在友好后方且距离前沿 <= aifcRearUnitSearchRadius)
  const rearDepth = p.aifcRearUnitSearchRadius ?? 2;
  if (rearDepth > 0) {
    const rearVisited = new Set(frontAreaSet);
    let queue = [...frontAreaSet];
    for (let hop = 1; hop <= rearDepth && queue.length > 0; hop++) {
      const nextQueue = [];
      for (const currId of queue) {
        for (const nId of (stage.adjE.get(currId) || [])) {
          if (rearVisited.has(nId)) continue;
          rearVisited.add(nId);
          const st = stage.st(nId);
          if (!st || st.country !== ownCountry || st.sea) continue;
          // 若后方地块有驻军且未直接接敌，作为天然预备队富余兵力
          const occupants = st.armies || [];
          for (const u of occupants) {
            allFrontUnits.push({ unit: u, areaId: nId, isRearReserve: true });
          }
          nextQueue.push(nId);
        }
      }
      queue = nextQueue;
    }
  }

  const surplusUnits = allFrontUnits.filter(item => !lockedUnitIds.has(item.unit.id));

  return {
    totalUnits: allFrontUnits,
    lockedUnitIds,
    surplusUnits,
    canConcentrate: surplusUnits.length >= (p.aifcMinStrikeGroupUnits ?? 2)
  };
}

/**
 * 2. 集中军选兵评分 (Strike group selection)
 * 对战线富余单位进行精锐战斗力打分，选出最适合突破与快速穿插的师。
 */
export function scoreUnitForStrikeGroup(model, unitItem, stagingAreaId) {
  const p = loadStaffOverrides();
  const u = unitItem.unit || unitItem;
  const areaId = unitItem.areaId ?? u.area;
  const stage = model.game.stage;
  const def = stage.armyDef ? stage.armyDef(u.country || model.me, u) : {};

  // 1. 基础攻击属性
  const attackPower = def.attack ?? def.cost?.attack ?? 2;
  // 2. 装甲与突破
  const armorBonus = isArmor(u) ? 1.0 : 0.0;
  // 3. 当前 HP 比例
  const maxHp = u.maxHp || def.hp || 100;
  const hpRatio = maxHp > 0 ? Math.min(1.0, Math.max(0.1, (u.hp ?? maxHp) / maxHp)) : 0.8;
  // 4. 等级与经验
  const level = Math.max(0, Math.min(4, u.level || 0));
  // 5. 机动速度
  const movement = u.movement ?? def.movement ?? 1;
  // 6. 到战线集结点距离
  const dist = (model.dist && stagingAreaId != null) ? model.dist(areaId, stagingAreaId) : 0;

  const score =
    (attackPower * (p.aifcWeightAttack ?? 1.2)) +
    (armorBonus * 10 * (p.aifcWeightArmor ?? 1.5)) +
    (hpRatio * 10 * (p.aifcWeightHp ?? 1.0)) +
    (level * 3 * (p.aifcWeightLevel ?? 0.8)) +
    (movement * 2 * (p.aifcWeightMobility ?? 0.8)) -
    (dist * (p.aifcWeightDistance ?? 0.5));

  return score;
}

/**
 * 3. 目标战略价值评估 (Strategic target valuation)
 * 沿着邻接 BFS 评估在战线纵深内的敌方关键据点（补给枢纽、城市、工业、港口、首都、合围点）。
 */
export function evaluateStrategicTargets(model, front, options = {}) {
  const p = loadStaffOverrides();
  const stage = model.game.stage;
  const ownCountry = model.me;
  const searchRadius = p.aifcSearchRadius ?? 4;
  const friendlyList = front.friendlyAreas || front.areas || [];

  // 若消融实验关闭目标评估，直接退化为取 enemyAreas[0]
  if (!p.aifcEnableTargetValuation) {
    const fallbackTarget = front.enemyAreas?.[0];
    if (fallbackTarget == null) return [];
    return [{
      targetId: fallbackTarget,
      score: 50,
      fromAreas: friendlyList.filter(fa => (stage.adjE.get(fa) || []).includes(fallbackTarget)),
      details: { fallback: true }
    }];
  }

  // 从战线敌方前沿出发，在深度限制内搜索敌方地块
  const candidatesMap = new Map(); // targetId -> { depth, fromFriendly }
  const visited = new Set();
  const queue = [];

  for (const eaId of (front.enemyAreas || [])) {
    const area = stage.st(eaId);
    if (!area || area.sea || area.country === ownCountry) continue;
    visited.add(eaId);
    queue.push({ id: eaId, depth: 1 });
    candidatesMap.set(eaId, { depth: 1 });
  }

  while (queue.length > 0) {
    const { id, depth } = queue.shift();
    if (depth >= searchRadius) continue;

    for (const nId of (stage.adjE.get(id) || [])) {
      if (visited.has(nId)) continue;
      visited.add(nId);
      const st = stage.st(nId);
      if (!st || st.sea || st.country === ownCountry) continue;
      // 必须是敌方或者可以交战的地块
      if (model.rel(st.country) === 'enemy') {
        candidatesMap.set(nId, { depth: depth + 1 });
        queue.push({ id: nId, depth: depth + 1 });
      }
    }
  }

  const scoredTargets = [];

  for (const [targetId, info] of candidatesMap.entries()) {
    const area = stage.st(targetId);
    if (!area) continue;

    let targetScore = 0;

    // (1) 基础经济与领地价值
    const baseVal = areaValue(model, targetId);
    targetScore += baseVal * 0.5;

    // (2) 城市等级与工业枢纽
    const cityLevel = (area.areaType === 1 || area.construction === 'city') ? Math.max(1, area.level || 1) : 0;
    const indLevel = (area.areaType === 1 || area.construction === 'industry') ? Math.max(1, area.level || 1) : 0;
    targetScore += cityLevel * 15 * (p.aifcValWeightCity ?? 2.0);
    targetScore += indLevel * 20 * (p.aifcValWeightIndustry ?? 2.5);

    // (3) 首都特权价值
    if (area.isCapital || area.areaType === 1) {
      targetScore += 80 * (p.aifcValWeightCapital ?? 5.0);
    }

    // (4) 补给枢纽与交通咽喉断点价值
    const choke = chokepointValue(model, targetId);
    targetScore += choke * (p.aifcValWeightChokepoint ?? 1.8);

    // (5) 港口/机场设施
    if (area.construction === 'airport' || area.installation === 'airport' || area.isPort) {
      targetScore += 35;
    }

    // (6) 包围与切断潜力
    const encircleResult = evaluateEncirclement(stage, targetId);
    if (encircleResult && encircleResult.level > 0) {
      // 敌方已处在被包围或半包围状态，宜集中猛攻歼灭
      targetScore += (encircleResult.level * 25) * (p.aifcValWeightEncircle ?? 2.2);
    }

    // (7) 守军防御阻力与易攻程度 (pLoseBonus)
    const defenders = area.armies || [];
    const totalDefPower = defenders.reduce((s, u) => s + (unitValue(model, u) || (u.hp || 100)), 0);
    targetScore -= Math.min(60, totalDefPower * 0.15) * (p.aifcValWeightDefensePenalty ?? 0.8);

    // 薄弱防线优先突穿
    if (defenders.length <= 1 || defenders.reduce((s, u) => s + (u.hp || 0), 0) < 120) {
      targetScore += 40 * (p.aifcValWeightPLoseBonus ?? 1.5);
    }

    // (8) 距离折减：越深的目标需要越多的推进回合
    targetScore /= (1 + (info.depth - 1) * 0.3);

    // 寻找最佳起步前沿地块
    const fromAreas = friendlyList.filter(fa => {
      const dist = model.dist ? model.dist(fa, targetId) : 999;
      return dist <= info.depth + 1;
    });

    scoredTargets.push({
      targetId,
      score: targetScore,
      depth: info.depth,
      fromAreas: fromAreas.length > 0 ? fromAreas : friendlyList,
      details: {
        cityLevel,
        indLevel,
        isCapital: !!area.isCapital,
        choke,
        defPower: totalDefPower
      }
    });
  }

  scoredTargets.sort((a, b) => b.score - a.score);
  return scoredTargets;
}

/**
 * 4. 路径规划 (Operational path planning)
 * 使用启发式寻路规划从集结前沿到战略目标的攻击路径。
 * 路径满足：首尾严格匹配 from/to，各步相邻，长度 <= 40，无非法/海域地块。
 */
export function planOperationalPath(model, fromId, toId, options = {}) {
  const p = loadStaffOverrides();
  const stage = model.game.stage;
  const ownCountry = model.me;

  // 消融实验关闭路径规划
  if (!p.aifcEnablePathPlanning) {
    return null;
  }

  if (fromId === toId) return [fromId];

  // A* 寻路，代价偏好：避开重兵要塞，优先走薄弱/友方通道
  const frontier = [{ id: fromId, cost: 0, priority: 0 }];
  const cameFrom = new Map();
  const costSoFar = new Map([[fromId, 0]]);

  const maxHops = Math.min(40, p.aifcMaxPathLength ?? 8);

  while (frontier.length > 0) {
    frontier.sort((a, b) => a.priority - b.priority);
    const current = frontier.shift();

    if (current.id === toId) {
      // 重建路径
      const path = [];
      let curr = toId;
      while (curr != null) {
        path.unshift(curr);
        curr = cameFrom.get(curr);
      }
      return path;
    }

    const currentCost = costSoFar.get(current.id);
    if (pathLength(cameFrom, current.id) >= maxHops) continue;

    for (const nextId of (stage.adjE.get(current.id) || [])) {
      if (!stage.enabled?.has(nextId)) continue;
      const nextArea = stage.st(nextId);
      if (!nextArea || nextArea.sea) continue;

      // 敌方单位重兵驻扎惩罚
      let stepCost = 1.0;
      if (nextArea.country && model.rel(nextArea.country) === 'enemy') {
        const defenders = nextArea.armies || [];
        const hpSum = defenders.reduce((s, u) => s + (u.hp || 0), 0);
        stepCost += Math.min(3.0, hpSum / 100);
        if (nextArea.installation === 'fort') stepCost += 1.5;
      }

      const newCost = currentCost + stepCost;
      if (!costSoFar.has(nextId) || newCost < costSoFar.get(nextId)) {
        costSoFar.set(nextId, newCost);
        const heuristic = model.dist ? model.dist(nextId, toId) : 1;
        frontier.push({
          id: nextId,
          cost: newCost,
          priority: newCost + heuristic
        });
        cameFrom.set(nextId, current.id);
      }
    }
  }

  return null;
}

function pathLength(cameFrom, id) {
  let len = 0;
  let curr = id;
  while (cameFrom.has(curr)) {
    len++;
    curr = cameFrom.get(curr);
  }
  return len;
}

/**
 * 5. 跨回合承诺与状态机判定 (Commitment & State Machine)
 * 状态流转:
 *   gather (聚拢集结) -> strike (前沿突破) -> exploit (纵深穿插) -> reform (重组)
 */
export function evaluateCommitmentAndPhase(model, front, activeCommitment, topTarget, strikeUnits) {
  const p = loadStaffOverrides();
  const stage = model.game.stage;
  const ownCountry = model.me;

  // 消融实验：若关闭承诺保持，则不复用旧承诺
  if (!p.aifcEnableCommitment || !activeCommitment) {
    return {
      phase: determineInitialPhase(model, topTarget, strikeUnits),
      targetId: topTarget?.targetId,
      path: null,
      turnsCommitted: 1,
      switched: true,
      reason: 'fresh_plan'
    };
  }

  const { targetId: prevTargetId, path: prevPath, phase: prevPhase, turnsCommitted = 1, targetScore: prevScore = 0 } = activeCommitment;
  const targetArea = stage.st(prevTargetId);

  // 1. 检查既有目标是否已达成 (已占领该地块)
  if (targetArea && targetArea.country === ownCountry) {
    return {
      phase: 'reform',
      targetId: topTarget?.targetId ?? prevTargetId,
      path: null,
      turnsCommitted: 1,
      switched: true,
      reason: 'target_achieved'
    };
  }

  // 2. 检查承诺是否已超时
  const maxCommitTurns = p.aifcCommitmentMaxTurns ?? 4;
  if (turnsCommitted >= maxCommitTurns) {
    return {
      phase: determineInitialPhase(model, topTarget, strikeUnits),
      targetId: topTarget?.targetId,
      path: null,
      turnsCommitted: 1,
      switched: true,
      reason: 'commitment_expired'
    };
  }

  // 3. 滞回判定：新目标收益是否显著压倒旧目标 (超过 hysteresisSwitchRatio)
  const switchRatio = p.aifcHysteresisSwitchRatio ?? 1.35;
  if (topTarget && topTarget.targetId !== prevTargetId && (topTarget.score > prevScore * switchRatio)) {
    return {
      phase: determineInitialPhase(model, topTarget, strikeUnits),
      targetId: topTarget.targetId,
      path: null,
      turnsCommitted: 1,
      switched: true,
      reason: 'superior_target_emerged'
    };
  }

  // 4. 保持既有承诺，根据部队当前位置推进状态机
  let nextPhase = prevPhase;
  const currentDistToTarget = model.dist ? model.dist(getCentroidArea(strikeUnits), prevTargetId) : 2;

  if (prevPhase === 'gather') {
    // 检查集中军是否已就位（距集结点或前沿跳数 <= threshold）
    const avgDist = calculateAverageDistToStaging(model, strikeUnits, prevPath ? prevPath[0] : null);
    if (avgDist <= (p.aifcGatherDistThreshold ?? 2)) {
      nextPhase = 'strike';
    }
  } else if (prevPhase === 'strike') {
    // 若第一步已突破或已攻入敌线，进入 exploit
    if (currentDistToTarget <= 1) {
      nextPhase = 'exploit';
    }
  } else if (prevPhase === 'exploit') {
    // 仍在穿插中
  }

  return {
    phase: nextPhase,
    targetId: prevTargetId,
    path: prevPath,
    turnsCommitted: turnsCommitted + 1,
    switched: false,
    reason: 'commitment_kept'
  };
}

function determineInitialPhase(model, topTarget, strikeUnits) {
  if (!topTarget || !strikeUnits || strikeUnits.length === 0) return 'reform';
  const p = loadStaffOverrides();
  const stagingArea = topTarget.fromAreas?.[0];
  const avgDist = calculateAverageDistToStaging(model, strikeUnits, stagingArea);
  if (avgDist > (p.aifcGatherDistThreshold ?? 2)) {
    return 'gather';
  }
  return 'strike';
}

function calculateAverageDistToStaging(model, strikeUnits, stagingAreaId) {
  if (!stagingAreaId || !strikeUnits || strikeUnits.length === 0) return 0;
  let totalDist = 0;
  for (const item of strikeUnits) {
    const aId = item.areaId ?? item.unit?.area ?? item.area;
    const d = model.dist ? model.dist(aId, stagingAreaId) : 1;
    totalDist += d;
  }
  return totalDist / strikeUnits.length;
}

function getCentroidArea(strikeUnits) {
  if (!strikeUnits || strikeUnits.length === 0) return null;
  return strikeUnits[0].areaId ?? strikeUnits[0].unit?.area ?? null;
}

/**
 * 6. 生成集中军指令 (generateConcentrationOrders)
 * 主入口函数：接入 operations.js
 */
export function generateConcentrationOrders(model, fronts, options = {}) {
  const p = loadStaffOverrides();
  if (!p.aifcEnabled) {
    return [];
  }

  const activeFronts = fronts || [];
  if (activeFronts.length === 0) return [];

  const mainFrontId = options.mainFrontId;
  const stage = model.game.stage;
  const ownCountry = model.me;

  // 按价值与重要性筛选出前 K 条战线 (主攻战线必须在其中)
  const topK = p.aifcTopKFronts ?? 3;
  const rankedFronts = [...activeFronts].sort((a, b) => {
    if (a.id === mainFrontId) return -1;
    if (b.id === mainFrontId) return 1;
    const aVal = (a.P_me || 1) + (a.friendlyAreas?.length || 0) * 10;
    const bVal = (b.P_me || 1) + (b.friendlyAreas?.length || 0) * 10;
    return bVal - aVal;
  }).slice(0, topK);

  const concentrationOrders = [];

  // 获取持久化的承诺字典（在 options 或 model.aifcCommitments 中维护）
  const commitments = options.aifcCommitments || model._aifcCommitments || new Map();

  for (const front of rankedFronts) {
    // 步骤 1: 评估守线需求与富余兵力
    const holdEval = evaluateFrontHoldRequirement(model, front, options);
    if (!holdEval.canConcentrate) {
      aifcProbeStats.skipReasons.noSurplus++;
      // 兵力不足，无法建立集中军，保持原位防守，不生成集中军进攻指令
      continue;
    }

    // 步骤 2: 目标价值评估
    const scoredTargets = evaluateStrategicTargets(model, front, options);
    if (scoredTargets.length === 0) {
      aifcProbeStats.skipReasons.noTargets++;
      continue;
    }
    const topTarget = scoredTargets[0];

    // 步骤 3: 确定进攻出发地块与集结前沿
    const fromAreaId = topTarget.fromAreas[0] || front.friendlyAreas?.[0];
    if (fromAreaId == null) {
      aifcProbeStats.skipReasons.noValidFromArea++;
      continue;
    }

    // 步骤 4: 集中军选兵 (从富余单位中挑选最佳精锐)
    let selectedUnits = holdEval.surplusUnits;
    if (p.aifcEnableBestUnitSelection) {
      selectedUnits = [...holdEval.surplusUnits].sort((a, b) => {
        return scoreUnitForStrikeGroup(model, b, fromAreaId) - scoreUnitForStrikeGroup(model, a, fromAreaId);
      });
    }

    const maxUnits = p.aifcMaxStrikeGroupUnits ?? 6;
    const strikeUnits = selectedUnits.slice(0, maxUnits);
    if (strikeUnits.length < (p.aifcMinStrikeGroupUnits ?? 2)) {
      aifcProbeStats.skipReasons.insufficientStrikeUnits++;
      continue;
    }

    // 步骤 5: 状态机与承诺评估
    const activeCommit = commitments.get(front.id);
    const commitEval = evaluateCommitmentAndPhase(model, front, activeCommit, topTarget, strikeUnits);

    const targetId = commitEval.targetId ?? topTarget.targetId;

    // 步骤 6: 路径规划
    let path = commitEval.path;
    if (!path || commitEval.switched) {
      path = planOperationalPath(model, fromAreaId, targetId, options);
    }

    // 更新持久化承诺
    commitments.set(front.id, {
      frontId: front.id,
      targetId,
      path,
      phase: commitEval.phase,
      turnsCommitted: commitEval.turnsCommitted,
      targetScore: topTarget.score,
      strikeUnitIds: strikeUnits.map(u => u.unit?.id ?? u.id)
    });
    if (!model._aifcCommitments) model._aifcCommitments = commitments;

    // 步骤 7: 根据状态机构造对应指令
    // gather -> concentrate 指令 (集结至跳板地块)
    // strike -> breakthrough / attack 指令 (带合法 path)
    // exploit -> breakthrough 指令 (带深入 path)
    // reform -> concentrate / screen 指令
    const isMain = front.id === mainFrontId;
    const basePriority = isMain ? 9 : 8;

    if (commitEval.phase === 'gather') {
      concentrationOrders.push({
        id: nextAifcOrderId(model, 'aifc_gth'),
        verb: 'concentrate',
        from: fromAreaId,
        to: fromAreaId,
        risk: 0.35,
        priority: basePriority,
        expires: 2,
        frontId: front.id,
        isAifc: true,
        aifcPhase: 'gather',
        preferredUnits: strikeUnits.map(u => u.unit?.id ?? u.id),
        scoreVal: topTarget.score * 1.2
      });
    } else {
      // 出击/突破/穿插阶段
      const hasValidPath = Array.isArray(path) && path.length >= 2 && path[0] === fromAreaId && path.at(-1) === targetId;
      const verb = (hasValidPath || (topTarget.details?.isCapital || topTarget.details?.indLevel > 0))
        ? 'breakthrough'
        : 'attack';

      const orderObj = {
        id: nextAifcOrderId(model, verb === 'breakthrough' ? 'aifc_brk' : 'aifc_atk'),
        verb,
        from: fromAreaId,
        to: targetId,
        risk: 0.65,
        priority: basePriority,
        expires: 3,
        frontId: front.id,
        isAifc: true,
        aifcPhase: commitEval.phase,
        preferredUnits: strikeUnits.map(u => u.unit?.id ?? u.id),
        scoreVal: topTarget.score * 1.5 + (isMain ? 40 : 0)
      };

      if (hasValidPath) {
        orderObj.path = path;
      }
      if (verb === 'breakthrough') {
        orderObj.depth = Math.min(4, path ? path.length - 1 : 2);
      }

      concentrationOrders.push(orderObj);
    }
  }

  aifcProbeStats.ordersGenerated += concentrationOrders.length;
  return concentrationOrders;
}
