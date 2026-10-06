import { handlerFor } from '../commands.js';
import { autoOrganize } from '../ai/hq/staff/organize.js';
import { buildModel } from '../ai/hq/core/model.js';
import { estimateAttack } from '../rules/combatModel.js';
import { countryGameView, visibilityForCountry } from '../rules/visibility.js';
import { buildOrderPath } from '../order_path.js';
import { commanderById, commanderYearAvailable, countryCommanders, isHuman, liveGroupUnits, ownsCommander } from '../army_groups.js';
import { shopCards } from '../cards.js';
import { World } from '../world.js';
import { apiIdentity, commandCatalog, ORDER_FIELDS, ORDER_VERBS } from './catalog.js';
import { analyzeCardTargets, recruitRuleInfo } from './card_targets.js';
import { getAreaName, getAreaTypeName, getCardName, getCountryName, getUnitName } from './names.js';

const ACTIVE_ORDER = new Set(['pending', 'progressing', 'stalled']);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function perspective(game, country) {
  return game.fogOfWar ? countryGameView(game, country) : game;
}

function eliminatedCountryIds(game) {
  return new Set([...game.stage.countries].filter(([,info])=>info?.eliminated).map(([id])=>id));
}

function areaUnits(game, country) {
  const rows = [];
  for (const area of game.stage.areas) {
    if (!game.stage.enabled.has(area.id) || area.country !== country) continue;
    for (const unit of area.armies || []) rows.push({ area, unit });
  }
  return rows;
}

function orderFor(game, level, id) {
  return [...(game.orders || [])].reverse().find(order => order.level === level && order.targetId === id && ACTIVE_ORDER.has(order.status)) || null;
}

function orderEntry(entry) {
  if (!entry) return null;
  const copy = clone(entry);
  const progress = Number(copy.progress ?? copy.report?.progress ?? 0);
  copy.progress = progress;
  copy.status = copy.status || copy.report?.status || 'pending';
  copy.warnings = clone(copy.report?.warnings || copy.warnings || []);
  copy.rejected = clone(copy.report?.rejected || copy.rejected || []);
  copy.roundsActive = copy.roundsActive || 0;
  copy.estimatedRoundsRemaining = progress > .05 && copy.roundsActive > 0 ? Math.max(1, Math.ceil((1 - progress) / (progress / copy.roundsActive))) : null;
  copy.expiresRemaining = copy.order?.expires ?? null;
  // Keep the complete entry/order/plan payload. New executor fields appear
  // automatically without another API whitelist update.
  return copy;
}

function unitStats(game, country, unit) {
  const def = game.stage.armyDef(country, unit) || {};
  return { minAttack: def.minAttack ?? null, maxAttack: def.maxAttack ?? null, defence: def.defence ?? null,
    movement: def.movement ?? null, attackRange: def.attackRange ?? def.range ?? 1,
    attackMultiplier: def.attackMultiplier ?? 1, receivedDamageMultiplier: def.receivedDamageMultiplier ?? 1,
    attackClass: def.attackClass ?? unit.type, canOccupy: def.canOccupy !== false,
    retainMovementOnKill: !!def.retainMovementOnKill, stackSplashFalloff: def.stackSplashFalloff || 0,
    adjacentSplashPercent: def.adjacentSplashPercent || 0 };
}

