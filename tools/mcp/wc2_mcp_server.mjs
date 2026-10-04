#!/usr/bin/env node
import './runtime.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { root, dataRoot } from './runtime.mjs';
import { Game } from '../../public/src/game/game.js';
import { ScriptedAi } from '../../public/src/game/controllers.js';
import { HqAi } from '../../public/src/game/ai/hq/index.js';
import { getStrategicView, getTheaterView, getArmyGroupView, getUnitView, getCountryUnitViews, getTileView, getOrdersView, getCommandersView, getDiplomacyView, getEventsView, previewAttack, previewOrderPath, previewOrderRisk, performCommand, performCommandBatch, autoOrganizeCountry, listCommandTypes, commandViewToText, capturePlayerState, summarizeOpponentTurn, validateOperationReason, recordOperationReason } from '../../public/src/game/api/command.js';
import { apiIdentity, OPERATION_REASON_SCHEMA } from '../../public/src/game/api/catalog.js';
import { saveGame, listSaves, loadSave, defaultSlot } from './save_store.mjs';
import { bridgeStateHash } from '../../public/src/game/bridge_controller.js';
import { getMapView } from '../../public/src/game/api/map_view.js';
import { renderMapPng } from './map_image.mjs';

let game = null;
let config = null;
let bridge = null;
let bridgeGame = null;
let mapDeliveredGameId = null;
const bridgeSessionId = 'mcp-' + Math.random().toString(36).slice(2) + '-' + Date.now();
const bridgeUrl = (process.env.WC2_BRIDGE_URL || 'http://127.0.0.1:8651').replace(/\/$/, '');
// 连接桥：网络层错误(桥没起来、瞬断)自动重试 3 次；桥返回的业务错误(4xx)不重试，直接带上桥给的中文原因
async function bridgeFetch(route, data) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${bridgeUrl}/bridge/${route}`, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      let value = null; try { value = await res.json(); } catch { value = {}; }
      if (!res.ok) { const err = new Error(value.error || `桥 HTTP ${res.status}`); err.bridgeStatus = res.status; throw err; }
      return value;
    } catch (error) {
      if (error.bridgeStatus) throw error;
      last = error; await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw Object.assign(new Error(`连不上对战桥 ${bridgeUrl}（${last?.cause?.code || last?.message || '网络错误'}）。请确认电脑端游戏服务在运行(它会自动拉起桥)，或手动运行 node tools/mcp/bridge_server.mjs`), { bridgeDown: true });
}
const COUNTRY_ALIASES={us:'am',usa:'am',uk:'gb',britain:'gb',su:'ru',ussr:'ru'};
const json = value => JSON.stringify(value);
const identified = value => typeof value === 'string' ? value : Array.isArray(value) ? { api:apiIdentity(), data:value } : { api:apiIdentity(), ...value };
// api 身份只在开局/恢复/绑定时带一次(withApi)，其余调用省略以减少返回体积
const content = (value, withApi = false) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : json(withApi ? identified(value) : value) }] });
const tool = (name, description, properties = {}, required = []) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } });
const REASON = OPERATION_REASON_SCHEMA;

const TOOLS = [
  tool('wc2_get_map_view', '取得全局地图PNG与地块坐标、真实邻接关系、归属和可见部队。新局先调用建立空间布局，战线改变后刷新；迷雾外兵力不返回，敌方只显示前排。', { image: { type: 'boolean', default: true } }),
  tool('wc2_new_game', '仅在没有匹配存档时开新局；固定关卡、玩家、AI、种子和迷雾，避免覆盖未完成进度。', {
    stage: { type: 'string' }, player: { type: 'string',description:'国家 ID 或别名：us→am、uk→gb、su→ru；关卡专用 ID 以 wc2_list_stages 为准' }, enemy_ai: { type: 'string', enum: ['scripted', 'hq'], default: 'scripted',description:'默认 scripted；hq 仅在明确需要指挥官 AI 时使用' }, seed: { type: 'integer' }, fog_of_war: { type: 'boolean', default: true }, owned_commanders:{type:'array',items:{type:'string'}}, commander_level:{type:'integer'},slot:{type:'string',description:'自动存档槽；默认 stage_country_seed'},reason:REASON
  }, ['stage','reason']),
  tool('wc2_get_strategic_view', '取得总参层摘要：经济、战线、高危地块、战区、集团军、外交势力。遵守战争迷雾。', { detail: { type: 'string', enum: ['summary', 'detail'], default: 'summary' }, format: { type: 'string', enum: ['json', 'text'], default: 'json' } }),
  tool('wc2_get_turn_brief', '一次取回回合初决策包：资源、外交事件、卡片合法落点、迷雾约束地图、全部本国单位及合法移动/攻击预测。桥接 wait_turn 已自动返回同一包，无需再次调用。操作后只在需要刷新时调用；攻击预测不是伤害保证，前排或建筑变化后旧动作失效。', {}),
  tool('wc2_get_theater_view', '取得军区/战区层视图。', { theater_id: { type: 'string' } }, ['theater_id']),
  tool('wc2_get_army_group_view', '取得集团军层视图及单位、命令状态和参数约束。', { group_id: { type: 'string' } }, ['group_id']),
  tool('wc2_get_unit_view', '取得具体单位、合法移动/攻击目标及战斗预测。', { army_id: { type: 'integer' } }, ['army_id']),
  tool('wc2_preview_attack', '按真实战斗模型预估一次攻击，包含伤害、击杀概率、侧背击和合围。', { from: { type: 'integer' }, to: { type: 'integer' }, army_id: { type: 'integer' } }, ['from', 'to', 'army_id']),
  tool('wc2_preview_order_path', '预览指令路径、防线或双轴。detour:true 不改主路径，并返回执行器允许绕行的相邻候选地块。', { from: { type: 'integer' }, to: { type: 'integer' }, draw: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } }, path:{type:'array',items:{type:'integer'}}, line:{type:'array',items:{type:'integer'}}, axes:{type:'array',items:{type:'array',items:{type:'integer'}}}, detour:{type:'boolean'} }),
  tool('wc2_preview_order_risk', '下达进攻指令前预估与 UI 一致的低于 10% 高风险警告。', { level:{type:'string',enum:['army','theater']}, target_ids:{type:'array',items:{type:'string'}}, order:{type:'object'} }, ['level','target_ids','order']),
  tool('wc2_get_intel', '按需查询地块、外交、指令、事件或将领，避免展开整个征服地图。事件可用 offset/limit 分页。', { kind:{type:'string',enum:['tile','diplomacy','orders','events','commanders']}, area_id:{type:'integer'}, limit:{type:'integer'},offset:{type:'integer'}, active_only:{type:'boolean'} }, ['kind']),
  tool('wc2_list_actions', '列出可用的微操、三级指挥、外交动作及手动优先语义。可买卡包含 deployable、legalTargetCount、reason 与 ruleHint。'),
  tool('wc2_do', '执行一次微操、编组、指令、生产或外交命令；先读对应层级视图，危险攻击先预览。全线总攻 allout 属孤注一掷的命令，仅在优势或绝境时使用；可通过 setCountryOrder/setTheaterOrder/setArmyOrder 下达，返回重大伤亡警告。command 按 wc2_list_actions 填，reason 写真实决策依据；无目标购卡需 allowNoTarget:true。', { command: { type: 'object' }, reason:REASON }, ['command','reason']),
  tool('wc2_do_batch', '按顺序执行一组已审阅命令，默认首错停止。可给整批一个 reason(推荐，一条即可)，或给每个 command 单独写 reason；两者都没有会拒绝。attack 命令可带 when 条件{minKill:击杀概率下限0-1,maxAttackerLoss:己方预期损失上限,minDamage:预期伤害下限}，执行前按当前状态实时预览，不满足则跳过(skipped，不算错误、不触发首错停止)。', { commands:{type:'array',items:{type:'object'},minItems:1}, reason:REASON, stop_on_error:{type:'boolean',default:true} }, ['commands']),
  tool('wc2_auto_organize', '有未编组单位时调用参谋部算法建立集团军与军区；第二次调用前先检查仍未编组单位。reason 说明本轮编组意图。',{reason:REASON},['reason']),
  tool('wc2_end_turn', '确认目标、资源、脆弱单位和常驻指令后结束回合并自动保存；reason 说明为何现在收束本回合。detail:true 仅用于诊断。', {detail:{type:'boolean',default:false},reason:REASON},['reason']),
  tool('wc2_list_saves','列出 scratch/ai_lab/mcp/saves 下可恢复的自动存档。'),
  tool('wc2_resume_game','恢复指定槽或 latest；恢复 RNG、命令计划、冷却、外交与战争迷雾记忆。',{slot:{type:'string',default:'latest'}}),
  tool('wc2_list_stages', '列出当前数据目录中的可开局关卡，可按 battle_ 前缀筛选。', { prefix: { type: 'string', default: '' } }),
  tool('wc2_save_record', '把当前对局摘要和调用者提供的回合笔记保存到 scratch/ai_lab/mcp。', { file: { type: 'string' }, markdown: { type: 'string' } }, ['file', 'markdown']),
  tool('wc2_bridge_list_games', '列出当前在线的浏览器对局及其席位列表（国家、中文名、状态、是否在线、心跳）。'),
  tool('wc2_bridge_attach', '推荐用 user_id(形如 WC2U-XXXXXX，游戏里“LLM 对手接管”页给出)绑定：只绑一次，之后玩家每开新局，wait_turn 自动对到该用户最新的对战桥对局，无需重进会话。也可用 game_id 绑定单个对局。单国家对局可省略 country，多国家对局须指定；支持 force 强制抢占已有在线会话。', { user_id: { type: 'string', description: '用户 ID(推荐)' }, game_id: { type: 'string' }, wait_sec: { type: 'number', description: '对局还没在桥上登记时最长等待秒数，默认 300，最大 1800' }, country: { type: 'string', description: '被接管的国家代码（如 pl, de 等）；若该局仅有一个被接管国家可省略' }, force: { type: 'boolean', description: '是否强制抢占已有在线会话' } }, []),
  tool('wc2_bridge_say', '发送弹幕，默认仅用户可见。visibility=broadcast 广播给其他 Agent；direct 定向发送给 recipients 指定的国家席位。用户始终能看到所有消息。每条最多1200字。', { text: { type: 'string', description: '要显示的内容' }, label: { type: 'string', description: '标签，默认感言' }, visibility: { type: 'string', enum: ['user', 'broadcast', 'direct'], default: 'user', description: '可见范围' }, recipients: { type: 'array', items: { type: 'string' }, description: 'direct 时指定其他 Agent 国家，如 de2' } }, ['text']),
  tool('wc2_bridge_read_messages', '读取其他 Agent 向本席位广播或定向发送的弹幕；用户私有弹幕不返回。等待回合时也会自动附带新消息。', { since: { type: 'number', minimum: 0, description: '可选历史游标；省略时从上次读取继续' } }),
  tool('wc2_bridge_narrate', '对局结束后写这一局的"架空历史战报"：玩家在看海模式回放时，每个回合会弹出电影字幕并用系统语音配音。风格：译制片式的卫国战争纪录片旁白(庄重、翻译腔、带长定语，如"就这样，……""在……的……中，……")。items 每项 {round,title,text}(text 建议 60~140 字，只写这回合发生的事，可以点出双方指挥官的得失)；intro 开场白，outro 收尾。不要提真实历史人物。', { title: { type: 'string', description: '战报标题，如"维也纳之战"' }, intro: { type: 'object', description: '{title,text}' }, items: { type: 'array', items: { type: 'object' } }, outro: { type: 'object', description: '{title,text}' }, voice: { type: 'object', description: '{rate:0.92,pitch:0.8,gender:"male"|"female"}，默认低沉男声' } }, ['items']),
  tool('wc2_bridge_wait_turn', '等待已绑定席位的对手国家回合，并在隔离副本中恢复快照。game_id 与 country 缺省时默认使用已绑定席位。默认最长等待 10 分钟(timeout_sec 最大 600)，到时返回 waiting，请继续调用。', { game_id: { type: 'string' }, country: { type: 'string' }, timeout_sec: { type: 'number' } }),
  tool('wc2_bridge_submit_turn', '提交当前副本里该对手国家成功执行的命令。turn_id 缺省时使用当前待提交回合；严格校验仅允许提交属于本席位国家的命令。', { turn_id: { type: 'string' }, reason: REASON }, ['reason'])
];

function runConditionalBatch(g,country,rows,stopOnError){
  const results=[];
  for(const {command,when} of rows){
    if(when&&command?.type==='attack'){
      const p=previewAttack(g,command.from,command.to,command.armyId,country);
      const why=!p.ok?p.reason:when.minKill!=null&&p.killProbability<when.minKill?`killProbability ${p.killProbability}<${when.minKill}`:when.maxAttackerLoss!=null&&p.expectedAttackerLoss>when.maxAttackerLoss?`attackerLoss ${p.expectedAttackerLoss}>${when.maxAttackerLoss}`:when.minDamage!=null&&p.expectedDefenderLoss<when.minDamage?`damage ${p.expectedDefenderLoss}<${when.minDamage}`:null;
      if(why){results.push({command,skipped:true,why,result:{ok:true,skipped:true}});continue;}
    }
    const result=performCommand(g,command);results.push({command,result});
    if(!result.ok&&stopOnError)break;
  }
  const done=results.filter(r=>!r.skipped);
  return {ok:done.every(r=>r.result.ok),applied:done.filter(r=>r.result.ok).length,skipped:results.length-done.length,results};
}
function turnBrief(g,country){
  const cat=listCommandTypes(g,country);
  const map=getMapView(g,country);
  const units=getCountryUnitViews(g,country).map(u=>({
    armyId:u.id,type:u.type,areaId:u.areaId,hp:u.hp,maxHp:u.maxHp,movement:u.movement,
    level:u.level,cards:u.cards,frontOfStack:u.frontOfStack,
    canOccupy:u.stats.canOccupy,retainMovementOnKill:u.stats.retainMovementOnKill,
    moves:u.legalActions.moves.map(m=>({to:m.areaId,cost:m.cost,path:m.path})),
    attacks:u.legalActions.attacks.map(a=>({to:a.areaId,defenderId:a.defenderId,
      expectedDefenderLoss:a.expectedDefenderLoss,expectedAttackerLoss:a.expectedAttackerLoss,
      killProbability:a.killProbability,attackerDeathProbability:a.attackerDeathProbability,canCounter:a.canCounter})),
    frontArmy:u.legalActions.frontArmy
  }));
  const tiles=map.nodes.map(n=>({areaId:n.id,name:n.name,x:n.x,y:n.y,neighbours:n.neighbours,
    visible:n.visible,owner:n.owner,ownershipStatus:n.ownershipStatus,sea:n.sea,
    construction:n.construction,constructionLevel:n.constructionLevel,installation:n.installation,
    stackCount:n.stackCount,
    ...(n.visible&&n.relation!=='self' ? {visibleUnits:n.units} : {})}));
  return {round:g.round,phase:g.phase,canAct:g.activeCountry===country,view:getStrategicView(g,country,{limit:10}),
    orders:getOrdersView(g,country,{activeOnly:true}),warnings:getOrdersView(g,country).flatMap(o=>o.warnings||[]).slice(0,8),
    actionTypes:(cat.commands||cat.actions||cat.types||[]).map?.(x=>x.type||x.name||x)||null,manualPriority:cat.manualPriority,
    units,tiles,fogOfWar:map.fogOfWar,
    briefingNote:'仅本国视角的当前快照；moves/attacks/card legalTargets 在操作后可能失效。攻击预测是期望值，不保证实伤或击杀；前排变化后重新查询关键目标。'};
}
// 公平性：命令结果里的事件不得泄露对手堆叠里被压在下面的单位(玩家只看得到最顶层)。
// 执行前记下所有非己方/非盟友地块的最顶层单位，执行后把这些地块上“非原最顶层单位”的伤亡/治疗事件去掉。
function hostileFronts(g, country) {
  const m = new Map();
  for (const a of g.stage.areas) if (a.armies?.length && a.country && !g.stage.areAllied?.(a.country, country)) m.set(a.id, a.armies[0].id);
  return m;
}
function redactEvents(node, fronts) {
  if (!node || typeof node !== 'object') return 0;
  let hidden = 0;
  if (Array.isArray(node.events)) {
    const keep = node.events.filter(ev => !(['unitDamaged', 'unitDestroyed', 'unitHealed', 'unitPromoted'].includes(ev?.type) && fronts.has(ev.area) && ev.armyId !== fronts.get(ev.area)));
    hidden += node.events.length - keep.length; node.events = keep;
  }
  for (const key of Object.keys(node)) if (node[key] && typeof node[key] === 'object') hidden += redactEvents(node[key], fronts);
  return hidden;
}
function requireGame() { if (bridgeGame) return bridgeGame; if (!game) throw new Error('无对局，可用 wc2_list_saves / wc2_resume_game 恢复，或用 wc2_new_game 开局'); return game; }
function countState(g, country) {
  const areas = g.stage.areas.filter(a => g.stage.enabled.has(a.id) && a.country === country);
  return { territory: areas.length, units: areas.reduce((n, a) => n + (a.armies?.length || 0), 0), hp: areas.reduce((n, a) => n + (a.armies || []).reduce((s, u) => s + u.hp, 0), 0) };
}
function configureControllers(g, enemyAi) {
  for (const info of g.stage.data.countries) if (info.id !== g.player) g.controllers.set(info.id, enemyAi === 'hq' ? new HqAi() : new ScriptedAi());
}
async function persist(){if(bridgeGame)return null;if(!game||!config)return null;return saveGame(game,config,config.slot);}
function reasonError(reason){const checked=validateOperationReason(reason);return checked.ok?null:content({ok:false,...checked});}
function reasonResult(g,country,operation,reason){return recordOperationReason(g,country,operation,reason);}
async function resume(slot='latest'){
  const saved=await loadSave(slot);config={stage:saved.stage,player:saved.player,enemyAi:saved.enemyAi||'scripted',seed:saved.seed??1,fogOfWar:!!saved.fogOfWar,ownedCommanders:saved.ownedCommanders||[],commanderLevel:saved.commanderLevel,slot:saved.slot};
  game=await Game.create(saved.stage,saved.snapshot,{player:saved.player,seed:saved.seed,fogOfWar:saved.fogOfWar,ownedCommanders:saved.ownedCommanders||[],commanderLevel:saved.commanderLevel});configureControllers(game,config.enemyAi);
  return {ok:true,resumed:true,slot:saved.slot,savedAt:saved.savedAt,config,view:getStrategicView(game,game.player,{limit:8})};
}
const autoResumePromise=process.env.WC2_AUTORESUME==='1'?resume('latest').catch(error=>console.error(`[MCP autoresume] ${error.message}`)):Promise.resolve();

async function call(name, args = {}) {
  if (name === 'wc2_bridge_list_games') {
    const data = await bridgeFetch('games');
    return content(data);
  }
  if (name === 'wc2_bridge_attach') {
    // 浏览器登记对局可能有延迟(刚开局/刚刷新页面)：对局还没登记或刚离线时持续重试，默认最长等 5 分钟(wait_sec，最大 30 分钟)
    const attachBody = { ...(args.user_id && !args.game_id ? { userId: args.user_id } : { gameId: args.game_id }), country: args.country, sessionId: bridgeSessionId, force: !!args.force };
    const attachDeadline = Date.now() + Math.min(1800, Math.max(0, Number(args.wait_sec ?? 300))) * 1000;
    let res;
    for (;;) {
      try { res = await bridgeFetch('attach', attachBody); break; }
      catch (error) {
        const retryable = /找不到该对局|已离线|未登记/.test(error.message || '') || error.bridgeDown;
        if (!retryable || Date.now() >= attachDeadline) throw error;
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    bridge = { gameId: res.gameId, userId: attachBody.userId || null, country: res.country, turnId: null, logAt: 0, sessionId: bridgeSessionId };
    bridgeGame = null;
    if (attachBody.userId && !res.gameId) return content({ ok: true, userId: attachBody.userId, country: res.country, gameId: null, hint: res.hint }, true);
    return content({
      ok: true,
      gameId: res.gameId,
      country: res.country,
      sessionId: bridgeSessionId,
      seat: res.seat,
      stage: res.game?.stage,
      playerCountry: res.game?.playerCountry,
      round: res.game?.round,
      pending: res.game?.pending,
      hint: res.game?.pending ? `已有回合待处理，请调用 wc2_bridge_wait_turn` : `已成功绑定国家【${res.country}】，等待浏览器结束玩家回合`
    }, true);
  }
  if (name === 'wc2_bridge_narrate') {
    if (!bridge?.gameId) return content({ ok: false, reason: '请先用 wc2_bridge_attach 绑定对局' });
    const res = await bridgeFetch('narration', { gameId: bridge.gameId, title: args.title, intro: args.intro, items: args.items, outro: args.outro, voice: args.voice });
    return content({ ok: true, items: res.items, hint: '战报已保存。玩家在结算界面点“看海模式”即可观看，字幕和配音会随回合播放。' });
  }
  if (name === 'wc2_bridge_say') {
    if (!bridge?.gameId) return content({ ok: false, reason: '请先用 wc2_bridge_attach 绑定对局' });
    const res = await bridgeFetch('say', { gameId: bridge.gameId, country: bridge.country, sessionId: bridgeSessionId, label: args.label || '感言', text: args.text, visibility: args.visibility || 'user', recipients: args.recipients });
    return content(res);
  }
  if (name === 'wc2_bridge_read_messages') {
    if (!bridge?.gameId) return content({ ok: false, reason: '请先绑定并等待最新对局' });
    const since = Math.max(0, Number(args.since ?? bridge.messageCursor ?? 0));
    const params = new URLSearchParams({ gameId: bridge.gameId, country: bridge.country, sessionId: bridgeSessionId, since: String(since) });
    const res = await bridgeFetch(`says?${params}`);
    bridge.messageCursor = res.cursor ?? since;
    return content({ ok: true, gameId: bridge.gameId, messages: res.says || [], cursor: bridge.messageCursor });
  }
  if (name === 'wc2_bridge_wait_turn') {
    const userMode = !!bridge?.userId && !args.game_id;
    let gameId = args.game_id || bridge?.gameId;
    const country = args.country || bridge?.country;
    if (!gameId && !userMode) return content({ ok: false, reason: '请先用 wc2_bridge_attach 绑定用户 ID(或对局 ID)与国家席位' });
    if (!userMode && bridge && bridge.gameId !== gameId) return content({ ok: false, reason: '对局 ID 与当前绑定不符，请先重新 attach' });
    if (bridge?.turnId) return content({ ok: false, reason: '上一回合尚未提交，请先调用 wc2_bridge_submit_turn' });
    // 最长等 10 分钟：分段向桥长轮询(每段≤240秒，避开 fetch 的 5 分钟头部超时)，期间桥会持续刷新席位心跳
    const total = Math.min(600, Math.max(1, Number(args.timeout_sec ?? 20)));
    const deadline = Date.now() + total * 1000;
    let next = { waiting: true };
    while (next.waiting && Date.now() < deadline) {
      const seg = Math.min(240, Math.max(1, Math.ceil((deadline - Date.now()) / 1000)));
      const params = new URLSearchParams({ ...(userMode ? { userId: bridge.userId } : { gameId }), ...(country ? { country } : {}), sessionId: bridgeSessionId, timeout: String(seg) });
      next = await bridgeFetch(`next?${params.toString()}`);
    }
    const latestGameId = next.turn?.gameId || next.gameId;
    if (latestGameId && userMode) { gameId = latestGameId; if (bridge.gameId !== gameId) bridge.messageCursor = 0; bridge.gameId = gameId; }
    let messages = [];
    let messagesError = null;
    if (gameId && bridge?.country) {
      const params = new URLSearchParams({ gameId, country: bridge.country, sessionId: bridgeSessionId, since: String(bridge.messageCursor || 0) });
      try { const res = await bridgeFetch(`says?${params}`); messages = res.says || []; bridge.messageCursor = res.cursor ?? bridge.messageCursor; } catch (e) { messagesError = String(e.message); console.error('[WC2 bridge messages]', messagesError); }
    }
    if (next.gameOver) return content({ ok: true, gameOver: true, gameId, result: next.result, round: next.round, messages, messagesError, hint: '对局已结束，不会再有新回合。请调用 wc2_bridge_say 在玩家屏幕的弹幕里发表这局的心理历程和对局感言：先分 3~5 条讲各阶段的心理变化(开局判断、转折、崩盘/胜利时的想法)，最后再发一条**较长的总结感言**(300~600 字，第一人称，要有具体回合、具体决策、得失复盘和对下局的打算)。发完就可以停止监听了。' });
    if (next.waiting) return content({ waiting: true, ...(gameId ? { gameId } : {}), country: country || bridge?.country, messages, messagesError });
    const turn = next.turn;
    if (userMode) gameId = turn.gameId;
    if (turn.gameId !== gameId || (country && turn.country !== country) || (bridge && turn.country !== bridge.country)) {
      return content({ ok: false, reason: '桥返回的对局或国家与当前会话绑定不匹配' });
    }
    bridge = { ...(bridge || {}), gameId, country: turn.country, turnId: turn.turnId, logAt: 0, sessionId: bridgeSessionId };
    bridgeGame = await Game.create(turn.snapshot.stage, turn.snapshot, { fogOfWar: turn.snapshot.fogOfWar, logEnabled: true });
    bridge.controlledCountries = turn.config?.controlledCountries || [turn.country];
    bridgeGame.bridgeOpponentCountries = bridge.controlledCountries;   // 与浏览器一致：接管国的外交提议要经它自己同意
    bridge.logAt = bridgeGame.gameLog.length;
    bridge.startSnapshot = turn.snapshot;
    const result = content({
      ok: true,
      turnId: turn.turnId,
      gameId,
      round: turn.round,
      country: turn.country,
      messages,
      messagesError,
      ...turnBrief(bridgeGame, turn.country)
    });
    if (mapDeliveredGameId !== gameId) {
      const map = getMapView(bridgeGame, turn.country);
      result.content.push({ type: 'text', text: json(map) });
      result.content.push({ type: 'image', mimeType: 'image/png', data: renderMapPng(map).toString('base64') });
      mapDeliveredGameId = gameId;
    }
    return result;
  }
  if (name === 'wc2_bridge_submit_turn') {
    const invalidReason = reasonError(args.reason); if (invalidReason) return invalidReason;
    const targetTurnId = args.turn_id || bridge?.turnId;
    if (!bridgeGame || !bridge?.turnId || targetTurnId !== bridge.turnId) {
      return content({ ok: false, reason: '没有匹配的待提交桥接回合' });
    }
    const myLog = bridgeGame.gameLog.slice(bridge.logAt);
    // 事件决策里内嵌的外交动作(如 rejectPeaceOffer)旧版会被记到人类玩家名下：按它的被提议方(second)归属，不算越权
    for (const row of myLog) {
      const c = row.data?.command;
      if (row.event === 'commandApplied' && c?.type === 'rejectPeaceOffer' && c.second === bridge.country && row.actorCountry !== bridge.country) row.actorCountry = bridge.country;
    }
    const foreign = myLog.find(row => row.event === 'commandApplied' && row.actorCountry && row.actorCountry !== bridge.country);
    if (foreign) {
      return content({ ok: false, reason: `越权操作被拒绝：当前席位为 ${bridge.country}，不能为国家 ${foreign.actorCountry} 下达命令` });
    }
    const commands = myLog
      .filter(row => row.event === 'commandApplied' && row.actorCountry === bridge.country)
      .map(row => row.data.command).filter(command => command.type !== 'endTurn');
    for (const cmd of commands) {
      if (cmd.country && cmd.country !== bridge.country) {
        return content({ ok: false, reason: `越权操作被拒绝：命令目标国家为 ${cmd.country}，当前席位为 ${bridge.country}` });
      }
    }
    // 弹幕：把本回合每次操作的意图按顺序发给浏览器(连续相同理由的操作合并成一条)
    const notes = [];
    for (const row of myLog) {
      if (row.event !== 'operationReason' || row.actorCountry !== bridge.country) continue;
      const { label, reason } = row.data || {}; if (!reason) continue;
      const last = notes[notes.length - 1];
      if (last && last.reason === reason) { if (label && !last.labels.includes(label)) last.labels.push(label); } else notes.push({ labels: label ? [label] : [], reason });
    }
    notes.forEach(n => { n.label = n.labels.join('、'); delete n.labels; });
    if (args.reason && !notes.some(n => n.reason === args.reason)) notes.push({ label: '本回合总结', reason: args.reason });
    const hash = bridgeStateHash(bridgeGame);
    // 提交前按浏览器回放方式(逐条 game.apply)在回合初始快照上重放一遍，哈希不一致就拒绝，避免浏览器端报“状态不同步”
    if (bridge.startSnapshot) {
      const verify = await Game.create(bridge.startSnapshot.stage, bridge.startSnapshot, { fogOfWar: bridge.startSnapshot.fogOfWar, logEnabled: true });
      verify.bridgeOpponentCountries = bridge.controlledCountries || [bridge.country];
      let bad = null;
      for (const [i, cmd] of commands.entries()) { const r = verify.apply(JSON.parse(JSON.stringify(cmd))); if (!r.ok) { bad = `第 ${i + 1} 条命令(${cmd.type})回放被拒绝：${r.reason}`; break; } }
      if (!bad && bridgeStateHash(verify) !== hash) bad = '回放后的状态与副本不一致(通常是某条失败命令改动了状态，或命令顺序依赖未记录的副作用)';
      if (bad) {
        bridgeGame = await Game.create(bridge.startSnapshot.stage, bridge.startSnapshot, { fogOfWar: bridge.startSnapshot.fogOfWar, logEnabled: true });
        bridgeGame.bridgeOpponentCountries = bridge.controlledCountries || [bridge.country];
        bridge.logAt = bridgeGame.gameLog.length;
        return content({ ok: false, reason: '提交前回放校验失败：' + bad + '。副本已重置为回合开始状态，请重新下令；购卡请只用 useCard+pendingPurchase:true 一步完成，不要先单独 buyCard。' });
      }
    }
    try {
    await bridgeFetch('submit', {
      turnId: bridge.turnId,
      commands,
      endStateHash: hash,
      endSnapshot: bridgeGame.snapshot(),
      reasons: [args.reason],
      notes,
      summary: args.reason,
      sessionId: bridgeSessionId
    });
    } catch (error) {
      // 回合已被浏览器作废/替换(比如浏览器重新请求了回合、改用内置 AI)或桥重启：丢掉本地副本，让 agent 重新 wait_turn
      const lost = error.bridgeStatus === 409 || error.bridgeStatus === 404 || error.bridgeDown;
      if (lost) { bridge.turnId = null; bridgeGame = null; }
      return content({ ok: false, reason: `提交失败：${error.message}。${lost ? '本地回合已丢弃，请重新调用 wc2_bridge_wait_turn 获取最新回合。' : ''}` });
    }
    const result = { ok: true, turnId: bridge.turnId, gameId: bridge.gameId, country: bridge.country, commands: commands.length, endStateHash: hash };
    bridge.turnId = null; bridgeGame = null;
    return content(result);
  }
  if (name === 'wc2_new_game') {
    const invalidReason=reasonError(args.reason);if(invalidReason)return invalidReason;
    const stageData=JSON.parse(await fs.readFile(path.join(dataRoot,'stages',`${args.stage}.json`),'utf8')), requested=COUNTRY_ALIASES[String(args.player||'').toLowerCase()]||args.player||null;
    if(requested&&!stageData.countries?.some(c=>c.id===requested))return content({ok:false,reason:'invalid-player-country',requested:args.player,resolved:requested,validCountries:(stageData.countries||[]).map(c=>c.id),aliases:COUNTRY_ALIASES});
    game = await Game.create(args.stage, null, { player: requested, seed: args.seed ?? 1, fogOfWar: args.fog_of_war !== false, ownedCommanders:args.owned_commanders||[], commanderLevel:args.commander_level });
    configureControllers(game, args.enemy_ai || 'scripted');
    config = { stage: args.stage, player: game.player, enemyAi: args.enemy_ai || 'scripted', seed: args.seed ?? 1, fogOfWar: args.fog_of_war !== false,ownedCommanders:args.owned_commanders||[],commanderLevel:args.commander_level };
    config.slot=args.slot||defaultSlot(config);const reasonMeta=reasonResult(game,game.player,'newGame',args.reason),save=await persist();
    return content({ ok: true, config,save,...reasonMeta,aliases:COUNTRY_ALIASES,stageVersion: game.stage.data?.version || game.stage.data?.mapPatch?.version || null, view: getStrategicView(game, game.player, { limit: 8 }) }, true);
  }
  if(name==='wc2_list_saves')return content({saves:await listSaves()});
  if(name==='wc2_resume_game')return content(await resume(args.slot||'latest'),true);
  if (name === 'wc2_list_stages') {
    const files = (await fs.readdir(path.join(dataRoot, 'stages'))).filter(file => file.endsWith('.json')).filter(file => !args.prefix || file.startsWith(args.prefix)).sort();
    const stages=[]; for(const file of files){const data=JSON.parse(await fs.readFile(path.join(dataRoot,'stages',file),'utf8'));stages.push({id:file.slice(0,-5),defaultPlayer:data.player||data.countries?.find(c=>c.ai===false)?.id||data.countries?.[0]?.id||null,countries:(data.countries||[]).map(c=>({id:c.id,flag:c.flag,alliance:c.alliance,ai:c.ai!==false})),aliases:COUNTRY_ALIASES});}
    return content(stages);
  }
  if (name === 'wc2_save_record') {
    const safe = path.basename(args.file).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const target = path.join(root, 'scratch/ai_lab/mcp', safe.endsWith('.md') ? safe : `${safe}.md`);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, args.markdown, 'utf8');
    return content({ ok: true, path: target });
  }
  const g = requireGame(), country = bridgeGame ? bridge.country : g.player;
  if (name === 'wc2_get_map_view') {
    const view = getMapView(g, country), result = content(view);
    if (args.image !== false) result.content.push({ type: 'image', mimeType: 'image/png', data: renderMapPng(view).toString('base64') });
    return result;
  }
  if (name === 'wc2_get_strategic_view') { const view = getStrategicView(g, country, { limit: args.detail === 'detail' ? 30 : 10 }); return content(args.format === 'text' ? commandViewToText(view, args.detail) : view); }
  if (name === 'wc2_get_turn_brief') return content(turnBrief(g, country));
  if (name === 'wc2_get_theater_view') return content(getTheaterView(g, args.theater_id, country));
  if (name === 'wc2_get_army_group_view') return content(getArmyGroupView(g, args.group_id, country));
  if (name === 'wc2_get_unit_view') return content(getUnitView(g, args.army_id, country));
  if (name === 'wc2_preview_attack') return content(previewAttack(g, args.from, args.to, args.army_id, country));
  if (name === 'wc2_preview_order_path') return content(previewOrderPath(g, args));
  if (name === 'wc2_preview_order_risk') return content(previewOrderRisk(g, args.level, args.target_ids, args.order, country));
  if (name === 'wc2_get_intel') {
    if (args.kind === 'tile') return content(getTileView(g, args.area_id, country));
    if (args.kind === 'diplomacy') return content(getDiplomacyView(g, country));
    if (args.kind === 'orders') return content({ orders:getOrdersView(g, country, { activeOnly:args.active_only !== false }) });
    if (args.kind === 'events') {const all=getEventsView(g,country,{limit:100});const offset=Math.max(0,args.offset||0),limit=Math.max(1,Math.min(100,args.limit||30));return content({offset,limit,total:all.length,events:all.slice(offset,offset+limit)});}
    if (args.kind === 'commanders') return content({ commanders:getCommandersView(g, country) });
  }
  if (name === 'wc2_list_actions') return content(listCommandTypes(g, country));
  if (name === 'wc2_do') {const invalidReason=reasonError(args.reason);if(invalidReason)return invalidReason;if(bridgeGame && (args.command?.country !== country || args.command?.type === 'endTurn'))return content({ok:false,reason:'桥接回合只允许操作被接管国家，结束时请调用 wc2_bridge_submit_turn'});const fronts=hostileFronts(g,country),result=performCommand(g,args.command);if(result.ok){Object.assign(result,reasonResult(g,country,args.command?.type,args.reason));result.save=await persist();}const hid=redactEvents(result,fronts);if(hid)result.hiddenEvents=hid;return content(result);}
  if (name === 'wc2_do_batch') {
    if (bridgeGame && args.commands.some(command => command?.country !== country || command?.type === 'endTurn')) return content({ok:false,reason:'桥接回合只允许操作被接管国家'});
    const perCommand=args.commands.map(command=>command?.reason),batchReason=args.reason;
    if(batchReason){const invalidReason=reasonError(batchReason);if(invalidReason)return invalidReason;}
    const missing=perCommand.map((reason,index)=>({index,reason})).filter(row=>!batchReason&&!validateOperationReason(row.reason).ok);
    if(missing.length)return content({ok:false,reason:'missing-operation-reason',missing:missing.map(row=>row.index),suggestion:'请给整批提供一个中文 reason，或给每条 command 分别提供 reason。'});
    const clean=args.commands.map(command=>{const copy={...command};if(copy.type!=='proposeDiplomacy')delete copy.reason;return copy;});
    const fronts=hostileFronts(g,country),result=args.commands.some(c=>c?.when)?runConditionalBatch(g,country,args.commands.map((c,i)=>({command:clean[i],when:c?.when})),args.stop_on_error!==false):performCommandBatch(g,clean,{stopOnError:args.stop_on_error!==false});
    if(result.applied){
      const logged=[];
      result.results.forEach((item,index)=>{if(item.result.ok&&!item.skipped)logged.push(reasonResult(g,country,item.command?.type,batchReason||perCommand[index]));});
      result.operationReason=batchReason||null;result.operationReasonLogs=logged.map(row=>row.operationReasonLog);result.save=await persist();
    }const hid=redactEvents(result,fronts);if(hid)result.hiddenEvents=hid;return content(result);
  }
  if (name === 'wc2_auto_organize') {const invalidReason=reasonError(args.reason);if(invalidReason)return invalidReason;const result=autoOrganizeCountry(g,country);if(result.commands?.some(x=>x.result.ok)){Object.assign(result,reasonResult(g,country,'autoOrganize',args.reason));result.save=await persist();}return content(result);}
  if (name === 'wc2_end_turn') {
    if (bridgeGame) return content({ok:false,reason:'桥接回合请调用 wc2_bridge_submit_turn，不能执行普通 endTurn'});
    const invalidReason=reasonError(args.reason);if(invalidReason)return invalidReason;
    const before=capturePlayerState(g,country);
    const logAt = g.gameLog?.length || 0, result = performCommand(g, { type: 'endTurn' }), after = countState(g, country);
    const logs = (g.gameLog || []).slice(logAt).filter(entry => ['unitDestroyed', 'unitAttacked', 'areaCaptured', 'countryCapitulated', 'diplomacyChanged'].includes(entry.event));
    const reasonMeta=result.ok?reasonResult(g,country,'endTurn',args.reason):{},opponentSummary=summarizeOpponentTurn(g,country,before,logs,{detail:args.detail}),warnings=getOrdersView(g,country).flatMap(o=>o.warnings||[]).slice(0,8),save=await persist();opponentSummary.warnings=warnings;
    const compact={ok:result.ok,reason:result.reason,...reasonMeta,round:g.round,phase:g.phase,gameResult:g.result,save,opponentSummary};
    if(args.detail)compact.events=result.events;return content(compact);
  }
  throw new Error(`unknown-tool: ${name}`);
}

function reply(id, result = null, error = null) {
  const payload = error ? { jsonrpc: '2.0', id, error: { code: -32000, message: error.message || String(error) } } : { jsonrpc: '2.0', id, result };
  process.stdout.write(JSON.stringify(payload) + '\n');
}

let buffer = '';
let requestQueue = Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
    if (!line) continue;
    requestQueue = requestQueue.then(async () => {
      let request = null;
      try {
        request = JSON.parse(line);await autoResumePromise;
        if (request.method === 'initialize') return reply(request.id, { protocolVersion: request.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'wc2-commander', version: apiIdentity().apiVersion }, instructions:'先恢复匹配存档，再按“总参看全局—军区管方向—集团军走轴线—单位做例外微操”行动。每次改变游戏状态都要提供中文 reason（一到两句、80 字以内），真实说明当次依据与意图；不要套话或重复同一句。先看胜利条件、剩余回合、战线、资源、指令状态和合法目标；高风险攻击、路径和卡片先预览。常驻指令会跨回合延续，移动战线每 2—3 回合刷新；手动单位本回合优先，重新下达编队指令会交还指挥权。' });
        if (request.method === 'notifications/initialized') return;
        if (request.method === 'ping') return reply(request.id, {});
        if (request.method === 'tools/list') return reply(request.id, { tools: TOOLS });
        if (request.method === 'tools/call') {
          const name = request.params?.name || '';
          try { return reply(request.id, await call(name, request.params?.arguments || {})); }
          catch (error) {
            // 桥相关工具：把异常变成可读的结果而不是协议错误，agent 能据此重试/重新 attach
            if (name.startsWith('wc2_bridge_')) return reply(request.id, content({ ok: false, reason: error.message || String(error), hint: error.bridgeDown ? '桥未连接，稍后重试或确认游戏服务在运行' : '如提示席位/回合问题，请重新 wc2_bridge_attach 或 wc2_bridge_wait_turn' }));
            throw error;
          }
        }
        reply(request.id, null, new Error(`method-not-found: ${request.method}`));
      } catch (error) { reply(request?.id ?? null, null, error); }
    });
  }
});
