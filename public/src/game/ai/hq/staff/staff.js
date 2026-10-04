import { analyzeFronts, pickMainEffort, evaluateCampaignTechGoal } from './strategy.js';
import { organizeArmyGroups, autoOrganize } from './organize.js';
import { allocateOrders } from './allocate.js';
import { produceCommands } from './produce.js';
import { decideDiplomacy } from './diplomacy.js';
import { Commander } from '../commander/commander.js';
import { PlanSet } from './plans.js';
import { validateOrder, commanderById } from '../../../army_groups.js';

/**
 * GeneralStaff 总参谋部主类
 * 串联战略态势感知、集团军编成任命、合同网命令分配与战区生产投资。
 * 内部实现 StaffPolicy 接口 (plan(model, reports) -> Order[])
 */
export class GeneralStaff {
  constructor(options = {}) {
    this.doctrine = options.doctrine || {};
    this.activeOrders = new Map(); // commanderId -> Order
    this.commanders = new Map(); // groupId -> Commander
    this.planSet = new PlanSet();
    this.directCommander = new Commander({
      id: 'direct_hq',
      groupId: null,
      mods: {},
      units: [],
      ao: [],
      obedient: true
    });
    this.aifcCommitments = new Map();
    this._lastAutoOrganizeRound = -999;
  }

  /**
   * 同步更新集团军指挥官与直属指挥部的状态
   */
  syncCommanders(groups = [], unassignedUnits = [], model) {
    const activeGroupIds = new Set(groups.map(g => g.id));

    // 清理已解散或战线消失的集团军指挥官
    for (const [gid, cmdr] of this.commanders) {
      if (!activeGroupIds.has(gid)) {
        if (cmdr.order) cmdr.cancel(cmdr.order.id);
        this.commanders.delete(gid);
        this.activeOrders.delete(cmdr.id);
      }
    }

    // 更新或创建活跃集团军指挥官（拥有稳定唯一 ID）
    const resultList = [];
    for (const grp of groups) {
      const stableId = grp.id || `pending_${grp.frontId}`;
      let cmdr = this.commanders.get(stableId);
      if (!cmdr) {
        cmdr = new Commander({
          id: `cmd_${stableId}`,
          groupId: stableId,
          mods: grp.commander?.mods || {},
          units: grp.units || [],
          ao: [],
          obedient: false
        });
        this.commanders.set(stableId, cmdr);
      } else {
        cmdr.units = grp.units || [];
        cmdr.mods = grp.commander?.mods || {};
      }
      cmdr.frontId = grp.frontId;
      resultList.push(cmdr);
    }

    // 直属指挥部接管所有未编组部队
    this.directCommander.units = unassignedUnits || [];
    resultList.push(this.directCommander);

    return resultList;
  }

