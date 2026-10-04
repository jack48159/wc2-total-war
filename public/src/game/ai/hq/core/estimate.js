import { canOccupyAfterAttack, estimateAttack } from '../../../rules/combatModel.js';

const clamp = x => Math.max(0, Math.min(1, x));
const exchangeMemo = new WeakMap();
export function clearExchangeMemo(model) { exchangeMemo.delete(model); }

export function expectedExchange(model, attacker, fromAreaId, defAreaId, opts = {}) {
  const game = model.game, from = game.stage.st(fromAreaId), to = game.stage.st(defAreaId);
  const source = attacker.army || attacker;
  const front = opts.defender || to?.armies?.[0];
  if (!from || !to || !front) return { dmgDef: 0, dmgAtt: 0, pKillFront: 0, pAttackerDies: 0, pClear: 0, flankPct: 0, encircle: { atk: 0, def: 0 }, counter: false };
  let memo = exchangeMemo.get(model);
  if (!memo) { memo = new Map(); exchangeMemo.set(model, memo); }
  const key = `${source.id}|${source.hp}|${source.level}|${source.cards}|${fromAreaId}|${defAreaId}|${front.id}|${front.hp}`;
  if (memo.has(key)) return memo.get(key);
  const result = estimateAttack(game, source, front.army || front, from, to, attacker.country || source.country, model.encirclementMemo);
  const attackerDef = game.stage.armyDef(attacker.country || source.country || from.country, source.type);
  let splashGain = 0, splashLoss = 0;
  const unitDamageValue = (unit, damage) => Math.min(unit.hp, damage) / Math.max(1, unit.maxHp) * (model.unitValue?.(unit) ?? unit.maxHp);
  const falloff = Number(attackerDef.stackSplashFalloff || 0);
  if (falloff > 0) for (let index = 1; index < to.armies.length; index++) {
    const rate = Math.max(0, 1 - index / falloff);
    splashGain += unitDamageValue(to.armies[index], Math.trunc(result.dmgDef * rate));
  }
  const adjacentPct = Number(attackerDef.adjacentSplashPercent || 0);
  if (adjacentPct > 0) for (const id of game.stage.adjE.get(defAreaId) || []) {
    if (id === fromAreaId) continue;
    const area = game.stage.st(id);
    if (!area?.armies?.length) continue;
    const value = area.armies.reduce((sum, unit) => sum + unitDamageValue(unit, Math.ceil(result.dmgDef * adjacentPct / 100)), 0);
    if (area.country === (attacker.country || source.country || from.country)) splashLoss += value;
    else splashGain += value;
  }
  const exchange = { ...result, splashGain, splashLoss,
    pClear: to.armies.length === 1 ? result.pKillFront : 0, counter: result.canCounter };
  memo.set(key, exchange);
  return exchange;
}

export function sequenceOutcome(model, attackers, defAreaId) {
  const to = model.game.stage.st(defAreaId);
  if (!to?.armies?.length || !attackers?.length) return { pCapture: 0, expectedLossAtt: 0, expectedKillDef: 0, order: [] };
  const ordered = [...attackers];
  const hp = to.armies.reduce((n, a) => n + a.hp, 0);
  let remaining = new Map([[hp, 1]]), loss = 0;
  for (const entry of ordered) {
    const e = expectedExchange(model, entry.unit, entry.from, defAreaId);
    const next = new Map();
    for (const [currentHp, probability] of remaining)
      for (const [damage, chance] of e.damageDistribution || [[Math.round(e.dmgDef), 1]]) {
        const after = Math.max(0, currentHp - damage);
        next.set(after, (next.get(after) || 0) + probability * chance);
      }
    remaining = next;
    const unit = entry.unit.army || entry.unit;
    loss += e.dmgAtt / Math.max(1, unit.maxHp) * (model.unitValue?.(unit) ?? unit.maxHp);
  }
  const hasOccupier = ordered.some(entry => {
    const unit = entry.unit.army || entry.unit;
    const from = model.game.stage.st(entry.from);
    return from && canOccupyAfterAttack(unit, from, to, model.game.stage.armyDef(from.country, unit.type));
  });
  const pCapture = clamp(hasOccupier ? (remaining.get(0) || 0) : 0);
  const expectedDamage = [...remaining].reduce((sum, [rest, chance]) => sum + (hp - rest) * chance, 0);
  const expectedKillDef = clamp(expectedDamage / Math.max(1, hp)) * to.armies.reduce((n, a) => n + (model.unitValue?.(a) ?? a.maxHp), 0);
  return { pCapture, expectedLossAtt: loss, expectedKillDef, order: ordered };
}
