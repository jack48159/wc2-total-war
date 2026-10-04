import { Controller } from '../../controller_base.js';
import { ScriptedAi } from '../../controllers.js';
import { getAffordableCards, RECRUIT_TYPES } from './helper.js';
import { handlerFor } from '../../commands.js';

export class EcoTechAi extends Controller {
  constructor(options = {}) {
    super();
    this.maxActions = options.maxActions || 40;
    this.fallbackAi = new ScriptedAi();
  }

  commandsForTurn(game, country, blocked = new Set()) {
    const st = game.stage;
    const round = game.round;

    if (round <= 10) {
      const affordable = getAffordableCards(game, country);
      const myAreas = st.areas.filter(a => a.country === country);

      const techCard = affordable.find(c => c.id === 21);
      if (techCard && country === game.player) {
        if (!handlerFor('buyCard')?.validate(game, { type: 'buyCard', card: 21 })) {
          return [{ type: 'buyCard', card: 21 }];
        }
      }

      const devCards = affordable.filter(c => c.id === 14 || c.id === 15);
      for (const card of devCards) {
        for (const a of myAreas) {
          if (a.sea) continue;
          const targetType = card.id === 14 ? 'city' : 'industry';
          const cap = card.id === 14 ? 4 : 3;
          if (a.construction === 'none' || (a.construction === targetType && a.level < cap)) {
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
          if (to && to.country !== country && to.country != null && st.attackable(from.id, to.id, 0, game.airstrikeRadius())) {
            return [{ type: 'attack', from: from.id, to: to.id, armyId: unit.id }];
          }
        }
      }
      return [];
    }

    const affordable = getAffordableCards(game, country);
    const recruitCards = affordable.filter(c => RECRUIT_TYPES.has(c.id)).sort((a,b) => (b.tech || 0) - (a.tech || 0));
    const myAreas = st.areas.filter(a => a.country === country);

    if (recruitCards.length > 0) {
      for (const a of myAreas) {
        if (a.armies.length < 4 && (a.construction === 'industry' || a.construction === 'city' || a.areaType === 4)) {
          for (const card of recruitCards) {
            if (blocked.has(`recruit:${a.id}:${card.id}`)) continue;
            const cmd = { type: 'useCard', country, card: card.id, target: a.id, pendingPurchase: true };
            if (!handlerFor('useCard')?.validate(game, cmd)) return [cmd];
          }
        }
      }
    }

    return this.fallbackAi.commandsForTurn(game, country, blocked);
  }
}
