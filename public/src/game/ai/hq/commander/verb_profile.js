/**
 * 战术指令档案 (Verb Profiles)
 * 集中管理各战术动词的因子权重、行为过滤与玩家风险/优先级响应规则。
 * 严格限定仅在玩家战术指令路径 (obedient Commander / order_executor) 生效，
 * 不影响 AI 国家的战略 HqAi。
 */

import { attackFacingKind } from '../../../direction.js';

// 总开关（默认严格模式开启，仅在无头评测对比旧行为时允许通过 setObedientStrict(false) 回到旧行为）
export let OBEDIENT_STRICT = true;
export let ALLOUT_ENABLED = true;
export function setAlloutEnabled(value) { ALLOUT_ENABLED = Boolean(value); }
export function setObedientStrict(val) {
  OBEDIENT_STRICT = Boolean(val);
}

// 第 8 轮修复总开关（默认开启；关闭时与 BASE 行为一致，便于对比）
export let OT_FIX8_ENABLED = true;
export function setOtFix8Enabled(val) {
  OT_FIX8_ENABLED = Boolean(val);
}
export const setOtFix8 = setOtFix8Enabled;

// 第 8 轮阈值与参数配置
export const REAR_MARCH_BONUS_BASE = 80;        // 后方赶路单位推进基础奖励
export const MULTI_MOVE_MIN_PROFIT_RATIO = 1.0; // 剩余移动力再次进攻的最低交换比预期
export const MULTI_MOVE_MAX_SUICIDE_P = 0.35;   // 剩余移动力再次进攻允许的最大阵亡率（防送死）
export const REST_HP_RATIO_THRESHOLD = 0.35;    // 休整判定HP阈值（低于此比例允许留守休整）
export const EN_ROUTE_MAX_STAGNANT_ROUNDS = 3;  // 在途单位最大允许无进展（距离不缩短）回合数

export function isOtFix8Active(order) {
  return OT_FIX8_ENABLED && Boolean(order?.obedient) && Boolean(order?.isPlayerOrder);
}

// 高风险强攻极低胜率预估阈值（默认 < 10% 即 0.10）
export const HIGH_RISK_WIN_RATE_THRESHOLD = 0.10;

