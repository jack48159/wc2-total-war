import { makeOrder, validateOrder } from '../core/orders.js';
import { unitFitScore, POSTURE_TACTICAL_WEIGHTS } from './organize.js';
import { unitValue } from '../core/value.js';
import { generateOperationalOrders } from './operations.js';
import { aifcProbeStats } from './aifc.js';

// --- Named Constants with Explanations ---
import { loadStaffOverrides, STAFF_P } from './params_staff.js';

// Backward-compatible named exports sourced from centralized STAFF_P
export const DEFAULT_MAX_CANDIDATE_ORDERS = STAFF_P.maxCandidateOrders;
export const DEFAULT_RHO = STAFF_P.staffRho;
export const HYSTERESIS_DELTA_ABS = STAFF_P.hysteresisDeltaAbs;
export const HYSTERESIS_DELTA_REL = STAFF_P.hysteresisDeltaRel;
export const DEFAULT_ORDER_EXPIRES = STAFF_P.orderExpires;
export const ALLOCATE_BUDGET_MS = STAFF_P.allocateBudgetMs;

let orderSequence = 0;
function nextOrderId(model, prefix = 'ord') {
  orderSequence += 1;
  const rnd = model?.game?.round ?? model?.round ?? 1;
  const c = model?.me ?? 'ai';
  return `${prefix}_r${rnd}_${c}_${orderSequence}`;
}

/**
 * Calculates the total tactical fit bonus (in value currency units)
 * of a commander commanding their assigned units for a given order verb.
 */
export function commanderActionFit(commander, verb, model) {
  if (!commander || !commander.units || commander.units.length === 0) return 0;
  const spec = commander.mods ? { mods: commander.mods } : null;
  if (!spec) return 0;

  const weights = ['attack', 'breakthrough', 'envelop', 'counterattack'].includes(verb)
    ? POSTURE_TACTICAL_WEIGHTS.attack
    : ['defend', 'delay', 'screen'].includes(verb)
      ? POSTURE_TACTICAL_WEIGHTS.defend
      : POSTURE_TACTICAL_WEIGHTS.balanced;

  let totalFit = 0;
  for (const row of commander.units) {
    const army = row.army || row.unit || row;
    totalFit += unitFitScore(model, army, spec, weights);
  }
  return totalFit;
}

/**
 * 全局主攻战线识别 (Global Main Effort Front Identification)
 * 主攻战线 = 敌军防线最薄弱 OR 有最多可被征服地块的方向
 * 复用 model.enemyAreas、model.areaValue 与敌军防御脆弱度指标
 */
export function identifyMainEffortFront(fronts, model, options = {}) {
  if (!fronts || fronts.length === 0) return null;
  const stage = model.game?.stage;

  let bestFront = null;
  let bestScore = -Infinity;

  for (const front of fronts) {
    const enemyAreas = front.enemyAreas || [];
    if (enemyAreas.length === 0) continue;

    let totalTargetValue = 0;
    let totalEnemyDefense = 0;
    let weakAreaCount = 0;

    for (const eId of enemyAreas) {
      const eArea = stage?.st?.(eId);
      if (!eArea || eArea.country === model.me) continue;

      const val = model.areaValue?.(eId) ?? 10;
      totalTargetValue += val;

      const armies = eArea.armies || [];
      const areaDef = armies.reduce((sum, u) => sum + (model.unitValue?.(u) ?? (u.hp || 100)), 0);
      totalEnemyDefense += areaDef;

      // 敌防线薄弱点：空虚无兵或仅有一只残兵(HP/Def <= 100)
      if (armies.length === 0 || areaDef <= 100) {
        weakAreaCount++;
      }
    }

    const pMe = front.P_me || 1;
    const pEn = Math.max(1, front.P_en || totalEnemyDefense);
    const powerRatio = pMe / pEn;

    // 综合判定指标：
    // 1. 最多可被征服地块数量及战略经济价值
    const conquerableScore = totalTargetValue * 1.5 + enemyAreas.length * 40;
    // 2. 敌军防线薄弱度 (弱区越多、平均防御越低，突破阻力越小)
    const avgDefPerArea = totalEnemyDefense / Math.max(1, enemyAreas.length);
    const weaknessScore = (weakAreaCount * 80) + Math.max(0, 350 - avgDefPerArea * 0.8);
    // 3. 我方在该战线的战力优势
    const superiorityScore = Math.min(3.0, powerRatio) * 70;

    let score = conquerableScore + weaknessScore + superiorityScore;

    // 姿态与既有战略倾向协同
    if (front.plan === 'offensive' || front.posture === 'attack') {
      score += 100;
    }
    if (options.mainFrontId != null && front.id === options.mainFrontId) {
      score += 50;
    }
    // 敌方特性感知加权：
    if (front.hasIndustrialEnemy && powerRatio >= 0.95) {
      score += 75; // 优先进攻工业强国遏制其造血能力
    }
    if (front.hasNavalEnemy && front.isMaritimeExpedition) {
      score -= 100; // 避免草率跨海对决海军强国
    }
    if (front.facingProfiles?.some(p => p.profile.isWeak)) {
      score += 60; // 快速推平式微国家
    }

    if (score > bestScore) {
      bestScore = score;
      bestFront = front;
    }
  }

  return bestFront || fronts[0] || null;
}

