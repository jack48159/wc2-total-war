import { Controller } from '../../controller_base.js';
import { ScriptedAi } from '../../controllers.js';
import { isEnemy, nearestStep, areaValue } from './helper.js';

export class GuerrillaAi extends Controller {
  constructor(options = {}) {
    super();
    this.maxActions = options.maxActions || 40;
    this.fallbackAi = new ScriptedAi();
  }

  commandsForTurn(game, country, blocked = new Set()) {
    const st = game.stage;
    const areas = st.areas.filter(a => a.country === country && a.armies?.length);

    for (const from of areas) {
      const unit = from.armies[0];
      if (!unit || !st.canAct(unit) || blocked.has(unit.id)) continue;
      for (const id of (st.adjE.get(from.id) || [])) {
        const to = st.st(id);
        if (to && isEnemy(st, country, to)) {
          const targetUnit = to.armies[0];
          if (!targetUnit || targetUnit.hp <= 35 || (targetUnit.hp / (targetUnit.maxHp || 100)) < 0.35) {
            if (st.attackable(from.id, to.id, 0, game.airstrikeRadius())) {
              return [{ type: 'attack', from: from.id, to: to.id, armyId: unit.id }];
            }
          }
        }
      }
    }

    for (const from of areas) {
      const unit = from.armies[0];
      if (!unit || !st.canAct(unit) || blocked.has(unit.id)) continue;
      const dest = nearestStep(st, from, 0, a => isEnemy(st, country, a) && a.armies.length === 0 && areaValue(a) > 50);
      if (dest != null && st.moveable(from.id, dest, 0)) {
        return [{ type: 'move', from: from.id, to: dest, armyId: unit.id }];
      }
    }

    return this.fallbackAi.commandsForTurn(game, country, blocked);
  }
}
