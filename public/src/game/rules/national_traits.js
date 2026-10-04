// National regime, starting stability and strategic traits. Numbers live in
// public/data/national_traits.json. Effects are inert unless diplomacy is on.

let cache = null;

export async function loadNationalTraits() {
  if (cache) return cache;
  const fileUrl = typeof document !== 'undefined' ? new URL('data/national_traits.json', document.baseURI) : new URL('../../../data/national_traits.json', import.meta.url);
  if (fileUrl.protocol === 'file:') {
    const fs = await import('node:fs');
    cache = JSON.parse(fs.readFileSync(fileUrl, 'utf8'));
    return cache;
  }
  const res = await fetch(fileUrl.href);
  if (!res.ok) throw new Error('national traits HTTP ' + res.status);
  cache = await res.json();
  return cache;
}

function clampStab(n, fallback = 72) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(100, v));
}

function applyLayer(profile, layer) {
  if (!layer) return profile;
  const next = { ...profile, traits: profile.traits.slice() };
  if (layer.regime) next.regime = layer.regime;
  if (layer.baseStability != null) next.baseStability = clampStab(layer.baseStability, profile.baseStability);
  if (Array.isArray(layer.traits)) next.traits = layer.traits.slice();
  if (layer.note) next.note = layer.note;
  return next;
}

export function resolveCountryProfile(catalog, stageName, country, scenarioOverride) {
  const id = country?.id;
  const flag = country?.flag || id;
  const defaults = catalog?.defaults || {};
  let profile = {
    regime: defaults.regime || 'authoritarian',
    baseStability: clampStab(defaults.baseStability, 72),
    traits: Array.isArray(defaults.traits) ? defaults.traits.slice() : [],
    note: defaults.note || '',
  };
  profile = applyLayer(profile, catalog?.countries?.[id] || catalog?.countries?.[flag]);
  profile = applyLayer(profile, catalog?.scenarios?.[stageName]?.[id]);
  profile = applyLayer(profile, scenarioOverride?.[id]);
  return profile;
}

export function traitDef(catalog, country, name) {
  if (!country?.traits?.includes(name)) return null;
  return catalog?.traits?.[name] || null;
}

export function declareTuning(catalog, country) {
  const exp = traitDef(catalog, country, 'expansionist');
  const weary = traitDef(catalog, country, 'war_weary');
  const neutral = traitDef(catalog, country, 'permanent_neutral');
  const base = {
    neverDeclare: !!(neutral && neutral.neverDeclare !== false),
    expansionist: !!exp,
    warWeary: !!weary,
    powerRatio: 1.35,
    directionRatio: 1.0,
    relaxedPowerRatio: 1.35,
    relaxedDirectionRatio: 1.0,
    cooldownDelta: 0,
    minStabilityDelta: 0,
    maxMajorBonus: 0,
  };
  if (base.neverDeclare) return base;
  const src = exp || weary;
  if (!src) return base;
  return {
    neverDeclare: false,
    expansionist: !!exp,
    warWeary: !!weary,
    powerRatio: src.powerRatio != null ? Math.max(1.1, src.powerRatio * 0.8) : base.powerRatio,
    directionRatio: src.directionRatio != null ? Math.max(0.9, src.directionRatio * 0.85) : base.directionRatio,
    relaxedPowerRatio: src.relaxedPowerRatio ?? base.relaxedPowerRatio,
    relaxedDirectionRatio: src.relaxedDirectionRatio ?? base.relaxedDirectionRatio,
    cooldownDelta: src.cooldownDelta || 0,
    minStabilityDelta: src.minStabilityDelta || 0,
    maxMajorBonus: src.maxMajorBonus || 0,
  };
}

export function ordinaryDeclareMultiplier(catalog, country) {
  let mul = 1;
  const exp = traitDef(catalog, country, 'expansionist');
  const weary = traitDef(catalog, country, 'war_weary');
  if (exp?.declareStabilityMul) mul *= exp.declareStabilityMul;
  if (weary?.declareStabilityMul) mul *= weary.declareStabilityMul;
  return mul;
}

export function attackedRallySpec(catalog, country) {
  const rally = traitDef(catalog, country, 'rally');
  const neutral = traitDef(catalog, country, 'permanent_neutral');
  const src = rally || neutral;
  if (!src || src.stabilityOnAttacked == null) return null;
  return {
    stability: src.stabilityOnAttacked,
    incomeBonus: src.incomeBonus || 0,
    incomeTurns: src.incomeTurns || 0,
  };
}

export function peaceTuning(catalog, country) {
  const profile = resolveCountryProfile(catalog, null, country);
  const regime = profile?.regime;
  const traits = profile?.traits || [];
  let lossThreshold = 0.15;
  let powerRatioThreshold = 0.50;

  if (regime === 'democracy' || traits.includes('war_weary')) {
    lossThreshold = 0.10;
    powerRatioThreshold = 0.65;
  } else if (regime === 'totalitarian' || traits.includes('iron_fist') || traits.includes('expansionist')) {
    lossThreshold = 0.25;
    powerRatioThreshold = 0.35;
  }
  return { lossThreshold, powerRatioThreshold, regime, traits };
}
