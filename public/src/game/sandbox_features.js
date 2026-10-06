import { evaluateCondition } from './rules/scenario_events.js';
export function sandboxFeatures(config){return structuredClone(config?.features||{});}
export function customArmyDef(stage,country,unit){
 const type=typeof unit==='string'?unit:unit?.type;
 const flag=stage.countries.get(country)?.flag;
 const base=(flag&&stage.armyDefs[flag]?.[type])||stage.armyDefs.others?.[type]||{maxHp:100,movement:1,minAttack:0,maxAttack:0};
 const custom=typeof unit==='object'&&stage.data.sandboxFeatures?.units?.find(d=>d.id===unit.templateId&&d.base===type);
 return custom?{...base,...custom.stats,maxHp:custom.stats.maxHp||base.maxHp}:base;
}
export function sandboxCards(features){
 const cards=(features?.cards||[]).map(c=>({...c,custom:true,level:1,round:c.cooldown||0,description:c.description||c.name}));
 if(features?.fogOfWar)cards.push({id:9000,custom:true,name:'战区侦察',description:'侦察目标及相邻地块，持续两回合。',type:'strategy',price:50,industry:10,level:1,round:2,target:'any',effects:[{type:'revealArea',country:'actor',area:'target',range:1,rounds:2}]});
 for(const [i,u] of (features?.units||[]).entries())cards.push({id:u.recruitCardId||2000+i,custom:true,name:'征召 '+u.name,type:['destroyer','cruiser','battleship','aircraftcarrier'].includes(u.base)?'navy':'army',price:u.price??100,industry:u.industry||0,level:1,round:0,target:'own',imageUrl:u.imageUrl,effects:[{type:'spawnArmy',armyType:u.base,templateId:u.id,area:'target',country:'actor'}]});
 return cards;
}
export function objectiveResult(game){
 const objectives=game.stage.data.sandboxFeatures?.objectives;if(!objectives?.enabled)return null;
 const check=goal=>{
  if(goal.type==='holdArea'){
   const owns=game.stage.st(goal.area)?.country===goal.country;
   game.sandboxState.holdSince ||= {};const key=goal.id;
   if(!owns){delete game.sandboxState.holdSince[key];return false;}
   game.sandboxState.holdSince[key]??=game.round;
   return game.round-game.sandboxState.holdSince[key]>=goal.value;
  }
  if(goal.type==='escort')return game.stage.st(goal.area)?.armies?.some(a=>a.id===game.sandboxState.escortIds?.[goal.id]&&game.stage.st(goal.area).country===goal.country)||false;
  return evaluateCondition(game,goal);
 };
 const fail=(objectives.failures||[]).some(check);
 if(fail)return {result:'defeat',reason:'触发失败目标'};
 const goals=objectives.goals||[],results=goals.map(check),won=goals.length&&(objectives.mode==='any'?results.some(Boolean):results.every(Boolean));
 if(won)return {result:'victory',reason:'完成自定义战役目标'};
 if(objectives.deadline&&game.round>objectives.deadline)return {result:'defeat',reason:'超过目标时限'};
 return {pending:true};
}
export function nextCampaignOptions(game){
 if(game.result?.result==='defeat'||!game.campaignRun)return null;
 const run=game.campaignRun,index=(run.index||0)+1,chapter=run.chapters?.[index];if(!chapter)return null;
 const config=structuredClone(chapter.config),carry=run.carry||{},old=game.stage;
 if(carry.resources)for(const c of config.countries){const src=old.countries.get(c.id);if(src){c.money=c.id===game.player?game.money:src.money;c.industry=c.id===game.player?game.industry:src.industry;}}
 if(carry.diplomacy){const valid=new Set(config.countries.map(c=>c.id));config.diplomacy={enabled:true,relations:structuredClone(game.diplomacy.relations||{}),pacts:structuredClone(game.diplomacy.pacts||{})};config.diplomacy.relations=Object.fromEntries(Object.entries(config.diplomacy.relations||{}).filter(([pair])=>pair.split('_').every(c=>valid.has(c))));config.diplomacy.pacts=Object.fromEntries(Object.entries(config.diplomacy.pacts||{}).filter(([pair])=>pair.split('_').every(c=>valid.has(c))));}
 if(carry.armies){const valid=new Set(config.countries.map(c=>c.id));for(const area of config.areas){const previous=old.st(area.id);if(previous?.country===area.country&&valid.has(area.country)){area.armies=previous.armies.map(a=>({type:a.type,templateId:a.templateId,level:a.level,cards:a.cards,hp:a.hp,maxHp:a.maxHp}));}}config.features||={};config.features.units||=[];
 const carried=new Set(config.areas.flatMap(a=>a.armies||[]).map(a=>a.templateId).filter(Boolean));
 const used=new Set(config.features.units.map(u=>u.recruitCardId));
 for(const u of old.data.sandboxFeatures?.units||[]){if(!carried.has(u.id))continue;const existing=config.features.units.find(d=>d.id===u.id);const definition=structuredClone(u);let cardId=existing?.recruitCardId||definition.recruitCardId||2000;if(!existing){while(used.has(cardId))cardId++;used.add(cardId);}definition.recruitCardId=cardId;if(existing)Object.assign(existing,definition);else config.features.units.push(definition);}}

 return {sandbox:true,sandboxCustom:true,sandboxConfig:config,participatingCountries:config.countries.map(c=>c.id),player:config.player,freeDiplomacy:true,historicalDiplomacy:false,fogOfWar:!!config.features?.fogOfWar,campaignRun:{...structuredClone(run),index},campaignVariables:carry.decisions?structuredClone(game.scenarioEvents.variables):null};
}