function unitView(game, country, row) {
  const unit = row.unit || row.army;
  const def = game.stage.armyDef(country, unit) || {};
  const moves = [], attacks = [], blockedMoves=[], blockedAttacks=[];
  if (game.activeCountry === country && game.stage.canAct(unit) && unit.movement > 0) {
    for (const area of game.stage.areas) {
      if (!game.stage.enabled.has(area.id) || area.id === row.area.id) continue;
      if (game.stage.moveable(row.area.id, area.id, row.area.armies.indexOf(unit))) {
        const path = game.stage.movementPath(row.area.id, area.id, row.area.armies.indexOf(unit));
        if (path && path.cost <= unit.movement) moves.push({ areaId: area.id, name: getAreaName(area.id, game.stage), cost: path.cost, path: path.ids });
      }
      else if((game.stage.adjE.get(row.area.id)||[]).includes(area.id)&&blockedMoves.length<20){const reason=handlerFor('move')?.validate?.(game,{type:'move',from:row.area.id,to:area.id,armyId:unit.id});if(reason)blockedMoves.push({areaId:area.id,reason});}
      if (area.armies?.length && !game.stage.areAllied(area.country, country) && game.stage.attackable(row.area.id, area.id, row.area.armies.indexOf(unit), game.airstrikeRadius())) {
        const prediction = estimateAttack(game, unit, area.armies[0], row.area, area, country);
        attacks.push({ areaId: area.id, name: getAreaName(area.id, game.stage), defenderId: area.armies[0].id,
          expectedDefenderLoss: prediction.dmgDef, expectedAttackerLoss: prediction.dmgAtt,
          killProbability: prediction.pKillFront, attackerDeathProbability: prediction.pAttackerDies,
          flankPercent: prediction.flankPct, encirclement: prediction.encircle, canCounter: prediction.canCounter });
      }
      else if(area.armies?.length&&!game.stage.areAllied(area.country,country)&&(game.stage.adjE.get(row.area.id)||[]).includes(area.id)&&blockedAttacks.length<20){const reason=handlerFor('attack')?.validate?.(game,{type:'attack',from:row.area.id,to:area.id,armyId:unit.id});if(reason)blockedAttacks.push({areaId:area.id,reason,suggestion:moves.find(m=>m.areaId===area.id)?'先移动到该地块不可行；请选择 legalMoves 中靠近目标的地块。':'选择 legalAttacks，或先沿 legalMoves 接近目标。'});}
    }
  }
  const index = row.area.armies.indexOf(unit), cardActions = [];
  for (const [cardId, count] of Object.entries(game.hand || {})) if (count > 0) {
    const command = { type: 'useCard', card: Number(cardId), target: row.area.id };
    if (!handlerFor('useCard')?.validate?.(game, command)) cardActions.push({ cardId: Number(cardId), name: getCardName(Number(cardId)), command });
  }
  return { id: unit.id, name: getUnitName(unit.type), type: unit.type, areaId: row.area.id,
    areaName: getAreaName(row.area.id, game.stage), hp: unit.hp, maxHp: unit.maxHp,
    movement: unit.movement, maxMovement: def.movement || 0, morale: unit.morale || 0,
    level: unit.level || 0, experience: unit.exp || 0, cards: unit.cards || 0,
    manualThisRound: !!game.coordination?.manual?.includes(unit.id), frontOfStack: index === 0,
    supply: unit.supply ?? null, supplyModeled: unit.supply != null, stats: unitStats(game, country, unit),
    legalActions: { moves, attacks, blockedMoves, blockedAttacks, frontArmy: index > 0 ? { type:'frontArmy', from:row.area.id, armyId:unit.id } : null,
      cardTargets: cardActions, amphibiousMoves: moves.filter(move => !!game.stage.st(move.areaId)?.sea !== !!row.area.sea) },
    legalMoves: moves, legalAttacks: attacks };
}

function cardShopView(game,country){
  return shopCards(game.cardData,game.stage.countries.get(country)?.flag).map(card=>({
    id:card.id,name:getCardName(card.id),money:game.price(card,country),industry:game.industryCost(card,country),
    cooldown:(game.cardCooldowns||{})[card.id]||0,available:game.whyNot(card,country)==null,
    ...analyzeCardTargets(game,card.id,country)
  }));
}

export function getStrategicView(game, country = game.player, opts = {}) {
  const view = perspective(game, country), model = buildModel(game, country), eliminated=eliminatedCountryIds(game);
  const visible=game.fogOfWar?visibilityForCountry(game,country):new Set(game.stage.areas.filter(area=>game.stage.enabled.has(area.id)).map(area=>area.id));
  const knownOwner=area=>area&&!eliminated.has(area.country)?area.country:null;
  const mine = (model.mine || []).filter(area=>!eliminated.has(area.country));
  const dangerous = mine.filter(area=>area.adj.some(id=>{const owner=knownOwner(view.stage.st(id));return owner&&model.rel(owner)==='enemy';}))
    .map(area => ({ areaId: area.id, name: getAreaName(area.id, view.stage), pLose: model.pLose(area.id) || 0 }))
    .filter(item => item.pLose >= 0.2).sort((a, b) => b.pLose - a.pLose).slice(0, opts.limit || 12);
  const border = mine.filter(area => area.adj.some(id => {const owner=knownOwner(view.stage.st(id));return owner&&model.rel(owner)==='enemy';}));
  const unseen = new Set(border.map(area => area.id)), fronts = [];
  while (unseen.size) {
    const seed = unseen.values().next().value, queue = [seed], own = [];
    unseen.delete(seed);
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i]; own.push(current);
      for (const next of view.stage.adjE.get(current) || []) if (unseen.delete(next)) queue.push(next);
    }
    const enemy = [...new Set(own.flatMap(id => view.stage.adjE.get(id) || []).filter(id => {const owner=knownOwner(view.stage.st(id));return owner&&model.rel(owner)==='enemy';}))];
    const hp = ids => ids.reduce((sum, id) => sum + (view.stage.st(id)?.armies || []).reduce((n, unit) => n + unit.hp, 0), 0);
    fronts.push({ id: `front_${fronts.length + 1}`, mine: own, enemy, R: hp(own) / Math.max(1, hp(enemy)),
      maxPLose: Math.max(0, ...own.map(id => model.pLose(id) || 0)) });
  }
  const countries = view.stage.data.countries.map(info => {const isEliminated=eliminated.has(info.id);return { id: info.id, name: getCountryName(info.id, view.stage),
    relation: info.id === country ? 'self' : model.rel(info.id), eliminated:isEliminated,
    territoryCount:(isEliminated?game.stage:view.stage).areas.filter(area => (isEliminated?game.stage:view.stage).enabled.has(area.id) && area.country === info.id).length,
    territoryStatus:isEliminated?'transferred':'active',note:isEliminated?'国家已灭亡，领地已转移。':null };});
  const ownershipChangesUnknown=game.fogOfWar?view.stage.areas.filter(area=>view.stage.enabled.has(area.id)&&!visible.has(area.id)&&eliminated.has(area.country))
    .map(area=>({areaId:area.id,name:getAreaName(area.id,view.stage),owner:null,previousOwner:area.country,ownershipStatus:'changed-new-owner-unknown',note:'归属已变更，新归属未知（未侦察）。'})):[];
  const wallet = country === game.player ? game : game.stage.countries.get(country);
  return { layer: 'strategic', stage: game.name, round: game.round, activeCountry: game.activeCountry, country,
    economy: { money: wallet?.money || 0, industry: wallet?.industry || 0, tech: country === game.player ? game.tech : wallet?.techlevel,
      stability: game.getStability(country), income: game.income(country), techTurnsRemaining: game.techTurn || 0 }, fronts, dangerousAreas: dangerous,
    victory: { phase: game.phase, result: clone(game.result), round: game.round, roundLimit: game.totalRounds, greatVictoryRound: game.info?.greatVictory ?? null },
    theaters: (game.theatres || []).filter(t => t.country === country).map(t => ({ id: t.id, name: t.name, marshalId: t.marshalId, armyGroupIds: t.armyIds, ai:!!t.ai, order: orderEntry(orderFor(game, 'theater', t.id)) })),
    armyGroups: (game.armyGroups || []).filter(g => g.country === country).map(g => ({ id: g.id, name: g.name, commanderId: g.commanderId, unitCount: g.unitIds?.length || 0, order: orderEntry(orderFor(game, 'army', g.id)) })),
    cards: { hand: clone(game.hand || {}), shop: cardShopView(game,country) }, recruitRule: recruitRuleInfo(game,country),
    pendingEvents: clone(game.scenarioEvents?.pending || []).slice(0, opts.limit || 12), countries, ownershipChangesUnknown, api: apiIdentity() };
}

