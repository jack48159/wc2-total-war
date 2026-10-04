import { playerCountryName } from './describe.js';
import { register } from './commands.js';

export const COMMANDER_ATLAS = 'commanders/commander_roster_de_pl_v1.png';
export const nationKey = country => String(country || '').replace(/\d+$/, '');
export const ARMOUR = new Set(['panzer', 'tank', 'heavytank']);
const TYPES = {
  armour: ARMOUR,
  infantry: new Set(['infantry', 'eliteinfantry']),
  artillery: new Set(['artillery', 'rocket']),
  naval: new Set(['destroyer', 'cruiser', 'battleship', 'aircraftcarrier']),
};
const MOD_NAMES = {attack:'攻击',counter:'反击',armourAttack:'装甲攻击',infantryAttack:'步兵攻击',artilleryAttack:'炮兵攻击',navalAttack:'舰艇攻击',massArmourAttack:'装甲集群攻击',supportAttack:'非装甲攻击',defence:'受伤',armourDefence:'装甲受伤',infantryDefence:'步兵受伤',navalDefence:'舰艇受伤'};
let roster = null;
export async function loadCommanderData() {
  if (!roster) roster = Promise.all([
    fetch('data/commanders.json').then(r => { if (!r.ok) throw new Error('指挥官名册读取失败'); return r.json(); }),
    fetch('data/hoi4_commanders.json').then(r => r.ok ? r.json() : { commanders: [] }).catch(() => ({ commanders: [] })),
  ]).then(([base, imported]) => ({ ...base, commanders: [...base.commanders, ...(imported.commanders || [])] }));
  return roster;
}
export function setCommanderData(data) { roster = Promise.resolve(data); cached = data; }
let cached = null;
export const GROUP_LIMIT = 16;
export function commanderData() { return cached; }
export async function readyCommanders() {
  try { const data = await loadCommanderData(); cached = data; return data; }
  catch (e) { roster = null; if (!cached) cached = { version: 2, tiers: {}, groupLimit: 16, maxGroups: 4, free: [], commanders: [], generalStaff: { mods: {} } }; return cached; }   // headless tools without the data folder: no named commanders, groups still work
}
export function countryCommanders(country) {
  const key = nationKey(country), data = cached;
  if (!data) return [];
  const named = data.commanders.filter(s => s.country === key);
  const byCost = (a, b) => a.cost - b.cost;
  // Assign these two posts to existing national officers; keep their identities and portraits.
  const candidates = [...named.filter(s => !s.marshal).sort(byCost), ...named.filter(s => s.marshal).sort(byCost)];
  const free = data.free.map((role, index) => {
    const officer = candidates[index];
    return officer
      ? { ...officer, cost:0, startingRole:role.id, roleName:role.name, legacyId:`${key}_${role.id}` }
      : { ...role, id:`${key}_${role.id}`, country:key, cost:0, startingRole:role.id, roleName:role.name };
  });
  const assignedIds = new Set(free.map(s => s.id));
  const marshals = [...free.filter(s => s.marshal), ...named.filter(s => s.marshal && !assignedIds.has(s.id)).sort(byCost)].slice(0, 2);
  while (marshals.length < 2) {
    const n = marshals.length + 1;
    marshals.push({ id: `${key}_reserve_marshal_${n}`, country:key, name:`预备元帅 ${n}`, tactic:'集团军指挥', bio:'本国预备役高级指挥官。', marshal:true, cost:0, mods:{} });
  }
  const basics = [...free.filter(s => !s.marshal), ...named.filter(s => !s.marshal && !assignedIds.has(s.id)).sort(byCost)].slice(0, 10);
  while (basics.length < 10) {
    const n = basics.length + 1;
    basics.push({ id:`${key}_reserve_officer_${n}`, country:key, name:`基础指挥官 ${n}`, tactic:'基础指挥', bio:'本国预备役指挥官。', cost:0, mods:{} });
  }
  const starterIds = new Set([...marshals, ...basics].map(s => s.id));
  const starters = [...marshals, ...basics].map(s => ({ ...s, cost:0 }));
  return [...free, ...starters.filter(s => !assignedIds.has(s.id)), ...named.filter(s => !starterIds.has(s.id))].slice(0, 30);
}
export const commanderById = (country, id) => id == null ? undefined : countryCommanders(country).find(c => c.id === id || c.legacyId === id);
export const ownsCommander = (profile, commander) => !!commander && (commander.cost === 0 || (profile?.ownedCommanders || []).includes(commander.id));
export function modLines(mods = {}) {
  return Object.entries(mods).filter(([,v]) => v).map(([k,v]) => ({
    text: (v > 0 ? '▲ ' : '▼ ') + (MOD_NAMES[k] || k) + ' ' + (v > 0 ? '+' : '−') + Math.round(Math.abs(v) * 100) + '%',
    positive: v > 0,
  }));
}
export function armyRows(game, country) {
  return game.stage.areas.filter(a => a.country === country).flatMap(area => area.armies.filter(a => a.hp > 0).map(army => ({ army, area })));
}
export function liveGroupUnits(game, group) {
  const ids = new Set(group.unitIds || []);
  return armyRows(game, group.country).filter(r => ids.has(r.army.id));
}
export function groupForArmy(game, country, armyId) {
  if (!game?.armyGroups) return null;
  if (country) {
    const match = game.armyGroups.find(g => g.country === country && (g.unitIds || []).includes(armyId));
    if (match) return match;
  }
  return game.armyGroups.find(g => (g.unitIds || []).includes(armyId)) || null;
}
export function pruneArmyGroups(game) {
  for (const group of game.armyGroups || []) {
    const live = new Set(armyRows(game, group.country).map(r => r.army.id));
    group.unitIds = (group.unitIds || []).filter(id => live.has(id));
  }
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export function tacticalBonus(game, country, army, ctx = {}) {
  const group = groupForArmy(game, country, army.id), spec = group && commanderById(country, group.commanderId);
  const theater = group && (game.theatres || []).find(t => t.country === country && t.armyIds.includes(group.id));
  const marshal = theater?.marshalId && commanderById(country, theater.marshalId);
  const siblings = theater ? theater.armyIds.filter(id => id !== group.id) : [];
  const stack = cached?.coordinationStack ?? 3;
  const attackCount = marshal && ctx.toAreaId != null && ctx.role === 'attack'
    ? Math.min(stack, siblings.filter(id => game.coordination?.attacks?.[ctx.toAreaId]?.includes?.(id)).length) : 0;
  const neighbours = ctx.fromAreaId != null ? new Set(game.stage.adjE?.get(ctx.fromAreaId) || []) : new Set();
  const defenceCount = marshal && ['defend', 'counter'].includes(ctx.role)
    ? Math.min(stack, siblings.filter(id => {
        const other = game.armyGroups.find(g => g.id === id);
        return other && liveGroupUnits(game, other).some(({ area }) => neighbours.has(area.id));
      }).length) : 0;
  if (!spec) return { attack: clamp(1 + attackCount * (marshal?.coordination?.attack || 0), .5, 1.6), counter: 1,
    received: clamp(1 - defenceCount * (marshal?.coordination?.defence || 0), .4, 1.6), commander: null };
  const mods = spec.mods || {}, type = Object.keys(TYPES).find(k => TYPES[k].has(army.type));
  const attack = 1 + (mods.attack || 0) + (mods[type + 'Attack'] || 0)
    + (type === 'armour' ? (liveGroupUnits(game, group).filter(r => ARMOUR.has(r.army.type)).length >= 3 ? mods.massArmourAttack || 0 : 0) : mods.supportAttack || 0);
  return { attack: clamp(attack + attackCount * (marshal?.coordination?.attack || 0), .5, 1.6), counter: clamp(1 + (mods.attack || 0) + (mods.counter || 0), .5, 1.6),
    received: clamp(1 - (mods.defence || 0) - (mods[type + 'Defence'] || 0) - defenceCount * (marshal?.coordination?.defence || 0), .4, 1.6), commander: spec.id, tactic: spec.tactic };
}
// The human player edits their own country in their own turn; an AI country (not human) is edited by its own controller on its own turn.
export const isHuman = (game, country) => game.player === country && !!game.stage?.humanCountries?.has(country);
const editable = (game, country) => game.activeCountry === country && game.phase === 'playing';
const groupsOf = (game, country) => game.armyGroups.filter(g => g.country === country);
const findGroup = (game, cmd) => game.armyGroups.find(g => g.id === cmd.groupId && g.country === cmd.country);
const yearOK = (game, spec) => {
  if (!spec.years) return true;
  const year = parseInt(game.info?.age, 10) || parseInt(game.info?.year, 10);
  return !Number.isFinite(year) || (year >= spec.years[0] && year <= spec.years[1]);
};
export const commanderYearAvailable = yearOK;
function validateCommander(game, cmd, except = null) {
  const spec = commanderById(cmd.country, cmd.commanderId);
  if (!spec) return '指挥官不属于本国';
  if (isHuman(game, cmd.country) && !ownsCommander(game, spec)) return '指挥官尚未购买';   // AI countries do not spend medals: every commander of their country whose years fit the stage is available
  if (!yearOK(game, spec)) return '本剧本年代不可用';
  if (groupsOf(game, cmd.country).some(g => g.id !== except && g.commanderId === spec.id)) return '该指挥官已任命到其它集团军';
  if ((game.theatres || []).some(t => t.marshalId === spec.id)) return '该指挥官已任战区元帅';
  return null;
}
function validateBase(game, cmd) { return editable(game, cmd.country) ? null : '只能在本国回合管理集团军'; }
const changed = (game, cmd) => game.emit('armyGroupChanged', { country: cmd.country });
register('createArmyGroup', {
  validate(game, cmd) {
    return validateBase(game, cmd) || (groupsOf(game, cmd.country).length >= (cached?.maxGroups || 4) ? `每国最多 ${cached?.maxGroups || 4} 个集团军` : null)
      || validateCommander(game, cmd) || (cmd.name != null && !String(cmd.name).trim() ? '集团军名称不能为空' : null);
  },
  execute(game, cmd) {
    const n = game.nextArmyGroupId++;
    game.armyGroups.push({ id: 'group_' + n, country: cmd.country, name: String(cmd.name || '第 ' + (groupsOf(game, cmd.country).length + 1) + ' 集团军').slice(0, 24),
      commanderId: cmd.commanderId, unitIds: [] });
    changed(game, cmd);
  },
});
register('transferUnits', {
  validate(game, cmd) {
    if (validateBase(game, cmd)) return validateBase(game, cmd);
    if (!Array.isArray(cmd.unitIds) || !cmd.unitIds.length || new Set(cmd.unitIds).size !== cmd.unitIds.length) return '请选择不同的单位';
    const live = new Set(armyRows(game, cmd.country).map(r => r.army.id));
    if (cmd.unitIds.some(id => !live.has(id))) return '只能编入本国存活单位';
    const target = cmd.toGroupId == null ? null : game.armyGroups.find(g => g.id === cmd.toGroupId && g.country === cmd.country);
    if (cmd.toGroupId != null && !target) return '集团军不存在';
    if (target && new Set([...(target.unitIds || []), ...cmd.unitIds]).size > (cached?.groupLimit || GROUP_LIMIT)) return '一个集团军最多 16 个单位';
    return null;
  },
  execute(game, cmd) {
    for (const group of game.armyGroups) if (group.country === cmd.country) group.unitIds = (group.unitIds || []).filter(id => !cmd.unitIds.includes(id));
    if (cmd.toGroupId != null) game.armyGroups.find(g => g.id === cmd.toGroupId).unitIds.push(...cmd.unitIds);
    changed(game, cmd);
  },
});
register('appointCommander', {
  validate(game, cmd) { return validateBase(game, cmd) || (!findGroup(game, cmd) ? '集团军不存在' : validateCommander(game, cmd, cmd.groupId)); },
  execute(game, cmd) { findGroup(game, cmd).commanderId = cmd.commanderId; changed(game, cmd); },
});
register('renameArmyGroup', {
  validate(game, cmd) { return validateBase(game, cmd) || (!findGroup(game, cmd) ? '集团军不存在' : !String(cmd.name || '').trim() ? '集团军名称不能为空' : null); },
  execute(game, cmd) { findGroup(game, cmd).name = String(cmd.name).trim().slice(0, 24); changed(game, cmd); },
});
register('setArmyGroup', {
  validate(game, cmd) {
    if (validateBase(game, cmd)) return validateBase(game, cmd);
    const old = cmd.groupId && findGroup(game, cmd);
    if (cmd.groupId && !old) return '集团军不存在';
    if (!old && groupsOf(game, cmd.country).length >= (cached?.maxGroups || 4)) return `每国最多 ${cached?.maxGroups || 4} 个集团军`;
    if (!Array.isArray(cmd.unitIds) || !cmd.unitIds.length || cmd.unitIds.length > (cached?.groupLimit || GROUP_LIMIT) || new Set(cmd.unitIds).size !== cmd.unitIds.length) return '集团军必须包含 1 至 16 个不同单位';
    const live = new Set(armyRows(game, cmd.country).map(r => r.army.id));
    if (cmd.unitIds.some(id => !live.has(id))) return '只能编入本国存活单位';
    if (cmd.unitIds.some(id => groupsOf(game, cmd.country).some(g => g.id !== cmd.groupId && g.unitIds.includes(id)))) return '单位已属于其它集团军';
    return validateCommander(game, cmd, cmd.groupId);
  },
  execute(game, cmd) {
    const old = cmd.groupId && findGroup(game, cmd), n = old ? null : game.nextArmyGroupId++;
    const group = { id: old?.id || 'group_' + n, country: cmd.country, name: String(cmd.name || old?.name || '第 ' + (groupsOf(game, cmd.country).length + 1) + ' 集团军').slice(0, 24),
      commanderId: cmd.commanderId, unitIds: [...cmd.unitIds] };
    if (old) Object.assign(old, group); else game.armyGroups.push(group);
    changed(game, cmd);
  },
});
register('dissolveArmyGroup', {
  validate(game, cmd) { return validateBase(game, cmd) || (!findGroup(game, cmd) ? '集团军不存在' : null); },
  execute(game, cmd) {
    game.armyGroups = game.armyGroups.filter(g => g.id !== cmd.groupId);
    for (const t of game.theatres || []) t.armyIds = t.armyIds.filter(id => id !== cmd.groupId);
    game.orders = (game.orders || []).filter(o => !(o.level === 'army' && o.targetId === cmd.groupId));
    changed(game, cmd);
  },
});

const theaterOf = (game, cmd) => (game.theatres || []).find(t => t.id === cmd.theaterId && t.country === cmd.country);
const theaterChanged = (game, cmd) => game.emit('theaterOrderChanged', { country: cmd.country, theaterId: cmd.theaterId });
const verbs = new Set('attack breakthrough envelop counterattack defend delay concentrate screen withdraw support allout'.split(' '));
export function validateOrder(order, game = null) {
  if (!order || !verbs.has(order.verb)) return '命令类型无效';
  const areas = value => Number.isInteger(value) && value >= 0 || Array.isArray(value) && value.length > 0 && value.every(v => Number.isInteger(v) && v >= 0);
  if (order.verb !== 'allout' && (!areas(order.from) || !areas(order.to))) return '起点和目标必须是地块编号';
  const paths = order.axes || (order.path ? [order.path] : []);
  if (order.verb === 'envelop' && (!Array.isArray(order.axes) || order.axes.length !== 2)) return '合围需要两条轴线';
  if (order.axes && order.verb !== 'envelop') return '\u53ea\u6709\u5408\u56f4\u53ef\u4f7f\u7528\u4e24\u6761\u8f74\u7ebf';
  if (order.line && !['defend','screen','delay'].includes(order.verb)) return '\u8be5\u547d\u4ee4\u4e0d\u80fd\u753b\u9632\u7ebf';
  if (order.axes && (!Array.isArray(order.axes) || order.axes.length !== 2)) return '轴线格式无效';
  if (order.path && !Array.isArray(order.path)) return '路径格式无效';
  if (order.line && !Array.isArray(order.line)) return '防线格式无效';
  if (order.draw && (!Array.isArray(order.draw) || order.draw.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => typeof n !== 'number' || !Number.isFinite(n))))) return '绘制坐标无效';
  if (paths.some(path => !Array.isArray(path) || !path.length || path.length > 40 || path.some(id => !Number.isInteger(id)))) return '路径长度或地块编号无效';
  const oFrom = Array.isArray(order.from) ? order.from[0] : order.from;
  const oTo = Array.isArray(order.to) ? order.to[order.to.length - 1] : order.to;
  if (order.path && (oFrom !== order.path[0] || oTo !== order.path.at(-1))) return '路径起点和终点不匹配';
  if (order.line && (order.line.length < 1 || order.line.length > 60 || order.line.some(id => !Number.isInteger(id)))) return '防线长度或地块编号无效';
  if (['defend','screen'].includes(order.verb) && order.line && (JSON.stringify(order.to) !== JSON.stringify(order.line) || order.mustHold && JSON.stringify(order.mustHold) !== JSON.stringify(order.line))) return '\u9632\u7ebf\u76ee\u6807\u4e0d\u5339\u914d';
  if (game) {
    const valid = id => game.stage.enabled?.has(id) && !game.stage.st(id)?.sea;
    if ([...paths.flat(), ...(order.line || [])].some(id => !valid(id))) return '命令包含不可通行地块';
    if (paths.some(path => path.some((id, i) => i && !game.stage.adjacent(path[i - 1], id)))) return '路径地块必须相邻';
  }
  if (typeof order.risk !== 'number' || !Number.isFinite(order.risk) || order.risk < 0 || order.risk > 1) return '风险必须在 0 到 1 之间';
  if (!Number.isInteger(order.priority) || order.priority < 1 || order.priority > 9) return '优先级必须在 1 到 9 之间';
  if (order.expires != null && (!Number.isInteger(order.expires) || order.expires < 1)) return '有效回合数必须是正整数';
  if (order.guard != null && order.guard !== 'hold' && order.guard !== 'ring') return '警戒模式必须为 "hold" 或 "ring"';
  if (order.detour != null && typeof order.detour !== 'boolean') return '绕行选项必须是布尔值';
  return null;
}
register('createTheater', {
  validate(game, cmd) { return validateBase(game, cmd) || ((game.theatres || []).filter(t => t.country === cmd.country).length >= (cached?.maxTheatres || 4) ? '战区数量已达上限' : null)
    || (cmd.name != null && !String(cmd.name).trim() ? '战区名称不能为空' : null); },
  execute(game, cmd) {
    const n = game.nextTheaterId++;
    const countryName = playerCountryName(cmd.country);
    const available = countryCommanders(cmd.country).find(spec => spec.marshal && yearOK(game, spec)
      && (!isHuman(game, cmd.country) || ownsCommander(game, spec))
      && !groupsOf(game, cmd.country).some(g => g.commanderId === spec.id)
      && !game.theatres.some(t => t.marshalId === spec.id));
    game.theatres.push({ id: 'theater_' + n, country: cmd.country, name: String(cmd.name || `${countryName}第${n}战区`).slice(0, 24), marshalId: available?.id || null, armyIds: [], order: null, ai: false });
    theaterChanged(game, cmd);
  },
});
register('renameTheater', {
  validate(game, cmd) { return validateBase(game, cmd) || (!theaterOf(game, cmd) ? '战区不存在' : !String(cmd.name || '').trim() ? '战区名称不能为空' : null); },
  execute(game, cmd) { theaterOf(game, cmd).name = String(cmd.name).trim().slice(0, 24); theaterChanged(game, cmd); },
});
register('dissolveTheater', {
  validate(game, cmd) { return validateBase(game, cmd) || (!theaterOf(game, cmd) ? '战区不存在' : null); },
  execute(game, cmd) { game.theatres = game.theatres.filter(t => t.id !== cmd.theaterId); game.orders = (game.orders || []).filter(o => !(o.level === 'theater' && o.targetId === cmd.theaterId)); theaterChanged(game, cmd); },
});
register('appointMarshal', {
  validate(game, cmd) {
    const t = theaterOf(game, cmd);
    if (validateBase(game, cmd)) return validateBase(game, cmd);
    if (!t) return '战区不存在';
    if (cmd.marshalId == null) return null;
    const spec = commanderById(cmd.country, cmd.marshalId);
    if (!spec?.marshal) return '该指挥官不能任战区元帅';
    if (isHuman(game, cmd.country) && !ownsCommander(game, spec)) return '指挥官尚未购买';
    if (!yearOK(game, spec)) return '本剧本年代不可用';
    if ((game.theatres || []).some(other => other.id !== t.id && other.marshalId === spec.id) || groupsOf(game, cmd.country).some(g => g.commanderId === spec.id)) return '该指挥官已担任其他职务';
    return null;
  },
  execute(game, cmd) { theaterOf(game, cmd).marshalId = cmd.marshalId; theaterChanged(game, cmd); },
});
register('assignArmyToTheater', {
  validate(game, cmd) {
    if (validateBase(game, cmd)) return validateBase(game, cmd);
    if (!findGroup(game, cmd)) return '集团军不存在';
    if (cmd.theaterId == null) return null;
    const t = theaterOf(game, cmd);
    if (!t) return '战区不存在';
    return null;
  },
  execute(game, cmd) {
    for (const t of game.theatres) t.armyIds = t.armyIds.filter(id => id !== cmd.groupId);
    if (cmd.theaterId != null) theaterOf(game, cmd).armyIds.push(cmd.groupId);
    theaterChanged(game, cmd);
  },
});
register('setTheaterOrder', {
  validate(game, cmd) { return validateBase(game, cmd) || (!theaterOf(game, cmd) ? '战区不存在' : cmd.order == null ? null : validateOrder(cmd.order, game)); },
  execute(game, cmd) {
    const t = theaterOf(game, cmd);
    t.order = cmd.order ? { ...cmd.order } : null;
    game.setStandingOrder('theater', t.id, cmd.order);
    theaterChanged(game, cmd);
  },
});
register('setArmyOrder', {
  validate(game, cmd) { return validateBase(game, cmd) || (!findGroup(game, cmd) ? '集团军不存在' : cmd.order == null ? null : validateOrder(cmd.order, game)); },
  execute(game, cmd) { game.setStandingOrder('army', cmd.groupId, cmd.order); theaterChanged(game, cmd); },
});
register('setCountryOrder', {
  validate(game, cmd) { return validateBase(game, cmd) || (cmd.order?.verb !== 'allout' ? '总参仅支持全线总攻' : validateOrder(cmd.order, game)); },
  execute(game, cmd) { game.setStandingOrder('country', cmd.country, cmd.order); },
});
register('executeOrder', {
  validate(game, cmd) {
    if (validateBase(game, cmd)) return validateBase(game, cmd);
    if (!['army', 'theater', 'country'].includes(cmd.level)) return '命令层级无效';
    const target = cmd.level === 'country' ? cmd.targetId === cmd.country : cmd.level === 'army' ? game.armyGroups.find(g => g.id === cmd.targetId && g.country === cmd.country)
      : game.theatres.find(t => t.id === cmd.targetId && t.country === cmd.country);
    if (!target) return '目标集团军或战区不存在';
    if (!game.orders.some(o => o.level === cmd.level && o.targetId === cmd.targetId && ['pending', 'progressing', 'stalled'].includes(o.status))) return '无当前命令';
    return null;
  },
  execute(game, cmd) { game.executeOrders({ level: cmd.level, id: cmd.targetId, mode: 'now' }); },
});
register('setOrderPaused', {
  validate(game, cmd) {
    if (validateBase(game, cmd)) return validateBase(game, cmd);
    if (!['army', 'theater', 'country'].includes(cmd.level) || typeof cmd.paused !== 'boolean') return '命令参数无效';
    const target = cmd.level === 'country' ? cmd.targetId === cmd.country : cmd.level === 'army' ? game.armyGroups.find(g => g.id === cmd.targetId && g.country === cmd.country)
      : game.theatres.find(t => t.id === cmd.targetId && t.country === cmd.country);
    if (!target || !game.orders.some(o => o.level === cmd.level && o.targetId === cmd.targetId && ['pending', 'progressing', 'stalled'].includes(o.status))) return '无当前命令';
    return null;
  },
  execute(game, cmd) {
    const entry = game.orders.findLast(o => o.level === cmd.level && o.targetId === cmd.targetId && ['pending', 'progressing', 'stalled'].includes(o.status));
    entry.paused = cmd.paused;
    entry.status = cmd.paused ? 'stalled' : 'progressing';
    if (!cmd.paused) game.executeOrders({ level: cmd.level, id: cmd.targetId, mode: 'now' });
    theaterChanged(game, cmd);
  },
});
register('setTheaterAI', {
  validate(game, cmd) { return validateBase(game, cmd) || (!theaterOf(game, cmd) ? '战区不存在' : typeof cmd.on !== 'boolean' ? '托管状态无效' : null); },
  execute(game, cmd) { theaterOf(game, cmd).ai = cmd.on; theaterChanged(game, cmd); },
});

register('setOrderAuto', {
  validate(game, cmd) {
    if (validateBase(game, cmd)) return validateBase(game, cmd);
    if (!['army','theater','country'].includes(cmd.level) || typeof cmd.on !== 'boolean') return 'invalid-order-auto';
    const target = cmd.level === 'country' ? cmd.targetId === cmd.country : cmd.level === 'army' ? game.armyGroups.find(g => g.id === cmd.targetId && g.country === cmd.country)
      : (game.theatres || []).find(t => t.id === cmd.targetId && t.country === cmd.country);
    if (!target || !(game.orders || []).some(o => o.level === cmd.level && o.targetId === cmd.targetId && ['pending','progressing','stalled'].includes(o.status))) return 'no-standing-order';
    return null;
  },
  execute(game, cmd) {
    game.orders.findLast(o => o.level === cmd.level && o.targetId === cmd.targetId && ['pending','progressing','stalled'].includes(o.status)).auto = cmd.on;
    theaterChanged(game, cmd);
  },
});