  /**
   * 总参每回合规划方法
   * @param {object} model - 战场信息模型
   * @param {Array} reports - 上回合各指挥官返回的战报
   * @returns {{orders: Array, organizeCommands: Array, produceCommands: Array, assignedCommanders: Array}}
   */
  plan(model, reports = []) {
    // 1. 战线聚类与感知
    const fronts = analyzeFronts(model);

    // 2. 战略姿态与主攻方向确定
    const effort = pickMainEffort(fronts, this.doctrine, model);
    this.planSet.select(model, fronts, reports, this.activeOrders, this.doctrine);
    const offensiveFront = fronts.filter(f => f.plan === 'offensive').sort((a, b) => b.planValues.offensive - a.planValues.offensive)[0];
    const mainFrontId = offensiveFront?.id ?? effort.mainFrontId ?? effort.mainEffort?.id ?? null;

    // 3. 编制与任命（任务A：支持 AI 定向自动编组并辅以节流防抖）
    const round = model.round || model.game?.round || 1;
    const existingGroups = (model.game?.armyGroups || []).filter(g => g.country === model.me);
    const assignedIds = new Set(existingGroups.flatMap(g => g.unitIds || []));
    const unassignedUnitsCount = (model.units?.mine || []).filter(u => !assignedIds.has(u.id)).length;

    // 节流策略：
    // (1) 第1回合或当前无集团军时：必须触发
    // (2) 集团军未满4个且未编组散兵数 >= 4时：触发新编组
    // (3) 距离上次编组 >= 4回合且集团军未满4个且散兵数 >= 3时：定期补充编组
    const shouldAutoOrg = existingGroups.length === 0 ||
      (existingGroups.length < 4 && unassignedUnitsCount >= 4) ||
      (existingGroups.length < 4 && unassignedUnitsCount >= 3 && (round - this._lastAutoOrganizeRound >= 4));

    const organizeRes = organizeArmyGroups(model, fronts, {
      doctrine: this.doctrine,
      mainFrontId,
      maxGroups: 4
    });

    if (shouldAutoOrg) {
      this._lastAutoOrganizeRound = round;
      // 若外部 organizeArmyGroups 未产出新建集团军指令，则调用 autoOrganize 补充
      const hasAutoCmds = organizeRes.commands?.some(c => c.type === 'setArmyGroup');
      if (!hasAutoCmds) {
        try {
          const autoCmds = autoOrganize(model.game, model.me, model);
          if (autoCmds && autoCmds.length > 0) {
            organizeRes.commands = [...(organizeRes.commands || []), ...autoCmds];
            if (autoCmds.plannedGroups) {
              organizeRes.groups = [...(organizeRes.groups || []), ...autoCmds.plannedGroups];
            }
          }
        } catch (e) {
          console.warn?.('[GeneralStaff] autoOrganize call error:', e?.message);
        }
      }
    } else {
      // 节流周期内：过滤掉新创建集团军指令（groupId 为 null 的新组建），仅保留既有编制维护指令，防止指令抖动
      if (organizeRes.commands) {
        organizeRes.commands = organizeRes.commands.filter(c => !(c.type === 'setArmyGroup' && c.groupId == null));
      }
    }

    // 确保所有本国已存在或新组建的集团军都纳入指挥官同步与命令下达名单
    const allKnownGroupIds = new Set((organizeRes.groups || []).map(g => g.id));
    const allPlanningGroups = [...(organizeRes.groups || [])];
    for (const eg of existingGroups) {
      if (!allKnownGroupIds.has(eg.id)) {
        const liveUnits = (eg.unitIds || [])
          .map(id => model.units?.mine?.find(u => u.id === id))
          .filter(Boolean)
          .map(u => ({ army: u, area: model.game?.stage?.st(u.area) }));
        const spec = commanderById(model.me, eg.commanderId);
        allPlanningGroups.push({
          id: eg.id,
          name: eg.name,
          commander: spec,
          units: liveUnits,
          frontId: fronts[0]?.id || null
        });
        allKnownGroupIds.add(eg.id);
      }
    }

    // 4. 同步指挥官实例
    const commanderList = this.syncCommanders(
      allPlanningGroups,
      organizeRes.unassignedUnits,
      model
    );

    // 5. 命令分配（合同网询价与拍卖，支持真防抖与无命令兜底）
    const assignments = allocateOrders(model, commanderList, fronts, {
      mainFrontId,
      reports,
      activeOrders: this.activeOrders,
      doctrine: this.doctrine,
      aifcCommitments: this.aifcCommitments
    });

    // 为各指挥官分派命令并记录活跃状态
    const orders = [];
    const assignedOrderIds = new Set();
    const assignedCommanders = [];

    for (const item of assignments) {
      const { commanderId, order } = item;
      const cmdr = commanderList.find(c => c.id === commanderId);
      if (cmdr) {
        cmdr.ao = order.ao || [];
        cmdr.accept(order);
        this.activeOrders.set(cmdr.id, order);
        orders.push(order);
        assignedOrderIds.add(cmdr.id);
        assignedCommanders.push(cmdr);
      }
    }

    // 按命令优先级从高到低排序执行
    assignedCommanders.sort((a, b) => (b.order?.priority || 0) - (a.order?.priority || 0));

    // 未获得命令的指挥官取消原有未完成订单
    for (const cmdr of commanderList) {
      if (!assignedOrderIds.has(cmdr.id)) {
        if (this.activeOrders.has(cmdr.id)) {
          cmdr.cancel(this.activeOrders.get(cmdr.id).id);
          this.activeOrders.delete(cmdr.id);
        }
      }
    }

    // 6. 战区生产与投资（向 produce.js 传递全局主攻战线与优先集结信号）
    const effectiveMainFrontId = assignments.mainFrontId ?? mainFrontId;
    const mainEffortFront = assignments.mainEffortFront || fronts.find(f => f.id === effectiveMainFrontId);
    const campaignTechGoal = effort.targetTechLevel ?? evaluateCampaignTechGoal(model, this.doctrine);

    const prodCommands = produceCommands(model, {
      fronts,
      mainFrontId: effectiveMainFrontId,
      mainFront: mainEffortFront,
      targetTechLevel: campaignTechGoal,
      priorityGroupIds: assignments.priorityGroupIds || new Set(),
      priorityCommanders: assignments.priorityCommanders || new Set(),
      assignments,
      reports,
      orders,
      activeOrders: this.activeOrders
    }, this.doctrine);

    // 7. 外交决断评估（F10: 接入 staff/diplomacy.js 产出宣战/停战决策）
    let diploCommands = [];
    try {
      diploCommands = decideDiplomacy(model, {
        fronts,
        mainFrontId,
        warSequence: effort.warSequence,
        reports,
        doctrine: this.doctrine
      }) || [];
    } catch (e) {
      console.warn?.('[GeneralStaff] diplomacy assessment error:', e?.message);
    }

    // 8. 任务B：将战略决策同步映射为正式的集团军与战区 Order（消除 AI 黑箱）
    const formalOrderCommands = [];
    const groupOrdersMap = new Map();

    // 为每个集团军生成正式 Order
    for (const grp of allPlanningGroups) {
      const cmdr = commanderList.find(c => c.groupId === grp.id);
      const assignedItem = assignments.find(a => a.commanderId === cmdr?.id);
      const formalOrder = mapToFormalArmyOrder(grp, assignedItem?.order, model, fronts, mainFrontId);

      const err = validateOrder(formalOrder, model.game);
      if (err == null) {
        groupOrdersMap.set(grp.id, formalOrder);
        formalOrderCommands.push({
          type: 'setArmyOrder',
          country: model.me,
          groupId: grp.id,
          order: formalOrder
        });

        // 若集团军已在当前游戏中存在，直接设置 standingOrder 保证即时生效
        if (model.game?.armyGroups?.some(g => g.id === grp.id && g.country === model.me)) {
          model.game.setStandingOrder?.('army', grp.id, formalOrder);
        }
      } else {
        console.warn?.(`[GeneralStaff] formal army order validation failed: ${err}`, { groupId: grp.id, formalOrder });
      }
    }

    // 为每个战区生成正式 Order
    const countryTheaters = [...(model.game?.theatres || []).filter(t => t.country === model.me)];
    for (const cmd of organizeRes.commands || []) {
      if (cmd.type === 'createTheater' && cmd.country === model.me) {
        const nextId = 'theater_' + (model.game?.nextTheaterId || 1);
        if (!countryTheaters.some(t => t.id === nextId)) {
          countryTheaters.push({
            id: nextId,
            country: model.me,
            name: cmd.name || `${model.me}第1战区`,
            armyIds: allPlanningGroups.map(g => g.id)
          });
        }
      }
    }

    for (const th of countryTheaters) {
      const formalTheaterOrder = mapToFormalTheaterOrder(th, groupOrdersMap, model, fronts, mainFrontId);
      const err = validateOrder(formalTheaterOrder, model.game);
      if (err == null) {
        formalOrderCommands.push({
          type: 'setTheaterOrder',
          country: model.me,
          theaterId: th.id,
          order: formalTheaterOrder
        });
        th.order = { ...formalTheaterOrder };
        if (model.game?.theatres?.some(t => t.id === th.id && t.country === model.me)) {
          model.game.setStandingOrder?.('theater', th.id, formalTheaterOrder);
        }
      } else {
        console.warn?.(`[GeneralStaff] formal theater order validation failed: ${err}`);
      }
    }

    return {
      orders,
      organizeCommands: [
        ...(organizeRes.commands || []),
        ...formalOrderCommands
      ],
      produceCommands: prodCommands || [],
      diplomacyCommands: diploCommands || [],
      warSequence: effort.warSequence,
      assignedCommanders
    };
  }