export function getTheaterView(game, theaterId, country = game.player) {
  const view = perspective(game, country), theater = (game.theatres || []).find(t => t.id === theaterId && t.country === country);
  if (!theater) return { error: 'theater-not-found' };
  return { layer: 'theater', id: theater.id, name: theater.name, marshal: clone(commanderById(country, theater.marshalId)), ai: !!theater.ai,
    armyGroups: theater.armyIds.map(id => (game.armyGroups || []).find(g => g.id === id)).filter(Boolean).map(group => ({ id: group.id, name: group.name, commanderId: group.commanderId, unitCount: group.unitIds.length })),
    order: orderEntry(orderFor(game, 'theater', theater.id)), visibleAreaCount: visibilityForCountry(view, country).size };
}

export function getArmyGroupView(game, groupId, country = game.player) {
  const view = perspective(game, country), group = (game.armyGroups || []).find(g => g.id === groupId && g.country === country);
  if (!group) return { error: 'army-group-not-found' };
  const rows = liveGroupUnits(view, group);
  return { layer: 'army-group', id: group.id, name: group.name, commander: clone(commanderById(country, group.commanderId)),
    units: rows.map(row => unitView(view, country, row)), order: orderEntry(orderFor(game, 'army', group.id)),
    orderSchema: { fields:ORDER_FIELDS, verbs: ORDER_VERBS, risk: '0..1', priority: '1..9', expires: 'positive integer', guard: ['hold', 'ring'], maxPathLength: 40 } };
}

export function getUnitView(game, armyId, country = game.player) {
  const view = perspective(game, country), row = areaUnits(view, country).find(item => item.unit.id === armyId);
  return row ? { layer: 'micro', ...unitView(view, country, row) } : { error: 'unit-not-found-or-not-visible' };
}

// One country perspective for the entire briefing, including fog-safe attack previews.
export function getCountryUnitViews(game, country = game.player) {
  const view = perspective(game, country);
  return areaUnits(view, country).map(row => unitView(view, country, row));
}

export function previewAttack(game, from, to, armyId, country = game.player) {
  const view = perspective(game, country), source = view.stage.st(from), target = view.stage.st(to);
  const unit = source?.armies?.find(a => a.id === armyId), defender = target?.armies?.[0];
  if (!unit || source.country !== country) return { ok: false, reason: 'attacker-not-found' };
  if (!defender) return { ok: false, reason: 'visible-defender-not-found' };
  if (!view.stage.attackable(from, to, source.armies.indexOf(unit), view.airstrikeRadius())) return { ok: false, reason: 'target-not-attackable' };
  const result = estimateAttack(view, unit, defender, source, target, country);
  return { ok: true, from, to, armyId, defenderId: defender.id, expectedDefenderLoss: result.dmgDef,
    expectedAttackerLoss: result.dmgAtt, killProbability: result.pKillFront, attackerDeathProbability: result.pAttackerDies,
    flankPercent: result.flankPct, encirclement: result.encircle, canCounter: result.canCounter,
    breakdown: { sourceTerrain:getAreaTypeName(source), targetTerrain:getAreaTypeName(target), sourceConstruction:source.construction,
      targetConstruction:target.construction, targetConstructionLevel:target.level||0, targetInstallation:target.installation,
      attacker:unitStats(view,country,unit), defender:unitStats(view,target.country,defender),
      facingBonusPercent:result.flankPct, attackerEncirclementLevel:result.encircle?.atk||0, defenderEncirclementLevel:result.encircle?.def||0 } };
}

