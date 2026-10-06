import { customCardReason } from '../sandbox_actions.js';
import { applyAction, evaluateCondition } from './scenario_events.js';
import { supplyCapacity } from '../supply.js';
// Air-force card paths ported from orig_easytech.so:
// CCountry::CheckCardTargetArea (RVA 0x48348), GetMinDstToAirport (0x47d14),
// CFight::AirStrikesAttack (0x46954), and CFight::ApplyResult (0x46a80).
import { register } from '../commands.js';
import { EV } from '../events.js';
import { World } from '../world.js';
import { armyMaxHp, commanderInstantRecovery, handleUnitKilled, recomputeAdjacentEncirclement, reduceConstructionLevel, resolveAirStrike, upgradeArmy } from './combatModel.js';
import { tacticalBonus } from '../army_groups.js';

const AIR_CARD_TYPES = new Map([[10, 1], [11, 2], [12, 4], [13, 3]]);
const ARMY_CARD_TYPES = new Map([[0, 'infantry'], [1, 'panzer'], [2, 'artillery'], [3, 'rocket'], [4, 'tank'], [5, 'heavytank'], [28, 'eliteinfantry'], [6, 'destroyer'], [7, 'cruiser'], [8, 'battleship'], [9, 'aircraftcarrier']]);
const DEVELOPMENT_CARDS = new Map([[14, 'city'], [15, 'industry'], [16, 'airport'], [17, 'fort'], [18, 'entrenchment'], [19, 'antiaircraft'], [20, 'radar']]);
import { TACTIC_CARDS } from '../tactics.js';
const NAVY_TYPES = new Set(['destroyer', 'cruiser', 'battleship', 'aircraftcarrier']);
const cityLevel = area => Math.max(area.areaType === 1 ? 3 : area.areaType === 3 ? 2 : area.areaType === 4 ? 1 : 0,
  area.construction === 'city' ? area.level || 0 : 0);
const industryLevel = area => Math.max(area.areaType === 1 ? 2 : area.areaType === 3 ? 1 : 0,
  area.construction === 'industry' ? area.level || 0 : 0);
const summonAllowed = (cardId, area) => {
  const city = cityLevel(area), industry = industryLevel(area);
  if (cardId === 0) return city > 2;
  if (cardId === 1 || cardId === 2) return industry > 0;
  if (cardId === 3 || cardId === 5) return industry > 2;
  if (cardId === 4) return industry > 1;
  if (cardId === 28) return city > 3 || industry > 0;
  return true;
};

function applyRecruitMedals(game, country, area, army) {
  if (country !== game.player) return;
  const medals = game.medalLevels;
  const type = army.type;
  if (medals.navy >= 1 && !NAVY_TYPES.has(type)) army.cards |= 4;
  if (type === 'infantry') {
    const upgrades = medals.infantry >= 2 ? 2 : medals.infantry >= 1 ? 1 : 0;
    for (let i = 0; i < upgrades; i++) upgradeArmy(game.stage, area, army);
    if (medals.infantry >= 3) army.cards |= 1 | 2;
  }
  const upgrades =
    type === 'artillery' && medals.artillery >= 1 || type === 'rocket' && medals.artillery >= 2 ||
    type === 'panzer' && medals.armour >= 1 || type === 'tank' && medals.armour >= 2 ||
    type === 'heavytank' && medals.armour >= 3 ||
    (type === 'destroyer' || type === 'cruiser') && medals.navy >= 2 ||
    (type === 'battleship' || type === 'aircraftcarrier') && medals.navy >= 3 ? 1 : 0;
  if (upgrades) upgradeArmy(game.stage, area, army);
  if ((type === 'artillery' || type === 'rocket') && medals.artillery >= 3) army.cards |= 2;
}

// The native CArea layout has armyPos at +0xc and constructionPos at +0x14.
// These are pts[0] and pts[1] in the area1.bin-derived map data.
export function minDistanceToAirport(stage, country, targetId) {
  const target = World.areas?.[targetId]?.pts?.[0];
  if (!target) return -1;
  let squared = Infinity;
  for (const area of stage.areas) {
    if (area.country !== country || area.construction !== 'airport') continue;
    const airport = World.areas?.[area.id]?.pts?.[1];
    if (!airport) continue;
    const dx = target[0] - airport[0], dy = target[1] - airport[1];
    squared = Math.min(squared, dx * dx + dy * dy);
  }
  return Number.isFinite(squared) ? Math.sqrt(squared) : -1;
}

