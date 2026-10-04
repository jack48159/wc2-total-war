import { ScriptedAi } from '../../controllers.js';
import { AggressiveAi } from './aggressive.js';
import { TurtleAi } from './turtle.js';
import { EcoTechAi } from './eco_tech.js';
import { ExpansionistAi } from './expansionist.js';
import { DecapitationAi } from './decapitation.js';
import { ArtilleryAi } from './artillery.js';
import { ArmouredAi } from './armoured.js';
import { NavalAi } from './naval.js';
import { AirstrikeAi } from './airstrike.js';
import { GeneralStackAi } from './general_stack.js';
import { GuerrillaAi } from './guerrilla.js';
import { SpearheadAi } from './spearhead.js';
import { RandomAi } from './random.js';
import { PassiveAi } from './passive.js';

export const OPPONENT_REGISTRY = {
  O1: { id: 'O1', name: '原版AI', create: () => new ScriptedAi() },
  O2: { id: 'O2', name: '猛攻型', create: () => new AggressiveAi() },
  O3: { id: 'O3', name: '龟缩防守型', create: () => new TurtleAi() },
  O4: { id: 'O4', name: '经济科技型', create: () => new EcoTechAi() },
  O5: { id: 'O5', name: '快速扩张型', create: () => new ExpansionistAi() },
  O6: { id: 'O6', name: '斩首型', create: () => new DecapitationAi() },
  O7: { id: 'O7', name: '远程火力型', create: () => new ArtilleryAi() },
  O8: { id: 'O8', name: '装甲洪流型', create: () => new ArmouredAi() },
  O9: { id: 'O9', name: '海军优势型', create: () => new NavalAi() },
  O10: { id: 'O10', name: '卡牌空袭型', create: () => new AirstrikeAi() },
  O11: { id: 'O11', name: '将领堆叠型', create: () => new GeneralStackAi() },
  O12: { id: 'O12', name: '游击骚扰型', create: () => new GuerrillaAi() },
  O13: { id: 'O13', name: '单点突破型', create: () => new SpearheadAi() },
  O14: { id: 'O14', name: '随机合法动作', create: () => new RandomAi() },
  O15: { id: 'O15', name: '被动', create: () => new PassiveAi() },
  O16: { id: 'O16', name: '自我对弈', create: StrongAiClass => new StrongAiClass() },
};

export async function createOpponent(key) {
  const normKey = key.toUpperCase();
  const entry = OPPONENT_REGISTRY[normKey];
  if (!entry) throw new Error(`Unknown opponent type: ${key}`);
  if (normKey === 'O16') {
    const { StrongAi } = await import('../strong.js');
    return new StrongAi();
  }
  return entry.create();
}