export function previewOrderPath(game, input) {
  if (Array.isArray(input?.axes)) return { axes: input.axes.map(axis => previewOrderPath(game, Array.isArray(axis) && Array.isArray(axis[0]) ? { draw: axis, detour:input.detour } : { path:axis, detour:input.detour })) };
  if (Array.isArray(input?.line)) return { line: input.line, valid: input.line.every((id, i) => game.stage.enabled.has(id) && !game.stage.st(id)?.sea && (!i || game.stage.adjacent(input.line[i - 1], id))) };
  if (Array.isArray(input?.path)) {
    const valid=input.path.length>0&&input.path.length<=40&&input.path.every((id,i)=>Number.isInteger(id)&&game.stage.enabled.has(id)&&!game.stage.st(id)?.sea&&(!i||game.stage.adjacent(input.path[i-1],id)));
    return withDetourPreview(game,{path:clone(input.path),ignored:[],valid},input.detour);
  }
  if (Array.isArray(input?.draw) && input.draw.length) {
    const result=buildOrderPath(input.draw, game.stage.areas, { adjE: game.stage.adjE, position: area => [area.x, area.y], maxLength: 40 });
    return withDetourPreview(game,result,input.detour);
  }
  if (!Number.isInteger(input?.from) || !Number.isInteger(input?.to)) return { path: [], ignored: [], error: 'from-and-to-required' };
  const queue = [input.from], prev = new Map([[input.from, null]]);
  for (let i = 0; i < queue.length && !prev.has(input.to); i++) for (const next of game.stage.adjE.get(queue[i]) || []) {
    const area = game.stage.st(next);
    if (!prev.has(next) && area && !area.sea) prev.set(next, queue[i]), queue.push(next);
  }
  if (!prev.has(input.to)) return { path: [], ignored: [], error: 'no-land-path' };
  const path = [];
  for (let n = input.to; n != null; n = prev.get(n)) path.unshift(n);
  return withDetourPreview(game,{ path, ignored: [] },input.detour);
}

function withDetourPreview(game, result, detour) {
  if (detour == null) return result;
  if (typeof detour !== 'boolean') return { ...result, error:'detour-must-be-boolean' };
  if (!detour) return { ...result, detour:false, detourCandidates:[] };
  const path=result.path||[], detourCandidates=[];
  for(let i=1;i<path.length;i++)detourCandidates.push({from:path[i-1],next:path[i],allowed:[...new Set([path[i],...(game.stage.adjE.get(path[i])||[]).filter(id=>game.stage.enabled.has(id)&&!game.stage.st(id)?.sea)])]});
  return { ...result, detour:true, detourCandidates };
}

export function getTileView(game, areaId, country = game.player) {
  const view = perspective(game, country), area = view.stage.st(areaId), visible=!game.fogOfWar||visibilityForCountry(game,country).has(areaId);
  if (!area || !view.stage.enabled.has(areaId)) return { error:'tile-not-found-or-not-visible' };
  const staleOwner=!visible&&!!game.stage.countries.get(area.country)?.eliminated;
  const neighbours = view.stage.adjE.get(areaId) || [], hostile = neighbours.filter(id => {
    const owner=view.stage.st(id)?.country; return owner && !game.stage.countries.get(owner)?.eliminated && !view.stage.areAllied(owner,country);
  });
  const encircled = area.country === country && neighbours.length > 0 && neighbours.every(id => {
    const owner=view.stage.st(id)?.country; return owner && !game.stage.countries.get(owner)?.eliminated && !view.stage.areAllied(owner,country);
  });
  return { id:area.id,name:getAreaName(area.id,view.stage),terrain:getAreaTypeName(area),sea:!!area.sea,owner:staleOwner?null:area.country,
    previousOwner:staleOwner?area.country:null,ownershipStatus:staleOwner?'changed-new-owner-unknown':'known',ownershipNote:staleOwner?'归属已变更，新归属未知（未侦察）。':null,
    construction:area.construction||'none',constructionLevel:area.level||0,installation:area.installation||'none',
    stack:{count:area.armies?.length||0,capacity:view.stage.maxArmies(area)},encircled,
    recruit:(()=>{if(area.country!==country)return null;const w=recruitRuleInfo(game,country).waiting.find(r=>r.areaId===areaId);return w?{canRecruit:false,roundsLeft:w.roundsLeft}:{canRecruit:true,roundsLeft:0};})(),hostileNeighbours:hostile,
    supply:{modeled:false,status:encircled?'cut-off':'connected',note:'No standalone supply stock exists; encirclement and recovery are the current supply proxies.'},
    // 公平性：玩家在地图上只能看到每个地块最顶层的单位，所以非己方/非盟友地块只返回最顶层单位的详情 + 堆叠层数(stack.count)，
    // 被压在下面的单位的数量以外的信息一律不给；己方和盟友的地块给全部单位。
    neighbours,...(() => {
      const friendly = area.country && view.stage.areAllied(area.country, country), all = area.armies || [];
      const shown = friendly ? all : all.slice(0, 1);
      return { units: shown.map(unit => unitView(view, area.country || country, { area, unit })), hiddenUnits: all.length - shown.length };
    })() };
}