export const VERB_PROFILES = Object.freeze({
  allout: {
    verb: 'allout', enabled: true, maxZeroGainAttacks: 8,
    ignoreRiskGate: true, ignoreGuardHold: true, ignoreRestThreshold: true,
    respectMustHold: true, requireWar: true,
  },
  attack: {
    verb: 'attack',
    targetPriority: 2.5,        // 针对 order.to 的专属攻坚权重
    focusFireWeight: 2.0,       // 协同集火倍率
    flankAttackMultiplier: 1.25,// 侧击协同加成 (+25%)
    rearAttackMultiplier: 1.45, // 背击协同加成 (+45%)
    focusFireFollowUpBonus: 30, // 后手集火补刀加成
    suicideAvoidanceBase: 0.8,  // 单兵阵亡率 > 80% 且无协同时规避盲目送死
    maxCoordinationWaitRounds: 1,// 等待协同最多 1 回合，超时坚决发起进攻防卡死
    formationHolding: 0.5,      // 阵型维持强度（进攻时允许集中出击）
    allowManeuver: true,        // 允许向目标机动
    allowAttack: true,          // 允许攻击
    counterattackOnly: false,   // 不仅限于反击
    casualtyToleranceBase: 0.8, // 基础伤亡容忍（进攻可承受损失）
    retreatAllowed: false,      // obedient 下不擅自撤退
    enforceTargetScope: true,   // 严格限定目标在玩家指定的 to / ao 内
  },
  breakthrough: {
    verb: 'breakthrough',
    targetPriority: 3.0,
    focusFireWeight: 2.2,
    flankAttackMultiplier: 1.30,
    rearAttackMultiplier: 1.50,
    focusFireFollowUpBonus: 35,
    suicideAvoidanceBase: 0.9,  // 突破模式具备更高伤亡容忍
    maxCoordinationWaitRounds: 1,
    formationHolding: 0.3,
    allowManeuver: true,
    allowAttack: true,
    counterattackOnly: false,
    casualtyToleranceBase: 1.0, // 突破模式高伤亡容忍
    retreatAllowed: false,
    enforceTargetScope: true,
  },
  defend: {
    verb: 'defend',
    targetPriority: 2.0,        // 坚守 mustHold / line
    focusFireWeight: 1.2,
    formationHolding: 3.0,      // 强力阵型维持，优先驻守阵地
    lineDispersalBonus: 25,     // 沿 line 均匀展开驻守加成
    allowManeuver: true,        // 允许向防御线补位
    allowAttack: true,          // 仅允许防御线自卫反击
    counterattackOnly: true,    // 严禁主动浪击离开阵地
    casualtyToleranceBase: 0.5,
    retreatAllowed: false,
    enforceTargetScope: true,
  },
  delay: {
    verb: 'delay',
    targetPriority: 1.5,
    focusFireWeight: 1.0,
    formationHolding: 2.0,
    lineDispersalBonus: 20,
    allowManeuver: true,
    allowAttack: true,
    counterattackOnly: true,
    casualtyToleranceBase: 0.3, // 阻击以保全实力为前提，低伤亡容忍
    retreatAllowed: true,       // delay 允许交替掩护后撤
    enforceTargetScope: true,
  },
  screen: {
    verb: 'screen',
    targetPriority: 1.2,
    focusFireWeight: 1.0,
    formationHolding: 1.8,
    lineDispersalBonus: 30,     // 屏护线展开激励
    allowManeuver: true,
    allowAttack: false,         // 警戒掩护一般不主动决战
    counterattackOnly: true,
    casualtyToleranceBase: 0.3,
    retreatAllowed: true,
    enforceTargetScope: true,
  },
  concentrate: {
    verb: 'concentrate',
    targetPriority: 2.5,        // 以到达集结地为第一目标
    focusFireWeight: 1.0,
    formationHolding: 1.5,      // 到达后就地防御
    allowManeuver: true,        // 允许机动至目标
    allowAttack: false,         // 纯集结模式不主动出击接战
    counterattackOnly: false,
    casualtyToleranceBase: 0.5,
    retreatAllowed: false,
    enforceTargetScope: true,
  },
  withdraw: {
    verb: 'withdraw',
    targetPriority: 3.0,        // 沿撤退路径逃脱
    focusFireWeight: 0.0,
    formationHolding: 0.0,
    allowManeuver: true,        // 允许沿 path 撤退
    allowAttack: false,         // 严格禁止主动交火接战
    counterattackOnly: false,
    casualtyToleranceBase: 0.2, // 极低伤亡容忍，安全第一
    retreatAllowed: true,
    enforceTargetScope: true,
  },
  envelop: {
    verb: 'envelop',
    targetPriority: 2.8,
    focusFireWeight: 2.5,       // 合围极度依赖多轴协同
    flankAttackMultiplier: 1.35,
    rearAttackMultiplier: 1.60,
    focusFireFollowUpBonus: 40,
    suicideAvoidanceBase: 0.85,
    maxCoordinationWaitRounds: 1,
    formationHolding: 1.0,
    allowManeuver: true,
    allowAttack: true,
    counterattackOnly: false,
    casualtyToleranceBase: 0.8,
    retreatAllowed: false,
    enforceTargetScope: true,
  },
  counterattack: {
    verb: 'counterattack',
    targetPriority: 2.5,
    focusFireWeight: 2.0,
    flankAttackMultiplier: 1.25,
    rearAttackMultiplier: 1.45,
    focusFireFollowUpBonus: 30,
    formationHolding: 1.2,
    allowManeuver: true,
    allowAttack: true,
    counterattackOnly: false,
    casualtyToleranceBase: 0.7,
    retreatAllowed: false,
    enforceTargetScope: true,
  },
  support: {
    verb: 'support',
    targetPriority: 1.8,
    focusFireWeight: 1.5,
    formationHolding: 2.0,
    allowManeuver: true,
    allowAttack: true,
    counterattackOnly: false,
    casualtyToleranceBase: 0.5,
    retreatAllowed: false,
    enforceTargetScope: true,
  }
});

