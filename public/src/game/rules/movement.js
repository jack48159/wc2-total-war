// `move` command: CScene's shortest legal path may cross several areas in one
// action; the path's directional entry costs consume movement points.
import { register } from '../commands.js';
import { EV } from '../events.js';
import { facingAfterMove, facingToward } from '../direction.js';
import { isNavalCombatUnit, recomputeAdjacentEncirclement } from './combatModel.js';

export { facingToward } from '../direction.js';

const locate = (game, cmd) => {
  const s = game.stage.st(cmd.from), i = s ? s.armies.findIndex(a => a.id === cmd.armyId) : -1;
  return { s, i, a: i >= 0 ? s.armies[i] : null };
};

register('move', {
  validate(game, cmd) {
    const { s, a, i } = locate(game, cmd);
    if (!a) return 'no-army';
    if (s.country !== game.activeCountry) return 'not-active-country';
    if (!game.stage.canAct(a)) return 'no-movement';
    if (!game.stage.moveable(cmd.from, cmd.to, i)) return 'illegal-target';
    return null;
  },
  execute(game, cmd) {
    const st = game.stage, { s, i, a } = locate(game, cmd);
    const path = st.movementPath(cmd.from, cmd.to, i);
    const to = st.ensureArea(cmd.to, null);
    a.facing = facingAfterMove(st, cmd.from, cmd.to, a.facing);
    // CArea::MoveArmyTo also captures unoccupied intermediate land areas.
    for (const id of path.ids.slice(1, -1)) {
      const intermediate = st.ensureArea(id, null);
      if (intermediate.armies.length || intermediate.country === s.country) continue;
      const previousOwner = intermediate.country;
      if (game.diplomacy?.enabled && previousOwner) {
        game.registerDiplomaticOccupation(s.country, previousOwner, 'movementPath');
      }
      intermediate.country = s.country;
      game.emit(EV.AREA_CAPTURED, { area: id, from: previousOwner, to: s.country, cause: 'movementPath' });
    }
    s.armies.splice(i, 1); to.armies.unshift(a);      // the newcomer goes on top of the stack (original AddArmy(army, bottom = false))
    a.movement = to.sea && !isNavalCombatUnit(a.type)
      ? 0 : Math.max(0, a.movement - path.cost);
    a.active = a.movement > 0;
    game.emit(EV.UNIT_MOVED, { from: cmd.from, to: cmd.to, armyId: a.id, armyType: a.type, country: s.country,
      path: path.ids, movementCost: path.cost, movementAfter: a.movement });
    if (to.country !== s.country) {                              // walked into an undefended enemy / neutral area
      const prev = to.country;
      if (game.diplomacy?.enabled && prev) {
        game.registerDiplomaticOccupation(s.country, prev, 'movement');
      }
      to.country = s.country;
      game.emit(EV.AREA_CAPTURED, { area: to.id, from: prev, to: s.country });
      // Walking into an ALLY's land (original CArea::MoveArmyTo): never when both countries are AI, otherwise a coin flip
      // decides whether their general complains; the dialogue itself is the UI's business.
      const pc = prev && st.countries.get(prev), mc = st.countries.get(s.country);
      if (pc && mc && (prev === game.player || s.country === game.player) && st.areAllied(prev, s.country) && game.rng.chance(0.5))
        game.emit(EV.COMMANDER_COMPLAINT, { country: prev, commander: pc.commander, variant: game.rng.int(2) + 1, area: to.id });
    }
    recomputeAdjacentEncirclement(st, cmd.from, payload => game.emit(EV.MORALE_CHANGED, payload));
  },
});

// `frontArmy`: in an area holding several armies, put the chosen one in front (index 0). Only the front army acts / is
// shown on the map. Costs nothing (original CArea::MoveArmyToFront, used by the stacked-army panel).
register('frontArmy', {
  validate(game, cmd) {
    const s = game.stage.st(cmd.from);
    if (s?.country !== game.activeCountry) return 'not-active-country';
    return s && s.armies.some(a => a.id === cmd.armyId) ? null : 'no-army';
  },
  execute(game, cmd) {
    const s = game.stage.st(cmd.from), i = s.armies.findIndex(a => a.id === cmd.armyId);
    const previousArmyId = s.armies[0]?.id;
    if (i > 0) { const [a] = s.armies.splice(i, 1); s.armies.unshift(a); }
    game.emit(EV.ARMY_FRONTED, { area: cmd.from, armyId: cmd.armyId, previousArmyId });
  },
});
