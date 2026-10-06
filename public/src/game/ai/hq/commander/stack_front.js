import { STAFF_P } from '../staff/params_staff.js';
import { threatMap } from '../core/threat.js';

const FRAGILE_RANGED_TYPES = new Set(['artillery', 'rocket', 'aircraftcarrier']);
const ARMOUR_TYPES = new Set(['panzer', 'tank', 'heavytank']);

/**
 * 评估地块内某个单位作为防守顶层（前排肉盾）的承伤与战术价值评分
 * 目标：最大化该地块抵挡伤害的能力，避免脆弱珍贵单位承伤，兼顾反击杀伤。
 */
export function scoreStackFrontArmy(army, area, stage, country, threats = [], params = STAFF_P) {
  if (!army) return -Infinity;

  const hp = Math.max(0, army.hp ?? 100);
  const maxHp = Math.max(1, army.maxHp ?? 100);
  const hpRatio = Math.min(1.0, hp / maxHp);

  const defDef = stage.armyDef(country, army) || {};
  const level = Math.max(0, Math.min(4, Math.trunc(army.level || 0)));

  // 1. 防御力加成计算（与 combatModel.js 对齐）
  const levelDef = level >= 2 ? 1 : 0;
  const cardDef = (army.cards & 2) ? 1 : 0;
  const fortDef = (area.installation === 'fort' || area.installation === 'entrenchment' || area.areaType === 1) ? 1 : 0;
  const cmdrBonus = (army.cards & 8) ? 1 : 0;
  const baseDef = defDef.defence ?? defDef.cost?.defence ?? 2;
  const effectiveDef = baseDef + levelDef + cardDef + fortDef + cmdrBonus;

  // 2. 装甲与硬度加成
  const isArmour = ARMOUR_TYPES.has(army.type);
  const armourBonus = isArmour ? 1.0 : 0.0;

  // 3. 珍贵/脆弱二线单位保护惩罚
  let preciousPenalty = 0.0;
  if (FRAGILE_RANGED_TYPES.has(army.type)) {
    preciousPenalty += 1.0;
  }
  // 濒死残血惩罚（避免前排被单次致命斩杀导致地块失守，除非其防御属性压倒性胜出）
  if (hpRatio < 0.25 || hp < 30) {
    preciousPenalty += 0.8;
  }

  // 4. 反击输出潜力估算（基于骰数与攻击均值）
  const minAtk = defDef.minAttack ?? 0;
  const maxAtk = defDef.maxAttack ?? minAtk;
  const avgAtk = (minAtk + maxAtk) / 2;
  const diceCount = (hpRatio >= 0.5) ? 5 : (hpRatio >= 0.25 ? 4 : (hpRatio >= 0.15 ? 3 : 2));
  const counterValue = (diceCount * avgAtk) / 5.0;

  // 5. 针对直面敌方威胁兵种的克制微调
  let matchupBonus = 0.0;
  if (threats && threats.length > 0) {
    const hasDirectThreat = threats.some(t => !FRAGILE_RANGED_TYPES.has(t.type));
    if (isArmour && hasDirectThreat) {
      matchupBonus += 0.5;
    }
  }

  return (
    hp * params.stackFrontHpWeight +
    hpRatio * params.stackFrontHpRatioWeight +
    effectiveDef * params.stackFrontDefenceWeight +
    (armourBonus + matchupBonus) * params.stackFrontArmourBonus +
    counterValue * params.stackFrontCounterWeight -
    preciousPenalty * params.stackFrontPreciousPenalty
  );
}

/**
 * 纯函数：规划并生成防御堆叠的 frontArmy 命令列表
 *
 * @param {object} modelOrGame - HqAi 的 model 或游戏 game 实例
 * @param {string} country - 行动方国家代码
 * @param {object} [options] - 上下文选项
 *   - order: 相关的集团军/战区 order（若存在）
 *   - manualUnits: Set 或 Array，禁止自动调整顺序的玩家手动操作单位
 *   - allowedAreas: 允许调整的地块 ID 集合（若传入则只处理这些地块）
 *   - params: 参数覆盖（默认读取 STAFF_P）
 * @returns {Array<object>} frontArmy 命令数组 [{ type: 'frontArmy', from: areaId, armyId: armyId }]
 */
