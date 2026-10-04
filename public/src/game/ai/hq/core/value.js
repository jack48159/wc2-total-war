// Value estimation for areas and units.
// Currency: credit (gold-equivalent value).

// --- Named Constants with Explanations ---

// Default planning horizon (in turns) for discounting territorial income
export const DEFAULT_HORIZON = 8;
// Estimated default remaining war duration if not specified
export const DEFAULT_REMAINING_WAR_TURNS = 15;
// Turn-over-turn survival discount rate for held territory
export const AREA_SURVIVAL_DISCOUNT = 0.92;
// Base credit assigned to any land/sea area for holding territorial space
export const BASE_AREA_CREDIT = 10;
// Massive strategic value for capital territories (prevents capitulation and morale collapse)
export const CAPITAL_EXTRA_VALUE = 300;
// Premium per level of industrial facility (enables building heavier combat units)
export const INDUSTRY_CAPABILITY_PER_LEVEL = 25;
// Premium per level of urban center (enables city militia and card utilities)
export const CITY_CAPABILITY_PER_LEVEL = 15;
// Premium for airbase installations granting air superiority projection
export const AIRPORT_CAPABILITY_VALUE = 40;
// Weight multiplier for each friendly rear territory disconnected if this area is lost
export const CHOKEPOINT_DISCONNECTED_AREA_WEIGHT = 20;

// Unit baseline value fraction retained even at near-zero HP (for soaking fire / pinning)
export const UNIT_MIN_VALUE_RATIO = 0.35;
// Weight of remaining HP percentage in unit valuation
export const UNIT_HP_WEIGHT = 0.65;
// Value increase per veteran rank level (15% per rank)
export const UNIT_LEVEL_BONUS_PER_RANK = 0.15;
// Default unit scarcity factor
export const UNIT_DEFAULT_SCARCITY = 1.0;
// Default industrial-to-gold exchange weight if model.wI is omitted
export const DEFAULT_WI_ESTIMATE = 1.5;

// Cache for chokepoint calculations within a model turn
const chokepointCache = new WeakMap();

function getChokeCache(model) {
  let cache = chokepointCache.get(model);
  if (!cache) {
    cache = new Map();
    chokepointCache.set(model, cache);
  }
  return cache;
}

/**
 * Cheap estimation of strategic chokepoint importance:
 * Number of friendly rear areas disconnected from all front lines if this area is lost.
 */
export function chokepointValue(model, areaId) {
  const cache = getChokeCache(model);
  if (cache.has(areaId)) return cache.get(areaId);

  const st = model.st;
  const myLandAreas = model.mine.filter(a => a.land);
  const myAreaIds = new Set(myLandAreas.map(a => a.id));

  // If this area is not even owned by me, evaluate based on its connectivity to friendly areas
  const isMine = myAreaIds.has(areaId);
  const frontIds = [];
  for (const a of myLandAreas) {
    if (a.id !== areaId && model.isFront(a.id)) {
      frontIds.push(a.id);
    }
  }

  // If there are no frontlines or only 1-2 territories, chokepoint impact is zero
  if (frontIds.length === 0 || myLandAreas.length <= 2) {
    cache.set(areaId, 0);
    return 0;
  }

  // BFS from all active front territories without passing through areaId
  const visited = new Set(frontIds);
  const queue = [...frontIds];

  while (queue.length > 0) {
    const curr = queue.shift();
    for (const next of st.adjE.get(curr) || []) {
      if (next === areaId || !myAreaIds.has(next) || visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }

  // Total mine land territories (excluding areaId if owned)
  const totalRelevant = isMine ? (myLandAreas.length - 1) : myLandAreas.length;
  const disconnected = Math.max(0, totalRelevant - visited.size);
  const val = disconnected * CHOKEPOINT_DISCONNECTED_AREA_WEIGHT;

  cache.set(areaId, val);
  return val;
}

/**
 * Computes the credit value of an area based on income, capabilities,
 * capital status, and strategic chokepoint value.
 */
export function areaValue(model, areaId, opts = {}) {
  const a = typeof areaId === 'number' ? model.area(areaId) : areaId;
  if (!a) return 0;
  const id = a.id;
  const horizon = opts.horizon ?? DEFAULT_HORIZON;
  const wI = model.wI ?? DEFAULT_WI_ESTIMATE;

  // 1. Base territorial value
  let val = BASE_AREA_CREDIT;

  // 2. Capital / victory condition value
  if (a.isCapital) {
    val += CAPITAL_EXTRA_VALUE;
  }

  // 3. Discounted present value of income
  const inc = a.income || { money: 0, industry: 0 };
  const roundIncome = inc.money + wI * inc.industry;
  const effectiveTurns = Math.min(horizon, DEFAULT_REMAINING_WAR_TURNS);
  const discountFactor = (1 - Math.pow(AREA_SURVIVAL_DISCOUNT, effectiveTurns)) / (1 - AREA_SURVIVAL_DISCOUNT);
  val += roundIncome * discountFactor;

  // 4. Production & military capability value
  const baseCity = a.areaType === 1 ? 3 : a.areaType === 3 ? 2 : a.areaType === 4 ? 1 : 0;
  const baseIndustry = a.areaType === 1 ? 2 : a.areaType === 3 ? 1 : 0;
  const cityLevel = Math.max(baseCity, a.construction === 'city' ? (a.level || 0) : 0);
  const indLevel = Math.max(baseIndustry, a.construction === 'industry' ? (a.level || 0) : 0);
  val += cityLevel * CITY_CAPABILITY_PER_LEVEL;
  val += indLevel * INDUSTRY_CAPABILITY_PER_LEVEL;
  if (a.construction === 'airport' || a.installation === 'airport') {
    val += AIRPORT_CAPABILITY_VALUE;
  }

  // 5. Strategic chokepoint value
  if (a.land) {
    val += chokepointValue(model, id);
  }

  return val;
}

/**
 * Computes the credit value of a unit based on its production cost,
 * current health ratio, veteran rank, and scarcity.
 */
export function unitValue(model, unit) {
  if (!unit) return 0;
  const u = unit.army || unit;
  const def = u.def || (model?.st?.armyDef ? model.st.armyDef(u.country || model.me, u.type) : {}) || {};
  const costMoney = u.cost?.money || def.price || def.cost?.money || 75;
  const costInd = u.cost?.industry || def.industry || def.cost?.industry || 0;
  const wI = model?.wI ?? DEFAULT_WI_ESTIMATE;
  const baseCost = costMoney + wI * costInd;

  const maxHp = unit.maxHp || u.maxHp || def.hp || 100;
  const hp = Math.max(0, unit.hp ?? u.hp ?? maxHp);
  const hpRatio = maxHp > 0 ? Math.min(1, hp / maxHp) : 1;
  const hpFactor = UNIT_MIN_VALUE_RATIO + UNIT_HP_WEIGHT * hpRatio;

  const level = Math.max(0, Math.min(4, Math.trunc(unit.level ?? u.level ?? 0)));
  const levelFactor = 1 + UNIT_LEVEL_BONUS_PER_RANK * level;

  const scarcity = UNIT_DEFAULT_SCARCITY;
  return baseCost * hpFactor * levelFactor * scarcity;
}
