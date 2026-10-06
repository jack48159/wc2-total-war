// Doctrine Mapping Module (V2 §6 & WP DIP)
// Reads data/ai_doctrines.json by country flag and scenario year,
// mapping them to V2 §6 General Staff and Tactical engine parameters.
// Strictly zero hard-coded country codes, stage names, or area IDs.

let fsModule = null;
if (typeof process !== 'undefined' && process.versions?.node) {
  try {
    fsModule = await import('node:fs');
  } catch (e) {}
}

let codexParams = {};
try {
  const pMod = await import('./params.js');
  codexParams = pMod || {};
} catch (e) {
  // params.js is owned by Codex-A and may not exist yet
}

let _doctrineDataCache = null;

// Baseline default parameters (V2 §6)
export const DEFAULT_DOCTRINE_PARAMS = {
  // General Staff parameters (总参参数)
  concentration: 0.45,
  rhoBase: 1.15,
  rho: 1.15,
  reserveTurns: 2.0,
  initiative: 0.5,
  unitMix: {
    infantry: 0.5,
    armor: 0.15,
    artillery: 0.2,
    rocket: 0.05,
    elite: 0.1,
    navy: 0.05,
  },
  horizon: 3,

  // Tactical parameters (战术参数)
  attritionTolerance: 0.4,
  tempo: 0.5,
  fortifyBias: 0.6,

  // Raw parameter bag
  raw: {},
};

/**
 * Loads ai_doctrines.json synchronously or from cache
 */
function getDoctrinesData() {
  if (_doctrineDataCache) return _doctrineDataCache;
  if (typeof globalThis !== 'undefined' && globalThis.__aiDoctrines) {
    _doctrineDataCache = globalThis.__aiDoctrines;
    return _doctrineDataCache;
  }
  if (fsModule && fsModule.readFileSync) {
    try {
      const fileUrl = typeof document !== 'undefined' ? new URL('data/ai_doctrines.json', document.baseURI) : new URL('../../../../../data/ai_doctrines.json', import.meta.url);
      const text = fsModule.readFileSync(fileUrl, 'utf8');
      _doctrineDataCache = JSON.parse(text);
      return _doctrineDataCache;
    } catch (e) {}
  }
  return null;
}

if (typeof fetch === 'function') {
  fetch('data/ai_doctrines.json')
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) _doctrineDataCache = d; })
    .catch(() => {});
}

/**
 * Resolves scenario year dynamically from scenario data or metadata
 */
function resolveScenarioYear(game, doctrinesData) {
  const stage = game?.stage;
  const stageName = stage?.name || stage?.data?.name || game?.name;

  if (doctrinesData?.scenarios && stageName && doctrinesData.scenarios[stageName]?.year) {
    return doctrinesData.scenarios[stageName].year;
  }
  if (typeof stage?.data?.year === 'number') return stage.data.year;
  if (typeof stage?.year === 'number') return stage.year;
  if (typeof game?.year === 'number') return game.year;

  // Fallback to doctrines selection default or 1939
  return doctrinesData?.selection?.validYearMin || 1939;
}

/**
 * Returns mapped doctrine parameters for the given game and country.
 *
 * @param {object} game - Game instance
 * @param {string} country - Country identifier
 * @returns {object} Mapped engine parameters conforming to V2 §6
 */
export function doctrineFor(game, country) {
  const data = getDoctrinesData();
  const defRaw = data?.default?.parameters || {};

  const stage = game?.stage;
  const countryInfo = stage?.countries?.get(country);
  const flag = countryInfo?.flag || country;

  let rawParams = { ...defRaw };

  if (data) {
    const year = resolveScenarioYear(game, data);
    const countryEntry = data.countries?.[flag];

    if (countryEntry?.periods && Array.isArray(countryEntry.periods)) {
      for (const p of countryEntry.periods) {
        if (year >= p.fromYear && year < p.toYearExclusive) {
          if (p.parameters) {
            rawParams = { ...rawParams, ...p.parameters };
          }
          break;
        }
      }
    } else if (countryEntry?.parameters) {
      rawParams = { ...rawParams, ...countryEntry.parameters };
    }
  }

  // Map raw parameters to V2 §6 engine coefficients
  const concentration = rawParams.concentration ?? DEFAULT_DOCTRINE_PARAMS.concentration;
  const initiative = rawParams.initiative ?? DEFAULT_DOCTRINE_PARAMS.initiative;

  // rhoBase: risk aversion baseline on expected losses (higher initiative/tolerance -> lower risk aversion)
  const rhoBase = +(1.6 - initiative * 0.8).toFixed(2);
  const reserveVal = rawParams.reserve ?? 0.3;
  const reserveTurns = +(1.0 + reserveVal * 3.0).toFixed(1);

  const exploitation = rawParams.exploitation ?? 0.4;
  const horizon = Math.max(1, Math.round(2 + exploitation * 3));

  const attritionTolerance = rawParams.attritionTolerance ?? DEFAULT_DOCTRINE_PARAMS.attritionTolerance;
  const tempo = +(initiative * 0.6 + exploitation * 0.4).toFixed(2);
  const fortifyBias = +(rawParams.fortification ?? DEFAULT_DOCTRINE_PARAMS.fortifyBias).toFixed(2);

  const unitMix = rawParams.targetUnitMix
    ? { ...rawParams.targetUnitMix }
    : { ...DEFAULT_DOCTRINE_PARAMS.unitMix };

  return {
    // Aligned with Codex-A params if exported
    ...codexParams,

    // General Staff parameters (总参参数)
    concentration,
    rhoBase,
    rho: rhoBase,
    reserveTurns,
    initiative,
    unitMix,
    horizon,

    // Tactical parameters (战术参数)
    attritionTolerance,
    tempo,
    fortifyBias,

    // Raw parameters preserved for potential extension
    raw: rawParams,
  };
}
