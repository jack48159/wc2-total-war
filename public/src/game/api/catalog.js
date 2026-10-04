import { commandTypes } from '../commands.js';

export const API_VERSION = '2026.10.6';
export const OPERATION_REASON_SCHEMA = { type:'string', minLength:1, maxLength:80, description:'面向玩家的中文操作说明：一到两句话，只写本次决策依据和意图。' };
export const ORDER_FIELDS = ['verb','from','to','risk','priority','expires','depth','ao','mustHold','line','path','axes','draw','guard','detour','confirmedHighRisk'];
export const ORDER_VERBS = ['attack','breakthrough','envelop','counterattack','defend','delay','concentrate','screen','withdraw','support','allout'];

const integer = description => ({ type: 'integer', description });
const string = description => ({ type: 'string', description });
const bool = description => ({ type: 'boolean', description });
const ids = description => ({ type: 'array', items: { type: 'integer' }, description });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: true });
const spec = (category, description, properties = {}, required = [], notes = '') => ({ category, description, schema: object({ type: { const: '' }, ...properties }, ['type', ...required]), notes });
const orderSchema={type:['object','null'],description:'Standing order; null cancels. axes derives from/to when omitted; defend/screen line derives to=line.',properties:{
  verb:{enum:ORDER_VERBS},from:{oneOf:[{type:'integer'},{type:'array',items:{type:'integer'},minItems:1}]},to:{oneOf:[{type:'integer'},{type:'array',items:{type:'integer'},minItems:1}]},
  risk:{type:'number',minimum:0,maximum:1,default:.5},priority:{type:'integer',minimum:1,maximum:9,default:5},expires:{type:'integer',minimum:1},depth:{type:'integer',minimum:1},
  ao:ids('area of operations'),mustHold:ids('must-hold tiles'),line:ids('defensive line; to must equal line'),path:ids('adjacent route, max 40'),axes:{type:'array',minItems:2,maxItems:2,items:ids('one adjacent axis')},draw:{type:'array'},guard:{enum:['hold','ring']},detour:{type:'boolean'},confirmedHighRisk:{type:'boolean'}
},required:['verb'],additionalProperties:true};

