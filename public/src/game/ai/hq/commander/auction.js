import { sequenceOutcome } from '../core/estimate.js';
import { loadOverrides } from '../core/params.js';
import { supportEffect } from './support.js';
import { adjustTaskValueByProfile, isOtFix8Active } from './verb_profile.js';

const { defenceWeight: DEFENCE_WEIGHT, fieldDecay: FIELD_DECAY, killWeight: KILL_WEIGHT,
  damageWeight: DAMAGE_WEIGHT, deathWeight: DEATH_WEIGHT, captureThreshold: CAPTURE_THRESHOLD,
  constructionWeight: CONSTRUCTION_WEIGHT, breakthroughDepthWeight: BREAKTHROUGH_DEPTH_WEIGHT,
  breakthroughMobilityWeight: BREAKTHROUGH_MOBILITY_WEIGHT,
  counterattackExposureWeight: COUNTERATTACK_EXPOSURE_WEIGHT,
  delayLossLimit: DELAY_LOSS_LIMIT, screenLossLimit: SCREEN_LOSS_LIMIT,
  fieldDecayMin: FIELD_DECAY_MIN, fieldDecayMax: FIELD_DECAY_MAX,
  fieldTempoStep: FIELD_TEMPO_STEP, defaultPLose: DEFAULT_P_LOSE,
  tankKillChainBonus: TANK_KILL_CHAIN_BONUS = 0.4,
  artillerySafeRiskScale: ARTILLERY_SAFE_RISK_SCALE = 0,
  artillerySafeBonus: ARTILLERY_SAFE_BONUS = 0.25,
  restPriorityBonus: REST_PRIORITY_BONUS = 200 } = loadOverrides();