/**
 * 获取对应 verb 的战术档案
 */
export function getVerbProfile(verb) {
  return VERB_PROFILES[verb] || VERB_PROFILES.attack;
}

/**
 * 对 obedient Commander 的候选任务做严格过滤 (第 2 项需求 & 任务 B):
 * (a) 任务目标必须限定在玩家指定的 from/to/ao/axes/line/path 范围内；
 * (b) 目标够不着时：放行沿最优路径向目标缩短距离的推进机动；
 * (c) 达成后外围部队按 order.guard ("hold" 默认不动, "ring" 允许1格警戒圈但禁攻) 处理。
 */
export function filterTasksForObedient(tasks, order, model) {
  if (!OBEDIENT_STRICT || !order) return tasks;
  const profile = getVerbProfile(order.verb);

  // 1. 构建严格的合法落点/目标集合
  const goals = Array.isArray(order.to) ? order.to : (order.to != null ? [order.to] : []);
  const origins = Array.isArray(order.from) ? order.from : (order.from != null ? [order.from] : []);
  const allowedDestinations = new Set([
    ...goals,
    ...origins,
    ...(order.ao || []),
    ...(order.line || []),
    ...(order.mustHold || []),
    ...(order.path || []),
    ...(order.axes ? order.axes.flat() : [])
  ].filter(id => id != null));

  const mustHoldSet = new Set(order.mustHold || []);
  const lineSet = new Set(order.line || []);
  const stage = model.game.stage;
  const ownCountry = model.me;

  return tasks.filter(task => {
    // 原地待命/驻守任务始终放行
    if (task.kind === 'hold' || task.from === task.to && (!task.commands || task.commands.length === 0)) {
      return true;
    }

    // (0) 非撤退/延迟类指令，严格禁止自主撤退 (withdraw) 任务
    if (!['withdraw', 'delay'].includes(order.verb) && task.kind === 'withdraw') {
      return false;
    }

    // (1) withdraw 严格禁止任何攻击交战任务，只允许后撤移动
    if (order.verb === 'withdraw' && task.kind === 'attack') {
      return false;
    }

    // (2) concentrate 严格禁止主动出击接战，只允许向目标移动
    if (order.verb === 'concentrate' && task.kind === 'attack') {
      return false;
    }

    // (3) defend 战术下的特殊规则：阵线优先与守备保障
    if (order.verb === 'defend') {
      if (task.kind === 'attack') {
        const isNeighborToLine = (stage.adjE.get(task.to) || []).some(n => mustHoldSet.has(n) || lineSet.has(n));
        if (!isNeighborToLine) return false;

        const fromArea = stage.st(task.from);
        if (mustHoldSet.has(task.from) && (fromArea?.armies?.length || 0) <= 1) {
          return false;
        }
      }
    }

    // (4) delay 战术：边撤边消耗，允许对贴身尾随敌人阻滞还击，移动坚决向 to / line 撤退
    if (order.verb === 'delay') {
      if (task.kind === 'attack') {
        const isPursuingEnemy = (stage.adjE.get(task.to) || []).some(n => allowedDestinations.has(n) || origins.includes(n));
        if (!isPursuingEnemy && !allowedDestinations.has(task.to)) return false;
      }
    }

    // (5) screen 战术：前出屏护线建立警戒，维持接触但不深入
    if (order.verb === 'screen') {
      if (task.kind === 'attack') {
        const isScreenContact = (stage.adjE.get(task.to) || []).some(n => lineSet.has(n) || allowedDestinations.has(n));
        if (!isScreenContact && !allowedDestinations.has(task.to)) return false;
      }
    }

    // (6) 目标范围限定 (核心过滤)：
    if (task.kind === 'attack' || task.kind === 'capture') {
      if (['attack', 'breakthrough', 'envelop'].includes(order.verb)) {
        if (!allowedDestinations.has(task.to)) {
          const isDirectBlockingEnemy = (stage.adjE.get(task.from) || []).includes(task.to) &&
            goals.length > 0 && Math.min(...goals.map(g => model.dist?.(task.to, g) ?? Infinity)) <= Math.min(...goals.map(g => model.dist?.(task.from, g) ?? Infinity));
          if (!isDirectBlockingEnemy) return false;
        }
      } else if (order.verb === 'counterattack') {
        const isThreatening = allowedDestinations.has(task.to) || (stage.adjE.get(task.to) || []).some(n => origins.includes(n) || mustHoldSet.has(n));
        if (!isThreatening) return false;
      } else if (order.verb === 'support') {
        const isTargetOrAdjacent = goals.includes(task.to) || (order.ao && order.ao.includes(task.to)) || (stage.adjE.get(task.to) || []).some(n => goals.includes(n));
        if (!isTargetOrAdjacent) return false;
      }
    }

    // (6.1) 常驻攻击自杀式交换风险感知门禁 (H1)
    if (task.kind === 'attack' && task.estimate) {
      const e = task.estimate;
      const canCounter = e.canCounter ?? e.counter ?? true;
      // 炮兵/火箭等远程先手 (无反击) 不受影响
      if (canCounter) {
        const playerRisk = Number.isFinite(order.risk) ? order.risk : 0.5;
        // 当玩家把 risk 设得很高 (>= 0.66) 时仍然执行 (玩家意志优先)
        if (playerRisk < 0.66) {
          const unit = task.unit.army || task.unit;
          const ownHp = unit.hp || 100;
          const pDies = e.pAttackerDies || 0;
          const pSurvive = Math.max(0, 1 - pDies);
          const dmgAtt = e.dmgAtt || 0;
          const dmgDef = e.dmgDef || 0;
          const notFinishingKill = (e.pKillFront || 0) < 0.7;

          // 判定：预期己方损失远大于预期敌方损失且该单位存活概率很低
          const isLethalOrLowSurvive = pSurvive < 0.35 || pDies >= 0.65 || dmgAtt >= ownHp;
          const isSeverelyUnfavorable = dmgAtt >= dmgDef * 1.5 || (dmgDef < 15 && dmgAtt >= 25);

          if (isLethalOrLowSurvive && isSeverelyUnfavorable && notFinishingKill) {
            order._suicideWarnings ||= [];
            const warnText = `单位${unit.id}对目标${task.to}被放弃：预期承伤${Math.round(dmgAtt)}/存活概率${Math.round(pSurvive * 100)}%`;
            if (!order._suicideWarnings.includes(warnText)) {
              order._suicideWarnings.push(warnText);
            }
            return false;
          }
        }
      }
    }

    // (6.2) 追加动作风险门禁与防送死校验 (用满移动力但不盲目送死)
    if (isOtFix8Active(order) && task.kind === 'attack' && task.estimate) {
      const unit = task.unit.army || task.unit;
      const actCount = order._unitActionCounts?.[unit.id] || 0;
      if (actCount >= 1) {
        const e = task.estimate;
        const pDies = e.pAttackerDies || 0;
        const dmgAtt = Math.max(1, e.dmgAtt || 0);
        const dmgDef = e.dmgDef || 0;
        const profitRatio = dmgDef / dmgAtt;
        if (pDies > MULTI_MOVE_MAX_SUICIDE_P || profitRatio < MULTI_MOVE_MIN_PROFIT_RATIO) {
          return false;
        }
      }
    }

    // (7) 目标够不着时的行军推进处理 (任务 B 核心)：
    // 对于机动推进类任务 (move / concentrate / advance):
    if (task.commands?.some(c => c.type === 'move') || ['move', 'concentrate'].includes(task.kind)) {
      if (!allowedDestinations.has(task.to)) {
        if (isOtFix8Active(order)) {
          const marchTargets = (Array.isArray(order.path) && order.path.length >= 2) ? [order.path[0]]
            : (Array.isArray(order.axes) && order.axes.length >= 2) ? [(Array.isArray(order.axes[0]) ? order.axes[0][0] : order.axes[0])].filter(Boolean)
            : (goals.length > 0 ? goals : [...allowedDestinations]);
          if (marchTargets.length > 0) {
            const dFrom = Math.min(...marchTargets.map(g => model.dist?.(task.from, g) ?? Infinity));
            const dTo = Math.min(...marchTargets.map(g => model.dist?.(task.to, g) ?? Infinity));
            if (dTo < dFrom) {
              return true;
            }
          }
        }
        if (Array.isArray(order.path) && order.path.length >= 2 && !order.detour) {
          return false;
        }
        const marchTargets = goals.length > 0 ? goals : [...allowedDestinations];
        if (marchTargets.length > 0) {
          const dFrom = Math.min(...marchTargets.map(g => model.dist?.(task.from, g) ?? Infinity));
          const dTo = Math.min(...marchTargets.map(g => model.dist?.(task.to, g) ?? Infinity));
          if (dTo >= dFrom) return false;
        } else {
          return false;
        }
      }
    }

    return true;
  });
}

