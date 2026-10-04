// Player-facing Chinese labels for countries, areas and commands.
// Shared by the AI-turn banner and auto-play status text.

import { COUNTRY_NAMES, FAMOUS_AREAS, getCardName } from './api/names.js';

const ORDINALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function flagOf(countryId, stage) {
  const info = stage?.countries?.get(countryId);
  if (info?.flag) return info.flag;
  return String(countryId || '').replace(/\d+$/, '') || null;
}

function baseCountryName(countryId, flag) {
  if (COUNTRY_NAMES[countryId]) return COUNTRY_NAMES[countryId];
  if (flag && COUNTRY_NAMES[flag]) return COUNTRY_NAMES[flag];
  return null;
}

export function playerCountryName(countryId, stage = null) {
  if (!countryId) return '中立地区';
  const flag = flagOf(countryId, stage);
  const mine = baseCountryName(countryId, flag) || '友军';
  if (!stage?.countries) return mine;

  const siblings = [];
  for (const id of stage.countries.keys()) {
    if (flagOf(id, stage) === flag) siblings.push(id);
  }
  if (siblings.length <= 1) return mine;

  const names = siblings.map(id => baseCountryName(id, flag) || '友军');
  const dupes = names.filter(n => n === mine).length;
  if (dupes <= 1) return mine;

  const idx = Math.max(0, siblings.indexOf(countryId));
  const flagName = (flag && COUNTRY_NAMES[flag]) || mine;
  return `${flagName}第${ORDINALS[idx] || (idx + 1)}军`;
}

export function playerAreaName(areaId) {
  if (areaId == null || areaId === '') return '未知地区';
  const named = FAMOUS_AREAS[areaId] || FAMOUS_AREAS[Number(areaId)];
  if (named) return named;
  const n = Number(areaId);
  return Number.isFinite(n) ? `第 ${n} 区` : '未知地区';
}

function cardLabel(cmd, game) {
  const raw = cmd?.card;
  const id = raw && typeof raw === 'object' ? raw.id : raw;
  if (id == null) return '部队';
  if (game?.findCard) {
    const card = game.findCard(id, cmd.country || game.activeCountry);
    if (card?.id != null) return getCardName(card.id);
  }
  return getCardName(id);
}

const BLOCKED_REASONS = {
  'no-army': '部队无法行动',
  'not-active-country': '尚未轮到该国',
  'no-movement': '行动力不足',
  'illegal-target': '目标不可达',
  'diplomacy-forbidden': '外交限制',
  'no-card': '没有可用卡牌',
  'unknown-card': '未知卡牌',
  cooldown: '卡牌冷却中',
  money: '资金不足',
  industry: '工业值不足',
  tech: '科技不足',
  failed: '未能执行',
};

export function describeBlocked(reason) {
  return BLOCKED_REASONS[reason] || '未能执行';
}

export function describeCommand(cmd, game) {
  if (!cmd) return '待命';
  const area = id => playerAreaName(id);
  switch (cmd.type) {
    case 'move':
    case 'moveUnit':
    case 'attack': {
      const here = area(cmd.from);
      const there = area(cmd.to);
      if (cmd.from == null || cmd.from === '') return `进攻 ${there}`;
      return `从 ${here} 进攻 ${there}`;
    }
    case 'useCard':
      return `在 ${area(cmd.target)} 部署${cardLabel(cmd, game)}`;
    case 'buyCard':
      return `购置${cardLabel(cmd, game)}`;
    case 'frontArmy':
      return '调整前线部队';
    case 'endTurn':
      return '结束回合';
    case 'setDiplomacy':
      return '调整外交关系';
    case 'resolveEventNotice':
      return '确认战报';
    case 'resolveEventDecision':
      return '作出决策';
    default:
      return '调遣部队';
  }
}

export function commandFocusArea(cmd) {
  if (!cmd) return null;
  if (cmd.to != null) return cmd.to;
  if (cmd.target != null) return cmd.target;
  if (cmd.from != null) return cmd.from;
  return null;
}
