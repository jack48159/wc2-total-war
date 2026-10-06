import { World } from '../world.js';
import { nativeAlliance } from './combatModel.js';

const NAVY = new Set(['destroyer', 'cruiser', 'battleship', 'aircraftcarrier']);
const VIEW_GAME = new WeakMap();
const VIEW_COUNTRY = new WeakMap();
// A battle draw asks for the same player's view from the HUD, terrain and units.
// Keep those expensive copies for this draw only; commands/AI outside draw always
// see a fresh state, and the next draw starts with an empty cache.
let renderViews = null;
export function beginVisibilityFrame() { renderViews = new WeakMap(); }
export function endVisibilityFrame() { renderViews = null; }
function cachedView(game, country) {
  if (!renderViews) return null;
  const byCountry = renderViews.get(game);
  return byCountry?.get(country) || null;
}
function saveView(game, country, key, value) {
  if (!renderViews) return value;
  let byCountry = renderViews.get(game);
  if (!byCountry) { byCountry = new Map(); renderViews.set(game, byCountry); }
  const entry = byCountry.get(country) || {};
  entry[key] = value;
  byCountry.set(country, entry);
  return value;
}

function friendly(stage, game, a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (game?.diplomacy?.enabled) return game.areDiplomaticAllies(a, b);
  const first = nativeAlliance(stage.alliance(a)), second = nativeAlliance(stage.alliance(b));
  return first !== 4 && first === second;
}

export function visibilityForCountry(game, country) {
  if (VIEW_GAME.has(game)) game = VIEW_GAME.get(game);
  const cached = cachedView(game, country)?.visible;
  if (cached) return cached;
  const stage = game.stage, visible = new Set(), enabled = stage.enabled;
  const add = id => { if (enabled.has(id)) visible.add(id); };
  const sea = id => World.areas[id]?.f === 1;
  const neighbours = id => stage.adjE.get(id) || [];
  const allies = new Map();
  const isFriendly = owner => {
    if (!allies.has(owner)) allies.set(owner, friendly(stage, game, country, owner));
    return allies.get(owner);
  };
  for (const area of stage.areas) {
    if (!isFriendly(area.country)) continue;
    add(area.id);
    if (!sea(area.id)) {
      for (const id of neighbours(area.id)) if (!sea(id)) add(id);
      // A friendly coastal territory reveals its adjacent sea, but grants no further naval range.
      for (const id of neighbours(area.id)) if (sea(id)) add(id);
    }
  }
  for (const area of stage.areas) {
    if (!isFriendly(area.country) || !area.armies?.some(unit => NAVY.has(unit.type))) continue;
    const range = area.armies.some(unit => unit.type === 'aircraftcarrier') ? 2 : 1;
    const queue = [[area.id, 0]], seen = new Set([area.id]);
    while (queue.length) {
      const [id, distance] = queue.shift(); add(id);
      if (distance >= range) continue;
      for (const next of neighbours(id)) if (sea(next) && !seen.has(next)) { seen.add(next); queue.push([next, distance + 1]); }
    }
  }
  for(const intel of game.sandboxState?.intel?.[country]||[]){if(intel.until<game.round)continue;const queue=[[intel.area,0]],seen=new Set();while(queue.length){const [id,d]=queue.shift();if(seen.has(id))continue;seen.add(id);add(id);if(d<(intel.range||0))for(const next of neighbours(id))queue.push([next,d+1]);}}
  return saveView(game, country, 'visible', visible);
}

function cloneArea(area, visible) {
  if (!area) return null;
  const copy = { ...area, armies: visible ? (area.armies || []).map(unit => ({ ...unit })) : [] };
  if (!visible) { copy.construction = 'none'; copy.level = 0; copy.installation = 'none'; }
  return copy;
}

export function rememberVisibility(game, country) {
  if (!game.fogOfWar) return null;
  if (VIEW_GAME.has(game)) game = VIEW_GAME.get(game);
  const cached = cachedView(game, country)?.intel;
  if (cached) return cached;
  const now = visibilityForCountry(game, country);
  game.visibilityMemory ||= {};
  const memory = game.visibilityMemory[country] ||= {};
  for (const id of now) {
    const area = game.stage.st(id);
    if (area) memory[id] = cloneArea(area, true);
  }
  return saveView(game, country, 'intel', { now, memory });
}

