import { candidateTasks } from './tactics.js';
import { auctionTasks } from './auction.js';
import { makeBid } from '../core/orders.js';
import { supportEffect } from './support.js';
import { sequenceOutcome } from '../core/estimate.js';
import { loadOverrides } from '../core/params.js';
const { captureThreshold: CAPTURE_THRESHOLD } = loadOverrides();
export function assessOrder(order, model, units) {
  if (order.verb === 'amphibious') return makeBid({ reason: 'not_implemented', notes: ['amphibious execution is pending'] });
  const tasks = auctionTasks(candidateTasks(order, model, units), order, model);
  const attacks = tasks.filter(t => t.kind === 'attack');
  const byTarget = new Map();
  for (const task of attacks) byTarget.set(task.to, [...(byTarget.get(task.to) || []), task]);
  const outcomes = [...byTarget].map(([target, group]) => ({ target,
    value: sequenceOutcome(model, group.map(task => ({ unit: task.unit, from: task.staging })), target) }));
  const goalIds = Array.isArray(order.to) ? order.to : [order.to];
  const offensive = ['attack', 'breakthrough', 'envelop', 'counterattack'].includes(order.verb);
  const pSuccess = outcomes.length ? Math.min(...goalIds.map(id => outcomes.find(o => o.target === id)?.value.pCapture ?? 0)) : offensive ? 0 : tasks.length ? 1 : 0;
  let gain = outcomes.reduce((n, { target, value }) => n + value.expectedKillDef + value.pCapture * (model.areaValue?.(target) ?? 0), 0);
  gain += tasks.filter(t => t.kind !== 'attack').reduce((n, t) => n + Math.max(0, t.value || 0), 0);
  const loss = outcomes.reduce((n, o) => n + o.value.expectedLossAtt, 0);
  if (order.verb === 'support') gain = Math.max(0, supportEffect(order, model, order.primaryBid).delta);
  const shortfall = outcomes.length ? Math.max(0, CAPTURE_THRESHOLD - pSuccess) *
    (model.area?.(goalIds[0])?.armies || []).reduce((n, army) => n + (model.unitValue?.(army) ?? army.hp ?? 1), 0) : 0;
  return makeBid({ feasible: tasks.length > 0 && (!offensive || pSuccess > 0) && (order.verb !== 'support' || gain > 0),
    pSuccess, expGain: gain, expLoss: loss, turns: 1,
    shortfall, notes: tasks.length ? [] : ['no legal profitable task'] });
}
