import { objectiveResult } from '../sandbox_features.js';
import { isSandbox } from '../sandbox_policy.js';
import { evaluateCondition } from './scenario_events.js';
// Country defeat and battle result, following CCountry::IsConquested,
// BeConquestedBy and CGameManager::CheckAndSetResult in the native project.
import { EV } from '../events.js';
import { nativeAlliance, recomputeAdjacentEncirclement } from './combatModel.js';
import { DIPLOMACY_STATE, registerCapitalFall, collectSurrenderReparations, getDiplomaticRelation } from './diplomacy.js';
import { GROUP_LIMIT } from '../army_groups.js';
import { playerCountryName } from '../describe.js';

function hasSurvivingObjective(stage, country, stabilityRule = false) {
  const owned = stage.areas.filter(area => (area.transitOwner||area.country) === country.id);
  const hasLand = owned.some(area => !area.sea);
  if (!hasLand) return false; // In all modes, a nation without any land territory cannot survive
  if (stabilityRule) return true;
  if (country.defeated === 'army') return owned.some(area => area.country===country.id&&area.armies.length > 0);
  if (country.defeated === 'core') return owned.some(area => !area.sea && [1, 3, 4].includes(area.areaType));
  return true;
}

function eliminateCountry(game, country, victor, defeatRule = country.defeated) {
  const playerAllied = victor !== game.player
    && getDiplomaticRelation(game, game.player, victor) === DIPLOMACY_STATE.ALLIANCE
    && getDiplomaticRelation(game, game.player, country.id) === DIPLOMACY_STATE.WAR;
  const beneficiary = playerAllied ? game.player : victor;
  if (getDiplomaticRelation(game, country.id, beneficiary) === DIPLOMACY_STATE.WAR)
    collectSurrenderReparations(game, country.id, beneficiary);
  const sourceGroups = (game.armyGroups || []).filter(g => g.country === country.id);
  const survivingUnits = beneficiary ? game.stage.areas.filter(a => a.country === country.id&&!a.transitOwner).flatMap(a => a.armies) : [];
  const survivingIds = new Set(survivingUnits.map(a => a.id));
  const assigned = new Set();
  const batches = [];
  for (const source of sourceGroups) {
    const ids = (source.unitIds || []).filter(id => survivingIds.has(id) && !assigned.has(id));
    if (ids.length) {
      for (let i = 0; i < ids.length; i += GROUP_LIMIT) batches.push(ids.slice(i, i + GROUP_LIMIT));
      ids.forEach(id => assigned.add(id));
    }
  }
  const unassigned = survivingUnits.map(a => a.id).filter(id => !assigned.has(id));
  for (let i = 0; i < unassigned.length; i += GROUP_LIMIT) batches.push(unassigned.slice(i, i + GROUP_LIMIT));
  const obsoleteIds = new Set(sourceGroups.map(g => g.id));
  const obsoleteTheatres = new Set((game.theatres || []).filter(t => t.country === country.id).map(t => t.id));
  game.armyGroups = (game.armyGroups || []).filter(g => g.country !== country.id);
  game.theatres = (game.theatres || []).filter(t => t.country !== country.id);
  game.orders = (game.orders || []).filter(o => !(o.level === 'army' && obsoleteIds.has(o.targetId))
    && !(o.level === 'theater' && obsoleteTheatres.has(o.targetId)));
  let theater = null;
  if (batches.length) {
    const nation = playerCountryName(country.id, game.stage);
    theater = { id: 'theater_' + game.nextTheaterId++, country: beneficiary,
      name: `${nation}战区`, marshalId: null, armyIds: [], order: null, ai: false };
    game.theatres.push(theater);
    batches.forEach((ids, i) => {
      const group = { id: 'group_' + game.nextArmyGroupId++, country: beneficiary,
        name: `${nation}第${i + 1}集团军`, commanderId: null, unitIds: ids };
      game.armyGroups.push(group); theater.armyIds.push(group.id);
    });
  }
  country.eliminated = true;
  const stageCountry = game.stage.countries.get(country.id);
  if (stageCountry) stageCountry.eliminated = true;
  const changed = [];
  for (const area of game.stage.areas) {
    if (area.country !== country.id) continue;
    if(area.transitOwner){const host=area.transitOwner;area.armies=[];area.country=host;delete area.transitOwner;delete area.transitCountry;game.emit('alliedTransitChanged',{area:area.id,owner:host,guest:country.id,phase:'left',cause:'countryDefeated'});continue;}
    for (const army of area.armies) if (army.country != null) army.country = beneficiary;
    if (!beneficiary) area.armies = [];
    area.country = area.sea && !area.armies.length ? null : beneficiary;
    changed.push(area.id);
    game.emit(EV.AREA_CAPTURED, { area: area.id, from: country.id, to: area.country, cause: 'countryDefeated' });
  }
  if (theater) {
    game.emit('armyGroupChanged', { country: beneficiary });
    game.emit('theaterOrderChanged', { country: beneficiary, theaterId: theater.id });
  }
  game.emit(EV.COUNTRY_DEFEATED, { country: country.id, byCountry: beneficiary, defeatRule });
  if (changed.length) recomputeAdjacentEncirclement(game.stage, changed[0],
    payload => game.emit(EV.MORALE_CHANGED, payload));
}

