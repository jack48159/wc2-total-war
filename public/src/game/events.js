// Everything that happens in the rules is reported as a plain event object. The UI never inspects rule internals: it
// listens (game.on) and animates / plays sounds; a replay viewer or an LLM gets the same stream.
//
// Event = { type, ...payload }. Add new types here first (single list = the contract with the UI).
export const EV = {
  // turn structure
  TURN_BEGIN: 'turnBegin',        // { country, round }
  TURN_END: 'turnEnd',            // { country, round }
  ROUND_BEGIN: 'roundBegin',      // { round, income: { money, industry } }   (human side's income for the report)
  // army actions
  UNIT_MOVED: 'unitMoved',        // { from, to, armyId, armyType, country }   (payload keys must never be named `type`)
  UNIT_DEPLOYED: 'unitDeployed',  // { area, armyId, armyType, country }
  UNIT_ATTACKED: 'unitAttacked',  // v2 also carries raw/adjusted results, movement/facing, modifier diagnostics and ruleVersion
  UNIT_DAMAGED: 'unitDamaged',    // { area, armyId, hp, lost }
  UNIT_HEALED: 'unitHealed',      // { area, armyId, hpBefore, hp, restored, rest, rank }
  UNIT_DESTROYED: 'unitDestroyed',// { area, armyId, byCountry }
  UNIT_PROMOTED: 'unitPromoted',  // { area, armyId, level }
  MORALE_CHANGED: 'moraleChanged',// { area, armyId, morale, moraleUpTurn }
  AREA_CAPTURED: 'areaCaptured',  // { area, from, to }
  ARMY_FRONTED: 'armyFronted',     // { area, armyId }  the army was put in front of its stack
  COMMANDER_DIED: 'commanderDied', // { country, area, armyId, commanderTurn }
  MEDAL_GAINED: 'medalGained',     // { country, area, medals }
  COMMANDER_COMPLAINT: 'commanderComplaint', // { country, commander, variant (1|2), area }  an ally's general protests at us walking into their land
  // economy / cards
  RESOURCES_CHANGED: 'resources', // { country, money, industry }
  CARD_BOUGHT: 'cardBought',      // { country, card, moneyCost, industryCost, moneyAfter, industryAfter, handCount }
  CARD_USED: 'cardUsed',          // { country, card, target }
  AIR_STRIKE: 'airStrike',        // { country, card, target, roll, damage, strikeType }
  // scenario
  COUNTRY_DEFEATED: 'countryDefeated', // { country }
  GAME_OVER: 'gameOver',          // { result: 'victory' | 'greatVictory' | 'defeat', round }
  SCENARIO_EVENT: 'scenarioEvent',// { id, ... }
  DIPLOMACY_CHANGED: 'diplomacyChanged', // { first, second, state, reason }
  STABILITY_CHANGED: 'stabilityChanged', // { country, old, stability, delta, reason }
  WAR_REPARATIONS_PAID: 'warReparationsPaid', // { from, to, reparations, paid, isBroke }
  DIPLOMACY_OFFER_RESOLVED: 'diplomacyOfferResolved', // { first, second, action, accepted, score, why }
  DIPLOMACY_PACT: 'diplomacyPact', // { first, second, pactType, reason }
  COUNTRY_CAPITULATED: 'countryCapitulated', // { country, to, round }
};

export class Emitter {
  constructor() { this.subs = new Map(); }
  on(type, fn) { (this.subs.get(type) || this.subs.set(type, []).get(type)).push(fn); return () => this.off(type, fn); }
  off(type, fn) { const l = this.subs.get(type); if (l) this.subs.set(type, l.filter(f => f !== fn)); }
  // A failing listener (a UI bug) must never abort the rule that emitted the event half way, so its error is only logged.
  emit(ev) {
    for (const f of [...(this.subs.get(ev.type) || []), ...(this.subs.get('*') || [])]) { try { f(ev); } catch (e) { console.error('event listener failed for', ev.type, e); } }
  }
}
