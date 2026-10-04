import { nativeAlliance } from '../../rules/combatModel.js';
import { World } from '../../world.js';
import { shopCards } from '../../cards.js';
import { handlerFor } from '../../commands.js';

export const RECRUIT_TYPES = new Map([
  [0, 'infantry'], [1, 'panzer'], [2, 'artillery'], [3, 'rocket'],
  [4, 'tank'], [5, 'heavytank'], [6, 'destroyer'], [7, 'cruiser'],
  [8, 'battleship'], [9, 'aircraftcarrier'], [28, 'eliteinfantry']
]);
export const NAVY_TYPES = new Set(['destroyer', 'cruiser', 'battleship', 'aircraftcarrier']);

export function isEnemy(st, country, area) {
  if (!area || !area.country) return false;
  const a1 = nativeAlliance(st.alliance(area.country));
  const a2 = nativeAlliance(st.alliance(country));
  return a1 !== a2 && a1 !== 4 && a2 !== 4;
}

export function isHostile(st, country, area) {
  return isEnemy(st, country, area) || (area.country == null && !area.sea);
}

export function areaValue(a) {
  if (!a) return 0;
  if (a.areaType === 4) return 600; // Capital
  if (a.construction === 'city') return 360 + (a.level || 0) * 40;
  if (a.construction === 'industry') return 300 + (a.level || 0) * 35;
  if (a.areaType === 1) return 250; // Core city
  if (a.areaType === 3) return 180; // Secondary city
  return 40;
}

export function areaAt(st, id) {
  return st.st(id) || {
    id, country: null, armies: [], construction: 'none', level: 0,
    areaType: World.areas[id]?.areaType ?? 0, sea: World.areas[id]?.f === 1
  };
}

export function nearestStep(st, from, unitIndex, predicate) {
  const unit = from.armies[unitIndex];
  if (!unit) return null;
  const farthestReachable = route => {
    for (let i = route.length - 1; i > 0; i--) {
      if (st.moveable(from.id, route[i], unitIndex)) return route[i];
    }
    return null;
  };
  const seen = new Set([from.id]), queue = [[from, [from.id]]];
  while (queue.length) {
    const [area, route] = queue.shift();
    if (area !== from && predicate(area)) {
      const reachable = farthestReachable(route);
      if (reachable != null) return reachable;
    }
    for (const id of st.adjE.get(area.id) || []) {
      if (seen.has(id)) continue;
      const next = areaAt(st, id);
      if (next.armies.length && isEnemy(st, from.country, next)) {
        if (predicate(next)) {
          const reachable = farthestReachable(route);
          if (reachable != null) return reachable;
        }
        continue;
      }
      if (area === from && !st.moveable(from.id, id, unitIndex)) continue;
      if (next.sea && !NAVY_TYPES.has(unit.type) && !predicate(next)) continue;
      seen.add(id);
      queue.push([next, [...route, id]]);
    }
  }
  return null;
}

export function getAffordableCards(game, country) {
  const st = game.stage;
  const flag = st.countries.get(country)?.flag;
  return shopCards(game.cardData, flag).filter(c => !game.whyNot(c, country));
}