export function getOrdersView(game, country = game.player, opts = {}) {
  const activeOnly = opts.activeOnly !== false;
  return (game.orders || []).filter(entry => entry.country === country && (!activeOnly || ACTIVE_ORDER.has(entry.status))).map(orderEntry);
}

export function getCommandersView(game, country = game.player) {
  const assignedGroups = new Map((game.armyGroups||[]).filter(g=>g.country===country&&g.commanderId).map(g=>[g.commanderId,{role:'army',id:g.id,name:g.name}]));
  const assignedTheaters = new Map((game.theatres||[]).filter(t=>t.country===country&&t.marshalId).map(t=>[t.marshalId,{role:'theater',id:t.id,name:t.name}]));
  return countryCommanders(country).map(spec => ({ id:spec.id,name:spec.name,marshal:!!spec.marshal,cost:spec.cost||0,tactic:spec.tactic||null,
    mods:clone(spec.mods||{}),coordination:clone(spec.coordination||{}),years:clone(spec.years||null),
    ownedOrFree:ownsCommander(game,spec),yearAvailable:commanderYearAvailable(game,spec),
    eligible:ownsCommander(game,spec)&&commanderYearAvailable(game,spec),assigned:assignedGroups.get(spec.id)||assignedTheaters.get(spec.id)||null,
    humanPurchaseRule:isHuman(game,country)?'must be free or present in ownedCommanders':'AI ignores medal purchase ownership' }));
}

export function getDiplomacyView(game, country = game.player) {
  const dip=game.diplomacy||{}, round=game.round||1;
  return { enabled:!!dip.enabled,country,stability:game.getStability(country),reparationRate:game.reparationRate,
    relations:game.stage.data.countries.filter(c=>c.id!==country).map(c=>{const pair=[country,c.id].sort().join('_');return {
      country:c.id,name:getCountryName(c.id,game.stage),eliminated:!!game.stage.countries.get(c.id)?.eliminated,
      relation:game.getDiplomaticRelation?.(country,c.id)??null,truceUntil:dip.truceUntil?.[pair]||null,
      truceRoundsRemaining:Math.max(0,(dip.truceUntil?.[pair]||0)-round),peaceCooldownAt:dip.peaceCooldown?.[pair]??null,
      warLosses:clone(dip.warLosses?.[pair]||{}),warLossesIndustry:clone(dip.warLossesInd?.[pair]||{})};}),
    pendingOffers:clone((dip.offers||dip.peaceOffers||[]).filter(o=>o.first===country||o.second===country)) };
}

export function getEventsView(game, country = game.player, opts = {}) {
  const visible=game.fogOfWar?visibilityForCountry(game,country):new Set(game.stage.areas.filter(a=>game.stage.enabled.has(a.id)).map(a=>a.id));
  const limit=Math.max(1,Math.min(100,opts.limit||30));
  return (game.gameLog||[]).filter(entry=>{
    if(entry.actorCountry===country)return true; const d=entry.data||{}; const ids=[d.area,d.from,d.to,d.target].filter(Number.isInteger); return ids.some(id=>visible.has(id));
  }).slice(-limit).map(entry=>({id:entry.id,round:entry.round,category:entry.category,event:entry.event,actorCountry:entry.actorCountry,data:clone(entry.data)}));
}

export const OPERATION_REASON_MAX_LENGTH = 80;

export function validateOperationReason(reason) {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) return { ok:false, reason:'missing-operation-reason', suggestion:'请用中文写一到两句话，说明这次操作的依据和意图（80 字以内）。' };
  if (Array.from(text).length > OPERATION_REASON_MAX_LENGTH) return { ok:false, reason:'operation-reason-too-long', suggestion:`操作说明不能超过 ${OPERATION_REASON_MAX_LENGTH} 字，请只保留决策依据和意图。` };
  if (!/[\u3400-\u9fff]/u.test(text)) return { ok:false, reason:'operation-reason-must-be-chinese', suggestion:'操作说明必须使用中文，并真实对应本次操作。' };
  return { ok:true, text };
}

const OPERATION_LABELS = {
  newGame:'新开对局', autoOrganize:'自动编组', endTurn:'结束回合', batch:'批量行动',
  move:'移动', attack:'攻击', frontArmy:'调整叠放前排', buyCard:'购买卡片', useCard:'使用卡片',
  createArmyGroup:'创建集团军', setArmyGroup:'调整集团军', transferUnits:'调动编组', dissolveArmyGroup:'解散集团军',
  appointCommander:'任命指挥官', renameArmyGroup:'集团军改名', createTheater:'创建军区', renameTheater:'军区改名',
  dissolveTheater:'解散军区', appointMarshal:'任命元帅', assignArmyToTheater:'调整军区隶属', setTheaterOrder:'下达军区指令',
  setArmyOrder:'下达集团军指令', setCountryOrder:'下达总参指令', executeOrder:'立即执行指令', setOrderPaused:'调整指令暂停', setOrderAuto:'调整指令自动执行',
  setTheaterAI:'调整军区托管', proposeDiplomacy:'外交提议', rejectPeaceOffer:'拒绝和平', resolveEventNotice:'确认事件',
  resolveEventDecision:'事件决策'
};

