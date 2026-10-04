// Visual-state deltas, never re-run AI, scripts or random combat during playback.
// Paths are interned once; arrays are patched by index (including length).
const clone = value => JSON.parse(JSON.stringify(value));
const FX = new Set(['unitMoved', 'unitAttacked', 'areaCaptured', 'unitDeployed', 'armyFronted']);
function liveState(game) {
  return { round: game.round, activeCountry: game.activeCountry,
    reportLog: game.reportLog || [], nextReportId: game.nextReportId || 1, reportRevision: game.reportRevision || 0,
    money: game.money, industry: game.industry, tech: game.tech, stability: game.getStability ? game.getStability(game.player) : game.stability,
    areas: game.stage.areas, countries: game.stage.data.countries, coordination: game.coordination || { attacks: {}, manual: [] }, theatres: game.theatres || [], nextTheaterId: game.nextTheaterId || 1, orders: game.orders || [], nextOrderId: game.nextOrderId || 1, armyGroups: game.armyGroups || [], nextArmyGroupId: game.nextArmyGroupId || 1,
    diplomacy: game.diplomacy ? { enabled: game.diplomacy.enabled, relations: game.diplomacy.relations, capitals: game.diplomacy.capitals } : null };
}
export function replayState(game) { return clone(liveState(game)); }
// What JSON.stringify would keep of a value: undefined/functions vanish, non-finite numbers become null.
const jsonValue = v => typeof v === 'number' ? (Number.isFinite(v) ? v : null) : typeof v === 'function' || typeof v === 'symbol' ? undefined : v;
// Same patches as diff(previous, clone(live)), but walks the live state and clones only what changed.
function diffLive(a, live, path, put) {
  const b = jsonValue(live);
  if (a === b) return;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    if (!Array.isArray(a)) for (const key of Object.keys(a)) if (jsonValue(b[key]) === undefined) put([...path, key]);
    const isArray = Array.isArray(b);
    for (const key of Object.keys(b)) {
      let child = b[key];
      if (isArray && jsonValue(child) === undefined) child = null;
      else if (!isArray && jsonValue(child) === undefined) continue;
      path.push(key); diffLive(a[key], child, path, put); path.pop();
    }
    if (isArray && a.length !== b.length) put([...path, 'length'], b.length);
  } else put([...path], b);
}
function diff(a, b, path, put) {
  if (a === b) return;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    // `path` is shared and mutated while descending; `put` always receives its own copy.
    if (!Array.isArray(a)) for (const key of Object.keys(a)) if (!(key in b)) put([...path, key]);
    for (const key of Object.keys(b)) { path.push(key); diff(a[key], b[key], path, put); path.pop(); }
    if (Array.isArray(b) && a.length !== b.length) put([...path, 'length'], b.length);
  } else put([...path], b);
}
export function applyReplayFrame(state, frame, paths) {
  for (const patch of frame.p) {
    const path = paths[patch[0]];
    let target = state;
    for (let i = 0; i < path.length - 1; i++) target = target[path[i]];
    const key = path[path.length - 1];
    if (patch.length === 1) delete target[key]; else target[key] = clone(patch[1]);
  }
  return state;
}
export class ReplayRecorder {
  constructor(game, saved) {
    this.game = game;
    this.data = saved ? clone(saved) : { version: 1, mode: 'delta', initial: replayState(game), paths: [], frames: [] };
    this.previous = replayState(game);
    this.paths = new Map(this.data.paths.map((p, i) => [JSON.stringify(p), i]));
    this.pending = [];
    if (saved) {
      // Loading normalises countries and missing unit facings. Record that seam too.
      const cursor = new ReplayCursor(this.data);
      while (cursor.next()) {}
      this.previous = cursor.state;
      this.capture();
    }
  }
  event(event) {
    if (!FX.has(event.type)) return;
    // Keep animation arguments only, not verbose combat diagnostics.
    const e = { type: event.type };
    for (const key of ['from', 'to', 'area', 'armyId', 'previousArmyId', 'country', 'armyType', 'damage', 'counter'])
      if (event[key] !== undefined) e[key] = event[key];
    this.pending.push(e);
  }
  capture(command = null) {
    if (this.game.spectating) return;
    const live = liveState(this.game), patches = [];
    diffLive(this.previous, live, [], (path, value) => {
      const key = JSON.stringify(path);
      let id = this.paths.get(key);
      if (id === undefined) { id = this.data.paths.length; this.paths.set(key, id); this.data.paths.push(path); }
      patches.push(value === undefined ? [id] : [id, clone(value)]);
    });
    // Bring the stored previous state up to date with the same patches playback applies.
    applyReplayFrame(this.previous, { p: patches }, this.data.paths);
    if (patches.length || this.pending.length || command) this.data.frames.push({
      r: live.round, c: command?.country || live.activeCountry, t: command?.type || '', p: patches, e: this.pending.splice(0),
    });
  }
}
export class ReplayCursor {
  constructor(data) { this.data = data; this.reset(); }
  reset() { this.state = clone(this.data.initial); this.index = 0; return this.state; }
  next() {
    const frame = this.data.frames[this.index];
    if (!frame) return null;
    applyReplayFrame(this.state, frame, this.data.paths); this.index++; return frame;
  }
  seek(round) {
    this.reset();
    // Land on the first recorded state of the requested round.
    while (this.index < this.data.frames.length && this.state.round < round) this.next();
    return this.state;
  }
}
export function installReplayState(game, state) {
  const s = clone(state);
  for (const key of ['round', 'activeCountry', 'money', 'industry', 'tech', 'stability', 'diplomacy']) game[key] = s[key];
  game.reportLog = s.reportLog || []; game.nextReportId = s.nextReportId || 1; game.reportRevision = s.reportRevision || 0;
  game.coordination = s.coordination || { attacks: {}, manual: [] };
  game.theatres = s.theatres || []; game.nextTheaterId = s.nextTheaterId || 1; game.orders = s.orders || []; game.nextOrderId = s.nextOrderId || 1;
  game.armyGroups = s.armyGroups || [];
  game.nextArmyGroupId = s.nextArmyGroupId || 1;
  game.stage.areas = game.stage.data.areas = s.areas;
  game.stage.byArea = new Map(s.areas.map(a => [a.id, a]));
  game.stage.data.countries = s.countries;
  game.stage.countries = new Map(s.countries.map(c => [c.id, c]));
}
