import { supplyCapacity, supplyRuleHint } from '../supply.js';
import { handlerFor } from '../commands.js';

const AIR=new Set([10,11,12,13]),LAND_ARMY=new Set([0,1,2,3,4,5,28]),NAVY=new Set([6,7,8,9]),DEVELOPMENT=new Set([14,15,16,17,18,19,20]),TACTIC=new Set([22,23,24,25]);

export function cardTargetRule(cardId,game){
  if(cardId===21)return '研究卡购买后立即生效，不需要目标地块。';
  if(AIR.has(cardId))return '需要己方机场，并且目标必须位于机场射程内；空袭目标还必须有敌军。';
  if(LAND_ARMY.has(cardId))return '需要符合兵种城市/工业等级、未满编的己方陆地部署地块。';
  if(NAVY.has(cardId))return '需要未满编的己方港口海域。';
  if(DEVELOPMENT.has(cardId))return '需要可建设或升级且未达到上限的己方陆地。';
  if(TACTIC.has(cardId))return '需要有符合条件友军的己方地块；已有相同战术时不可重复使用。';
  if(cardId===26)return supplyRuleHint(game);
  if(cardId===27)return '需要存在未满级友军的己方地块。';
  return '需要满足该卡牌的目标地块规则。';
}

// 征兵规则：新占领地要等 recruitWait 回合后才能征兵。返回规则与该国仍在等待期的地块。
export function recruitRuleInfo(game,country=game.player){
  const wait=game.recruitWait||0,waiting=[];
  if(wait>0)for(const area of game.stage.areas){
    if(!game.stage.enabled.has(area.id)||area.country!==country)continue;
    const at=game.capturedAt?.[area.id];if(at==null)continue;
    const left=wait-(game.round-at);if(left>0)waiting.push({areaId:area.id,roundsLeft:left,capturedRound:at});
  }
  return {recruitWait:wait,immediate:wait===0,note:wait?`新占领地需等 ${wait} 回合才能征兵(原因码 recently-captured)；roundsLeft=还需等待的回合数。`:'新占领地可立即征兵。',waiting};
}

export function analyzeCardTargets(game,cardId,country=game.player){
  const handler=handlerFor('useCard'),card=game.findCard?.(cardId,country);if(!handler||!card)return {deployable:false,legalTargetCount:0,legalTargets:[],reason:'未知卡牌或尚未实现。',ruleHint:cardTargetRule(cardId,game)};
  const blocked=game.whyNot(card,country);
  const blockedReason=blocked==='cooldown'?'冷却中。':blocked==='tech'?'科技等级不足。':blocked==='money'?'资金不足。':blocked==='industry'?'工业不足。':blocked==='tech-in-progress'?'已有科技研究进行中。':null;
  if(cardId===21)return {deployable:!blocked,legalTargetCount:null,legalTargets:[],reason:blockedReason||'无需目标，购买后开始研究。',ruleHint:cardTargetRule(cardId,game)};
  const targetGame=new Proxy(game,{get(target,key){if(key==='whyNot')return()=>null;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}}),legalTargets=[];
  for(const area of game.stage.areas)if(game.stage.enabled.has(area.id)&&!handler.validate(targetGame,{type:'useCard',card:cardId,target:area.id,country,pendingPurchase:true}))legalTargets.push(area.id);
  const deployable=!blocked&&legalTargets.length>0;
  const reason=blockedReason||(legalTargets.length?null:`买了也无处可用：${cardTargetRule(cardId,game)}`);
  const rule=(game.recruitWait||0)>0?recruitRuleInfo(game,country).waiting.map(w=>w.areaId):[];
  return {deployable,legalTargetCount:legalTargets.length,legalTargets,reason,ruleHint:cardTargetRule(cardId,game),...(cardId===26?{supplyByInfrastructure:!!game.supplyByInfrastructure,supplyTargets:legalTargets.map(areaId=>({areaId,maxRecovery:supplyCapacity(game,game.stage.st(areaId))}))}:{}),...(rule.length?{waitingRecruitAreas:rule}:{})};
}
