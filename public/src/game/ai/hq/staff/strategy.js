// Strategic front analysis, Schwerpunkt (main effort) selection and global posture.

// --- Named Constants with Explanations ---
import { loadStaffOverrides, STAFF_P } from './params_staff.js';
import { identifyCountryProfile } from './profile.js';
import {
  getDiplomaticRelation,
  DIPLOMACY_STATE,
  countryPower,
} from '../../../rules/diplomacy.js';
import { rankDeclareWarTargets } from './diplomacy.js';

export { identifyCountryProfile };

// Backward-compatible named exports sourced from centralized STAFF_P
export const POSTURE_ATTACK_RATIO_THRESHOLD = STAFF_P.postureAttackRatio;
export const POSTURE_DEFEND_RATIO_THRESHOLD = STAFF_P.postureDefendRatio;
export const MIN_FRONT_POWER = STAFF_P.minFrontPower;
export const CAPTURE_PROBABILITY_SCALE = STAFF_P.captureProbabilityScale;
export const CAPTURE_PROBABILITY_FLOOR = STAFF_P.captureProbabilityFloor;

/**
 * Clusters friendly contact territories into contiguous strategic fronts (连通分量聚类).
 * Computes P_me, P_en, power ratio R, V_hold, V_gain, terrain bonus and local posture.
 */