/**
 * Builds candidate orders partitioned by strategic fronts.
 * Each front gets a balanced quota of offensive, defensive and maneuvering orders.
 */
export function generateCandidateOrders(model, fronts, options = {}) {
  const p = loadStaffOverrides();
  const maxCandidates = options.maxCandidates ?? p.maxCandidateOrders;
  const game = model.game;
  const stage = game.stage;
  const ownCountry = model.me;
  const candidates = [];

  const tmMap = typeof model.threatMap === 'function' ? model.threatMap() : null;
  const activeFronts = fronts || [];
  const quotaPerFront = Math.max(1, Math.ceil(maxCandidates / Math.max(1, activeFronts.length)));

  for (const front of activeFronts) {
    const frontCandidates = [];
    const isMainFront = options.mainFrontId != null && front.id === options.mainFrontId;
    const priorityBase = front.plan === 'offensive' ? 9 : (isMainFront ? 9 : (front.priority ?? 5));
    const riskBase = front.planSpec ? Math.max(0.2, Math.min(0.8, 1 - front.planSpec.rho * 0.35)) : (isMainFront ? 0.6 : 0.45);
    const friendlyList = front.friendlyAreas || front.areas || [];

    // 1. Attack / Breakthrough / Counterattack candidate orders
    for (const enemyAreaId of (front.enemyAreas || [])) {
      const enemyArea = stage.st(enemyAreaId);
      if (!enemyArea || enemyArea.country === ownCountry) continue;
      const baseVal = model.areaValue?.(enemyAreaId) ?? 10;
      const enemyArmies = enemyArea.armies || [];
      const enemyDefVal = enemyArmies.reduce((acc, u) => acc + (model.unitValue?.(u) ?? u.maxHp), 0);

      const fromAreas = friendlyList.filter(faId => {
        const neighbors = stage.adjE.get(faId) || [];
        return neighbors.includes(enemyAreaId);
      });
      if (fromAreas.length === 0) continue;

      const pCap = front.R ? Math.min(1, Math.max(0.1, front.R * 0.5)) : 0.5;
      const score = (baseVal * pCap) - (enemyDefVal * 0.2);

      let verb = 'attack';
      if (isMainFront && enemyArmies.length <= 1 && (enemyArea.areaType === 1 || enemyArea.construction === 'city')) {
        verb = 'breakthrough';
      }

      if (!front.plan || front.plan === 'offensive' || front.plan === 'elastic') frontCandidates.push({
        id: nextOrderId(model, verb.slice(0, 3)),
        verb,
        from: fromAreas,
        to: enemyAreaId,
        risk: riskBase,
        priority: isMainFront ? Math.max(priorityBase, 9) : priorityBase,
        expires: DEFAULT_ORDER_EXPIRES,
        frontId: front.id,
        isMainEffort: isMainFront,
        scoreVal: Math.max(1, score) * (front.planSpec?.attack ?? 1) * (isMainFront ? 1.4 : 1.0),
        depth: verb === 'breakthrough' ? 2 : undefined
      });
    }

    // 2. Defend / Delay / Screen candidate orders
    for (const faId of friendlyList) {
      const pLose = model.pLose?.(faId) ?? 0;
      const threatAtk = tmMap?.get(faId)?.atk || 0;
      const faArea = stage.st(faId);
      const isValuableFacility = faArea && (
        faArea.construction === 'industry' ||
        (faArea.construction === 'city' && (faArea.level || 0) >= 2) ||
        faArea.isCapital
      );

      // 对于工业地块或核心设施，防守评估应考虑若守军抽空后的沦陷风险 (pLoseWithout)
      const pLoseWithout = isValuableFacility ? (model.pLoseWithOccupants?.(faId, []) ?? pLose) : pLose;

      if (pLose > 0.05 || threatAtk > 0 || (isValuableFacility && pLoseWithout > 0.15)) {
        const baseVal = model.areaValue?.(faId) ?? 10;
        // 高价值工业区/首都绝不能仅因 offensive 姿态而被轻易过滤放弃防守！
        if (!isValuableFacility && front.plan === 'offensive' && pLose * baseVal < (front.planEvidence?.attackGain ?? 0)) continue;
        let verb = 'defend';
        let priority = isValuableFacility ? 7 : 6;
        if (pLose > 0.65 && (front.R || 1) < 0.4 && !isValuableFacility) {
          verb = 'delay';
          priority = 7;
        } else if (pLose < 0.25 && !isValuableFacility) {
          verb = 'screen';
          priority = 4;
        }

        const effectivePLose = Math.max(pLose, isValuableFacility ? pLoseWithout * 0.5 : 0);
        frontCandidates.push({
          id: nextOrderId(model, verb.slice(0, 3)),
          verb,
          to: faId,
          mustHold: [faId],
          risk: 0.4,
          priority,
          expires: DEFAULT_ORDER_EXPIRES,
          frontId: front.id,
          scoreVal: baseVal * Math.max(0.2, effectivePLose) * (front.planSpec?.hold ?? 1) * (isValuableFacility ? 1.5 : 1.0)
        });
      }
    }

    // Sort front candidates and keep top quota
    frontCandidates.sort((a, b) => (b.scoreVal || 0) - (a.scoreVal || 0));
    candidates.push(...frontCandidates.slice(0, quotaPerFront));
  }

  // 2.5 跨战区应急支援信号检测与支援候选指令生成
  for (const front of activeFronts) {
    const fAreas = front.friendlyAreas || front.areas || [];
    let maxPLose = 0;
    let worstArea = null;
    for (const aId of fAreas) {
      const pl = model.pLose ? (model.pLose(aId) || 0) : 0;
      if (pl > maxPLose) {
        maxPLose = pl;
        worstArea = aId;
      }
    }
    const isVulnerable = maxPLose >= (p.emergencySupportPLose ?? 0.45) || ((front.R || 1) < 0.65);
    if (isVulnerable && worstArea != null) {
      candidates.push({
        id: nextOrderId(model, 'sup'),
        verb: 'screen',
        to: worstArea,
        from: fAreas,
        risk: 0.45,
        priority: 9,
        expires: DEFAULT_ORDER_EXPIRES,
        frontId: front.id,
        isCrossTheaterSupport: true,
        crisisAreaId: worstArea,
        scoreVal: 100 + maxPLose * 60
      });
    }
  }

  // 3. Advanced Operational Candidates (breakthrough, counterattack, envelop, support, reserve concentrate)
  const opCandidates = generateOperationalOrders(model, activeFronts, options);
  candidates.push(...opCandidates.filter(c => {
    if (c.isAifc) return true; // AIFC handles hold requirement & offensive viability internally
    const plan = activeFronts.find(f => f.id === c.frontId)?.plan;
    if (!plan) return true;
    if (plan === 'offensive' && c.verb === 'support') return false;
    if (plan === 'consolidate') return ['concentrate', 'defend', 'screen'].includes(c.verb);
    if (plan === 'defensive') return !['breakthrough', 'envelop'].includes(c.verb);
    return true;
  }));

  // 4. Special orders for maritime/expedition fronts (F3: ensure island/contactless nations move units)
  for (const front of activeFronts) {
    if (front.isMaritimeExpedition) {
      const fAreas = front.friendlyAreas || front.areas || [];
      const eAreas = front.enemyAreas || [];
      if (fAreas.length > 0) {
        candidates.push({
          id: nextOrderId(model, 'con'),
          verb: 'concentrate',
          to: fAreas[0],
          risk: 0.35,
          priority: 8,
          expires: DEFAULT_ORDER_EXPIRES,
          frontId: front.id,
          scoreVal: 50
        });
        if (fAreas.length > 1) {
          candidates.push({
            id: nextOrderId(model, 'con'),
            verb: 'concentrate',
            to: fAreas[1],
            risk: 0.35,
            priority: 7,
            expires: DEFAULT_ORDER_EXPIRES,
            frontId: front.id,
            scoreVal: 45
          });
        }
      }
      for (const eId of eAreas.slice(0, 2)) {
        candidates.push({
          id: nextOrderId(model, 'scr'),
          verb: 'screen',
          to: eId,
          risk: 0.4,
          priority: 6,
          expires: DEFAULT_ORDER_EXPIRES,
          frontId: front.id,
          scoreVal: 35
        });
      }
    }
  }

  // 5. Fallback Concentrate order for reserves or rear units with Hysteresis (F9 anti-oscillation)
  if (candidates.length < maxCandidates && activeFronts.length > 0) {
    const f0 = activeFronts[0];
    const fAreas = f0.friendlyAreas || f0.areas || [];
    if (fAreas.length > 0) {
      // Check active orders for continuous concentrate target to prevent target oscillation
      let chosenTarget = null;
      if (options.activeOrders) {
        for (const prevOrd of options.activeOrders.values()) {
          if (prevOrd.verb === 'concentrate' && prevOrd.to != null) {
            const prevTo = Array.isArray(prevOrd.to) ? prevOrd.to[0] : prevOrd.to;
            if (fAreas.includes(prevTo)) {
              chosenTarget = prevTo;
              break;
            }
          }
        }
      }
      if (chosenTarget == null) {
        // Pick deterministically stable central territory
        const sortedAreas = [...fAreas].sort((a, b) => a - b);
        chosenTarget = sortedAreas[Math.floor(sortedAreas.length / 2)];
      }

      candidates.push({
        id: nextOrderId(model, 'con'),
        verb: 'concentrate',
        to: chosenTarget,
        risk: 0.3,
        priority: 4,
        expires: DEFAULT_ORDER_EXPIRES,
        frontId: f0.id,
        scoreVal: 20
      });
    }
  }

  candidates.sort((a, b) => (b.scoreVal || 0) - (a.scoreVal || 0));
  return candidates.slice(0, maxCandidates);
}

