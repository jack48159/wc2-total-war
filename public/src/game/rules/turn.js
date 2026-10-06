// Turn transition and country-controller dispatch.  Each country ends and
// begins its own turn; a player endTurn advances through the other countries
// before returning control to the player in the next round.
import { register } from '../commands.js';
import { EV } from '../events.js';
import { armyTurnRecovery, isNavalCombatUnit, nativeAlliance } from './combatModel.js';
import { checkVictory } from './victory.js';
import { evaluateEvents } from './scenario_events.js';
import { evaluateAiDiplomacy, tickCountryStability, DIPLOMACY_STATE } from './diplomacy.js';

/**
 * 中立国/和平国家恢复行动总开关 (NEUTRAL_WAKE_ENABLED)
 * 
 * - false (默认值，旧行为)：
 *   保持修复前的旧休眠判定。中立阵营(nativeAlliance===4)或外交开启时与任何国家均不处于战争状态的国家判定为休眠。
 * - true (新行为)：
 *   仅对未参战的永久中立国休眠；其余中立国及和平国家正常行动。
 * 
 * 切换方式：修改默认值或调用 setNeutralWakeEnabled(true/false)。
 */
export let NEUTRAL_WAKE_ENABLED = true;

export function setNeutralWakeEnabled(enabled) {
  NEUTRAL_WAKE_ENABLED = !!enabled;
}

const cityLevel = area => Math.max(area.areaType === 1 ? 3 : area.areaType === 3 ? 2 : area.areaType === 4 ? 1 : 0,
  area.construction === 'city' ? (area.level || 0) : 0);
const industryLevel = area => Math.max(area.areaType === 1 ? 2 : area.areaType === 3 ? 1 : 0,
  area.construction === 'industry' ? (area.level || 0) : 0);
const areaRest = area => {
  const base = area.areaType === 1 ? 9 : area.areaType === 3 ? 7 : area.areaType === 4 ? 5 : area.areaType === 2 ? 6 : 3;
  return base + 3 * Math.max(cityLevel(area), industryLevel(area));
};

export function endCountry(game, country, aiControlled = country !== game.player) {
  game.stage.useWorld();
  game.emit(EV.TURN_END, { country, round: game.round, ai: aiControlled });
  const countryInfo = game.stage.countries.get(country);
  if (countryInfo && !countryInfo.commanderAlive && countryInfo.commanderTurn > 0) countryInfo.commanderTurn -= 1;
  const cooldowns = country === game.player ? game.cardCooldowns : (game.stage.countries.get(country)?.cardCooldowns || {});
  for (const [cardId, rounds] of Object.entries(cooldowns)) {
    if (rounds > 0) cooldowns[cardId] = rounds - 1;
  }
  for (const area of game.stage.areas) {
    if (area.country !== country) continue;
    const rest = areaRest(area);
    const commanderLevel = game.stage.countries.get(country)?.commanderLevel;
    for (const army of area.armies) {
      // Native CArea::TurnEnd: unspent movement earns terrain/construction
      // recovery; army rank and commander recovery apply even when exhausted.
      const resting = army.movement > 0;
      const terrainRecovery = resting ? rest * (area.areaType === 2 && isNavalCombatUnit(army.type) ? 2 : 1) : 0;
      const rankRecovery = armyTurnRecovery(army, commanderLevel);
      const hpBefore = army.hp;
      army.hp = Math.min(army.maxHp, army.hp + terrainRecovery + rankRecovery);
      if (army.hp > hpBefore) game.emit(EV.UNIT_HEALED, { country, area: area.id, armyId: army.id,
        hpBefore, hp: army.hp, maxHp: army.maxHp, restored: army.hp - hpBefore,
        rest: terrainRecovery, rank: rankRecovery, movementBefore: army.movement });
      army.movement = 0;
      army.active = false;
      if (army.moraleUpTurn > 0) {
        army.moraleUpTurn -= 1;
        if (army.moraleUpTurn === 0) {
          army.morale = 0;
          game.emit(EV.MORALE_CHANGED, { country, area: area.id, armyId: army.id,
            morale: army.morale, moraleUpTurn: army.moraleUpTurn, reason: 'turn-end' });
        }
      }
    }
  }
  checkVictory(game, country);
  game.replayRecorder?.capture();
}

export function beginCountry(game, country, aiControlled = country !== game.player) {
  game.stage.useWorld();
  game.activeCountry = country;
  if (game.diplomacy?.enabled) {
    if (aiControlled) evaluateAiDiplomacy(game, country);
    else tickCountryStability(game, country);
  } else if (game.name.startsWith('battle_')) tickCountryStability(game, country);
  const info = game.stage.countries.get(country);
  const techTurn = country === game.player ? game.techTurn : info?.techTurn || 0;
  if (techTurn > 0) {
    if (country === game.player) {
      game.techTurn -= 1;
      if (game.techTurn === 0) game.tech = Math.min(5, game.tech + 1);
    } else {
      info.techTurn -= 1;
      if (info.techTurn === 0) info.techlevel = Math.min(5, info.techlevel + 1);
    }
  }
  if (game.round > 1) {
    const income = game.income(country);
    const wallet = country === game.player ? game : game.stage.countries.get(country);
    wallet.money = Math.max(0, Math.min(99999, wallet.money + income.money));
    wallet.industry = Math.max(0, Math.min(99999, wallet.industry + income.industry));
    game.emit(EV.RESOURCES_CHANGED, { country, money: wallet.money, industry: wallet.industry, income });
  }
  for (const area of game.stage.areas) {
    if (area.country !== country) continue;
    for (const army of area.armies) {
      army.movement = game.stage.armyDef(country, army).movement || 0;
      if (area.sea && !isNavalCombatUnit(army.type)) army.movement = Math.min(1, army.movement);
      army.active = army.movement > 0;
    }
  }
  game.emit(EV.TURN_BEGIN, { country, round: game.round, ai: aiControlled });
  game.replayRecorder?.capture(); if (country === game.player && game.executeAutoOrders) game.executeAutoOrders(country, 'turnStart');
}

