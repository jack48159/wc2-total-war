// Opponent Country Profile Identification System
// Analyzes military, economic, and strategic-geographical capabilities of belligerents.

import { World } from '../../../world.js';
import { getDiplomaticRelation, DIPLOMACY_STATE, countryPower } from '../../../rules/diplomacy.js';

const ARMOUR_TYPES = new Set(['panzer', 'tank', 'heavytank']);
const NAVY_TYPES = new Set(['destroyer', 'cruiser', 'battleship', 'aircraftcarrier']);

/**
 * Identifies the comprehensive strategic profile and traits of a country.
 *
 * @param {object} game - Active Game instance
 * @param {string|object} countryOrId - Country identifier (e.g. 'de', 'ru', 'gb') or country object
 * @returns {object|null} Detailed country profile with military, economic, and geographical dimensions
 */
export function identifyCountryProfile(game, countryOrId) {
  if (!game?.stage) return null;
  const cid = typeof countryOrId === 'string' ? countryOrId : (countryOrId?.id || countryOrId);
  if (!cid) return null;

  const st = game.stage;
  const cInfo = st.countries?.get(cid) || (st.data?.countries || []).find(c => c.id === cid);
  if (!cInfo) return null;

  const isPlayer = cid === game.player;
  const moneyStock = isPlayer ? game.money : (cInfo.money || 0);
  const indStock = isPlayer ? game.industry : (cInfo.industry || 0);
  const inc = game.income ? game.income(cid) : { money: 0, industry: 0 };
  const moneyIncome = inc?.money || 0;
  const indIncome = inc?.industry || 0;

  // 1. Territories & Geopolitics
  const allOwnedAreas = st.areas.filter(a => a.country === cid);
  const landAreas = allOwnedAreas.filter(a => !a.sea);
  const landIds = new Set(landAreas.map(a => a.id));

  // Connected territorial components (clusters)
  const visited = new Set();
  let clusters = 0;
  for (const a of landAreas) {
    if (visited.has(a.id)) continue;
    clusters++;
    const queue = [a.id];
    visited.add(a.id);
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const nid of (st.adjE?.get(cur) || [])) {
        if (landIds.has(nid) && !visited.has(nid)) {
          visited.add(nid);
          queue.push(nid);
        }
      }
    }
  }

  // Border exposure: sea perimeter vs adjacent land foreign neighbors
  let seaBorders = 0;
  let foreignLandBorders = 0;
  let mountainCount = 0;
  let citiesCount = 0;
  let industriesCount = 0;
  let fortCount = 0;
  let totalResourceValue = 0;

  for (const a of landAreas) {
    const wa = World?.areas?.[a.id] || {};
    const tax = wa.tax || 0;
    const ind = wa.industry || 0;
    const isCity = a.construction === 'city' || [1, 3, 4].includes(a.areaType);
    const isInd = a.construction === 'industry' || a.installation === 'industry';
    if (isCity) citiesCount++;
    if (isInd) industriesCount++;
    if (a.installation === 'fort' || a.installation === 'entrenchment') fortCount++;
    if (wa.movementCost > 1) mountainCount++;

    totalResourceValue += tax * 2 + ind * 5 + (isCity ? 15 : 0) + (isInd ? 20 : 0);

    for (const nid of (st.adjE?.get(a.id) || [])) {
      const na = st.st(nid);
      if (na?.sea) {
        seaBorders++;
      } else if (na && na.country !== cid) {
        foreignLandBorders++;
      }
    }
  }

  const totalPerimeter = seaBorders + foreignLandBorders;
  const seaRatio = totalPerimeter > 0 ? seaBorders / totalPerimeter : 0;
  const isIsland = (foreignLandBorders === 0 && landAreas.length > 0) || seaRatio >= 0.85;
  const isMountainous = (mountainCount / Math.max(1, landAreas.length)) >= 0.28 || cid === 'ch';
  const isDispersed = clusters > 1;
  const avgResourceValue = landAreas.length > 0 ? totalResourceValue / landAreas.length : 0;

  // 2. Military Units & Armed Strength
  const allArmies = allOwnedAreas.flatMap(a => a.armies || []);
  const armyCount = allArmies.length;
  const totalHp = allArmies.reduce((sum, u) => sum + (u.hp || 50), 0);

  const armorUnits = allArmies.filter(u => ARMOUR_TYPES.has(u.type));
  const armorCount = armorUnits.length;
  const armorRatio = armyCount > 0 ? armorCount / armyCount : 0;

  const navyUnits = allArmies.filter(u => NAVY_TYPES.has(u.type));
  const navyCount = navyUnits.length;
  const navyRatio = armyCount > 0 ? navyCount / armyCount : 0;

  const airports = landAreas.filter(a => a.construction === 'airport' || a.installation === 'airport').length;
  const carriers = allArmies.filter(u => u.type === 'aircraftcarrier').length;
  const airPowerScore = airports * 2 + carriers * 3;

  // Manpower & Population traits
  const catalog = st.data?.traitCatalog;
  const hasPopTrait = Boolean(
    (cInfo.traits || []).includes('population') ||
    (catalog?.countries?.[cid]?.traits || []).includes('population')
  );

  // 3. Trait Dimension Classifications
  // 兵源充足度
  const isManpowerPower = Boolean(
    hasPopTrait || landAreas.length >= 40 || armyCount >= 22 || totalHp >= 1800
  );
  const manpowerLevel = (isManpowerPower || armyCount >= 20) ? 'high' : (armyCount >= 8 ? 'medium' : 'low');

  // 装甲能力
  const isArmorPower = armorCount >= 6 || (armorRatio >= 0.35 && armorCount >= 3);
  const armorLevel = isArmorPower ? 'high' : (armorCount >= 2 ? 'medium' : 'low');

  // 海军能力
  const isNavalPower = navyCount >= 2 || carriers >= 1 || (isIsland && navyCount >= 1) || navyRatio >= 0.18;
  const navyLevel = navyCount >= 3 || carriers >= 1 ? 'strong' : (navyCount >= 1 ? 'moderate' : 'none');

  // 空军能力
  const isAirPower = airPowerScore >= 4 || airports >= 2 || carriers >= 1;
  const airLevel = airPowerScore >= 4 ? 'strong' : (airPowerScore >= 2 ? 'moderate' : 'weak');

  // 经济/工业产能
  const isIndustrialPower = (indIncome >= 35 || indStock >= 150 || (armorRatio >= 0.35 && indIncome >= 25));
  const industryLevel = indIncome >= 40 || indStock >= 160 ? 'strong' : (indIncome >= 18 || indStock >= 80 ? 'moderate' : 'weak');
  const moneyLevel = moneyIncome >= 250 || moneyStock >= 300 ? 'rich' : (moneyIncome >= 100 || moneyStock >= 100 ? 'medium' : 'poor');

  // 式微国家判定 (兵力<30，工业<50)
  const pPower = countryPower(game, cid).power;
  const isWeak = (pPower < 30 || totalHp < 30 || (totalHp < 60 && armyCount <= 1)) &&
    (indStock < 50 && indIncome < 15);

  // Primary categorization & tags
  const tags = [];
  if (isIndustrialPower) tags.push('industrial');
  if (isManpowerPower) tags.push('manpower');
  if (isNavalPower) tags.push('naval');
  if (isArmorPower) tags.push('armored');
  if (isWeak) tags.push('weak');

  let primaryType = 'balanced';
  if (isWeak) {
    primaryType = 'weak';
  } else if (isIndustrialPower && (armorRatio >= 0.35 || indIncome >= 45)) {
    primaryType = 'industrial';
  } else if (isManpowerPower && landAreas.length >= 35) {
    primaryType = 'manpower';
  } else if (isNavalPower && (isIsland || navyCount >= 2)) {
    primaryType = 'naval';
  } else if (isIndustrialPower) {
    primaryType = 'industrial';
  } else if (isManpowerPower) {
    primaryType = 'manpower';
  } else if (isNavalPower) {
    primaryType = 'naval';
  }

  const cName = cInfo.name || cid;

  return {
    countryId: cid,
    name: cName,
    profile: {
      isIndustrialPower,
      isManpowerPower,
      isNavalPower,
      isArmorPower,
      isAirPower,
      isWeak,
      primaryType,
      tags,
      summary: `${cName} [${primaryType}] - 工业:${industryLevel}, 兵源:${manpowerLevel}, 海军:${navyLevel}, 地理:${isIsland ? '海岛' : (isMountainous ? '山区' : (isDispersed ? '分散' : '集中'))}`,
    },
    military: {
      armyCount,
      totalHp,
      totalPower: pPower,
      manpower: {
        level: manpowerLevel,
        hasPopTrait,
        isManpowerPower,
      },
      armor: {
        level: armorLevel,
        count: armorCount,
        ratio: armorRatio,
        isArmorPower,
      },
      navy: {
        level: navyLevel,
        count: navyCount,
        ratio: navyRatio,
        isNavalPower,
      },
      air: {
        level: airLevel,
        airports,
        carriers,
        airPowerScore,
        isAirPower,
      },
    },
    economy: {
      industry: {
        level: industryLevel,
        stock: indStock,
        income: indIncome,
        isIndustrialPower,
      },
      money: {
        level: moneyLevel,
        stock: moneyStock,
        income: moneyIncome,
      },
      resourceValue: {
        totalValue: totalResourceValue,
        avgValuePerLand: avgResourceValue,
        citiesCount,
        industriesCount,
        fortCount,
      },
    },
    geography: {
      landCount: landAreas.length,
      clusters,
      dispersion: isDispersed ? 'dispersed' : 'concentrated',
      isDispersed,
      isIsland,
      isMountainous,
      seaRatio,
      naturalBarrier: isIsland || isMountainous,
    },
  };
}
