import { Controller } from '../../controller_base.js';
import { isEnemy, areaValue, getAffordableCards, RECRUIT_TYPES } from './helper.js';
import { handlerFor } from '../../commands.js';

export class TurtleAi extends Controller {
  constructor(options = {}) {
    super();
    this.maxActions = options.maxActions || 35;
  }

  commandsForTurn(game, country, blocked = new Set()) {
    const st = game.stage;
    const myAreas = st.areas.filter(a => a.country === country);

    const affordable = getAffordableCards(game, country);
    const defCards = affordable.filter(c => [17, 18, 19, 24].includes(c.id));
    for (const card of defCards) {
      if (card.id === 24) {
        for (const a of myAreas) {
          if (a.armies.length && !(a.armies[0].cards & 2) && (a.areaType === 4 || a.construction === 'city')) {
            const cmd = { type: 'useCard', country, card: 24, target: a.id, pendingPurchase: true };
            if (!handlerFor('useCard')?.validate(game, cmd)) return [cmd];
          }
        }
      } else {
        for (const a of myAreas) {
          if (!a.sea && a.installation === 'none' && (a.areaType === 4 || a.construction === 'city' || a.construction === 'industry')) {
            const cmd = { type: 'useCard', country, card: card.id, target: a.id, pendingPurchase: true };
            if (!handlerFor('useCard')?.validate(game, cmd)) return [cmd];
          }
        }
      }
    }

    const recruitCards = affordable.filter(c => RECRUIT_TYPES.has(c.id));
    for (const a of myAreas) {
      if ((a.areaType === 4 || a.construction === 'city') && a.armies.length < 4) {
        for (const card of recruitCards) {
          if (blocked.has(`recruit:${a.id}:${card.id}`)) continue;
          const cmd = { type: 'useCard', country, card: card.id, target: a.id, pendingPurchase: true };
          if (!handlerFor('useCard')?.validate(game, cmd)) return [cmd];
        }
      }
    }

    for (const from of myAreas) {
      const unit = from.armies[0];
      if (!unit || !st.canAct(unit) || blocked.has(unit.id)) continue;
      for (const id of (st.adjE.get(from.id) || [])) {
        const to = st.st(id);
        if (to && isEnemy(st, country, to) && st.attackable(from.id, to.id, 0, game.airstrikeRadius())) {
          return [{ type: 'attack', from: from.id, to: to.id, armyId: unit.id }];
        }
      }
    }

    for (const from of myAreas) {
      const unit = from.armies[0];
      if (!unit || !st.canAct(unit) || blocked.has(unit.id)) continue;
      if (from.areaType === 4 || (from.construction === 'city' && from.armies.length >= 3)) continue;
      for (const id of (st.adjE.get(from.id) || [])) {
        const to = st.st(id);
        if (to && to.country === country && to.armies.length < 4 && areaValue(to) > areaValue(from)) {
          if (st.moveable(from.id, to.id, 0)) {
            return [{ type: 'move', from: from.id, to: to.id, armyId: unit.id }];
          }
        }
      }
    }

    return [];
  }
}
