#!/usr/bin/env node
import './runtime.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from './runtime.mjs';
import { Game } from '../../public/src/game/game.js';
import { listActions } from '../../public/src/game/api/actions.js';
import { getStrategicView,getTileView,getUnitView,getDiplomacyView,getEventsView,getCommandersView,getOrdersView,performCommand } from '../../public/src/game/api/command.js';

const stages=['battle_axis1','battle_nato1','battle_allies3','conquest_1','conquest_mirror_de'];
const rows=[];
for(let s=0;s<stages.length;s++){
  const game=await Game.create(stages[s],null,{seed:20261001+s,fogOfWar:true,logEnabled:false});let applied=0,rounds=0,error=null;
  try{
    for(let step=0;step<45&&game.phase!=='finished';step++){
      getStrategicView(game,game.player,{limit:8});getDiplomacyView(game,game.player);getOrdersView(game,game.player);getEventsView(game,game.player,{limit:10});getCommandersView(game,game.player);
      const area=game.stage.areas.find(a=>game.stage.enabled.has(a.id)&&a.country===game.player);if(area){getTileView(game,area.id,game.player);if(area.armies?.[0])getUnitView(game,area.armies[0].id,game.player);}
      const actions=listActions(game,game.player).filter(a=>a.type!=='endTurn');
      if(actions.length&&step%5!==4){const chosen=actions[(step*17+s*7)%actions.length];const cmd=chosen.type==='buyCard'&&chosen.expectedEffect?.deployable===false&&chosen.expectedEffect?.legalTargetCount===0?{...chosen.command,allowNoTarget:true}:chosen.command;const result=performCommand(game,cmd);if(!result.ok)throw new Error(`listed legal action rejected: ${result.reason}`);applied++;}
      else {const result=performCommand(game,{type:'endTurn'});if(!result.ok)throw new Error(`endTurn rejected: ${result.reason}`);rounds++;}
    }
  }catch(e){error=e.stack||String(e);}
  rows.push({stage:stages[s],player:game.player,applied,rounds,finalRound:game.round,phase:game.phase,error});
}
const report={generatedAt:new Date().toISOString(),passed:rows.every(r=>!r.error),stages:rows};
const dir=path.join(root,'scratch/ai_lab/mcp');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'api_stress.json'),JSON.stringify(report,null,2));
await fs.writeFile(path.join(dir,'api_stress.md'),`# API random legal-action stress\n\n${rows.map(r=>`- ${r.stage}: ${r.error?'FAIL '+r.error:'PASS'}, ${r.applied} actions, ${r.rounds} end turns, round ${r.finalRound}.`).join('\n')}\n`);
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