export function recordOperationReason(game, country, operation, reason) {
  const checked = validateOperationReason(reason);
  if (!checked.ok) return checked;
  const label = OPERATION_LABELS[operation] || operation || '操作';
  const display = `[${country}] ${label} — ${checked.text}`;
  const entry = { schemaVersion:2, id:game.nextGameLogId++, timestamp:new Date().toISOString(), gameId:game.gameId,
    round:game.round, phase:game.phase, actorCountry:country, category:'command', event:'operationReason',
    data:{ operation, label, reason:checked.text, display } };
  game.gameLog ||= [];
  game.gameLog.push(entry);
  game.addReport?.({ category: 'operation', kind: 'operationReason', actors: [country], text: display,
    detail: { operationGameLogId: entry.id }, importance: 1 });
  return { ok:true, operationReason:checked.text, operationReasonLog:{ id:entry.id, display } };
}

export function capturePlayerState(game,country=game.player){
  const areas=new Set(game.stage.areas.filter(a=>game.stage.enabled.has(a.id)&&a.country===country).map(a=>a.id)),units=new Map();
  for(const area of game.stage.areas)if(area.country===country)for(const unit of area.armies||[])units.set(unit.id,unit.hp);
  return {areas,units};
}

export function summarizeOpponentTurn(game,country,before,logs=[],opts={}){
  const after=capturePlayerState(game,country),lostAreas=[...before.areas].filter(id=>!after.areas.has(id)),gainedAreas=[...after.areas].filter(id=>!before.areas.has(id));
  const unitLosses=[...before.units.keys()].filter(id=>!after.units.has(id)).length,hpLoss=[...before.units].reduce((n,[id,hp])=>n+Math.max(0,hp-(after.units.get(id)||0)),0);
  const compact=entry=>{const d=entry.data||{},actorCountry=d.attackerCountry??d.byCountry??(entry.event==='areaCaptured'?d.to:d.country??entry.actorCountry);return {round:entry.round,event:entry.event,actorCountry,affectedCountry:d.defenderCountry??(entry.event==='areaCaptured'?d.from:d.country??null),area:d.area??null,fromArea:Number.isInteger(d.from)?d.from:null,toArea:Number.isInteger(d.to)?d.to:null,armyId:d.armyId??d.attackerId??null,defenderId:d.defenderId??null,hpLost:d.lost??d.damage??null,previousOwner:entry.event==='areaCaptured'?d.from:null,newOwner:entry.event==='areaCaptured'?d.to:null};};
  const opponentActions=logs.map(compact).filter(e=>e.actorCountry!==country).slice(-(opts.detail?100:8));
  return {playerCountry:country,unitLosses,hpLoss,territoryLoss:lostAreas.length,territoryGain:gainedAreas.length,lostAreas,gainedAreas,opponentActions,diplomacyChanges:opponentActions.filter(e=>e.event==='diplomacyChanged')};
}

export function getActionCatalog() { return { ...apiIdentity(), commands:commandCatalog() }; }

export function previewOrderRisk(game, level, targetIds, order, country = game.player) {
  const offensive=['attack','breakthrough','envelop','amphibious'].includes(order?.verb), goals=Array.isArray(order?.to)?order.to:[order?.to].filter(Number.isInteger);
  if(!offensive||!goals.length)return {required:false,estimatedWinRate:null,threshold:.10};
  const groupIds=level==='theater'?(game.theatres||[]).filter(t=>targetIds.includes(t.id)&&t.country===country).flatMap(t=>t.armyIds||[]):targetIds;
  const unitIds=new Set((game.armyGroups||[]).filter(g=>groupIds.includes(g.id)&&g.country===country).flatMap(g=>g.unitIds||[]));
  let own=0; for(const {unit} of areaUnits(game,country))if(unitIds.has(unit.id))own+=unit.hp||0;
  const visible=game.fogOfWar?visibilityForCountry(game,country):new Set(game.stage.areas.filter(a=>game.stage.enabled.has(a.id)).map(a=>a.id));
  const unknownGoals=goals.filter(id=>!visible.has(id));
  if(unknownGoals.length)return {required:true,estimatedWinRate:null,threshold:.10,ownStrength:own,visibleEnemyStrength:null,confidence:'low',unknownGoals,
    warning:'目标区域存在不可见敌情，无法可靠估算胜率；按高风险处理，确认侦察结果后用 confirmHighRisk:true 继续。'};
  const view=perspective(game,country), enemy=goals.reduce((sum,id)=>sum+(view.stage.st(id)?.armies||[]).reduce((n,u)=>n+(u.hp||0),0),0);
  const estimatedWinRate=enemy>0?own/(own+enemy*3.5):1;
  return {required:estimatedWinRate<.10,estimatedWinRate,threshold:.10,ownStrength:own,visibleEnemyStrength:enemy,confidence:'high',unknownGoals:[],
    warning:estimatedWinRate<.10?'Estimated breakthrough chance is below 10%; repeat with confirmHighRisk:true to proceed.':null};
}

