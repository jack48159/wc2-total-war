import { playerCountryName } from './describe.js';
import { countryPower } from './rules/diplomacy.js';

// Only the player takeover uses this gate. AI countries keep their normal orders.
export const DIPLOMACY_COOLDOWN_ROUNDS = 3;
export const MAX_DIPLOMACY_PROMPTS_PER_ROUND = 3;

export const DIPLOMACY_ENUM_CN = {
  war: '战争',
  peace: '和平',
  alliance: '同盟',
  ceasefire: '停战',
  truce: '停战',
  nap: '互不侵犯条约',
  nonAggression: '互不侵犯条约',
  neutral: '中立',
};

const KNOWN_REASONS = {
  ai_expansion_blocker_war: '遏制该国扩张，消除战略侧翼威胁',
  ai_quick_elimination_war: '敌方实力虚弱且接壤，具备快速歼灭契机',
  ai_strategic_war: '我方总体军力占优，符合长期战略扩张目标',
  ai_preventive_peace: '战线过长或面临多重受压，主动求和以规避战损',
  ai_propose_peace: '战事陷入胶着且消耗过大，建议阶段性停战休整',
  ai_low_stability_peace: '国内稳定度偏低，急需停战以休养生息',
  ai_propose_alliance: '面临共同敌对势力，建议缔结同盟协同作战',
  ai_propose_nap: '巩固边境防线，避免卷入侧翼不必要的冲突',
  war_cascade: '盟国遭受攻击，依同盟盟约介入战争',
  alliance_join_war: '履行同盟条约义务协同参战',
  avoid_two_front: '避免陷入两线同时作战的被动局面',
  desperate_defense: '本土防线吃紧，建议紧急停战止损',
};

const DIPLOMACY_COMMANDS = new Set([
  'setDiplomacy', 'proposeDiplomacy', 'rejectPeaceOffer', 'setPact',
  'declareWar', 'surrender', 'offerPeace', 'requestPeace', 'signTreaty',
  'breakTreaty', 'sendAid', 'cedeTerritory', 'ultimatum',
]);

export function isDiplomacyCommand(command) {
  return !!command && (DIPLOMACY_COMMANDS.has(command.type) ||
    /diplomacy|alliance|treaty|peace|reparation|ultimatum|surrender|tribute/i.test(command.type));
}

export function diplomacyKey(command, player) {
  const target = command.first === player ? command.second : command.first || command.second || command.target || '';
  return `${command.type}:${command.state || command.action || command.pact || ''}:${target}`;
}

export function reportTakeoverChoice(game, text, actors = []) {
  game.addReport?.({ category: 'diplomacy', kind: 'takeoverDecision', actors, text, importance: 2 });
  if (game.logEnabled && game.gameLog) game.gameLog.push({
    schemaVersion: 2, id: game.nextGameLogId++, timestamp: new Date().toISOString(),
    gameId: game.gameId, round: game.round, phase: game.phase, actorCountry: game.player,
    category: 'diplomacy', event: 'takeoverDecision', data: { text, actors },
  });
}