const COUNTER_TYPES_FOR_ARTILLERY = new Set(['artillery', 'heavytank', 'destroyer', 'cruiser', 'battleship', 'aircraftcarrier']);
const riskWeight = (order, model) => order?.obedient ? (order.risk ?? 0.5) : (model.doctrine?.rho ?? model.doctrine?.rhoBase ?? order.risk ?? 1);
const netValue = (gain, loss, exposure, order, model) => gain - riskWeight(order, model) * (loss + exposure);
const departureCost = (task, model) => {
  if (!task.commands?.some(command => command.type === 'move')) return 0;
  const fromArea = model.game.stage.st(task.from);
  if (!fromArea) return 0;

  const occupants = fromArea.armies || [];
  const without = occupants.filter(army => army.id !== task.unit.id);
  const unit = task.unit;
  const isTank = unit?.type?.includes('tank') || unit?.type === 'panzer';
  const isAirportOnly = fromArea.construction === 'airport' && fromArea.construction !== 'industry' && fromArea.areaType !== 1;

  // 修复线索2：装甲机动部队在普通机场不应受虚假的离位高额惩罚锁死
  if (isTank && isAirportOnly) {
    return 0;
  }

  const pLoseWith = model.pLose?.(task.from) ?? 0;
  const pLoseWithout = model.pLoseWithOccupants?.(task.from, without) ?? 0;
  let threatIncrease = Math.max(0, pLoseWithout - pLoseWith);

  let cost = threatIncrease * (model.areaValue?.(task.from) ?? 0);

  // 修复线索1：前线高价值工业区/核心设施抽空防守保护（Anti-Abandonment）
  // 当离开后驻军直接变为 0，且该地块面临敌情威胁或处于战线附近时，施加弃守惩罚阻止抽成空城
  const isIndustry = fromArea.construction === 'industry';
  const isValuable = isIndustry || (fromArea.construction === 'city' && (fromArea.level || 0) >= 2) || fromArea.isCapital;
  if (without.length === 0 && isValuable) {
    const isNearFrontOrThreat = (model.threatMap?.()?.get(task.from)?.atk || 0) > 0 ||
      (model.game.stage.adjE.get(task.from) || []).some(n => {
        const nSt = model.game.stage.st(n);
        return nSt && (nSt.country && model.rel(nSt.country) === 'enemy' || model.isFront?.(n));
      });
    if (isNearFrontOrThreat) {
      // 最后一支守军不可轻易弃城出走
      cost += (model.areaValue?.(task.from) ?? 20) * 1.5;
    }
  }

  return cost;
};
export function potentialAt(model, areaId, objectives, tempo = 1) {
  const gamma = Math.min(FIELD_DECAY_MAX, Math.max(FIELD_DECAY_MIN, FIELD_DECAY + (tempo - 1) * FIELD_TEMPO_STEP));
  let potential = 0;
  for (const objective of objectives) {
    const id = typeof objective === 'number' ? objective : objective.id;
    const distance = model.dist?.(areaId, id) ?? (areaId === id ? 0 : 1);
    if (Number.isFinite(distance)) potential += (typeof objective === 'number' ? model.areaValue?.(id) ?? 1 : objective.value) * gamma ** distance;
  }
  return potential;
}
function baseTaskValue(task, order, model) {
  const unit = task.unit;
  if (task.kind === 'attack') {
    const e = task.estimate;
    const targetArea = model.game.stage.st(task.to);
    const target = model.areaValue?.(task.to) ?? targetArea?.armies?.[0]?.maxHp ?? 1;
    const enemy = model.unitValue?.(targetArea?.armies?.[0]) ?? target;
    const own = model.unitValue?.(unit) ?? unit.maxHp;
    const exploitation = order.verb === 'breakthrough' ? (model.game.stage.adjE.get(task.to) || [])
      .filter(id => model.game.stage.st(id)?.country !== model.me)
      .reduce((best, id) => Math.max(best, model.areaValue?.(id) ?? 0), 0) * e.pClear *
        BREAKTHROUGH_DEPTH_WEIGHT * Math.max(1, order.depth || 1) *
        (1 + BREAKTHROUGH_MOBILITY_WEIGHT * Math.max(0, (unit.maxMovement || unit.movement || 1) - 1)) : 0;
    const front = targetArea?.armies?.[0];
    const construction = (e.constructionDamageChance || 0) * CONSTRUCTION_WEIGHT * target;

    // 兵种优势利用1：坦克斩杀链（retainMovementOnKill）。当能斩杀目标且地块清空时，保留机动力继续行动
    const isTank = unit.type === 'tank' || unit.type === 'heavytank' ||
      !!model.game.stage.armyDef(unit.country || model.me, unit.type)?.retainMovementOnKill;
    const isSingleDefender = (targetArea?.armies?.length || 0) === 1;
    const canKill = front && (e.dmgDef >= front.hp || (e.pKillFront || 0) >= 0.5);
    const killProb = e.pClear > 0 ? e.pClear : (canKill ? 1 : 0);
    const tankKillChain = (isTank && isSingleDefender && canKill)
      ? TANK_KILL_CHAIN_BONUS * enemy * killProb
      : 0;

    // 兵种优势利用2：炮兵安全开火。当防守方无法还击时，零反击风险打击
    const isArtillery = unit.type === 'artillery' || unit.type === 'rocket';
    const canDefenderCounter = unit.type === 'artillery'
      ? (COUNTER_TYPES_FOR_ARTILLERY.has(front?.type) || targetArea?.installation === 'fort')
      : (front?.type === 'rocket');
    const isSafeArtilleryFire = isArtillery && !canDefenderCounter && !e.counter;
    const safeFireBonus = isSafeArtilleryFire
      ? ARTILLERY_SAFE_BONUS * enemy * (Math.min(e.dmgDef, front?.hp || 0) / Math.max(1, front?.hp || 1))
      : 0;

    let gain = KILL_WEIGHT * e.pKillFront * enemy + DAMAGE_WEIGHT * Math.min(e.dmgDef, front?.hp || 0) / Math.max(1, front?.hp) * enemy +
      (e.splashGain || 0) + construction + exploitation + tankKillChain + safeFireBonus;
    if (order.verb === 'support') {
      if (order.mission === 'suppress' && e.counter) return -Infinity;
      gain += supportEffect(order, model, order.primaryBid).delta *
        Math.min(1, (e.dmgDef || 0) / Math.max(1, front?.hp || 1));
    }
    const occupiable = model.game.stage.armyDef(unit.country || model.me, unit.type)?.canOccupy !== false;
    const capture = occupiable ? e.pClear : 0;
    const exposure = capture * model.pLoseAfterCapture?.(task.to, [unit]) * (target + own) || 0;
    const rawLoss = ((e.dmgAtt || 0) / Math.max(1, unit.maxHp) + DEATH_WEIGHT * (e.pAttackerDies || 0)) * own + (e.splashLoss || 0);
    const loss = isSafeArtilleryFire ? rawLoss * ARTILLERY_SAFE_RISK_SCALE : rawLoss;

    if (order.verb === 'screen' && loss > own * SCREEN_LOSS_LIMIT) return -Infinity;
    if (order.verb === 'delay' && loss > own * DELAY_LOSS_LIMIT) return -Infinity;
    const exposed = front?.movement === 0 || e.flankPct > 0;
    const counterattack = order.verb === 'counterattack' && exposed ?
      COUNTERATTACK_EXPOSURE_WEIGHT * (gain + capture * target) : 0;
    return netValue(gain + capture * target + counterattack, loss, exposure, order, model) - departureCost(task, model);
  }
  if (task.kind === 'capture') return (model.areaValue?.(task.to) ?? 1) *
    (1 - (model.pLose?.(task.to, [unit]) ?? 0)) - departureCost(task, model);
  if (task.kind === 'concentrate') {
    const baseGain = task.isSafeAdvance ? Math.max(task.potentialGain || 0, 15) : (task.potentialGain || 0);
    const depCost = (isOtFix8Active(order) && task.isEnRouteMarch && !order.mustHold?.includes(task.from))
      ? 0 : departureCost(task, model);
    if (order.verb !== 'support') {
      const net = baseGain - depCost;
      return (depCost === 0 && baseGain > 0) ? Math.max(1, net) : net;
    }
    const goal = Array.isArray(order.to) ? order.to[0] : order.to;
    const proximity = goal == null ? 0 : 1 / (1 + (model.dist?.(task.to, goal) ?? 1));
    const net = baseGain + supportEffect(order, model, order.primaryBid).delta * proximity - depCost;
    return (depCost === 0 && baseGain > 0) ? Math.max(1, net) : net;
  }
  if (task.isRestEvacuation) {
    return REST_PRIORITY_BONUS + (task.potentialGain || 0) - departureCost(task, model);
  }
  if (task.isRestHold) {
    return REST_PRIORITY_BONUS * 0.8;
  }
  if (task.kind === 'hold') {
    const fromArea = model.game.stage.st(task.from);
    const isTank = unit?.type?.includes('tank') || unit?.type === 'panzer';
    const isAirportOnly = fromArea?.construction === 'airport' && fromArea?.construction !== 'industry' && fromArea?.areaType !== 1;

    // 修复线索2：健康坦克在后方非必须驻守的机场地块，不能获得正向 hold 收益将自己锁死
    if (isTank && isAirportOnly && !order.mustHold?.includes(task.from)) {
      return 0;
    }

    const occupants = fromArea?.armies || [];
    const without = occupants.filter(army => army.id !== unit.id);
    const threatIncrease = (model.pLoseWithOccupants?.(task.from, without) ?? 0) - (model.pLose?.(task.from) ?? 0);

    // 修复线索1：工业要地与高价值城市基础卫戍驻守价值（Garrison Baseline）
    // 阻止最后一支驻军因非前线直接受攻状态而计算出 0 驻守价值，导致被微小外部机动作业抽空
    const isIndustry = fromArea?.construction === 'industry';
    const isCapitalOrMajorCity = fromArea?.isCapital || (fromArea?.construction === 'city' && (fromArea?.level || 0) >= 2);
    let baselineGarrison = 0;
    if (without.length === 0 && (isIndustry || isCapitalOrMajorCity)) {
      baselineGarrison = (model.areaValue?.(task.from) ?? 20) * 0.35;
    }

    return Math.max(baselineGarrison, threatIncrease * (model.areaValue?.(task.from) ?? 0));
  }
  if (task.kind === 'withdraw') return (task.potentialGain || 0) - departureCost(task, model);
  const target = model.areaValue?.(task.to) ?? 1;
  const before = model.pLose?.(task.to) ?? DEFAULT_P_LOSE;
  const after = model.pLose?.(task.to, task.from === task.to ? [] : [unit]) ?? before;
  return DEFENCE_WEIGHT * target * Math.max(0, before - after) - departureCost(task, model);
}