register('useCard', {
  validate(game, cmd) {
    const country = cmd.country || game.activeCountry;
    if (country !== game.activeCountry) return 'not-active-country';
    const card = game.findCard(cmd.card, country);
    if (!card) return 'unknown-card';
    if(card.custom){const why=customCardReason(game,card,cmd,country);if(why)return why;if((card.conditions||[]).some(c=>!evaluateCondition(game,c)))return 'conditions-not-met';return cmd.pendingPurchase?game.whyNot(card,country):country!==game.player||!game.hand[card.id]?'no-card':(game.cardCooldowns[card.id]||0)>0?'cooldown':null;}
    if(game.stage.st(cmd.target)?.transitOwner&&(ARMY_CARD_TYPES.has(card.id)||DEVELOPMENT_CARDS.has(card.id)))return 'allied-transit-area';
    const type = AIR_CARD_TYPES.get(card.id);
    const armyType = ARMY_CARD_TYPES.get(card.id), development = DEVELOPMENT_CARDS.get(card.id), tactic = TACTIC_CARDS.get(card.id);
    const isPending = !!cmd.pendingPurchase;
    if (isPending) {
      const whyNot = game.whyNot(card, country);
      if (whyNot) return whyNot;
    } else {
      if (country !== game.player) return 'no-card';
      if (!game.hand[card.id]) return 'no-card';
      if ((game.cardCooldowns[card.id] || 0) > 0) return 'cooldown';
    }
    if (armyType || development || tactic || card.id === 26 || card.id === 27) {
      const area = game.stage.st(cmd.target);
      if (!area || !game.stage.enabled.has(cmd.target) || area.country !== country) return 'illegal-target';
      if (armyType) {
        if (game.recruitWait > 0 && game.capturedAt?.[area.id] != null && game.round - game.capturedAt[area.id] < game.recruitWait) return 'recently-captured';
        if (area.armies.length >= game.stage.maxArmies(area)) return 'illegal-target';
        const navy = NAVY_TYPES.has(armyType);
        if (navy !== !!area.sea) return 'illegal-target';
        if (navy && area.areaType !== 2) return 'illegal-target';
        if (!navy && !summonAllowed(card.id, area)) return 'illegal-target';
      } else if (development && area.sea) {
        return 'illegal-target';
      }
      if (development) {
        if (development === 'city' || development === 'industry' || development === 'airport') {
          const cap = development === 'city' ? 4 : development === 'industry' ? 3 : 1;
          if (area.construction !== 'none' && (area.construction !== development || area.level >= cap)) return 'illegal-target';
        } else if (area.installation !== 'none') return 'illegal-target';
      }
      const targetArmy = cmd.armyId == null ? area.armies[0] : area.armies.find(army => army.id === cmd.armyId);
      if (tactic && (!targetArmy || (targetArmy.cards & tactic) ||
          (tactic === 4 && NAVY_TYPES.has(targetArmy.type)))) return 'illegal-target';
      if (tactic === 8) {
        const info = game.stage.countries.get(country);
        if (info?.commanderAlive || (info?.commanderTurn || 0) > 0) return 'commander-unavailable';
      }
      if (card.id === 26 && (!supplyCapacity(game, area) || !area.armies.some(army => army.hp < army.maxHp))) return 'illegal-target';
      if (card.id === 27 && (!area.armies.length || area.armies[0].level >= 4)) return 'illegal-target';
      return null;
    }
    if (!type) return 'not-implemented';
    const st = game.stage, area = st.st(cmd.target);
    if (!area || !st.enabled.has(cmd.target)) return 'illegal-target';
    if (type === 4) {
      if (area.sea || area.armies.length >= game.stage.maxArmies(area)) return 'illegal-target';
      if (area.country !== country && area.armies.length !== 0) return 'illegal-target';
    } else if (area.country === country || area.armies.length === 0) return 'illegal-target';
    const distance = minDistanceToAirport(st, country, cmd.target);
    if (distance <= 0 || distance >= game.airstrikeRadius()) return 'out-of-range';
    return null;
  },
  execute(game, cmd) {
    const country = cmd.country || game.activeCountry;
    const card = game.findCard(cmd.card, country), type = AIR_CARD_TYPES.get(card.id);
    const area = game.stage.st(cmd.target);
    if(card.custom){consumeCard(game,card,cmd.target,cmd.pendingPurchase,country);const resolve=effect=>{const action=structuredClone(effect);if(action.area==='target')action.area=cmd.target;if(action.country==='actor')action.country=country;if(action.country==='target')action.country=area?.country;if(action.actions)action.actions=action.actions.map(resolve);return action;};for(const effect of card.effects)applyAction(game,resolve(effect));return;}
    const armyType = ARMY_CARD_TYPES.get(card.id), development = DEVELOPMENT_CARDS.get(card.id), tactic = TACTIC_CARDS.get(card.id);
    if (armyType || development || tactic || card.id === 26 || card.id === 27) {
      if (armyType) {
        const army = game.spawnArmy(area, armyType);
        applyRecruitMedals(game, country, area, army);
        game.emit(EV.UNIT_DEPLOYED, { area: area.id, armyId: army.id, armyType, country,
          level: army.level, cards: army.cards, hp: army.hp, maxHp: army.maxHp, movement: army.movement });
      } else if (development) {
        if (development === 'city' || development === 'industry' || development === 'airport') {
          if (area.construction === development) area.level += 1;
          else {
            area.construction = development;
            area.level = development === 'city' ?
              (area.areaType === 1 ? 4 : area.areaType === 3 ? 3 : area.areaType === 4 ? 2 : 1) :
              development === 'industry' ? (area.areaType === 1 ? 3 : area.areaType === 3 ? 2 : 1) : 1;
          }
        } else {
          area.installation = development;
        }
        const wallet = country === game.player ? game : game.stage.countries.get(country);
        game.emit(EV.RESOURCES_CHANGED, { country, money: wallet.money, industry: wallet.industry });
      } else if (tactic) {
        const army = cmd.armyId == null ? area.armies[0] : area.armies.find(army => army.id === cmd.armyId);
        army.cards = (army.cards || 0) | tactic;
        if (tactic === 8) {
          const info = game.stage.countries.get(country), oldMaxHp = army.maxHp;
          info.commanderAlive = true;
          army.hp = Math.min(oldMaxHp, army.hp + commanderInstantRecovery(info.commanderLevel));
          const def = game.stage.armyDef(country, army);
          army.maxHp = armyMaxHp(def.maxHp || 100, army.level, info.commanderLevel, true);
          army.hp = Math.min(army.maxHp, Math.trunc(army.hp * army.maxHp / oldMaxHp));
        }
      } else if (card.id === 26) {
        // Share a tile-wide budget equally; redistribute unused shares from full units.
        const wounded = area.armies.filter(army => army.hp < army.maxHp);
        const hpBefore = new Map(wounded.map(army => [army.id, army.hp]));
        let remaining = supplyCapacity(game, area);
        let eligible = wounded;
        while (remaining > 0 && eligible.length) {
          const share = Math.max(1, Math.floor(remaining / eligible.length));
          for (const army of eligible) {
            const restored = Math.min(share, army.maxHp - army.hp, remaining);
            army.hp += restored;
            remaining -= restored;
          }
          eligible = eligible.filter(army => army.hp < army.maxHp);
        }
        for (const army of wounded) {
          const before = hpBefore.get(army.id);
          if (army.hp > before) game.emit(EV.UNIT_HEALED, { country, area: area.id, armyId: army.id,
            hpBefore: before, hp: army.hp, maxHp: army.maxHp, restored: army.hp - before, cause: 'supplyLine' });
        }
      } else if (card.id === 27) {
        if (upgradeArmy(game.stage, area, area.armies[0]))
          game.emit(EV.UNIT_PROMOTED, { area: area.id, armyId: area.armies[0].id, level: area.armies[0].level });
      }
      consumeCard(game, card, area.id, cmd.pendingPurchase, country);
      return;
    }
    if (type === 4) {
      const previousOwner = area.country;
      if (previousOwner !== country) {
        area.country = country;
        game.emit(EV.AREA_CAPTURED, { area: area.id, from: previousOwner, to: country });
      }
      const army = game.spawnArmy(area, 'infantry');
      game.emit(EV.UNIT_DEPLOYED, { area: area.id, armyId: army.id, armyType: army.type, country });
      consumeCard(game, card, area.id, cmd.pendingPurchase, country);
      recomputeAdjacentEncirclement(game.stage, area.id, payload => game.emit(EV.MORALE_CHANGED, payload));
      return;
    }
    const { roll, damage } = resolveAirStrike(game.stage, country, area, type, country === game.player ? game.medalLevels.airforce || 0 : 0, game.rng);
    game.emit(EV.AIR_STRIKE, { country, card: card.id, target: area.id, roll, damage, strikeType: type });
    const hit = (index, loss) => {
      const army = area.armies[index];
      loss = Math.trunc(loss * tacticalBonus(game, area.country, army, { role: 'defend', fromAreaId: area.id }).received);
      if (loss > 0) {
        army.hp = Math.max(0, army.hp - loss);
        game.emit(EV.UNIT_DAMAGED, { area: area.id, armyId: army.id, hp: army.hp, lost: loss });
        if (army.hp === 0) {
          area.armies.splice(index, 1);
          handleUnitKilled(game, area, army, country, 'airStrike');
          game.emit(EV.UNIT_DESTROYED, { area: area.id, armyId: army.id, byCountry: country });
        }
      }
    };
    if (type === 1) {
      hit(0, damage);
    }
    if (type === 2) {
      // ApplyResult walks from the original last index down to zero. Each
      // rearward index loses another fifth, with C integer truncation.
      for (let index = area.armies.length - 1; index >= 0; index--) {
        hit(index, damage + Math.trunc(damage * index / -5));
      }
      if (area.installation !== 'antiaircraft') reduceConstructionLevel(area);
    }
    if (type === 3) {
      for (const army of area.armies) {
        handleUnitKilled(game, area, army, country, 'nuclearBomb');
        game.emit(EV.UNIT_DESTROYED, { area: area.id, armyId: army.id, byCountry: country });
      }
      area.armies.length = 0;
      area.construction = 'none';
      area.level = 0;
      area.installation = 'none';
      recomputeAdjacentEncirclement(game.stage, area.id, payload => game.emit(EV.MORALE_CHANGED, payload));
    }
    // Air-force attacks do not occupy the target.
    consumeCard(game, card, area.id, cmd.pendingPurchase, country);
    recomputeAdjacentEncirclement(game.stage, area.id, payload => game.emit(EV.MORALE_CHANGED, payload));
  },
});

function consumeCard(game, card, target, isPending = false, country = game.player) {
  const player = country === game.player;
  const wallet = player ? game : game.stage.countries.get(country);
  if (isPending) {
    const moneyCost = game.price(card, country), industryCost = game.industryCost(card, country);
    wallet.money -= moneyCost; wallet.industry -= industryCost;
    game.emit(EV.CARD_BOUGHT, {
      country, card: card.id, moneyCost, industryCost,
      moneyAfter: wallet.money, industryAfter: wallet.industry, handCount: player ? game.hand[card.id] || 0 : 0,
      techAfter: player ? game.tech : wallet.techlevel,
    });
    game.emit(EV.RESOURCES_CHANGED, { country, money: wallet.money, industry: wallet.industry });
  } else {
    game.hand[card.id]--;
    if (game.hand[card.id] === 0) delete game.hand[card.id];
  }
  const isBombingCard = card.id === 10 || card.id === 11 || card.id === 13;
  const cooldowns = player ? game.cardCooldowns : (wallet.cardCooldowns ||= {});
  cooldowns[card.id] = isBombingCard && player && (game.medalLevels.airforce || 0) > 2 ? 0 : (card.round || 0);
  game.emit(EV.CARD_USED, { country, card: card.id, target });
}
