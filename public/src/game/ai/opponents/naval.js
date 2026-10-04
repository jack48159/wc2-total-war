import { Controller } from '../../controller_base.js';
import { ScriptedAi } from '../../controllers.js';
import { isEnemy, getAffordableCards, NAVY_TYPES } from './helper.js';
import { handlerFor } from '../../commands.js';

export class NavalAi extends Controller {
  constructor(options = {}) {
    super();
    this.maxActions = options.maxActions || 40;
    this.fallbackAi = new ScriptedAi();
  }

  commandsForTurn(game, country, blocked = new Set()) {
    const st = game.stage;
    const areas = st.areas.filter(a => a.country === country && a.armies?.length);

    const affordable = getAffordableCards(game, country);
    const navalCards = affordable.filter(c => [9, 8, 7, 6].includes(c.id)).sort((a,b) => b.id - a.id);
    const seaAreas = st.areas.filter(a => a.country === country && a.sea && a.armies.length < 4);

    for (const a of seaAreas) {
      for (const card of navalCards) {
        if (blocked.has(`recruit:${a.id}:${card.id}`)) continue;
        const cmd = { type: 'useCard', country, card: card.id, target: a.id, pendingPurchase: true };
        if (!handlerFor('useCard')?.validate(game, cmd)) return [cmd];
      }
    }

    for (const from of areas) {
      const unit = from.armies[0];
      if (!unit || !st.canAct(unit) || blocked.has(unit.id)) continue;
      if (NAVY_TYPES.has(unit.type)) {
        const targets = unit.type === 'aircraftcarrier' ? st.enabled : (st.adjE.get(from.id) || []);
        for (const id of targets) {
          const to = st.st(id);
          if (to && isEnemy(st, country, to) && st.attackable(from.id, to.id, 0, game.airstrikeRadius())) {
            return [{ type: 'attack', from: from.id, to: to.id, armyId: unit.id }];
          }
        }
      }
    }

    return this.fallbackAi.commandsForTurn(game, country, blocked);
  }
}
