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
    const actor=s.country;const path = st.movementPath(cmd.from, cmd.to, i);
    const to = st.ensureArea(cmd.to, null);
    a.facing = facingAfterMove(st, cmd.from, cmd.to, a.facing);
    // CArea::MoveArmyTo also captures unoccupied intermediate land areas.
    for (const id of path.ids.slice(1, -1)) {
      const intermediate = st.ensureArea(id, null);
      if(intermediate.armies.length||intermediate.country===actor||st.areAllied(actor,intermediate.transitOwner||intermediate.country))continue;
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
    game.emit(EV.UNIT_MOVED, { from: cmd.from, to: cmd.to, armyId: a.id, armyType: a.type, country: actor,
      path: path.ids, movementCost: path.cost, movementAfter: a.movement });
    if(to.country!==actor){
      const prev=to.transitOwner||to.country;
      if(prev&&st.areAllied(actor,prev)){to.transitOwner=prev;to.transitCountry=actor;to.country=actor;game.emit('alliedTransitChanged',{area:to.id,owner:prev,guest:actor,phase:'entered'});}
      else{if(game.diplomacy?.enabled&&prev)game.registerDiplomaticOccupation(actor,prev,'movement');delete to.transitOwner;delete to.transitCountry;to.country=actor;game.emit(EV.AREA_CAPTURED,{area:to.id,from:prev,to:actor});}
    }
    restoreAlliedTransit(game);
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

// A transit garrison is controlled by its own country; the host keeps ownership.
// Restoring when empty also handles losses, save restoration and unit removals.
export function restoreAlliedTransit(game){
 for(const area of game.stage.areas){if(!area.transitOwner)continue;const owner=area.transitOwner,guest=area.transitCountry||area.country;
  if(area.country!==guest||game.stage.countries.get(owner)?.eliminated){delete area.transitOwner;delete area.transitCountry;continue;}
  if(game.getDiplomaticRelation?.(guest,owner)===1){delete area.transitOwner;delete area.transitCountry;game.emit(EV.AREA_CAPTURED,{area:area.id,from:owner,to:guest,cause:'transitWar'});continue;}
  if(area.armies.length)continue;area.country=owner;delete area.transitOwner;delete area.transitCountry;game.emit('alliedTransitChanged',{area:area.id,owner,guest,phase:'left'});
 }
}
