import { Controller } from '../../controller_base.js';
import { ScriptedAi } from '../../controllers.js';
import { isEnemy, getAffordableCards, nearestStep } from './helper.js';
import { handlerFor } from '../../commands.js';

export class GeneralStackAi extends Controller {
  constructor(options = {}) {
    super();
    this.maxActions = options.maxActions || 40;
    this.fallbackAi = new ScriptedAi();
  }

  commandsForTurn(game, country, blocked = new Set()) {
    const st = game.stage;
    const areas = st.areas.filter(a => a.country === country && a.armies?.length);
    const affordable = getAffordableCards(game, country);
    const countryInfo = st.countries.get(country);

    const generalCard = affordable.find(c => c.id === 25);
    if (generalCard && countryInfo && !countryInfo.commanderAlive && (countryInfo.commanderTurn || 0) <= 0) {
      let premierArea = null, premierScore = 0;
      for (const a of areas) {
        const u = a.armies[0];
        if (!u || (u.cards & 8)) continue;
        const score = (u.hp || 0) + (u.level || 0) * 20;
        if (score > premierScore) {
          premierScore = score;
          premierArea = a;
        }
      }
      if (premierArea) {
        const cmd = { type: 'useCard', country, card: 25, target: premierArea.id, pendingPurchase: true };
        if (!handlerFor('useCard')?.validate(game, cmd)) return [cmd];
      }
    }

    const commanderArea = areas.find(a => a.armies.some(u => u.cards & 8));
    if (commanderArea) {
      const generalUnit = commanderArea.armies.find(u => u.cards & 8);
      const promoCard = affordable.find(c => c.id === 27);
      if (promoCard && generalUnit && generalUnit.level < 4) {
        const cmd = { type: 'useCard', country, card: 27, target: commanderArea.id, pendingPurchase: true };
        if (!handlerFor('useCard')?.validate(game, cmd)) return [cmd];
      }
      const assaultCard = affordable.find(c => c.id === 23);
      if (assaultCard && generalUnit && !(generalUnit.cards & 1)) {
        const cmd = { type: 'useCard', country, card: 23, target: commanderArea.id, pendingPurchase: true };
        if (!handlerFor('useCard')?.validate(game, cmd)) return [cmd];
      }
      const defCard = affordable.find(c => c.id === 24);
      if (defCard && generalUnit && !(generalUnit.cards & 2)) {
        const cmd = { type: 'useCard', country, card: 24, target: commanderArea.id, pendingPurchase: true };
        if (!handlerFor('useCard')?.validate(game, cmd)) return [cmd];
      }
      const healCard = affordable.find(c => c.id === 26);
      if (healCard && generalUnit && generalUnit.hp < generalUnit.maxHp * 0.7) {
        const cmd = { type: 'useCard', country, card: 26, target: commanderArea.id, pendingPurchase: true };
        if (!handlerFor('useCard')?.validate(game, cmd)) return [cmd];
      }

      if (st.canAct(generalUnit) && !blocked.has(generalUnit.id)) {
        for (const id of (st.adjE.get(commanderArea.id) || [])) {
          const to = st.st(id);
          if (to && isEnemy(st, country, to) && st.attackable(commanderArea.id, to.id, 0, game.airstrikeRadius())) {
            return [{ type: 'attack', from: commanderArea.id, to: to.id, armyId: generalUnit.id }];
          }
        }
        const dest = nearestStep(st, commanderArea, 0, a => isEnemy(st, country, a));
        if (dest != null && st.moveable(commanderArea.id, dest, 0)) {
          return [{ type: 'move', from: commanderArea.id, to: dest, armyId: generalUnit.id }];
        }
      }
    }

    return this.fallbackAi.commandsForTurn(game, country, blocked);
  }
}