function finish(game, result, stars = 0) {
  if (game.phase === 'finished') return;
  game.phase = 'finished';
  game.result = { result, stars, round: game.round };
  game.emit(EV.GAME_OVER, game.result);
}

function sandboxDefeat(game,country,victor) {
  const stage=game.stage,rule=stage.data.sandboxFeatures?.countryDefeats?.[country.id];
  if(country.eliminated||!rule?.enabled)return false;
  const results=rule.conditions.map(c=>evaluateCondition(game,c));
  if(!results.length||!(rule.mode==='any'?results.some(Boolean):results.every(Boolean)))return false;
  const captor=stage.territoryOwner(game.diplomacy?.capitals?.[country.id]);
  const valid=id=>id&&id!==country.id&&stage.countries.has(id)&&!stage.countries.get(id).eliminated;
  const beneficiary=valid(captor)?captor:valid(victor)?victor
    :stage.data.countries.find(c=>valid(c.id)&&game.getDiplomaticRelation(country.id,c.id)===DIPLOMACY_STATE.WAR)?.id
    ||stage.data.countries.find(c=>valid(c.id))?.id||null;
  eliminateCountry(game,country,beneficiary,'sandboxConditions');return true;
}

export function checkVictory(game, victor = game.activeCountry) {
  if (game.phase === 'finished') return;
  const stage = game.stage;
  for (const country of stage.data.countries) {
    if (country.eliminated || (!game.diplomacy?.enabled && nativeAlliance(country.alliance) === 4)) continue;
    const sandbox = isSandbox(game);
    if (sandbox) {
      const cap = game.diplomacy?.capitals?.[country.id];
      if (cap != null && stage.territoryOwner(cap) === country.id) delete game.diplomacy.capitalFallen?.[country.id];
      else registerCapitalFall(game, country.id);
    }
    const defeat = sandbox && stage.data.sandboxFeatures?.countryDefeats?.[country.id];
    if (defeat?.enabled) {
      continue;
    }
    const stabilityRule = !!game.diplomacy?.enabled || game.name.startsWith('battle_');
    if (!hasSurvivingObjective(stage, country, stabilityRule)) {
      eliminateCountry(game, country, victor);
      continue;
    }
    if (sandbox || stage.data.theatreObjectives) continue;
    if (!stabilityRule) continue;
    const capitalId = game.diplomacy.capitals?.[country.id];
    const occupier = capitalId == null ? null : stage.territoryOwner(capitalId);
    if (occupier === country.id) delete game.diplomacy.capitalFallen?.[country.id];
    else registerCapitalFall(game, country.id);
    const threshold = stage.data.traitCatalog?.occupation?.surrenderBelow ?? 30;
    if (occupier && occupier !== country.id && game.diplomacy.capitalFallen?.[country.id]
        && game.getDiplomaticRelation(country.id, occupier) === DIPLOMACY_STATE.WAR
        && game.getStability(country.id) <= threshold) {
      eliminateCountry(game, country, occupier, 'stability');
    }
  }

  // Resolve dependencies before deciding the player result, irrespective of country order.
  if(isSandbox(game))for(let pass=0;pass<stage.data.countries.length;pass++){
    let changed=false;for(const country of stage.data.countries)changed=sandboxDefeat(game,country,victor)||changed;
    if(!changed)break;
  }

  // The native manager fails a campaign as soon as the next round exceeds
  // victoryTurn, before that round's country TurnBegin can grant income.
  if (game.totalRounds != null && game.round > game.totalRounds) {
    finish(game, 'defeat');
    return;
  }
  if (stage.countries.get(game.player)?.eliminated) {
    finish(game, 'defeat');
    return;
  }
  const objective=objectiveResult(game);if(objective){if(!objective.pending)finish(game,objective.result,null);return;}
  const playerAlliance = nativeAlliance(stage.alliance(game.player));
  const enemyAlive = stage.data.countries.some(country => {
    if (country.eliminated || country.id === game.player) return false;
    if (game.diplomacy?.enabled) {
      const rel = game.getDiplomaticRelation(game.player, country.id);
      if (rel === 3) return false;
      if (rel === 1) return true;
      return nativeAlliance(country.alliance) !== 4 && nativeAlliance(country.alliance) !== playerAlliance;
    }
    return nativeAlliance(country.alliance) !== 4 && nativeAlliance(country.alliance) !== playerAlliance;
  });
  if (enemyAlive) return;

  // The campaign star formula is not a conquest rating formula.
  if (game.info?.conquest) {
    finish(game, 'victory', null);
    return;
  }

  const greatTurn = game.info?.greatVictory ?? 10;
  let stars = 5;
  if (game.round > greatTurn) {
    const limit = game.totalRounds;
    stars = game.round >= limit ? 1 : Math.max(2, Math.min(4,
      Math.trunc(4 * (limit - game.round) / Math.max(1, limit - greatTurn)) + 1));
  }
  finish(game, stars === 5 ? 'greatVictory' : 'victory', stars);
}
