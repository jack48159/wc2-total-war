#!/usr/bin/env node
import './runtime.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from './runtime.mjs';
import { Game } from '../../public/src/game/game.js';
import { Rng } from '../../public/src/game/rng.js';
import { handlerFor } from '../../public/src/game/commands.js';
import { previewAttack, performCommand } from '../../public/src/game/api/command.js';

const stages = ['battle_axis1','battle_nato1','battle_allies3','battle_wto3','conquest_mirror_de'];
const candidates = [];
for (const stage of stages) {
  const game = await Game.create(stage, null, { seed:20261001, fogOfWar:false, logEnabled:false });
  const attack = handlerFor('attack');
  for (const area of game.stage.areas) for (const unit of area.armies || []) {
    if (area.country !== game.player) continue;
    for (const target of game.stage.areas) {
      const command={type:'attack',from:area.id,to:target.id,armyId:unit.id};
      if (!attack.validate(game,command)) candidates.push({stage,player:game.player,snapshot:game.snapshot(),command});
    }
  }
}
if (!candidates.length) throw new Error('No legal initial attacks found');
const samples=[];
for(let i=0;i<Math.max(200,candidates.length*8);i++){
  const base=candidates[i%candidates.length], game=await Game.create(base.stage,base.snapshot,{player:base.player,logEnabled:false});
  game.rng=new Rng((20261001+i*2654435761)>>>0);
  const predicted=previewAttack(game,base.command.from,base.command.to,base.command.armyId,base.player);
  const result=performCommand(game,base.command), hit=result.events.find(e=>e.type==='unitAttacked');
  if(!result.ok||!hit)throw new Error(`Attack sample failed: ${base.stage} ${result.reason}`);
  samples.push({stage:base.stage,predictedDef:predicted.expectedDefenderLoss,predictedAtt:predicted.expectedAttackerLoss,actualDef:hit.damage,actualAtt:hit.counter});
}
const metric=key=>{const errors=samples.map(s=>s[`actual${key}`]-s[`predicted${key}`]);return {meanPredicted:samples.reduce((n,s)=>n+s[`predicted${key}`],0)/samples.length,meanActual:samples.reduce((n,s)=>n+s[`actual${key}`],0)/samples.length,bias:errors.reduce((a,b)=>a+b,0)/errors.length,mae:errors.reduce((a,b)=>a+Math.abs(b),0)/errors.length,rmse:Math.sqrt(errors.reduce((a,b)=>a+b*b,0)/errors.length)};};
const report={generatedAt:new Date().toISOString(),sampleCount:samples.length,candidateCount:candidates.length,stages,defenderLoss:metric('Def'),attackerLoss:metric('Att'),note:'Expected values are distribution means; individual attacks are intentionally random.'};
const dir=path.join(root,'scratch/ai_lab/mcp');await fs.mkdir(dir,{recursive:true});
await fs.writeFile(path.join(dir,'attack_calibration.json'),JSON.stringify(report,null,2));
await fs.writeFile(path.join(dir,'attack_calibration.md'),`# Attack prediction calibration\n\nSamples: ${report.sampleCount}; candidates: ${report.candidateCount}; stages: ${stages.join(', ')}.\n\n- Defender loss: predicted ${report.defenderLoss.meanPredicted.toFixed(2)}, actual ${report.defenderLoss.meanActual.toFixed(2)}, bias ${report.defenderLoss.bias.toFixed(2)}, MAE ${report.defenderLoss.mae.toFixed(2)}, RMSE ${report.defenderLoss.rmse.toFixed(2)}.\n- Attacker loss: predicted ${report.attackerLoss.meanPredicted.toFixed(2)}, actual ${report.attackerLoss.meanActual.toFixed(2)}, bias ${report.attackerLoss.bias.toFixed(2)}, MAE ${report.attackerLoss.mae.toFixed(2)}, RMSE ${report.attackerLoss.rmse.toFixed(2)}.\n`);
console.log(JSON.stringify(report,null,2));
