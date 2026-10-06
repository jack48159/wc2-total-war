import { expectedExchange } from '../core/estimate.js';
import { potentialAt } from './auction.js';
import { loadOverrides } from '../core/params.js';
import { evaluateRestStatus, findRestEvacuationTarget } from './rest.js';
import { isOtFix8Active, REAR_MARCH_BONUS_BASE, MULTI_MOVE_MIN_PROFIT_RATIO, MULTI_MOVE_MAX_SUICIDE_P, REST_HP_RATIO_THRESHOLD } from './verb_profile.js';

const list = x => x == null ? [] : Array.isArray(x) ? x : [x];
const P = loadOverrides();
const { attackMovement: ATTACK_MOVEMENT, fieldWeight: FIELD_WEIGHT } = P;
export function candidateTasks(order, model, units, settled = new Set()) {
  const stage = model.game.stage;
  const goals = list(order.to);
  const allOrderTargets = [...goals, ...(order.path || []), ...(order.line || []), ...(order.mustHold || []), ...(order.axes ? order.axes.flat() : [])];
  const ao = new Set(order.ao?.length ? order.ao : [...allOrderTargets, ...goals, ...units.flatMap(row => {
    const unit = row.army || row.unit || row;
    const origin = row.area?.id ?? row.area ?? unit.area;
    return [origin, ...(model.reach?.(row)?.keys() || [])];
  })]);
  const friendly = new Set((model.mine || []).map(area => area.id));
  const objectives = [...new Set([...goals,
    ...(model.enemyAreas || []).filter(area => area.adj?.some(id => friendly.has(id))).map(area => area.id),
    ...(model.mine || []).filter(area => (model.pLose?.(area.id) || 0) > P.threatObjectiveThreshold).map(area => area.id)])];
  const weightedObjectives = objectives.map(id => ({ id, value: model.areaValue?.(id) ?? 1 }));
  const potentials = new Map();
  const potential = id => {
    if (!potentials.has(id)) potentials.set(id, potentialAt(model, id, weightedObjectives));
    return potentials.get(id);
  };
  const tasks = [];
  if (order.verb === 'amphibious') return tasks;
  for (const row of units) {
    const unit = row.army || row.unit || row;
    const origin = row.area?.id ?? row.area ?? unit.area;
    const source = stage.st(origin);
    if (!source || unit.movement <= 0 || settled.has(unit.id)) continue;
    const attackMovement = Math.max(ATTACK_MOVEMENT,
      stage.armyDef(unit.country || source.country, unit)?.attackCost ?? ATTACK_MOVEMENT);
    if (!source.armies.some(a => a.id === unit.id)) continue;

    const isPlayerObedient = Boolean(order.obedient);

    // --- 伤兵后送休整机制 (br_rest) ---
    const restStatus = evaluateRestStatus(unit, source, model, P);
    if (restStatus.needsRest) {
      if (restStatus.alreadyAtRest) {
        // 已位于本方控制的合格城市/工业区：原地保持休整，不消耗机动力以触发回合结束高额回血
        tasks.push({
          kind: 'hold',
          unit,
          from: origin,
          to: origin,
          commands: [],
          isRestHold: true
        });
        continue;
      }

      // 未在合格休整基地：
      // 在玩家指令严格遵从模式下，若非撤退/延迟指令，禁止违规向后方撤退休整，避免破坏攻势推进路线
      if (!isPlayerObedient || ['withdraw', 'delay'].includes(order.verb)) {
        const evac = findRestEvacuationTarget(unit, origin, restStatus.restType, model, P, row, restStatus.priorityLevel);
        if (evac && evac.command) {
          const priorityBonus = restStatus.priorityLevel === 'high' ? (P.restPriorityBonus + 150)
                              : restStatus.priorityLevel === 'low' ? (P.restPriorityBonus - 100)
                              : P.restPriorityBonus;
          tasks.push({
            kind: 'withdraw',
            unit,
            from: origin,
            to: evac.id,
            commands: [evac.command],
            isRestEvacuation: true,
            potentialGain: priorityBonus
          });
          continue;
        }
      }

      // 若当前无合格可达休整基地，不强行就地弃疗，继续流转至常规战术生成（自卫、卡位或反击）
    }
    let allowedPositions = null;
    let allowedAttackTargets = null;

    if (isPlayerObedient) {
      // 1. 合围双轴硬约束 (envelop with axes)
      if (order.verb === 'envelop' && Array.isArray(order.axes) && order.axes.length >= 2) {
        const axisIdx = order._axisAssignment?.[unit.id] ?? 0;
        const rawAxis = order.axes[axisIdx] || order.axes[0];
        const currentAxis = Array.isArray(rawAxis) ? rawAxis : [rawAxis];
        const axisSet = new Set(currentAxis);
        const fromIdx = currentAxis.indexOf(origin);
        if (fromIdx !== -1) {
          allowedPositions = new Set([origin]);
          for (let step = 1; step <= 3; step++) {
            if (fromIdx + step < currentAxis.length) allowedPositions.add(currentAxis[fromIdx + step]);
          }
          if (fromIdx + 1 < currentAxis.length) allowedAttackTargets = new Set([currentAxis[fromIdx + 1]]);
        } else {
          if (isOtFix8Active(order)) {
            allowedPositions = new Set([origin, ...axisSet]);
            allowedAttackTargets = axisSet;
            const axisEntry = currentAxis[0];
            for (const [id] of model.reach?.(row) || []) {
              const dOld = model.dist?.(origin, axisEntry) ?? Infinity;
              const dNew = model.dist?.(id, axisEntry) ?? Infinity;
              if (dNew < dOld) allowedPositions.add(id);
            }
          } else {
            allowedPositions = axisSet;
            allowedAttackTargets = axisSet;
          }
        }
      }
      // 2. 带路径指令硬约束 (attack / breakthrough / counterattack / concentrate / withdraw 带 path)
      else if (Array.isArray(order.path) && order.path.length >= 2) {
        const path = order.path;
        let fromIdx = -1;
        const lastIdx = order._unitPathIndex?.[unit.id] ?? 0;
        for (let i = lastIdx; i < path.length; i++) {
          if (path[i] === origin) { fromIdx = i; break; }
        }
        if (fromIdx === -1) {
          let bestDiff = Infinity;
          for (let i = 0; i < path.length; i++) {
            if (path[i] === origin) {
              const diff = Math.abs(i - lastIdx);
              if (diff < bestDiff) { bestDiff = diff; fromIdx = i; }
            }
          }
        }

        if (fromIdx !== -1) {
          allowedPositions = new Set([origin]);
          for (let step = 1; step <= 2; step++) {
            if (fromIdx + step < path.length) allowedPositions.add(path[fromIdx + step]);
          }
          if (order.detour && fromIdx + 1 < path.length) {
            const nextNode = path[fromIdx + 1];
            for (const n of stage.adjE.get(nextNode) || []) {
              if (stage.enabled?.has(n) && !stage.st(n)?.sea) allowedPositions.add(n);
            }
          }
          if (fromIdx + 1 < path.length) {
            allowedAttackTargets = new Set([path[fromIdx + 1]]);
            if (fromIdx + 2 < path.length && (stage.st(path[fromIdx + 1])?.country === source.country || model.rel?.(stage.st(path[fromIdx + 1])?.country) === 'ally')) {
              allowedAttackTargets.add(path[fromIdx + 2]);
            }
          }
          if (fromIdx === path.length - 1) {
            allowedPositions.add(origin);
            if (order.guard === 'ring') {
              for (const n of stage.adjE.get(origin) || []) allowedPositions.add(n);
            }
          }
        } else {
          // 单位当前不在路径上，只允许向路径起点或紧邻入口节点汇入，严禁越级直插路径终点/后半段
          allowedPositions = new Set([origin, path[0]]);
          if (path.length > 1) allowedPositions.add(path[1]);
          allowedAttackTargets = new Set([path[0]]);
          if (path.length > 1) allowedAttackTargets.add(path[1]);
          if (isOtFix8Active(order)) {
            for (const [id] of model.reach?.(row) || []) {
              const dOld = model.dist?.(origin, path[0]) ?? Infinity;
              const dNew = model.dist?.(id, path[0]) ?? Infinity;
              if (dNew < dOld) allowedPositions.add(id);
            }
          }
        }
      }
      // 3. 防线指令硬约束 (defend / screen / delay 带 line)
      else if (['defend', 'screen', 'delay'].includes(order.verb) && Array.isArray(order.line) && order.line.length > 0) {
        const assignedPost = order._assignedPosts?.[unit.id];
        if (assignedPost != null) {
          if (origin === assignedPost) {
            allowedPositions = new Set([origin]);
            allowedAttackTargets = new Set(stage.adjE.get(origin) || []);
          } else {
            allowedPositions = new Set([assignedPost, ...order.line]);
          }
        } else {
          allowedPositions = new Set(order.line);
        }
      }
    }

    const pinned = (order.mustHold?.includes(origin) && source.armies.length === 1) ||
      (isPlayerObedient && order.line?.includes(origin) && source.armies.length === 1 && ['defend', 'screen', 'delay'].includes(order.verb));
    const positions = [{ id: origin, cost: 0, command: null }];
    if (!pinned) for (const [id, route] of model.reach?.(row) || []) {
      const target = stage.st(id);
      if (!target || target.armies.length >= stage.maxArmies(id)) continue;
      if (allowedPositions && !allowedPositions.has(id)) continue;
      const isCloserToGoal = (goals.length > 0 && Math.min(...goals.map(g => model.dist?.(id, g) ?? Infinity)) < Math.min(...goals.map(g => model.dist?.(origin, g) ?? Infinity))) || (allOrderTargets.length > 0 && Math.min(...allOrderTargets.map(g => model.dist?.(id, g) ?? Infinity)) < Math.min(...allOrderTargets.map(g => model.dist?.(origin, g) ?? Infinity)));
      if (!allowedPositions && !ao.has(id) && !isCloserToGoal) continue;
      if (!allowedPositions?.has(id) && target.country && model.rel?.(target.country) === 'ally') continue;
      positions.push({ id, cost: route.cost, command: { type: 'move', from: origin, to: id, armyId: unit.id } });
    }
    for (const position of positions) {
      const targetArea = stage.st(position.id);
      if (unit.movement - position.cost >= attackMovement) {
        const attackTargets = model.attackTargets?.(row, position.id) || (stage.adjE.get(position.id) || [])
          .filter(id => stage.st(id)?.armies?.length && stage.st(id)?.country !== source.country);
        for (const target of attackTargets) {
          if (allowedAttackTargets && !allowedAttackTargets.has(target)) continue;
          const isTargetAllowed = ao.has(target) || goals.includes(target) || allOrderTargets.includes(target) || (stage.adjE.get(origin) || []).includes(target);
          if (!isTargetAllowed) continue;
          if (!stage.st(target)?.armies?.length) continue;
          const estimate = expectedExchange(model, unit, position.id, target);
          tasks.push({ kind: 'attack', unit, from: origin, staging: position.id, to: target,
            commands: [...(position.command ? [position.command] : []), { type: 'attack', from: position.id, to: target, armyId: unit.id }], estimate });
        }
      }
      if (!position.command) continue;
      const enemyEmpty = !targetArea.armies.length && targetArea.country !== source.country
        && model.rel?.(targetArea.country) !== 'ally';
      if (enemyEmpty) tasks.push({ kind: 'capture', unit, from: origin, to: position.id, commands: [position.command] });
      const fieldGain = potential(position.id) - potential(origin);
      const safetyGain = order.verb === 'withdraw' ?
        (model.pLose(origin) - model.pLose(position.id, [unit])) * (model.unitValue(unit) || 0) : 0;

      // 修复线索2：计算朝向订单目标（goals）的显式推进距离（progressTowardsGoal）
      let progressTowardsGoal = 0;
      const isOnPath = Array.isArray(order.path) && order.path.includes(origin);
      const effectiveGoals = isOtFix8Active(order)
        ? ((Array.isArray(order.path) && order.path.length >= 2 && !isOnPath) ? [order.path[0]] : (goals.length > 0 ? goals : (order.path?.length ? [order.path[0]] : allOrderTargets)))
        : goals;
      if (effectiveGoals.length > 0) {
        const distFrom = Math.min(...effectiveGoals.map(g => model.dist?.(origin, g) ?? Infinity));
        const distTo = Math.min(...effectiveGoals.map(g => model.dist?.(position.id, g) ?? Infinity));
        if (Number.isFinite(distFrom) && Number.isFinite(distTo)) {
          progressTowardsGoal = distFrom - distTo;
        }
      }

      // 修复线索2：避免向普通机场盲目做无推进的无效集结（黑洞效应）
      const isPlainAirportTarget = targetArea.construction === 'airport' && targetArea.construction !== 'industry' && targetArea.areaType !== 1;
      if (isPlainAirportTarget && progressTowardsGoal <= 0 && !goals.includes(position.id)) {
        continue;
      }

      // 修复线索1：工业要地最后一支守军不可为了横向无推进的微小势能差弃守
      const isSoloIndustryGarrison = source.construction === 'industry' && source.armies.length <= 1;
      if (isSoloIndustryGarrison && progressTowardsGoal <= 0 && !goals.includes(position.id)) {
        continue;
      }

      // 如果朝目标切实前进，保底赋予推进奖励，防止复杂全局势能场将远距离机动稀释为负数
      const marchBonus = progressTowardsGoal > 0 ? (progressTowardsGoal * 25 + (isOtFix8Active(order) ? REAR_MARCH_BONUS_BASE : 0)) : 0;
      const gain = order.verb === 'withdraw'
        ? safetyGain + fieldGain * FIELD_WEIGHT
        : Math.max(fieldGain * FIELD_WEIGHT + marchBonus, marchBonus);

      if (gain > 0 && (order.verb !== 'withdraw' || model.pLose(position.id, [unit]) < P.withdrawMaxRisk || enemyEmpty))
        tasks.push({
          kind: 'concentrate',
          unit,
          from: origin,
          to: position.id,
          commands: [position.command],
          potentialGain: gain,
          isEnRouteMarch: isOtFix8Active(order) && progressTowardsGoal > 0
        });
      if (goals.includes(position.id) && ['defend', 'delay', 'screen', 'concentrate'].includes(order.verb))
        tasks.push({ kind: order.verb, unit, from: origin, to: position.id, commands: [position.command], potentialGain: Math.max(gain, 40) });
    }
    tasks.push({ kind: 'hold', unit, from: origin, to: origin, commands: [] });
  }
  return tasks;
}