  /**
   * 实现 StaffPolicy 接口
   */
  planOrders(model, reports = []) {
    const res = this.plan(model, reports);
    return res.orders;
  }
}

const ARMOUR_TYPES = new Set(['panzer', 'tank', 'heavytank']);

/**
 * 将内部命令映射为正式的集团军 Order
 */
function mapToFormalArmyOrder(group, assignedOrder, model, fronts, mainFrontId) {
  const game = model.game;
  const stage = game?.stage;
  const groupUnits = group.units || [];

  // 1. 获取该集团军单位当前所在的地块
  const unitAreas = groupUnits
    .map(u => u.area?.id ?? u.area ?? u.army?.area)
    .filter(id => Number.isInteger(id) && stage?.enabled?.has(id) && !stage?.st(id)?.sea);

  const friendlyCap = game?.diplomacy?.capitals?.[model.me];
  const defaultArea = unitAreas[0] ?? (Number.isInteger(friendlyCap) ? friendlyCap : (model.mine?.[0]?.id ?? 0));

  // 因子特长分析
  const totalUnits = groupUnits.length;
  let armourUnits = 0;
  let totalHp = 0, totalMaxHp = 0;
  for (const u of groupUnits) {
    const t = u.type || u.army?.type;
    if (ARMOUR_TYPES.has(t)) armourUnits++;
    const hp = u.hp ?? u.army?.hp ?? 100;
    const maxHp = u.maxHp ?? u.army?.maxHp ?? 100;
    totalHp += hp;
    totalMaxHp += maxHp;
  }
  const isArmourDominant = totalUnits > 0 && ((armourUnits / totalUnits) >= 0.4 || armourUnits >= 3);
  const avgHpRatio = totalMaxHp > 0 ? (totalHp / totalMaxHp) : 1.0;

  const matchedFront = fronts.find(f => f.id === group.frontId) || fronts.find(f => f.id === assignedOrder?.frontId);
  const isMainFront = matchedFront && (matchedFront.id === mainFrontId);
  const frontPlan = matchedFront?.plan || 'balanced';

  let verb = assignedOrder?.verb;
  if (!verb) {
    if (avgHpRatio < 0.45) verb = 'withdraw';
    else if (isArmourDominant) verb = 'breakthrough';
    else if (frontPlan === 'offensive') verb = 'attack';
    else if (frontPlan === 'defensive') verb = 'defend';
    else verb = 'concentrate';
  }

  let to = assignedOrder?.to;
  let from = assignedOrder?.from;
  let risk = assignedOrder?.risk;
  let priority = assignedOrder?.priority;

  // 整理并校验 to
  if (Array.isArray(to)) {
    to = to.filter(id => Number.isInteger(id) && stage?.enabled?.has(id) && !stage?.st(id)?.sea);
    if (to.length === 1) to = to[0];
    else if (to.length === 0) to = null;
  } else if (!Number.isInteger(to) || !stage?.enabled?.has(to) || stage?.st(to)?.sea) {
    to = null;
  }

  // 整理并校验 from
  if (Array.isArray(from)) {
    from = from.filter(id => Number.isInteger(id) && stage?.enabled?.has(id) && !stage?.st(id)?.sea);
    if (from.length === 1) from = from[0];
    else if (from.length === 0) from = null;
  } else if (!Number.isInteger(from) || !stage?.enabled?.has(from) || stage?.st(from)?.sea) {
    from = null;
  }

  if (from == null) {
    from = unitAreas[0] ?? defaultArea;
  }
  if (to == null) {
    to = from;
  }

  if (verb === 'attack' || verb === 'breakthrough') {
    if (to == null || to === from) {
      const neighbors = stage?.adjE?.get(from) || [];
      const enemyNeighbor = neighbors.find(nId => {
        const a = stage.st(nId);
        return a && a.country && model.rel(a.country) === 'enemy';
      });
      if (enemyNeighbor != null) {
        to = enemyNeighbor;
      } else if (matchedFront?.enemyAreas?.length > 0) {
        to = matchedFront.enemyAreas[0];
      } else {
        verb = isArmourDominant ? 'concentrate' : 'defend';
        to = from;
      }
    }
  }

  // 映射规则 1: 伤兵后送/休整撤退 (withdraw)
  if (avgHpRatio < 0.45 || verb === 'withdraw') {
    verb = 'withdraw';
    risk = risk ?? 0.25;
    priority = priority ?? 6;
  }
  // 映射规则 2: 纵深突破 vs 进攻 (breakthrough / attack)
  else if (verb === 'attack' || verb === 'breakthrough') {
    if (isArmourDominant || (isMainFront && frontPlan === 'offensive')) {
      verb = 'breakthrough';
      risk = risk ?? 0.7;
      priority = priority ?? 9;
    } else {
      verb = 'attack';
      risk = risk ?? 0.55;
      priority = priority ?? 8;
    }
  }
  // 映射规则 3: 合围 (envelop) - validateOrder 强制要求合围具有2条轴线
  else if (verb === 'envelop') {
    const hasValidAxes = Array.isArray(assignedOrder?.axes) && assignedOrder.axes.length === 2 &&
      assignedOrder.axes.every(p => Array.isArray(p) && p.length > 0 && p.every(id => Number.isInteger(id) && stage?.enabled?.has(id) && !stage?.st(id)?.sea));
    if (!hasValidAxes) {
      verb = isArmourDominant ? 'breakthrough' : 'attack';
    }
  }
  // 映射规则 4: 反突击 (counterattack)
  else if (verb === 'counterattack') {
    risk = risk ?? 0.5;
    priority = priority ?? 7;
  }
  // 映射规则 5: 固守 vs 迟滞 (defend / delay)
  else if (verb === 'defend' || verb === 'delay') {
    const toId = Array.isArray(to) ? to[0] : to;
    const pLose = model.pLose ? model.pLose(toId) : 0;
    if (verb === 'delay' || (pLose > 0.6 && matchedFront && (matchedFront.R || 1) < 0.4)) {
      verb = 'delay';
      risk = risk ?? 0.4;
      priority = priority ?? 7;
    } else {
      verb = 'defend';
      risk = risk ?? 0.3;
      priority = priority ?? 7;
    }
  }
  // 映射规则 6: 牵制 (screen)
  else if (verb === 'screen') {
    risk = risk ?? 0.35;
    priority = priority ?? 5;
  }
  // 映射规则 7: 配合 (support)
  else if (verb === 'support') {
    risk = risk ?? 0.4;
    priority = priority ?? 6;
  }
  // 映射规则 8: 集结 (concentrate)
  else {
    verb = 'concentrate';
    risk = risk ?? 0.3;
    priority = priority ?? 4;
  }

  risk = Math.max(0, Math.min(1, typeof risk === 'number' && Number.isFinite(risk) ? risk : 0.5));
  priority = Math.max(1, Math.min(9, Math.round(typeof priority === 'number' && Number.isFinite(priority) ? priority : 5)));

  const formal = {
    verb,
    from,
    to,
    risk: Number(risk.toFixed(2)),
    priority,
    expires: Number.isInteger(assignedOrder?.expires) ? assignedOrder.expires : 3
  };

  if (verb === 'envelop' && Array.isArray(assignedOrder?.axes) && assignedOrder.axes.length === 2) {
    formal.axes = assignedOrder.axes;
  }

  // 映射规则 9: 路径规划 (path) 支持与首尾坐标校准
  if (Array.isArray(assignedOrder?.path) && assignedOrder.path.length >= 2) {
    const p = assignedOrder.path;
    const isValid = p.every(id => Number.isInteger(id) && stage?.enabled?.has(id) && !stage?.st(id)?.sea);
    const isAdjacent = p.every((id, idx) => idx === 0 || stage?.adjacent(p[idx - 1], id));
    if (isValid && isAdjacent && p.length <= 40) {
      formal.path = p;
      formal.from = p[0];
      formal.to = p.at(-1);
    }
  }

  if (verb === 'breakthrough' && Number.isInteger(assignedOrder?.depth) && assignedOrder.depth >= 1) {
    formal.depth = assignedOrder.depth;
  }

  return formal;
}

