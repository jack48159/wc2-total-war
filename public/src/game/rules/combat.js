// `attack` command: an army attacks the front army of an enemy area (adjacent, or rocket range). The outcome comes from
// combatModel.resolveAttack(); this file applies it, removes dead armies and reports events. An attack ends the army's action.
import { register } from '../commands.js';
import { EV } from '../events.js';
import { addCombatExperience, canOccupyAfterAttack, handleUnitKilled, movementAfterAttack, recomputeAdjacentEncirclement, reduceConstructionLevel, resolveAirStrike, resolveAttack, rollCombatMedal } from './combatModel.js';
import { facingAfterMove, facingToward, normaliseFacing } from '../direction.js';
import { tacticalBonus } from '../army_groups.js';

const locate = (game, cmd) => {
  const s = game.stage.st(cmd.from), i = s ? s.armies.findIndex(a => a.id === cmd.armyId) : -1;
  return { s, i, a: i >= 0 ? s.armies[i] : null };
};

register('attack', {
  validate(game, cmd) {
    const { s, a, i } = locate(game, cmd);
    if (!a) return 'no-army';
    if (s.country !== game.activeCountry) return 'not-active-country';
    if (!game.stage.canAct(a)) return 'no-movement';
    if (!game.stage.attackable(cmd.from, cmd.to, i, game.airstrikeRadius())) return 'illegal-target';
    if (game.diplomacy?.enabled) {
      const toArea = game.stage.st(cmd.to);
      if (toArea && !game.canInitiateAttack(s.country, toArea.country, s.country !== game.player)) return 'diplomacy-forbidden';
    }
    return null;
  },
  execute(game, cmd) {
    const st = game.stage, { s: fromArea, a: attacker } = locate(game, cmd), toArea = st.st(cmd.to), defender = toArea.armies[0];
    if (game.diplomacy?.enabled && toArea) {
      game.registerDiplomaticHostility(fromArea.country, toArea.country, 'attack');
    }
    if (attacker.type === 'aircraftcarrier') {
      const carrierDef = st.armyDef(fromArea.country, attacker);
      const { roll, damage: baseDamage } = resolveAirStrike(st, fromArea.country, toArea, 1, game.medalLevels.airforce || 0, game.rng);
      const carrierTactics = tacticalBonus(game, fromArea.country, attacker, { role: 'attack', fromAreaId: cmd.from, toAreaId: cmd.to }), targetTactics = tacticalBonus(game, toArea.country, defender, { role: 'defend', fromAreaId: cmd.to, toAreaId: cmd.from });
      const damage = Math.trunc(baseDamage * carrierTactics.attack * targetTactics.received);
      attacker.facing = facingToward(st, cmd.from, cmd.to, attacker.facing);
      defender.facing = facingToward(st, cmd.to, cmd.from, defender.facing);
      game.emit(EV.UNIT_ATTACKED, { ruleVersion: 'combat-log-v2', from: cmd.from, to: cmd.to, attackerId: attacker.id, defenderId: defender.id,
        attackerCountry: fromArea.country, defenderCountry: toArea.country, attackerType: attacker.type, defenderType: defender.type,
        attackerHpBefore: attacker.hp, defenderHpBefore: defender.hp, kind: 'carrierAirStrike', damage, counter: 0,
        flankPct: 0, rolls: { airstrike: roll, kind: 'carrierAirStrike' },
        diagnostics: { formula: 'airstrike', positions: { from: cmd.from, to: cmd.to },
          attacker: { hpBefore: attacker.hp, movementBefore: attacker.movement, type: attacker.type },
          defender: { hpBefore: defender.hp, maxHp: defender.maxHp, type: defender.type },
          modifiers: { fatigue: { applied: false, pct: 0 }, flank: { applied: false, pct: 0 }, encirclement: { applied: false, pct: 0 },
            installation: toArea.installation },
          results: { rawDamage: damage, damageApplied: damage, defenderHpAfter: Math.max(0, defender.hp - damage) } } });
      let defenderKilled = false;
      if (damage > 0) {
        const hpBefore = defender.hp;
        defender.hp = Math.max(0, defender.hp - damage);
        game.emit(EV.UNIT_DAMAGED, { ruleVersion: 'combat-log-v2', area: toArea.id, armyId: defender.id, hpBefore, hp: defender.hp, maxHp: defender.maxHp, lost: damage, cause: 'carrierAirStrike', sourceId: attacker.id, byCountry: fromArea.country });
        if (defender.hp === 0) {
          defenderKilled = true;
          toArea.armies.shift();
          handleUnitKilled(game, toArea, defender, fromArea.country, 'carrierAirStrike', attacker.id);
          game.emit(EV.UNIT_DESTROYED, { ruleVersion: 'combat-log-v2', area: toArea.id, armyId: defender.id, byCountry: fromArea.country, sourceId: attacker.id, cause: 'carrierAirStrike' });
        }
      }
      if (damage > 0 && addCombatExperience(st, fromArea, attacker, damage)) {
        game.emit(EV.UNIT_PROMOTED, { area: fromArea.id, armyId: attacker.id, level: attacker.level });
      }
      // Carrier adjacent splash (CFight::ApplyResult airStrikeType 4)
      const splashPct = Number(carrierDef.adjacentSplashPercent || 0);
      if (splashPct > 0 && damage > 0) {
        const splashBase = Math.max(1, Math.ceil(baseDamage * carrierTactics.attack * splashPct / 100));
        for (const adjacentId of st.adjE.get(toArea.id) || []) {
          if (adjacentId === fromArea.id) continue;
          const splashArea = st.st(adjacentId);
          if (!splashArea?.armies?.length) continue;
          for (let i = splashArea.armies.length - 1; i >= 0; i--) {
            const unit = splashArea.armies[i];
            const splashDamage = Math.max(1, Math.trunc(splashBase * tacticalBonus(game, splashArea.country, unit, { role: 'defend', fromAreaId: splashArea.id }).received));
            const hpBefore = unit.hp;
            unit.hp = Math.max(0, unit.hp - splashDamage);
            game.emit(EV.UNIT_DAMAGED, { ruleVersion: 'combat-log-v2', area: splashArea.id, armyId: unit.id, hpBefore, hp: unit.hp, maxHp: unit.maxHp, lost: splashDamage, cause: 'adjacentSplash', sourceId: attacker.id, byCountry: fromArea.country });
            if (unit.hp === 0) {
              splashArea.armies.splice(i, 1);
              handleUnitKilled(game, splashArea, unit, fromArea.country, 'adjacentSplash', attacker.id);
              game.emit(EV.UNIT_DESTROYED, { ruleVersion: 'combat-log-v2', area: splashArea.id, armyId: unit.id, byCountry: fromArea.country, sourceId: attacker.id, cause: 'adjacentSplash' });
            }
          }
        }
      }
      if ((carrierDef.constructionDamageChance || 0) > 0 && game.rng.int(100) < carrierDef.constructionDamageChance) {
        reduceConstructionLevel(toArea);
      }
      // Movement cost and entrenchment check
      if (toArea.installation === 'entrenchment' && carrierDef.entrenchmentStopsMovement) {
        attacker.movement = 0;
      } else if (!carrierDef.retainMovementOnKill || !defenderKilled || toArea.armies.length === 0) {
        attacker.movement = Math.max(0, attacker.movement - Math.max(0, carrierDef.attackCost ?? 1));
      }
      attacker.active = attacker.movement > 0;
      if (fromArea.country === game.player && damage > 0 && rollCombatMedal(damage, toArea, game.rng)) {
        game.medals = (game.medals || 0) + 1;
        game.emit(EV.MEDAL_GAINED, { country: fromArea.country, area: fromArea.id, medals: game.medals });
      }
      recomputeAdjacentEncirclement(st, cmd.from, payload => game.emit(EV.MORALE_CHANGED, payload));
      return;
    }
    const kind = st.adjacent(cmd.from, cmd.to) ? 'melee' : 'ranged';
    attacker.facing = normaliseFacing(st, fromArea.id, attacker.facing);
    defender.facing = normaliseFacing(st, toArea.id, defender.facing);
    const attackerFacingBefore = attacker.facing, defenderFacingBefore = defender.facing;
    const attackerMovementBefore = attacker.movement, defenderMovementBefore = defender.movement;
    const attackerDef = st.armyDef(fromArea.country, attacker);
    // CFight::ApplyResult consumes the construction-damage roll before the
    // unit damage is applied, so preserve that RNG order.
    let constructionReduced = false;
    if ((attackerDef.constructionDamageChance || 0) > 0 && game.rng.int(100) < attackerDef.constructionDamageChance) {
      constructionReduced = reduceConstructionLevel(toArea);
    }
    const r = resolveAttack({ game, attacker, defender, fromArea, toArea, kind, rng: game.rng });
    const expectedMovementAfter = movementAfterAttack(attacker, toArea.installation, r.defenderLoss < defender.hp, toArea.armies.length > 0, attackerDef);
    const defenderOldFacing = defender.facing;
    attacker.facing = facingToward(st, cmd.from, cmd.to, attacker.facing);
    defender.facing = facingToward(st, cmd.to, cmd.from, defender.facing);
    defender.flankGuardArea = r.flankPct > 0 ? defenderOldFacing : null;
    game.coordination = game.coordination || { attacks: {}, manual: [] };
    game.coordination.roundTargetHits = game.coordination.roundTargetHits || {};
    const priorHits = game.coordination.roundTargetHits[cmd.to] || 0;
    game.coordination.roundTargetHits[cmd.to] = priorHits + 1;
    const focusCount = priorHits + 1;
    const synergy = focusCount > 1;
    const flanking = (r.flankPct || 0) > 0;
    const flankBonus = r.flankPct || 0;
    game.emit(EV.UNIT_ATTACKED, { ruleVersion: 'combat-log-v2', from: cmd.from, to: cmd.to, attackerId: attacker.id, defenderId: defender.id,
      attackerCountry: fromArea.country, defenderCountry: toArea.country, attackerType: attacker.type, defenderType: defender.type,
      attackerHpBefore: attacker.hp, defenderHpBefore: defender.hp, kind, damage: r.defenderLoss, counter: r.attackerLoss,
      flankPct: r.flankPct, flanking, flankBonus, focusCount, synergy, attackerEncirclement: r.rolls.attackerEncirclement,
      defenderEncirclement: r.rolls.defenderEncirclement, rawDamage: r.diagnostics.results.defenderLossRaw,
      rawCounter: r.diagnostics.results.attackerLossRaw,
      fatigueApplied: r.diagnostics.modifiers.fatigue.applied,
      fatiguePct: r.diagnostics.modifiers.fatigue.pct,
      encirclementAttackPenaltyPct: r.diagnostics.modifiers.encirclement.defenderLossPenaltyPct,
      encirclementCounterPenaltyPct: r.diagnostics.modifiers.encirclement.attackerLossPenaltyPct,
      rolls: r.rolls,
      diagnostics: { ...r.diagnostics, positions: { from: cmd.from, to: cmd.to },
        facing: { attackerBefore: attackerFacingBefore, attackerAfter: attacker.facing, defenderBefore: defenderFacingBefore, defenderAfter: defender.facing },
        movement: { attackerBefore: attackerMovementBefore, defenderBefore: defenderMovementBefore },
        area: { attackerInstallation: fromArea.installation, defenderInstallation: toArea.installation,
          attackerStack: fromArea.armies.length, defenderStack: toArea.armies.length },
        results: { ...r.diagnostics.results, attackerMovementAfterExpected: expectedMovementAfter } } });
    const hit = (area, army, loss, byCountry, cause = 'attack', sourceId = attacker.id) => {
      if (loss <= 0) return false;
      const hpBefore = army.hp;
      army.hp = Math.max(0, army.hp - loss);
      game.emit(EV.UNIT_DAMAGED, { ruleVersion: 'combat-log-v2', area: area.id, armyId: army.id, hpBefore, hp: army.hp, maxHp: army.maxHp, lost: loss, cause, sourceId, byCountry });
      if (army.hp === 0) {
        area.armies.splice(area.armies.indexOf(army), 1);
        handleUnitKilled(game, area, army, byCountry, cause, sourceId);
        game.emit(EV.UNIT_DESTROYED, { ruleVersion: 'combat-log-v2', area: area.id, armyId: army.id, byCountry, sourceId, cause });
        return true;
      }
      return false;
    };
    // Native stack-splash weapons damage every unit in the target stack.  The
    // front unit receives the full result; deeper units receive the falloff.
    let defenderKilled = false, defenderDamageTotal = 0;
    const falloff = Number(attackerDef.stackSplashFalloff || 0);
    if (falloff > 0) {
      for (let index = toArea.armies.length - 1; index >= 0; index--) {
        const unit = toArea.armies[index], rate = Math.max(0, 1 - index / falloff);
        const frontReceived = tacticalBonus(game, toArea.country, defender, { role: 'defend', fromAreaId: toArea.id, toAreaId: fromArea.id }).received;
        const loss = Math.trunc(r.defenderLoss * rate * tacticalBonus(game, toArea.country, unit, { role: 'defend', fromAreaId: toArea.id, toAreaId: fromArea.id }).received / frontReceived);
        defenderDamageTotal += loss;
        if (unit === defender && hit(toArea, unit, loss, fromArea.country, 'stackSplash', attacker.id)) defenderKilled = true;
        else if (unit !== defender) hit(toArea, unit, loss, fromArea.country, 'stackSplash', attacker.id);
      }
    } else {
      defenderDamageTotal = r.defenderLoss;
      defenderKilled = hit(toArea, defender, r.defenderLoss, fromArea.country, 'attack', attacker.id);
    }
    const attackerKilled = hit(fromArea, attacker, r.attackerLoss, toArea.country, 'counterattack', defender.id);
    if (!defenderKilled && toArea.armies.includes(defender) && addCombatExperience(st, toArea, defender, r.attackerLoss)) {
      game.emit(EV.UNIT_PROMOTED, { area: toArea.id, armyId: defender.id, level: defender.level });
    }
    if (!attackerKilled && addCombatExperience(st, fromArea, attacker, defenderDamageTotal)) {
      game.emit(EV.UNIT_PROMOTED, { area: fromArea.id, armyId: attacker.id, level: attacker.level });
    }
    if (!attackerKilled) {
      attacker.movement = movementAfterAttack(attacker, toArea.installation, !defenderKilled, toArea.armies.length > 0, attackerDef);
      attacker.active = attacker.movement > 0;
    }

    // Native adjacent splash is applied after the primary result and skips
    // both the source and target areas.
    const splashPct = Number(attackerDef.adjacentSplashPercent || 0);
    if (splashPct > 0 && defenderDamageTotal > 0) {
      const splashDamage = Math.max(1, Math.ceil(defenderDamageTotal * splashPct / 100));
      for (const adjacentId of st.adjE.get(toArea.id) || []) {
        if (adjacentId === fromArea.id) continue;
        const splashArea = st.st(adjacentId);
        if (!splashArea?.armies?.length) continue;
        for (let i = splashArea.armies.length - 1; i >= 0; i--) {
          const target = splashArea.armies[i];
          const loss = Math.max(1, Math.trunc(splashDamage * tacticalBonus(game, splashArea.country, target, { role: 'defend', fromAreaId: splashArea.id }).received));
          hit(splashArea, target, loss, fromArea.country, 'adjacentSplash', attacker.id);
        }
      }
    }

    // CFight::ApplyResult reduces a target construction on a 30% battleship
    // roll. Clearing the last defender reduces it once more unless that first
    // reduction already happened; both calls use CArea's area-type rules.
    if (toArea.armies.length === 0) {
      if (!constructionReduced) reduceConstructionLevel(toArea);
      // The native call consumes this roll even when the area has no installation.
      if (game.rng.int(100) < 50) toArea.installation = 'none';
      if (!attackerKilled) {
        if (canOccupyAfterAttack(attacker, fromArea, toArea, attackerDef)) {
          const previousOwner = toArea.transitOwner||toArea.country;
          fromArea.armies.splice(fromArea.armies.indexOf(attacker), 1);
          toArea.armies.push(attacker);
          attacker.facing = facingAfterMove(st, fromArea.id, toArea.id, attacker.facing);
          toArea.country = fromArea.country;
          game.emit(EV.UNIT_MOVED, { from: fromArea.id, to: toArea.id, armyId: attacker.id, armyType: attacker.type, country: fromArea.country });
          if(previousOwner&&previousOwner!==toArea.country&&st.areAllied(previousOwner,toArea.country)){toArea.transitOwner=previousOwner;toArea.transitCountry=toArea.country;game.emit('alliedTransitChanged',{area:toArea.id,owner:previousOwner,guest:toArea.country,phase:'entered'});}else{delete toArea.transitOwner;delete toArea.transitCountry;if(previousOwner!==toArea.country)game.emit(EV.AREA_CAPTURED,{area:toArea.id,from:previousOwner,to:toArea.country});}
        }
        if (game.rng.int(100) < 30) {
          attacker.morale = 2;
          attacker.moraleUpTurn = 2;
          game.emit(EV.MORALE_CHANGED, { area: toArea.id, armyId: attacker.id, country: fromArea.country, morale: attacker.morale, moraleUpTurn: attacker.moraleUpTurn, reason: 'breakthrough' });
        }
      }
    }

    // ApplyResult raises its second-attack flag when a surviving navy attacks
    // a non-rocket unit entrenched in a fort. GUIBattle then calls SecondAttack;
    // NormalAttack rolls both rows again but suppresses damage to the defender,
    // so this is an extra counter volley, not another offensive hit.
    const defenderDef = st.armyDef(toArea.country, defender);
    if (!attackerKilled && !defenderKilled && toArea.installation === 'fort' &&
        defenderDef.attackClass !== 'rocket' && attackerDef.fortSecondAttack) {
      const second = resolveAttack({ game, attacker, defender, fromArea, toArea, kind: 'fortCounter', rng: game.rng, suppressDefenderDamage: true });
      game.emit(EV.UNIT_ATTACKED, { ruleVersion: 'combat-log-v2', from: cmd.from, to: cmd.to, attackerId: attacker.id, defenderId: defender.id,
        attackerCountry: fromArea.country, defenderCountry: toArea.country, attackerType: attacker.type, defenderType: defender.type,
        attackerHpBefore: attacker.hp, defenderHpBefore: defender.hp, kind: 'fortCounter', damage: 0, counter: second.attackerLoss,
        flankPct: second.flankPct, attackerEncirclement: second.rolls.attackerEncirclement,
        defenderEncirclement: second.rolls.defenderEncirclement, rolls: second.rolls,
        diagnostics: { ...second.diagnostics, positions: { from: cmd.from, to: cmd.to },
          fortCounter: true, area: { attackerInstallation: fromArea.installation, defenderInstallation: toArea.installation } } });
      hit(toArea, defender, second.defenderLoss, fromArea.country, 'fortCounter', attacker.id);
      const attackerKilledByFort = hit(fromArea, attacker, second.attackerLoss, toArea.country, 'fortCounter', defender.id);
      if (!attackerKilledByFort && addCombatExperience(st, fromArea, attacker, second.defenderLoss)) {
        game.emit(EV.UNIT_PROMOTED, { area: fromArea.id, armyId: attacker.id, level: attacker.level });
      }
      if (!defenderKilled && addCombatExperience(st, toArea, defender, second.attackerLoss)) {
        game.emit(EV.UNIT_PROMOTED, { area: toArea.id, armyId: defender.id, level: defender.level });
      }
      if ((attackerDef.constructionDamageChance || 0) > 0 && game.rng.int(100) < attackerDef.constructionDamageChance) reduceConstructionLevel(toArea);
    }
    if (fromArea.country === game.player && defenderDamageTotal > 0 && rollCombatMedal(defenderDamageTotal, toArea, game.rng)) {
      game.medals = (game.medals || 0) + 1;
      game.emit(EV.MEDAL_GAINED, { country: fromArea.country, area: fromArea.id, medals: game.medals });
    }
    if (toArea.country === game.player && r.attackerLoss > 0 && rollCombatMedal(r.attackerLoss, fromArea, game.rng)) {
      game.medals = (game.medals || 0) + 1;
      game.emit(EV.MEDAL_GAINED, { country: toArea.country, area: toArea.id, medals: game.medals });
    }
    recomputeAdjacentEncirclement(st, cmd.from, payload => game.emit(EV.MORALE_CHANGED, payload));
  },
});