function isTwoHops(origin, target, stage) {
  if (origin === target) return true;
  const adj1 = stage.adjE.get(origin);
  if (!adj1) return false;
  if (adj1.includes(target)) return true;
  for (const n of adj1) {
    const adj2 = stage.adjE.get(n);
    if (adj2 && adj2.includes(target)) return true;
  }
  return false;
}

/**
 * Builds exclusive AO including march corridors between unit positions and targets.
 */
export function buildExclusiveAo(commander, order, model, reservedAreas) {
  const stage = model.game.stage;
  const ao = new Set();
  const toList = Array.isArray(order.to) ? order.to : (order.to != null ? [order.to] : []);
  const fromList = Array.isArray(order.from) ? order.from : (order.from != null ? [order.from] : []);

  for (const id of toList) {
    if (!reservedAreas.has(id)) ao.add(id);
  }
  for (const id of fromList) {
    if (!reservedAreas.has(id)) ao.add(id);
  }
  if (Array.isArray(order.axes)) {
    for (const ax of order.axes) {
      if (!reservedAreas.has(ax)) ao.add(ax);
    }
  }
  if (Array.isArray(order.path)) {
    for (const p of order.path) {
      if (!reservedAreas.has(p)) ao.add(p);
    }
  }

  // Add unit positions that are relevant to the target and adjacent corridors
  const isBroadMovement = order.verb === 'concentrate' || order.verb === 'withdraw' || order.verb === 'screen';
  for (const row of (commander.units || [])) {
    const origin = row.area?.id ?? row.area ?? row.army?.area ?? row.unit?.area;
    if (origin == null) continue;

    const isNearTarget = isBroadMovement || toList.some(tId => isTwoHops(origin, tId, stage));
    if (isNearTarget) {
      if (!reservedAreas.has(origin)) ao.add(origin);
      for (const next of (stage.adjE.get(origin) || [])) {
        if (!reservedAreas.has(next)) {
          const nextSt = stage.st(next);
          if (nextSt && (nextSt.country === model.me || model.rel(nextSt.country) === 'ally' || nextSt.country == null)) {
            ao.add(next);
          }
        }
      }
    }
  }

  return Array.from(ao);
}