export function analyzeFronts(model) {
  const st = model.st;
  const mine = model.mine;

  // Identify all friendly land territories that are in direct contact with enemies
  const contactList = mine.filter(a => a.land && model.isFront(a.id));
  if (!contactList.length) {
    // F3: 无直接陆地接触（如岛国或隔海）：寻找离敌军最近的沿海/战略前哨构建远征前线，绝不许整国闲置
    const enemyAreas = [];
    const allAreas = model.game.stage.data.areas || [];
    for (const a of allAreas) {
      if (a && model.rel(a.country) === 'enemy') {
        enemyAreas.push(a.id);
      }
    }
    if (!enemyAreas.length) return [];

    // 从我方领土中找离敌方最近的地块
    const myAreas = mine.map(a => a.id);
    const areaDists = [];
    for (const myId of myAreas) {
      let dMinForMy = Infinity;
      let closestE = null;
      for (const eId of enemyAreas) {
        const d = model.dist ? model.dist(myId, eId) : 3;
        if (d < dMinForMy) {
          dMinForMy = d;
          closestE = eId;
        }
      }
      areaDists.push({ myId, d: dMinForMy, closestE });
    }

    areaDists.sort((a, b) => a.d - b.d);
    if (!areaDists.length || areaDists[0].d === Infinity) return [];

    const shortestDist = areaDists[0].d;
    const forwardAreas = areaDists
      .filter(item => item.d <= shortestDist + 2)
      .slice(0, 8)
      .map(item => item.myId);

    const targetEnemyAreas = Array.from(new Set(
      areaDists.slice(0, 5).map(item => item.closestE).filter(Boolean)
    ));

    return [{
      id: 1,
      model,
      areas: forwardAreas,
      friendlyAreas: forwardAreas,
      enemyAreas: targetEnemyAreas,
      P_me: 100,
      P_en: 100,
      R: 1.0,
      V_hold: 50,
      V_gain: 50,
      investmentValue: 50,
      terrainBonus: 0,
      posture: 'attack',
      operationalPosture: 'attack',
      isMaritimeExpedition: true
    }];
  }

  const contactSet = new Set(contactList.map(a => a.id));
  const visited = new Set();
  const clusters = [];

  for (const contact of contactList) {
    if (visited.has(contact.id)) continue;

    const clusterAreas = [];
    const queue = [contact.id];
    visited.add(contact.id);

    while (queue.length > 0) {
      const curr = queue.shift();
      clusterAreas.push(curr);

      for (const adjId of st.adjE.get(curr) || []) {
        if (contactSet.has(adjId) && !visited.has(adjId)) {
          visited.add(adjId);
          queue.push(adjId);
        }
      }
    }
    clusters.push(clusterAreas);
  }

  // Pre-index friendly and enemy units by area for fast lookup
  const unitsByArea = new Map();
  for (const u of model.units.mine) {
    const list = unitsByArea.get(u.area) || [];
    list.push(u);
    unitsByArea.set(u.area, list);
  }

  const enemyUnitsByArea = new Map();
  for (const u of model.units.enemy) {
    const list = enemyUnitsByArea.get(u.area) || [];
    list.push(u);
    enemyUnitsByArea.set(u.area, list);
  }

  const fronts = [];
  let frontIndex = 1;

  for (const cluster of clusters) {
    const frontAreaSet = new Set(cluster);
    const adjacentEnemySet = new Set();

    let maxVHold = 0;
    let terrainBonus = 0;

    // Collect all adjacent enemy territories
    for (const aId of cluster) {
      const aVal = model.areaValue ? model.areaValue(aId) : 50;
      if (aVal > maxVHold) maxVHold = aVal;

      const areaObj = model.area(aId);
      const p = loadStaffOverrides();
      if (areaObj?.installation === 'fort') terrainBonus += p.terrainFortBonus;
      else if (areaObj?.installation === 'entrenchment') terrainBonus += p.terrainEntrenchmentBonus;
      if (areaObj?.areaType === 1 || areaObj?.construction === 'city') terrainBonus += p.terrainCityBonus;

      for (const adj of st.adjE.get(aId) || []) {
        const adjArea = st.st(adj);
        if (adjArea && model.rel(adjArea.country) === 'enemy') {
          adjacentEnemySet.add(adj);
        }
      }
    }

    const enemyAreas = [...adjacentEnemySet];
    const facingCountries = new Set();
    const facingProfiles = [];

    for (const eId of enemyAreas) {
      const ea = st.st(eId);
      if (ea?.country && !facingCountries.has(ea.country)) {
        facingCountries.add(ea.country);
        const prof = identifyCountryProfile(model.game, ea.country);
        if (prof) facingProfiles.push(prof);
      }
    }

    const hasIndustrialEnemy = facingProfiles.some(p => p.profile.isIndustrialPower);
    const hasManpowerEnemy = facingProfiles.some(p => p.profile.isManpowerPower);
    const hasNavalEnemy = facingProfiles.some(p => p.profile.isNavalPower);

    let maxVGain = 0;
    for (const eId of enemyAreas) {
      let eVal = model.areaValue ? model.areaValue(eId) : 50;
      const ea = st.st(eId);
      const eCountry = ea?.country;
      const eProfile = facingProfiles.find(p => p.countryId === eCountry);

      if (eProfile) {
        // 1. 对工业强国 (如德国): 优先摧毁其工业设施（攻打工业城市/设施时给予显著额外权重）
        if (eProfile.profile.isIndustrialPower) {
          const hasIndustry = ea.construction === 'industry' || ea.installation === 'industry' || (ea.industry > 0);
          const isCity = ea.construction === 'city' || [1, 3, 4].includes(ea.areaType);
          if (hasIndustry || isCity) {
            eVal *= 1.85; // 工业城市与核心工业产能地块优先攻打
          } else {
            eVal *= 0.85; // 纯军事/非工业边缘地块相对降权
          }
        }

        // 2. 对兵源国 (如苏联): 攻打其首都/关键城市削弱其动员生产能力
        if (eProfile.profile.isManpowerPower) {
          const isCap = model.game?.diplomacy?.capitals?.[eCountry] === eId || ea.areaType === 1;
          const isKeyCity = isCap || ea.areaType === 4 || (ea.construction === 'city' && (ea.level || 0) >= 2);
          if (isCap) {
            eVal *= 2.2; // 极高优先级直插首都
          } else if (isKeyCity) {
            eVal *= 1.7; // 集中削弱核心城市与关键生产点
          }
        }

        // 3. 对海军强国 (如英国): 避免登陆作战，优先控制沿海地区限制其活动范围
        if (eProfile.profile.isNavalPower) {
          const isCoastal = ea.areaType === 2 || (st.adjE.get(eId) || []).some(nid => st.st(nid)?.sea);
          const requiresAmphibious = ea.sea || eProfile.geography.isIsland;
          const hasDirectLandBorder = (st.adjE.get(eId) || []).some(nid => cluster.includes(nid));
          if (requiresAmphibious && !hasDirectLandBorder) {
            eVal *= 0.35; // 避免草率跨海登陆作战
          } else if (isCoastal) {
            eVal *= 1.6; // 优先夺取陆地沿海港口，限制其出海口与补给
          }
        }
      }

      if (eVal > maxVGain) maxVGain = eVal;
    }

    // Compute friendly combat power P_me in and immediately adjacent to this front
    let pMe = 0;
    const evaluatedFriendlyUnits = new Set();
    for (const aId of cluster) {
      for (const u of unitsByArea.get(aId) || []) {
        if (!evaluatedFriendlyUnits.has(u.id)) {
          evaluatedFriendlyUnits.add(u.id);
          const uVal = model.unitValue ? model.unitValue(u) : u.maxHp;
          pMe += Math.sqrt(Math.max(1, u.hp) * Math.max(1, uVal));
        }
      }
    }

    // Compute enemy combat power P_en in adjacent contact territories
    let pEn = 0;
    const evaluatedEnemyUnits = new Set();
    for (const eId of enemyAreas) {
      for (const u of enemyUnitsByArea.get(eId) || []) {
        if (!evaluatedEnemyUnits.has(u.id)) {
          evaluatedEnemyUnits.add(u.id);
          const uVal = model.unitValue ? model.unitValue(u) : u.maxHp;
          pEn += Math.sqrt(Math.max(1, u.hp) * Math.max(1, uVal));
        }
      }
    }

    const r = pMe / Math.max(MIN_FRONT_POWER, pEn);
    let posture = r >= POSTURE_ATTACK_RATIO_THRESHOLD ? 'attack'
      : (r <= POSTURE_DEFEND_RATIO_THRESHOLD ? 'defend' : 'balanced');

    // 针对性战役姿态调整：
    // - 对兵源国：重点防御（集中兵力防守少数关键点），若无绝对碾压优势（R < 1.35）保持坚固防御
    if (hasManpowerEnemy && r < 1.35) {
      posture = 'defend';
    }
    // - 对工业强国：快速扩张避免被其后续工业爆兵反压（若我军力量持平或微优，优先果断进攻）
    if (hasIndustrialEnemy && r >= 1.05) {
      posture = 'attack';
    }

    fronts.push({
      id: frontIndex++,
      model,
      areas: cluster,
      friendlyAreas: cluster,
      enemyAreas,
      P_me: pMe,
      P_en: pEn,
      R: r,
      V_hold: maxVHold,
      V_gain: maxVGain,
      terrain: terrainBonus,
      posture,
      facingCountries: Array.from(facingCountries),
      facingProfiles,
      hasIndustrialEnemy,
      hasManpowerEnemy,
      hasNavalEnemy,
    });
  }

  return fronts;
}