/**
 * 战术因子档案对任务价值估值的修正 (任务 A、B、C、E):
 * 1. 优先级 (priority) 与 风险 (risk) 响应；
 * 2. 侧击 (flank) 与 背击 (rear) 方向协同加成 (direction.js attackFacingKind)；
 * 3. 避免单兵盲目送死 (suicideAvoidance)；
 * 4. 目标够不着时沿最优路径推进奖励 (marchBonus)；
 * 5. 防线 (line) 均匀展开激励。
 */
export function adjustTaskValueByProfile(task, baseValue, order, model) {
  if (!OBEDIENT_STRICT || !order) return baseValue;
  const profile = getVerbProfile(order.verb);

  let adjusted = baseValue;
  const goals = Array.isArray(order.to) ? order.to : (order.to != null ? [order.to] : []);
  const priority = Number.isFinite(order.priority) ? order.priority : 5;
  const risk = Number.isFinite(order.risk) ? order.risk : 0.5;

  // 1. 优先级 (priority: 1~9) 响应
  const priorityBonus = (priority - 5) * 15;
  adjusted += priorityBonus;

  // 2. 核心主攻目标 (order.to) 导向加权
  const isDirectGoal = goals.includes(task.to);
  if (isDirectGoal) {
    adjusted += profile.targetPriority * 30;
  }

  // 3. 攻击任务：风险、协同与攻角加成 (任务 C)
  if (task.kind === 'attack' && task.estimate) {
    const e = task.estimate;
    const ownHp = task.unit.maxHp || 100;
    const estimatedLoss = ((e.dmgAtt || 0) + (e.pAttackerDies || 0) * ownHp);
    
    // risk越高，损失顾虑越低；risk越低，损失顾虑越高
    const riskFactor = (0.5 - risk) * 40;
    adjusted -= (estimatedLoss / ownHp) * riskFactor;

    // 基础协同集火加分 (focusFireWeight)
    adjusted += profile.focusFireWeight * 15;

    // 方向协同加成：侧击 (flank) 与 背击 (rear)
    const stage = model.game.stage;
    const defender = stage.st(task.to)?.armies?.[0];
    if (defender && defender.facing != null) {
      const facingKind = attackFacingKind(stage, defender.facing, task.staging || task.from, task.to);
      if (facingKind === 'rear') {
        adjusted *= (profile.rearAttackMultiplier || 1.45);
      } else if (facingKind === 'flank') {
        adjusted *= (profile.flankAttackMultiplier || 1.25);
      }
    }

    // 避免单兵盲目送死 (任务 C):
    const pDies = e.pAttackerDies || 0;
    const isSpecialAggressive = ['breakthrough', 'counterattack', 'attack', 'envelop'].includes(order.verb);
    const suicideThreshold = isSpecialAggressive ? 0.90 : 0.80;
    if (pDies >= suicideThreshold && risk < 0.35) {
      adjusted -= 30;
    }
  }

  // 4. 防守阵地加权与防线均匀展开 (任务 E)
  if (task.kind === 'hold' || ['defend', 'delay', 'screen'].includes(order.verb)) {
    const isMustHold = order.mustHold?.includes(task.from) || order.line?.includes(task.from) || goals.includes(task.from);
    if (isMustHold) {
      adjusted += profile.formationHolding * 25;
    }

    // 防线均匀展开 (Line Dispersal):
    // 如果任务目标属于 order.line，且该地块上当前尚未有驻军，给予额外激励避免全部扎堆在同一格
    if (order.line?.includes(task.to) && task.from !== task.to) {
      const targetArea = model.game.stage.st(task.to);
      if (targetArea && targetArea.armies.length === 0) {
        adjusted += (profile.lineDispersalBonus || 25);
      }
    }
  }

  // 5. 撤退、迟滞、掩护任务向战术目标机动的加权
  if (order.verb === 'withdraw') {
    if (order.path?.includes(task.to) || goals.includes(task.to)) {
      adjusted += 80;
    }
  }
  if (order.verb === 'delay') {
    if (goals.includes(task.to) || order.line?.includes(task.to)) {
      adjusted += 40;
    }
  }
  if (order.verb === 'screen') {
    if (order.line?.includes(task.to)) {
      adjusted += 50;
    }
  }

  // 6. 朝向目标行军激励与划线忠实度强激励 (Fidelity Incentive)
  const marchTargets = goals.length > 0 ? goals : (order.path?.length ? order.path : (order.axes ? order.axes.flat() : []));
  if (task.commands?.some(c => c.type === 'move') && marchTargets.length > 0) {
    const dFrom = Math.min(...marchTargets.map(g => model.dist?.(task.from, g) ?? Infinity));
    const dTo = Math.min(...marchTargets.map(g => model.dist?.(task.to, g) ?? Infinity));
    if (Number.isFinite(dFrom) && Number.isFinite(dTo) && dTo < dFrom) {
      adjusted += 55 + (dFrom - dTo) * 35 + (priority - 5) * 6;
      if (isOtFix8Active(order)) {
        adjusted += REAR_MARCH_BONUS_BASE;
      }
    }
  }

  // 划线忠实度专项强激励 (强化 AI 严格遵守玩家指令):
  if (Boolean(order.obedient)) {
    // A. 路径忠实度：沿 path 顺序下一节点
    if (Array.isArray(order.path) && order.path.length >= 2) {
      const fromIdx = order.path.indexOf(task.from);
      const toIdx = order.path.indexOf(task.to);
      if (fromIdx !== -1 && toIdx > fromIdx && toIdx <= fromIdx + 2) {
        adjusted += 160 - (toIdx - fromIdx - 1) * 30;
      } else if (fromIdx === -1 && (toIdx === 0 || toIdx === 1)) {
        adjusted += 150 - toIdx * 20;
      } else if (order.path.includes(task.to)) {
        adjusted += 50;
      }
    }
    // B. 防线忠实度：坚守或前往专属岗位
    if (Array.isArray(order.line) && order.line.length > 0) {
      const assignedPost = order._assignedPosts?.[task.unit?.id];
      if (assignedPost != null) {
        if (task.to === assignedPost) adjusted += 150;
        if (task.from === assignedPost && task.kind === 'hold') adjusted += 100;
      }
    }
    // C. 合围双轴忠实度：沿专属轴线推进
    if (Array.isArray(order.axes) && order.axes.length >= 2) {
      const axisIdx = order._axisAssignment?.[task.unit?.id] ?? 0;
      const rawAxis = order.axes[axisIdx] || order.axes[0];
      const myAxis = Array.isArray(rawAxis) ? rawAxis : [rawAxis];
      const fromIdx = myAxis.indexOf(task.from);
      const toIdx = myAxis.indexOf(task.to);
      if (fromIdx !== -1 && toIdx > fromIdx) {
        adjusted += 120;
      } else if (myAxis.includes(task.to)) {
        adjusted += 70;
      }
    }
  }

  // 7. 跨回合路线承诺记忆与滞回加成 (防止摇摆)
  if (order.plan && task.unit?.id && order.plan[task.unit.id]) {
    const commitment = order.plan[task.unit.id];
    if (commitment.to === task.to || commitment.goal === task.to) {
      adjusted += 40;
    }
  }

  // 8. 突破与合围主动进攻/穿插倾向
  if (order.verb === 'breakthrough' && task.kind === 'attack') adjusted += 25;
  if (order.verb === 'envelop' && (task.kind === 'attack' || task.commands?.some(c => c.type === 'move'))) adjusted += 20;

  return adjusted;
}