export const DEFAULT_MAX_ASSESS_PER_COMMANDER = 6;
export const DEFAULT_MAX_TOTAL_ASSESS = 40;
export const DEFAULT_MAX_LOCAL_SWAPS = 6;

/**
 * Process reports from previous turn to adapt continuous orders.
 */
export function processReports(reports, activeOrders, commanders) {
  const revisedOrders = new Map();
  const reportMap = new Map((reports || []).map(r => [r.orderId, r]));

  for (const [cmdId, order] of (activeOrders || new Map())) {
    const report = reportMap.get(order.id);
    if (!report) {
      revisedOrders.set(cmdId, order);
      continue;
    }

    if (report.status === 'achieved' || report.status === 'failed') {
      continue;
    }

    if (report.requests?.some(r => r.type === 'withdraw')) {
      continue;
    }

    // Decrement expires on each turn to prevent stalled infinite persistence
    const remainingExpires = (order.expires != null ? order.expires : DEFAULT_ORDER_EXPIRES) - 1;
    if (remainingExpires <= 0) {
      continue;
    }

    if (report.status === 'stalled') {
      if ((order._stalledTurns || 0) >= 1) {
        // Stalled for 2 consecutive turns without completion -> force release for re-bidding
        continue;
      }
      const updated = {
        ...order,
        priority: Math.max(1, order.priority - 1),
        expires: remainingExpires,
        _stalledTurns: (order._stalledTurns || 0) + 1
      };
      revisedOrders.set(cmdId, updated);
      continue;
    }

    revisedOrders.set(cmdId, {
      ...order,
      expires: remainingExpires,
      _stalledTurns: 0
    });
  }

  return revisedOrders;
}

