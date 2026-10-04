import { validateOrder, makeBid, makeReport } from '../core/orders.js';
import { assessOrder } from './bid.js';
import { candidateTasks } from './tactics.js';
import { auctionTasks, taskValue } from './auction.js';
import { handlerFor } from '../../../commands.js';
import { personality, PERSONALITY, deterministicChance, overreachNetThreshold } from './personality.js';
import { supportEffect } from './support.js';
import { evaluateEncirclement } from '../../../rules/combatModel.js';
import { loadOverrides } from '../core/params.js';
import { filterTasksForObedient, OBEDIENT_STRICT, isOtFix8Active, REST_HP_RATIO_THRESHOLD, EN_ROUTE_MAX_STAGNANT_ROUNDS } from './verb_profile.js';
const P = loadOverrides();

export class Commander {
  constructor({ id, groupId = null, mods = {}, units = [], ao = [], obedient = false, view = null } = {}) {
    this.id = id; this.groupId = groupId; this.mods = mods; this.units = units; this.ao = ao; this.obedient = obedient; this.view = view;
    this.order = null; this.lastReport = makeReport(); this.settled = new Set(); this.held = new Set(); this.pending = null; this.package = null; this.coverTargets = new Map(); this.initialStrength = null; this.initialTargetHp = null;
  }
  assess(order, model) {
    try { return this._assess(order, model); }
    catch (error) {
      console.warn('rejected/exception', this.id, order?.id, error);
      return makeBid({ reason: 'exception', notes: [String(error?.message || error)] });
    }
  }
  _assess(order, model) {
    model = this.view || model;
    const error = validateOrder(order);
    if (error) return makeBid({ notes: [error] });
    const cacheKey = JSON.stringify(order);
    if (this.assessCache?.model === model && this.assessCache.revision === model.revision &&
        this.assessCache.key === cacheKey) return this.assessCache.bid;
    const bid = assessOrder(order, model, this.units);
    const p = personality(this.mods, this.groupId == null, this.units, model);
    if (bid.feasible && order.risk > PERSONALITY.REFUSE_RISK + p.caution * P.refusalCautionScale && bid.pSuccess < PERSONALITY.REFUSE_SUCCESS) {
      const result = this.obedient ? makeBid({ ...bid, notes: [...bid.notes, 'high-risk order'] }) : makeBid({ ...bid, feasible: false, reason: 'refuse' });
      this.assessCache = { model, revision: model.revision, key: cacheKey, bid: result };
      return result;
    }
    this.assessCache = { model, revision: model.revision, key: cacheKey, bid };
    return bid;
  }
  accept(order) { const error = validateOrder(order); if (error) return this.reject(error); this.order = (this.obedient && order.obedient) ? { ...order, obedient: true, ...(order.isPlayerOrder ? { isPlayerOrder: true } : {}) } : { ...order }; this.supportBaseline = null; this.settled.clear(); this.held.clear(); this.pending = null; this.package = null; this.coverTargets.clear(); this.initialStrength = null; this.initialTargetHp = null; this.lastReport = makeReport({ orderId: order.id }); return true; }
  reject(reason) { this.lastReport = makeReport({ orderId: this.order?.id || '', status: 'failed', requests: [{ type: 'release', amount: 0, reason }] }); return false; }
  next(model) {
    try { return this._next(model); }
    catch (error) {
      console.warn('rejected/exception', this.id, this.order?.id, error);
      this.lastReport = makeReport({ orderId: this.order?.id || '', status: 'failed',
        requests: [{ type: 'release', amount: 0, reason: 'exception' }], warnings: [String(error?.message || error)] });
      return null;
    }
  }
  _next(model) {
    model = this.view || model;
    if (!this.order) return null;
    if (this.lastRound != null && model.round !== this.lastRound) { this.settled.clear(); this.held.clear(); this.pending = null; this.package = null; this.unitActionCount?.clear(); }
    this.lastRound = model.round;
    const ids = new Set(this.units.map(row => (row.army || row.unit || row).id));
    const liveUnits = model.game.stage.areas.flatMap(area => area.armies.filter(army => ids.has(army.id)).map(army => ({ army, area })));
    for (const row of liveUnits) if (row.army.movement <= 0) this.held.add(row.army.id);

    // 清理 plan 里的已阵亡单位和失效目标 (M1)
    if (this.plan) {
      const liveIds = new Set(liveUnits.map(r => r.army.id));
      for (const uid of Object.keys(this.plan)) {
        if (uid.startsWith('_')) continue;
        if (!liveIds.has(+uid)) {
          delete this.plan[uid];
          continue;
        }
        const p = this.plan[uid];
        if (isOtFix8Active(this.order)) {
          if (p && (p.goal != null || p.to != null)) {
            const finalGoalId = p.goal != null ? p.goal : p.to;
            const targetArea = model.game.stage.st(finalGoalId);
            const isOffensive = ['attack', 'breakthrough', 'envelop'].includes(this.order.verb);
            if (isOffensive && targetArea && targetArea.country === (model.me || liveUnits[0]?.area?.country)) {
              delete this.plan[uid];
              continue;
            }
            if (!targetArea || !model.game.stage.enabled.has(finalGoalId)) {
              delete this.plan[uid];
              continue;
            }
          }
          if (p && p.lastProgressRound != null) {
            p.stagnant = (model.round - p.lastProgressRound) >= EN_ROUTE_MAX_STAGNANT_ROUNDS;
          }
        } else {
          if (p && p.to != null) {
            const targetArea = model.game.stage.st(p.to);
            const isOffensive = ['attack', 'breakthrough', 'envelop'].includes(this.order.verb);
            if (isOffensive && targetArea && targetArea.country === (model.me || liveUnits[0]?.area?.country)) {
              delete this.plan[uid];
              continue;
            }
            if (!targetArea || !model.game.stage.enabled.has(p.to)) {
              delete this.plan[uid];
              continue;
            }
          }
        }
      }
    }

    // 划线忠实度：防线岗位硬分配与动态补位 (Line Post Hard Assignment & Dynamic Fill)
    if (this.obedient && ['defend', 'screen', 'delay'].includes(this.order.verb) && this.order.line?.length > 0) {
      const posts = this.order.line;
      this.order._assignedPosts ||= {};
      const assigned = this.order._assignedPosts;
      const liveIds = new Set(liveUnits.map(r => r.army.id));
      for (const uid in assigned) if (!liveIds.has(+uid)) delete assigned[uid];

      // 动态补位：若某单位已被分配岗位但未能到达且距离较远，而该岗位仍无人驻守，允许重新调度
      const occupiedPosts = new Set(liveUnits.filter(r => posts.includes(r.area.id)).map(r => r.area.id));
      for (const [uid, p] of Object.entries(assigned)) {
        if (!occupiedPosts.has(p)) {
          const row = liveUnits.find(r => r.army.id === +uid);
          const d = row ? (model.dist?.(row.area.id, p) ?? 99) : 99;
          if (d >= 8) delete assigned[uid];
        }
      }

      const postAssignedCount = new Map(posts.map(p => [p, 0]));
      for (const [uid, p] of Object.entries(assigned)) {
        if (postAssignedCount.has(p)) postAssignedCount.set(p, postAssignedCount.get(p) + 1);
      }

      const unassignedUnits = liveUnits.filter(r => assigned[r.army.id] == null);
      if (unassignedUnits.length > 0) {
        const emptyPosts = posts.filter(p => (postAssignedCount.get(p) || 0) === 0);
        emptyPosts.sort((a, b) => (model.pLose?.(b) || 0) - (model.pLose?.(a) || 0));

        for (const post of emptyPosts) {
          if (!unassignedUnits.length) break;
          unassignedUnits.sort((a, b) => (model.dist?.(a.area.id, post) ?? 99) - (model.dist?.(b.area.id, post) ?? 99));
          const chosen = unassignedUnits.shift();
          assigned[chosen.army.id] = post;
          postAssignedCount.set(post, (postAssignedCount.get(post) || 0) + 1);
        }

        for (const row of unassignedUnits) {
          const sortedPosts = [...posts].sort((a, b) => {
            const countA = postAssignedCount.get(a) || 0;
            const countB = postAssignedCount.get(b) || 0;
            if (countA !== countB) return countA - countB;
            return (model.pLose?.(b) || 0) - (model.pLose?.(a) || 0);
          });
          const bestPost = sortedPosts[0] || posts[0];
          assigned[row.army.id] = bestPost;
          postAssignedCount.set(bestPost, (postAssignedCount.get(bestPost) || 0) + 1);
        }
      }
    }

    // 划线忠实度：合围双轴硬分配 (Envelop Dual Axes Hard Assignment)
    if (this.obedient && this.groupId != null && this.order.verb === 'envelop' && Array.isArray(this.order.axes) && this.order.axes.length >= 2) {
      this.order._axisAssignment ||= {};
      const axisAssigned = this.order._axisAssignment;
      const liveIds = new Set(liveUnits.map(r => r.army.id));
      for (const uid in axisAssigned) if (!liveIds.has(+uid)) delete axisAssigned[uid];

      const unassignedUnits = liveUnits.filter(r => axisAssigned[r.army.id] == null);
      if (unassignedUnits.length > 0) {
        let count0 = Object.values(axisAssigned).filter(v => v === 0).length;
        let count1 = Object.values(axisAssigned).filter(v => v === 1).length;
        const raw0 = this.order.axes[0] || [];
        const raw1 = this.order.axes[1] || [];
        const axis0 = Array.isArray(raw0) ? raw0 : [raw0];
        const axis1 = Array.isArray(raw1) ? raw1 : [raw1];
        for (const row of unassignedUnits) {
          const d0 = Math.min(...axis0.map(h => model.dist?.(row.area.id, h) ?? 99));
          const d1 = Math.min(...axis1.map(h => model.dist?.(row.area.id, h) ?? 99));
          let choice = 0;
          if (count0 < count1) choice = 0;
          else if (count1 < count0) choice = 1;
          else choice = d0 <= d1 ? 0 : 1;
          axisAssigned[row.army.id] = choice;
          if (choice === 0) count0++; else count1++;
        }
      }
    }

    const targets = Array.isArray(this.order.to) ? this.order.to : [this.order.to];
    const targetHp = targets.reduce((sum, id) => sum + (model.game.stage.st(id)?.armies || [])
      .reduce((n, army) => n + army.hp, 0), 0);
    if (this.initialTargetHp == null) this.initialTargetHp = Math.max(1, targetHp);
    const ownCountry = model.me || liveUnits[0]?.area?.country;
    const atTarget = liveUnits.filter(row => targets.includes(row.area.id)).length;
    const supportNow = this.order.verb === 'support' ? supportEffect(this.order, model) : null;
    const trackedEnemy = () => {
      const goals = Array.isArray(this.order.to) ? this.order.to : [this.order.to];
      const near = new Set(goals.flatMap(id => [id, ...(model.game.stage.adjE.get(id) || [])]));
      return new Map(model.units.enemy.filter(unit => near.has(unit.area)).map(unit => [unit.id, unit.area]));
    };
    let effectAchieved = null;
    if (supportNow && this.supportBaseline) {
      if (this.order.effect === 'pin_reserves') {
        const current = trackedEnemy();
        effectAchieved = [...this.supportBaseline.enemyPositions].every(([id, area]) => current.get(id) === area);
      } else effectAchieved = supportNow.delta > 0;
    }
    if (supportNow && !this.supportBaseline) this.supportBaseline = { ...supportNow, enemyPositions: trackedEnemy() };

    let achieved = ['attack', 'breakthrough', 'counterattack'].includes(this.order.verb) && targets.every(id => {
      const area = model.game.stage.st(id);
      return area?.country === ownCountry;
    });

    if (this.order.verb === 'withdraw' && liveUnits.length > 0) {
      const destination = model.game.stage.st(targets[0]);
      const maxCap = destination ? (model.game.stage.maxArmies?.(targets[0]) || 4) : 4;
      const outsiders = Math.max(0, (destination?.armies?.length || 0) - atTarget);
      const req = Math.min(liveUnits.length, Math.max(1, maxCap - outsiders));
      achieved = atTarget >= req || liveUnits.every(row => targets.includes(row.area.id) || (model.dist?.(row.area.id, targets[0]) ?? 999) <= 1);
    }

    if (this.order.verb === 'defend' && liveUnits.length > 0) {
      const defAreas = this.order.mustHold || this.order.line || targets;
      const allHeld = defAreas.length > 0 && defAreas.every(id => model.game.stage.st(id)?.country === ownCountry);
      const onLineCount = liveUnits.filter(row => defAreas.includes(row.area.id)).length;
      const capSum = defAreas.reduce((s, id) => s + (model.game.stage.maxArmies?.(id) || 4), 0);
      const req = Math.min(liveUnits.length, capSum);
      achieved = allHeld && onLineCount >= req && (this.order.expires != null ? this.order.expires <= 0 : false);
    }

    if (this.order.verb === 'screen' && liveUnits.length > 0) {
      const screenAreas = this.order.line || targets;
      const onScreenCount = liveUnits.filter(row => screenAreas.includes(row.area.id)).length;
      achieved = screenAreas.length > 0 && onScreenCount >= Math.min(liveUnits.length, screenAreas.length) && (this.order.expires != null ? this.order.expires <= 0 : false);
    }

    if (this.order.verb === 'delay' && liveUnits.length > 0) {
      const delayAreas = this.order.line || targets;
      const onDelayCount = liveUnits.filter(row => delayAreas.includes(row.area.id) || targets.includes(row.area.id)).length;
      achieved = onDelayCount >= Math.min(liveUnits.length, delayAreas.length) && (this.order.expires != null ? this.order.expires <= 0 : false);
    }

    let concentrationRequired = liveUnits.length;
    if (this.order.verb === 'concentrate' && liveUnits.length) {
      const destination = model.game.stage.st(targets[0]);
      const outsiders = Math.max(0, (destination?.armies?.length || 0) - atTarget);
      concentrationRequired = Math.min(liveUnits.length,
        Math.max(1, (model.game.stage.maxArmies?.(targets[0]) || 4) - outsiders));
      achieved = atTarget >= concentrationRequired;
    }
    if (this.order.verb === 'envelop') {
      const encircled = targets.some(id => (evaluateEncirclement(model.game.stage, id)?.level || 0) > 0);
      const captured = targets.every(id => model.game.stage.st(id)?.country === ownCountry);
      achieved = encircled || captured;
    }
    if (this.order.verb === 'support')
      achieved = Boolean(effectAchieved || supportNow?.achieved);

    if (achieved && this.order.verb === 'breakthrough' && this.order.depth > 1) {
      const nextTarget = targets.flatMap(id => model.game.stage.adjE.get(id) || [])
        .filter(id => model.game.stage.st(id)?.country && model.rel(model.game.stage.st(id).country) === 'enemy')
        .sort((a, b) => (model.areaValue?.(b) || 0) - (model.areaValue?.(a) || 0))[0];
      if (nextTarget != null) {
        const newAo = [...new Set([...(this.order.ao || []), nextTarget])];
        this.order = { ...this.order, from: targets, to: nextTarget, ao: newAo, depth: this.order.depth - 1 };
        this.settled.clear(); this.pending = null; this.package = null; this.initialTargetHp = null;
        return this.next(model);
      }
    }
    let activeOrder = this.order, deviated = false;
    const p = personality(this.mods, this.groupId == null, liveUnits, model);
    if (['defend', 'delay', 'screen', 'withdraw'].includes(this.order.verb) && !this.obedient &&
        p.initiative * (1 - p.discipline) > PERSONALITY.OVERREACH_THRESHOLD &&
        deterministicChance(model.game.seed ?? 0, model.round, this.id) < p.initiative * (1 - p.discipline)) {
      const ao = new Set(this.order.ao || this.ao);
      const opportunityOrder = { ...this.order, verb: 'attack', to: [...ao], ao: [...ao] };
      const opportunity = candidateTasks(opportunityOrder, model, liveUnits, this.settled)
        .filter(task => task.kind === 'attack' && ao.has(task.to) && !this.order.mustHold?.includes(task.from))
        .map(task => ({ task, net: taskValue(task, opportunityOrder, model) }))
        .sort((a, b) => b.net - a.net)[0];
      if (opportunity && opportunity.net > overreachNetThreshold(p.discipline)) {
        activeOrder = { ...this.order, verb: 'attack', to: opportunity.task.to }; deviated = true;
      }
    }
    let command = null;
    if (this.pending) {
      const next = this.pending;
      this.pending = null;
      if (handlerFor(next.type)?.validate(model.game, next) == null) command = next;
      else { this.settled.add(next.armyId); this.package = null; }
    }
    if (!command && this.package) {
      const plan = this.package;
      const area = model.game.stage.st(plan.target);
      const actualHp = area?.armies?.reduce((sum, army) => sum + army.hp, 0) || 0;
      if (!area?.armies?.length || Math.abs(actualHp - plan.expectedHp) > Math.max(P.packageDeviationHpFloor, plan.initialHp * P.packageDeviationRelative)) {
        this.package = null;
      } else {
        const nextId = plan.attackerIds[0];
        const options = candidateTasks(activeOrder, model, this.units, this.settled)
          .filter(t => t.kind === 'attack' && t.to === plan.target && t.unit.id === nextId)
          .sort((a, b) => taskValue(b, activeOrder, model) - taskValue(a, activeOrder, model));
        const nextTask = options.find(t => handlerFor(t.commands[0]?.type)?.validate(model.game, t.commands[0]) == null);
        if (nextTask) {
          command = nextTask.commands[0];
          this.settled.add(nextId);
          if (nextTask.commands.length > 1) this.pending = nextTask.commands[1];
          plan.attackerIds.shift();
          plan.expectedHp = Math.max(0, actualHp - nextTask.estimate.dmgDef);
          if (!plan.attackerIds.length) this.package = null;
        } else this.package = null;
      }
    }
    if (!command) {
      const reachable = [...new Set(liveUnits.flatMap(row => [row.area.id, ...(model.reach?.(row)?.keys() || [])]))];
      const tacticalAo = [...new Set([...reachable, ...reachable.flatMap(id => model.game.stage.adjE.get(id) || [])])];
      const ao = [...new Set([...(activeOrder.ao || []), ...(this.ao || []), ...tacticalAo])];
      const unitActionMap = this.unitActionCount && isOtFix8Active(this.order) ? Object.fromEntries(this.unitActionCount) : null;
      const orderForFilter = unitActionMap ? { ...activeOrder, _unitActionCounts: unitActionMap } : activeOrder;
      const tacticalOrder = { ...activeOrder, ao, obedient: this.obedient, ...(activeOrder.isPlayerOrder ? { isPlayerOrder: true } : {}) };
      let candidates = candidateTasks(tacticalOrder, model, this.units, this.settled);
      if (this.obedient) {
        candidates = filterTasksForObedient(candidates, orderForFilter, model);
      }
      let tasks = auctionTasks(candidates, tacticalOrder, model);
      // Once the assigned objective is finished (or has no useful action), keep
      // evaluating the remaining mobile units against local opportunities.
      // This is a fresh valuation, not a blind move toward an already held goal.
      const hasAction = tasks.some(task => task.commands?.length > 0);
      const isValuableHold = tasks.some(task => {
        if (task.kind !== 'hold' || !task.value || task.value <= 5) return false;
        const a = model.game.stage.st(task.from);
        return a && (a.construction === 'industry' || (a.construction === 'city' && (a.level || 0) >= 2) || tacticalOrder.mustHold?.includes(task.from));
      });

      if ((achieved || !hasAction) && !isValuableHold) {
        if (this.obedient && OBEDIENT_STRICT) {
          if (achieved) {
            const guardMode = activeOrder.guard || 'hold';
            if (guardMode === 'ring') {
              // 玩家显式指定 "ring": 外围部队可在目标周围 1 格内建立警戒圈，但不得离开 1 格、不得主动进攻
              tasks = tasks.filter(task => {
                if (task.kind === 'attack') return false; // 严禁主动进攻
                if (task.kind === 'hold') return true;
                const dToGoal = Math.min(...targets.map(g => model.dist?.(task.to, g) ?? Infinity));
                return dToGoal <= 1;
              });
            } else {
              // 默认 "hold": 严格原地待命，不动
              tasks = tasks.filter(task => task.kind === 'hold');
            }
          }
        } else {
          const local = new Set(ao);
          let objectives = [...local].filter(id => {
            const area = model.game.stage.st(id);
            return area && (area.country && model.rel(area.country) === 'enemy' ||
              area.country === ownCountry && (model.pLose?.(id) || 0) > P.stalledThreatThreshold);
          });
          if (objectives.length === 0) {
            const allEnemies = (model.enemyAreas || []).map(a => a.id);
            const allThreatened = (model.mine || []).filter(a => (model.pLose?.(a.id) || 0) > P.threatObjectiveThreshold).map(a => a.id);
            objectives = [...allEnemies, ...allThreatened];
          }
          const coverOrder = { ...activeOrder, verb: 'concentrate', to: objectives, ao };
          let enemyObjectives = objectives.filter(id => model.rel(model.game.stage.st(id)?.country) === 'enemy');
          if (enemyObjectives.length === 0 && model.enemyAreas?.length) {
            enemyObjectives = model.enemyAreas.map(a => a.id);
          }
          const safeAdvance = task => {
            if (task.kind !== 'concentrate' || model.game.stage.st(task.from)?.country !== ownCountry ||
                model.game.stage.st(task.to)?.country !== ownCountry) return false;
            let goal = this.coverTargets.get(task.unit.id);
            if (!enemyObjectives.includes(goal)) {
              goal = enemyObjectives.slice().sort((a, b) =>
                (model.dist?.(task.from, a) ?? Infinity) - (model.dist?.(task.from, b) ?? Infinity) ||
                (model.areaValue?.(b) ?? 0) - (model.areaValue?.(a) ?? 0))[0];
              if (goal != null) this.coverTargets.set(task.unit.id, goal);
            }
            return goal != null &&
              (model.dist?.(task.to, goal) ?? Infinity) < (model.dist?.(task.from, goal) ?? Infinity) &&
              (model.pLose?.(task.to, [task.unit]) ?? 1) <= Math.max(0.35, (model.pLose?.(task.from) ?? 0) + 0.15);
          };
          const rawCover = candidateTasks(coverOrder, model, this.units, this.settled);
          const coverCandidates = rawCover
            .map(task => safeAdvance(task) ? { ...task, isSafeAdvance: true } : task)
            .filter(task => task.kind === 'attack' || task.kind === 'capture' ||
              task.isSafeAdvance ||
              task.kind === 'concentrate' && objectives.includes(task.to) &&
                model.game.stage.st(task.to)?.country === ownCountry &&
                (model.pLose?.(task.to) || 0) > P.stalledThreatThreshold);
          const coverTasks = auctionTasks(coverCandidates, coverOrder, model);
          if (achieved) tasks = coverTasks;
          else if (coverTasks.some(task => task.commands?.length)) tasks = coverTasks;
        }
      }
      for (const task of tasks) {
        const first = task.commands[0];
        if (!first) { this.settled.add(task.unit.id); this.held.add(task.unit.id); continue; }
        if (handlerFor(first.type)?.validate(model.game, first) != null) { this.settled.add(task.unit.id); continue; }
        command = first;
        if (isOtFix8Active(this.order)) {
          this.unitActionCount = this.unitActionCount || new Map();
          const actCount = (this.unitActionCount.get(task.unit.id) || 0) + 1;
          this.unitActionCount.set(task.unit.id, actCount);
          if (actCount >= 4) {
            this.settled.add(task.unit.id);
          }
        } else {
          this.settled.add(task.unit.id);
        }
        if (this.plan) {
          if (isOtFix8Active(this.order)) {
            const finalGoal = targets[0];
            const distToGoal = model.dist?.(first.to, finalGoal) ?? 0;
            const prevPlan = this.plan[task.unit.id];
            const prevDist = prevPlan?.remainingDistance ?? Infinity;
            const isProgress = distToGoal < prevDist || targets.includes(first.to) || task.kind === 'attack';
            const lastProgressRound = isProgress ? model.round : (prevPlan?.lastProgressRound ?? model.round);
            const speed = task.unit.movement || 1;
            const eta = model.round + Math.ceil(distToGoal / Math.max(1, speed));
            const isAtGoal = targets.includes(first.to);
            this.plan[task.unit.id] = {
              goal: finalGoal,
              from: first.from,
              to: first.to,
              remainingDistance: distToGoal,
              prevDistance: prevDist,
              etaRound: eta,
              state: isAtGoal ? 'arrived' : (task.kind === 'attack' ? 'engaged' : 'en_route'),
              kind: task.kind,
              since: prevPlan?.since || model.round,
              updatedRound: model.round,
              lastProgressRound,
              madeProgressThisRound: isProgress,
              stagnant: (model.round - lastProgressRound) >= EN_ROUTE_MAX_STAGNANT_ROUNDS
            };
          } else {
            this.plan[task.unit.id] = {
              goal: targets[0],
              to: first.to,
              from: first.from,
              kind: task.kind,
              since: this.plan[task.unit.id]?.since || model.round
            };
          }
        }
        if (task.commands.length > 1) this.pending = task.commands[1];
        if (task.packagePlan?.attackerIds?.length > 1) {
          const initialHp = model.game.stage.st(task.to)?.armies?.reduce((sum, army) => sum + army.hp, 0) || 0;
          this.package = { target: task.to, attackerIds: task.packagePlan.attackerIds.slice(1),
            expectedOutcome: task.packagePlan.expectedOutcome, initialHp,
            expectedHp: Math.max(0, initialHp - task.estimate.dmgDef) };
        }
        break;
      }
    }
    const holding = ['defend', 'delay', 'screen'].includes(this.order.verb) &&
      targets.some(id => model.game.stage.st(id)?.country === ownCountry);
    const destination = model.game.stage.st(targets[0]);
    const targetFull = destination && destination.armies.length >= model.game.stage.maxArmies(targets[0]);
    const impossibleConcentration = this.order.verb === 'concentrate' && targetFull && atTarget < concentrationRequired;
    if (!command) for (const row of liveUnits) if (!this.settled.has(row.army.id)) {
      this.settled.add(row.army.id);
      this.held.add(row.army.id);
    }
    const threat = targets.reduce((n, id) => Math.max(n, model.pLose?.(id) ?? 0), 0);
    const allNoMovement = liveUnits.length > 0 && liveUnits.every(r => r.army.movement <= 0);
    const hasEnRouteProgress = isOtFix8Active(this.order) && this.plan &&
      Object.values(this.plan).some(p => p && (p.state === 'en_route' || p.state === 'engaged') && !p.stagnant &&
        (p.updatedRound === model.round || (p.lastProgressRound != null && model.round - p.lastProgressRound < EN_ROUTE_MAX_STAGNANT_ROUNDS)));
    if (this.reportRound !== model.round) {
      this.noProgressRounds = (command || allNoMovement || hasEnRouteProgress) ? 0 : (this.noProgressRounds || 0) + 1;
    } else if (command || allNoMovement || hasEnRouteProgress) this.noProgressRounds = 0;
    if (command && this.obedient && Array.isArray(this.order.path)) {
      this.order._unitPathIndex ||= {};
      const toIdx = this.order.path.indexOf(command.to);
      if (toIdx !== -1) {
        const prev = this.order._unitPathIndex[command.armyId] ?? -1;
        this.order._unitPathIndex[command.armyId] = Math.max(prev, toIdx);
      }
    }
    const ownStrength = liveUnits.reduce((n, row) => n + (model.unitValue?.(row.army) ?? 1), 0);
    if (this.initialStrength == null) this.initialStrength = ownStrength;
    const enemyStrength = [...new Set(this.order.ao?.length ? this.order.ao : targets)]
      .reduce((n, id) => n + (model.threatMap?.().get(id)?.units || [])
        .reduce((s, u) => s + (model.unitValue?.(u) ?? 1), 0), 0);
    const aoThreat = [...new Set(this.order.ao?.length ? this.order.ao : targets)]
      .reduce((n, id) => Math.max(n, model.pLose?.(id) ?? 0), 0);
    const casualtyRate = this.initialStrength > 0 ? Math.max(0, this.initialStrength - ownStrength) / this.initialStrength : 0;
    const retreat = !this.obedient && (ownStrength < enemyStrength * (PERSONALITY.RETREAT_BASE + p.caution * P.retreatCautionScale) || casualtyRate > P.retreatCasualtyThreshold) &&
      aoThreat * Math.max(ownStrength, this.initialStrength) > (model.areaValue?.(targets[0]) ?? 0);

    const warnings = [];
    if (this.order.confirmedHighRisk) warnings.push('玩家已确认高风险强攻：预估胜率极低(<10%)，坚决执行指令');
    if (this.order.risk > 0.66) warnings.push('\u672c\u547d\u4ee4\u98ce\u9669\u9ad8\uff1a\u9884\u8ba1\u635f\u5931\u53ef\u80fd\u8f83\u5927');
    if (this.order._suicideWarnings?.length) {
      warnings.push(...this.order._suicideWarnings);
    }
    if (casualtyRate >= 0.5) warnings.push(`\u90e8\u961f\u627f\u53d7\u8f83\u9ad8\u6218\u635f\uff08\u5df2\u635f\u5931 ${Math.round(casualtyRate * 100)}% \u5175\u529b\uff09`);

    // 划线忠实度状态提示与受阻反馈
    let fidelityStatusInfo = null;
    let blockedPathNode = null;
    let blockedPathFrom = null;
    const structuredRejected = [];

    if (this.order.path?.length >= 2) {
      const path = this.order.path;
      const onPathIndices = liveUnits.map(r => {
        const uIdx = this.order._unitPathIndex?.[r.army.id];
        if (uIdx != null) return uIdx;
        return path.indexOf(r.area.id);
      }).filter(i => i !== -1);
      const maxIdx = onPathIndices.length > 0 ? Math.max(...onPathIndices) : 0;
      fidelityStatusInfo = `沿线推进 ${maxIdx + 1}/${path.length} 节点`;
      if (maxIdx + 1 < path.length) {
        const nextNode = path[maxIdx + 1];
        const nextArea = model.game.stage.st(nextNode);
        if (nextArea?.armies?.length && nextArea.country && model.rel?.(nextArea.country) === 'enemy') {
          blockedPathNode = nextNode;
          blockedPathFrom = path[maxIdx];
        }
      }
    } else if (this.order.line?.length > 0) {
      const posts = this.order.line;
      const manned = posts.filter(id => liveUnits.some(r => r.area.id === id)).length;
      fidelityStatusInfo = `防线岗位 ${manned}/${posts.length} 已就位`;
      const unmanned = posts.filter(id => !liveUnits.some(r => r.area.id === id));
      if (unmanned.length > 0) {
        for (const p of unmanned) {
          const reason = liveUnits.length < posts.length
            ? `防线岗位[${p}]缺人(编制不足，缺${posts.length - liveUnits.length}人)`
            : `防线岗位[${p}]缺人(路径受阻或无法通行)`;
          structuredRejected.push({ post: p, reason });
        }
        if (liveUnits.length < posts.length) {
          fidelityStatusInfo += ` (编制不足，缺${posts.length - liveUnits.length}人)`;
        } else {
          fidelityStatusInfo += ` (未就位岗位: [${unmanned.join(',')}])`;
        }
      }
    } else if (Array.isArray(this.order.axes) && this.order.axes.length >= 2) {
      const raw0 = this.order.axes[0] || [];
      const raw1 = this.order.axes[1] || [];
      const ax0 = Array.isArray(raw0) ? raw0 : [raw0];
      const ax1 = Array.isArray(raw1) ? raw1 : [raw1];
      const prog0 = Math.max(0, ...liveUnits.filter(r => (this.order._axisAssignment?.[r.army.id] ?? 0) === 0).map(r => ax0.indexOf(r.area.id)).filter(i => i !== -1));
      const prog1 = Math.max(0, ...liveUnits.filter(r => (this.order._axisAssignment?.[r.army.id] ?? 0) === 1).map(r => ax1.indexOf(r.area.id)).filter(i => i !== -1));
      fidelityStatusInfo = `双轴推进中(左翼 ${prog0 + 1}/${ax0.length}, 右翼 ${prog1 + 1}/${ax1.length})`;
    }

    if (!liveUnits.length) {
      warnings.push('\u6307\u6325\u5b98 AI \u5f85\u547d\uff1a\u96c6\u56e2\u519b\u6682\u65e0\u5b58\u6d3b\u90e8\u961f\u7f16\u5236');
    } else {
      if (fidelityStatusInfo) warnings.push(fidelityStatusInfo);
      if (blockedPathNode != null && !command) {
        const blkMsg = `路径[${blockedPathFrom != null ? blockedPathFrom : '前沿'}->${blockedPathNode}]被堵于地块[${blockedPathNode}]`;
        warnings.push(blkMsg);
        structuredRejected.push({ from: blockedPathFrom, to: blockedPathNode, blockedAt: blockedPathNode, reason: 'path-blocked-by-enemy' });
      }
    }

    if (achieved) {
      if (this.order.guard === 'ring') {
        warnings.push('战术目标已达成，外围部队在目标周围1格建立警戒圈');
      } else {
        warnings.push('\u6218\u672f\u76ee\u6807\u5df2\u8fbe\u6210\uff0c\u90e8\u961f\u8f6c\u5165\u5c31\u5730\u9632\u5fa1\u8b66\u6212');
      }
    } else if (impossibleConcentration || targetFull) {
      warnings.push(`\u76ee\u6807\u5730\u5757[${targets[0]}]\u9a7b\u519b\u5df2\u8fbe\u4e0a\u9650\uff0c\u5355\u4f4d\u5728\u5916\u56f4\u5f85\u673a`);
    } else if (!command && liveUnits.length > 0) {
      const allNoMovement = liveUnits.every(r => r.army.movement <= 0);
      if (allNoMovement) {
        warnings.push('\u90e8\u961f\u672c\u56de\u5408\u884c\u52a8\u529b\u5df2\u8017\u5c3d\uff0c\u539f\u5730\u4f11\u6574\u5f85\u673a');
      } else if (holding) {
        warnings.push('\u90e8\u961f\u5df2\u575a\u5b88\u5728\u9632\u7ebf\u9635\u5730\uff0c\u672a\u53d1\u73b0\u53ef\u5b89\u5168\u53cd\u51fb\u76ee\u6807');
      } else if (blockedPathNode == null) {
        warnings.push('\u901a\u5f80\u6307\u5b9a\u76ee\u6807\u7684\u8def\u5f84\u53d7\u963b\u6216\u5f53\u524d\u65e0\u5408\u89c4\u4ea4\u6218\u673a\u4f1a');
      }
      if (isOtFix8Active(this.order)) {
        for (const row of liveUnits) {
          if (this.held.has(row.army.id)) {
            let reason = null;
            const army = row.army;
            const area = row.area;
            const reachMap = model.reach?.(row) || new Map();
            const adjIds = model.game.stage.adjE.get(area.id) || [];
            const adjAreas = adjIds.map(id => model.game.stage.st(id)).filter(Boolean);

            if (army.movement <= 0) {
              reason = '本回合行动力已耗尽';
            } else if (this.order.mustHold?.includes(area.id)) {
              reason = `被指令 mustHold 约束坚守地块[${area.id}]`;
            } else if (achieved && (this.order.guard || 'hold') === 'hold') {
              reason = '战术目标已达成，单位按 guard=hold 就地待命';
            } else if ((army.hp / (army.maxHp || 100)) <= REST_HP_RATIO_THRESHOLD) {
              reason = `生命值过低(${Math.round(army.hp / (army.maxHp || 100) * 100)}%)低于休整阈值，原地休整`;
            } else if (model.game.coordination?.manual?.includes(army.id)) {
              reason = '本回合已被玩家手动指令优先占用';
            } else if (this.order.ao?.length && !this.order.ao.includes(area.id) && ![...reachMap.keys()].some(id => this.order.ao.includes(id))) {
              reason = '周围候选地块超出指令授权作战范围(AO)';
            } else if (reachMap.size === 0) {
              const friendlyAdjs = adjAreas.filter(a => a.country === area.country);
              if (friendlyAdjs.length > 0 && friendlyAdjs.every(a => a.armies.length >= model.game.stage.maxArmies(a.id))) {
                reason = '周围合规通行地块已被友军占满(堆叠已达上限)';
              } else {
                reason = '周围无可用通行地块(受地形或通行限制)';
              }
            } else if (area.construction === 'industry' && area.armies.length <= 1 && !this.order.mustHold?.includes(area.id)) {
              reason = '作为工业要地唯一守军需就地卫戍，防止空城';
            } else if (this.order.path?.length >= 2) {
              const curIdx = this.order.path.indexOf(area.id);
              if (curIdx !== -1 && curIdx + 1 < this.order.path.length) {
                const nextNodeId = this.order.path[curIdx + 1];
                const nextSt = model.game.stage.st(nextNodeId);
                const isEnemy = nextSt && nextSt.armies.length > 0 && model.rel?.(nextSt.country) === 'enemy';
                const isFullFriendly = nextSt && (nextSt.country === area.country || model.rel?.(nextSt.country) === 'ally') &&
                  nextSt.armies.length >= model.game.stage.maxArmies(nextNodeId);
                if (isEnemy) {
                  reason = `前方路径节点[${nextNodeId}]被敌军据守且当前攻击风险过高`;
                } else if (isFullFriendly) {
                  reason = `前方路径节点[${nextNodeId}]已被友军占满`;
                } else if (!reachMap.has(nextNodeId)) {
                  reason = `行动力不足以在单回合抵达前方路径节点[${nextNodeId}]`;
                } else {
                  reason = '未分类(待进一步归因)';
                }
              } else if (curIdx === -1) {
                const entryId = this.order.path[0];
                const entrySt = model.game.stage.st(entryId);
                const isEntryEnemy = entrySt && entrySt.armies.length > 0 && model.rel?.(entrySt.country) === 'enemy';
                const isEntryFull = entrySt && (entrySt.country === area.country || model.rel?.(entrySt.country) === 'ally') &&
                  entrySt.armies.length >= model.game.stage.maxArmies(entryId);
                const towardEntry = adjAreas.filter(a => (model.dist?.(a.id, entryId) ?? Infinity) < (model.dist?.(area.id, entryId) ?? Infinity));
                const allTowardFull = towardEntry.length > 0 && towardEntry.every(a =>
                  (a.country === area.country || model.rel?.(a.country) === 'ally') && a.armies.length >= model.game.stage.maxArmies(a.id));
                if (isEntryEnemy) {
                  reason = `路径起点[${entryId}]被敌军据守且当前交战风险过高`;
                } else if (isEntryFull) {
                  reason = `路径起点[${entryId}]已被友军占满`;
                } else if (allTowardFull) {
                  reason = '汇入路径起点的通道地块均已被友军占满';
                } else {
                  reason = '通往路径起点的通道地块拥堵或被友军占满';
                }
              } else {
                reason = '未分类(待进一步归因)';
              }
            } else if (Array.isArray(this.order.axes) && this.order.axes.length >= 2) {
              const axisIdx = this.order._axisAssignment?.[army.id] ?? 0;
              const rawAxis = this.order.axes[axisIdx] || this.order.axes[0];
              const curAxis = Array.isArray(rawAxis) ? rawAxis : [rawAxis];
              const curIdx = curAxis.indexOf(area.id);
              if (curIdx !== -1 && curIdx + 1 < curAxis.length) {
                const nextNodeId = curAxis[curIdx + 1];
                const nextSt = model.game.stage.st(nextNodeId);
                const isEnemy = nextSt && nextSt.armies.length > 0 && model.rel?.(nextSt.country) === 'enemy';
                const isFullFriendly = nextSt && (nextSt.country === area.country || model.rel?.(nextSt.country) === 'ally') &&
                  nextSt.armies.length >= model.game.stage.maxArmies(nextNodeId);
                if (isEnemy) {
                  reason = `推进轴线前方节点[${nextNodeId}]被敌军据守且当前攻击风险过高`;
                } else if (isFullFriendly) {
                  reason = `推进轴线前方节点[${nextNodeId}]已被友军占满`;
                } else if (!reachMap.has(nextNodeId)) {
                  reason = `行动力不足以在单回合抵达推进轴线前方节点[${nextNodeId}]`;
                } else {
                  reason = '未分类(待进一步归因)';
                }
              } else {
                reason = '未分类(待进一步归因)';
              }
            } else {
              const enemyAdjs = adjAreas.filter(a => model.rel?.(a.country) === 'enemy' && a.armies.length > 0);
              const closerAdjs = adjAreas.filter(a => Math.min(...targets.map(g => model.dist?.(a.id, g) ?? Infinity)) < Math.min(...targets.map(g => model.dist?.(area.id, g) ?? Infinity)));
              const allCloserFull = closerAdjs.length > 0 && closerAdjs.every(a =>
                (a.country === area.country || model.rel?.(a.country) === 'ally') && a.armies.length >= model.game.stage.maxArmies(a.id));
              if (enemyAdjs.length > 0) {
                reason = '与相邻敌军交战预期交换比不利且超出风险门槛';
              } else if (allCloserFull) {
                reason = '朝向战术目标的前进通道地块均已被友军占满';
              } else {
                reason = '未分类(待进一步归因)';
              }
            }
            structuredRejected.push({ unitId: army.id, reason });
          }
        }
      }
    }
    if (deviated) warnings.push('opportunity attack inside AO');

    const reportStatus = !liveUnits.length ? 'stalled'
      : impossibleConcentration ? 'failed'
      : achieved ? 'achieved'
      : ((this.noProgressRounds >= 2 && (!isOtFix8Active(this.order) || !hasEnRouteProgress)) ||
         (casualtyRate >= P.stalledCasualtyThreshold && aoThreat > P.stalledThreatThreshold && !this.obedient)) ? 'stalled'
      : 'progressing';

    const curDist = liveUnits.length ? Math.min(...liveUnits.map(r => Math.min(...targets.map(g => model.dist?.(r.area.id, g) ?? 99)))) : 99;
    if (this.initialDist == null) this.initialDist = Math.max(1, curDist);
    const marchProgress = Math.max(0, Math.min(0.6, (this.initialDist - curDist) / Math.max(1, this.initialDist) * 0.6));
    const pathProgress = this.order.path?.length >= 2 ?
      Math.max(0, Math.min(1, (Math.max(0, ...liveUnits.map(r => {
        const uIdx = this.order._unitPathIndex?.[r.army.id];
        if (uIdx != null) return uIdx;
        return this.order.path.indexOf(r.area.id);
      }).filter(i => i !== -1))) / (this.order.path.length - 1))) : 0;
    const lineProgress = this.order.line?.length > 0 ?
      Math.max(0, Math.min(1, (this.order.line.filter(id => liveUnits.some(r => r.area.id === id)).length / Math.min(this.order.line.length, liveUnits.length || 1)))) : 0;

    const calcProgress = achieved ? 1 : Math.min(1, this.order.verb === 'concentrate' ? atTarget / Math.max(1, concentrationRequired) :
        this.order.path?.length >= 2 ? Math.max(pathProgress, 1 - targetHp / this.initialTargetHp) :
        this.order.line?.length > 0 ? lineProgress :
        ['attack', 'breakthrough', 'counterattack', 'envelop'].includes(this.order.verb) ?
          Math.max(marchProgress, 1 - targetHp / this.initialTargetHp) :
          Math.max(atTarget / Math.max(1, liveUnits.length), this.settled.size / Math.max(1, liveUnits.length)));

    const remainingRoundsInGame = model.game.totalRounds != null ? Math.max(0, model.game.totalRounds - model.game.round) : null;
    let estimatedRoundsRemaining = null;
    let estimatedRoundsRemainingText = null;
    const activeRounds = Math.max(1, this.order.roundsActive || 1);
    if (calcProgress > 0.05 && !achieved) {
      const rawEst = Math.max(1, Math.ceil((1 - calcProgress) / (calcProgress / activeRounds)));
      if (remainingRoundsInGame != null && rawEst > remainingRoundsInGame) {
        estimatedRoundsRemainingText = '无法在限期内完成';
        warnings.push(`预计需${rawEst}回合完成，超过关卡剩余${remainingRoundsInGame}回合(无法在限期内完成)`);
        estimatedRoundsRemaining = remainingRoundsInGame;
      } else {
        estimatedRoundsRemaining = rawEst;
      }
    }

    this.lastReport = makeReport({ orderId: this.order.id,
      status: reportStatus,
      progress: calcProgress,
      strength: this.units.reduce((n, r) => n + (model.unitValue?.(r.army || r.unit || r) ?? 1), 0),
      lossesSoFar: Math.max(0, this.initialStrength - ownStrength),
      heldUnitIds: [...this.held],
      threats: [...new Set(this.order.ao || targets)].map(area => ({ area, pLose: model.pLose?.(area) || 0 })).filter(t => t.pLose > P.stalledThreatThreshold),
      deviated, warnings,
      effectAchieved,
      rejected: structuredRejected,
      estimatedRoundsRemaining,
      estimatedRoundsRemainingText,
      requests: impossibleConcentration ? [{ type: 'release', amount: ownStrength, reason: 'destination full' }] :
        retreat ? [{ type: 'withdraw', amount: ownStrength, reason: 'unfavorable strength and threat' }] :
        !command && !holding ? [{ type: 'reinforce', amount: 1, reason: 'no executable task' }] : [] });
    return command;
  }
  execute(model) { const commands = []; for (let i = 0; i < this.units.length * 2 + 2; i++) { const command = this.next(model); if (!command) break; commands.push(command); } return commands; }
  report() { return this.lastReport; }
  cancel(orderId) { if (this.order?.id !== orderId) return false; this.order = null; this.lastReport = makeReport({ orderId, status: 'failed' }); return true; }
}