export function taskValue(task, order, model) {
  const val = baseTaskValue(task, order, model);
  if (order?.obedient) {
    return adjustTaskValueByProfile(task, val, order, model);
  }
  return val;
}

export function auctionTasks(tasks, order, model) {
  const chosen = [], used = new Set();
  const candidates = tasks.map(task => ({ ...task, value: taskValue(task, order, model) }));
  // A combined assault may clear a stack even when every individual bid is weak.
  const groups = new Map();
  for (const task of candidates.filter(t => t.kind === 'attack')) groups.set(task.to, [...(groups.get(task.to) || []), task]);
  for (const [target, group] of groups) {
    if (group.length < 2) continue;
    const bestByUnit = new Map();
    for (const task of group) if (!bestByUnit.has(task.unit.id) || task.value > bestByUnit.get(task.unit.id).value) bestByUnit.set(task.unit.id, task);
    const ordered = [...bestByUnit.values()].sort((a, b) =>
      Number(a.estimate.counter) - Number(b.estimate.counter) ||
      b.estimate.dmgDef / Math.max(1, b.estimate.dmgAtt) - a.estimate.dmgDef / Math.max(1, a.estimate.dmgAtt));
    let packageTasks = [], previousNet = 0, previousCapture = 0;
    for (const task of ordered) {
      const destination = task.commands?.[0]?.type === 'move' ? task.commands[0].to : null;
      if (destination != null) {
        const occupancy = model.game.stage.st(destination)?.armies?.length || 0;
        const reserved = packageTasks.filter(t => t.commands?.[0]?.type === 'move' && t.commands[0].to === destination).length;
        if (occupancy + reserved >= model.game.stage.maxArmies(destination)) continue;
      }
      const proposed = [...packageTasks, task];
      const outcome = sequenceOutcome(model, proposed.map(t => ({ unit: t.unit, from: t.staging })), target);
      const areaValue = model.areaValue?.(target) ?? 1;
      const occupants = proposed.filter(t => model.game.stage.armyDef(t.unit.country || model.me, t.unit.type)?.canOccupy !== false)
        .map(t => t.unit);
      const exposure = outcome.pCapture * (model.pLoseAfterCapture?.(target, occupants) || 0) *
        (areaValue + occupants.reduce((n, unit) => n + (model.unitValue?.(unit) ?? unit.maxHp ?? 0), 0));
      const splashGain = proposed.reduce((n, t) => n + (t.estimate.splashGain || 0), 0);
      const splashLoss = proposed.reduce((n, t) => n + (t.estimate.splashLoss || 0), 0);
      const net = netValue(DAMAGE_WEIGHT * outcome.expectedKillDef + outcome.pCapture * areaValue + splashGain,
        outcome.expectedLossAtt + splashLoss, exposure, order, model) -
        proposed.reduce((n, task) => n + departureCost(task, model), 0);
      if (packageTasks.length && net < previousNet) break;
      packageTasks = proposed; previousNet = net; previousCapture = outcome.pCapture;
      if (previousCapture >= CAPTURE_THRESHOLD) break;
    }
    const isLeavingTask = t => (t.commands?.some(c => c.type === 'move') || (t.kind === 'attack' && t.to !== t.from));
    const bestSingle = Math.max(0, ...group.map(t => t.value));
    if (packageTasks.length < 2 || previousNet <= bestSingle) continue;
    if (order.verb === 'envelop') {
      const axes = new Set(packageTasks.map(task => {
        const distances = (order.axes || []).map(axis => {
          if (Array.isArray(axis)) return Math.min(...axis.map(h => model.dist?.(task.from, h) ?? Infinity));
          return model.dist?.(task.from, axis) ?? Infinity;
        });
        return distances.indexOf(Math.min(...distances));
      }));
      if (axes.size < 2 && !order.obedient && (order.axes?.length || 0) >= 2) continue;
    }
    const packagePlan = { target, attackerIds: packageTasks.map(t => t.unit.id),
      expectedOutcome: sequenceOutcome(model, packageTasks.map(t => ({ unit: t.unit, from: t.staging })), target) };
    for (const task of packageTasks) if (!used.has(task.unit.id)) {
      chosen.push({ ...task, packagePlan }); used.add(task.unit.id);
    }
  }

  // 识别战区前线必须保障卫戍的高价值工业设施/首都
  const vitalGarrisonAreas = new Set();
  for (const a of (model.mine || [])) {
    const area = model.game.stage.st(a.id);
    if (!area || !area.armies?.length) continue;
    const isVital = area.construction === 'industry' || (area.construction === 'city' && (area.level || 0) >= 2) || area.isCapital;
    if (isVital) {
      const isFrontOrThreat = (model.threatMap?.()?.get(a.id)?.atk || 0) > 0 ||
        (model.game.stage.adjE.get(a.id) || []).some(n => {
          const nSt = model.game.stage.st(n);
          return nSt && (nSt.country && model.rel(nSt.country) === 'enemy' || model.isFront?.(n));
        });
      if (isFrontOrThreat) {
        vitalGarrisonAreas.add(a.id);
      }
    }
  }

  const accumulated = new Map();
  for (const task of chosen) if (task.kind === 'attack') accumulated.set(task.to, (accumulated.get(task.to) || 0) + task.estimate.dmgDef);
  while (true) {
    let best = null, bestValue = 0;
    for (const task of candidates) {
      if (used.has(task.unit.id)) continue;
      const destination = task.commands?.[0]?.type === 'move' ? task.commands[0].to : null;
      if (destination != null) {
        const capacity = model.game.stage.maxArmies(destination);
        const occupancy = model.game.stage.st(destination)?.armies?.length || 0;
        const reserved = chosen.filter(t => t.commands?.[0]?.type === 'move' && t.commands[0].to === destination).length;
        if (occupancy + reserved >= capacity) continue;
      }

      // 卫戍保障：前线工业要地最后一名驻军不可因外部机动/外向进攻而被抽成空城
      if (vitalGarrisonAreas.has(task.from) && order.verb !== 'withdraw') {
        const isObedientUnpinned = isOtFix8Active(order) && !order.mustHold?.includes(task.from);
        if (!isObedientUnpinned) {
          const originArmies = model.game.stage.st(task.from)?.armies || [];
          const leavingAlready = chosen.filter(t => t.from === task.from && (t.commands?.some(c => c.type === 'move') || (t.kind === 'attack' && t.to !== task.from))).length;
          const willLeave = task.commands?.some(c => c.type === 'move') || (task.kind === 'attack' && task.to !== task.from);
          if (willLeave && (originArmies.length - leavingAlready <= 1)) {
            continue; // 留守最后 1 名部队卫戍
          }
        }
      }

      let marginal = task.value;
      if (task.kind === 'attack') {
        const prior = accumulated.get(task.to) || 0;
        const targetArea = model.game.stage.st(task.to);
        const hp = targetArea?.armies?.reduce((n, army) => n + army.hp, 0) || 1;
        const captureDelta = Math.min(1, (prior + task.estimate.dmgDef) / hp) - Math.min(1, prior / hp);
        marginal += captureDelta * (model.areaValue?.(task.to) ?? 1);
      }
      if (marginal > bestValue) { bestValue = marginal; best = task; }
    }
    if (!best) break;
    chosen.push(best); used.add(best.unit.id);
    if (best.kind === 'attack') accumulated.set(best.to, (accumulated.get(best.to) || 0) + best.estimate.dmgDef);
  }
  return chosen;
}
