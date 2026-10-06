import { visibilityForCountry } from './rules/visibility.js';
import { EV } from './events.js';
import { handleUnitKilled } from './rules/combatModel.js';
export function sandboxAction(game,action){
 const st=game.stage,country=action.country||game.player,area=st.st(action.area);
 if(action.type==='delay'){
  const se=game.scenarioEvents;se.scheduled||=[];se.scheduled.push({round:game.round+Math.max(1,action.rounds||1),actions:structuredClone(action.actions||[])});return true;
 }
 if(action.type==='healArmy'||action.type==='damageArmy'){
  if(area)for(const army of [...area.armies]){const before=army.hp;army.hp=action.type==='healArmy'?Math.min(army.maxHp,army.hp+action.amount):Math.max(0,army.hp-action.amount);game.emit(action.type==='healArmy'?EV.UNIT_HEALED:EV.UNIT_DAMAGED,{country:area.country,area:area.id,armyId:army.id,hp:army.hp,lost:before-army.hp,hpBefore:before,restored:army.hp-before});if(!army.hp){area.armies.splice(area.armies.indexOf(army),1);handleUnitKilled(game,area,army,country,'sandboxCard');game.emit(EV.UNIT_DESTROYED,{area:area.id,armyId:army.id,byCountry:country});}}return true;
 }
 if(action.type==='revealArea'){game.sandboxState.intel||={};(game.sandboxState.intel[country]||=[]).push({area:action.area,until:game.round+(action.rounds||1),range:action.range||0});return true;}
 if(action.type==='falseIntel'){game.sandboxState.falseIntel||={};(game.sandboxState.falseIntel[country]||=[]).push({area:action.area,until:game.round+(action.rounds||2),text:action.text||'敌军可能正在集结'});game.addReport({category:'scenario',title:'未核实情报',text:action.text||'敌军可能正在集结',actors:[country],detail:{area:action.area,unconfirmed:true}});return true;}
 if(action.type==='activateCountry'){const c=st.countries.get(country);if(c){c.eliminated=false;if(c.id!==game.player&&!game.controllers?.has(c.id))c.ai=true;game.sandboxState.activated||={};game.sandboxState.activated[country]=true;}return true;}
 if(action.type==='triggerEvent'){const def=game.scenarioEvents.definitions.find(e=>e.id===action.eventId);if(def&&!game.scenarioEvents.history.includes(def.id)&&!game.scenarioEvents.pending.some(e=>e.id===def.id)){game.scenarioEvents.pending.push(structuredClone(def));game.emit(EV.SCENARIO_EVENT,{event:def,phase:'triggered'});}return true;}
 return false;
}
export function customCardReason(game,card,cmd,country){
 const area=game.stage.st(cmd.target);if(!area||!game.stage.enabled.has(area.id))return 'illegal-target';
 if(card.target==='own'&&area.country!==country)return 'illegal-target';
 if(card.target==='enemy'&&(!area.country||game.getDiplomaticRelation(country,area.country)!==1))return 'illegal-target';
 if(game.fogOfWar&&area.country!==country&&!visibilityForCountry(game,country).has(area.id)&&!(card.effects||[]).every(e=>e.type==='revealArea'||e.type==='falseIntel'))return 'target-hidden';
 const spawns=new Map();
 for(const effect of (card.effects||[]).flatMap(e=>Array.isArray(e.areas)?e.areas.map(area=>({...e,area,areas:undefined})):[e]))if(effect.type==='spawnArmy'){
  const target=game.stage.st(effect.area==='target'?cmd.target:effect.area);
  const owner=effect.country==='actor'||!effect.country?country:effect.country;
  if(!target||!game.stage.enabled.has(target.id)||target.country!==owner)return 'illegal-target';
  if(game.fogOfWar&&target.country!==country&&!visibilityForCountry(game,country).has(target.id))return 'target-hidden';
  const count=(spawns.get(target.id)||0)+1;spawns.set(target.id,count);
  if(target.armies.length+count>game.stage.maxArmies(target))return 'illegal-target';
  if(['destroyer','cruiser','battleship','aircraftcarrier'].includes(effect.armyType)!==!!target.sea)return 'illegal-target';
 }

 return null;
}
