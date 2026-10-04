import { sequenceOutcome } from '../core/estimate.js';

export const PLAN_HORIZON = 4;
export const PLAN_DISCOUNT = 0.82;
export const PLAN_DWELL = 3;
export const PLAN_HYSTERESIS = 8;
export const PLAN_EMERGENCY_PLOSE = 0.65;
export const PLAN_FAILURE_TURNS = 2;

export const PLAN_LIBRARY = Object.freeze({
  offensive: Object.freeze({ rho: 0.55, reserve: 0.12, attack: 1.18, hold: 0.7, replenish: 0.55, posture: 'attack' }),
  defensive: Object.freeze({ rho: 1.3, reserve: 0.38, attack: 0.35, hold: 1.25, replenish: 0.8, posture: 'defend' }),
  elastic: Object.freeze({ rho: 0.95, reserve: 0.27, attack: 0.65, hold: 1.05, replenish: 0.9, posture: 'delay' }),
  consolidate: Object.freeze({ rho: 1.1, reserve: 0.3, attack: 0.12, hold: 0.85, replenish: 1.35, posture: 'balanced' }),
});

const finite = n => Number.isFinite(n) ? n : 0;
const clamp = n => Math.max(0, Math.min(1, finite(n)));

function frontEvidence(model, front) {
  const stage = model.game.stage;
  const friendly = front.friendlyAreas || front.areas || [];
  const adjacent = new Set(friendly);
  for (const id of friendly) for (const next of stage.adjE.get(id) || []) adjacent.add(next);
  const units = model.units.mine.filter(u => adjacent.has(u.area) && u.hp > 0);
  let attackGain = 0, attackLoss = 0, opportunity = 0;
  for (const target of front.enemyAreas || []) {
    const defenders = stage.st(target)?.armies || [];
    const areaValue = finite(model.areaValue?.(target));
    const attackers = units.filter(u => (stage.adjE.get(u.area) || []).includes(target)).slice(0, 4);
    if (!attackers.length) continue;
    if (!defenders.length) {
      opportunity = Math.max(opportunity, areaValue);
      continue;
    }
    const outcome = sequenceOutcome(model, attackers.map(unit => ({ unit, from: unit.area })), target);
    const gain = outcome.pCapture * areaValue + outcome.expectedKillDef;
    if (gain - outcome.expectedLossAtt > attackGain - attackLoss) {
      attackGain = gain;
      attackLoss = outcome.expectedLossAtt;
    }
  }
  let exposure = 0, threatenedValue = 0, lostChance = 0;
  for (const id of friendly) {
    const probability = clamp(model.pLose?.(id));
    const value = finite(model.areaValue?.(id));
    exposure += probability * value;
    threatenedValue += value;
    lostChance = Math.max(lostChance, probability);
  }
  const damagedValue = units.reduce((sum, u) => sum + finite(model.unitValue?.(u)) * (1 - clamp(u.hp / Math.max(1, u.maxHp))), 0);
  const forceGap = Math.max(0, finite(front.P_en) - finite(front.P_me));
  return { attackGain, attackLoss, opportunity, exposure, threatenedValue, lostChance, damagedValue, forceGap };
}

export function evaluatePlans(model, front, doctrine = {}) {
  const e = frontEvidence(model, front);
  const values = {};
  const discount = Array.from({ length: PLAN_HORIZON }, (_, i) => PLAN_DISCOUNT ** (i + 1)).reduce((a, b) => a + b, 0);
  for (const [name, spec] of Object.entries(PLAN_LIBRARY)) {
    const bias = finite(doctrine.planBias?.[name] ?? 1) || 1;
    const futureCapture = finite(front.V_gain) * clamp(finite(front.P_me) / Math.max(1, finite(front.P_me) + finite(front.P_en))) * 0.6;
    const offensiveReturn = (e.attackGain + e.opportunity + futureCapture) * spec.attack * bias;
    // Only the portion covered by a plan's reserve can be credited as saved.
    const protection = e.exposure * spec.hold * spec.reserve;
    const replenishment = (e.damagedValue * 0.16 + e.forceGap * 0.08) * spec.replenish;
    const risk = e.attackLoss * spec.rho + e.exposure * (1 - spec.reserve) * 0.2;
    const inactivity = (e.attackGain + e.opportunity) * (1 - spec.attack) * 0.12;
    values[name] = Math.round((offensiveReturn + protection + replenishment - risk - inactivity) * discount * 100) / 100;
  }
  return { values, evidence: e };
}

