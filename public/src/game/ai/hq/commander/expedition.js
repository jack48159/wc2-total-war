import { handlerFor } from '../../../commands.js';
import { expectedExchange } from '../core/estimate.js';

const NAVY = new Set(['destroyer', 'cruiser', 'battleship', 'aircraftcarrier']);

// Plan against the country's current visible model, including purchases. Keep
// sea routes separate from land reachability: land BFS cannot cross the Channel.
export function nextExpeditionCommand(model, blocked = () => false) {
  const { game, st, me } = model;
  const areas = new Map(model.areas.map(a => [a.id, a]));
  const areaAt = id => areas.get(id);
  const units = model.units.mine.filter(u => !NAVY.has(u.type) && !u.def.transportUnit);
  const legal = cmd => !blocked(cmd) && handlerFor(cmd.type)?.validate(game, cmd) === null;
  const beaches = model.enemyAreas.filter(a => a.land && a.adj.some(id => areaAt(id)?.sea));
  if (!beaches.length) return null;

  function route(unit, beach) {
    const queue = [[unit.area, []]], seen = new Set([unit.area]);
    for (let head = 0; head < queue.length; head++) {
      const [id, path] = queue[head];
      if (path.length >= 16) continue;
      for (const next of st.adjE.get(id) || []) {
        if (seen.has(next) || !st.enabled.has(next)) continue;
        const area = areaAt(next);
        if (!area) continue;
        if (next === beach.id && areaAt(id)?.sea) return [...path, next];
        if (!area.sea && (area.owner !== me || path.some(p => areaAt(p)?.sea))) continue;
        if (area.sea && area.armies.length && area.owner !== me) continue;
        if (area.stackCount >= area.cap) continue;
        seen.add(next);
        queue.push([next, [...path, next]]);
      }
    }
    return null;
  }

  const transports = units.filter(u => u.cards & 4);
  const homeUnits = units.filter(u => model.area(u.area)?.land && !(u.cards & 4));
  const threatened = model.mine.filter(a => a.land && model.isFront(a.id));
  const reserve = Math.max(2, threatened.length);
  const transportLimit = Math.max(1, Math.min(4, Math.floor(units.length / 3)));
  const candidates = [];
  for (const unit of units) {
    if (!unit.canAct || unit.movement <= 0) continue;
    const from = model.area(unit.area);
    const embarked = !!(unit.cards & 4);
    if (!embarked) {
      if (homeUnits.length <= reserve || transports.length >= transportLimit || unit.hp < unit.maxHp * 0.65) continue;
      if (model.isFront(from.id)) continue;
      if (from.isCapital && from.armies.filter(a => (a.country || from.owner) === me).length <= 1) continue;
      // Land fronts already reachable by this unit belong to the land commanders.
      if (beaches.some(b => model.dist(from.id, b.id) < 999)) continue;
      const card = game.findCard(22, me);
      if (!card || game.whyNot(card, me)) continue;
    }
    for (const beach of beaches) {
      const path = route(unit, beach);
      if (!path) continue;
      const alliedFront = beach.adj.some(id => model.rel(model.area(id)?.owner) === 'ally');
      const defenders = beach.armies.reduce((sum, a) => sum + (a.hp || 0), 0);
      candidates.push({ unit, from, beach, path,
        score: (alliedFront ? 80 : 0) + model.areaValue(beach.id) - path.length * 8 - defenders * 0.5 + (embarked ? 100 : 0) });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.unit.id - b.unit.id);
  for (const { unit, from, beach, path } of candidates) {
    const next = path[0];
    let cmd;
    if (next === beach.id && beach.armies.length) {
      if (!model.attackTargets(unit).includes(next)) continue;
      const exchange = expectedExchange(model, unit, from.id, next);
      if (exchange.pAttackerDies > 0.4 || exchange.dmgAtt >= unit.hp * 0.8) continue;
      cmd = { type: 'attack', from: from.id, to: next, armyId: unit.id, reason: '远征部队攻击敌方海岸，为大陆战线开辟登陆场。' };
    } else if (model.area(next)?.sea && !(unit.cards & 4)) {
      cmd = from.armies[0]?.id === unit.id
        ? { type: 'useCard', country: me, card: 22, target: from.id, pendingPurchase: true, reason: '为跨海支援准备运输装备，投入富余陆军。' }
        : { type: 'frontArmy', from: from.id, armyId: unit.id, reason: '将准备出海的部队调到前排，便于配发运输装备。' };
    } else {
      if (!model.reach(unit).has(next)) continue;
      cmd = { type: 'move', from: from.id, to: next, armyId: unit.id, reason: '沿跨海远征路线推进，争取登陆并分担大陆盟友的压力。' };
    }
    if (legal(cmd)) return cmd;
  }
  return null;
}