/**
 * Determines the Schwerpunkt (main effort direction) and overall posture.
 * Evaluates investment value: attainable gain - risk for each front.
 */
export function pickMainEffort(fronts, doctrine = {}, model = null) {
  const p = loadStaffOverrides();
  const m = model || fronts?.[0]?.model || null;
  const warSeqPlan = planWarSequence(m, fronts, doctrine);

  if (!fronts || !fronts.length) {
    return {
      mainEffort: null,
      overallPosture: 'balanced',
      fronts: [],
      targetTechLevel: evaluateCampaignTechGoal(m, doctrine),
      warSequence: warSeqPlan,
    };
  }

  let totalPMe = 0;
  let totalPEn = 0;

  for (const f of fronts) {
    totalPMe += f.P_me;
    totalPEn += f.P_en;

    // Estimate expected investment return = expected gain - expected defensive risk
    const pCapture = Math.min(1, Math.max(p.captureProbabilityFloor, f.R * p.captureProbabilityScale));
    const expGain = f.V_gain * pCapture * 1.35;
    const riskFactor = Math.max(0, 1 - f.R);
    const expRisk = f.V_hold * riskFactor * 0.8;
    let invVal = expGain - expRisk;

    // 针对性投资价值调整：
    // - 对工业强国：及早攻占工业重心避免其持续产能输出，提升投资主攻优先级
    if (f.hasIndustrialEnemy && f.R >= 0.95) {
      invVal *= 1.25;
    }
    // - 对海军强国：若为孤立跨海远征且我方无制海权，降低主攻倾斜，优先大陆扩张
    if (f.hasNavalEnemy && f.isMaritimeExpedition) {
      invVal *= 0.5;
    }
    // - 对式微国家：迅速出击收割其剩余领地
    if (f.facingProfiles?.some(prof => prof?.profile?.isWeak)) {
      invVal += 60;
    }

    f.investmentValue = invVal;
  }

  const overallR = totalPMe / Math.max(p.minFrontPower, totalPEn);
  const overallPosture = overallR >= p.postureAttackRatio ? 'attack'
    : (overallR <= p.postureDefendRatio ? 'defend' : 'balanced');

  // Sort fronts by investment value descending
  const sorted = [...fronts].sort((a, b) => b.investmentValue - a.investmentValue);
  const candidateMain = sorted[0];
  const hasProfitableMain = candidateMain && candidateMain.investmentValue > 0;
  const mainEffort = hasProfitableMain ? candidateMain : (sorted[0] || null);

  // Configure operational postures: Schwerpunkt gets 'attack' only if investmentValue > 0, otherwise defend
  for (const f of fronts) {
    if (mainEffort && f.id === mainEffort.id && hasProfitableMain) {
      f.operationalPosture = 'attack';
      f.priority = 9;
    } else {
      f.operationalPosture = f.R <= POSTURE_DEFEND_RATIO_THRESHOLD ? 'defend' : 'screen';
      f.priority = Math.max(3, Math.min(7, Math.trunc(f.R * 5)));
    }
  }

  const effectiveOverallPosture = hasProfitableMain ? overallPosture : (overallPosture === 'attack' ? 'balanced' : overallPosture);

  return {
    mainEffort,
    mainFrontId: mainEffort ? mainEffort.id : null,
    overallPosture: effectiveOverallPosture,
    fronts: sorted,
    targetTechLevel: evaluateCampaignTechGoal(m, doctrine),
    warSequence: planWarSequence(m, fronts, doctrine),
  };
}