/**
 * Main staff order allocation (Contract Net + Auction + True Hysteresis + Corridors).
 * Operates purely on deterministic workload counts without wall-clock time dependence.
 */
export function allocateOrders(model, commanders, fronts, options = {}) {
  const p = loadStaffOverrides();
  const rho = options.rho ?? p.staffRho;
  const maxCandidates = options.maxCandidates ?? p.maxCandidateOrders;
  const activeOrders = options.activeOrders ?? new Map();
  const reports = options.reports ?? [];
  const maxAssessPerCommander = options.maxAssessPerCommander ?? DEFAULT_MAX_ASSESS_PER_COMMANDER;
  const maxTotalAssess = options.maxTotalAssess ?? DEFAULT_MAX_TOTAL_ASSESS;

  // 0. 全局主攻战线识别 (Global Main Effort Identification)
  const mainEffortFront = identifyMainEffortFront(fronts, model, options);
  const mainFrontId = mainEffortFront?.id ?? options.mainFrontId;

  // 1. Process previous reports
  const continuedOrders = processReports(reports, activeOrders, commanders);

  // 2. Generate candidates
  const candidates = generateCandidateOrders(model, fronts, {
    maxCandidates,
    mainFrontId,
    mainEffortFront,
    activeOrders,
    aifcCommitments: options.aifcCommitments
  });

  // Re-assess unfinished continued orders as prioritized candidates
  for (const [cmdId, oldOrder] of continuedOrders) {
    if (oldOrder.expires >= 1) {
      candidates.unshift({
        ...oldOrder,
        id: oldOrder.id,
        isContinued: true
      });
    }
  }

  // 3. Contract Net Bidding with Deterministic Workload Budget
  const assignedOrders = [];
  const assignedCommanders = new Set();
  const assignedTargets = new Set();
  const reservedAoAreas = new Set();
  const bids = [];

  const assessCache = new Map();
  let totalAssessCount = 0;

  for (const commander of commanders) {
    if (!commander.units || commander.units.length === 0) continue;

    // Filter and score candidate orders by relevance for this specific commander
    const commanderAreaIds = new Set(
      commander.units
        .map(u => u.area?.id ?? u.area ?? u.army?.area ?? u.unit?.area)
        .filter(a => a != null)
    );

    const scoredCandidates = [];
    for (const cand of candidates) {
      // 跨战区支援特例：若候选指令是跨战区应急支援，且当前指挥官所在战区安全且有余力，允许跨战区竞标支援
      if (cand.isCrossTheaterSupport) {
        const myFront = fronts.find(f => f.id === commander.frontId);
        const myFrontSafe = !myFront || ((myFront.R || 1) >= 1.2 && (myFront.maxPLose || 0) < 0.35);
        if (!myFrontSafe) continue;
      } else if (commander.frontId != null && cand.frontId != null && cand.frontId !== commander.frontId && cand.verb !== 'concentrate') {
        continue;
      }

      const toList = Array.isArray(cand.to) ? cand.to : [cand.to];
      let distMin = Infinity;
      for (const origin of commanderAreaIds) {
        for (const tId of toList) {
          const d = model.dist ? model.dist(origin, tId) : (isTwoHops(origin, tId, model.game.stage) ? 1 : 4);
          if (d < distMin) distMin = d;
        }
      }

      // Priority ranking: continued orders first, then closeness, then priority
      let relScore = (cand.priority || 5) * 10 - distMin * 2;
      if (fronts.find(f => f.id === cand.frontId)?.plan === 'offensive'
        && ['attack', 'breakthrough', 'envelop', 'counterattack'].includes(cand.verb)) relScore += 30;
      if (cand.isContinued) relScore += 50;
      if (distMin <= 2) relScore += 30;
      if (cand.isCrossTheaterSupport) relScore += 45;
      if (cand.frontId === mainFrontId) relScore += 35;
      if (cand.isAifc) {
        relScore += 45;
        if (cand.preferredUnits && commander.units) {
          const matchCount = commander.units.filter(u => {
            const uid = u.army?.id ?? u.id;
            return cand.preferredUnits.includes(uid);
          }).length;
          relScore += matchCount * 20;
        }
      }

      scoredCandidates.push({ cand, relScore, distMin });
    }

    scoredCandidates.sort((a, b) => b.relScore - a.relScore);

    // Ensure every commander evaluates their top relevant candidate orders up to workload limit
    let cmdrAssessCount = 0;
    for (const item of scoredCandidates) {
      if (cmdrAssessCount >= maxAssessPerCommander) break;
      if (totalAssessCount >= maxTotalAssess) break;

      const cand = item.cand;
      const toList = Array.isArray(cand.to) ? cand.to : [cand.to];

      // Relevance check: must be near target unless strategic movement verb
      if (item.distMin > 2 && cand.verb !== 'withdraw' && cand.verb !== 'concentrate') {
        continue;
      }

      const targetKey = Array.isArray(cand.to) ? cand.to.join(',') : String(cand.to);
      const trialAo = buildExclusiveAo(commander, cand, model, reservedAoAreas);
      if (trialAo.length === 0) continue;

      let orderWithAo;
      try {
        orderWithAo = makeOrder({
          ...cand,
          ao: trialAo
        });
      } catch {
        continue;
      }

      const assessKey = `${commander.id}:${orderWithAo.verb}:${targetKey}:${trialAo.slice(0, 5).join(',')}`;
      let bid = assessCache.get(assessKey);
      if (!bid) {
        try {
          totalAssessCount++;
          cmdrAssessCount++;
          bid = commander.assess(orderWithAo, model);
        } catch {
          // Rule 2: Exception in individual assess isolates gracefully
          continue;
        }
        assessCache.set(assessKey, bid);
      }
      if (!bid || !bid.feasible) continue;

      const fitBonus = commanderActionFit(commander, orderWithAo.verb, model);
      const frontRho = fronts.find(f => f.id === cand.frontId)?.planSpec?.rho ?? rho;
      const netGain = (bid.pSuccess * bid.expGain) - (frontRho * bid.expLoss);
      const planSpec = fronts.find(f => f.id === cand.frontId)?.planSpec;
      const planFit = planSpec
        ? (['attack', 'breakthrough', 'envelop', 'counterattack'].includes(cand.verb) ? planSpec.attack
          : ['defend', 'delay', 'screen'].includes(cand.verb) ? planSpec.hold : planSpec.replenish)
        : 1;
      const objective = (orderWithAo.priority * netGain) + fitBonus
        + Math.max(0, netGain) * Math.max(0, planFit - 0.5)
        + (orderWithAo.isAifc ? 40 : 0);

      bids.push({
        commander,
        order: orderWithAo,
        targetKey,
        objective,
        bid,
        fitBonus,
        isContinued: cand.isContinued || false
      });
    }
  }

  bids.sort((a, b) => b.objective - a.objective);

  // 4. Greedy Assignment
  for (const bidEntry of bids) {
    const { commander, order, targetKey, objective, isContinued } = bidEntry;
    if (assignedCommanders.has(commander.id)) continue;
    if (assignedTargets.has(targetKey)) continue;

    const exclusiveAo = buildExclusiveAo(commander, order, model, reservedAoAreas);
    if (exclusiveAo.length === 0) continue;

    const toArr = Array.isArray(order.to) ? order.to : [order.to];
    const targetInAo = toArr.some(t => exclusiveAo.includes(t));
    if (!targetInAo && order.verb !== 'withdraw' && order.verb !== 'concentrate') continue;

    let finalOrder;
    try {
      finalOrder = makeOrder({
        ...order,
        ao: exclusiveAo
      });
    } catch {
      continue;
    }

    // True Hysteresis check against previously active order
    const oldOrder = continuedOrders.get(commander.id);
    if (oldOrder && !isContinued) {
      const oldObj = oldOrder.assignedObjective ?? 0;
      const requiredDelta = Math.max(HYSTERESIS_DELTA_ABS, Math.abs(oldObj) * HYSTERESIS_DELTA_REL);
      if (objective < oldObj + requiredDelta) {
        // Keep old order
        finalOrder.id = oldOrder.id;
        finalOrder.verb = oldOrder.verb;
        finalOrder.to = oldOrder.to;
        finalOrder.from = oldOrder.from;
        finalOrder.mustHold = oldOrder.mustHold;
        finalOrder.priority = oldOrder.priority;
        finalOrder.expires = Math.max(1, (oldOrder.expires ?? DEFAULT_ORDER_EXPIRES) - 1);
      }
    }

    finalOrder.assignedObjective = objective;
    finalOrder.previousObjective = objective;

    // 主攻方向集团军与指令标记 (向 produce.js / staff.js 传递信号)
    const isMainEffortOrder = (finalOrder.frontId === mainFrontId || (mainEffortFront && finalOrder.to != null && (mainEffortFront.enemyAreas || []).includes(finalOrder.to)));
    if (isMainEffortOrder) {
      finalOrder.isMainEffort = true;
      finalOrder.priorityRecruit = true;
      finalOrder.priorityCards = true;
      commander.isMainEffort = true;
      commander.priorityRecruit = true;
      commander.priorityCards = true;
    }

    assignedCommanders.add(commander.id);
    assignedTargets.add(targetKey);
    for (const aId of exclusiveAo) reservedAoAreas.add(aId);

    assignedOrders.push({
      commanderId: commander.id,
      order: finalOrder
    });

    if (finalOrder.isAifc) {
      try {
        aifcProbeStats.recordAssigned(finalOrder, model);
      } catch {}
    }
  }

  // 5. Deterministic Local Swap (step-bounded instead of wall clock)
  let swapAttempts = 0;
  if (assignedOrders.length >= 2) {
    for (let i = 0; i < assignedOrders.length - 1; i++) {
      for (let j = i + 1; j < assignedOrders.length; j++) {
        if (++swapAttempts > DEFAULT_MAX_LOCAL_SWAPS) break;
        const entryA = assignedOrders[i];
        const entryB = assignedOrders[j];
        const cmdA = commanders.find(c => c.id === entryA.commanderId);
        const cmdB = commanders.find(c => c.id === entryB.commanderId);
        if (!cmdA || !cmdB) continue;

        const currentTotal = (entryA.order.assignedObjective || 0) + (entryB.order.assignedObjective || 0);

        try {
          const swapOrderA = makeOrder({ ...entryB.order, ao: entryA.order.ao });
          const swapOrderB = makeOrder({ ...entryA.order, ao: entryB.order.ao });

          const toA = Array.isArray(swapOrderA.to) ? swapOrderA.to : [swapOrderA.to];
          const toB = Array.isArray(swapOrderB.to) ? swapOrderB.to : [swapOrderB.to];
          if (!toA.some(t => swapOrderA.ao.includes(t)) || !toB.some(t => swapOrderB.ao.includes(t))) {
            continue;
          }

          const bidA = cmdA.assess(swapOrderA, model);
          const bidB = cmdB.assess(swapOrderB, model);
          if (bidA.feasible && bidB.feasible) {
            const fitA = commanderActionFit(cmdA, swapOrderA.verb, model);
            const fitB = commanderActionFit(cmdB, swapOrderB.verb, model);
            const objA = swapOrderA.priority * (bidA.pSuccess * bidA.expGain - rho * bidA.expLoss) + fitA;
            const objB = swapOrderB.priority * (bidB.pSuccess * bidB.expGain - rho * bidB.expLoss) + fitB;

            if (objA + objB > currentTotal + HYSTERESIS_DELTA_ABS) {
              entryA.order = swapOrderA;
              entryA.order.assignedObjective = objA;
              entryB.order = swapOrderB;
              entryB.order.assignedObjective = objB;
            }
          }
        } catch {
          // Swap failed gracefully
        }
      }
      if (swapAttempts >= DEFAULT_MAX_LOCAL_SWAPS) break;
    }
  }

  // 6. Provide Meaningful Fallback Orders for any unassigned commanders with units
  // Never freeze armies in a 1-tile hold! Provide potential-field concentrate or expanded defensive AO.
  for (const cmdr of commanders) {
    if (cmdr.units && cmdr.units.length > 0 && !assignedCommanders.has(cmdr.id)) {
      const stage = model.game.stage;
      const unitAreas = cmdr.units
        .map(u => u.area?.id ?? u.area ?? u.army?.area ?? u.unit?.area)
        .filter(a => a != null);
      if (unitAreas.length === 0) continue;

      // Select meaningful destination:
      // Priority 1: Main front contact area or nearest frontline
      // Priority 2: High value friendly area or nearest port
      let fallbackTarget = null;
      if (fronts && fronts.length > 0) {
        const f0 = fronts[0];
        fallbackTarget = (f0.friendlyAreas && f0.friendlyAreas[0]) || (f0.areas && f0.areas[0]);
      }
      if (fallbackTarget == null) {
        // Nearest friendly port or capital or highest value friendly territory
        const capitals = model.game?.diplomacy?.capitals;
        const myCap = capitals?.[model.me];
        if (myCap != null && stage.st(myCap)?.country === model.me) {
          fallbackTarget = myCap;
        } else {
          fallbackTarget = unitAreas[0];
        }
      }

      // Build expansive fallback AO so units have maneuvering and retreat space
      const fallbackAo = new Set(unitAreas);
      fallbackAo.add(fallbackTarget);
      for (const uA of unitAreas) {
        for (const n of (stage.adjE.get(uA) || [])) {
          const nSt = stage.st(n);
          if (nSt && (nSt.country === model.me || model.rel(nSt.country) === 'ally' || nSt.country == null)) {
            fallbackAo.add(n);
          }
        }
      }

      try {
        const fallbackOrder = makeOrder({
          id: nextOrderId(model, 'con'),
          verb: 'concentrate',
          to: fallbackTarget,
          risk: 0.35,
          priority: 3,
          expires: 2,
          ao: Array.from(fallbackAo)
        });
        assignedOrders.push({
          commanderId: cmdr.id,
          order: fallbackOrder
        });
        assignedCommanders.add(cmdr.id);
      } catch {
        // Fallback ignore
      }
    }
  }

  // 6. 整理全局主攻与优先级集团军信号，装饰返回结果 (向 staff.js / produce.js 传递信号)
  assignedOrders.mainFrontId = mainFrontId;
  assignedOrders.mainEffortFront = mainEffortFront;
  assignedOrders.priorityGroupIds = new Set();
  assignedOrders.priorityCommanders = new Set();

  for (const entry of assignedOrders) {
    const isMain = entry.order?.isMainEffort || entry.order?.priorityRecruit || (mainFrontId != null && entry.order?.frontId === mainFrontId);
    if (isMain) {
      if (entry.order) {
        entry.order.isMainEffort = true;
        entry.order.priorityRecruit = true;
        entry.order.priorityCards = true;
      }
      assignedOrders.priorityCommanders.add(entry.commanderId);
      const c = commanders.find(cmd => cmd.id === entry.commanderId);
      if (c) {
        c.isMainEffort = true;
        c.priorityRecruit = true;
        c.priorityCards = true;
        if (c.groupId) assignedOrders.priorityGroupIds.add(c.groupId);
      }
    }
  }

  return assignedOrders;
}
