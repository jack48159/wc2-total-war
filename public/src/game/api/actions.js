// Input interface: discover, validate, describe and execute player actions
import { handlerFor, commandTypes } from '../commands.js';
import { shopCards } from '../cards.js';
import { getAreaName, getUnitName, getCardName, CONSTRUCTION_NAMES, INSTALLATION_NAMES } from './names.js';
import { analyzeCardTargets } from './card_targets.js';

import { TACTIC_NAMES as TACTIC_MAP } from '../tactics.js';
const DEVELOPMENT_MAP = { 14: 'city', 15: 'industry', 16: 'airport', 17: 'fort', 18: 'entrenchment', 19: 'antiaircraft', 20: 'radar' };
const ARMY_CARD_MAP = { 0: 'infantry', 1: 'panzer', 2: 'artillery', 3: 'rocket', 4: 'tank', 5: 'heavytank', 28: 'eliteinfantry', 6: 'destroyer', 7: 'cruiser', 8: 'battleship', 9: 'aircraftcarrier' };

/**
 * 列出当前所有合法的玩家操作动作
 * @param {Object} game 游戏实例
 * @param {string} country 行动国家ID，默认为当前玩家
 * @returns {Array} 合法动作列表
 */
export function listActions(game, country = game.player) {
  if (!game || game.phase === 'finished') return [];
  if (country !== game.activeCountry) return [];

  const actions = [];
  const stage = game.stage;
  const isPlayer = country === game.player;

  // 1. 结束回合 (endTurn)
  const endTurnCmd = { type: 'endTurn' };
  const endTurnHandler = handlerFor('endTurn');
  if (endTurnHandler && !endTurnHandler.validate(game, endTurnCmd)) {
    actions.push({
      type: 'endTurn',
      command: endTurnCmd,
      description: '结束本回合行动',
      expectedEffect: {
        currentRound: game.round,
        country,
        advancesTurn: true,
        summary: '结算本回合，移交控制权至下一国家或进入下一回合'
      }
    });
  }

  // 获取己方拥有的所有地块
  const myAreas = stage.areas.filter(a => a.country === country && stage.enabled.has(a.id));

  // 2. 调整前排单位 (frontArmy)
  const frontArmyHandler = handlerFor('frontArmy');
  if (frontArmyHandler) {
    for (const area of myAreas) {
      if (area.armies && area.armies.length > 1) {
        for (let i = 1; i < area.armies.length; i++) {
          const army = area.armies[i];
          const cmd = { type: 'frontArmy', from: area.id, armyId: army.id };
          if (!frontArmyHandler.validate(game, cmd)) {
            actions.push({
              type: 'frontArmy',
              command: cmd,
              description: `在 ${getAreaName(area.id, stage)} 将 ${getUnitName(army.type)} #${army.id} 调整至前排`,
              expectedEffect: {
                area: area.id,
                newFrontArmyId: army.id,
                previousFrontArmyId: area.armies[0]?.id,
                movementCost: 0
              }
            });
          }
        }
      }
    }
  }

  // 3. 移动 (move)
  const moveHandler = handlerFor('move');
  if (moveHandler) {
    for (const fromArea of myAreas) {
      if (!fromArea.armies || !fromArea.armies.length) continue;
      // 检查地块中可行动的单位
      fromArea.armies.forEach((army, armyIdx) => {
        if (!stage.canAct(army) || (army.movement || 0) <= 0) return;
        // 搜索候选目标地块：包括相邻地块及 movementPath 可达的地块
        const candidates = new Set();
        for (const adjId of stage.adjE.get(fromArea.id) || []) candidates.add(adjId);
        // 如果移动力大于 1，向外扩展候选
        if (army.movement > 1) {
          for (const first of [...candidates]) {
            for (const second of stage.adjE.get(first) || []) {
              if (second !== fromArea.id) candidates.add(second);
            }
          }
        }

        for (const toId of candidates) {
          if (toId === fromArea.id || !stage.enabled.has(toId)) continue;
          if (!stage.moveable(fromArea.id, toId, armyIdx)) continue;

          const cmd = { type: 'move', from: fromArea.id, to: toId, armyId: army.id };
          if (!moveHandler.validate(game, cmd)) {
            const path = stage.movementPath(fromArea.id, toId, armyIdx);
            const targetArea = stage.st(toId);
            const willCapture = targetArea && targetArea.country !== country && (!targetArea.armies || targetArea.armies.length === 0);
            actions.push({
              type: 'move',
              command: cmd,
              description: `${getUnitName(army.type)} #${army.id} 从 ${getAreaName(fromArea.id, stage)} 移动到 ${getAreaName(toId, stage)}`,
              expectedEffect: {
                from: fromArea.id,
                to: toId,
                armyId: army.id,
                path: path ? path.ids : [fromArea.id, toId],
                movementCost: path ? path.cost : 1,
                remainingMovement: Math.max(0, (army.movement || 0) - (path ? path.cost : 1)),
                willCapture
              }
            });
          }
        }
      });
    }
  }

  // 4. 攻击 (attack)
  const attackHandler = handlerFor('attack');
  if (attackHandler) {
    const radius = game.airstrikeRadius();
    // 遍历所有有防守部队的潜在目标地块
    const potentialTargets = stage.areas.filter(a => stage.enabled.has(a.id) && a.armies && a.armies.length > 0 && !stage.areAllied(a.country, country));

    for (const fromArea of myAreas) {
      if (!fromArea.armies || !fromArea.armies.length) continue;
      fromArea.armies.forEach((army, armyIdx) => {
        if (!stage.canAct(army) || (army.movement || 0) <= 0) return;

        for (const targetArea of potentialTargets) {
          if (!stage.attackable(fromArea.id, targetArea.id, armyIdx, radius)) continue;

          const cmd = { type: 'attack', from: fromArea.id, to: targetArea.id, armyId: army.id };
          if (!attackHandler.validate(game, cmd)) {
            const defender = targetArea.armies[0];
            actions.push({
              type: 'attack',
              command: cmd,
              description: `${getUnitName(army.type)} #${army.id} 从 ${getAreaName(fromArea.id, stage)} 攻击 ${getAreaName(targetArea.id, stage)} 的敌军 ${getUnitName(defender?.type)} #${defender?.id}`,
              expectedEffect: {
                from: fromArea.id,
                to: targetArea.id,
                attackerId: army.id,
                defenderId: defender?.id,
                defenderHp: defender?.hp,
                defenderMaxHp: defender?.maxHp,
                isCarrierStrike: army.type === 'aircraftcarrier'
              }
            });
          }
        }
      });
    }
  }

  // 5. 购买卡片 (buyCard)
  const buyCardHandler = handlerFor('buyCard');
  const availableCards = shopCards(game.cardData, stage.countries.get(country)?.flag);
  if (buyCardHandler && isPlayer) {
    for (const card of availableCards) {
      const cmd = { type: 'buyCard', card: card.id };
      if (!buyCardHandler.validate(game, cmd)) {
        const targets=analyzeCardTargets(game,card.id,country);
        const moneyCost = game.price(card, country);
        const industryCost = game.industryCost(card, country);
        actions.push({
          type: 'buyCard',
          command: cmd,
          description: `购买卡片「${getCardName(card.id)}」(花费: ${moneyCost}金币, ${industryCost}工业)`,
          expectedEffect: {
            cardId: card.id,
            cardName: getCardName(card.id),
            moneyCost,
            industryCost,
            handCountAfter: (game.hand[card.id] || 0) + (card.id === 21 ? 0 : 1),
            isTechUpgrade: card.id === 21,
            deployable: targets.deployable,
            legalTargetCount: targets.legalTargetCount,
            reason: targets.reason,
            ruleHint: targets.ruleHint
          }
        });
      }
    }
  }

  // 6. 使用卡片 (useCard)
  const useCardHandler = handlerFor('useCard');
  if (useCardHandler) {
    // 收集所有可使用的卡片：手牌中已有的，以及（若手牌没有但直接买得起的 pendingPurchase）
    const cardsToTry = [];
    if (isPlayer && game.hand) {
      for (const [idStr, count] of Object.entries(game.hand)) {
        if (count > 0) {
          const cardId = Number(idStr);
          cardsToTry.push({ id: cardId, pendingPurchase: false });
        }
      }
    }

    // 也支持直接购买并使用的卡片（UI 允许点击商店卡直接放置）
    for (const card of availableCards) {
      if (!cardsToTry.some(c => c.id === card.id) && !game.whyNot(card, country)) {
        cardsToTry.push({ id: card.id, pendingPurchase: true });
      }
    }

    for (const { id: cardId, pendingPurchase } of cardsToTry) {
      const card = game.findCard(cardId, country);
      if (!card) continue;

      // 根据卡片类型缩小目标筛选范围以保证高性能
      let targetCandidates = [];
      const isArmy = ARMY_CARD_MAP[cardId] != null;
      const isDev = DEVELOPMENT_MAP[cardId] != null;
      const isTactic = TACTIC_MAP[cardId] != null;
      const isAir = [10, 11, 13].includes(cardId);
      const isPara = cardId === 12;
      const isHeal = cardId === 26;
      const isAce = cardId === 27;

      if (isArmy || isDev || isTactic || isHeal || isAce) {
        // 部署、开发、战术、医疗、晋升只能作用于己方地块
        targetCandidates = myAreas;
      } else if (isAir) {
        // 空袭、轰炸、核弹作用于有敌军的地块
        targetCandidates = stage.areas.filter(a => stage.enabled.has(a.id) && a.country !== country && a.armies?.length);
      } else if (isPara) {
        // 伞兵作用于任意无敌军陆地或空旷陆地
        targetCandidates = stage.areas.filter(a => stage.enabled.has(a.id) && !a.sea && (a.armies?.length === 0 || a.country === country));
      } else {
        targetCandidates = stage.areas.filter(a => stage.enabled.has(a.id));
      }

      for (const targetArea of targetCandidates) {
        const cmd = {
          type: 'useCard',
          card: card.id,
          target: targetArea.id,
          pendingPurchase: !!pendingPurchase
        };
        if (!useCardHandler.validate(game, cmd)) {
          let desc = `在 ${getAreaName(targetArea.id, stage)} 使用卡片「${getCardName(card.id)}」`;
          const effect = {
            cardId: card.id,
            targetArea: targetArea.id,
            pendingPurchase: !!pendingPurchase
          };

          if (isArmy) {
            const armyType = ARMY_CARD_MAP[card.id];
            desc = `在 ${getAreaName(targetArea.id, stage)} 部署新单位「${getUnitName(armyType)}」`;
            effect.spawnUnitType = armyType;
          } else if (isDev) {
            const devType = DEVELOPMENT_MAP[card.id];
            const cnName = CONSTRUCTION_NAMES[devType] || INSTALLATION_NAMES[devType] || devType;
            desc = `在 ${getAreaName(targetArea.id, stage)} 建造/升级「${cnName}」`;
            effect.constructionType = devType;
          } else if (isTactic) {
            desc = `为 ${getAreaName(targetArea.id, stage)} 的首位驻军附加「${TACTIC_MAP[card.id]}」`;
            effect.tactic = TACTIC_MAP[card.id];
          } else if (isHeal) {
            desc = `为 ${getAreaName(targetArea.id, stage)} 的全部受损驻军恢复满生命`;
            effect.heal = true;
          } else if (isAce) {
            desc = `为 ${getAreaName(targetArea.id, stage)} 的首位驻军军衔等级提升 1 级`;
            effect.promote = true;
          } else if (card.id === 10) {
            desc = `空袭 ${getAreaName(targetArea.id, stage)} 的敌军前排单位`;
            effect.airStrikeType = 1;
          } else if (card.id === 11) {
            desc = `战略轰炸 ${getAreaName(targetArea.id, stage)}，杀伤全部驻军并破坏设施`;
            effect.airStrikeType = 2;
          } else if (card.id === 12) {
            desc = `在 ${getAreaName(targetArea.id, stage)} 实施伞兵空降，进驻该区域`;
            effect.airborne = true;
          } else if (card.id === 13) {
            desc = `在 ${getAreaName(targetArea.id, stage)} 投掷核弹，毁灭该区域全部单位与建筑设施`;
            effect.nuclear = true;
          }

          if (pendingPurchase) {
            effect.moneyCost = game.price(card, country);
            effect.industryCost = game.industryCost(card, country);
          }

          actions.push({
            type: 'useCard',
            command: cmd,
            description: desc + (pendingPurchase ? ' (即买即用)' : ''),
            expectedEffect: effect
          });
        }
      }
    }
  }

  return actions;
}