export function countryGameView(game, country) {
  if (VIEW_GAME.has(game)) {
    if (VIEW_COUNTRY.get(game) === country) return game;
    game = VIEW_GAME.get(game);
  }
  const cached = cachedView(game, country)?.gameView;
  if (cached) return cached;
  const result = rememberVisibility(game, country);
  if (!result) return game;
  const { now, memory } = result, source = game.stage;
  const areas = source.areas.map(area => now.has(area.id) ? cloneArea(area, true) : memory[area.id] ? cloneArea(memory[area.id], false) : { ...area, country: null, armies: [], construction: 'none', level: 0, installation: 'none' });
  const byArea = new Map(areas.map(area => [area.id, area]));
  const countries = new Map([...source.countries].map(([id, value]) => [id, { ...value, traits: value.traits?.slice() }]));
  const data = { ...source.data, areas, countries: source.data.countries.map(value => ({ ...value, traits: value.traits?.slice() })) };
  if (data.scenarioEvents) data.scenarioEvents = { history: data.scenarioEvents.history, variables: data.scenarioEvents.variables };
  delete data.events;
  if(data.sandboxFeatures)data.sandboxFeatures={...data.sandboxFeatures,campaign:undefined};
  const facade = new Proxy(source, { get(target, key) {
    if (key === 'areas') return areas;
    if (key === 'data') return data;
    if (key === 'byArea') return byArea;
    if (key === 'countries') return countries;
    if (key === 'st') return id => byArea.get(id);
    if (key === 'ownerOf') return id => byArea.get(id)?.country;
    if (key === 'game') return gameView;
    const value = Reflect.get(target, key, facade);
    return typeof value === 'function' ? value.bind(facade) : value;
  }, ownKeys() { return []; }, getOwnPropertyDescriptor() { return undefined; }});
  const gameView = new Proxy(game, { get(target, key) {
    if (key === 'stage') return facade;
    if (key === 'describe') return () => describeCountry(game, country, now, memory);
    if (key === 'snapshot' || key === 'apply' || key === 'describeFull' || key === 'getGameLog' || key === 'visibilityMemory' || key === 'gameLog' || key === 'log' || key === 'logSink' || key === 'spawnArmy' || key === 'initArmies' || key === 'on' || key === 'emit' || key === 'flushGameLog' || key === 'setDiplomaticRelation' || key === 'registerDiplomaticHostility' || key === 'registerDiplomaticOccupation' || key === 'recordWarLoss' || key === 'proposeDiplomacy' || key === 'setStability' || key === 'changeStability') return undefined;
    if (key === 'events' || key === 'controllers' || key === 'rng') return undefined;
    if(key==='campaignRun')return null;
    if(key==='sandboxState')return {intel:{[country]:structuredClone(target.sandboxState?.intel?.[country]||[])},falseIntel:{[country]:structuredClone(target.sandboxState?.falseIntel?.[country]||[])}};
    if (key === 'scenarioEvents') return target.scenarioEvents ? { history: target.scenarioEvents.history, variables: target.scenarioEvents.variables } : null;
    if (key === 'diplomacy') return target.diplomacy ? JSON.parse(JSON.stringify(target.diplomacy)) : null;
    if (key === 'hand' || key === 'medalLevels' || key === 'cardCooldowns') return { ...target[key] };
    if (key === 'playerInfo') return target.playerInfo ? { ...target.playerInfo, traits: target.playerInfo.traits?.slice() } : null;
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }, set() { return false; }, ownKeys() { return []; }, getOwnPropertyDescriptor() { return undefined; }});
  VIEW_GAME.set(gameView, game);
  VIEW_COUNTRY.set(gameView, country);
  return saveView(game, country, 'gameView', gameView);
}

export function describeCountry(game, country, visible = null, memory = null) {
  if (!game.fogOfWar) return game.describe();
  if (!visible) ({ now: visible, memory } = rememberVisibility(game, country));
  const areas = game.stage.areas.filter(a => game.stage.enabled.has(a.id)).map(a => {
    const seen = visible.has(a.id), known = seen ? a : memory[a.id];
    return { id: a.id, country: known?.country ?? null, armies: seen ? a.armies.map(unit => ({ ...unit })) : [], construction: seen ? a.construction : 'none', level: seen ? a.level : 0, installation: seen ? a.installation : 'none', neighbours: [...(game.stage.adjE.get(a.id) || [])] };
  });
  const state = game.describeFull();
  delete state.gameLog;
  if (state.scenarioEvents) state.scenarioEvents = { variables: state.scenarioEvents.variables, history: state.scenarioEvents.history };
  return { ...state, hand: { ...state.hand }, areas };
}