// Payload schemas live beside the API rather than in UI code. Coverage is driven
// by the command registry: a new registered command must be described here or in
// EXCLUDED_COMMANDS, otherwise tests/test_api_coverage.mjs fails.
export const COMMAND_SPECS = {
  move: spec('micro','Move one unit along the engine path.',{from:integer('source tile'),to:integer('destination tile'),armyId:integer('unit id')},['from','to','armyId']),
  attack: spec('micro','Attack the front unit of a legal target.',{from:integer('source tile'),to:integer('target tile'),armyId:integer('attacking unit')},['from','to','armyId']),
  frontArmy: spec('micro','Place a unit at the front of its stack.',{from:integer('tile'),armyId:integer('unit id')},['from','armyId']),
  buyCard: spec('economy','Buy a card or start technology research. Refuses cards with no current legal target unless explicitly confirmed.',{card:integer('card id'),allowNoTarget:bool('explicitly buy for later even when no target exists')},['card']),
  useCard: spec('economy','Use or buy-and-use a card.',{card:integer('card id'),target:integer('target tile'),armyId:integer('optional manually controlled unit'),pendingPurchase:bool('buy and use immediately'),country:string('acting country')},['card','target']),
  endTurn: spec('turn','End the player turn and run opponents.'),
  createArmyGroup: spec('command','Create an empty army group.',{country:string('country'),name:string('name'),commanderId:string('commander id')},['country','commanderId']),
  setArmyGroup: spec('command','Create or replace a group roster.',{country:string('country'),groupId:string('existing group id'),name:string('name'),commanderId:string('commander id'),unitIds:ids('1..group limit unique live units')},['country','commanderId','unitIds']),
  transferUnits: spec('command','Move units between groups or leave them unassigned.',{country:string('country'),unitIds:ids('unit ids'),toGroupId:string('destination group or null')},['country','unitIds']),
  dissolveArmyGroup: spec('command','Dissolve an army group and its orders.',{country:string('country'),groupId:string('group id')},['country','groupId']),
  appointCommander: spec('command','Appoint an eligible owned/free commander.',{country:string('country'),groupId:string('group id'),commanderId:string('commander id')},['country','groupId','commanderId']),
  renameArmyGroup: spec('command','Rename an army group.',{country:string('country'),groupId:string('group id'),name:string('new name')},['country','groupId','name']),
  createTheater: spec('command','Create a theater.',{country:string('country'),name:string('name')},['country']),
  renameTheater: spec('command','Rename a theater.',{country:string('country'),theaterId:string('theater id'),name:string('new name')},['country','theaterId','name']),
  dissolveTheater: spec('command','Dissolve a theater and its order.',{country:string('country'),theaterId:string('theater id')},['country','theaterId']),
  appointMarshal: spec('command','Appoint or clear a theater marshal.',{country:string('country'),theaterId:string('theater id'),marshalId:string('marshal id or null')},['country','theaterId']),
  assignArmyToTheater: spec('command','Assign or detach an army group.',{country:string('country'),groupId:string('group id'),theaterId:string('theater id or null')},['country','groupId']),
  setTheaterOrder: spec('order','Set, replace, or cancel a theater standing order.',{country:string('country'),theaterId:string('theater id'),order:orderSchema},['country','theaterId','order'],'breakthrough cannot use axes; use envelop for two axes.'),
  setArmyOrder: spec('order','Set, replace, or cancel an army-group standing order.',{country:string('country'),groupId:string('group id'),order:orderSchema},['country','groupId','order'],'breakthrough cannot use axes; use envelop for two axes.'),
  setCountryOrder: spec('order','Issue allout to every unit of the country. High risk: use only in advantage or desperation.',{country:string('country'),order:orderSchema},['country','order'],'allout needs no from/to/path; absent expires runs only this turn.'),
  executeOrder: spec('order','Execute a standing order immediately.',{country:string('country'),level:{enum:['army','theater','country']},targetId:string('formation id or country id')},['country','level','targetId']),
  setOrderPaused: spec('order','Pause or resume a standing order.',{country:string('country'),level:{enum:['army','theater','country']},targetId:string('formation id or country id'),paused:bool('paused state')},['country','level','targetId','paused']),
  setOrderAuto: spec('order','Toggle automatic standing-order execution.',{country:string('country'),level:{enum:['army','theater','country']},targetId:string('formation id or country id'),on:bool('automatic')},['country','level','targetId','on']),
  setTheaterAI: spec('command','Toggle marshal AI trusteeship for a theater.',{country:string('country'),theaterId:string('theater id'),on:bool('trusteeship')},['country','theaterId','on']),
  proposeDiplomacy: spec('diplomacy','Propose NAP, alliance, or peace.',{first:string('proposer'),second:string('target'),action:{enum:['nap','alliance','peace']},reason:string('reason')},['first','second','action']),
  rejectPeaceOffer: spec('diplomacy','Reject a pending peace offer.',{first:string('proposer'),second:string('target')},['first','second']),
  resolveEventNotice: spec('event','Acknowledge a pending scenario notice.',{eventId:string('event id')},['eventId']),
  resolveEventDecision: spec('event','Choose an option in a pending scenario decision.',{eventId:string('event id'),choiceId:string('choice id')},['eventId','choiceId']),
};

export const EXCLUDED_COMMANDS = {
  setDiplomacy: 'Scenario/admin primitive. Normal players must use proposeDiplomacy so stability, acceptance, reparations, and cooldown rules apply.'
};

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function commandCatalog() {
  return commandTypes().sort().filter(type => COMMAND_SPECS[type]).map(type => {
    const entry = COMMAND_SPECS[type], schema = structuredClone(entry.schema);
    schema.properties.type.const = type;
    return { type, category: entry.category, description: entry.description, parameters: schema, notes: entry.notes || null };
  });
}

export function coverageReport() {
  const registered = commandTypes().sort();
  const described = registered.filter(type => COMMAND_SPECS[type]);
  const excluded = registered.filter(type => EXCLUDED_COMMANDS[type]).map(type => ({ type, reason: EXCLUDED_COMMANDS[type] }));
  const missing = registered.filter(type => !COMMAND_SPECS[type] && !EXCLUDED_COMMANDS[type]);
  const stale = Object.keys(COMMAND_SPECS).filter(type => !registered.includes(type));
  return { registered, described, excluded, missing, stale };
}

export function apiIdentity() {
  const report = coverageReport();
  const material = JSON.stringify({ registered: report.registered, specs: commandCatalog(), orderFields: ORDER_FIELDS, orderVerbs: ORDER_VERBS });
  return { apiVersion: API_VERSION, rulesFingerprint: `fnv1a-${fnv1a(material)}`, orderFields: ORDER_FIELDS, orderVerbs: ORDER_VERBS, operationReason:OPERATION_REASON_SCHEMA };
}