function normalizeOrder(game, order) {
  const normalized = { ...order };
  if(normalized.risk==null)normalized.risk=.5;if(normalized.priority==null)normalized.priority=5;
  if(Array.isArray(normalized.axes)&&normalized.axes.length){if(normalized.from==null)normalized.from=normalized.axes.map(axis=>axis?.[0]);if(normalized.to==null)normalized.to=normalized.axes.map(axis=>axis?.at?.(-1));}
  if(['defend','screen'].includes(normalized.verb)&&Array.isArray(normalized.line)){if(normalized.from==null)normalized.from=normalized.line;if(normalized.to==null)normalized.to=clone(normalized.line);if(normalized.mustHold==null)normalized.mustHold=clone(normalized.line);}
  if(Array.isArray(normalized.path)){if(normalized.from==null)normalized.from=normalized.path[0];if(normalized.to==null)normalized.to=normalized.path.at(-1);}
  if (!normalized.path && normalized.autoPath) normalized.path = previewOrderPath(game, normalized).path;
  delete normalized.autoPath;
  return normalized;
}

const SUGGESTIONS = {
  'not-player-turn': '先结束或等待对手回合。', 'manual-action-priority': '该单位本回合已被手动微操；等下一回合，或重新下达常驻指令以交还指挥权。',
  'target-not-attackable': '查询 wc2_get_unit_view，使用 legalAttacks 中的目标。', 'unit-not-found': '刷新单位视图，确认单位仍存活且属于当前国家。'
};

export function performCommand(game, command) {
  if (!command?.type) return { ok: false, reason: 'invalid-command', suggestion: '提供带 type 的命令对象。', events: [] };
  const cmd = clone(command);
  if (['setArmyOrder','setTheaterOrder','setCountryOrder'].includes(cmd.type) && cmd.order) {
    cmd.order = normalizeOrder(game, cmd.order);
    const missing=(cmd.order.verb==='allout'?['verb','risk','priority']:['verb','from','to','risk','priority']).filter(field=>cmd.order[field]==null);
    if(missing.length)return {ok:false,reason:'missing-order-fields',missing,suggestion:`一次补齐字段：${missing.join(', ')}。risk 默认 0.5，priority 合法范围 1..9。`,events:[]};
    if(cmd.order.axes&&cmd.order.verb!=='envelop')return {ok:false,reason:'axes-require-envelop',suggestion:'双轴只适用于 envelop；breakthrough 请改用单条 path，或把 verb 改为 envelop。',events:[]};
    if (cmd.confirmHighRisk || cmd.order.confirmHighRisk) cmd.order.confirmedHighRisk = true;
    delete cmd.confirmHighRisk; delete cmd.order.confirmHighRisk;
    if (cmd.order.verb !== 'allout') {
      const level=cmd.type==='setArmyOrder'?'army':'theater', ids=[cmd.groupId||cmd.theaterId], risk=previewOrderRisk(game,level,ids,cmd.order,cmd.country||game.player);
      if(risk.required&&!cmd.order.confirmedHighRisk)return {ok:false,reason:'high-risk-confirmation-required',suggestion:'Review previewOrderRisk and repeat with confirmHighRisk:true.',risk,events:[]};
    }
  }
  const handler = handlerFor(cmd.type);
  if (!handler) return { ok: false, reason: 'unknown-command-type', suggestion: '调用 wc2_list_actions 查看支持的命令。', events: [] };
  const why = handler.validate?.(game, cmd);
  if (why) {
    const extra={};
    if(cmd.type==='useCard'){const analysis=analyzeCardTargets(game,cmd.card,cmd.country||game.player);extra.legalTargets=analysis.legalTargets.slice(0,80);extra.legalTargetCount=analysis.legalTargetCount;extra.ruleHint=analysis.ruleHint;}
    if(cmd.type==='buyCard'){const card=game.findCard?.(cmd.card,cmd.country||game.player);extra.cardReason=card?game.whyNot(card,cmd.country||game.player):'unknown-card';}
    const rangeHint=/priority|优先级/.test(String(why))?'priority 合法范围为 1..9。':null;
    return { ok: false, reason: why, suggestion: rangeHint||SUGGESTIONS[why] || (cmd.type==='useCard'?'目标不合法；请从 legalTargets 选择。空列表表示当前没有合法目标，通常需要机场、后方空地、射程或资源条件。':'刷新对应层级视图，并按返回的约束修正参数。'), ...extra, events: [] };
  }
  if(cmd.type==='buyCard'){
    const analysis=analyzeCardTargets(game,cmd.card,cmd.country||game.player);
    if(!analysis.deployable&&analysis.legalTargetCount===0&&!cmd.allowNoTarget)return {...analysis,ok:false,reason:'no-legal-card-target',suggestion:`买了也无处可用。${analysis.ruleHint} 可先占领或腾出部署地块、建设机场，或改买其它可立即使用的卡；若计划留待以后使用，请显式传 allowNoTarget:true。`,events:[]};
    delete cmd.allowNoTarget;
  }
  const events = [], off = game.on('*', event => events.push(clone(event)));
  let result;
  try { result = game.apply(cmd); } finally { off?.(); }
  return { ok: !!result?.ok, reason: result?.reason || null, suggestion: result?.ok ? null : (SUGGESTIONS[result?.reason] || '刷新视图后重试。'), events, result: clone(result),
    ...(cmd.order?.verb === 'allout' ? { warning: '将不计损失全面进攻，直到移动力耗尽，可能造成重大伤亡' } : {}) };
}

