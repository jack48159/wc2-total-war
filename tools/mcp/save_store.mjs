import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from './runtime.mjs';
import { apiIdentity } from '../../public/src/game/api/catalog.js';

export const saveDir=path.join(root,'scratch/ai_lab/mcp/saves');
export const safeSlot=value=>String(value||'latest').replace(/[^a-zA-Z0-9_.-]/g,'_').slice(0,96)||'latest';
export const defaultSlot=config=>safeSlot(`${config.stage}_${config.player}_${config.seed}`);

export async function saveGame(game,config,slot=config.slot||defaultSlot(config)){
  await fs.mkdir(saveDir,{recursive:true});
  const id=apiIdentity(), savedAt=new Date().toISOString(), clean=safeSlot(slot), target=path.join(saveDir,`${clean}.json`), temp=`${target}.${process.pid}.${Date.now()}.tmp`;
  const envelope={schemaVersion:1,slot:clean,stage:config.stage,player:game.player,enemyAi:config.enemyAi||'scripted',seed:config.seed??1,fogOfWar:!!game.fogOfWar,
    ownedCommanders:[...(game.ownedCommanders||[])],commanderLevel:game.playerInfo?.commanderLevel??config.commanderLevel??null,
    apiVersion:id.apiVersion,rulesFingerprint:id.rulesFingerprint,savedAt,round:game.round,phase:game.phase,snapshot:game.snapshot()};
  await fs.writeFile(temp,JSON.stringify(envelope),'utf8');await fs.rename(temp,target);
  return {slot:clean,path:target,savedAt,round:game.round,stage:config.stage,player:game.player};
}

export async function listSaves(){
  await fs.mkdir(saveDir,{recursive:true});const rows=[];
  for(const file of await fs.readdir(saveDir))if(file.endsWith('.json')&&!file.includes('.turn'))try{const data=JSON.parse(await fs.readFile(path.join(saveDir,file),'utf8'));rows.push({slot:data.slot||file.slice(0,-5),stage:data.stage,player:data.player,enemyAi:data.enemyAi,seed:data.seed,round:data.round,phase:data.phase,savedAt:data.savedAt,apiVersion:data.apiVersion,rulesFingerprint:data.rulesFingerprint});}catch{}
  return rows.sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)));
}

export async function loadSave(slot='latest'){
  const rows=await listSaves();if(!rows.length)throw new Error('no-saves: 没有可恢复的存档');
  const meta=slot==='latest'?rows[0]:rows.find(row=>row.slot===safeSlot(slot));if(!meta)throw new Error(`save-not-found: ${slot}`);
  return JSON.parse(await fs.readFile(path.join(saveDir,`${meta.slot}.json`),'utf8'));
}
