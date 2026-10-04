import { World } from '../../../world.js';
import { getRelation } from '../core/model.js';
import { ALLOUT_ENABLED, VERB_PROFILES } from './verb_profile.js';
import { estimateAttack } from '../../../rules/combatModel.js';

export const ALLOUT_WARNING = '将不计损失全面进攻，直到移动力耗尽，可能造成重大伤亡';

const enemy = (game, country, area) => area?.country && getRelation(game, country, area.country) === 'enemy';
const cost = (from, to) => World.areas[to]?.entryCosts?.[from] ?? World.areas[to]?.movementCost ?? 1;

function distances(game, country, start) {
  const stage = game.stage, best = new Map([[start, 0]]), queue = [[0, start]];
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const [distance, id] = queue.shift();
    if (distance !== best.get(id)) continue;
    for (const next of stage.adjE.get(id) || []) {
      if (!stage.enabled.has(next)) continue;
      const area = stage.st(next);
      if (area?.country !== country && !area?.sea && !enemy(game, country, area)) continue;
      const nextCost = distance + cost(id, next);
      if (nextCost >= (best.get(next) ?? Infinity)) continue;
      best.set(next, nextCost);
      if (!area?.armies?.length || area.country === country) queue.push([nextCost, next]);
    }
  }
  return best;
}

function benefit(area) {
  return (area?.capital ? 100 : 0) + (area?.construction === 'city' || area?.city ? 30 : 0) +
    (area?.construction === 'industry' || area?.industry ? 20 : 0) + (area?.port ? 10 : 0);
}

export function createAlloutPlanner(game) {
  const attempts = new Map();
  return ({ country, order, orderId = '', unitIds }) => {
    const profile = VERB_PROFILES.allout;
    if (!ALLOUT_ENABLED || !profile.enabled) return null;
    const stage = game.stage, allowed = new Set(unitIds), ao = order.ao?.length ? new Set(order.ao) : null;
    const mustHold = new Set(order.mustHold || []);
    const rows = [];
    for (const area of stage.areas) {
      if (area.country !== country) continue;
      for (const unit of area.armies) {
        if (!allowed.has(unit.id) || unit.movement <= 0 || !stage.canAct(unit) || game.coordination?.manual?.includes(unit.id)) continue;
        const distance = distances(game, country, area.id);
        const enemies = stage.areas.filter(target => stage.enabled.has(target.id) && enemy(game, country, target) &&
          (!ao || ao.has(target.id)) && (distance.has(target.id) || target.armies?.length &&
            stage.attackable(area.id, target.id, area.armies.indexOf(unit), game.airstrikeRadius())));
        if (!enemies.length) continue;
        enemies.sort((a, b) => {
          const byDistance = (distance.get(a.id) ?? stage.graphDistance(area.id, a.id, 99)) -
            (distance.get(b.id) ?? stage.graphDistance(area.id, b.id, 99));
          if (byDistance) return byDistance;
          const byBenefit = benefit(b) - benefit(a);
          if (byBenefit) return byBenefit;
          const chance = target => target.armies?.length && stage.attackable(area.id, target.id, area.armies.indexOf(unit), game.airstrikeRadius())
            ? estimateAttack(game, unit, target.armies[0], area, target, country).pKillFront || 0 : 0;
          return chance(b) - chance(a) || a.id - b.id;
        });
        rows.push({ area, unit, index: area.armies.indexOf(unit), distance, enemies,
          nearest: distance.get(enemies[0].id) ?? stage.graphDistance(area.id, enemies[0].id, 99) });
      }
    }
    rows.sort((a, b) => a.nearest - b.nearest || a.unit.id - b.unit.id);
    for (const row of rows) {
      const { area, unit, index, distance, enemies } = row;
      const canLeave = !mustHold.has(area.id) || area.armies.length > 1;
      if (index > 0) return { type: 'frontArmy', from: area.id, armyId: unit.id };
      const attacks = enemies.filter(target => target.armies?.length &&
        stage.attackable(area.id, target.id, index, game.airstrikeRadius()) &&
        (canLeave || !stage.adjacent(area.id, target.id)) &&
        ((record => !record || target.armies.reduce((sum, a) => sum + a.hp, 0) < record.hp || record.count < profile.maxZeroGainAttacks)
          (attempts.get(`${orderId}:${unit.id}:${target.id}`))));
      if (attacks.length) {
        const target = attacks[0], key = `${orderId}:${unit.id}:${target.id}`;
        const hp = target.armies.reduce((sum, a) => sum + a.hp, 0), prior = attempts.get(key);
        attempts.set(key, { hp, count: prior && hp >= prior.hp ? prior.count + 1 : 1 });
        return { type: 'attack', from: area.id, to: target.id, armyId: unit.id };
      }
      if (!canLeave) continue;
      const target = enemies[0];
      let moves = [];
      for (const dest of stage.areas) {
        if (dest.id === area.id || !stage.enabled.has(dest.id)) continue;
        if (dest.country !== country && !dest.sea && !enemy(game, country, dest)) continue;
        if (ao && enemy(game, country, dest) && !ao.has(dest.id)) continue;
        if (dest.armies?.length && dest.country !== country) continue;
        const path = stage.movementPath(area.id, dest.id, index);
        if (!path || path.cost > unit.movement || path.cost <= 0) continue;
        if (ao && path.ids.slice(1).some(id => enemy(game, country, stage.st(id)) && !ao.has(id))) continue;
        const onward = distances(game, country, dest.id).get(target.id) ?? Infinity;
        if (onward < distance.get(target.id)) moves.push({ dest, path, onward });
      }
      moves.sort((a, b) => a.onward - b.onward || b.path.cost - a.path.cost || a.dest.id - b.dest.id);
      if (moves.length) return { type: 'move', from: area.id, to: moves[0].dest.id, armyId: unit.id };
    }
    return null;
  };
}
