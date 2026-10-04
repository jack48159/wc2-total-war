// General Staff Parameter Definitions and Overrides (V2 Architecture)
// Consolidates all general staff level magic numbers across staff modules.
// Supports WC2_PARAMS environment variable JSON overrides.

export const STAFF_P = {
  // --- Order Allocation (allocate.js) ---
  maxCandidateOrders: 6,            // Maximum candidate orders evaluated per turn
  staffRho: 0.5,                    // Risk aversion coefficient baseline rho
  hysteresisDeltaAbs: 15.0,         // Absolute hysteresis delta threshold for order replacement
  hysteresisDeltaRel: 0.15,         // Relative hysteresis delta ratio for order replacement
  orderExpires: 3,                  // Default order duration in turns before expiration
  allocateBudgetMs: 60,             // Soft timeout budget for order allocation phase in ms
  defendPLoseThreshold: 0.05,       // Threat threshold triggering defend candidate orders
  delayPLoseThreshold: 0.65,        // Threat threshold triggering delay candidate orders
  screenPLoseThreshold: 0.25,       // Threat threshold triggering screen candidate orders
  concentrateScore: 20,             // Fallback concentrate order base utility score

  // --- Strategic Posture & Front Analysis (strategy.js) ---
  postureAttackRatio: 1.25,         // Power ratio threshold defaulting to offensive posture
  postureDefendRatio: 0.75,         // Power ratio threshold defaulting to defensive posture
  minFrontPower: 1.0,               // Minimum front combat power floor to avoid division by zero
  captureProbabilityScale: 0.5,     // Scaling factor converting power ratio to capture probability
  captureProbabilityFloor: 0.2,     // Minimum floor for capture probability estimate
  terrainFortBonus: 2,              // Terrain score bonus for fort
  terrainEntrenchmentBonus: 1,      // Terrain score bonus for entrenchment
  terrainCityBonus: 1,              // Terrain score bonus for city

  // --- Army Group Organization (organize.js) ---
  maxGroupsPerCountry: 4,           // Maximum army groups allowed per country
  maxUnitsPerGroup: 16,             // Maximum combat units in a single army group
  reorganizeFitRatio: 0.15,         // Relative fit improvement ratio required to reorganize
  minReorganizeFitImprovement: 15.0,// Absolute minimum fit improvement for reorganization
  maxReorganizeCommandsPerTurn: 12, // Maximum reorganization commands issued in a single turn
  groupRecruitDistance: 2,          // BFS radius from frontline to recruit units into army group
  autoOrganizeMinUnits: 3,          // Minimum unassigned units required to form an army group
  autoOrganizeClusterDist: 4,       // Max geographic distance for simple unit clustering
  autoOrganizeMaxClusterDist: 10,   // Max adaptive distance ceiling for sparse unit clustering
  autoOrganizeDistStep: 2,          // Adaptive distance step increment
  autoOrganizeMaxGroups: 4,         // Max army groups to auto form per country
  autoOrganizeMaxTheaters: 4,       // Max theaters per country
  armourClusterDist: 6,             // Initial clustering distance for high-mobility armour
  armourGroupMinArmour: 3,          // Minimum armour units to form an armour cluster
  armourGroupMaxSupport: 2,         // Max support non-armour units in armour cluster
  navalClusterDist: 6,              // Initial clustering distance for dispersed naval units
  navalGroupMinUnits: 2,            // Minimum naval units to form a naval group
  navalGroupMaxUnits: 8,            // Max naval units in naval group

  // --- Production & Investment (produce.js) ---
  // 投资策略配置：短局 (shortBattleInvestmentPolicy) 与长局/征服 (longBattleInvestmentPolicy)
  // 现在默认均采用 'legacy_noContact' (旧逻辑的投资选择方式 + 禁止接触线 depth 0 投资，即 V7 策略)；
  // 若需退回之前的受限新逻辑，将对应配置项修改为 'constrained'。
  shortBattleInvestmentPolicy: 'legacy_noContact', // Short battle investment policy: 'legacy_noContact' (default V7) | 'constrained' (previous new logic)
  longBattleInvestmentPolicy: 'legacy_noContact',  // Long battle (conquest) investment policy: 'legacy_noContact' (default V7) | 'constrained' (previous new logic)
  economicLegacy: false,            // Evaluation switch: when true, bypass round-1 constraints and restore legacy investment behavior
  legacyMinDepth: 0,                // Min frontline depth for legacy economic investment (0 = unconstrained, 1 = non-contact)
  legacyPaybackGate: false,         // Gate legacy economic investment in short battles by payback ROI (default false)
  reserveTurns: 0.5,                // Default turns of emergency reserve to hold back
  maxReserveMoneyFraction: 0.3,     // Maximum fraction of wallet money locked by emergency reserve
  endangeredSpendEnabled: true,      // Emergency recruitment for small countries whose capital is under attack
  endangeredMaxLandAreas: 8,
  endangeredMaxUnits: 12,
  endangeredMinMoneyIncomeRatio: 1.0,
  emergencyDefensePLose: 0.4,       // Critical loss probability triggering emergency garrison
  investmentHorizonTurns: 8,        // Planning horizon for economic payback calculation (short battles)
  investmentHorizonLongTurns: 25,   // Planning horizon for economic payback in conquest/long battles (totalRounds == null)
  minInvestmentRoi: 1.1,            // Minimum ROI threshold to justify construction over military
  minInvestmentRoiShort: 1.0,       // Minimum ROI threshold for short battles (回本即可投，中后方红线不变)
  paybackSafetyMargin: 0,           // Safety turns deducted from remaining rounds (R - margin >= payback)
  minEconomicDepth: 2,              // Minimum BFS depth from frontline for economic investment (mid/rear only)
  maxEconomicPLose: 0.20,           // Maximum allowed pLose for economic investment
  maxEconomicBudgetFractionShort: 0.20, // Max economic investment budget fraction in short battles
  maxEconomicBudgetFractionLong: 0.45,  // Max economic investment budget fraction in long/conquest games
  maxTurnCities: 2,                 // Maximum city upgrades executed per turn across all steps (short battles)
  maxTurnIndustries: 1,             // Maximum industry upgrades executed per turn across all steps (short battles)
  maxTurnAirports: 1,               // Maximum airport constructions executed per turn across all steps (short battles)
  maxTurnCitiesLong: 4,             // Maximum city upgrades executed per turn across all steps (long battles)
  maxTurnIndustriesLong: 2,         // Maximum industry upgrades executed per turn across all steps (long battles)
  maxTurnAirportsLong: 2,           // Maximum airport constructions executed per turn across all steps (long battles)
  cityIncomeTurnValue: 5,           // Base money income per turn provided by city level (+1)
  cityAuxTurnValue: 2.5,            // Auxiliary value per turn for city (recruitment tier, garrison rest, stability)
  industryTurnValue: 7.5,           // Economic equivalent value per turn for industry level (+5 industry points)
  industryCostWeight: 1.5,          // Money equivalent conversion weight for 1 industry point spent
  airportTurnTacticalValue: 10.0,   // Estimated tactical value per turn if airport covers unserved frontline
  economicCriticalPLoseLimit: 0.35, // Average country pLose threshold above which economic investment pauses

  // --- Diplomacy (diplomacy.js) ---
  stabilityCreditValue: 16.0,       // Weight converting 1 stability point into economy/credit value
  warDeclarationGainCostRatio: 1.25,// Minimum gain-to-cost ratio to sanction war declaration

  // --- Casualty Rest & Evacuation (br_rest) ---
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
  // --- Global Force Allocation & Cross-Theater Coordination ---
  mainEffortRecruitBias: 0.75,      // Weight bias for recruitment staging on main effort
  emergencySupportPLose: 0.45,      // PLose threshold triggering cross-theater emergency support

  // --- AI Force Concentration (AIFC, No Step Back style) ---
  aifcEnabled: false,               // Master toggle for AIFC (default false until proven by SPRT)
  aifcEnableBestUnitSelection: true,// Ablation 1: select best units for strike group
  aifcEnableTargetValuation: true,  // Ablation 2: strategic target valuation vs depthTargets[0]
  aifcEnablePathPlanning: true,     // Ablation 3: path planning along weak axes
  aifcEnableHoldRequirement: true,  // Ablation 4: compute hold requirements before concentration
  aifcEnableCommitment: true,       // Ablation 5: commitment & state machine anti-oscillation

  aifcTopKFronts: 3,                // Top K fronts by value to evaluate hold & concentration
  aifcHoldPLoseThreshold: 0.25,     // Threat pLose threshold to suppress hold requirement below
  aifcMinStrikeGroupUnits: 2,       // Minimum surplus units required to form a strike group (lowered from 3 to 2 for smaller tactical fronts)
  aifcMaxStrikeGroupUnits: 6,       // Maximum units allocated to a single strike group
  aifcRearUnitSearchRadius: 2,      // Maximum hops behind front to scan for available mobile reserve units
  aifcWeightAttack: 1.2,            // Unit selection: attack power weight
  aifcWeightArmor: 1.5,             // Unit selection: armor / breakthrough bonus
  aifcWeightHp: 1.0,                // Unit selection: current HP ratio weight
  aifcWeightLevel: 0.8,             // Unit selection: unit rank / experience weight
  aifcWeightMobility: 0.8,          // Unit selection: mobility speed weight
  aifcWeightDistance: 0.5,          // Unit selection: distance penalty per hop to staging

  aifcSearchRadius: 4,              // BFS search depth from front for strategic targets
  aifcValWeightCity: 2.0,           // Target value: city tier weight
  aifcValWeightIndustry: 2.5,       // Target value: industrial capacity weight
  aifcValWeightCapital: 5.0,        // Target value: capital weight
  aifcValWeightChokepoint: 1.8,     // Target value: chokepoint / hub connectivity weight
  aifcValWeightEncircle: 2.2,       // Target value: encirclement vulnerability weight
  aifcValWeightDefensePenalty: 0.8, // Target value: enemy defense power penalty
  aifcValWeightPLoseBonus: 1.5,     // Target value: vulnerability / attack feasibility bonus

  aifcMaxPathLength: 8,             // Maximum hops for operational path planning
  aifcGatherDistThreshold: 2,       // Distance threshold distinguishing gather vs strike phase
  aifcHysteresisSwitchRatio: 1.35,  // Utility ratio required to switch active target (hysteresis)
  aifcCommitmentMaxTurns: 4,        // Maximum turns to commit before re-evaluating

  // --- Stack Front Strategy (stack_front.js) ---
  stackFrontEnabled: true,          // Master switch for defensive stack front reorganization
  stackFrontHpWeight: 1.0,          // Current HP weight in front candidate evaluation
  stackFrontHpRatioWeight: 40.0,    // Health ratio (hp/maxHp) weight (penalizes critical low-hp front)
  stackFrontDefenceWeight: 35.0,    // Effective defence weight (each defence point reduces damage per die)
  stackFrontCounterWeight: 15.0,    // Counter-attack damage capability weight
  stackFrontArmourBonus: 25.0,      // Armour unit toughness bonus against direct attackers
  stackFrontPreciousPenalty: 70.0,  // Penalty for exposing fragile/precious units (artillery, rocket, carrier)
  stackFrontMinImprovement: 10.0,   // Minimum score gap required to switch front (hysteresis anti-jitter)
};