/**
 * 执行动作并收集产生的变动事件
 * @param {Object} game 游戏实例
 * @param {Object} action 待执行动作（带 command 字段或直接为命令对象）
 * @returns {Object} { ok: boolean, reason?: string, events: Array }
 */
export function performAction(game, action) {
  if (!game) return { ok: false, reason: 'no-game', events: [] };
  const cmd = action?.command || action;
  if (!cmd || !cmd.type) return { ok: false, reason: 'invalid-action', events: [] };

  const handler = handlerFor(cmd.type);
  if (!handler) return { ok: false, reason: 'unknown-command-type', events: [] };

  // 使用原生检验
  const validationError = handler.validate ? handler.validate(game, cmd) : null;
  if (validationError) {
    return { ok: false, reason: validationError, events: [] };
  }

  // 监听执行过程中派发的所有事件
  const events = [];
  const unsubscribe = game.on('*', ev => {
    // 拷贝事件对象，避免后续突变
    events.push(JSON.parse(JSON.stringify(ev)));
  });

  let result;
  try {
    result = game.apply(cmd);
  } finally {
    if (typeof unsubscribe === 'function') unsubscribe();
  }

  return {
    ok: !!result?.ok,
    reason: result?.reason,
    events
  };
}

/**
 * 返回动作规格说明，给 LLM / MCP 工具调用作为 Schema 规范使用
 * @returns {Array} 动作规格列表
 */
