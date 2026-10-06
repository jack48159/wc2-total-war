// Shared condition catalog for the sandbox editor and authoritative engine.
export const SANDBOX_CONDITIONS = [
 ['round','回合门槛'],['diplomaticRelation','两国当前关系'],['allianceFormed','两国结盟后'],['warDeclared','某国被宣战后'],['peaceSigned','两国停战后'],['countryDefeated','国家灭亡'],['countryCapitulated','国家投降后'],['areaOwner','地块归属'],['areaCaptured','地块被占领后'],['capitalLost','首都失守'],['atWar','国家处于战争'],['resource','资源门槛'],['armyCount','兵力数量门槛'],['territoryCount','陆地数量门槛'],['stabilityBelow','稳定度低于门槛'],['eventResolved','前置事件完成'],['decisionChosen','前置决策选择'],['campaignDecision','继承上一章决策']
];
export const COMPARISONS = [['gte','不少于'],['lte','不多于'],['eq','等于'],['gt','大于'],['lt','小于']];
export function defaultCondition(type, config) {
  const first=config.player, second=config.countries.find(c=>c.id!==first)?.id;
  return {type,country:first,first:type==='warDeclared'?'':first,second,area:config.areas[0]?.id,value:type==='round'?1:100,op:'gte',state:'alliance',resource:'money',eventId:'',choiceId:''};
}
export function validateCondition(cond, config, depth=0) {
  if(!cond||depth>8)throw Error('事件触发条件无效，请检查国家、地块、门槛或前置事件');
  if(['all','any'].includes(cond.type)){
    if(!Array.isArray(cond.conditions)||!cond.conditions.length||cond.conditions.length>32)throw Error('事件触发条件无效，请检查国家、地块、门槛或前置事件');
    for(const c of cond.conditions)validateCondition(c,config,depth+1);return;
  }
  if(Array.isArray(cond.areas)){if(!['areaOwner','areaCaptured'].includes(cond.type)||!cond.areas.length||cond.areas.length>64||new Set(cond.areas).size!==cond.areas.length||!['all','any'].includes(cond.areaMatch||'all'))throw Error('请在地图点选 1 至 64 块目标领土');for(const area of cond.areas)validateCondition({...cond,area,areas:undefined},config,depth+1);return;}
  if(!SANDBOX_CONDITIONS.some(([id])=>id===cond.type))throw Error('事件触发条件无效，请检查国家、地块、门槛或前置事件');
  const countries=new Set(config.countries.map(c=>c.id));
  const pair=['diplomaticRelation','allianceFormed','peaceSigned'].includes(cond.type);
  if(pair&&(!countries.has(cond.first)||!countries.has(cond.second)||cond.first===cond.second))throw Error('事件触发条件无效，请检查国家、地块、门槛或前置事件');
  if(['warDeclared','countryDefeated','countryCapitulated','areaOwner','areaCaptured','capitalLost','atWar','resource','armyCount','territoryCount','stabilityBelow'].includes(cond.type)&&!countries.has(cond.country))throw Error('事件触发条件无效，请检查国家、地块、门槛或前置事件');
  if(cond.type==='warDeclared'&&cond.first&&(!countries.has(cond.first)||cond.first===cond.country))throw Error('事件触发条件无效，请检查国家、地块、门槛或前置事件');
  if(['areaOwner','areaCaptured'].includes(cond.type)&&!config.areas.some(a=>a.id===cond.area))throw Error('事件触发条件无效，请检查国家、地块、门槛或前置事件');
  if(cond.type==='diplomaticRelation'&&!['war','peace','alliance'].includes(cond.state))throw Error('事件触发条件无效，请检查国家、地块、门槛或前置事件');
  if(['round','resource','armyCount','territoryCount','stabilityBelow'].includes(cond.type)&&(!Number.isFinite(cond.value)||cond.value<0))throw Error('事件触发条件无效，请检查国家、地块、门槛或前置事件');
  if(cond.type==='round'&&(!Number.isInteger(cond.value)||cond.value<1))throw Error('事件触发条件无效，请检查国家、地块、门槛或前置事件');
  if(['round','resource','armyCount','territoryCount'].includes(cond.type)&&!COMPARISONS.some(([op])=>op===(cond.op||'eq')))throw Error('事件触发条件无效，请检查国家、地块、门槛或前置事件');
  if(cond.type==='resource'&&!['money','industry'].includes(cond.resource))throw Error('事件触发条件无效，请检查国家、地块、门槛或前置事件');
  if(cond.type==='campaignDecision'&&(!cond.eventId||!cond.choiceId))throw Error('请选择上一章决策及选项');
  if(['eventResolved','decisionChosen'].includes(cond.type)){
    const event=config.scenarioEvents?.definitions?.find(e=>e.id===cond.eventId);
    if(!event)throw Error('事件触发条件无效，请检查国家、地块、门槛或前置事件');
    if(cond.type==='decisionChosen'&&(event.type!=='decision'||!event.choices?.some(c=>c.id===cond.choiceId)))throw Error('事件触发条件无效，请检查国家、地块、门槛或前置事件');
  }
}
export function compareCondition(value, cond) {
  const target=cond.value;
  return ({gte:value>=target,lte:value<=target,eq:value===target,gt:value>target,lt:value<target})[cond.op||'eq']===true;
}
export function recordScenarioOccurrence(game, type, payload) {
  const se=game.scenarioEvents;if(!se)return;
  se.occurrences ||= {};
  const mark=(key)=>{se.occurrences[key]=true;};
  if(type==='diplomacyChanged'&&payload.state!==payload.previousState){
    const pair=[payload.first,payload.second].sort().join('_');
    if(payload.state===3)mark('alliance:'+pair);
    if(payload.state===2&&payload.previousState===1)mark('peace:'+pair);
    if(payload.state===1){mark('war:'+payload.first+':'+payload.second);mark('war:*:'+payload.second);}
  }
  if(type==='areaCaptured')mark('capture:'+payload.area+':'+payload.to);
  if(type==='countryCapitulated')mark('capitulated:'+payload.country);
}
export function evaluateSandboxCondition(game, cond) {
  const seen=game.scenarioEvents?.occurrences||{};
  const pair=[cond.first,cond.second].sort().join('_');
  if(cond.type==='allianceFormed')return !!seen['alliance:'+pair];
  if(cond.type==='peaceSigned')return !!seen['peace:'+pair];
  if(cond.type==='warDeclared')return !!seen['war:'+(cond.first||'*')+':'+cond.country];
  if(cond.type==='areaCaptured')return !!seen['capture:'+cond.area+':'+cond.country];
  if(cond.type==='countryCapitulated')return !!seen['capitulated:'+cond.country];
  if(cond.type==='eventResolved')return game.scenarioEvents?.history?.includes(cond.eventId)||false;
  if(cond.type==='decisionChosen'||cond.type==='campaignDecision')return game.scenarioEvents?.variables?.['decision_'+cond.eventId]===cond.choiceId;
  if(cond.type==='resource'){
    const owner=cond.country===game.player?game:game.stage.countries.get(cond.country);
    return !!owner&&compareCondition(owner[cond.resource]||0,cond);
  }
  if(cond.type==='armyCount')return compareCondition(game.stage.areas.reduce((n,a)=>n+(a.country===cond.country?(a.armies?.length||0):0),0),cond);
  if(cond.type==='territoryCount')return compareCondition(game.stage.areas.filter(a=>a.country===cond.country&&!a.sea).length,cond);
  return null;
}
