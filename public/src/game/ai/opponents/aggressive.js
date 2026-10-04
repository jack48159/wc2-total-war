import { Controller } from '../../controller_base.js';
import { isEnemy, nearestStep, getAffordableCards, RECRUIT_TYPES } from './helper.js';
import { handlerFor } from '../../commands.js';

export class AggressiveAi extends Controller {
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
      const targets = unit.type === 'rocket' || unit.type === 'aircraftcarrier' ? st.enabled : (st.adjE.get(from.id) || []);
      let bestTarget = null;
      for (const id of targets) {
        const to = st.st(id);
        if (to && isEnemy(st, country, to) && st.attackable(from.id, to.id, 0, game.airstrikeRadius())) {
          const enemyHp = to.armies[0]?.hp || 999;
          if (!bestTarget || enemyHp < bestTarget.hp) {
            bestTarget = { id: to.id, hp: enemyHp };
          }
        }
      }
      if (bestTarget) {
        return [{ type: 'attack', from: from.id, to: bestTarget.id, armyId: unit.id }];
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
    const recruitCards = affordable.filter(c => RECRUIT_TYPES.has(c.id));
    if (recruitCards.length > 0) {
      for (const area of areas) {
        if (area.armies.length >= 4) continue;
        const hasAdjacentEnemy = (st.adjE.get(area.id) || []).some(id => isEnemy(st, country, st.st(id)));
        if (!hasAdjacentEnemy && area.areaType !== 4) continue;
        for (const card of recruitCards) {
          if (blocked.has(`recruit:${area.id}:${card.id}`)) continue;
          const cmd = { type: 'useCard', country, card: card.id, target: area.id, pendingPurchase: true };
          if (!handlerFor('useCard')?.validate(game, cmd)) {
            return [cmd];
          }
        }
      }
    }

    return [];
  }
}
