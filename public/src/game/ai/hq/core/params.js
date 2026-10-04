export const P = Object.freeze({
  attackMovement: 1, fieldWeight: 0.12, fieldDecay: 0.72,
  killWeight: 0.45, damageWeight: 0.55, deathWeight: 0.5,
  defenceWeight: 1, captureThreshold: 0.85,
  constructionWeight: 0.1,
  attackScale: 0.65, damageScale: 0.55, counterScale: 0.5,
  refuseSuccess: 0.35, refuseRisk: 0.7, overreachThreshold: 0.08,
  retreatBase: 0.65,
  supportPinWeight: 0.25, supportCutWeight: 0.2,
  supportFlankWeight: 0.3, supportSoftenWeight: 0.2,
  supportDivertWeight: 0.15, supportAttritionWeight: 0.1,
  breakthroughDepthWeight: 0.3, breakthroughMobilityWeight: 0.15,
  counterattackExposureWeight: 0.35, delayLossLimit: 0.5,
  screenLossLimit: 0.25,
  threatObjectiveThreshold: 0.25, withdrawMaxRisk: 0.8,
  personalityNeutral: 0.5, disciplineExtremeFactor: 0.5,
  refusalCautionScale: 0.2, packageDeviationRelative: 0.5,
  packageDeviationHpFloor: 10, retreatCautionScale: 0.2,
  retreatCasualtyThreshold: 0.3, stalledCasualtyThreshold: 0.5,
  stalledThreatThreshold: 0.25, fieldDecayMin: 0.35,
  fieldDecayMax: 0.95, fieldTempoStep: 0.1, defaultPLose: 0.1,
  // --- 坦克斩杀链与炮兵安全开火 (br_exploit) 参数 ---
  tankKillChainBonus: 0.4, artillerySafeRiskScale: 0, artillerySafeBonus: 0.25,
  // --- 伤兵后送休整 (br_rest) 参数 ---
  restEnableInfantry: 1,
  restEnableHeavy: 1,
  restExcludeArtillery: 1,
  restInfantryHpRatio: 0.18,
  restHeavyHpRatio: 0.40,
  restCityMinLevel: 1,
  restIndustryMinLevel: 1,
  restMaxHops: 6,
  restPriorityBonus: 200,
  restSafetyWeight: 50,
  // --- 自动编组与专精匹配参数 ---
  armourClusterDist: 6,
  navalClusterDist: 6,
  autoOrganizeMaxClusterDist: 10,
  autoOrganizeDistStep: 2,
  armourGroupMinArmour: 3,
  armourGroupMaxSupport: 2,
  navalGroupMinUnits: 2,
  navalGroupMaxUnits: 8,
  autoOrganizeClusterDist: 4,
  autoOrganizeMinUnits: 3,
  autoOrganizeMaxGroups: 4,
});

export const REST_INFANTRY_TYPES = new Set(['infantry', 'eliteinfantry']);
export const REST_EXCLUDE_TYPES = new Set(['artillery', 'rocket']);
export const REST_HEAVY_TYPES = new Set(['panzer', 'armour', 'tank', 'heavytank']);

export function loadOverrides() {
  const raw = globalThis.process?.env?.WC2_PARAMS;
  if (!raw) return { ...P };
  let overrides;
  try { overrides = JSON.parse(raw); } catch { throw new Error('WC2_PARAMS must be valid JSON'); }
  if (!overrides || Array.isArray(overrides) || typeof overrides !== 'object')
    throw new Error('WC2_PARAMS must be a JSON object');
  const result = { ...P };
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in P)) throw new Error(`Unknown WC2_PARAMS key: ${key}`);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid WC2_PARAMS value: ${key}`);
    result[key] = value;
  }
  return result;
}