/**
 * Loads staff parameters overridden by process.env.WC2_PARAMS JSON object if present.
 * Validates types and filters known staff parameter keys safely.
 */
export function loadStaffOverrides() {
  const raw = globalThis.process?.env?.WC2_STAFF_PARAMS || globalThis.process?.env?.WC2_PARAMS;
  if (!raw) return { ...STAFF_P };
  let overrides;
  try {
    overrides = JSON.parse(raw);
  } catch {
    return { ...STAFF_P };
  }
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return { ...STAFF_P };
  }
  const result = { ...STAFF_P };
  for (const [key, value] of Object.entries(overrides)) {
    if (key in STAFF_P && (
      (typeof value === 'number' && Number.isFinite(value)) ||
      typeof value === 'boolean' ||
      typeof value === 'string'
    )) {
      result[key] = value;
    }
  }
  for (const [key, value] of Object.entries(result)) {
    STAFF_P[key] = value;
  }
  return result;
}

// Auto-apply environment overrides on load
loadStaffOverrides();

/*
================================================================================
【上线采用预设指南 / One-Click Adoption Guide】
供 PM 经用户/制作人同意后一键切换默认值（当前保持默认未改动）：

方案 A（纯 V7 方案 - 仅禁止接触线投资，已通过 640 局完整评测，战力与真实胜率显著为正）：
  在上方 STAFF_P 中将以下两项改为：
    economicLegacy: true,
    legacyMinDepth: 1,

方案 B（V8 方案 - 禁接触线 + 短局回本门禁，消除短局残局来不及回本的浪费投资）：
  在上方 STAFF_P 中将以下三项改为：
    economicLegacy: true,
    legacyMinDepth: 1,
    legacyPaybackGate: true,

注意：切换上述默认值后无需改动任何其它业务逻辑，对长局/征服局行为无副作用。
================================================================================
*/
