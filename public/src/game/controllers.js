import { nativeAlliance } from './rules/combatModel.js';
import { World } from './world.js';
import { shopCards } from './cards.js';
import { handlerFor } from './commands.js';
import { StrongAi, evaluateAiDeclareWar } from './ai/strong.js';
import { HqAi } from './ai/hq/index.js';
import { countryGameView } from './rules/visibility.js';

const RECRUIT_TYPES = new Map([[0, 'infantry'], [1, 'panzer'], [2, 'artillery'], [3, 'rocket'],
  [4, 'tank'], [5, 'heavytank'], [6, 'destroyer'], [7, 'cruiser'], [8, 'battleship'],
  [9, 'aircraftcarrier'], [28, 'eliteinfantry']]);
const NAVY_TYPES = new Set(['destroyer', 'cruiser', 'battleship', 'aircraftcarrier']);

// Who decides a country's actions. Phase 3's turn loop will do, for every country in order:
//     const cmds = await controller.takeTurn(game, countryId);  cmds.forEach(c => game.apply(c));
// so the built-in AI, the LLM loop (Options > 接管 scheme 1) and the MCP bridge (scheme 2) are all just Controllers.

export { Controller } from './controller_base.js';
import { Controller } from './controller_base.js';

// Input comes from the battle UI, which calls game.apply() itself; nothing to compute here.
export class HumanController extends Controller {}

// Deterministic native-style controller with strategic & economic enhancements
export class ScriptedAi extends Controller {
  constructor(options = {}) {
    super();
    this.maxActions = options.maxActions || 40;
    this.unitMoveHistory = new Map(); // unitId -> lastFromId
    this._turnPlan = null;
    this._lastTurnKey = null;
  }

  async takeTurn(game, country) { return this.commandsForTurn(game, country); }

