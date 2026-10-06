import { validateCondition } from './sandbox_conditions.js';
import { World } from './world.js';

export const SANDBOX_UNITS = ['infantry','panzer','tank','heavytank','artillery','rocket','destroyer','cruiser','battleship','aircraftcarrier'];
export function validateSandbox(config) {
  if (!config || !Array.isArray(config.areas) || !Array.isArray(config.countries)) throw Error('沙盒数据不完整');
  const countries = new Set(config.countries.map(c => c.id));
  if (countries.size !== config.countries.length || countries.size < 2 || !countries.has(config.player)) throw Error('至少保留两个不同的参战国，并选择有效的玩家国家');
  const ids = new Set();
  for (const a of config.areas) {
    if (!World.areas[a.id] || ids.has(a.id)) throw Error('存在无效或重复地块');
    ids.add(a.id);
    if (a.country && !countries.has(a.country)) throw Error('地块归属必须是参战国或无主');
    if (!Array.isArray(a.armies) || a.armies.length > (World.areas[a.id].unitCapacity || 4)) throw Error(`地块 ${a.id} 超过驻军容量`);
    for (const army of a.armies) {
      if (!SANDBOX_UNITS.includes(army.type) || !Number.isInteger(army.level) || army.level < 0 || army.level > 5) throw Error('兵种或等级无效');
      if (!a.country) throw Error('无主地块不能部署军队');
      if (['destroyer','cruiser','battleship','aircraftcarrier'].includes(army.type) !== (World.areas[a.id].f === 1)) throw Error('陆军只能部署在陆地，海军只能部署在海域');
    }
  }
  for (const c of config.countries) for (const key of ['money','industry']) if (!Number.isFinite(c[key]) || c[key] < 0) throw Error('财政必须是非负数');
  for (const [pair,state] of Object.entries(config.diplomacy?.relations || {})) {
    const sides = pair.split('_');
    if (sides.length !== 2 || sides[0] === sides[1] || sides.some(c => !countries.has(c)) || !['war','peace','alliance'].includes(state)) throw Error('外交关系无效');
  }
  const eventIds = new Set();
  const checkActions = actions => {
    for (const a of actions || []) {
      if (!['changeMoney','changeIndustry','changeStability','setDiplomacy','spawnArmy','captureArea','setVariable'].includes(a.type)) throw Error('事件包含不支持的效果');
      if (a.country && !countries.has(a.country)) throw Error('事件目标国不在参战国中');
      if (['spawnArmy','captureArea'].includes(a.type) && !ids.has(a.area)) throw Error('事件目标地块不在战区内');
      if (a.type === 'setDiplomacy' && (!countries.has(a.first) || !countries.has(a.second) || a.first === a.second || !['war','peace','alliance'].includes(a.state))) throw Error('事件外交效果无效');
      if (a.type === 'spawnArmy' && !SANDBOX_UNITS.includes(a.armyType)) throw Error('事件兵种无效');
      if (a.amount != null && !Number.isFinite(a.amount)) throw Error('事件数值无效');
    }
  };
  for (const e of config.scenarioEvents?.definitions || []) {
    if (!e.id || eventIds.has(e.id) || !e.title || !e.text || !['notice','decision'].includes(e.type)) throw Error('剧情需要唯一编号、标题、内容和类型');
    eventIds.add(e.id);
    if (!countries.has(e.targetCountry)) throw Error('剧情接收国无效');
    if (!Array.isArray(e.conditions) || !e.conditions.length || e.conditions.length > 32) throw Error('剧情需要 1 至 32 项触发条件');
    for (const condition of e.conditions) validateCondition(condition, config);
    checkActions(e.actions);
    if (e.type === 'decision') {
      if (!Array.isArray(e.choices) || e.choices.length < 2) throw Error('决策至少需要两个选项');
      const choices = new Set();
      for (const choice of e.choices) { if (!choice.id || !choice.text || choices.has(choice.id)) throw Error('决策选项编号或文字无效'); choices.add(choice.id); checkActions(choice.actions); }
    }
  }
  const dependencies=new Map();
  const collect=(condition,out)=>{if(['all','any'].includes(condition.type))for(const child of condition.conditions)collect(child,out);else if(['eventResolved','decisionChosen'].includes(condition.type))out.push(condition.eventId);};
  for(const event of config.scenarioEvents?.definitions||[]){const deps=[];for(const c of event.conditions)collect(c,deps);dependencies.set(event.id,deps);}
  const visiting=new Set(),done=new Set();const visit=id=>{if(visiting.has(id))throw Error('前置事件存在循环依赖');if(done.has(id))return;visiting.add(id);for(const next of dependencies.get(id)||[])visit(next);visiting.delete(id);done.add(id);};
  for(const id of dependencies.keys())visit(id);
  return config;
}

export function applySandboxConfig(data, config) {
  validateSandbox(config);
  data.areas = structuredClone(config.areas);
  data.enabled = data.areas.map(a => a.id);
  data.countries = structuredClone(config.countries);
  data.player = config.player;
  data.diplomacy = structuredClone(config.diplomacy || {enabled:true,relations:{},pacts:{}});
  data.diplomacy.enabled = true;
  data.scenarioEvents = structuredClone(config.scenarioEvents || {definitions:[]});
  for (const event of data.scenarioEvents.definitions) event.body = event.text;
  delete data.events; delete data.ai_rules;
  for (const c of data.countries) { c.alliance = c.id; c.ai = c.id !== data.player; }
}