export function performCommandBatch(game, commands, opts = {}) {
  if(!Array.isArray(commands)||!commands.length)return {ok:false,reason:'empty-command-batch',results:[]};
  const results=[];
  for(const command of commands){const result=performCommand(game,command);results.push({command,result});if(!result.ok&&opts.stopOnError!==false)break;}
  return {ok:results.length===commands.length&&results.every(item=>item.result.ok),applied:results.filter(item=>item.result.ok).length,results};
}

export function autoOrganizeCountry(game, country = game.player) {
  const model = buildModel(game, country), commands = autoOrganize(game, country, model) || [], results = [];
  for (const command of commands) results.push({ command, result: performCommand(game, command) });
  return { ok: results.every(item => item.result.ok), commands: results };
}

export function listCommandTypes(game, country = game.player) {
  return { ...getActionCatalog(),country,activeCountry:game.activeCountry,canAct:game.activeCountry===country,
    cardShop:cardShopView(game,country),
    manualPriority:'move/attack/useCard with armyId marks that unit manual for this round; standing-order execution skips it. Issuing a new standing order clears manual priority for its formation.' };
}

function orderSummary(entry){
  if(!entry)return '无命令';const order=entry.order||{}, plan=entry.plan||{};
  const posts=plan._assignedPosts?Object.values(plan._assignedPosts):[], postTotal=Array.isArray(order.line)?order.line.length:posts.length;
  const axes=plan._axisAssignment?Object.values(plan._axisAssignment):[], wings=axes.length?` 双翼${axes.filter(n=>n===0).length}/${axes.filter(n=>n===1).length}`:'';
  const warning=(entry.warnings||[])[0];return `${order.verb||'?'}→${JSON.stringify(order.to)} ${entry.status||'pending'} ${Math.round((entry.progress||0)*100)}% R${entry.roundsActive||0}${postTotal?` 岗位${new Set(posts).size}/${postTotal}`:''}${wings}${warning?` 警告:${warning}`:''}`;
}

export function commandViewToText(view, detail = 'summary') {
  if (!view) return '无数据';
  if (view.error) return `错误：${view.error}`;
  if (view.layer === 'strategic') {
    const lines = [`第 ${view.round} 回合，${view.country}，当前行动方 ${view.activeCountry}`, `资金 ${view.economy.money}，工业 ${view.economy.industry}，科技 ${view.economy.tech}，稳定度 ${view.economy.stability}`,
      `战区 ${view.theaters.length}，集团军 ${view.armyGroups.length}，高危地块 ${view.dangerousAreas.length}`];
    if (view.dangerousAreas.length) lines.push(`危险：${view.dangerousAreas.map(a => `${a.name}(${Math.round(a.pLose * 100)}%)`).join('、')}`);
    if(view.theaters.length)lines.push(`战区命令：${view.theaters.map(t=>`${t.name}[${t.id}] ${orderSummary(t.order)}`).join('；')}`);
    if(view.armyGroups.length)lines.push(`集团军命令：${view.armyGroups.map(g=>`${g.name}[${g.id}] ${g.unitCount}单位 ${orderSummary(g.order)}`).join('；')}`);
    const eliminated=(view.countries||[]).filter(c=>c.eliminated);
    if(eliminated.length)lines.push(`已灭亡：${eliminated.map(c=>`${c.name}[${c.id}] eliminated，领地已转移（${c.territoryCount}块）`).join('；')}`);
    if(view.ownershipChangesUnknown?.length)lines.push(`未侦察归属变更：${view.ownershipChangesUnknown.length}块（旧主人已灭亡，新归属未知）`);
    return lines.join('\n');
  }
  if (view.layer === 'army-group') return `${view.name}[${view.id}]，${view.units.length}单位，命令 ${view.order?.status || '无'}\n${view.units.map(u => `#${u.id} ${u.name} ${u.areaName} HP${u.hp}/${u.maxHp} AP${u.movement}`).join('\n')}`;
  if (view.layer === 'theater') return `${view.name}[${view.id}]，集团军 ${view.armyGroups.length}，命令 ${view.order?.status || '无'}`;
  if (view.layer === 'micro') return `#${view.id} ${view.name}，${view.areaName}，HP ${view.hp}/${view.maxHp}，行动力 ${view.movement}/${view.maxMovement}，可移动 ${view.legalMoves.length}，可攻击 ${view.legalAttacks.length}`;
  return JSON.stringify(view);
}