export function formatDiplomacyPrompt(cmd, game) {
  const player = game?.player;
  const target = cmd.first === player ? cmd.second : (cmd.second === player ? cmd.first : cmd.second || cmd.first || cmd.target);
  const targetName = target ? playerCountryName(target, game?.stage) : '有关国家';
  const rawState = String(cmd.state || cmd.action || cmd.pact || '').toLowerCase();
  const stateCn = DIPLOMACY_ENUM_CN[rawState] || (rawState === '1' ? '战争' : rawState === '2' ? '和平' : rawState === '3' ? '同盟' : '');

  const isWar = rawState === 'war' || rawState === '1' || cmd.type === 'declareWar';
  const isPeace = rawState === 'peace' || rawState === '2' || rawState === 'ceasefire' || rawState === 'truce' || /peace/i.test(cmd.type);
  const isAlliance = rawState === 'alliance' || rawState === '3' || /alliance/i.test(cmd.type);
  const isNap = rawState === 'nap' || rawState === 'nonaggression' || cmd.type === 'setPact';
  const isSurrender = cmd.type === 'surrender';
  const isReparations = /reparation|tribute/i.test(cmd.type) || (cmd.reparations != null && !isWar);
  const isHighRisk = isWar || isSurrender || /ultimatum|breakTreaty|cedeTerritory/i.test(cmd.type);

  // 自然动作句
  let actionText;
  if (isWar) actionText = `向${targetName}宣战`;
  else if (isSurrender) actionText = `向${targetName}无条件投降`;
  else if (cmd.type === 'ultimatum') actionText = `对${targetName}发出最后通牒`;
  else if (cmd.type === 'breakTreaty') actionText = `撕毁与${targetName}的条约`;
  else if (cmd.type === 'cedeTerritory') actionText = `向${targetName}割让领地`;
  else if (cmd.type === 'sendAid') actionText = `向${targetName}提供战略援助`;
  else if (cmd.type === 'rejectPeaceOffer') actionText = `拒绝${targetName}的停战提议`;
  else if (isReparations && !isPeace) actionText = `向${targetName}支付战争赔款`;
  else if (isPeace) actionText = `向${targetName}提议停战`;
  else if (isAlliance) actionText = `向${targetName}提议结盟`;
  else if (isNap) actionText = `与${targetName}签订互不侵犯条约`;
  else actionText = `与${targetName}调整外交关系`;

  // 人性化条件与条款行
  const money = cmd.reparations ?? cmd.amount ?? cmd.money;
  const industry = cmd.industry;
  let conditionText;
  if (money != null) {
    conditionText = industry != null
      ? `关系将变为：${stateCn || '停战'} · 赔款：$${money}金币、${industry}工业`
      : `关系将变为：${stateCn || '停战'} · 赔偿：$${money}金币`;
  } else if (isWar) {
    conditionText = '关系将变为：战争（双方进入交战状态）';
  } else if (isPeace) {
    conditionText = '关系将变为：和平（签署停战协定）';
  } else if (isAlliance) {
    conditionText = '关系将变为：同盟（建立共同防御与协同作战）';
  } else if (isNap) {
    conditionText = '建立互不侵犯条约，稳固边境防线';
  } else if (isSurrender) {
    conditionText = '全面停止抵抗，割让受损区域并支付赔款';
  } else if (stateCn) {
    conditionText = `关系将变为：${stateCn}`;
  } else {
    conditionText = '执行参谋拟定的外交行动条款';
  }

  // 参谋判断理由：真实来源 > 客观事实依据 > 规范引导，杜绝自相矛盾或编造
  let rawReason = cmd.reason || cmd.decision?.why || cmd.decision?.reason;
  let reasonText;

  // 校验自相矛盾：宣战动作绝不能配"求和/避免两线作战"
  if (isWar && typeof rawReason === 'string' && /两线作战|停战|求和|防线吃紧/.test(rawReason)) {
    rawReason = null;
  }
  // 校验自相矛盾：求和动作绝不能配"消灭|扩张|宣战"
  if (isPeace && typeof rawReason === 'string' && /消灭|扩张|宣战/.test(rawReason)) {
    rawReason = null;
  }

  if (rawReason && KNOWN_REASONS[rawReason]) {
    reasonText = KNOWN_REASONS[rawReason];
  } else if (typeof rawReason === 'string' && !/^[a-z0-9_]+$/i.test(rawReason) && rawReason.trim()) {
    reasonText = rawReason.trim();
  } else {
    // 无法获取准确原因时，提取客观事实依据
    let myP = null, tgtP = null;
    try {
      if (game && player && Array.isArray(game.stage?.areas)) myP = countryPower(game, player);
      if (game && target && Array.isArray(game.stage?.areas)) tgtP = countryPower(game, target);
    } catch {}

    if (myP?.power != null && tgtP?.power != null) {
      reasonText = `双方军力评估：我方 ${myP.power} vs 敌方 ${tgtP.power}`;
    } else {
      reasonText = isWar
        ? '参谋建议：符合当前战略推进方向'
        : isPeace
        ? '参谋建议：当前战局适宜休整'
        : isAlliance
        ? '参谋建议：符合共同安全利益'
        : '参谋建议执行此外交动作';
    }
  }

  return {
    target,
    targetName,
    actionText,
    conditionText,
    reasonText,
    isHighRisk
  };
}