export function getAiTurnSequence(game) {
  const st = game.stage;
  const order = st.data.countries.map(c => c.id);
  const playerIndex = order.indexOf(game.player);
  const seq = [];
  for (let offset = 1; offset < order.length; offset++) {
    const index = (playerIndex + offset) % order.length;
    seq.push({
      country: order[index],
      advanceRoundBefore: index === 0,
    });
  }
  return seq;
}

export function isDormantNeutral(game, country) {
  const st = game.stage;
  if (!NEUTRAL_WAKE_ENABLED) {
    if (nativeAlliance(st.alliance(country)) === 4) return true;
    if (!game.diplomacy?.enabled) return false;
    for (const other of st.countries.values()) {
      if (!other || other.id === country || other.eliminated) continue;
      if (game.getDiplomaticRelation(country, other.id) === DIPLOMACY_STATE.WAR) return false;
    }
    return true;
  }
  const info = st.countries.get(country);
  if (!info) return false;
  const aiRules = st.data?.ai_rules || game.diplomacy?.ai_rules || {};
  const permanentNeutrals = aiRules.permanent_neutrals || game.diplomacy?.permanent_neutrals || [];
  if (!info.traits?.includes('permanent_neutral') && !permanentNeutrals.includes(country)) return false;
  for (const other of st.countries.values()) {
    if (!other || other.id === country || other.eliminated) continue;
    if (game.getDiplomaticRelation(country, other.id) === DIPLOMACY_STATE.WAR) return false;
  }
  return true;
}

export function advanceRound(game) {
  game.stage.useWorld();
  game.round += 1;
  game.expireOrders?.();
  checkVictory(game, game.player);
}

export function finishRoundTransition(game, advancedRound) {
  if (!advancedRound) {
    advanceRound(game);
    if (game.phase === 'finished') return;
  }
  game.emit(EV.ROUND_BEGIN, { round: game.round, income: game.income() });
  evaluateEvents(game, 'roundBegin');
  beginCountry(game, game.player);
}

register('endTurn', {
  validate(game) { return game.activeCountry === game.player ? null : 'not-player-turn'; },
  execute(game) {
    const st = game.stage;
    endCountry(game, game.player);
    const seq = getAiTurnSequence(game);
    let advancedRound = false;
    for (const item of seq) {
      if (item.advanceRoundBefore) {
        advanceRound(game);
        advancedRound = true;
        if (game.phase === 'finished') return;
      }
      const country = item.country;
      if (st.countries.get(country)?.eliminated || isDormantNeutral(game, country)) continue;
      beginCountry(game, country);
      const controller = game.controllers?.get(country);
      const blocked = new Set();
      const inc = game.income?.(country);
      const incM = inc?.money || 50, incI = inc?.industry || 20;
      const cInfo = st.countries.get(country);
      const cMoney = country === game.player ? game.money : (cInfo?.money || 0);
      const cInd = country === game.player ? game.industry : (cInfo?.industry || 0);
      const hasSurplus = (cMoney > incM * 2.5) || (cInd > incI * 2.5);
      const maxActions = Math.min(80, Math.max(controller?.maxActions || 40, hasSurplus ? 65 : 40));
      for (let action = 0; action < maxActions; action++) {
        const command = controller?.commandsForTurn?.(game, country, blocked)?.[0];
        if (!command) break;
        const cmdKey = command.type === 'useCard' ? `card:${command.target}:${command.card}`
                     : command.type === 'buyCard' ? `buy:${command.card}`
                     : command.type === 'move' ? `move:${command.from}:${command.to}:${command.armyId}`
                     : command.type === 'attack' ? `attack:${command.from}:${command.to}:${command.armyId}`
                     : JSON.stringify(command);
        if (blocked.has(cmdKey)) break;
        const result = game.apply(command.type === 'setDiplomacy' || command.type === 'proposeDiplomacy'
          ? { ...command, aiIssued: true } : command);
        if (command.second === game.player && country !== game.player &&
            ((command.type === 'setDiplomacy' && ['peace', 'alliance'].includes(command.state)) ||
             (command.type === 'proposeDiplomacy' && ['peace', 'alliance', 'nap'].includes(command.action)))) {
          blocked.add(`consent:${command.type}:${command.first}:${command.second}:${command.state || command.action}`);
        }
        if (game.phase === 'finished') return;
        if (!result.ok) {
          blocked.add(cmdKey);
          if (command.target != null && command.card != null) blocked.add(`recruit:${command.target}:${command.card}`);
          if (command.armyId != null) blocked.add(command.armyId);
        }
      }
      endCountry(game, country);
    }
    finishRoundTransition(game, advancedRound);
  },
});