export function describeActions() {
  return [
    {
      name: 'move',
      description: '将己方地块中的指定单位移动到目标地块。如果目标为无防守敌方地块则直接占领。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', const: 'move' },
          from: { type: 'integer', description: '出发地块 ID' },
          to: { type: 'integer', description: '目的地块 ID' },
          armyId: { type: 'integer', description: '要移动的单位 ID' }
        },
        required: ['type', 'from', 'to', 'armyId']
      },
      prerequisites: '单位必须拥有足够的剩余移动力；行军路径不能被阻挡且单位能进入目标地形（如非海军陆军需运输船才能下海）。'
    },
    {
      name: 'attack',
      description: '命令指定单位向射程内的敌方防守地块发起攻击（地面近战、火箭远程或航母空袭）。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', const: 'attack' },
          from: { type: 'integer', description: '攻击方所在地块 ID' },
          to: { type: 'integer', description: '目标敌军地块 ID' },
          armyId: { type: 'integer', description: '发起攻击的单位 ID' }
        },
        required: ['type', 'from', 'to', 'armyId']
      },
      prerequisites: '单位本回合尚有行动力，目标必须为敌方地块且处于攻击射程内。攻击后该单位本回合行动结束。'
    },
    {
      name: 'frontArmy',
      description: '在驻有多支部队的己方地块中，将指定单位调动至阵列首位（前排），使其成为主要交战与行动单位。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', const: 'frontArmy' },
          from: { type: 'integer', description: '地块 ID' },
          armyId: { type: 'integer', description: '要调至前排的单位 ID' }
        },
        required: ['type', 'from', 'armyId']
      },
      prerequisites: '地块属于当前行动国，且地块内包含多支部队。无需消耗移动力或资金。'
    },
    {
      name: 'buyCard',
      description: '花费资金与工业在卡片商店中购买卡片存入手牌（或研发升级国家科技）。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', const: 'buyCard' },
          card: { type: 'integer', description: '卡片 ID (0-28)' }
        },
        required: ['type', 'card']
      },
      prerequisites: '国家资金和工业满足该卡片价格要求，科技等级达到该卡片科技要求，且卡片冷却已就绪。'
    },
    {
      name: 'useCard',
      description: '使用卡片：包括在己方地块部署新兵种、建造升级设施、施加战术将领补给，或对敌方目标实施空袭轰炸核弹。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', const: 'useCard' },
          card: { type: 'integer', description: '卡片 ID (0-28)' },
          target: { type: 'integer', description: '目标地块 ID' },
          pendingPurchase: { type: 'boolean', description: '是否为即买即用（无需预先存入手中）' }
        },
        required: ['type', 'card', 'target']
      },
      prerequisites: '手牌拥有该卡片（或资金工业允许即买即用），目标地块符合卡片特定规则（如城市等级、机场距离等），冷却已就绪。'
    },
    {
      name: 'endTurn',
      description: '结束当前国家的本回合行动，进入下一国家行动队列或下一回合资源结算。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', const: 'endTurn' }
        },
        required: ['type']
      },
      prerequisites: '当前必须是己方国家的回合。'
    }
  ];
}
