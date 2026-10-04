// Output interface: extract structured, JSON-serializable player perspective view
import { listActions } from './actions.js';
import { shopCards } from '../cards.js';
import { World } from '../world.js';
import { analyzeCardTargets } from './card_targets.js';
import { TACTIC_CARDS, TACTIC_NAMES } from '../tactics.js';
import {
  getAreaName,
  getAreaTypeName,
  getUnitName,
  getCardName,
  getCountryName,
  CARD_DESC,
  CONSTRUCTION_NAMES,
  INSTALLATION_NAMES
} from './names.js';

function parseTacticCards(mask) {
  const cards = [];
  for (const id of [23, 24, 22]) if (mask & TACTIC_CARDS.get(id)) cards.push(TACTIC_NAMES[id]);
  if (mask & 8) cards.push('将领统领');
  return cards;
}

/**
 * 获取玩家视角的完整对局局面数据
 * @param {Object} game 游戏实例
 * @param {string} country 视角国家 ID，默认为游戏人类玩家
 * @param {Object} opts 配置项: { detail: 'summary'|'full', actions: boolean }
 * @returns {Object} 纯 JSON 对象（无循环引用）
 */
export function getPlayerView(game, country = game.player, opts = {}) {
  const stage = game.stage;
  const isPlayer = country === game.player;
  const detail = opts.detail || 'summary';
  const includeActions = opts.actions !== false;

  // 1. 对局信息
  const activeCountryName = getCountryName(game.activeCountry, stage);
  const countryName = getCountryName(country, stage);
  const gameInfo = {
    stageId: game.name,
    stageName: game.info?.name || game.name,
    faction: game.info?.faction || '',
    round: game.round,
    totalRounds: game.totalRounds,
    greatVictoryRounds: game.info?.greatVictory || null,
    activeCountry: game.activeCountry,
    activeCountryName,
    perspectiveCountry: country,
    perspectiveCountryName: countryName,
    isMyTurn: game.activeCountry === country,
    phase: game.phase,
    result: game.result,
    victoryCondition: game.info?.intro || (game.info?.conquest ? '消灭所有敌对国家，统一全地图' : '击败关键敌军并占领目标战略要地')
  };

  // 2. 经济信息
  const wallet = isPlayer ? game : stage.countries.get(country);
  const income = game.income(country);
  const economy = {
    money: wallet?.money ?? 0,
    industry: wallet?.industry ?? 0,
    techLevel: isPlayer ? game.tech : wallet?.techlevel ?? 1,
    techUpgradeInTurns: isPlayer ? game.techTurn : wallet?.techTurn ?? 0,
    income: {
      money: income.money,
      industry: income.industry
    }
  };

  // 3. 己方地块与军事单位
  const myAreas = [];
  const myArmies = [];
  const myAreaIds = new Set();

  for (const area of stage.areas) {
    if (!stage.enabled.has(area.id) || area.country !== country) continue;
    myAreaIds.add(area.id);

    const neighbours = stage.adjE.get(area.id) || [];
    // 检查是否被敌对势力包围
    const isEncircled = neighbours.length > 0 && neighbours.every(nId => {
      const nArea = stage.st(nId);
      return nArea && nArea.country && !stage.areAllied(nArea.country, country);
    });

    const areaItem = {
      id: area.id,
      name: getAreaName(area.id, stage),
      type: getAreaTypeName(area),
      isSea: !!area.sea,
      construction: area.construction || 'none',
      constructionName: CONSTRUCTION_NAMES[area.construction] || area.construction,
      level: area.level || 0,
      installation: area.installation || 'none',
      installationName: INSTALLATION_NAMES[area.installation] || area.installation,
      tax: World.areas?.[area.id]?.tax || 0,
      industry: World.areas?.[area.id]?.industry || 0,
      isEncircled,
      adjacentAreas: neighbours
    };

    if (detail === 'full') {
      areaItem.unitCapacity = stage.maxArmies(area);
    }
    myAreas.push(areaItem);

    // 收集己方单位
    if (area.armies && area.armies.length > 0) {
      area.armies.forEach((army, index) => {
        const tacticCards = parseTacticCards(army.cards || 0);
        const armyItem = {
          id: army.id,
          areaId: area.id,
          areaName: getAreaName(area.id, stage),
          type: army.type,
          name: getUnitName(army.type),
          hp: army.hp,
          maxHp: army.maxHp,
          rank: army.level || 0,
          movement: army.movement || 0,
          maxMovement: army.maxMovement || stage.armyDef(country, army.type)?.movement || 0,
          canAct: stage.canAct(army) && (army.movement || 0) > 0,
          morale: army.morale || 0,
          isFront: index === 0,
          tacticCards
        };
        myArmies.push(armyItem);
      });
    }
  }

  // 4. 其他国家态势及前线接触面
  const otherCountries = [];
  const borderHostileAreas = [];
  const borderHostileAreaIds = new Set();
  const ownershipChangesUnknown = [];

  for (const c of stage.data.countries) {
    if (c.id === country) continue;
    const isAllied = stage.areAllied(country, c.id);
    const eliminated=!!stage.countries.get(c.id)?.eliminated;
    const rememberedAreas=stage.areas.filter(a=>stage.enabled.has(a.id)&&a.country===c.id);
    if(eliminated)for(const area of rememberedAreas)ownershipChangesUnknown.push({areaId:area.id,name:getAreaName(area.id,stage),owner:null,previousOwner:c.id,ownershipStatus:'changed-new-owner-unknown',note:'归属已变更，新归属未知（未侦察）。'});
    const countryAreas = eliminated?[]:rememberedAreas;
    const territoryCount = countryAreas.length;
    const isDefeated = eliminated||territoryCount === 0;

    const cItem = {
      id: c.id,
      flag: c.flag,
      name: getCountryName(c.id, stage),
      alliance: c.alliance,
      relation: isAllied ? 'allied' : 'hostile',
      relationName: isAllied ? '盟友' : '敌对',
      territoryCount,
      isDefeated,
      eliminated,
      territoryStatus:eliminated?'transferred':'active',
      note:eliminated?'国家已灭亡，领地已转移。':null,
      commander: c.commander || ''
    };

    // 收集与己方接壤或在前线的地块及驻军
    for (const a of countryAreas) {
      const neighbours = stage.adjE.get(a.id) || [];
      const isBorder = neighbours.some(nId => myAreaIds.has(nId));
      if (isBorder || detail === 'full' || a.areaType === 1) {
        if (!borderHostileAreaIds.has(a.id)) {
          borderHostileAreaIds.add(a.id);
          const armies = (a.armies || []).map(ar => ({
            id: ar.id,
            type: ar.type,
            name: getUnitName(ar.type),
            hp: ar.hp,
            maxHp: ar.maxHp,
            rank: ar.level || 0,
            movement: ar.movement || 0,
            morale: ar.morale || 0,
            tacticCards: parseTacticCards(ar.cards || 0)
          }));

          borderHostileAreas.push({
            id: a.id,
            country: a.country,
            countryName: getCountryName(a.country, stage),
            name: getAreaName(a.id, stage),
            type: getAreaTypeName(a),
            construction: a.construction || 'none',
            constructionName: CONSTRUCTION_NAMES[a.construction] || a.construction,
            installation: a.installation || 'none',
            installationName: INSTALLATION_NAMES[a.installation] || a.installation,
            isBorderWithMe: isBorder,
            armies
          });
        }
      }
    }

    otherCountries.push(cItem);
  }

  // 5. 卡片
  const handCards = [];
  if (isPlayer && game.hand) {
    for (const [idStr, count] of Object.entries(game.hand)) {
      if (count > 0) {
        const cardId = Number(idStr);
        handCards.push({
          id: cardId,
          name: getCardName(cardId),
          count,
          description: CARD_DESC[cardId] || ''
        });
      }
    }
  }

  const shopCardList = [];
  const availableInShop = shopCards(game.cardData, stage.countries.get(country)?.flag);
  for (const card of availableInShop) {
    const whyNot = game.whyNot(card, country);
    const item = {
      id: card.id,
      name: getCardName(card.id),
      price: game.price(card, country),
      industryCost: game.industryCost(card, country),
      canBuy: whyNot === null,
      whyNot: whyNot || null,
      cooldown: isPlayer ? (game.cardCooldowns[card.id] || 0) : 0,
      ...analyzeCardTargets(game,card.id,country)
    };
    if (detail === 'full') {
      item.type = card.type;
      item.tech = card.tech;
      item.intro = card.intro;
    }
    shopCardList.push(item);
  }

  // 6. 最近事件 (来自 gameLog)
  const recentEvents = [];
  if (game.gameLog && Array.isArray(game.gameLog)) {
    const logs = game.gameLog.slice(-15);
    for (const entry of logs) {
      if (['military', 'combat', 'turn'].includes(entry.category)) {
        recentEvents.push({
          id: entry.id,
          round: entry.round,
          category: entry.category,
          event: entry.event,
          actorCountry: entry.actorCountry,
          actorCountryName: getCountryName(entry.actorCountry, stage),
          data: entry.data
        });
      }
    }
  }

  // 7. 可用合法动作
  let availableActions = null;
  if (includeActions) {
    availableActions = listActions(game, country);
  }

  return {
    gameInfo,
    economy,
    militaryUnits: myArmies,
    territory: myAreas,
    otherCountries,
    contactAreas: borderHostileAreas,
    ownershipChangesUnknown,
    cards: {
      hand: handCards,
      shop: shopCardList
    },
    recentEvents,
    availableActions
  };
}

