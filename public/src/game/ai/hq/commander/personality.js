const clamp = value => Math.max(0, Math.min(1, value));
import { loadOverrides } from '../core/params.js';
import { tacticalBonus } from '../../../army_groups.js';
// Multipliers are measured relative to an ordinary unit (1). The direct command has no personal modifiers.
const config = loadOverrides();
export const PERSONALITY = Object.freeze({ ATTACK_SCALE: config.attackScale, DAMAGE_SCALE: config.damageScale, COUNTER_SCALE: config.counterScale, REFUSE_SUCCESS: config.refuseSuccess, REFUSE_RISK: config.refuseRisk, OVERREACH_THRESHOLD: config.overreachThreshold, RETREAT_BASE: config.retreatBase });
export const overreachNetThreshold = discipline => PERSONALITY.OVERREACH_THRESHOLD * (1 + Math.max(0, discipline));
export function personality(mods = {}, direct = false, units = [], model = null) {
  if (direct || !Object.keys(mods || {}).length) return { initiative: config.personalityNeutral, caution: config.personalityNeutral, discipline: 1 };
  const mean = suffix => {
    const values = Object.entries(mods).filter(([key, value]) =>
      (key === suffix || key.endsWith(suffix[0].toUpperCase() + suffix.slice(1))) && Number.isFinite(value));
    return values.length ? values.reduce((n, [, value]) => n + value, 0) / values.length : 0;
  };
  let attack = mean('attack'), defence = mean('defence'), counter = mean('counter');
  if (model?.game && units.length) {
    let weight = 0, attackTotal = 0, defenceTotal = 0, counterTotal = 0;
    for (const row of units) {
      const unit = row.army || row.unit || row;
      const bonus = tacticalBonus(model.game, unit.country || row.area?.country || model.me, unit);
      if (!bonus.commander) continue;
      const value = model.unitValue?.(unit) || 1;
      weight += value;
      attackTotal += (bonus.attack - 1) * value;
      defenceTotal += (1 - bonus.received) * value;
      counterTotal += (bonus.counter - 1) * value;
    }
    if (weight) { attack = attackTotal / weight; defence = defenceTotal / weight; counter = counterTotal / weight; }
  }
  const initiative = clamp(config.personalityNeutral + PERSONALITY.ATTACK_SCALE * attack - PERSONALITY.DAMAGE_SCALE * defence);
  const caution = clamp(config.personalityNeutral + PERSONALITY.DAMAGE_SCALE * defence + PERSONALITY.COUNTER_SCALE * counter);
  return { initiative, caution, discipline: 1 - config.disciplineExtremeFactor * Math.abs(initiative - config.personalityNeutral) };
}
export function deterministicChance(seed, round, id) {
  let hash = 2166136261;
  for (const char of `${seed}:${round}:${id}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
}
