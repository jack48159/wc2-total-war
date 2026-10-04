import { World } from '../../../world.js';
import { areaIncome } from '../../../game.js';
import { getDiplomaticRelation, stabilityIncomeMultiplier, DIPLOMACY_STATE } from '../../../rules/diplomacy.js';
import { countryGameView, visibilityForCountry } from '../../../rules/visibility.js';
import { traitDef } from '../../../rules/national_traits.js';
import { armyMaxHp } from '../../../rules/combatModel.js';
import { doctrineFor } from './doctrine.js';
import { clearExchangeMemo } from './estimate.js';
import { areaValue, unitValue } from './value.js';
import { threatMap, holdStrength, pLose, pLoseWithOccupants, pLoseAfterCapture, invalidateThreatMap } from './threat.js';

const NAVY_TYPES = new Set(['destroyer', 'cruiser', 'battleship', 'aircraftcarrier']);
const DEFAULT_MAX_ARMIES_PER_AREA = 4;
const DEFAULT_WI_ESTIMATE = 1.5;
const MAX_SEARCH_DEPTH_UNREACHABLE = 999;
const DEFAULT_AIRSTRIKE_RADIUS = 300;

export function getRelation(game, me, country) {
  if (!country || country === me) return 'self';
  const rel = getDiplomaticRelation(game, me, country);
  if (rel === DIPLOMACY_STATE.WAR) return 'enemy';
  if (rel === DIPLOMACY_STATE.ALLIANCE) return 'ally';
  if (rel === DIPLOMACY_STATE.PEACE) return 'peace';
  return 'neutral';
}

function computeWi(game) {
  const cards = game?.stage?.data?.cards?.others || [];
  const ratios = [];
  for (const c of cards) {
    if (c.industry > 0 && c.price > 0) {
      ratios.push(c.price / c.industry);
    }
  }
  if (!ratios.length) return DEFAULT_WI_ESTIMATE;
  ratios.sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 !== 0 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return Number.isFinite(median) && median > 0 ? median : DEFAULT_WI_ESTIMATE;
}