export function planStackFrontCommands(modelOrGame, country, options = {}) {
  const params = options.params || STAFF_P;
  if (params.stackFrontEnabled === false) return [];

  const game = modelOrGame.game || modelOrGame;
  const stage = game.stage;
  if (!stage || !country) return [];

  const manualSet = new Set(options.manualUnits || game.coordination?.manual || []);
  const order = options.order || null;

  // 1. 获取威胁情报（若有 model 则从 model 获取，否则安全创建临时视图）
  let threatsByArea = null;
  try {
    if (modelOrGame.units && modelOrGame.st) {
      threatsByArea = threatMap(modelOrGame);
    }
  } catch {
    threatsByArea = null;
  }

  // 2. 确定防御性地块候选集
  let candidateAreaIds = null;
  if (options.allowedAreas) {
    candidateAreaIds = new Set(options.allowedAreas);
  } else if (order) {
    // 玩家或集团军命令上下文：仅覆盖防御性指令关联的地块
    if (!['defend', 'delay', 'screen'].includes(order.verb)) {
      return [];
    }
    const defAreas = [];
    if (order.to != null) {
      if (Array.isArray(order.to)) defAreas.push(...order.to);
      else defAreas.push(order.to);
    }
    if (Array.isArray(order.mustHold)) defAreas.push(...order.mustHold);
    if (Array.isArray(order.line)) defAreas.push(...order.line);

    // 加上所辖单位当前实际所在的地块
    if (order.plan?.assignments) {
      for (const item of Object.values(order.plan.assignments)) {
        if (item.area != null) defAreas.push(item.area);
      }
    }
    candidateAreaIds = new Set(defAreas);
  }

  const commands = [];

  for (const area of stage.areas) {
    if (area.country !== country) continue;
    if (!area.armies || area.armies.length <= 1) continue;

    // 若指定了地块范围，过滤不在范围内的地块
    if (candidateAreaIds && !candidateAreaIds.has(area.id)) continue;

    // 若是无指定 order 的 AI 全局回合，仅对受威胁地块或防线相邻敌军的地块生效
    if (!order && !candidateAreaIds) {
      const areaThreat = threatsByArea?.get(area.id);
      const isDirectThreatened = Boolean(areaThreat && (areaThreat.atk > 0 || (areaThreat.units && areaThreat.units.length > 0)));
      const hasAdjacentEnemy = (stage.adjE.get(area.id) || []).some(nId => {
        const nArea = stage.st(nId);
        return nArea && nArea.country && nArea.country !== country && !stage.areAllied(country, nArea.country);
      });
      if (!isDirectThreatened && !hasAdjacentEnemy) {
        // 未受敌军直接威胁且非前线接触地块，纯后方堆叠无需调整
        continue;
      }
    }

    // 3. 时机安全校验：
    // 若显式要求行动力必须耗尽（如中途机动），则校验 movement；
    // 默认在回合末尾/指令待命时，堆叠内防守待命单位均已就绪可调整顶层
    if (options.requireMovementExhausted) {
      const hasUnactedUnits = area.armies.some(a => stage.canAct(a) && (a.movement == null || a.movement > 0));
      if (hasUnactedUnits) {
        continue;
      }
    }

    // 4. 与玩家体验一致：玩家手动排好的堆叠顺序，若未下达防御指令则不调整
    const isHumanArea = (stage.isHumanArea ? stage.isHumanArea(area.id) : false) && (game.player === country);
    if (isHumanArea && !order) {
      continue;
    }

    const currentFront = area.armies[0];
    const areaThreatUnits = threatsByArea?.get(area.id)?.units || [];

    const currentScore = scoreStackFrontArmy(currentFront, area, stage, country, areaThreatUnits, params);
    let bestIndex = 0;
    let bestScore = currentScore;

    for (let i = 1; i < area.armies.length; i++) {
      const army = area.armies[i];
      if (manualSet.has(army.id)) continue; // 被 manual 锁定的手动单位不要动
      const sc = scoreStackFrontArmy(army, area, stage, country, areaThreatUnits, params);
      if (sc > bestScore) {
        bestScore = sc;
        bestIndex = i;
      }
    }

    // 防抖与最优性校验：如果已经在最顶层，或者评分提升没有超过门槛，则不发命令
    const minDiff = params.stackFrontMinImprovement ?? 10.0;
    if (bestIndex !== 0 && (bestScore - currentScore) >= minDiff) {
      const bestArmy = area.armies[bestIndex];
      commands.push({
        type: 'frontArmy',
        from: area.id,
        armyId: bestArmy.id,
        score: bestScore,
        aiReason: 'defend_stack_front',
      });
    }
  }

  return commands;
}