function switchingCost(model, front, previous, next, activeOrders, doctrine) {
  const areas = new Set(front.friendlyAreas || front.areas || []);
  let redeploy = 0;
  for (const unit of model.units.mine) if (areas.has(unit.area)) redeploy += finite(model.unitValue?.(unit));
  const orderCost = [...activeOrders.values()].filter(o => o.frontId === front.id).length * 4;
  return redeploy * Math.abs(PLAN_LIBRARY[previous].reserve - PLAN_LIBRARY[next].reserve) * 0.06
    + orderCost + PLAN_HYSTERESIS + finite(doctrine.planSwitchCost);
}

export class PlanSet {
  constructor() { this.entries = new Map(); this.nextId = 1; this.manual = new Map(); }

  setPlan(frontId, plan) {
    if (!PLAN_LIBRARY[plan]) throw new Error(`Unknown plan: ${plan}`);
    this.manual.set(frontId, plan);
  }

  select(model, fronts, reports = [], activeOrders = new Map(), doctrine = {}) {
    const round = model.game.round ?? model.round ?? 1;
    const used = new Set();
    for (const front of fronts) {
      const areaIds = new Set(front.friendlyAreas || front.areas || []);
      let key = null, overlap = 0;
      for (const [candidate, entry] of this.entries) {
        if (used.has(candidate)) continue;
        const count = [...areaIds].filter(id => entry.areas.has(id)).length;
        if (count > overlap) { overlap = count; key = candidate; }
      }
      if (key == null) key = `front_${this.nextId++}`;
      used.add(key);
      const old = this.entries.get(key);
      const { values, evidence } = evaluatePlans(model, front, doctrine);
      const best = Object.keys(values).sort((a, b) => values[b] - values[a])[0];
      const requested = this.manual.get(front.id) ?? this.manual.get(key);
      const desired = requested || best;
      let selected = old?.plan || desired;
      let reason = old ? 'commit' : 'initial';
      const failedThisTurn = reports.some(r => ['failed', 'stalled'].includes(r.status)
        && [...activeOrders.values()].some(o => o.id === r.orderId && o.frontId === front.id));
      const failureStreak = failedThisTurn ? (old?.failureStreak || 0) + 1 : 0;
      const critical = (front.friendlyAreas || []).some(id => {
        const area = model.area?.(id);
        return (area?.isCapital || finite(model.areaValue?.(id)) >= evidence.threatenedValue * 0.4)
          && clamp(model.pLose?.(id)) >= PLAN_EMERGENCY_PLOSE;
      });
      const emergency = critical && desired !== selected && values[desired] > values[selected] ? 'critical_threat'
        : failureStreak >= PLAN_FAILURE_TURNS && desired !== selected ? 'failed_orders'
          : selected === 'offensive' && !(front.enemyAreas || []).length ? 'objective_complete' : null;
      if (requested && requested !== selected) { selected = requested; reason = 'manual'; }
      else if (desired !== selected && (round - old.since >= PLAN_DWELL || emergency)) {
        const cost = switchingCost(model, front, selected, desired, activeOrders, doctrine);
        if (emergency || values[desired] - values[selected] > cost) {
          selected = desired;
          reason = emergency || 'net_value';
        } else reason = 'switch_cost';
      } else if (desired !== selected) reason = 'dwell';
      const switched = !!old && old.plan !== selected;
      this.entries.set(key, { plan: selected, since: switched ? round : old?.since ?? round, areas: areaIds, failureStreak });
      front.plan = selected;
      front.planKey = key;
      front.planValues = values;
      front.planEvidence = evidence;
      front.planSpec = PLAN_LIBRARY[selected];
      front.operationalPosture = front.planSpec.posture;
      front.priority = Math.max(3, Math.min(9, Math.round(5 + values[selected] / 100)));
      console.log(`[HqPlan] ${JSON.stringify({ round, country: model.me, front: key, plan: selected, values, switched, reason, pLose: evidence.lostChance })}`);
    }
    for (const key of this.entries.keys()) if (!used.has(key)) this.entries.delete(key);
    return fronts;
  }
}