/**
 * 战役长期科技目标前瞻规划：
 * 在制定战役目标时，提前评估"这个局是否能升到科技5"，并相应调整资源分配。
 * 避免在决胜局或短线战役中盲目往高升导致科技未产出收益游戏就结束。
 * @param {Object} model - 战场模型
 * @param {Object} doctrine - 国家学说配置
 * @returns {number} 战役目标科技等级 (3, 4 或 5)
 */
export function evaluateCampaignTechGoal(model, doctrine = {}) {
  if (!model) return 4;
  const game = model.game;
  const stage = model.st;
  const country = model.me;
  const round = game?.round || 1;

  const areas = stage?.areas || [];
  let totalLand = 0;
  let myLand = 0;
  let maxEnemyLand = 0;
  const enemyCounts = new Map();

  for (const a of areas) {
    if (a.sea) continue;
    totalLand++;
    if (a.country === country) myLand++;
    else if (a.country && model.rel && model.rel(a.country) === 'enemy') {
      enemyCounts.set(a.country, (enemyCounts.get(a.country) || 0) + 1);
    }
  }

  for (const c of enemyCounts.values()) {
    if (c > maxEnemyLand) maxEnemyLand = c;
  }

  // 1. 小地图或已进入大优势推进期（总陆地较小，或我方占全图过半，或前线已碾压）：
  // 战局即将快速结束，科技升到 3 或 4 即足够，不再冲击科技5
  if (totalLand <= 60 || myLand > totalLand * 0.50 || (round >= 8 && myLand > maxEnemyLand * 1.6)) {
    return 3;
  } else if (totalLand <= 120 || myLand > totalLand * 0.35 || round >= 14) {
    return 4;
  }

  // 2. 只有在超大地图且长期拉锯胶着战中，才有空间与价值升到科技5
  return 5;
}

/**
 * 战役长期宣战序列规划 (War Sequence Planning / Campaign Phasing):
 * 避免"全面开战"，规划"先对A国宣战 -> 媾和或灭亡后对B国宣战"的有序步骤，
 * 避免同时对多个强敌开战，并在陷入双线作战时协同外交部门启动预防性媾和。
 *
 * @param {Object} model - 战场模型
 * @param {Array<Object>} fronts - 战线分析结果
 * @param {Object} [doctrine] - 学说配置
 * @returns {Object} 宣战序列规划结果
 */
