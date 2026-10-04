// Production, recruitment, strategic air force and economic investment staff module.
// Conforms to V2 Architecture (§5.6, §6) and optimized card purchase prioritization.
import { handlerFor } from '../../../commands.js';
import { unitValue, chokepointValue } from '../core/value.js';
import { shopCards } from '../../../cards.js';
import { doctrineFor } from '../core/doctrine.js';
import { minDistanceToAirport } from '../../../rules/cardEffects.js';
import { loadStaffOverrides, STAFF_P } from './params_staff.js';
import { World } from '../../../world.js';
import { identifyCountryProfile } from './profile.js';

export function getUnitCategory(nameOrType) {
  const s = String(nameOrType || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (s.includes('panzer') || s.includes('tank') || s.includes('armour') || s.includes('armored')) return 'armor';
  if (s.includes('elite')) return 'elite';
  if (s.includes('infantry')) return 'infantry';
  if (s.includes('artillery')) return 'artillery';
  if (s.includes('rocket')) return 'rocket';
  if (s.includes('destroyer') || s.includes('cruiser') || s.includes('battleship') || s.includes('carrier') || s.includes('navy')) return 'navy';
  return 'infantry';
}

// Backward-compatible named exports sourced from centralized STAFF_P
export const DEFAULT_RESERVE_TURNS = STAFF_P.reserveTurns;
export const MAX_RESERVE_MONEY_FRACTION = STAFF_P.maxReserveMoneyFraction;
export const EMERGENCY_DEFENSE_PLOSE_THRESHOLD = STAFF_P.emergencyDefensePLose;
export const INVESTMENT_HORIZON_TURNS = STAFF_P.investmentHorizonTurns;
export const MIN_INVESTMENT_ROI_THRESHOLD = STAFF_P.minInvestmentRoi;
export const MIN_INVESTMENT_ROI_SHORT_THRESHOLD = STAFF_P.minInvestmentRoiShort;
export const PAYBACK_SAFETY_MARGIN = STAFF_P.paybackSafetyMargin;
export const MIN_ECONOMIC_DEPTH = STAFF_P.minEconomicDepth;
export const MAX_ECONOMIC_PLOSE = STAFF_P.maxEconomicPLose;
export const ECONOMIC_LEGACY = STAFF_P.economicLegacy;
export const LEGACY_MIN_DEPTH = STAFF_P.legacyMinDepth ?? 0;
export const LEGACY_PAYBACK_GATE = STAFF_P.legacyPaybackGate ?? false;

function capitalUnderAttack(game, stage, country) {
  const dip = game.diplomacy;
  if (dip?.capitalFallen?.[country]) return true;
  const capitalId = dip?.capitals?.[country];
  if (capitalId == null) return false;
  const capital = stage.st(capitalId);
  if (!capital || capital.country !== country) return true;
  return (stage.adjE.get(capitalId) || []).some(id => {
    const neighbor = stage.st(id);
    if (!neighbor?.country || neighbor.country === country) return false;
    const relation = game.getDiplomaticRelation?.(country, neighbor.country);
    return relation === 1 || relation === 'war' ||
      (!dip?.enabled && stage.alliance?.(neighbor.country) !== stage.alliance?.(country));
  });
}

/**
 * 计算我方地块相对于前线的 BFS 纵深深度 (depth)
 * depth = 0: 前线地块 (isFront)
 * depth = 1: 与前线地块直接相邻的我方地块 (前线邻接地块)
 * depth >= 2: 中后方地块
 * 孤立或不可达陆地地块设为 99
 */
export function computeFrontDepth(stage, country, model) {
  const depthMap = new Map();
  const queue = [];

  // 无论是陆地还是海面前线，只要是我方直接与敌方接壤的地块，均作为前线源点 (depth = 0)
  // 确保与评测口径统一，避免濒临海面前线的沿海地块被误判为中后方
  for (const a of model.mine) {
    if (model.isFront(a.id)) {
      depthMap.set(a.id, 0);
      queue.push(a.id);
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const curr = queue[head];
    const d = depthMap.get(curr);
    for (const next of stage.adjE.get(curr) || []) {
      if (depthMap.has(next)) continue;
      const nextArea = stage.st(next);
      if (!nextArea || nextArea.sea || World.areas[next]?.f === 1) continue;
      if (nextArea.country !== country) continue;
      depthMap.set(next, d + 1);
      queue.push(next);
    }
  }

  for (const a of model.mine) {
    if (a.land && !depthMap.has(a.id)) {
      depthMap.set(a.id, 99);
    }
  }

  return depthMap;
}

/**
 * 评估单项经济投资 (城市14/工业15/机场16) 的回本周期与预期 ROI
 * @returns {{ paybackTurns: number, roi: number, turnValue: number } | null}
 */
export function evaluateEconomicPayback(game, country, card, area, remainingRounds, p) {
  if (remainingRounds <= 0) return null;
  const stage = game.stage;
  const countryInfo = stage.countries?.get(country);
  const taxfactor = countryInfo?.taxfactor ?? 1;

  const moneyCost = card.price || 0;
  const industryCost = card.industry || 0;
  const costEquiv = moneyCost + industryCost * (p.industryCostWeight ?? 1.5);

  let expectedTurnValue = 0;

  if (card.id === 14) {
    // 城市升级：每级产出 5*taxfactor 金币 + 辅助价值 (休整恢复与招募位)
    const baseMoney = (p.cityIncomeTurnValue ?? 5) * taxfactor;
    const aux = (p.cityAuxTurnValue ?? 2.5);
    expectedTurnValue = baseMoney + aux;
  } else if (card.id === 15) {
    // 工业升级：每级产出 5 工业点 (按折算价值)
    expectedTurnValue = p.industryTurnValue ?? 7.5;
  } else if (card.id === 16) {
    // 机场建设：检查是否能为空袭带来增量覆盖
    const curDist = minDistanceToAirport(stage, country, area.id);
    const airRadius = game.airstrikeRadius ? game.airstrikeRadius() : 250;
    // 如果已有机场覆盖该区域，增量为空
    if (curDist > 0 && curDist <= airRadius) {
      return null;
    }
    // 检查新建机场覆盖范围内是否有敌方地块/部队
    let hasEnemyTargetInRange = false;
    for (const otherArea of stage.areas) {
      if (!otherArea.country || otherArea.country === country) continue;
      const tPts = World.areas?.[otherArea.id]?.pts?.[0];
      const aPts = World.areas?.[area.id]?.pts?.[1];
      if (tPts && aPts) {
        const dx = tPts[0] - aPts[0], dy = tPts[1] - aPts[1];
        if (dx * dx + dy * dy <= airRadius * airRadius) {
          hasEnemyTargetInRange = true;
          break;
        }
      }
    }
    if (!hasEnemyTargetInRange) {
      return null; // 无打击目标，战术收益为 0
    }
    expectedTurnValue = p.airportTurnTacticalValue ?? 10.0;
  } else {
    return null;
  }

  if (expectedTurnValue <= 0) return null;
  const paybackTurns = costEquiv / expectedTurnValue;
  const safetyMargin = p.paybackSafetyMargin ?? 1;

  // 必须满足：剩余回合足以回本 (留安全余量)
  if (remainingRounds < paybackTurns + safetyMargin) {
    return null;
  }

  const totalReturn = expectedTurnValue * remainingRounds;
  const roi = totalReturn / costEquiv;
  const isShortBattle = p?.isShortBattle !== undefined
    ? Boolean(p.isShortBattle)
    : (typeof game?.totalRounds === 'number' && game.totalRounds > 0);
  // 回本即可投，中后方红线不变：短局使用 minInvestmentRoiShort(默认 1.0)，长局继续用 minInvestmentRoi(1.1)
  const minRoi = isShortBattle
    ? (p?.minInvestmentRoiShort ?? 1.0)
    : (p?.minInvestmentRoi ?? 1.1);

  if (roi < minRoi) {
    return null;
  }

  return { paybackTurns, roi, turnValue: expectedTurnValue };
}

/**
 * 模块级领地历史存储，避免向战争迷雾下的只读代理写属性抛出 TypeError。
 * 键结构：gameKey -> Map<country, Array<{round, count}>>
 */
const territoryHistoryStore = new Map();

/**
 * 提取对局唯一标识，优先使用 game.gameId。
 * 若无 gameId 则降级使用 stage.name 与 seed/id 组合。
 */
export function getTerritoryHistoryKey(game) {
  if (!game) return 'default';
  if (game.gameId != null) return `gid_${game.gameId}`;
  if (game.id != null) return `id_${game.id}`;
  const stageName = game.stage?.name || game.name || 'stage';
  const seed = game.seed ?? game.rng?.seed ?? '';
  return `stg_${stageName}_${seed}`;
}

/**
 * 清除领地历史存储（用于测试重置或防串局）
 */
export function clearTerritoryHistory(game = null) {
  if (!game) {
    territoryHistoryStore.clear();
  } else {
    const key = typeof game === 'string' ? game : getTerritoryHistoryKey(game);
    territoryHistoryStore.delete(key);
  }
}

/**
 * 获取指定国家在对局中的领地变化历史
 */
export function getTerritoryHistory(game, country) {
  if (!game || !country) return [];
  const key = getTerritoryHistoryKey(game);
  const gameMap = territoryHistoryStore.get(key);
  return gameMap?.get(country) || [];
}

/**
 * 记录与追踪领地变化历史 (用于判定推进明显或领地被侵蚀)
 */
export function recordTerritoryHistory(game, country, landCount) {
  if (!game || !country) return;
  const gameKey = getTerritoryHistoryKey(game);
  let gameMap = territoryHistoryStore.get(gameKey);
  if (!gameMap) {
    gameMap = new Map();
    territoryHistoryStore.set(gameKey, gameMap);
  }
  const round = game.round || 1;
  let list = gameMap.get(country);
  // 若当前是回合 1，且存在大于回合 1 的旧数据，说明是同一 key 开启的新局，重置历史
  if (round === 1 && list && list.some(item => item.round > 1)) {
    list = [];
    gameMap.set(country, list);
  }
  if (!list) {
    list = [];
    gameMap.set(country, list);
  }
  const existing = list.find(item => item.round === round);
  if (existing) {
    existing.count = landCount;
  } else {
    list.push({ round, count: landCount });
  }
}

/**
 * 科技升级等级的合理性评估：
 * 根据剩余游戏时间评估"升到几级就够"，避免盲目冲击高等级导致未发挥收益即结束。
 * @param {Object} game - 游戏实例
 * @param {Object} stage - 关卡 Stage
 * @param {number} currentTech - 当前科技等级
 * @param {number|null} remainingRounds - 预估剩余回合数
 * @returns {number} 建议的目标科技等级 (1~5)
 */
export function evaluateTechLevel(game, stage, currentTech = 1, remainingRounds = null) {
  const round = game?.round || 1;
  const country = game?.activeCountry || game?.player;
  const income = game?.income ? game.income(country) : { money: 60, industry: 20 };
  const incMoney = Math.max(20, income.money || 60);

  // 1. 估算"还能打多少回合"
  let estRounds = remainingRounds;
  if (estRounds == null || estRounds <= 0) {
    const areas = stage?.areas || [];
    let totalLand = 0;
    let myLand = 0;
    let maxEnemyLand = 0;
    const enemyMap = new Map();
    for (const a of areas) {
      if (a.sea) continue;
      totalLand++;
      if (a.country === country) {
        myLand++;
      } else if (a.country) {
        enemyMap.set(a.country, (enemyMap.get(a.country) || 0) + 1);
      }
    }
    for (const c of enemyMap.values()) {
      if (c > maxEnemyLand) maxEnemyLand = c;
    }

    if (totalLand > 0) {
      const myRatio = myLand / totalLand;
      if (myRatio >= 0.75 || (myLand > maxEnemyLand * 3 && round >= 8)) {
        estRounds = Math.max(3, 8 - Math.trunc((round - 8) * 0.5)); // 残局扫尾
      } else if (myRatio >= 0.50 || (myLand > maxEnemyLand * 1.8 && round >= 6)) {
        estRounds = Math.max(6, 16 - Math.trunc(round * 0.5)); // 优势推进期
      } else {
        estRounds = Math.max(10, 32 - round); // 均势或持久战
      }
    } else {
      estRounds = Math.max(8, 30 - round);
    }
  }

  // 2. 推算"升到X级需要多少回合"与收益窗口
  let bestLevel = currentTech;
  const maxTech = 5;

  for (let target = maxTech; target >= currentTech; target--) {
    if (target === currentTech) {
      bestLevel = Math.max(bestLevel, currentTech);
      break;
    }

    // 从 currentTech 升到 target 所需的总资金 (Card 21 基础价格 60)
    let totalCost = 0;
    for (let k = currentTech; k < target; k++) {
      totalCost += 60 * k;
    }

    // AI 每回合用于科技的可支配预算约为总收入的 45%
    const turnsByMoney = Math.ceil(totalCost / Math.max(30, incMoney * 0.45));
    // 每回合最多升级 1 次科技
    const turnsNeeded = Math.max(target - currentTech, turnsByMoney);

    // 收益发挥期 (Payoff Window) 必须至少有 3 回合以上才有价值升级
    const payoffWindow = estRounds - turnsNeeded;
    if (payoffWindow >= 3) {
      bestLevel = target;
      break;
    }
  }

  return bestLevel;
}

/**
 * 科技优先级的形势感知判定：
 * 根据战场形势判定科技是否应该优先投入
 * @param {Object} model - 战场模型
 * @param {string} country - 国家代码
 * @param {number} currentTech - 当前科技等级
 * @param {Object} plan - 战略规划方案
 * @returns {{shouldFocus: boolean, reason: string, recommendedLevel: number}}
 */
export function shouldPrioritizeTech(model, country = null, currentTech = null, plan = null) {
  country = country || model?.me;
  const game = model?.game;
  const stage = model?.st || game?.stage;
  const wallet = country === game?.player ? game : stage?.countries?.get(country);
  const techLevel = currentTech ?? (country === game?.player ? game?.tech : (wallet?.techlevel ?? wallet?.tech ?? 1));

  // 目标科技等级合理性评估 (考虑长期战役目标规划与剩余回合推算)
  const remainingRounds = plan?.remainingRounds ?? null;
  const campaignGoal = plan?.targetTechLevel ?? 5;
  const evaluatedMax = evaluateTechLevel(game, stage, techLevel, remainingRounds);
  const recommendedLevel = Math.min(campaignGoal, evaluatedMax);

  // 若当前已达到或超过推荐等级，无需再优先升级科技
  if (techLevel >= recommendedLevel) {
    return {
      shouldFocus: false,
      reason: 'reached_target_tech_level',
      recommendedLevel
    };
  }

  // --- 1. 领地历史与趋势统计 ---
  const myLandAreas = (model?.mine || []).filter(a => a.land);
  const myLandCount = myLandAreas.length;
  recordTerritoryHistory(game, country, myLandCount);

  const round = game?.round || 1;
  const hist = getTerritoryHistory(game, country);

  // 领地被侵蚀：过去2回合丧失 > 3块
  const past2 = hist.find(item => item.round === round - 2) || (round === 2 ? hist.find(item => item.round === 1) : null);
  const territoryLostMoreThan3 = past2 ? ((past2.count - myLandCount) > 3) : false;

  // 推进明显：过去3回合领地增长 > 5块
  const past3 = hist.find(item => item.round === round - 3) || (round <= 3 ? hist.find(item => item.round === 1) : null);
  const territoryGainedMoreThan5 = past3 ? ((myLandCount - past3.count) > 5) : false;

  // --- 2. 前线失守概率 (pLose) 评估 ---
  let maxPLose = 0;
  let allPLoseUnder03 = true;
  for (const a of myLandAreas) {
    const pl = model?.pLose ? (model.pLose(a.id) || 0) : 0;
    if (pl > maxPLose) maxPLose = pl;
    if (pl >= 0.30) allPLoseUnder03 = false;
  }
  // 前线高压：任意地块 pLose > 0.5
  const frontlineHighPressure = maxPLose > 0.50;

  // --- 3. 关键缺口 (防御工事严重不足) ---
  const hubs = getStrategicKeyHubs(model, plan);
  let vulnerableFortCount = 0;
  for (const hid of hubs) {
    const area = model?.area ? model.area(hid) : null;
    if (!area || area.owner !== country) continue;
    const pl = model?.pLose ? (model.pLose(hid) || 0) : 0;
    const hasFort = area.installation === 'fort' || area.installation === 'entrenchment';
    if (!hasFort && ((model?.isFront ? model.isFront(hid) : false) || pl > 0.20)) {
      vulnerableFortCount++;
    }
  }
  const criticalFortGap = vulnerableFortCount >= 2;

  // --- 4. 单位伤病率评估 (平均血量 < 60%) ---
  const myUnits = model?.units?.mine || [];
  let totalHp = 0, totalMaxHp = 0;
  for (const u of myUnits) {
    totalHp += (u.hp || 0);
    totalMaxHp += (u.maxHp || 100);
  }
  const avgHpRate = totalMaxHp > 0 ? (totalHp / totalMaxHp) : 1.0;
  const unitsSeverelyInjured = avgHpRate < 0.60;

  // --- 5. 领地优势明显 (己方领地 > 敌方 × 1.5) ---
  let maxEnemyLands = 0;
  const enemyCounts = new Map();
  for (const a of (model?.enemyAreas || [])) {
    if (!a.land || !a.owner) continue;
    enemyCounts.set(a.owner, (enemyCounts.get(a.owner) || 0) + 1);
  }
  for (const count of enemyCounts.values()) {
    if (count > maxEnemyLands) maxEnemyLands = count;
  }
  const hasTerritoryAdvantage = maxEnemyLands > 0 ? (myLandCount > maxEnemyLands * 1.5) : true;

  // --- 6. 经济充裕评估 (金钱充足且没有紧急卡片需求) ---
  const currentMoney = wallet?.money ?? 0;
  const techCardCost = 60 * techLevel;
  const hasEmergencyCardNeed = unitsSeverelyInjured || criticalFortGap;
  const isEconomyAbundant = (currentMoney >= techCardCost * 1.5 && currentMoney >= 120) && !hasEmergencyCardNeed;

  // ==========================================
  // 【返回false的条件】（卡片优先）：
  // 1) 前线高压：任意地块 pLose > 0.5
  // 2) 领地被侵蚀：过去 2 回合丧失 > 3 块
  // 3) 关键缺口：防御工事严重不足
  // 4) 单位伤病：平均血量 < 60%
  // ==========================================
  if (frontlineHighPressure) {
    return { shouldFocus: false, reason: 'frontline_high_pressure', recommendedLevel };
  }
  if (territoryLostMoreThan3) {
    return { shouldFocus: false, reason: 'territory_eroded', recommendedLevel };
  }
  if (criticalFortGap) {
    return { shouldFocus: false, reason: 'critical_fortification_gap', recommendedLevel };
  }
  if (unitsSeverelyInjured) {
    return { shouldFocus: false, reason: 'units_injured', recommendedLevel };
  }

  // ==========================================
  // 【返回true的条件】（科技优先）：
  // - 前线形势稳定：所有己方地块 pLose < 0.3
  // 并且具备领地优势、经济充裕或推进明显之一：
  // ==========================================
  if (allPLoseUnder03 && (hasTerritoryAdvantage || isEconomyAbundant || territoryGainedMoreThan5)) {
    return {
      shouldFocus: true,
      reason: 'frontline_stable_and_advantaged',
      recommendedLevel
    };
  }

  // 默认常规平衡态
  return {
    shouldFocus: false,
    reason: 'normal_balance',
    recommendedLevel
  };
}

/**
 * 识别战略枢纽与必须坚守的关键卡位点 (mustHold / 首都要冲 / 狭隘咽喉点 / 前线要塞城市)
 * @param {Object} model - 战场模型
 * @param {Object} plan - 战略方案
 * @returns {Set<number>} 关键卡位点集合
 */
export function getStrategicKeyHubs(model, plan = null) {
  const hubs = new Set();
  const country = model.me;
  const stage = model.st;

  // 1. 从命令系统分配的 mustHold 中提取
  const orders = plan?.orders || plan?.activeOrders || [];
  if (Array.isArray(orders)) {
    for (const ord of orders) {
      if (Array.isArray(ord.mustHold)) {
        for (const hid of ord.mustHold) hubs.add(hid);
      }
    }
  } else if (orders instanceof Map) {
    for (const ord of orders.values()) {
      if (Array.isArray(ord.mustHold)) {
        for (const hid of ord.mustHold) hubs.add(hid);
      }
    }
  }

  // 2. 首都及其关键缓冲区
  const capId = model.game?.diplomacy?.capitals?.[country] ?? model.mine.find(a => a.isCapital || a.areaType === 1)?.id;
  if (capId != null) {
    hubs.add(capId);
    for (const adjId of (stage.adjE.get(capId) || [])) {
      const adjArea = stage.st(adjId);
      if (adjArea && adjArea.country === country) {
        const pl = model.pLose ? (model.pLose(adjId) || 0) : 0;
        if (model.isFront(adjId) || pl > 0.15) {
          hubs.add(adjId);
        }
      }
    }
  }

  // 3. 战略咽喉点与前线关键据点
  for (const a of model.mine) {
    if (!a.land) continue;
    try {
      if (chokepointValue(model, a.id) > 0) {
        hubs.add(a.id);
      }
    } catch {}

    if (model.isFront(a.id)) {
      if (a.construction === 'industry' || (a.construction === 'city' && (a.level || 0) >= 2) || a.areaType === 4 || a.areaType === 1) {
        hubs.add(a.id);
      }
    }
  }

  return hubs;
}

/**
 * 势场与纵深防御：识别前线受压时应预留据点的第二防线/撤退线
 * @param {Object} model - 战场模型
 * @param {Set<number>} keyHubs - 关键卡位点
 * @returns {Set<number>} 第二防线据点集合
 */
export function identifyRetreatDefenseLine(model, keyHubs = new Set()) {
  const retreatNodes = new Set();
  const stage = model.st;
  const country = model.me;

  const threatenedFronts = [];
  for (const a of model.mine) {
    if (!a.land || !model.isFront(a.id)) continue;
    const pl = model.pLose ? (model.pLose(a.id) || 0) : 0;
    if (pl >= 0.45) {
      threatenedFronts.push({ id: a.id, pl });
    }
  }

  if (threatenedFronts.length === 0) return retreatNodes;

  for (const { id: frontId } of threatenedFronts) {
    for (const rearId of (stage.adjE.get(frontId) || [])) {
      const rearArea = stage.st(rearId);
      if (!rearArea || rearArea.country !== country || !rearArea.land) continue;
      if (!model.isFront(rearId)) {
        retreatNodes.add(rearId);
      }
    }
  }

  return retreatNodes;
}

/**
 * 1. 战场态势评估：评估当前是进攻阶段、防御阶段还是均势/休整阶段。
 * @param {Object} model - 战场模型
 * @param {Object} plan - 战区/参谋部战略计划 (fronts, mainFrontId, reports)
 * @returns {Object} 态势判定结果与诊断细节
 */
export function evaluateBattlefieldPosture(model, plan = null) {
  const fronts = plan?.fronts || [];
  let offensiveFronts = 0;
  let defensiveFronts = 0;
  let mainFront = null;

  for (const f of fronts) {
    if (plan?.mainFrontId != null && f.id === plan.mainFrontId) {
      mainFront = f;
    }
    if (f.plan === 'offensive') offensiveFronts++;
    else if (f.plan === 'defensive' || f.plan === 'elastic') defensiveFronts++;
  }

  let frontCount = 0;
  let highThreatCount = 0;     // pLose >= 0.50
  let criticalThreatCount = 0; // pLose >= 0.70
  let capitalInPeril = false;
  let pLoseSum = 0;

  for (const a of model.mine) {
    if (!a.land || !model.isFront(a.id)) continue;
    frontCount++;
    const pl = model.pLose ? model.pLose(a.id) : 0;
    pLoseSum += pl;
    if (pl >= 0.70) criticalThreatCount++;
    if (pl >= 0.50) highThreatCount++;
    if (a.areaType === 4 && pl >= 0.40) capitalInPeril = true; // 首都直接受高威胁
  }

  const pLoseAvg = frontCount > 0 ? (pLoseSum / frontCount) : 0;
  let posture = 'balanced';
  const reasons = [];

  // 防御态势判定：
  // 1) 存在极度危险地块(pLose>=0.70) 或 至少2处前线面临失守(pLose>=0.50) 或 首都告急
  // 2) 主攻方向失利被敌军严重压制 (mainFront R < 0.85 且主力转入防御)
  if (criticalThreatCount >= 1 || highThreatCount >= 2 || capitalInPeril) {
    posture = 'defensive';
    reasons.push(`high frontline collapse risk (critical=${criticalThreatCount}, high=${highThreatCount}, capitalPeril=${capitalInPeril})`);
  } else if (mainFront && (mainFront.plan === 'defensive' || mainFront.plan === 'elastic') && (mainFront.R ?? 1.0) < 0.85) {
    posture = 'defensive';
    reasons.push(`main front heavily pressured (R=${(mainFront.R ?? 1.0).toFixed(2)})`);
  } else if (defensiveFronts > offensiveFronts && highThreatCount >= 1) {
    posture = 'defensive';
    reasons.push(`defensive frontlines dominant with high threat area`);
  }
  // 进攻态势判定：
  // 前线无重大失守风险(highThreatCount === 0 且首都安全)，且主战线处于进攻态势并具备兵力优势 (R >= 1.05) 或进攻战线占绝对多数
  else if (highThreatCount === 0 && !capitalInPeril && (
    (mainFront && mainFront.plan === 'offensive' && (mainFront.R ?? 1.0) >= 1.05) ||
    (offensiveFronts > defensiveFronts && offensiveFronts >= 1)
  )) {
    posture = 'offensive';
    reasons.push(`clear offensive initiative (mainPlan=${mainFront?.plan || 'none'}, offensiveFronts=${offensiveFronts})`);
  }
  // 均势/休整态势
  else {
    posture = 'balanced';
    reasons.push('balanced frontlines or regrouping phase');
  }

  return {
    posture,
    pLoseAvg,
    pLoseMax: criticalThreatCount > 0 ? 0.75 : (highThreatCount > 0 ? 0.55 : pLoseAvg),
    threatCount: highThreatCount,
    capitalInPeril,
    mainFrontPlan: mainFront?.plan || null,
    reasons
  };
}

/**
 * 2. 全局关键战术缺口扫描：扫描堡垒工事、战地医疗、防空设施与突击强化缺口。
 * @param {Object} model - 战场模型
 * @param {Object} stage - 关卡 Stage
 * @param {string} country - 国家标识
 * @param {string} posture - 当前态势 ('offensive' | 'defensive' | 'balanced')
 * @returns {Object} 关键缺口汇总
 */
export function scanBattlefieldGaps(model, stage, country, posture = 'balanced', plan = null) {
  const gaps = {
    fortGaps: [],      // 危急前线缺堡垒/掩体
    healGaps: [],      // 伤兵/重装主力急需医疗
    aaGaps: [],        // 处于敌机打击半径内且缺防空
    assaultGaps: []    // 前线主力装甲/将领缺突击卡
  };

  const keyHubs = getStrategicKeyHubs(model, plan);
  const retreatLines = identifyRetreatDefenseLine(model, keyHubs);

  // 扫描敌对机场与空袭威胁
  const game = model.game;
  const enemyAirports = [];
  if (game?.airstrikeRadius) {
    const airRadius = game.airstrikeRadius();
    for (const a of stage.areas) {
      if (a.construction === 'airport' && a.country !== country) {
        if (!model.rel || model.rel(a.country) === 'enemy') {
          const pt = World.areas?.[a.id]?.pts?.[1];
          if (pt) enemyAirports.push({ areaId: a.id, pt, radius: airRadius });
        }
      }
    }
  }

  for (const a of model.mine) {
    if (!a.land) continue;
    const isFront = model.isFront(a.id);
    const pl = model.pLose ? model.pLose(a.id) : 0;
    const isHub = keyHubs.has(a.id);
    const isRetreat = retreatLines.has(a.id);

    // 1) 堡垒与掩体缺口：
    // 考虑沦陷风险、关键卡位点以及第二防线预留据点
    const fortThreshold = isHub ? 0.25 : (posture === 'defensive' ? 0.35 : 0.50);
    if (a.installation === 'none') {
      if ((isFront && pl >= fortThreshold) || (isHub && pl > 0.15) || (isRetreat && !isFront)) {
        gaps.fortGaps.push({
          area: a,
          pLose: pl,
          isHub,
          isRetreat,
          urgency: pl * 100 + (isHub ? 80 : 0) + (isRetreat ? 50 : 0) + (a.areaType === 4 ? 60 : a.areaType === 1 ? 40 : 20)
        });
      }
    }

    // 2) 防空设施缺口：
    // 驻扎有高价值装甲或为核心城市，且没有防空设施，且处于敌方机场航程内
    if (a.installation !== 'antiaircraft') {
      const hasArmorOrCap = (a.armies || []).some(u => ['tank', 'heavytank', 'panzer', 'battleship'].includes(u.type)) || a.areaType === 4;
      if (hasArmorOrCap && enemyAirports.length > 0) {
        const myPt = World.areas?.[a.id]?.pts?.[0];
        if (myPt) {
          const inRange = enemyAirports.some(ap => {
            const dx = myPt[0] - ap.pt[0], dy = myPt[1] - ap.pt[1];
            return (dx * dx + dy * dy) <= ap.radius * ap.radius;
          });
          if (inRange) {
            gaps.aaGaps.push({
              area: a,
              urgency: (a.areaType === 4 ? 60 : 40) + (a.armies?.length || 0) * 10
            });
          }
        }
      }
    }

    // 3) 战地重伤医疗缺口：
    if (a.armies && a.armies.length > 0) {
      let totalHp = 0, totalMaxHp = 0, lostHp = 0;
      let hasGeneral = false;
      let hasHeavyUnit = false;
      for (const u of a.armies) {
        const curHp = u.hp || 0;
        const maxHp = u.maxHp || 100;
        totalHp += curHp;
        totalMaxHp += maxHp;
        lostHp += (maxHp - curHp);
        if (u.cards & 8) hasGeneral = true;
        if (['tank', 'heavytank', 'panzer', 'battleship'].includes(u.type)) hasHeavyUnit = true;
      }
      const avgHpRatio = totalMaxHp > 0 ? (totalHp / totalMaxHp) : 1;
      const isCriticalGeneral = hasGeneral && avgHpRatio < 0.70;
      const isCriticalArmor = hasHeavyUnit && avgHpRatio < 0.65;
      const isHeavyLoss = avgHpRatio < 0.60 || lostHp >= 80;

      if (isCriticalGeneral || isCriticalArmor || isHeavyLoss) {
        gaps.healGaps.push({
          area: a,
          lostHp,
          avgHpRatio,
          hasGeneral,
          hasHeavyUnit,
          urgency: lostHp + (hasGeneral ? 150 : 0) + (hasHeavyUnit ? 80 : 0)
        });
      }
    }

    // 4) 突击战术强化缺口：
    // 前线精锐突击部队（装甲、将领或2级以上主力）未装备突击卡 (cards & 1)
    if (isFront && a.armies && a.armies.length > 0) {
      const topUnit = a.armies[0];
      const isPremier = (topUnit.cards & 8) || ['heavytank', 'tank', 'panzer'].includes(topUnit.type) || topUnit.level >= 2;
      if (isPremier && !(topUnit.cards & 1)) {
        const isMainFrontArea = plan?.mainFrontId != null && (
          (plan.mainFront?.friendlyAreas || plan.mainFront?.areas || []).includes(a.id) ||
          ((plan.fronts || []).find(f => f.id === plan.mainFrontId)?.friendlyAreas || []).includes(a.id)
        );
        const isPriorityGroup = plan?.priorityGroupIds && Array.from(plan.priorityGroupIds).some(gid => {
          const grp = (model.game?.armyGroups || []).find(g => g.id === gid);
          return grp && (grp.unitIds || []).includes(topUnit.id);
        });

        gaps.assaultGaps.push({
          area: a,
          unit: topUnit,
          urgency: (topUnit.cards & 8 ? 80 : 50) + (topUnit.level || 0) * 15 + (isMainFrontArea ? 100 : 0) + (isPriorityGroup ? 120 : 0)
        });
      }
    }
  }

  gaps.fortGaps.sort((a, b) => b.urgency - a.urgency);
  gaps.healGaps.sort((a, b) => b.urgency - a.urgency);
  gaps.aaGaps.sort((a, b) => b.urgency - a.urgency);
  gaps.assaultGaps.sort((a, b) => b.urgency - a.urgency);

  return gaps;
}

/**
 * 3. 动态卡片选择与优先级排序
 * 根据当前战局态势（进攻/防御/均势）对候选卡片进行多维度优先级评估与打分。
 * @param {Array} candidateCards - 候选购买/使用的卡片列表
 * @param {string} posture - 'offensive' | 'defensive' | 'balanced'
 * @param {Object} context - 包含 gaps, model, country, targetUnitMix, isSurplusMoney 等信息
 * @returns {Array} 按综合价值由高到低排序后的卡片评估结果
 */
export function selectBestCard(candidateCards, posture = 'balanced', context = {}) {
  const { gaps = {}, targetUnitMix = {}, categoryCounts = {}, totalLivingUnits = 0, isSurplusMoney = false } = context;

  const scored = [];
  for (const card of candidateCards) {
    const cardId = card.id;
    let baseScore = 50;
    let tier = 'C';

    if (posture === 'offensive') {
      // 进攻态势：攻击强化 > 突破装甲/重装兵种 > 空中打击 > 机动卡 > 科技 > 防御卡
      if (cardId === 23) { // Assault Art
        baseScore = 200 + (gaps.assaultGaps?.length ? 40 : 0);
        tier = 'S';
      } else if (cardId === 25) { // Commander
        baseScore = 190;
        tier = 'S';
      } else if (cardId === 5 || cardId === 4) { // Heavy Tank, Tank
        baseScore = 175;
        tier = 'A';
      } else if (cardId === 11 || cardId === 10 || cardId === 13) { // Bomber, Airstrike, Nuke
        baseScore = 160;
        tier = 'A';
      } else if (cardId === 27) { // Ace Forces
        baseScore = 150;
        tier = 'A';
      } else if (cardId === 3 || cardId === 1 || cardId === 2) { // Rocket, Armour, Artillery
        baseScore = 140;
        tier = 'A';
      } else if (cardId === 22) { // Carrier 机动卡
        baseScore = 115;
        tier = 'B';
      } else if (cardId === 28 || cardId === 0) { // Infantry
        baseScore = 95;
        tier = 'B';
      } else if (cardId === 21) { // Research 科技升级
        baseScore = isSurplusMoney ? 120 : 85;
        tier = 'B';
      } else if (cardId === 26) { // Supply Line 医疗
        baseScore = gaps.healGaps?.length ? 150 : 70;
        tier = gaps.healGaps?.length ? 'A' : 'C';
      } else if ([14, 15, 16].includes(cardId)) { // Economic Dev
        baseScore = 65;
        tier = 'C';
      } else if ([17, 18, 19, 20, 24].includes(cardId)) { // Defenses
        baseScore = 40;
        tier = 'C';
      }
    } else if (posture === 'defensive') {
      // 防御态势：堡垒/屏障 > 紧急医疗/防空/坚守战术 > 步兵/炮兵防守补充 > 反击兵种 > 科技/经济
      if (cardId === 17 || cardId === 18) { // Land Fort, Entrenchment
        baseScore = 210 + (gaps.fortGaps?.length ? 50 : 0);
        tier = 'S';
      } else if (cardId === 26) { // Supply Line 救治主力
        baseScore = 190 + (gaps.healGaps?.length ? 40 : 0);
        tier = 'S';
      } else if (cardId === 24) { // Defend Art
        baseScore = 180;
        tier = 'S';
      } else if (cardId === 19) { // Antiaircraft
        baseScore = 160 + (gaps.aaGaps?.length ? 30 : 0);
        tier = 'A';
      } else if (cardId === 0 || cardId === 2) { // Infantry, Artillery 补防线
        baseScore = 150;
        tier = 'A';
      } else if (cardId === 1 || cardId === 4) { // Armour, Tank 反突击
        baseScore = 130;
        tier = 'B';
      } else if (cardId === 25) { // Commander
        baseScore = 120;
        tier = 'B';
      } else if (cardId === 10 || cardId === 11) { // Air strikes
        baseScore = 90;
        tier = 'B';
      } else if (cardId === 23) { // Assault Art
        baseScore = 45;
        tier = 'C';
      } else if (cardId === 21) { // Research 严禁在防御高压下占用预算
        baseScore = 15;
        tier = 'C';
      } else if ([14, 15, 16].includes(cardId)) {
        baseScore = 25;
        tier = 'C';
      }
    } else {
      // 均势/休整态势：科技升级 > 经济扩张 > 依据学说平衡招募 > 战地维护
      if (cardId === 21) { // Research 科技升级
        baseScore = 170;
        tier = 'S';
      } else if (cardId === 25) { // Commander
        baseScore = 160;
        tier = 'S';
      } else if (cardId === 14 || cardId === 15) { // City, Industry
        baseScore = 150;
        tier = 'A';
      } else if (cardId === 26) { // Supply Line
        baseScore = gaps.healGaps?.length ? 140 : 90;
        tier = 'A';
      } else if (card.type === 'army') {
        const cat = getUnitCategory(card.name);
        const curRatio = totalLivingUnits > 0 ? (categoryCounts[cat] || 0) / totalLivingUnits : 0;
        const tgtRatio = targetUnitMix[cat] ?? 0.2;
        const deficit = tgtRatio - curRatio;
        baseScore = 120 + Math.max(-30, Math.min(60, deficit * 150));
        tier = 'A';
      } else if (cardId === 16 || cardId === 17 || cardId === 18) {
        baseScore = 100;
        tier = 'B';
      } else {
        baseScore = 80;
        tier = 'B';
      }
    }

    scored.push({ card, baseScore, tier });
  }

  return scored.sort((a, b) => b.baseScore - a.baseScore);
}

/**
 * 4. 卡片购买核心调度逻辑 (buyCardLogic)
 * 整合全局态势评估、关键缺口补强、资源约束排序与科技平衡，生成购买与部署指令集。
 */
export function buyCardLogic(model, plan = null, doctrine = {}) {
  const game = model.game;
  const country = model.me;
  const stage = model.st;

  const wallet = country === game.player ? game : stage.countries.get(country);
  if (!wallet) return [];

  let currentMoney = wallet.money ?? 0;
  let currentIndustry = wallet.industry ?? 0;
  if (currentMoney <= 0) return [];

  const commands = [];
  const useCardHandler = handlerFor('useCard');
  const buyCardHandler = handlerFor('buyCard');
  if (!useCardHandler) return [];

  const income = game.income ? game.income(country) : { money: 60, industry: 20 };
  const incMoney = Math.max(1, income.money || 60);
  const incInd = Math.max(1, income.industry || 20);

  const moneyTurns = currentMoney / incMoney;
  const indTurns = currentIndustry / incInd;

  // 学说参数解析
  const doc = (doctrine && doctrine.unitMix) ? doctrine : doctrineFor(game, country);
  const targetUnitMix = { ...(doc?.unitMix || {}) };
  const flag = stage.countries.get(country)?.flag || country;
  if (flag === 'de') {
    targetUnitMix.armor = Math.max(targetUnitMix.armor ?? 0, 0.40);
  } else if (flag === 'ru' || flag === 'su') {
    targetUnitMix.infantry = Math.max(targetUnitMix.infantry ?? 0, 0.55);
  }

  // 储备资金计算 (防积压)
  const isSurplusMoney = moneyTurns >= 2.0 || currentMoney >= 300;
  const isExtremeSurplusMoney = moneyTurns >= 2.8 || currentMoney >= 500;

  let emergencyReserve = 0;
  if (!isSurplusMoney) {
    const reserveTurns = doc?.reserveTurns ?? DEFAULT_RESERVE_TURNS;
    const tMap = model.threatMap ? model.threatMap() : new Map();
    let maxTurnThreatLoss = 0;
    for (const [aId, threat] of tMap.entries()) {
      if (threat.atk > 0) {
        const areaVal = model.areaValue ? model.areaValue(aId) : 50;
        maxTurnThreatLoss = Math.max(maxTurnThreatLoss, threat.atk * (areaVal * 0.05));
      }
    }
    const reserveCap = Math.trunc(currentMoney * MAX_RESERVE_MONEY_FRACTION);
    emergencyReserve = Math.min(reserveCap, Math.trunc(reserveTurns * maxTurnThreatLoss));
  }
  emergencyReserve = Math.min(emergencyReserve, Math.trunc(1.5 * incMoney));

  let spendableMoney = Math.max(0, currentMoney - emergencyReserve);
  let spendableIndustry = currentIndustry;

  // 获得商店有效卡片
  const cardData = game.cardData || stage.data?.cards || { others: [] };
  const catalog = shopCards(cardData, flag);
  const availableCards = catalog.filter(c => !game.whyNot(c, country));

  const armyCards = [];
  const devCards = [];
  const airCards = [];
  const stratCards = [];
  let techCard = null;

  for (const c of availableCards) {
    if (c.type === 'army' || c.type === 'navy') {
      armyCards.push(c);
    } else if (c.type === 'development') {
      devCards.push(c);
    } else if (c.type === 'airforce' || [10, 11, 12, 13].includes(c.id)) {
      airCards.push(c);
    } else if (c.type === 'strategy' || [21, 22, 23, 24, 25, 26, 27].includes(c.id)) {
      stratCards.push(c);
      if (c.id === 21) techCard = c;
    }
  }

  const cardUsageCount = new Map();

  // 经济投资感知与预算控制 (短局长度、剩余回合、中后方纵深与危机态势)
  const totalRounds = game.totalRounds;
  const isShortBattle = (typeof totalRounds === 'number' && totalRounds > 0);
  const currentRound = game.round || 1;
  const remainingRounds = isShortBattle
    ? Math.max(0, totalRounds - currentRound)
    : (STAFF_P.investmentHorizonLongTurns || STAFF_P.investmentHorizonTurns || 25);

  const maxEconBudgetFraction = isShortBattle
    ? (STAFF_P.maxEconomicBudgetFractionShort ?? 0.20)
    : (STAFF_P.maxEconomicBudgetFractionLong ?? 0.45);
  const maxEconBudget = spendableMoney * maxEconBudgetFraction;

  let turnEconSpent = 0;
  let turnCitiesBuilt = 0;
  let turnIndustriesBuilt = 0;
  let turnAirportsBuilt = 0;

  const myLandAreas = model.mine.filter(a => a.land);
  const avgPLose = myLandAreas.length > 0
    ? (myLandAreas.reduce((sum, a) => sum + (model.pLose ? (model.pLose(a.id) || 0) : 0), 0) / myLandAreas.length)
    : 0;
  const isCrisisState = avgPLose > (STAFF_P.economicCriticalPLoseLimit ?? 0.35);

  const frontDepthMap = computeFrontDepth(stage, country, model);

  function canAffordCard(card) {
    if (!card) return false;
    const price = game.price(card, country);
    const indCost = game.industryCost(card, country);
    if (price > spendableMoney || indCost > spendableIndustry) return false;
    const usage = cardUsageCount.get(card.id) || 0;
    if ((card.round || 0) > 0 && usage >= 1) return false;
    return true;
  }

  function commitSpend(card) {
    const price = game.price(card, country);
    const indCost = game.industryCost(card, country);
    spendableMoney = Math.max(0, spendableMoney - price);
    spendableIndustry = Math.max(0, spendableIndustry - indCost);
    cardUsageCount.set(card.id, (cardUsageCount.get(card.id) || 0) + 1);
  }

  // 统计在场存活各军兵种数量
  const categoryCounts = { infantry: 0, armor: 0, artillery: 0, rocket: 0, elite: 0, navy: 0 };
  let totalLivingUnits = 0;
  for (const a of model.mine) {
    for (const u of (a.armies || [])) {
      const cat = getUnitCategory(u.type);
      if (categoryCounts[cat] != null) {
        categoryCounts[cat]++;
        totalLivingUnits++;
      }
    }
  }

  // --- 1. 形势评估与缺口诊断 ---
  const postureInfo = evaluateBattlefieldPosture(model, plan);
  const posture = postureInfo.posture;
  const gaps = scanBattlefieldGaps(model, stage, country, posture, plan);

  const context = {
    gaps,
    targetUnitMix,
    categoryCounts,
    totalLivingUnits,
    isSurplusMoney,
    currentMoney,
    currentIndustry,
    spendableMoney
  };

  // 排序候选卡片优先级
  const rankedCards = selectBestCard(availableCards, posture, context);

  // Only a small country with a threatened capital qualifies for a fallback.
  const endangered = STAFF_P.endangeredSpendEnabled &&
    myLandAreas.length <= STAFF_P.endangeredMaxLandAreas &&
    totalLivingUnits <= STAFF_P.endangeredMaxUnits &&
    currentMoney >= incMoney * STAFF_P.endangeredMinMoneyIncomeRatio &&
    capitalUnderAttack(game, stage, country);

  const countryInfo = stage.countries.get(country);
  const techLevel = country === game.player ? game.tech : (wallet.techlevel ?? wallet.tech ?? 1);
  const techDecision = shouldPrioritizeTech(model, country, techLevel, plan);
  const targetTechGoal = techDecision.recommendedLevel;

  // --- 辅助执行函数：战略支援卡执行 ---
  function tryAppointCommander() {
    const card25 = stratCards.find(c => c.id === 25);
    if (card25 && canAffordCard(card25) && countryInfo && !countryInfo.commanderAlive && (countryInfo.commanderTurn || 0) <= 0) {
      let bestUnitArea = null, bestScore = 0;
      for (const area of model.mine) {
        if (!area.armies || area.armies.length === 0) continue;
        const unit = area.armies[0];
        if (!unit || (unit.cards & 8)) continue;
        const rankScore = ['heavytank', 'tank', 'battleship'].includes(unit.type) ? 500 :
                          ['artillery', 'rocket', 'cruiser', 'panzer'].includes(unit.type) ? 300 : 100;
        const score = rankScore + (unit.hp || 0) + (unit.level || 0) * 30;
        if (score > bestScore) {
          bestScore = score;
          bestUnitArea = area;
        }
      }
      if (bestUnitArea && bestScore > 200) {
        const cmd = { type: 'useCard', country, card: 25, target: bestUnitArea.id, pendingPurchase: true };
        if (useCardHandler.validate(game, cmd) == null) {
          commands.push(cmd);
          commitSpend(card25);
          return true;
        }
      }
    }
    return false;
  }

  function trySupplyLine() {
    const card26 = stratCards.find(c => c.id === 26);
    if (!card26 || !canAffordCard(card26)) return false;

    // 优先补救扫描出的严重缺口地块
    const targetAreas = gaps.healGaps.length > 0 ? gaps.healGaps.map(g => g.area) : model.mine;
    for (const area of targetAreas) {
      if (!area.armies || area.armies.length === 0) continue;
      const unit = area.armies[0];
      if (!unit) continue;
      const hasGeneral = area.armies.some(a => a.cards & 8);
      const isSuperArmor = ['heavytank', 'tank', 'panzer'].includes(unit.type) && unit.hp < (unit.maxHp || 100) * 0.65;
      const totalLostHp = area.armies.reduce((sum, a) => sum + ((a.maxHp || 100) - (a.hp || 0)), 0);

      if ((hasGeneral && unit.hp < (unit.maxHp || 100) * 0.7) || isSuperArmor || totalLostHp >= 80) {
        const cmd = { type: 'useCard', country, card: 26, target: area.id, pendingPurchase: true };
        if (useCardHandler.validate(game, cmd) == null) {
          commands.push(cmd);
          commitSpend(card26);
          return true;
        }
      }
    }
    return false;
  }

  function tryTacticalBuffs(preferred = 'any') {
    const card23 = stratCards.find(c => c.id === 23); // Assault Art
    const card24 = stratCards.find(c => c.id === 24); // Defend Art
    let executed = false;

    // 若有突击强化缺口，优先赋能前线装甲或突击部队
    if ((preferred === 'assault' || preferred === 'any') && card23 && canAffordCard(card23)) {
      for (const gap of gaps.assaultGaps) {
        if (!canAffordCard(card23)) break;
        const cmd = { type: 'useCard', country, card: 23, target: gap.area.id, pendingPurchase: true };
        if (useCardHandler.validate(game, cmd) == null) {
          commands.push(cmd);
          commitSpend(card23);
          gap.unit.cards |= 1;
          executed = true;
        }
      }
    }

    // 防御坚守卡赋能前线危险或据守要塞
    if ((preferred === 'defend' || preferred === 'any') && card24 && canAffordCard(card24)) {
      for (const area of model.mine) {
        if (!canAffordCard(card24)) break;
        const unit = area.armies?.[0];
        if (!unit || !model.isFront(area.id) || (unit.cards & 2)) continue;
        const pl = model.pLose ? model.pLose(area.id) : 0;
        if (pl >= 0.35 || area.areaType === 4 || area.installation === 'fort') {
          const cmd = { type: 'useCard', country, card: 24, target: area.id, pendingPurchase: true };
          if (useCardHandler.validate(game, cmd) == null) {
            commands.push(cmd);
            commitSpend(card24);
            unit.cards |= 2;
            executed = true;
          }
        }
      }
    }
    return executed;
  }

  function tryAirStrikePass(maxStrikes = 3) {
    if (airCards.length === 0 || !game.airstrikeRadius) return;
    let airStrikesDone = 0;

    while (airStrikesDone < maxStrikes && spendableMoney > 0) {
      const usableAir = airCards.filter(c => [10, 11, 13].includes(c.id) && canAffordCard(c));
      if (usableAir.length === 0) break;

      let bestAirTarget = null;
      let bestAirScore = -Infinity;
      let bestAirCard = null;

      for (const targetId of stage.enabled) {
        const target = stage.st(targetId);
        if (!target || target.country === country || !target.armies || target.armies.length === 0) continue;
        if (model.rel && model.rel(target.country) !== 'enemy') continue;

        const dist = minDistanceToAirport(stage, country, targetId);
        if (dist <= 0 || dist >= game.airstrikeRadius()) continue;

        const armies = target.armies;
        const hasGeneral = armies.some(a => a.cards & 8);
        const totalHp = armies.reduce((sum, u) => sum + (u.hp || 0), 0);
        const hasArmor = armies.some(a => ['heavytank', 'tank', 'panzer', 'battleship'].includes(a.type));
        const isCapital = target.areaType === 4;
        const hasContact = (stage.adjE.get(targetId) || []).some(nid => stage.st(nid)?.country === country);

        let targetScore = 0;
        if (isCapital) targetScore += 500;
        if (hasGeneral) targetScore += 600;
        if (hasArmor) targetScore += 400;
        const hasNavy = armies.some(a => ['destroyer', 'cruiser', 'battleship', 'aircraftcarrier'].includes(a.type));
        if (hasNavy) targetScore += 500;
        const hasIndustry = target.construction === 'industry' || target.installation === 'industry' || (target.industry > 0);
        if (hasIndustry) targetScore += 400;
        targetScore += armies.length * 150 + Math.min(300, totalHp);
        if (hasContact) targetScore += 300;

        if (plan?.mainFront != null || plan?.mainFrontId != null) {
          const mainFront = plan.mainFront || (plan.fronts || []).find(f => f.id === plan.mainFrontId);
          if (mainFront) {
            if ((mainFront.enemyAreas || []).includes(targetId)) {
              targetScore += 800; // 重点清除主攻战线突破口正面敌军
            } else if ((mainFront.areas || []).includes(targetId)) {
              targetScore += 400;
            }
          }
        }

        let chosenCard = null;
        if (armies.length >= 2 && usableAir.some(c => c.id === 11)) {
          chosenCard = usableAir.find(c => c.id === 11);
        } else if (usableAir.some(c => c.id === 13)) {
          chosenCard = usableAir.find(c => c.id === 13);
        } else {
          chosenCard = usableAir.find(c => c.id === 10) || usableAir[0];
        }

        if (chosenCard && targetScore > bestAirScore) {
          bestAirScore = targetScore;
          bestAirTarget = targetId;
          bestAirCard = chosenCard;
        }
      }

      if (bestAirTarget != null && bestAirCard != null && bestAirScore > 0) {
        const cmd = { type: 'useCard', country, card: bestAirCard.id, target: bestAirTarget, pendingPurchase: true };
        if (useCardHandler.validate(game, cmd) == null) {
          commands.push(cmd);
          commitSpend(bestAirCard);
          airStrikesDone++;
          continue;
        }
      }
      break;
    }
  }

  const installedAreasThisTurn = new Set();
  const constructedAreasThisTurn = new Set();

  /**
   * 态势感知与风险分级的设施/工事综合升级器
   * 严格遵循规则：
   * 1. 前线感知：
   *    - pLose > 0.6 (高危)：优先升级防御工事，其次城市；坚决不升工业/机场。
   *    - 0.35 < pLose <= 0.6 (中危)：城市+工业各半，工业不升至满级，升级工事作为保险。
   *    - pLose <= 0.35 (安全)：按原有逻辑优先工业 > 城市 > 机场。
   * 2. 关键卡位点标记：mustHold、首都要冲、咽喉卡点，防御工事优先级大幅提高一档。
   * 3. 撤退线自动识别：高危前线后方的第二防线据点，提前预埋防御工事。
   * 4. 统一排序与资源约束执行。
   */
  /**
   * 1. 防御性建设 (Card 17 要塞 / Card 18 掩体)
   * 严格基于前线威胁、关键要冲与撤退线预设修筑。
   */
  function executeFortifications(options = {}) {
    if (devCards.length === 0 || spendableMoney <= 0) return 0;

    const facingOpponentProfiles = (plan?.fronts || []).flatMap(f => f.facingProfiles || []);
    const facesManpowerOpponent = facingOpponentProfiles.some(p => p.profile.isManpowerPower);

    const defaultMaxForts = (posture === 'defensive' ? (isSurplusMoney ? 5 : 3) : isSurplusMoney ? 4 : 2) + (facesManpowerOpponent ? 2 : 0);
    const maxForts = options.maxForts ?? defaultMaxForts;
    if (maxForts <= 0) return 0;

    let fortsBuilt = 0;
    const fortCard = devCards.find(c => c.id === 17);
    const entrenchCard = devCards.find(c => c.id === 18);

    const keyHubs = getStrategicKeyHubs(model, plan);
    const retreatLines = identifyRetreatDefenseLine(model, keyHubs);

    const candidates = [];

    for (const a of model.mine) {
      if (!a.land) continue;
      const aId = a.id;
      if (a.installation !== 'none' || installedAreasThisTurn.has(aId)) continue;

      const pl = model.pLose ? (model.pLose(aId) || 0) : 0;
      const isFront = model.isFront(aId);
      const isHub = keyHubs.has(aId);
      const isRetreat = retreatLines.has(aId);

      const isHighRisk = pl > 0.60;
      const isMediumRisk = pl > 0.35 && pl <= 0.60;
      const isSafe = pl <= 0.35;

      let chosenFortCard = null;
      if (fortCard && canAffordCard(fortCard) && (isHighRisk || isHub || spendableIndustry >= 45)) {
        chosenFortCard = fortCard;
      } else if (entrenchCard && canAffordCard(entrenchCard)) {
        chosenFortCard = entrenchCard;
      } else if (fortCard && canAffordCard(fortCard)) {
        chosenFortCard = fortCard;
      }

      if (chosenFortCard) {
        let fortScore = 0;
        if (isHighRisk && isHub) {
          fortScore = 350 + pl * 100;
        } else if (isHighRisk) {
          fortScore = 270 + pl * 80;
        } else if (isMediumRisk && isHub) {
          fortScore = 230 + pl * 60;
        } else if (isRetreat && !isFront) {
          fortScore = 200 + (isHub ? 40 : 0);
        } else if (isMediumRisk) {
          fortScore = 170 + pl * 50;
        } else if (isSafe && isHub && isFront) {
          fortScore = 150;
        }

        if (facesManpowerOpponent && (isFront || isHub || isRetreat)) {
          fortScore += 80;
        }

        if (fortScore > 0) {
          candidates.push({
            type: 'fort',
            area: a,
            card: chosenFortCard,
            score: fortScore,
            isHighRisk,
            isMediumRisk,
            isSafe,
            isHub
          });
        }
      }
    }

    candidates.sort((a, b) => {
      if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
      return a.area.id - b.area.id;
    });

    let totalExecuted = 0;
    for (const cand of candidates) {
      if (spendableMoney <= 0 || fortsBuilt >= maxForts) break;
      const { area, card } = cand;
      if (area.installation !== 'none' || installedAreasThisTurn.has(area.id)) continue;
      if (!canAffordCard(card)) continue;

      const cmd = { type: 'useCard', country, card: card.id, target: area.id, pendingPurchase: true };
      if (useCardHandler.validate(game, cmd) == null) {
        commands.push(cmd);
        commitSpend(card);
        fortsBuilt++;
        totalExecuted++;
        installedAreasThisTurn.add(area.id);
        area.installation = (card.id === 17 ? 'fort' : 'entrenchment');
      }
    }

    return totalExecuted;
  }

  /**
   * 恢复第1轮之前的 Legacy 经济投资行为 (当 STAFF_P.economicLegacy === true 时生效)
   * 绕过纵深限制、回本评估、预算占比、单回合上限与危急熔断
   */
  function executeLegacyEconomicInvestments(options = {}) {
    if (devCards.length === 0 || spendableMoney <= 0) return 0;
    const legacyMinDepth = options.legacyMinDepth ?? STAFF_P.legacyMinDepth ?? 0;
    const legacyPaybackGate = options.legacyPaybackGate ?? STAFF_P.legacyPaybackGate ?? false;
    let totalExecuted = 0;
    const defaultMaxCities = isExtremeSurplusMoney ? 6 : (isSurplusMoney ? 3 : 1);
    const maxCities = options.maxCities ?? defaultMaxCities;
    let citiesBuilt = 0;
    const card14 = devCards.find(c => c.id === 14);
    if (card14 && canAffordCard(card14)) {
      for (const area of model.mine) {
        if (!area.land || citiesBuilt >= maxCities) continue;
        const depth = frontDepthMap.get(area.id) ?? (model.isFront(area.id) ? 0 : 99);
        if (depth < legacyMinDepth) continue;
        if (legacyPaybackGate && isShortBattle) {
          if (!evaluateEconomicPayback(game, country, card14, area, remainingRounds, STAFF_P)) {
            continue;
          }
        }
        const cmd = { type: 'useCard', country, card: 14, target: area.id, pendingPurchase: true };
        if (useCardHandler.validate(game, cmd) == null) {
          commands.push(cmd);
          commitSpend(card14);
          citiesBuilt++;
          totalExecuted++;
        }
      }
    }

    const defaultMaxIndustries = isExtremeSurplusMoney ? 5 : (isSurplusMoney ? 3 : 1);
    const maxIndustries = options.maxIndustries ?? defaultMaxIndustries;
    let industriesBuilt = 0;
    const card15 = devCards.find(c => c.id === 15);
    if (card15 && canAffordCard(card15)) {
      for (const area of model.mine) {
        if (!area.land || industriesBuilt >= maxIndustries) continue;
        const depth = frontDepthMap.get(area.id) ?? (model.isFront(area.id) ? 0 : 99);
        if (depth < legacyMinDepth) continue;
        if (legacyPaybackGate && isShortBattle) {
          if (!evaluateEconomicPayback(game, country, card15, area, remainingRounds, STAFF_P)) {
            continue;
          }
        }
        const cmd = { type: 'useCard', country, card: 15, target: area.id, pendingPurchase: true };
        if (useCardHandler.validate(game, cmd) == null) {
          commands.push(cmd);
          commitSpend(card15);
          industriesBuilt++;
          totalExecuted++;
        }
      }
    }

    const maxAirports = options.maxAirports ?? 1;
    let airportsBuilt = 0;
    const card16 = devCards.find(c => c.id === 16);
    if (card16 && canAffordCard(card16) && spendableMoney >= 100 && airportsBuilt < maxAirports) {
      for (const area of model.mine) {
        if (!area.land || area.construction !== 'none') continue;
        const depth = frontDepthMap.get(area.id) ?? (model.isFront(area.id) ? 0 : 99);
        if (depth < legacyMinDepth) continue;
        const distToExisting = minDistanceToAirport(stage, country, area.id);
        if (distToExisting < 0 || distToExisting > 250) {
          if (model.isFront(area.id)) {
            if (legacyPaybackGate && isShortBattle) {
              if (!evaluateEconomicPayback(game, country, card16, area, remainingRounds, STAFF_P)) {
                continue;
              }
            }
            const cmd = { type: 'useCard', country, card: 16, target: area.id, pendingPurchase: true };
            if (useCardHandler.validate(game, cmd) == null) {
              commands.push(cmd);
              commitSpend(card16);
              airportsBuilt++;
              totalExecuted++;
              break;
            }
          }
        }
      }
    }
    return totalExecuted;
  }

  /**
   * 2. 经济性投资 (Card 14 城市 / Card 15 工业 / Card 16 机场)
   * 严格准入：depth >= 2 (中后方)、!isFront、非前线邻接、低 pLose、回本周期 <= R - margin、ROI >= minRoi。
   * 受每回合经济预算上限与数量上限控制，战局危急或短局终程时全面暂停。
   */
  function executeEconomicInvestments(options = {}) {
    if (STAFF_P.economicLegacy) {
      return executeLegacyEconomicInvestments(options);
    }
    const policy = isShortBattle
      ? (STAFF_P.shortBattleInvestmentPolicy ?? 'legacy_noContact')
      : (STAFF_P.longBattleInvestmentPolicy ?? 'legacy_noContact');
    if (policy === 'legacy_noContact') {
      const minDepth = Math.max(1, STAFF_P.legacyMinDepth ?? 1);
      return executeLegacyEconomicInvestments({
        ...options,
        legacyMinDepth: (options.legacyMinDepth !== undefined && options.legacyMinDepth > minDepth) ? options.legacyMinDepth : minDepth,
      });
    }
    if (devCards.length === 0 || spendableMoney <= 0) return 0;
    // 局势危急或短局剩余回合极短时禁止一切经济投资
    if (isCrisisState || remainingRounds <= (STAFF_P.paybackSafetyMargin ?? 1)) return 0;
    if (turnEconSpent >= maxEconBudget) return 0;

    const baseTurnCities = isShortBattle ? STAFF_P.maxTurnCities : (STAFF_P.maxTurnCitiesLong ?? 4);
    const baseTurnIndustries = isShortBattle ? STAFF_P.maxTurnIndustries : (STAFF_P.maxTurnIndustriesLong ?? 2);
    const baseTurnAirports = isShortBattle ? STAFF_P.maxTurnAirports : (STAFF_P.maxTurnAirportsLong ?? 2);

    const maxCities = isShortBattle
      ? Math.min(options.maxCities ?? baseTurnCities, baseTurnCities)
      : (options.maxCitiesLong ?? baseTurnCities);
    const maxIndustries = isShortBattle
      ? Math.min(options.maxIndustries ?? baseTurnIndustries, baseTurnIndustries)
      : (options.maxIndustriesLong ?? baseTurnIndustries);
    const maxAirports = isShortBattle
      ? Math.min(options.maxAirports ?? baseTurnAirports, baseTurnAirports)
      : (options.maxAirportsLong ?? baseTurnAirports);

    if (turnCitiesBuilt >= maxCities && turnIndustriesBuilt >= maxIndustries && turnAirportsBuilt >= maxAirports) {
      return 0;
    }

    const cityCard = devCards.find(c => c.id === 14);
    const indCard = devCards.find(c => c.id === 15);
    const airportCard = devCards.find(c => c.id === 16);

    const minDepth = STAFF_P.minEconomicDepth ?? 2;
    const maxPLose = STAFF_P.maxEconomicPLose ?? 0.20;

    const candidates = [];

    for (const a of model.mine) {
      if (!a.land) continue;
      const aId = a.id;
      if (constructedAreasThisTurn.has(aId)) continue;

      // 严格检查前线与纵深 (只投中后方)
      if (model.isFront(aId)) continue;
      const depth = frontDepthMap.get(aId) ?? 99;
      if (depth < minDepth) continue;

      const pl = model.pLose ? (model.pLose(aId) || 0) : 0;
      if (pl > maxPLose) continue;

      // 1) 城市升级 (Card 14)
      if (cityCard && turnCitiesBuilt < maxCities && canAffordCard(cityCard)) {
        const canBuildCity = a.construction === 'none' || (a.construction === 'city' && (a.level || 0) < 4);
        if (canBuildCity) {
          const evalRes = evaluateEconomicPayback(game, country, cityCard, a, remainingRounds, STAFF_P);
          if (evalRes) {
            const depthBonus = Math.min(depth, 5) * 15;
            const curLevel = a.construction === 'city' ? (a.level || 0) : 0;
            const levelBonus = (4 - curLevel) * 8;
            const score = evalRes.roi * 100 + depthBonus + levelBonus - pl * 100;
            candidates.push({
              type: 'city',
              area: a,
              card: cityCard,
              score,
              depth,
              paybackTurns: evalRes.paybackTurns,
              roi: evalRes.roi,
              cost: cityCard.price || 0
            });
          }
        }
      }

      // 2) 工业升级 (Card 15)
      if (indCard && turnIndustriesBuilt < maxIndustries && canAffordCard(indCard)) {
        const curLevel = a.construction === 'industry' ? (a.level || 0) : 0;
        const canBuildInd = a.construction === 'none' || (a.construction === 'industry' && curLevel < 3);
        if (canBuildInd) {
          const evalRes = evaluateEconomicPayback(game, country, indCard, a, remainingRounds, STAFF_P);
          if (evalRes) {
            const depthBonus = Math.min(depth, 5) * 15;
            const levelBonus = (3 - curLevel) * 12;
            const score = evalRes.roi * 100 + depthBonus + levelBonus - pl * 100;
            candidates.push({
              type: 'industry',
              area: a,
              card: indCard,
              score,
              depth,
              paybackTurns: evalRes.paybackTurns,
              roi: evalRes.roi,
              cost: indCard.price || 0
            });
          }
        }
      }

      // 3) 机场建设 (Card 16)
      if (airportCard && turnAirportsBuilt < maxAirports && a.construction === 'none' && canAffordCard(airportCard)) {
        const evalRes = evaluateEconomicPayback(game, country, airportCard, a, remainingRounds, STAFF_P);
        if (evalRes) {
          const depthBonus = Math.min(depth, 4) * 10;
          const score = evalRes.roi * 100 + depthBonus - pl * 100;
          candidates.push({
            type: 'airport',
            area: a,
            card: airportCard,
            score,
            depth,
            paybackTurns: evalRes.paybackTurns,
            roi: evalRes.roi,
            cost: airportCard.price || 0
          });
        }
      }
    }

    // 确定性排序 (Tie-break): 彻底消除遍历顺序导致的随机性
    candidates.sort((a, b) => {
      if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
      if (b.depth !== a.depth) return b.depth - a.depth;
      if (Math.abs(a.paybackTurns - b.paybackTurns) > 0.001) return a.paybackTurns - b.paybackTurns;
      return a.area.id - b.area.id;
    });

    let totalExecuted = 0;
    for (const cand of candidates) {
      if (spendableMoney <= 0 || turnEconSpent >= maxEconBudget) break;
      const { type, area, card, cost } = cand;

      if (type === 'city' && turnCitiesBuilt >= maxCities) continue;
      if (type === 'industry' && turnIndustriesBuilt >= maxIndustries) continue;
      if (type === 'airport' && turnAirportsBuilt >= maxAirports) continue;
      if (constructedAreasThisTurn.has(area.id)) continue;
      if (turnEconSpent + cost > maxEconBudget && turnCitiesBuilt + turnIndustriesBuilt + turnAirportsBuilt > 0) continue;
      if (!canAffordCard(card)) continue;

      const cmd = { type: 'useCard', country, card: card.id, target: area.id, pendingPurchase: true };
      if (useCardHandler.validate(game, cmd) == null) {
        commands.push(cmd);
        commitSpend(card);
        turnEconSpent += cost;
        totalExecuted++;
        constructedAreasThisTurn.add(area.id);

        if (type === 'city') {
          turnCitiesBuilt++;
          if (area.construction === 'city') area.level = (area.level || 0) + 1;
          else {
            area.construction = 'city';
            area.level = (area.areaType === 1 ? 4 : area.areaType === 3 ? 3 : area.areaType === 4 ? 2 : 1);
          }
        } else if (type === 'industry') {
          turnIndustriesBuilt++;
          if (area.construction === 'industry') area.level = (area.level || 0) + 1;
          else {
            area.construction = 'industry';
            area.level = (area.areaType === 1 ? 3 : area.areaType === 3 ? 2 : 1);
          }
        } else if (type === 'airport') {
          turnAirportsBuilt++;
          area.construction = 'airport';
          area.level = 1;
        }

        console.log(`[FacilityUpgrade] round=${game.round} country=${country} type=${type} card=${card.id} target=${area.id} depth=${cand.depth} payback=${cand.paybackTurns.toFixed(1)}R roi=${cand.roi.toFixed(2)} score=${cand.score.toFixed(1)}`);
      }
    }

    return totalExecuted;
  }

  function executeFacilityAndFortificationUpgrades(options = {}) {
    let count = 0;
    if (options.maxForts !== 0) {
      count += executeFortifications({ maxForts: options.maxForts });
    }
    if (options.maxCities !== 0 || options.maxIndustries !== 0 || options.maxAirports !== 0) {
      count += executeEconomicInvestments(options);
    }
    return count;
  }

  function tryFortifyGaps(maxForts = 3) {
    return executeFortifications({ maxForts });
  }

  function tryEconomicInvestment(options = {}) {
    return executeEconomicInvestments(options);
  }

  function tryAntiAircraftGaps() {
    const aaCard = devCards.find(c => c.id === 19);
    if (!aaCard || !canAffordCard(aaCard)) return 0;
    let built = 0;
    for (const gap of gaps.aaGaps) {
      if (built >= 2 || !canAffordCard(aaCard)) break;
      const area = gap.area;
      if (area.installation !== 'none') continue;
      const cmd = { type: 'useCard', country, card: 19, target: area.id, pendingPurchase: true };
      if (useCardHandler.validate(game, cmd) == null) {
        commands.push(cmd);
        commitSpend(aaCard);
        area.installation = 'antiaircraft';
        built++;
      }
    }
    return built;
  }

  function tryRecruitUnits(preferOffensive = false) {
    if (armyCards.length === 0 || spendableMoney <= 0) return;

    const fronts = plan?.fronts || [];
    const mainFrontId = plan?.mainFrontId;
    const mainFront = plan?.mainFront || fronts.find(f => f.id === mainFrontId);
    const mainAreas = new Set(mainFront?.friendlyAreas || mainFront?.areas || []);

    const frontGaps = [];
    for (const front of fronts) {
      const isMain = mainFrontId != null && front.id === mainFrontId;
      const R = front.R ?? 1.0;
      if (isMain || R < 1.0) {
        frontGaps.push({ front, isMain, deficit: Math.max(10, (front.P_en || 50) - (front.P_me || 50)) });
      }
    }

    function getScoredCards(base) {
      const isIndustrialBase = base ? (base.construction === 'industry' || base.areaType === 1 || base.areaType === 3) : false;
      const isMainStagingBase = base && (mainAreas.has(base.id) || Array.from(mainAreas).some(faId => (model.dist?.(base.id, faId) ?? 5) <= 2));
      const scored = [];

      for (const card of armyCards) {
        const price = game.price(card, country);
        const indCost = game.industryCost(card, country);
        const creditCost = price + model.wI * indCost;

        const cardCat = getUnitCategory(card.name);
        const currentRatio = totalLivingUnits > 0 ? (categoryCounts[cardCat] / totalLivingUnits) : 0;
        const targetRatio = targetUnitMix[cardCat] ?? 0.2;

        const deficit = targetRatio - currentRatio;
        const priorMultiplier = deficit > 0
          ? (1.0 + Math.min(3.0, deficit * 5.0))
          : Math.max(0.3, 1.0 + deficit * 2.0);

        const armyType = card.name?.toLowerCase().replace(/\s+/g, '');
        const dummyUnit = { type: armyType, hp: 100, maxHp: 100, level: 0, country };
        const val = unitValue(model, dummyUnit);

        let score;
        if (isSurplusMoney || indTurns >= 1.2) {
          let baseWeight = { 5: 130, 4: 120, 3: 95, 2: 85, 1: 80, 28: 65, 0: 45, 8: 35, 7: 30 }[card.id] || 50;
          score = baseWeight * priorMultiplier + val * 0.1;
        } else {
          score = (val * priorMultiplier) / Math.max(1, creditCost);
        }

        if (isIndustrialBase && (cardCat === 'armor' || cardCat === 'artillery')) {
          score += (flag === 'de' ? 80 : 40);
        }

        // 主攻方向与集结点：强力加权进攻突破武器(装甲、重坦、重炮、火箭)
        if (isMainStagingBase) {
          if (['armor', 'artillery', 'rocket'].includes(cardCat)) score *= 1.50;
        } else if (preferOffensive) {
          if (['armor', 'artillery', 'rocket'].includes(cardCat)) score *= 1.35;
        } else if (posture === 'defensive') {
          if (cardCat === 'infantry' || cardCat === 'artillery') score *= 1.30;
        }

        scored.push({ card, cardCat, score, creditCost });
      }
      return scored.sort((a, b) => b.score - a.score);
    }

    function calculateBaseScore(b) {
      let score = (b.areaType === 1 ? 60 : 0) + (b.construction === 'industry' ? 40 : 0) + (model.isFront(b.id) ? 35 : 0) + (b.areaType === 4 ? 30 : 0);

      // 主攻战线及其后方集结点大倾斜
      const isDirectMainFront = mainAreas.has(b.id);
      let minMainDist = Infinity;
      for (const mId of mainAreas) {
        const d = model.dist ? model.dist(b.id, mId) : 5;
        if (d < minMainDist) minMainDist = d;
      }

      if (isDirectMainFront) {
        score += 180; // 主攻前沿直接加固
      } else if (minMainDist === 1) {
        score += 150; // 主攻第一后方集结点 (集结投放成建制集团)
      } else if (minMainDist === 2) {
        score += 90;  // 主攻第二后方集结点
      } else {
        // 非主攻方向：按最低水准维持
        const bPLose = model.pLose ? (model.pLose(b.id) || 0) : 0;
        const isThreatened = bPLose >= 0.40 || b.stackCount === 0;
        if (!isThreatened && b.stackCount >= 1 && !isSurplusMoney) {
          score -= 90; // 抑制在和平非主攻次要边境分散投兵
        }
      }

      if (isSurplusMoney) {
        score += (b.cap - b.stackCount) * 10;
      }
      return score;
    }

    const recruitBases = model.mine
      .filter(a => a.land && a.stackCount < a.cap)
      .sort((a, b) => calculateBaseScore(b) - calculateBaseScore(a));

    for (const base of recruitBases) {
      if (spendableMoney <= 0) break;
      while (base.stackCount < base.cap && spendableMoney > 0) {
        const scoredCards = getScoredCards(base);
        let recruited = false;

        for (const { card, cardCat } of scoredCards) {
          if (!canAffordCard(card)) continue;
          const cmd = { type: 'useCard', country, card: card.id, target: base.id, pendingPurchase: true };
          if (useCardHandler.validate(game, cmd) == null) {
            commands.push(cmd);
            commitSpend(card);
            base.stackCount++;
            categoryCounts[cardCat] = (categoryCounts[cardCat] || 0) + 1;
            totalLivingUnits++;
            recruited = true;
            break;
          }
        }
        if (!recruited) break;
      }
    }
  }

  function tryTechUpgrade(allowAggressive = false, options = {}) {
    // 科技升级前瞻性约束：达到建议等级或顶级科技(5)不再无脑升
    if (!techCard || !buyCardHandler || techLevel >= targetTechGoal || techLevel >= 5) return false;
    const price = game.price(techCard, country);
    if (!canAffordCard(techCard)) return false;

    // 科技优先时：预留指定比例(例如50%)预算给前线防御缺口
    const reserveFraction = options.budgetReserveFraction ?? 0;
    if (reserveFraction > 0) {
      const budgetAfter = spendableMoney - price;
      // 检查是否存在紧迫防御缺口需求
      const hasDefGap = (gaps.fortGaps?.length > 0) || (gaps.healGaps?.length > 0);
      if (hasDefGap && budgetAfter < Math.trunc(spendableMoney * reserveFraction)) {
        return false; // 留够50%预算给防御缺口
      }
    }

    // 非科技优先时：防御/工事完成后，仅在剩余预算充裕时升级
    if (options.requireSurplus) {
      if (spendableMoney < price + 60 && !isSurplusMoney) {
        return false;
      }
    }

    const buyCmd = { type: 'buyCard', country, card: 21 };
    if (buyCardHandler.validate(game, buyCmd) == null) {
      commands.push(buyCmd);
      commitSpend(techCard);
      return true;
    }
    return false;
  }

  function executeEmergencyFrontlineRecruit() {
    const threatenedMine = model.mine
      .filter(a => a.land && model.pLose(a.id) >= EMERGENCY_DEFENSE_PLOSE_THRESHOLD && a.stackCount < a.cap)
      .sort((a, b) => model.areaValue(b.id) - model.areaValue(a.id));

    for (const area of threatenedMine) {
      if (spendableMoney <= 0) break;
      while (area.stackCount < area.cap && spendableMoney > 0) {
        let deployed = false;
        const defenseRecruits = [...armyCards].sort((a, b) => {
          const catA = getUnitCategory(a.name);
          const catB = getUnitCategory(b.name);
          const pA = (catA === 'infantry' ? 30 : catA === 'artillery' ? 20 : 10);
          const pB = (catB === 'infantry' ? 30 : catB === 'artillery' ? 20 : 10);
          return pB - pA;
        });
        for (const card of defenseRecruits) {
          if (!canAffordCard(card)) continue;
          const cmd = { type: 'useCard', country, card: card.id, target: area.id, pendingPurchase: true };
          if (useCardHandler.validate(game, cmd) == null) {
            commands.push(cmd);
            commitSpend(card);
            area.stackCount++;
            const cardCat = getUnitCategory(card.name);
            categoryCounts[cardCat] = (categoryCounts[cardCat] || 0) + 1;
            totalLivingUnits++;
            deployed = true;
            break;
          }
        }
        if (!deployed) break;
      }
    }
  }

  function tryPromoteAceForces() {
    const card27 = stratCards.find(c => c.id === 27);
    if (card27 && canAffordCard(card27)) {
      for (const gap of gaps.assaultGaps) {
        if (!canAffordCard(card27)) break;
        const cmd = { type: 'useCard', country, card: 27, target: gap.area.id, pendingPurchase: true };
        if (useCardHandler.validate(game, cmd) == null) {
          commands.push(cmd);
          commitSpend(card27);
          break;
        }
      }
    }
  }

  function tryInfantryMobility() {
    const card22 = stratCards.find(c => c.id === 22);
    if (card22 && canAffordCard(card22)) {
      for (const area of model.mine) {
        if (!canAffordCard(card22)) break;
        const unit = area.armies?.[0];
        if (unit && getUnitCategory(unit.type) === 'infantry' && !(unit.cards & 4) && model.isFront(area.id)) {
          const cmd = { type: 'useCard', country, card: 22, target: area.id, pendingPurchase: true };
          if (useCardHandler.validate(game, cmd) == null) {
            commands.push(cmd);
            commitSpend(card22);
            unit.cards |= 4;
            break;
          }
        }
      }
    }
  }

  function tryEconomicInvestment() {
    return executeFacilityAndFortificationUpgrades();
  }

  // =========================================================================
  // --- 5. 按照科技形势感知与战局态势执行动态分级采购流 ---
  // =========================================================================
  if (techDecision.shouldFocus) {
    // -----------------------------------------------------------------------
    // 新逻辑 A: shouldFocus科技 -> 科技优先 (但留50%预算给防御缺口)
    // -----------------------------------------------------------------------
    // 1) Tier S: 将领任命 (Card 25)
    tryAppointCommander();

    // 2) 科技优先：先执行科技升级 (严格要求保留50%预算供防御缺口救急)
    tryTechUpgrade(true, { budgetReserveFraction: 0.50 });

    // 3) 坚决动用预留预算补强防御与主力维护
    // 3.1 濒死主力/将领战地医疗 (Card 26)
    trySupplyLine();
    // 3.2 紧急要塞/掩体补防线缺口与卡位加固 (Card 17/18，杜绝在此阶段夹带经济投资)
    executeFortifications({ maxForts: isSurplusMoney ? 4 : 2 });
    // 3.3 关键地块坚守战术卡加持 (Card 24)
    tryTacticalBuffs('defend');
    // 3.4 空袭威胁区域防空设施 (Card 19)
    tryAntiAircraftGaps();
    // 3.5 受威胁地块紧急招募填线
    executeEmergencyFrontlineRecruit();

    // 4) 战术突击与王牌部队强化 (Card 23/27/22)
    tryTacticalBuffs('assault');
    tryPromoteAceForces();
    tryInfantryMobility();

    // 5) 作战兵力招募与空中压制打击
    tryRecruitUnits(posture === 'offensive');
    tryAirStrikePass(isSurplusMoney ? 4 : 2);

    // 6) 发展与基础设施投资 (要塞补位 + 严格准入的中后方经济投资)
    executeFortifications({ maxForts: 2 });
    executeEconomicInvestments({ maxCities: isSurplusMoney ? 2 : 1, maxIndustries: isSurplusMoney ? 1 : 0 });

  } else {
    // -----------------------------------------------------------------------
    // 新逻辑 B: 非科技优先 -> 防御/防御工事优先，只有剩余预算才投科技
    // -----------------------------------------------------------------------
    // 1) Tier S: 将领任命 (Card 25)
    tryAppointCommander();

    // 2) 防御/防御工事绝对优先：全力修补要塞、掩体、防空与医疗
    // 2.1 紧急要塞/掩体补防线缺口与卡位加固 (Card 17/18，杜绝在此阶段夹带经济投资)
    executeFortifications({ maxForts: isSurplusMoney ? 5 : 3 });
    // 2.2 濒死主力/将领战地医疗 (Card 26)
    trySupplyLine();
    // 2.3 关键地块坚守战术卡加持 (Card 24)
    tryTacticalBuffs('defend');
    // 2.4 空袭威胁区域防空设施 (Card 19)
    tryAntiAircraftGaps();
    // 2.5 受威胁地块紧急招募填线
    executeEmergencyFrontlineRecruit();

    // 3) 根据战况进行作战招募与战术卡
    if (posture === 'offensive') {
      tryTacticalBuffs('assault');
      tryPromoteAceForces();
      tryAirStrikePass(isExtremeSurplusMoney ? 6 : (isSurplusMoney ? 4 : 3));
      tryRecruitUnits(true);
      trySupplyLine();
      tryInfantryMobility();
    } else {
      tryRecruitUnits(false);
      tryAirStrikePass(isSurplusMoney ? 3 : 2);
    }

    // 4) 只有剩余预算才投科技 (且当前科技未达推荐目标等级)
    tryTechUpgrade(false, { requireSurplus: true });

    // 5) 后方设施升级 (要塞补位 + 严格准入的中后方经济投资)
    executeFortifications({ maxForts: 2 });
    executeEconomicInvestments({ maxCities: 1, maxIndustries: isSurplusMoney ? 1 : 0 });
  }

  // --- 6. 剩余资金清仓 (确保回合末资金 <= 3 倍回合收入) ---
  if (spendableMoney > 1.8 * incMoney) {
    // 6.1 追加空袭 (Airstrike 10)
    const card10 = airCards.find(c => c.id === 10);
    if (card10 && canAffordCard(card10)) {
      for (const targetId of stage.enabled) {
        if (spendableMoney <= 1.8 * incMoney) break;
        const target = stage.st(targetId);
        if (!target || target.country === country || !target.armies || target.armies.length === 0) continue;
        const dist = minDistanceToAirport(stage, country, targetId);
        if (dist <= 0 || dist >= game.airstrikeRadius()) continue;
        const cmd = { type: 'useCard', country, card: 10, target: targetId, pendingPurchase: true };
        if (useCardHandler.validate(game, cmd) == null) {
          commands.push(cmd);
          commitSpend(card10);
        }
      }
    }

    // 6.2 任意有空闲容量的基地补募部队
    const allFreeBases = model.mine.filter(a => a.land && a.stackCount < a.cap);
    for (const base of allFreeBases) {
      if (spendableMoney <= 1.8 * incMoney) break;
      while (base.stackCount < base.cap && spendableMoney > 1.8 * incMoney) {
        let placed = false;
        for (const card of armyCards) {
          if (!canAffordCard(card)) continue;
          const cmd = { type: 'useCard', country, card: card.id, target: base.id, pendingPurchase: true };
          if (useCardHandler.validate(game, cmd) == null) {
            commands.push(cmd);
            commitSpend(card);
            base.stackCount++;
            totalLivingUnits++;
            placed = true;
            break;
          }
        }
        if (!placed) break;
      }
    }

    // 6.3 态势感知防务修补与克制的中后方发展 (严格禁止短局后半程及前线乱建追加)
    const activePolicy = isShortBattle
      ? (STAFF_P.shortBattleInvestmentPolicy ?? 'legacy_noContact')
      : (STAFF_P.longBattleInvestmentPolicy ?? 'legacy_noContact');
    const isLegacyBranch = STAFF_P.economicLegacy || (activePolicy === 'legacy_noContact');
    if (isLegacyBranch) {
      // Legacy 7.3 清仓：只要剩余钱多，在所有领地追加建城市或工业
      // 当 STAFF_P.economicLegacy 为 true 时继承其 legacyMinDepth (默认 0)；
      // 当由 legacy_noContact 触发时强制 legacyMinDepth >= 1，保证短局与长局所有分支接触线 (depth 0) 投资恒为 0
      const legacyMinDepth = STAFF_P.economicLegacy
        ? (STAFF_P.legacyMinDepth ?? 0)
        : Math.max(1, STAFF_P.legacyMinDepth ?? 1);
      const anyDevCard = devCards.find(c => c.id === 14 || c.id === 15);
      if (anyDevCard && canAffordCard(anyDevCard)) {
        for (const area of model.mine) {
          if (spendableMoney <= 1.8 * incMoney) break;
          if (!area.land) continue;
          const depth = frontDepthMap.get(area.id) ?? (model.isFront(area.id) ? 0 : 99);
          if (depth < legacyMinDepth) continue;
          const cmd = { type: 'useCard', country, card: anyDevCard.id, target: area.id, pendingPurchase: true };
          if (useCardHandler.validate(game, cmd) == null) {
            commands.push(cmd);
            commitSpend(anyDevCard);
          }
        }
      }
    } else {
      executeFortifications({ maxForts: 2 });
      if (!isShortBattle || remainingRounds > 4) {
        executeEconomicInvestments({ maxCities: 1, maxIndustries: 1, maxAirports: 0 });
      }
    }
  }

  // A card can consume the planning budget and then fail the queue's second
  // validation. In that case use actual wallet money for a valid infantry order.
  if (endangered) {
    const hasPayingOrder = commands.some(cmd => {
      if (cmd.type !== 'useCard' && cmd.type !== 'buyCard') return false;
      const card = availableCards.find(c => c.id === cmd.card);
      return card && game.price(card, country) > 0 &&
        handlerFor(cmd.type)?.validate(game, cmd) == null;
    });
    if (!hasPayingOrder) {
      spendableMoney = currentMoney;
      for (const cardId of [0, 17, 18, 19, 15, 14]) {
        const card = availableCards.find(c => c.id === cardId);
        if (!card || !canAffordCard(card)) continue;
        const base = model.mine.find(a => a.land && a.stackCount < a.cap &&
          useCardHandler.validate(game, { type: 'useCard', country, card: cardId, target: a.id, pendingPurchase: true }) == null);
        if (!base) continue;
        commands.unshift({ type: 'useCard', country, card: cardId, target: base.id, pendingPurchase: true });
        break;
      }
    }
  }
  return commands;
}

/**
 * 为行动国构造派生视图，使 useCard/buyCard 校验在"以本国为行动国"的语义下工作，
 * 避免在战争迷雾下对只读代理对象赋值抛出 TypeError。
 */
function createActiveCountryGameView(game, country) {
  if (!game || game.activeCountry === country) return game;
  return Object.create(game, {
    activeCountry: {
      value: country,
      writable: true,
      configurable: true,
      enumerable: true
    }
  });
}

/**
 * 参谋部生产与招募总入口 (保持与 staff.js 及外部架构无缝兼容)
 */
export function produceCommands(model, plan = null, doctrine = {}) {
  const game = model.game;
  const country = model.me;

  const effectiveGame = createActiveCountryGameView(game, country);
  const effectiveModel = (effectiveGame === game) ? model : Object.create(model, {
    game: {
      value: effectiveGame,
      writable: true,
      configurable: true,
      enumerable: true
    }
  });

  return buyCardLogic(effectiveModel, plan, doctrine);
}