/**
 * 将局面对象转换为紧凑优美的中文纯文本，方便直接送入大语言模型作为提示词
 * @param {Object} view getPlayerView 返回的局面数据
 * @returns {string} 紧凑格式化中文文本
 */
export function viewToText(view) {
  if (!view) return '无对局数据';

  const { gameInfo, economy, militaryUnits, territory, otherCountries, contactAreas, cards, availableActions } = view;
  const lines = [];

  lines.push(`=== 【对局态势】 ===`);
  lines.push(`关卡: ${gameInfo.stageName} (${gameInfo.stageId}) | 第 ${gameInfo.round} 回合 / 上限 ${gameInfo.totalRounds || '无限制'} | 阶段: ${gameInfo.phase}`);
  lines.push(`当前行动方: ${gameInfo.activeCountryName} [${gameInfo.activeCountry}] ${gameInfo.isMyTurn ? '(我方行动中)' : '(等待中)'}`);
  lines.push(`胜利目标: ${gameInfo.victoryCondition}`);
  const eliminated=(otherCountries||[]).filter(c=>c.eliminated);
  if(eliminated.length)lines.push(`已灭亡: ${eliminated.map(c=>`${c.name}[${c.id}] eliminated，领地已转移（${c.territoryCount}块）`).join('；')}`);
  if(view.ownershipChangesUnknown?.length)lines.push(`未侦察归属变更: ${view.ownershipChangesUnknown.length}块（旧主人已灭亡，新归属未知）`);

  lines.push(`\n=== 【我方资源与经济】 ===`);
  lines.push(`资金: ${economy.money} | 工业: ${economy.industry} | 科技等级: Lv.${economy.techLevel}${economy.techUpgradeInTurns > 0 ? ` (升级还需 ${economy.techUpgradeInTurns} 回合)` : ''}`);
  lines.push(`每回合收入: +${economy.income.money} 资金, +${economy.income.industry} 工业 | 拥有领地: ${territory.length} 块`);

  lines.push(`\n=== 【卡片与战术储备】 ===`);
  if (cards.hand && cards.hand.length > 0) {
    const handStr = cards.hand.map(c => `${c.name} x${c.count}`).join('、');
    lines.push(`手牌: ${handStr}`);
  } else {
    lines.push(`手牌: 无`);
  }
  const affordableShop = cards.shop ? cards.shop.filter(c => c.canBuy).map(c => `${c.name}(${c.price}金/${c.industryCost}工)`).slice(0, 8).join('、') : '';
  lines.push(`当前可购卡片: ${affordableShop || '资金或工业不足'}`);

  lines.push(`\n=== 【己方作战部队】(共 ${militaryUnits.length} 支) ===`);
  if (militaryUnits.length === 0) {
    lines.push(`当前无存活部队！`);
  } else {
    for (const unit of militaryUnits) {
      const actStr = unit.canAct ? `剩余移动力: ${unit.movement}` : '本回合行动已耗尽';
      const tacticStr = unit.tacticCards.length ? ` [${unit.tacticCards.join('|')}]` : '';
      lines.push(`- #${unit.id} ${unit.name} | 位置: ${unit.areaName} | 生命: ${unit.hp}/${unit.maxHp} | 军衔: Lv.${unit.rank} | ${actStr}${tacticStr}`);
    }
  }

  lines.push(`\n=== 【敌对前线与接触面】 ===`);
  if (!contactAreas || contactAreas.length === 0) {
    lines.push(`暂无敌方接触面信息。`);
  } else {
    for (const ca of contactAreas.slice(0, 10)) {
      const armyDesc = ca.armies.length > 0
        ? ca.armies.map(a => `${a.name}#${a.id}(HP:${a.hp}/${a.maxHp})`).join(', ')
        : '空城/无驻军';
      lines.push(`- ${ca.name} [${ca.countryName}] | 设施: ${ca.constructionName}/${ca.installationName} | 守军: ${armyDesc}`);
    }
  }

  if (availableActions && availableActions.length > 0) {
    lines.push(`\n=== 【当前合法可执行操作】(共 ${availableActions.length} 项候选) ===`);
    // 分类展示合法操作
    const moves = availableActions.filter(a => a.type === 'move');
    const attacks = availableActions.filter(a => a.type === 'attack');
    const buys = availableActions.filter(a => a.type === 'buyCard');
    const uses = availableActions.filter(a => a.type === 'useCard');
    const others = availableActions.filter(a => a.type === 'endTurn' || a.type === 'frontArmy');

    if (attacks.length) {
      lines.push(`[攻击指令 (${attacks.length})]:`);
      attacks.slice(0, 8).forEach(a => lines.push(`  * ${a.description} -> 传参: ${JSON.stringify(a.command)}`));
      if (attacks.length > 8) lines.push(`  * ...以及其余 ${attacks.length - 8} 个攻击目标`);
    }
    if (moves.length) {
      lines.push(`[机动行军 (${moves.length})]:`);
      moves.slice(0, 8).forEach(a => lines.push(`  * ${a.description} -> 传参: ${JSON.stringify(a.command)}`));
      if (moves.length > 8) lines.push(`  * ...以及其余 ${moves.length - 8} 个移动目标`);
    }
    if (buys.length) {
      lines.push(`[购买卡片 (${buys.length})]:`);
      buys.forEach(a => lines.push(`  * ${a.description} -> 传参: ${JSON.stringify(a.command)}`));
    }
    if (uses.length) {
      lines.push(`[使用卡片 (${uses.length})]:`);
      uses.slice(0, 6).forEach(a => lines.push(`  * ${a.description} -> 传参: ${JSON.stringify(a.command)}`));
    }
    if (others.length) {
      lines.push(`[战术调度与回合]:`);
      others.forEach(a => lines.push(`  * ${a.description} -> 传参: ${JSON.stringify(a.command)}`));
    }
  }

  return lines.join('\n');
}
