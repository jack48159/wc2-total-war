import { Controller } from '../../controller_base.js';
import { isEnemy, nearestStep, getAffordableCards } from './helper.js';
import { handlerFor } from '../../commands.js';

export class ArmouredAi extends Controller {
  constructor(options = {}) {
    super();
    this.maxActions = options.maxActions || 40;
  }

  commandsForTurn(game, country, blocked = new Set()) {
    const st = game.stage;
    const areas = st.areas.filter(a => a.country === country && a.armies?.length);

    for (const from of areas) {
      const unit = from.armies[0];
      if (!unit || !st.canAct(unit) || blocked.has(unit.id)) continue;
      for (const id of (st.adjE.get(from.id) || [])) {
        const to = st.st(id);
        if (to && isEnemy(st, country, to) && st.attackable(from.id, to.id, 0, game.airstrikeRadius())) {
          return [{ type: 'attack', from: from.id, to: to.id, armyId: unit.id }];
        }
      }
    }

    for (const from of areas) {
      const unit = from.armies[0];
      if (!unit || !st.canAct(unit) || blocked.has(unit.id)) continue;
      const dest = nearestStep(st, from, 0, a => isEnemy(st, country, a));
      if (dest != null && st.moveable(from.id, dest, 0)) {
        return [{ type: 'move', from: from.id, to: dest, armyId: unit.id }];
      }
    }

    const affordable = getAffordableCards(game, country);
    const tankCards = affordable.filter(c => c.id === 5 || c.id === 4 || c.id === 1)
      .sort((a,b) => (b.id === 5 ? 10 : b.id === 4 ? 6 : 2) - (a.id === 5 ? 10 : a.id === 4 ? 6 : 2));

    for (const a of areas) {
      if (a.armies.length < 3) {
        for (const card of tankCards) {
          if (blocked.has(`recruit:${a.id}:${card.id}`)) continue;
          const cmd = { type: 'useCard', country, card: card.id, target: a.id, pendingPurchase: true };
          if (!handlerFor('useCard')?.validate(game, cmd)) return [cmd];
        }
      }
    }

    return [];
  }
}