/**
 * 将战区内部决策映射为正式的战区 Order
 */
function mapToFormalTheaterOrder(theater, groupOrders, model, fronts, mainFrontId) {
  const game = model.game;

  const verbPriority = {
    breakthrough: 10,
    attack: 9,
    envelop: 8,
    counterattack: 7,
    defend: 6,
    delay: 5,
    screen: 4,
    support: 3,
    withdraw: 2,
    concentrate: 1
  };

  let representativeOrder = null;
  let bestVerbScore = -1;
  for (const gid of (theater.armyIds || [])) {
    const o = groupOrders.get(gid);
    if (o) {
      const score = verbPriority[o.verb] || 0;
      if (score > bestVerbScore) {
        bestVerbScore = score;
        representativeOrder = o;
      }
    }
  }

  // 若下辖未匹配到（新战区），从全部已规划集团军中选取最具代表性的主力指令
  if (!representativeOrder && groupOrders.size > 0) {
    for (const o of groupOrders.values()) {
      const score = verbPriority[o.verb] || 0;
      if (score > bestVerbScore) {
        bestVerbScore = score;
        representativeOrder = o;
      }
    }
  }

  if (representativeOrder) {
    return {
      verb: representativeOrder.verb,
      from: representativeOrder.from,
      to: representativeOrder.to,
      risk: representativeOrder.risk,
      priority: representativeOrder.priority,
      expires: representativeOrder.expires
    };
  }

  const friendlyCap = game?.diplomacy?.capitals?.[model.me];
  const capOrMine = Number.isInteger(friendlyCap) ? friendlyCap : (model.mine?.[0]?.id ?? 0);
  return {
    verb: 'defend',
    from: capOrMine,
    to: capOrMine,
    risk: 0.3,
    priority: 5,
    expires: 3
  };
}