export function planWarSequence(model, fronts = [], doctrine = {}) {
  if (!model) {
    return {
      primaryEnemy: null,
      secondaryEnemies: [],
      multiFrontCrisis: false,
      recommendedPeaceTarget: null,
      warSequence: [],
      rankedTargets: [],
      allowNewWarDeclaration: false,
      primaryTargetToDeclare: null,
    };
  }

  const game = model.game;
  const me = model.me;
  const stage = model.st;

  // 1. 获取当前所有交战国
  const warEnemies = [];
  for (const c of stage.countries.values()) {
    if (!c || c.id === me || c.eliminated) continue;
    if (getDiplomaticRelation(game, me, c.id) === DIPLOMACY_STATE.WAR) {
      warEnemies.push(c.id);
    }
  }

  // 2. 识别主攻强敌 (Primary Enemy) 与次要交战国 (Secondary Enemies)
  let primaryEnemy = null;
  const secondaryEnemies = [];
  const majorEnemies = [];

  const myPower = countryPower(game, me).power;
  let totalEnemyPower = 0;

  for (const eid of warEnemies) {
    const ep = countryPower(game, eid).power;
    totalEnemyPower += ep;
    const eLands = stage.areas.filter(a => a.country === eid && !a.sea);
    const isMajor = ep >= 60 || eLands.length >= 4;
    if (isMajor) {
      majorEnemies.push({ id: eid, power: ep, lands: eLands.length });
    }
  }

  // 结合战线找出面对主力方向的敌人
  if (fronts && fronts.length > 0 && fronts[0]?.facingCountries?.length > 0) {
    primaryEnemy = fronts[0].facingCountries[0];
  } else if (majorEnemies.length > 0) {
    majorEnemies.sort((a, b) => b.power - a.power);
    primaryEnemy = majorEnemies[0].id;
  } else if (warEnemies.length > 0) {
    primaryEnemy = warEnemies[0];
  }

  for (const eid of warEnemies) {
    if (eid !== primaryEnemy) {
      secondaryEnemies.push(eid);
    }
  }

  // 3. 检查多线作战危机 (Multi-Front War Crisis)
  // 如果同时面对2个及以上强敌，且我方战力比紧张 (myPower < totalEnemyPower * 0.95 或有多条防守前线)
  const isPowerInferior = myPower < totalEnemyPower * 0.95;
  const hasDefensiveFronts = (fronts || []).filter(f => f.posture === 'defend').length >= 2;
  const multiFrontCrisis = majorEnemies.length >= 2 && (isPowerInferior || hasDefensiveFronts);

  let recommendedPeaceTarget = null;
  if (multiFrontCrisis && secondaryEnemies.length > 0) {
    // 推荐向次要战线的强敌求和，以便集中兵力突破主要方向
    const sortedSec = [...secondaryEnemies].sort((a, b) => {
      const pa = countryPower(game, a).power;
      const pb = countryPower(game, b).power;
      return pb - pa;
    });
    recommendedPeaceTarget = sortedSec[0];
  }

  // 4. 规划宣战序列
  const rankedTargets = rankDeclareWarTargets(game, model, me);
  const warSequence = rankedTargets.map(t => t.country);

  // 5. 宣战节律控制 (避免同时与多个强敌作战)
  // 规则：若当前已有主要强敌在打且尚未压制，不允许开辟新的强敌战场！
  let allowNewWarDeclaration = false;
  let primaryTargetToDeclare = null;

  if (rankedTargets.length > 0) {
    const topCandidate = rankedTargets[0];
    const topId = topCandidate.country;
    const topThreat = topCandidate.threatEval;

    if (warEnemies.length === 0) {
      if (topThreat?.recommendation !== 'delay_avoid') {
        allowNewWarDeclaration = true;
        primaryTargetToDeclare = topId;
      }
    } else if (!multiFrontCrisis && majorEnemies.length < 2) {
      // 当前只有1个主要敌人，且主战场占据绝对优势 (R >= 1.5) 或候选目标为易灭亡的脆弱小国(Tier A/S, tPower < 35)
      const primaryFrontR = (fronts && fronts[0]?.R) || 1.0;
      const isQuickHarvestTarget = topCandidate.priorityTier === 'A' && topCandidate.tPower < 35;
      const isSuperDominant = primaryFrontR >= 1.5 && topCandidate.priorityTier === 'S' && topThreat.alliesCost <= 25;

      if ((isQuickHarvestTarget || isSuperDominant) && topThreat?.recommendation !== 'delay_avoid') {
        allowNewWarDeclaration = true;
        primaryTargetToDeclare = topId;
      }
    }
  }

  return {
    primaryEnemy,
    secondaryEnemies,
    multiFrontCrisis,
    recommendedPeaceTarget,
    warSequence,
    rankedTargets,
    allowNewWarDeclaration,
    primaryTargetToDeclare,
  };
}

