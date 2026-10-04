import { buildModel } from './core/model.js';
import { Commander } from './commander/commander.js';
import { liveGroupUnits, commanderById } from '../../army_groups.js';
import { planStackFrontCommands } from './commander/stack_front.js';
import { createAlloutPlanner } from './commander/allout.js';
import { isOtFix8Active, OT_FIX8_ENABLED, EN_ROUTE_MAX_STAGNANT_ROUNDS } from './commander/verb_profile.js';

// Executes a player's standing order using only units assigned to its target.
// The strategic HqAi is intentionally not invoked: it may organize/command the
// entire country, whereas this executor is restricted to selected army groups.
export function createTacticalOrderExecutor(game) {
  const contexts = new Map();
  const planAllout = createAlloutPlanner(game);
  return ({ country, level, id, order }) => {
    const entry = game.orders.findLast(item => item.level === level && item.targetId === id && ['pending', 'progressing', 'stalled'].includes(item.status));
    if (!entry) return { commands: [], report: { status: 'stalled', warnings: ['命令不存在'] } };
    if (order.verb === 'allout') {
      const groupIds = level === 'country' ? game.armyGroups.filter(g => g.country === country).map(g => g.id)
        : level === 'army' ? [id] : game.theatres.find(t => t.id === id)?.armyIds || [];
      const unitIds = level === 'country'
        ? game.stage.areas.filter(a => a.country === country).flatMap(a => a.armies.map(u => u.id))
        : game.armyGroups.filter(g => g.country === country && groupIds.includes(g.id)).flatMap(g => g.unitIds || []);
      const claimed = new Set(game.orders.filter(other => other.id !== entry.id && other.country === country &&
        ['pending', 'progressing', 'stalled'].includes(other.status)).flatMap(other => {
        const ids = other.level === 'army' ? [other.targetId] : other.level === 'theater'
          ? game.theatres.find(t => t.id === other.targetId)?.armyIds || [] : [];
        return game.armyGroups.filter(g => ids.includes(g.id)).flatMap(g => g.unitIds || []);
      }));
      const command = planAllout({ country, order, orderId: entry.id, unitIds: unitIds.filter(uid => !claimed.has(uid)) });
      return { commands: command ? [command] : [], report: { status: 'progressing',
        progress: command ? 0.5 : 1, warnings: [], rejected: [] } };
    }
    const groups = level === 'army' ? game.armyGroups.filter(group => group.id === id && group.country === country)
      : game.armyGroups.filter(group => group.country === country && game.theatres.some(theater => theater.id === id && theater.armyIds.includes(group.id)));
    if (!groups.length) return { commands: [], report: { status: 'stalled', warnings: ['目标集团军不存在'] } };
    const isPlayerCountry = (country === game.player);
    const isObedientPlayerOrder = OT_FIX8_ENABLED && isPlayerCountry;
    if (isObedientPlayerOrder) {
      entry.order.obedient = true;
      entry.order.isPlayerOrder = true;
    }
    const key = entry.id;
    let context = contexts.get(key);
    if (!context) {
      const model = buildModel(game, country);
      const commanders = groups.map(group => {
        const spec = commanderById(country, group.commanderId);
        const commander = new Commander({ id: `order_${group.id}`, groupId: group.id, mods: spec?.mods || {}, units: liveGroupUnits(game, group), ao: [], obedient: true });
        commander.plan = entry.plan = entry.plan || {};
        const orderParams = {
          depth: 1, sync: false,
          ...(order.expires != null ? { expires: order.expires } : {}),
          ...order,
          ...(isObedientPlayerOrder ? { obedient: true, isPlayerOrder: true } : {}),
          id: `${entry.id}:${group.id}`,
          plan: entry.plan,
          ...(entry.plan._assignedPosts ? { _assignedPosts: entry.plan._assignedPosts } : {}),
          ...(entry.plan._axisAssignment ? { _axisAssignment: entry.plan._axisAssignment } : {}),
          ...(entry.plan._unitPathIndex ? { _unitPathIndex: entry.plan._unitPathIndex } : {})
        };
        if (order.verb === 'support') {
          orderParams.with = order.supportOrderId ? String(order.supportOrderId) : (Array.isArray(order.to) ? order.to : [order.to]);
          orderParams.mission = order.mission || 'fix';
          orderParams.effect = order.effect || 'pin_reserves';
        }
        commander.accept(orderParams);
        return { group, commander };
      });
      context = { model, commanders, cursor: 0 };
      contexts.set(key, context);
    }

    // 每回合开始清理 plan 里已阵亡/脱离集团军的单位与已失效/被占领的目标 (M1)
    const allLiveUnitIds = new Set(groups.flatMap(g => liveGroupUnits(game, g)).map(u => (u.army || u.unit || u).id));
    if (entry.plan) {
      for (const [uid, p] of Object.entries(entry.plan)) {
        if (uid.startsWith('_')) continue;
        const armyId = Number(uid);
        if (!allLiveUnitIds.has(armyId)) {
          delete entry.plan[uid];
          continue;
        }
        if (isObedientPlayerOrder) {
          if (p && (p.goal != null || p.to != null)) {
            const finalGoalId = p.goal != null ? p.goal : p.to;
            const goalArea = game.stage.st(finalGoalId);
            const isOffensive = ['attack', 'breakthrough', 'envelop'].includes(entry.order.verb);
            if (isOffensive && goalArea && goalArea.country === country) {
              delete entry.plan[uid];
              continue;
            }
          }
          if (p && p.lastProgressRound != null) {
            p.stagnant = (game.round - p.lastProgressRound) >= EN_ROUTE_MAX_STAGNANT_ROUNDS;
          }
        } else {
          if (p && p.to != null) {
            const targetArea = game.stage.st(p.to);
            const isOffensive = ['attack', 'breakthrough', 'envelop'].includes(entry.order.verb);
            if (isOffensive && targetArea && targetArea.country === country) {
              delete entry.plan[uid];
              continue;
            }
            if (!targetArea || !game.stage.enabled.has(p.to)) {
              delete entry.plan[uid];
              continue;
            }
          }
        }
      }
      if (entry.plan._assignedPosts) {
        for (const uid of Object.keys(entry.plan._assignedPosts)) {
          if (!allLiveUnitIds.has(Number(uid))) delete entry.plan._assignedPosts[uid];
        }
      }
      if (entry.plan._axisAssignment) {
        for (const uid of Object.keys(entry.plan._axisAssignment)) {
          if (!allLiveUnitIds.has(Number(uid))) delete entry.plan._axisAssignment[uid];
        }
      }
      if (entry.plan._unitPathIndex) {
        for (const uid of Object.keys(entry.plan._unitPathIndex)) {
          if (!allLiveUnitIds.has(Number(uid))) delete entry.plan._unitPathIndex[uid];
        }
      }
    }

    context.model.sync();
    const reports = [];
    for (let offset = 0; offset < context.commanders.length; offset++) {
      const index = (context.cursor + offset) % context.commanders.length;
      const { group, commander } = context.commanders[index];
      commander.units = liveGroupUnits(game, group);
      const command = commander.next(context.model);
      reports.push(commander.report());
      if (!command) continue;
      const allowed = new Set(group.unitIds || []);
      if (!['move', 'attack', 'frontArmy'].includes(command.type) || !allowed.has(command.armyId)) continue;
      context.cursor = (index + 1) % context.commanders.length;
      if (commander.order?._assignedPosts) entry.plan._assignedPosts = commander.order._assignedPosts;
      if (commander.order?._axisAssignment) entry.plan._axisAssignment = commander.order._axisAssignment;
      if (commander.order?._unitPathIndex) entry.plan._unitPathIndex = commander.order._unitPathIndex;
      return { commands: [command], report: {
        status: 'progressing',
        progress: commander.report()?.progress || 0,
        warnings: commander.report()?.warnings || [],
        rejected: commander.report()?.rejected || [],
        estimatedRoundsRemaining: commander.report()?.estimatedRoundsRemaining ?? null,
        estimatedRoundsRemainingText: commander.report()?.estimatedRoundsRemainingText ?? null,
      }, plan: entry.plan };
    }
    if (['defend', 'delay', 'screen'].includes(order.verb)) {
      const allowedAll = new Set(groups.flatMap(g => g.unitIds || []));
      const frontCmds = planStackFrontCommands(context.model, country, { order });
      const cmd = frontCmds.find(c => allowedAll.has(c.armyId));
      if (cmd) {
        return { commands: [cmd], report: { status: 'progressing', progress: 1.0, warnings: [] }, plan: entry.plan };
      }
    }
    const allReports = context.commanders.map(({ commander }) => commander.report()).filter(Boolean);
    const combinedWarnings = [...new Set([...reports, ...allReports].flatMap(report => report?.warnings || []))];
    const combinedRejected = [...new Set([...reports, ...allReports].flatMap(report => report?.rejected || []))];
    const hasEnRouteUnits = isObedientPlayerOrder && Boolean(entry.plan && Object.values(entry.plan).some(p =>
      p && (p.state === 'en_route' || p.state === 'engaged') && !p.stagnant &&
      (p.updatedRound === game.round || (p.lastProgressRound != null && game.round - p.lastProgressRound < EN_ROUTE_MAX_STAGNANT_ROUNDS))
    ));
    const finalStatus = allReports.length && allReports.every(report => report.status === 'achieved') ? 'achieved'
      : allReports.some(report => report.status === 'progressing') ? 'progressing'
      : allReports.every(report => ['failed', 'stalled'].includes(report.status)) ? (hasEnRouteUnits ? 'progressing' : 'stalled') : 'progressing';
    for (const { commander } of context.commanders) {
      if (commander.order?._assignedPosts) entry.plan._assignedPosts = commander.order._assignedPosts;
      if (commander.order?._axisAssignment) entry.plan._axisAssignment = commander.order._axisAssignment;
      if (commander.order?._unitPathIndex) entry.plan._unitPathIndex = commander.order._unitPathIndex;
      if (commander.unitActionCount && isObedientPlayerOrder) {
        entry.plan._unitActionCounts = entry.plan._unitActionCounts || {};
        for (const [uid, count] of commander.unitActionCount) {
          entry.plan._unitActionCounts[uid] = count;
        }
      }
    }
    return { commands: [], report: {
      status: finalStatus,
      progress: allReports.reduce((sum, report) => sum + (report.progress || 0), 0) / Math.max(1, allReports.length),
      warnings: combinedWarnings,
      rejected: combinedRejected,
      estimatedRoundsRemaining: allReports[0]?.estimatedRoundsRemaining ?? null,
      estimatedRoundsRemainingText: allReports[0]?.estimatedRoundsRemainingText ?? null,
    }, plan: entry.plan };
  };
}
