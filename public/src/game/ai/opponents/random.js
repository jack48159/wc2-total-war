import { Controller } from '../../controller_base.js';
import { handlerFor } from '../../commands.js';
import { isEnemy, RECRUIT_TYPES, getAffordableCards } from './helper.js';

export class RandomAi extends Controller {
  constructor(options = {}) {
    super();
    this.maxActions = options.maxActions || 30;
  }

  commandsForTurn(game, country, blocked = new Set()) {
    const st = game.stage;
    const areas = st.areas.filter(a => a.country === country && a.armies?.length);
    const legals = [];

    for (const from of areas) {
      for (let i = 0; i < from.armies.length; i++) {
        const unit = from.armies[i];
        if (!unit || !st.canAct(unit) || blocked.has(unit.id)) continue;
        const targets = unit.type === 'rocket' || unit.type === 'aircraftcarrier'
          ? st.enabled
          : (st.adjE.get(from.id) || []);

        for (const id of targets) {
          const to = st.st(id);
          if (to && isEnemy(st, country, to) && st.attackable(from.id, to.id, i, game.airstrikeRadius())) {
            legals.push({ type: 'attack', from: from.id, to: to.id, armyId: unit.id });
          }
        }

        for (const id of (st.adjE.get(from.id) || [])) {
          if (st.moveable(from.id, id, i)) {
            legals.push({ type: 'move', from: from.id, to: id, armyId: unit.id });
          }
        }
      }
    }

    const affordable = getAffordableCards(game, country);
    for (const card of affordable) {
      if (RECRUIT_TYPES.has(card.id)) {
        for (const a of areas) {
          if (a.armies.length < 4 && !blocked.has(`recruit:${a.id}:${card.id}`)) {
            const cmd = { type: 'useCard', country, card: card.id, target: a.id, pendingPurchase: true };
            if (!handlerFor('useCard')?.validate(game, cmd)) {
              legals.push(cmd);
            }
          }
        }
      }
    }

    if (legals.length === 0) return [];
    const idx = Math.floor(Math.random() * legals.length);
    return [legals[idx]];
  }
}
