import { element } from './sandbox_ui.js';
import { E } from '../core/index.js';
import { evaluateCondition } from '../game/rules/scenario_events.js';
export function attachSandboxObjectives(battle){
 const game=battle.game,obj=game.stage.data.sandboxFeatures?.objectives;if(!obj?.enabled||battle.sandboxGoalButton?.isConnected)return;
 const button=element(document.body,'button','战役目标','sb-goal-button');battle.sandboxGoalButton=button;
 button.onclick=()=>{const overlay=element(document.body,'div','','sb-share-overlay');battle.sandboxGoalOverlay=overlay;const panel=element(overlay,'section','','sb-share-dialog');element(panel,'h2','战役目标');element(panel,'p',(obj.mode==='all'?'完成全部目标':'完成任意目标')+(obj.deadline?' · 限时 '+obj.deadline+' 回合':''));
 const name=id=>E.strings[id]||id;
 for(const [title,goals] of [['胜利目标',obj.goals],['失败条件',obj.failures||[]]]){element(panel,'h3',title);for(const g of goals){let text,met=false;if(g.type==='holdArea'){const ids=g.areas||[g.area],values=ids.map(area=>{const since=game.sandboxState.holdSince?.[g.areas?g.id+':'+area:g.id];return since==null?0:Math.max(0,game.round-since);});const held=(g.areaMatch==='any'?Math.max:Math.min)(...values);text=name(g.country)+' 坚守目标区域（'+ids.length+' 块）：'+held+' / '+g.value+' 回合';met=held>=g.value;}else if(g.type==='escort'){const id=game.sandboxState.escortIds?.[g.id],current=game.stage.areas.find(a=>a.armies.some(ar=>ar.id===id)),ids=g.areas||[g.area];text='护送部队至目标区域（'+ids.length+' 块） · '+(current?'部队仍在行动':game.fogOfWar?'部队状态未知':'部队已损失');met=ids.includes(current?.id);}else{met=evaluateCondition(game,g);text=g.type==='areaOwner'?name(g.country)+' 控制目标区域（'+(g.areas?.length||1)+' 块）':g.type==='countryDefeated'?name(g.country)+' 灭亡':g.type==='diplomaticRelation'?name(g.first)+' 与 '+name(g.second)+' 达成 '+({alliance:'同盟',war:'战争',peace:'和平'})[g.state]:g.type==='round'?'回合达到 '+g.value:'完成事件 '+(game.scenarioEvents.definitions.find(e=>e.id===g.eventId)?.title||g.eventId);}element(panel,'p',(met?'✓ ':'○ ')+text);}}
 const close=element(panel,'button','返回战场','mp-header-btn');close.onclick=()=>{overlay.remove();battle.sandboxGoalOverlay=null;};};
}
