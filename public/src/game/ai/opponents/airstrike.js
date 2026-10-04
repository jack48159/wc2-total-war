import { Controller } from '../../controller_base.js';
import { ScriptedAi } from '../../controllers.js';
import { isEnemy, getAffordableCards } from './helper.js';
import { handlerFor } from '../../commands.js';

export class AirstrikeAi extends Controller {
  constructor(options = {}) {
    super();
    this.maxActions = options.maxActions || 40;
    this.fallbackAi = new ScriptedAi();
  }

  commandsForTurn(game, country, blocked = new Set()) {
    const st = game.stage;
    const affordable = getAffordableCards(game, country);
    const myAreas = st.areas.filter(a => a.country === country);

    const airportCard = affordable.find(c => c.id === 16);
    if (airportCard) {
      for (const a of myAreas) {
        if (!a.sea && a.construction === 'none' && (a.areaType === 4 || a.areaType === 1)) {
          const cmd = { type: 'useCard', country, card: 16, target: a.id, pendingPurchase: true };
          if (!handlerFor('useCard')?.validate(game, cmd)) return [cmd];
        }
      }
    }

    const strikeCards = affordable.filter(c => [13, 11, 10].includes(c.id)).sort((a,b) => b.id - a.id);
    for (const card of strikeCards) {
      for (const targetId of st.enabled) {
        const to = st.st(targetId);
        if (to && isEnemy(st, country, to) && to.armies.length > 0) {
          const cmd = { type: 'useCard', country, card: card.id, target: targetId, pendingPurchase: true };
          if (!handlerFor('useCard')?.validate(game, cmd)) return [cmd];
        }
      }
    }

    const paratrooperCard = affordable.find(c => c.id === 12);
    if (paratrooperCard) {
      for (const targetId of st.enabled) {
        const to = st.st(targetId);
        if (to && !to.sea && isEnemy(st, country, to) && to.armies.length === 0) {
          const cmd = { type: 'useCard', country, card: 12, target: targetId, pendingPurchase: true };
          if (!handlerFor('useCard')?.validate(game, cmd)) return [cmd];
        }
      }
    }

    return this.fallbackAi.commandsForTurn(game, country, blocked);
  }
}