export function buildModel(gameInstance, country, opts = {}) {
  const game = (gameInstance.fogOfWar && !opts.skipFog) ? countryGameView(gameInstance, country) : gameInstance;
  const st = game.stage;
  const me = country;
  const round = game.round || 1;

  let stabMul = 1;
  if (game.diplomacy?.enabled) {
    stabMul = stabilityIncomeMultiplier(game.getStability(me));
    const info = st.countries?.get(me);
    const iron = traitDef(st.data?.traitCatalog, info, 'iron_fist');
    if (iron && stabMul < 1) stabMul = 1 - (1 - stabMul) * (iron.incomePenaltyScale ?? 0.4);
  }

  const wI = opts.wI ?? computeWi(game);

  // Capital detection without hardcoding
  const capId = game.diplomacy?.capitals?.[me];

  // One BFS per origin; the potential field asks for many destinations from
  // the same tile, so pair-by-pair BFS is unnecessarily expensive.
  const distCache = new Map();
  // Reach cache: unitId -> Map<areaId, {cost, path}>
  const reachCache = new Map();
  // isFront cache: areaId -> boolean
  const frontCache = new Map();

  function rel(c) {
    return getRelation(game, me, c);
  }

  function getAreaObj(rawArea) {
    if (!rawArea) return null;
    const isLand = !rawArea.sea && World.areas[rawArea.id]?.f !== 1;
    const isCap = (capId != null && capId === rawArea.id) || rawArea.areaType === 1;
    const inc = areaIncome(game, rawArea);
    const maxCap = st.maxArmies ? st.maxArmies(rawArea.id) : DEFAULT_MAX_ARMIES_PER_AREA;
    return {
      id: rawArea.id,
      land: isLand,
      sea: !isLand,
      owner: rawArea.country ?? null,
      construction: rawArea.construction || 'none',
      level: rawArea.level || 0,
      installation: rawArea.installation || 'none',
      areaType: rawArea.areaType || 0,
      cap: maxCap,
      stackCount: rawArea.armies?.length || 0,
      adj: st.adjE.get(rawArea.id) || [],
      isCapital: isCap,
      income: inc,
      armies: rawArea.armies || [],
    };
  }

  function getUnitObj(army, areaId) {
    if (!army) return null;
    const armyCountry = army.country || st.st(areaId)?.country || me;
    const def = st.armyDef ? st.armyDef(armyCountry, army.type) : {};
    const maxHp = army.maxHp ?? armyMaxHp(def?.maxHp ?? army.hp ?? 100, army.level || 0);
    const movement = army.movement ?? def.movement ?? 0;
    const maxMovement = def.movement ?? movement;
    const canAct = st.canAct ? st.canAct(army) : (movement > 0);
    const costMoney = def.price ?? def.cost?.money ?? 0;
    const costInd = def.industry ?? def.cost?.industry ?? 0;

    return {
      id: army.id,
      area: areaId,
      type: army.type,
      country: armyCountry,
      hp: army.hp ?? maxHp,
      maxHp: maxHp,
      level: army.level || 0,
      cards: army.cards || 0,
      morale: army.morale ?? 100,
      movement: movement,
      maxMovement: maxMovement,
      canAct: canAct,
      attackClass: def.attackClass ?? army.type,
      cost: { money: costMoney, industry: costInd },
      def: def,
      army: army,
    };
  }

  const model = {
    game,
    st,
    me,
    get round() { return gameInstance.round || 1; },
    revision: 0,
    wI,
    stabilityMul: stabMul,
    doctrine: opts.doctrine || doctrineFor(game, me),
    encirclementMemo: new Map(),
    rel,
    areaValue: (aId, opts) => areaValue(model, aId, opts),
    unitValue: (u) => unitValue(model, u),
    threatMap: () => threatMap(model),
    holdStrength: (aId, extra) => holdStrength(model, aId, extra),
    pLose: (aId, extra) => pLose(model, aId, extra),
    pLoseWithOccupants: (aId, occupants) => pLoseWithOccupants(model, aId, occupants),
    pLoseAfterCapture: (aId, occupants) => pLoseAfterCapture(model, aId, occupants),

    area(id) {
      const raw = st.st(id) || (st.ensureArea ? st.ensureArea(id, null) : null);
      return getAreaObj(raw);
    },

    get areas() {
      const list = [];
      for (const a of st.areas) {
        if (st.enabled && !st.enabled.has(a.id)) continue;
        list.push(getAreaObj(a));
      }
      return list;
    },

    get mine() {
      const list = [];
      for (const a of st.areas) {
        if (st.enabled && !st.enabled.has(a.id)) continue;
        if (a.country === me) list.push(getAreaObj(a));
      }
      return list;
    },

    get enemyAreas() {
      const list = [];
      for (const a of st.areas) {
        if (st.enabled && !st.enabled.has(a.id)) continue;
        if (a.country && rel(a.country) === 'enemy') list.push(getAreaObj(a));
      }
      return list;
    },

    get freeAreas() {
      const list = [];
      for (const a of st.areas) {
        if (st.enabled && !st.enabled.has(a.id)) continue;
        if (!a.country || rel(a.country) === 'neutral' || rel(a.country) === 'peace') {
          list.push(getAreaObj(a));
        }
      }
      return list;
    },

    get units() {
      const mine = [];
      const ally = [];
      const enemy = [];
      for (const a of st.areas) {
        if (st.enabled && !st.enabled.has(a.id)) continue;
        for (const u of a.armies || []) {
          const uObj = getUnitObj(u, a.id);
          const r = rel(uObj.country);
          if (r === 'self') mine.push(uObj);
          else if (r === 'ally') ally.push(uObj);
          else if (r === 'enemy') enemy.push(uObj);
        }
      }
      return { mine, ally, enemy };
    },

    dist(a, b) {
      const sId = typeof a === 'number' ? a : a?.id;
      const tId = typeof b === 'number' ? b : b?.id;
      if (sId === tId) return 0;
      if (sId == null || tId == null) return MAX_SEARCH_DEPTH_UNREACHABLE;

      if (distCache.has(sId)) return distCache.get(sId).get(tId) ?? MAX_SEARCH_DEPTH_UNREACHABLE;
      const queue = [sId];
      const visited = new Map([[sId, 0]]);
      for (let head = 0; head < queue.length; head++) {
        const curr = queue[head];
        const d = visited.get(curr);
        for (const next of st.adjE.get(curr) || []) {
          if (visited.has(next)) continue;
          const nextArea = st.st(next);
          const isSea = nextArea?.sea || World.areas[next]?.f === 1;
          if (isSea) continue;
          visited.set(next, d + 1);
          queue.push(next);
        }
      }

      distCache.set(sId, visited);
      return visited.get(tId) ?? MAX_SEARCH_DEPTH_UNREACHABLE;
    },

    isFront(areaInput) {
      const id = typeof areaInput === 'number' ? areaInput : areaInput?.id;
      if (id == null) return false;
      if (frontCache.has(id)) return frontCache.get(id);

      let front = false;
      for (const adjId of st.adjE.get(id) || []) {
        const adj = st.st(adjId);
        if (adj?.country && rel(adj.country) === 'enemy') {
          front = true;
          break;
        }
      }
      frontCache.set(id, front);
      return front;
    },

    reach(unitInput) {
      const army = unitInput.army || unitInput;
      const uId = army.id;
      if (reachCache.has(uId)) return reachCache.get(uId);

      const result = new Map();
      const sId = unitInput.area?.id ?? unitInput.area ?? army.area;
      const start = st.st(sId);
      if (!start || !st.enabled.has(sId)) {
        reachCache.set(uId, result);
        return result;
      }

      const idx = start.armies.findIndex(a => a.id === uId);
      if (idx < 0) {
        reachCache.set(uId, result);
        return result;
      }

      const budget = army.movement ?? st.armyDef(start.country, army.type).movement;
      if (budget <= 0) {
        reachCache.set(uId, result);
        return result;
      }

      const navy = NAVY_TYPES.has(army.type);
      const ai = start.country !== game.player;
      const view = id => st.st(id) || { id, country: null, armies: [], sea: World.areas[id]?.f === 1 };

      const canEnter = (area, id) => {
        if (!st.enabled.has(id) || area.armies.length >= st.maxArmies(id)) return false;
        if (area.armies.length && area.country !== start.country) return false;
        if (area.sea ? !navy && !(army.cards & 4) : navy) return false;
        if (area.country && area.country !== start.country && !area.sea) {
          if (game.diplomacy?.enabled) {
            if (!game.canOccupyTerritory(start.country, area.country, ai)) return false;
          } else if (ai && st.areAllied(start.country, area.country)) {
            return false;
          }
        }
        if (ai && st.armyDef(start.country, army.type).transportUnit && area.country !== start.country) return false;
        return true;
      };

      const canContinue = area => area.sea ? navy : area.country === start.country || area.armies.length === 0;

      const distance = new Map([[sId, 0]]);
      const previous = new Map();
      const pending = [[0, sId]];

      while (pending.length > 0) {
        pending.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const [cost, current] = pending.shift();
        if (cost !== distance.get(current)) continue;
        if (cost >= budget) continue;

        for (const next of st.adjE.get(current) || []) {
          const trait = World.areas[next];
          const entryCost = trait?.entryCosts?.[current] ?? trait?.movementCost ?? 1;
          const nextCost = cost + entryCost;
          if (nextCost > budget || (distance.has(next) && distance.get(next) <= nextCost)) continue;
          const area = view(next);
          if (!canEnter(area, next)) continue;

          distance.set(next, nextCost);
          previous.set(next, current);
          if (canContinue(area)) pending.push([nextCost, next]);
        }
      }

      for (const [destId, cost] of distance.entries()) {
        if (destId === sId) continue;
        const ids = [destId];
        let cur = destId;
        while (cur !== sId) {
          cur = previous.get(cur);
          if (cur == null) break;
          ids.unshift(cur);
        }
        if (ids[0] === sId) {
          result.set(destId, { cost, path: ids });
        }
      }

      reachCache.set(uId, result);
      return result;
    },

    attackTargets(unitInput, fromAreaInput = null) {
      const army = unitInput.army || unitInput;
      const sId = fromAreaInput != null
        ? (typeof fromAreaInput === 'number' ? fromAreaInput : fromAreaInput.id)
        : (unitInput.area?.id ?? unitInput.area ?? army.area);

      const s = st.st(sId);
      if (!s) return [];

      const originId = unitInput.area?.id ?? unitInput.area ?? army.area;
      const uCountry = army.country || unitInput.area?.country || st.st(originId)?.country || me;
      const def = st.armyDef ? st.armyDef(uCountry, army.type) : {};
      const targets = [];
      const airstrikeRadius = game.airstrikeRadius ? game.airstrikeRadius() : DEFAULT_AIRSTRIKE_RADIUS;
      const isEnemyTarget = (tCountry) => getRelation(game, uCountry, tCountry) === 'enemy';

      if (def.targetingMode === 'airstrike' || def.combatRadius > 0 || army.type === 'aircraftcarrier') {
        const fromPt = World.areas[sId]?.pts?.[0];
        if (fromPt) {
          const maxRadius = Math.min(def.maxCombatRadius || Infinity, def.combatRadius || airstrikeRadius);
          for (const tId of st.enabled || []) {
            if (tId === sId) continue;
            const t = st.st(tId);
            if (!t || !t.armies?.length) continue;
            if (!isEnemyTarget(t.country)) continue;
            if (game.fogOfWar && !visibilityForCountry(game, s.country).has(tId)) continue;
            const toPt = World.areas[tId]?.pts?.[0];
            if (!toPt) continue;
            const dist = Math.hypot(fromPt[0] - toPt[0], fromPt[1] - toPt[1]);
            if (dist > 0 && dist < maxRadius) targets.push(tId);
          }
        }
      } else if (def.targetingMode === 'range' || army.type === 'rocket') {
        const minR = def.minRange || 1;
        const maxR = def.maxRange || 2;
        // BFS up to maxR
        const q = [[sId, 0]];
        const seen = new Set([sId]);
        while (q.length > 0) {
          const [curr, d] = q.shift();
          if (d >= maxR) continue;
          for (const next of st.adjE.get(curr) || []) {
            if (seen.has(next)) continue;
            seen.add(next);
            const nextD = d + 1;
            if (nextD >= minR && nextD <= maxR) {
              const t = st.st(next);
              if (t && t.armies?.length > 0 && isEnemyTarget(t.country)) {
                if (!game.fogOfWar || visibilityForCountry(game, s.country).has(next)) {
                  targets.push(next);
                }
              }
            }
            q.push([next, nextD]);
          }
        }
      } else {
        // Adjacent
        for (const next of st.adjE.get(sId) || []) {
          const t = st.st(next);
          if (t && t.armies?.length > 0 && isEnemyTarget(t.country)) {
            if (!game.fogOfWar || visibilityForCountry(game, s.country).has(next)) {
              targets.push(next);
            }
          }
        }
      }

      return targets;
    },

    apply(cmd) {
      if (!cmd) return;
      if (cmd.type === 'move') {
        const s = st.st(cmd.from);
        const to = st.st(cmd.to) || (st.ensureArea ? st.ensureArea(cmd.to, null) : null);
        if (s && to) {
          const idx = s.armies.findIndex(a => a.id === cmd.armyId);
          if (idx >= 0) {
            const [a] = s.armies.splice(idx, 1);
            to.armies.unshift(a);
            if (cmd.cost != null) {
              a.movement = Math.max(0, (a.movement ?? 0) - cmd.cost);
            }
            if (to.country !== s.country && (!to.armies.length || to.armies.length === 1)) {
              to.country = s.country;
            }
          }
        }
      } else if (cmd.type === 'frontArmy') {
        const s = st.st(cmd.from);
        if (s) {
          const idx = s.armies.findIndex(a => a.id === cmd.armyId);
          if (idx > 0) {
            const [a] = s.armies.splice(idx, 1);
            s.armies.unshift(a);
          }
        }
      }
      reachCache.clear();
      frontCache.clear();
    },

    sync() {
      model.revision++;
      distCache.clear();
      reachCache.clear();
      frontCache.clear();
      invalidateThreatMap(model);
      clearExchangeMemo(model);
      model.encirclementMemo.clear();
    }
  };

  return model;
}