  commandsForTurn(game, country, excluded = new Set()) {
    if (game.fogOfWar) game = countryGameView(game, country);
    const isExcluded = c => {
      if (!excluded || excluded.size === 0) return false;
      if (c.armyId != null && excluded.has(c.armyId)) return true;
      if (c.type === 'useCard') {
        if (excluded.has(`recruit:${c.target}:${c.card}`) || excluded.has(`card:${c.target}:${c.card}`)) return true;
      }
      if (c.type === 'buyCard' && excluded.has(`buy:${c.card}`)) return true;
      if (c.type === 'move' && excluded.has(`move:${c.from}:${c.to}:${c.armyId}`)) return true;
      if (c.type === 'attack' && excluded.has(`attack:${c.from}:${c.to}:${c.armyId}`)) return true;
      return false;
    };

    const turnKey = `${game.round}:${country}`;
    if (this._lastTurnKey !== turnKey) {
      this._lastTurnKey = turnKey;
      this._turnPlan = null;
    }

    if (this._turnPlan && this._turnPlan.length > 0) {
      while (this._turnPlan.length > 0) {
        const nextCmd = this._turnPlan.shift();
        if (isExcluded(nextCmd)) continue;
        const h = handlerFor(nextCmd.type);
        if (h?.validate && h.validate(game, nextCmd)) continue;
        if (nextCmd.type === 'move') {
          this.unitMoveHistory.set(nextCmd.armyId, nextCmd.from);
        }
        return [nextCmd];
      }
    }

    const st = game.stage, commands = [], planned = new Set();
    const areas = st.areas.filter(a => a.country === country && a.armies?.length);
    const countryInfo = st.countries.get(country);
    const wallet = country === game.player ? game : countryInfo;
    const techLevel = country === game.player ? game.tech : (countryInfo?.techlevel || 1);

    const enemy = a => {
      if (!a || a.country == null || a.country === country) return false;
      if (game?.diplomacy?.enabled) {
        return game.getDiplomaticRelation(country, a.country) === 1;
      }
      return nativeAlliance(st.alliance(a.country)) !== nativeAlliance(st.alliance(country)) && nativeAlliance(st.alliance(a.country)) !== 4;
    };
    const value = a => (a.areaType === 4 ? 600 : a.construction === 'city' ? 360 + (a.level || 0) * 40 : a.construction === 'industry' ? 300 + (a.level || 0) * 35 : 40);
    const hpRate = a => (a.maxHp > 0 ? a.hp / a.maxHp : 1);
    const isRemote = a => ['artillery', 'rocket'].includes(a.type);
    const areaAt = id => st.st(id) || { id, country: null, armies: [], construction: 'none', level: 0,
      areaType: World.areas[id]?.areaType ?? 0, sea: World.areas[id]?.f === 1 };

    if (game.diplomacy?.enabled && !excluded.has('ai_declare_war')) {
      const warCmd = evaluateAiDeclareWar(game, country);
      if (warCmd) {
        excluded.add('ai_declare_war');
        return [warCmd];
      }
    }

    const hasAnyLivingEnemy = Array.from(st.countries.values()).some(c => !c.eliminated && c.id !== country && enemy({ country: c.id }));

    const canAfford = (cardId) => {
      const card = game.findCard(cardId, country);
      if (!card) return false;
      const mCost = game.price(card, country);
      const iCost = game.industryCost(card, country);
      if ((wallet?.money || 0) < mCost || (wallet?.industry || 0) < iCost) return false;
      return !game.whyNot(card, country);
    };

    const candidates = [];

    // --- STEP 1: TECHNOLOGY INVESTMENT (Card 21 Research) ---
    // If tech < 5, not upgrading, and sufficient resources, invest in technology
    if (canAfford(21) && techLevel < 5 && wallet.money >= 140 && wallet.industry >= 60) {
      if (!handlerFor('buyCard')?.validate(game, { type: 'buyCard', country, card: 21 })) {
        candidates.push({
          type: 'buyCard', country, card: 21,
          score: 1600, aiReason: 'research_technology'
        });
      }
    }

    let myCapital = (country === 'pl' && areas.some(a => a.id === 154)) ? areas.find(a => a.id === 154)
      : areas.find(a => a.areaType === 4 || (a.construction === 'city' && a.level >= 4));
    if (!myCapital) {
      myCapital = areas.filter(a => !a.sea).sort((a, b) => ((b.level || 0) + (b.areaType || 0)) - ((a.level || 0) + (a.areaType || 0)))[0];
    }

    // --- STEP 2: COMBAT ATTACKS ---
    const attackScore = (from, to, unit) => {
      const target = to.armies[0]; if (!target) return -Infinity;
      // Land units should NEVER attack warships at sea!
      if (!NAVY_TYPES.has(unit.type) && to.sea) {
        return -Infinity;
      }
      const targetValue = value(to), hp = Math.max(1, target.hp || target.maxHp || 1);
      const isRanged = isRemote(unit) || unit.type === 'aircraftcarrier';

      // Sole base preservation: if attacking from our sole continental stronghold, don't throw melee units into fortified full enemy stacks
      if (!isRanged && from.id === myCapital?.id && areas.filter(a => !a.sea).length <= 3) {
        const enemyTotalHp = to.armies.reduce((sum, u) => sum + (u.hp || 0), 0);
        if (enemyTotalHp > 100 && to.armies.length >= 2) {
          return -Infinity;
        }
      }
      const typeBonus = unit.type === 'artillery' ? (['infantry', 'panzer', 'tank'].includes(target.type) ? 500 : 200) : 0;
      const killBonus = hp <= Math.max(1, (unit.maxHp || 100) * 0.55) ? 350 : 0;
      const encircleBonus = to.armies.length > 0 && (st.adjE.get(to.id) || []).filter(id => st.st(id)?.country === country).length >= 2 ? 180 : 0;
      const isAmphibiousLanding = from.sea && !to.sea;
      const amphibiousBonus = isAmphibiousLanding ? 3500 : 0;
      return targetValue + typeBonus + killBonus + encircleBonus + (unit.movement || 0) * 10 + (isRanged ? 400 : 0) + amphibiousBonus;
    };

    const stepCache = new Map();
    const nearestStep = (from, unitIndex, predicate) => {
      const cacheKey = `${from.id}:${unitIndex}`;
      if (stepCache.has(cacheKey)) return stepCache.get(cacheKey);

      const army = from.armies[unitIndex];
      const isNavy = NAVY_TYPES.has(army?.type);
      const canSea = isNavy || !!(army?.cards & 4);

      // Precompute single-action reachable steps to avoid calling expensive Dijkstra inside search loop
      const validStep1 = new Set();
      for (const nid of (st.adjE.get(from.id) || [])) {
        if (st.moveable(from.id, nid, unitIndex)) validStep1.add(nid);
      }
      const uMovement = army.movement ?? st.armyDef(country, army.type).movement ?? 1;
      if (uMovement > 1) {
        for (const mid of (st.adjE.get(from.id) || [])) {
          for (const nid of (st.adjE.get(mid) || [])) {
            if (!validStep1.has(nid) && st.moveable(from.id, nid, unitIndex)) validStep1.add(nid);
          }
        }
      }

      const farthestReachable = route => {
        for (let i = route.length - 1; i > 0; i--) {
          const id = route[i];
          if (validStep1.has(id)) {
            const cand = st.st(id);
            if (cand?.country === country && cand.armies.length >= st.maxArmies(cand.id)) continue;
            return id;
          }
        }
        return null;
      };
      const seen = new Set([from.id]), queue = [[from, [from.id], 0]];
      let res = null, bestPortStep = null, bestPortDist = Infinity;
      while (queue.length) {
        const [area, route, depth] = queue.shift();
        if (depth > 16) continue;

        if (!canSea && area !== from && area.country === country && !area.sea) {
          const adjList = st.adjE.get(area.id) || [];
          const isCoastal = adjList.some(id => st.st(id)?.sea);
          if (isCoastal && depth < bestPortDist) {
            const step = farthestReachable(route);
            if (step != null) {
              bestPortDist = depth;
              bestPortStep = step;
            }
          }
        }

        if (area !== from && predicate(area)) {
          const reachable = farthestReachable(route);
          if (reachable != null) { res = reachable; break; }
        }
        for (const id of st.adjE.get(area.id) || []) {
          if (seen.has(id)) continue;
          const next = areaAt(id);
          if (next.armies.length && enemy(next)) {
            if (predicate(next)) {
              const reachable = farthestReachable(route);
              if (reachable != null && res == null) { res = reachable; break; }
            }
            continue;
          }
          if (area === from && !st.moveable(from.id, id, unitIndex)) continue;
          if (!canSea && next.sea) continue;
          if (isNavy && !next.sea && next.areaType !== 2) continue;
          seen.add(id); queue.push([next, [...route, id], depth + 1]);
        }
        if (res != null) break;
      }
      if (res == null && !canSea && !(st.adjE.get(from.id) || []).some(id => st.st(id)?.sea)) {
        res = bestPortStep;
      }
      stepCache.set(cacheKey, res);
      return res;
    };


    // --- STEP 1.5: SCRIPTED AI AMPHIBIOUS EMBARKATION (Card 22) ---
    if (canAfford(22) && wallet.money >= 40) {
      const activeTransports = areas.reduce((sum, a) => sum + a.armies.filter(u => (u.cards & 4) && !NAVY_TYPES.has(u.type)).length, 0);
      const maxTransports = 20;
      if (activeTransports < maxTransports) {
        let embarkedThisTurn = 0;
        for (const from of areas) {
          if (from.sea || from.areaType === 4 || from.id === myCapital?.id) continue; // Never embark capital!
          const hasAdjacentLandEnemy = (st.adjE.get(from.id) || []).some(id => {
            const a = st.st(id);
            return a && !a.sea && enemy(a);
          });
          if (from.armies.length <= 1 && hasAdjacentLandEnemy) continue;
          const army = from.armies.find(u => u && !NAVY_TYPES.has(u.type) && !(u.cards & 4) && st.canAct(u));
          if (!army || (army.hp || 0) < 50) continue;
          const hasAdjacentSea = (st.adjE.get(from.id) || []).some(id => st.st(id)?.sea);
          if (hasAdjacentSea && hasAnyLivingEnemy && !excluded.has(`card22:${from.id}`)) {
            const cmd = { type: 'useCard', country, card: 22, target: from.id, pendingPurchase: true };
            if (!handlerFor('useCard')?.validate(game, cmd)) {
              candidates.push({ ...cmd, score: 2800, aiReason: 'scripted_ai_embark_transport' });
              if (++embarkedThisTurn >= 3) break;
            }
          }
        }
      }
    }

    let capitalArmiesLeft = myCapital?.armies?.length || 0;
    let rearArmiesLeft = 0;
    for (const a of areas) {
      if (a.sea || a.id === myCapital?.id) continue;
      const isAContact = (st.adjE.get(a.id) || []).some(nid => enemy(st.st(nid)));
      if (!isAContact) rearArmiesLeft += a.armies.length;
    }

    for (const from of areas) {
      const isCapital = from.areaType === 4 || from.id === myCapital?.id;
      const isFromContact = (st.adjE.get(from.id) || []).some(nid => enemy(st.st(nid)));

      for (let unitIndex = 0; unitIndex < from.armies.length; unitIndex++) {
        const unit = from.armies[unitIndex];
        if (!unit || !st.canAct(unit) || planned.has(unit.id) || excluded.has(unit.id)) continue;

        // Troops at sea in transports: if adjacent to a friendly continental beachhead with space, disembark immediately!
        if (from.sea && !NAVY_TYPES.has(unit.type) && (unit.cards & 4)) {
          let beachhead = null;
          for (const nid of (st.adjE.get(from.id) || [])) {
            const na = areaAt(nid);
            if (na && !na.sea && na.country === country && na.armies.length < st.maxArmies(na.id) && st.moveable(from.id, na.id, unitIndex)) {
              const isIsolatedIsland = (st.adjE.get(na.id) || []).every(id => st.st(id)?.sea);
              if (isIsolatedIsland) continue;
              beachhead = na.id;
              break;
            }
          }
          if (beachhead != null) {
            candidates.push({
              type: 'move', from: from.id, to: beachhead, armyId: unit.id,
              aiScore: 4800, aiReason: 'amphibious_disembark_onto_beachhead', score: 4800
            });
            continue;
          }
        }

        let best = null;
        const targets = unit.type === 'rocket' || unit.type === 'aircraftcarrier' ? st.enabled : (st.adjE.get(from.id) || []);
        for (const id of targets) {
          const to = st.st(id); if (!to || !enemy(to) || !st.attackable(from.id, to.id, unitIndex, game.airstrikeRadius())) continue;
          const score = attackScore(from, to, unit);
          if (!best || score > best.score) best = { type: 'attack', from: from.id, to: to.id, armyId: unit.id, aiScore: score, aiReason: unit.type === 'artillery' ? 'artillery_target_priority' : 'highest_value_attack', score };
        }
        if (best && best.score > 0) { candidates.push(best); continue; }

        // Movement: avoid pointless wandering if at peace
        if (!hasAnyLivingEnemy) continue;

        // Depth & Capital protection checks before moving
        if (isCapital && capitalArmiesLeft <= 2 && areas.length > 1) {
          continue; // Reserve at least 2 garrisons in capital
        }
        if (!isFromContact && !from.sea && !isCapital && rearArmiesLeft <= 3) {
          continue; // Reserve at least 3 mobile reserve units in rear depth
        }

        let destination = null;
        if (hpRate(unit) < 0.45) {
          destination = nearestStep(from, unitIndex, a => a.country === country && !a.armies.some(x => enemy(a)) &&
            (a.construction === (isRemote(unit) ? 'industry' : 'city') || a.areaType === 4));
        }

        // Special priority for troops on sea:
        if (!destination && from.sea && !NAVY_TYPES.has(unit.type) && (unit.cards & 4)) {
          // (a) First priority: step into adjacent unoccupied enemy/neutral land (beachhead landing)
          for (const nid of (st.adjE.get(from.id) || [])) {
            const na = areaAt(nid);
            if (na && !na.sea && (enemy(na) || na.country == null) && na.armies.length === 0 && st.moveable(from.id, na.id, unitIndex)) {
              destination = na.id;
              break;
            }
          }
          // (b) Second priority: step onto adjacent friendly land that has room! (amphibious disembark / consolidate foothold)
          if (!destination) {
            for (const nid of (st.adjE.get(from.id) || [])) {
              const na = areaAt(nid);
              if (na && !na.sea && na.country === country && na.armies.length < st.maxArmies(na.id) && st.moveable(from.id, na.id, unitIndex)) {
                const isIsolatedIsland = (st.adjE.get(na.id) || []).every(id => st.st(id)?.sea);
                if (isIsolatedIsland) continue;
                destination = na.id;
                break;
              }
            }
          }
        }

        if (!destination) destination = nearestStep(from, unitIndex, a => {
          if (from.sea && !NAVY_TYPES.has(unit.type)) {
            const isIsolatedIsland = (st.adjE.get(a.id) || []).every(id => st.st(id)?.sea);
            if (isIsolatedIsland) return false;
            return !a.sea && (enemy(a) || (a.country === country && a.armies.length < st.maxArmies(a.id)));
          }
          return enemy(a) || (a.country == null && value(a) > 100);
        });

        // Suppress A->B->A ping-pong oscillation
        const lastFrom = this.unitMoveHistory.get(unit.id);
        if (destination != null && destination === lastFrom) {
          destination = null;
        }

        if (destination != null && st.moveable(from.id, destination, unitIndex)) {
          const isLeavingCapital = isCapital && destination !== from.id;
          if (isLeavingCapital && capitalArmiesLeft <= 2 && areas.length > 1) {
            continue;
          }
          const isLeavingRear = !isFromContact && !from.sea && !isCapital;
          const isGoingToContact = (st.adjE.get(destination) || []).some(nid => enemy(st.st(nid)));
          if (isLeavingRear && isGoingToContact && rearArmiesLeft <= 3) {
            continue;
          }

          if (isLeavingCapital) capitalArmiesLeft--;
          if (isLeavingRear && isGoingToContact) rearArmiesLeft--;

          const isLanding = from.sea && !areaAt(destination).sea;
          const moveScore = isLanding ? (areaAt(destination).country === country ? 4200 : 5000) : (2200 + value(areaAt(destination)));
          candidates.push({
            type: 'move', from: from.id, to: destination, armyId: unit.id,
            aiScore: moveScore,
            aiReason: isLanding ? 'amphibious_beachhead_landing' : (hpRate(unit) < 0.45 ? 'retreat_to_recovery' : 'advance_to_enemy'),
            score: moveScore
          });
        }
      }
    }

    // --- STEP 3: RECRUITMENT ---
    const flag = st.countries.get(country)?.flag;
    const cards = shopCards(game.cardData, flag).filter(card => {
      if (!RECRUIT_TYPES.has(card.id)) return false;
      const mCost = game.price(card, country);
      const iCost = game.industryCost(card, country);
      if ((wallet?.money || 0) < mCost || (wallet?.industry || 0) < iCost) return false;
      return !game.whyNot(card, country);
    });
    const inc = game.income?.(country);
    const incM = Math.max(20, inc?.money || 50);
    const incI = Math.max(10, inc?.industry || 20);
    const safeM = Math.max(0, wallet?.money || 0);
    const safeI = Math.max(0, wallet?.industry || 0);
    const moneyTurns = incM > 0 ? safeM / incM : 0;
    const indTurns = incI > 0 ? safeI / incI : 0;
    const moneyToIndRatio = (safeM + 1) / (safeI + 1);

    for (const area of st.areas) {
      if (area.country !== country || area.armies.length >= 4) continue;
      const adjacent = (st.adjE.get(area.id) || []).map(id => st.st(id)).filter(a => a && enemy(a));
      const threat = adjacent.reduce((sum, a) => sum + a.armies.reduce((hp, army) => hp + (army.hp || 0), 0), 0);
      const infantryThreat = adjacent.reduce((sum, a) => sum + a.armies.filter(x => x.type === 'infantry' || x.type === 'eliteinfantry').length, 0);
      const stackHp = area.armies.reduce((sum, army) => sum + (army.hp || 0), 0);
      const importance = value(area) + 2 * threat + (threat > 0 ? 80 : 0);
      const deficit = importance - stackHp;
      const isWealthy = wallet.money >= 180 || moneyTurns >= 1.5;
      if (deficit <= 0 && !isWealthy) continue;
      const maxGarrison = (moneyTurns >= 3.0 || wallet.money >= 400) ? 4 : (isWealthy ? 3 : 2);
      if (!adjacent.length && area.armies.length >= maxGarrison) continue;

      for (const card of cards) {
        const type = RECRUIT_TYPES.get(card.id), navy = NAVY_TYPES.has(type);
        if (navy !== !!area.sea || (navy && area.areaType !== 2)) continue;
        if (excluded.has(`recruit:${area.id}:${card.id}`)) continue;
        const indCost = game.industryCost(card, country);
        const recruit = { type: 'useCard', country, card: card.id, target: area.id, pendingPurchase: true };
        if (handlerFor('useCard')?.validate(game, recruit)) continue;
        const def = game.armyTypes?.[type] || {};

        // Dynamic resource balancing score
        let resourceBalanceScore = 0;
        if (moneyTurns >= 2.0 && (moneyToIndRatio >= 1.5 || indCost === 0)) {
          // Money is abundant relative to industry: heavily boost units that consume money
          if (indCost === 0) {
            resourceBalanceScore += Math.min(3000, 1000 + moneyTurns * 400);
          } else if (wallet.industry >= indCost) {
            resourceBalanceScore += Math.min(2000, 500 + moneyTurns * 200);
          }
        } else if (indTurns >= 1.5 && indTurns > moneyTurns) {
          // Industry is abundant relative to money: heavily boost mechanized units that consume industry,
          // and deprioritize zero-industry infantry so money is reserved for armor
          if (indCost >= 40) {
            resourceBalanceScore += Math.min(3500, 1500 + indTurns * 300 + indCost * 10);
          } else if (indCost === 0) {
            resourceBalanceScore -= 800; // Do not waste precious gold on zero-industry infantry!
          }
        }

        const indBonus = wallet.industry >= 120 ? (indCost * 2) : (-indCost / 4);
        let score = (def.maxHp || 0) + (def.maxAttack || 0) * 10 + (def.minAttack || 0) * 4 +
          (def.movement || 0) * 12 + (card.tech || 0) * 8 + value(area) / 20 + threat / 8 -
          game.price(card, country) / 8 + indBonus + resourceBalanceScore;
        if (type === 'panzer' && infantryThreat) score += 150 + infantryThreat * 35;
        if (area.areaType === 1 || area.areaType === 3) {
          if (type === 'infantry' || type === 'eliteinfantry') score += 70;
          if (type === 'artillery') score += 35;
        }
        if (area.construction === 'industry' && area.level >= 2 && ['tank', 'heavytank', 'rocket'].includes(type)) score += 70 + threat / 6;
        if (threat > 180 && ['artillery', 'rocket', 'heavytank'].includes(type)) score += 80;
        const isCap = area.areaType === 4 || area.id === myCapital?.id;
        const isRear = !adjacent.length && !area.sea && !isCap;
        let depthBonus = 0;
        if (isCap && area.armies.length < 2) {
          depthBonus = 3500;
        } else if ((area.construction === 'city' || area.construction === 'industry') && area.armies.length === 0) {
          depthBonus = 3000;
        } else if (isRear && rearArmiesLeft < 3) {
          depthBonus = 2500;
        }

        score += Math.min(300, Math.max(0, deficit) / 2) + (isWealthy ? 200 : 0) + depthBonus;
        candidates.push({ ...recruit, aiScore: score,
          aiReason: depthBonus > 0 ? (isCap ? 'emergency_capital_defense' : 'build_depth_reserves') : (threat > 0 ? 'reinforce_threatened_area' : 'build_local_force'), score });
      }
    }

    // --- STEP 4: REARRANGE FRONT LINE ---
    for (const area of areas) {
      if (area.armies.length <= 1) continue;
      const front = area.armies[0];
      const stackScore = army => (army.hp || 0) + (army.level || 0) * 18 + ((army.cards & 2) ? 40 : 0) + ((army.cards & 8) ? 45 : 0);
      let bestIndex = 0, bestScore = stackScore(front);
      for (let i = 1; i < area.armies.length; i++) {
        const sc = stackScore(area.armies[i]);
        if (sc > bestScore) { bestScore = sc; bestIndex = i; }
      }
      if (bestIndex !== 0 && (front.hp / (front.maxHp || 1) < 0.45 || bestScore > stackScore(front) + 35)) {
        const candidate = area.armies[bestIndex];
        candidates.push({
          type: 'frontArmy', from: area.id, armyId: candidate.id,
          score: 1200 + bestScore, aiReason: 'protect_stack_front',
        });
      }
    }

    // --- STEP 5: TACTICAL SUPPORT CARDS (Heal 26, Commander 25) ---
    if (canAfford(26)) {
      for (const area of areas) {
        const lostHp = area.armies.reduce((sum, a) => sum + ((a.maxHp || 100) - (a.hp || 0)), 0);
        const frontRatio = area.armies[0] ? area.armies[0].hp / (area.armies[0].maxHp || 1) : 1;
        if (lostHp >= 60 || frontRatio < 0.4) {
          candidates.push({
            type: 'useCard', country, card: 26, target: area.id, pendingPurchase: true,
            score: 1500 + lostHp, aiReason: 'heal_damaged_stack'
          });
          break;
        }
      }
    }

    if (canAfford(25) && countryInfo && !countryInfo.commanderAlive && (countryInfo.commanderTurn || 0) <= 0) {
      let bestUnitArea = null, bestWeight = 0;
      for (const area of areas) {
        const unit = area.armies[0];
        if (!unit || (unit.cards & 8)) continue;
        const rankWeight = ['heavytank', 'tank', 'battleship'].includes(unit.type) ? 300 :
                           ['artillery', 'cruiser', 'panzer'].includes(unit.type) ? 180 : 80;
        const adjacentEnemies = (st.adjE.get(area.id) || []).filter(id => enemy(st.st(id))).length;
        const weight = rankWeight + (unit.hp || 0) + (unit.level || 0) * 20 + adjacentEnemies * 40;
        if (weight > bestWeight) { bestWeight = weight; bestUnitArea = area; }
      }
      if (bestUnitArea && bestWeight > 200) {
        candidates.push({
          type: 'useCard', country, card: 25, target: bestUnitArea.id, pendingPurchase: true,
          score: 1800 + bestWeight, aiReason: 'assign_commander_to_premier_unit'
        });
      }
    }

    // --- STEP 6: CONTROLLED TACTICAL CARDS (Card 23 Assault / Card 24 Defence) ---
    const maxTacticalBuffs = indTurns >= 3.5 ? 4 : indTurns >= 2.0 ? 2 : 1;
    let tacticalBuffCount = 0;
    if (wallet.industry >= 80 && (wallet.money >= 50 || wallet.industry >= 150)) {
      for (const area of areas) {
        if (tacticalBuffCount >= maxTacticalBuffs) break;
        const unit = area.armies[0];
        if (!unit) continue;
        const isPremier = ['heavytank', 'tank'].includes(unit.type) || (unit.cards & 8) || (area.areaType === 4);
        if (!isPremier && indTurns < 2.5) continue;
        const isContact = (st.adjE.get(area.id) || []).some(id => enemy(st.st(id)));
        if (!isContact) continue;

        if (canAfford(23) && !(unit.cards & 1)) {
          const cmd = { type: 'useCard', country, card: 23, target: area.id, pendingPurchase: true };
          if (!handlerFor('useCard')?.validate(game, cmd)) {
            candidates.push({ ...cmd, score: 320 + value(area) / 10 + (indTurns >= 2.0 ? 1000 : 0), aiReason: 'buff_assault_on_premier_unit' });
            tacticalBuffCount++;
          }
        } else if (canAfford(24) && !(unit.cards & 2)) {
          const cmd = { type: 'useCard', country, card: 24, target: area.id, pendingPurchase: true };
          if (!handlerFor('useCard')?.validate(game, cmd)) {
            candidates.push({ ...cmd, score: 300 + value(area) / 10 + (indTurns >= 2.0 ? 1000 : 0), aiReason: 'buff_defence_on_premier_unit' });
            tacticalBuffCount++;
          }
        }
      }
    }

    // --- STEP 7: IDLE MONEY CONVERSION (Card 14 City & Card 15 Industry) ---
    // Dynamic economic balancing: when money is abundant, expand economy significantly
    if (wallet.money >= 70) {
      let econCount = 0;
      const maxEcon = moneyTurns >= 4.0 ? 6 : moneyTurns >= 2.5 ? 4 : moneyTurns >= 1.5 ? 3 : 2;
      const indIncomeRatio = incI / incM;
      const hasHeavyBase = areas.some(a => (a.construction === 'industry' && (a.level || 0) >= 2) || a.areaType === 1);
      const isStarvingForIndustry = (inc?.industry || 0) <= 5;
      const hasInfantryCity = areas.some(a => (a.construction === 'city' && (a.level || 0) >= 3) || a.areaType === 4);
      const shouldBuildIndustry = isStarvingForIndustry || (!hasHeavyBase || indIncomeRatio < 0.4 || (wallet.industry < 100 && moneyToIndRatio >= 1.2) || (moneyTurns >= 2.5 && indIncomeRatio < 0.55));
      for (const a of areas) {
        if (a.sea || econCount >= maxEcon) continue;
        if (shouldBuildIndustry && canAfford(15) && (a.construction === 'none' || (a.construction === 'industry' && a.level < 3))) {
          const cmd = { type: 'useCard', country, card: 15, target: a.id, pendingPurchase: true };
          if (!handlerFor('useCard')?.validate(game, cmd)) {
            const indScore = isStarvingForIndustry ? 4100 : (1400 + Math.min(400, moneyTurns * 100));
            candidates.push({ ...cmd, score: indScore, aiReason: isStarvingForIndustry ? 'bootstrap_critical_industry' : 'convert_surplus_money_to_industry' });
            econCount++;
          }
        } else if (canAfford(14) && (a.construction === 'none' || (a.construction === 'city' && a.level < 4))) {
          const cmd = { type: 'useCard', country, card: 14, target: a.id, pendingPurchase: true };
          if (!handlerFor('useCard')?.validate(game, cmd)) {
            const cityScore = !hasInfantryCity ? 4000 : (1300 + Math.min(400, moneyTurns * 100));
            candidates.push({ ...cmd, score: cityScore, aiReason: !hasInfantryCity ? 'bootstrap_infantry_city' : 'upgrade_city_with_surplus_money' });
            econCount++;
          }
        }
      }
    }

    // Fortifications to consume surplus industry: Land Fort (17) / Entrenchment (18)
    if ((indTurns >= 1.2 || wallet.industry >= 80) && (canAfford(17) || canAfford(18))) {
      let fortCount = 0;
      const maxForts = indTurns >= 2.5 ? 8 : 4;
      for (const a of areas) {
        if (a.sea || fortCount >= maxForts || a.installation !== 'none') continue;
        const isContact = (st.adjE.get(a.id) || []).some(id => enemy(st.st(id)));
        if (!isContact && a.areaType !== 4 && indTurns < 2.0) continue;
        if (canAfford(17)) {
          const cmd = { type: 'useCard', country, card: 17, target: a.id, pendingPurchase: true };
          if (!handlerFor('useCard')?.validate(game, cmd)) {
            candidates.push({ ...cmd, score: 1900 + Math.min(500, indTurns * 100), aiReason: 'build_fort_with_surplus_industry' });
            fortCount++;
          }
        } else if (canAfford(18)) {
          const cmd = { type: 'useCard', country, card: 18, target: a.id, pendingPurchase: true };
          if (!handlerFor('useCard')?.validate(game, cmd)) {
            candidates.push({ ...cmd, score: 1850 + Math.min(500, indTurns * 100), aiReason: 'build_entrenchment_with_surplus_industry' });
            fortCount++;
          }
        }
      }
    }


    candidates.sort((a, b) => b.score - a.score);
    for (const c of candidates) {
      if (commands.length >= this.maxActions) break;
      if (isExcluded(c)) continue;
      if (c.type === 'move') {
        this.unitMoveHistory.set(c.armyId, c.from);
      }
      if (c.armyId != null) planned.add(c.armyId);
      commands.push(c);
    }
    this._turnPlan = commands.slice(1);
    return commands;
  }
}

// Bridge for LLM / MCP takeover: hand game.describe() to the outside, wait for its commands.
export class ExternalController extends Controller {
  constructor(ask) { super(); this.ask = ask; }               // ask(stateObject) -> Promise<command[]>
  async takeTurn(game, country) {
    if (game.fogOfWar) game = countryGameView(game, country);
    return this.ask({ country, state: game.describe() });
  }
}

// Only the selected country is controlled by the local player. Allied countries
// with ai=false in scenario data still need their own turns and controller.
export function defaultControllers(stage, allAi = false) {
  return new Map(stage.data.countries.map(c => [c.id, (!allAi && c.id === stage.player) ? new HumanController() : new HqAi()]));
}

export function builtinAiControllers(stage) {
  return new Map(stage.data.countries.map(c => [c.id, new HqAi()]));
}

export function strongAiControllers(stage) {
  return new Map(stage.data.countries.map(c => [c.id, new HqAi()]));
}
