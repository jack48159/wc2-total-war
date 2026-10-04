// Public world news only. Never copy command objects, wallets or AI evaluations here.
import { playerCountryName, playerAreaName } from './describe.js';

export const REPORT_LIMIT = 800;
export const IMPORTANT_CITY_LEVEL = 3;
export const IMPORTANT_INDUSTRY_LEVEL = 3;
export const MAJOR_LAND_LOSS_RATIO = 0.5;

const name = (game, id) => {
  if (!id) return '未知国家';
  const full = playerCountryName(id, game.stage);
  return full.startsWith('国家 [') ? (game.stage?.countries?.get(id)?.name || id) : full;
};
const areaName = id => playerAreaName(id);
const reasonName = why => ({ 'rejected-by-player': '对方拒绝', 'at-war': '双方交战中', 'not-peace': '双方并非和平状态', 'not-at-war': '双方并未交战', 'cooldown': '谈判尚在冷却期' })[why] || '条件未获接受';
export const reportFactKey = (round, action, first, second) => `${round || 1}:${action}:${first || ''}>${second || ''}`;
export const DIPLOMACY_SOURCES = {
  SCENARIO: 'scenario',
  RULE: 'rule',
  PLAYER: 'player',
  OFFER_ACCEPTED: 'offer_accepted',
  OFFER_REJECTED: 'offer_rejected',
  STAFF: 'staff',
  AI: 'ai',
  UNCLASSIFIED: 'unclassified',
};

export const UNMAPPED_DIPLOMACY_REASONS = new Set();

export const DIPLOMACY_SOURCE_MAP = {
  // 剧本事件
  event_action: 'scenario',
  scenario: 'scenario',
  scenario_event: 'scenario',
  event: 'scenario',

  // 规则自动联动
  war_cascade: 'rule',
  alliance_join_war: 'rule',
  allies_protect_neutral: 'rule',
  barbarossa_allies_ussr: 'rule',
  capitulation: 'rule',
  capitulation_ally: 'rule',
  'alliance betrayal': 'rule',
  alliance_betrayal: 'rule',
  'allied territory occupation': 'rule',
  allied_territory_occupation: 'rule',
  'hostile action': 'rule',
  hostile_action: 'rule',
  occupation: 'rule',
  rule: 'rule',
  war_reparations: 'rule',

  // 玩家接受 / 拒绝提议
  player_accepted_offer: 'offer_accepted',
  offer_accepted: 'offer_accepted',
  'rejected-by-player': 'offer_rejected',
  offer_rejected: 'offer_rejected',

  // 参谋托管
  staff: 'staff',
  takeover: 'staff',
  takeover_decision: 'staff',

  // 玩家操作
  player_action: 'player',
  player: 'player',

  // AI 行为
  ai_order: 'ai',
  ai_propose_peace: 'ai',
  ai_preventive_peace: 'ai',
  ai_low_stability_peace: 'ai',
  ai_propose_alliance: 'ai',
  ai_propose_nap: 'ai',
  ai_expansion_blocker_war: 'ai',
  ai_quick_elimination_war: 'ai',
  ai_strategic_war: 'ai',
  avoid_two_front: 'ai',
  desperate_defense: 'ai',
  ai: 'ai',
};

export function resolveDiplomacySource(reason, ctx = {}) {
  const r = typeof reason === 'string' ? reason.trim() : '';
  const game = ctx.game;
  const isScenario = !!(ctx.isScenario || game?._inScenarioEvent || r === 'event_action');
  const isAutoPlay = !!(ctx.isStaff || game?._inAutoPlay || ctx.staff || r === 'staff' || r === 'takeover' || r === 'takeover_decision');

  const direct = DIPLOMACY_SOURCE_MAP[r];
  if (direct === 'rule') return 'rule';
  if (isScenario || direct === 'scenario') return 'scenario';

  const player = game?.player;
  const involvesPlayer = !!(player && (ctx.first === player || ctx.second === player || ctx.actors?.includes(player)));

  // If neither country is the player, non-rule/non-scenario diplomacy is AI-to-AI
  if (!involvesPlayer && game?.player) {
    return 'ai';
  }

  // When player is involved:
  if (r === 'player_accepted_offer' || (involvesPlayer && ctx.second === player && ctx.accepted === true)) {
    return 'offer_accepted';
  }
  if (r === 'rejected-by-player' || ctx.why === 'rejected-by-player' ||
      (involvesPlayer && ctx.second === player && ctx.accepted === false)) {
    return 'offer_rejected';
  }

  if (isAutoPlay && (ctx.first === player || !ctx.first)) {
    return 'staff';
  }

  if (direct === 'staff') return 'staff';
  if (direct === 'player' || r === 'player_action' || r === 'player') return 'player';

  if (r === 'command' || r === 'manual') {
    if (isAutoPlay) return 'staff';
    if (ctx.aiIssued) return 'ai';
    if (ctx.first === player || game?.activeCountry === player || !ctx.first) return 'player';
    return 'ai';
  }

  if (direct === 'ai' || r.startsWith('ai_')) {
    if (isAutoPlay && (ctx.first === player || !ctx.first)) return 'staff';
    return 'ai';
  }

  if (r.startsWith('player_')) return 'player';

  if (r && !DIPLOMACY_SOURCE_MAP[r]) {
    UNMAPPED_DIPLOMACY_REASONS.add(r);
  }
  return 'unclassified';
}

export function foldOpeningReports(rows, expanded = false) {
  const opening = rows.filter(row => row.opening);
  if (!opening.length) return rows;
  return [...rows.filter(row => !row.opening),
    { id: 'opening-setup', round: 1, category: 'diplomacy', kind: 'openingSetupGroup', actors: [],
      source: 'scenario', detail: { reason: 'opening_setup' },
      text: `开局设定：${opening.length}项既有外交关系（点击${expanded ? '收起' : '展开'}）。`, importance: 1 },
    ...(expanded ? opening : [])];
}

function scenarioFactKey(round, id) {
  let m = /^nap_([^_]+)_([^_]+)_r\d+/.exec(id);
  if (m) return reportFactKey(round, 'nap', m[1], m[2]);
  m = /^offer_reject_(peace|alliance|nap)_([^_]+)_([^_]+)_r\d+/.exec(id);
  if (m) return reportFactKey(round, m[1], m[2], m[3]);
  m = /^capitulation_([^_]+)_([^_]+)_r\d+/.exec(id);
  if (m) return reportFactKey(round, 'capitulation', m[1], m[2]);
  m = /^capital_fallen_([^_]+)_r\d+/.exec(id);
  if (m) return reportFactKey(round, 'capital', m[1]);
  m = /^war_cascade_([^_]+)_([^_]+)_r\d+/.exec(id);
  if (m) return reportFactKey(round, 'war', m[1], m[2]);
  m = /^neutral_allied_([^_]+)/.exec(id);
  if (m) return reportFactKey(round, 'alliance', 'gb', m[1]);
  if (id === 'ussr_allied_west') return reportFactKey(round, 'alliance', 'gb', 'ru');
  return null;
}

export function savedReportFactKey(row) {
  if ('factKey' in row) return row.factKey || null;
  const [first, second] = row.actors || [];
  const kind = row.kind;
  if (kind === 'scenarioEvent') return scenarioFactKey(row.round || 1, row.detail?.scenarioId || '');
  if (kind === 'capitalCaptured') return reportFactKey(row.round, 'capital', second);
  if (kind === 'capitulation') return reportFactKey(row.round, 'capitulation', first, second);
  const action = kind === 'pactSigned' ? 'nap'
    : kind === 'warDeclared' ? 'war'
    : kind === 'allianceFormed' ? 'alliance'
    : kind === 'peaceSigned' ? 'peace'
    : ['offerProposed', 'offerAccepted', 'offerRejected'].includes(kind)
      ? row.text?.includes('互不侵犯') ? 'nap' : row.text?.includes('停战') ? 'peace' : row.text?.includes('结盟') ? 'alliance' : null
      : null;
  return action ? reportFactKey(row.round, action, first, second) : null;
}

export function reportForEvent(game, type, p) {
  if (type === 'scenarioEvent' && p.phase === 'resolved' && p.event?.id) {
    const event = p.event;
    return { category: 'scenario', kind: 'scenarioEvent', actors: [], factKey: scenarioFactKey(game.round || 1, event.id),
      text: `${event.title || '战略通报'}：${event.body || '事件已发生。'}`,
      detail: { scenarioId: event.id, scenarioText: event.body || '' }, importance: 2 };
  }
  const a = p.first, b = p.second;
  if (type === 'diplomacyChanged') {
    const state = p.stateName || ({ 1: 'war', 2: 'peace', 3: 'alliance' })[p.state];
    const allianceEnded = state !== 'alliance' && p.previousState === 3;
    const kind = state === 'war' ? 'warDeclared' : state === 'alliance' ? 'allianceFormed' : allianceEnded ? 'allianceEnded' : 'peaceSigned';
    const text = state === 'war' ? `${name(game, a)}向${name(game, b)}宣战。`
      : state === 'alliance' ? `${name(game, a)}与${name(game, b)}缔结同盟。`
      : allianceEnded ? `${name(game, a)}与${name(game, b)}解除同盟。` : `${name(game, a)}与${name(game, b)}达成停战协议。`;
    const action = state === 'war' ? 'war' : state === 'alliance' ? 'alliance' : 'peace';
    const negotiated = /^(?:ai_propose_|ai_low_stability_peace|player_action|player_accepted_offer|propose_)/.test(p.reason || '');
    const finalText = negotiated && state === 'alliance' ? `${name(game, a)}向${name(game, b)}提议结盟，${name(game, b)}接受，同盟建立。`
      : negotiated && state === 'peace' && !allianceEnded ? `${name(game, a)}向${name(game, b)}请求停战，${name(game, b)}接受，双方停战。` : text;
    const source = p.source || resolveDiplomacySource(p.reason, { game, first: a, second: b, type, state });
    const current = { category: 'diplomacy', kind, actors: [a, b], text: finalText, importance: 3,
      source, detail: { ...(p.detail || {}), reason: p.reason || source },
      factKey: p.reason && !['command', 'manual'].includes(p.reason) ? reportFactKey(game.round, action, a, b) : null };
    if (state === 'war' && p.previousState === 3) return [
      { category: 'diplomacy', kind: 'allianceEnded', actors: [a, b],
        source, detail: { ...(p.detail || {}), reason: p.reason || source },
        text: `${name(game, a)}与${name(game, b)}解除同盟。`, importance: 2 }, current ];
    return current;
  }
  if (type === 'diplomacyOfferResolved') {
    const action = { peace: '停战', alliance: '结盟', nap: '互不侵犯条约' }[p.action] || '外交协议';
    const source = p.source || resolveDiplomacySource(p.reason || (p.accepted ? 'player_accepted_offer' : (p.why || 'rejected-by-player')),
      { game, first: a, second: b, type, accepted: p.accepted, why: p.why });
    return { category: 'diplomacy', kind: p.accepted ? 'offerAccepted' : 'offerRejected', actors: [a, b],
      factKey: reportFactKey(game.round, p.action, a, b),
      source,
      detail: { ...(p.detail || {}), reason: p.reason || p.why || (p.accepted ? 'accepted' : 'rejected') },
      text: `${name(game, a)}向${name(game, b)}提议${action}，${name(game, b)}${p.accepted ? '接受' : `拒绝（${reasonName(p.why)}）`}${p.accepted && p.action === 'nap' ? '，条约生效' : ''}。`, importance: 2 };
  }
  if (type === 'diplomacyPact') {
    const source = p.source || resolveDiplomacySource(p.reason, { game, first: a, second: b, type });
    return { category: 'diplomacy', kind: 'pactSigned', actors: [a, b],
      factKey: reportFactKey(game.round, 'nap', a, b),
      source,
      detail: { ...(p.detail || {}), reason: p.reason || source },
      text: `${name(game, a)}与${name(game, b)}签订互不侵犯条约。`, importance: 2 };
  }
  if (type === 'warReparationsPaid' && ((p.paid || 0) !== 0 || (p.industry || 0) !== 0)) {
    const source = p.source || resolveDiplomacySource(p.reason || 'rule', { game, first: p.from, second: p.to, type });
    return { category: 'diplomacy', kind: 'reparations', actors: [p.from, p.to],
      source,
      detail: { ...(p.detail || {}), money: p.paid || 0, industry: p.industry || 0, reason: p.reason || 'war_reparations' },
      text: `${name(game, p.from)}向${name(game, p.to)}赔偿${p.paid || 0}金币${p.industry ? `及${p.industry}工业` : ''}。`,
      importance: 2 };
  }
  if (type === 'countryCapitulated') return { category: 'military', kind: 'capitulation', actors: [p.country, p.to],
    factKey: reportFactKey(game.round, 'capitulation', p.country, p.to),
    text: `${name(game, p.country)}向${name(game, p.to)}投降。`, importance: 4 };
  if (type === 'countryDefeated') return { category: 'military', kind: 'countryDefeated', actors: [p.country, p.byCountry],
    text: `${name(game, p.country)}被消灭${p.byCountry ? `，领土由${name(game, p.byCountry)}接管` : ''}。`, importance: 5 };
  if (type === 'gameOver') return { category: 'military', kind: 'gameOver', actors: [game.player],
    text: `${game.name.startsWith('conquest_') ? '征服' : '战役'}结束：${p.result === 'defeat' ? '战败' : p.result === 'greatVictory' ? '大获全胜' : '获胜'}。`, importance: 5 };
  if (type === 'areaCaptured' && p.from && p.to && p.from !== p.to && p.cause !== 'countryDefeated') {
    const area = game.stage?.st?.(p.area);
    if (!area || area.sea) return null;
    const entries = [];
    const capital = game.diplomacy?.capitals?.[p.from] === p.area || area.areaType === 1;
    const recovered = game.diplomacy?.capitals?.[p.to] === p.area;
    const highestCityLevel = game.stage.areas.reduce((level, x) =>
      x.construction === 'city' ? Math.max(level, x.level || 0) : level, 0);
    const city = area.areaType === 3 || (area.construction === 'city' &&
      (area.level >= IMPORTANT_CITY_LEVEL || (highestCityLevel >= 2 && area.level === highestCityLevel)));
    const port = area.areaType === 2 || area.installation === 'port' || area.construction === 'port';
    const industry = area.construction === 'industry' && area.level >= IMPORTANT_INDUSTRY_LEVEL;
    if (capital || recovered || city || port || industry) {
      const label = recovered ? `${name(game, p.to)}首都` : capital ? `${name(game, p.from)}首都` : port ? '重要港口' : industry ? '大型工业区' : '重要城市';
      entries.push({ category: 'military', kind: recovered ? 'capitalRecovered' : capital ? 'capitalCaptured' : 'importantAreaCaptured',
        actors: [p.to, p.from], text: `${name(game, p.to)}${recovered ? '收复' : '占领'}了${areaName(p.area)}（${label}）。`,
        factKey: capital && !recovered ? reportFactKey(game.round, 'capital', p.from) : null,
        detail: { area: p.area }, importance: capital || recovered ? 4 : 2 });
    }
    const original = game.diplomacy?.originalLands?.[p.from];
    if (original > 1 && !(game.reportLog || []).some(r => r.kind === 'majorLandLoss' && r.actors?.[0] === p.from)) {
      const remaining = game.stage.areas.filter(x => x.country === p.from && !x.sea).length;
      if (remaining / original <= MAJOR_LAND_LOSS_RATIO) entries.push({ category: 'military', kind: 'majorLandLoss', actors: [p.from, p.to],
        text: `${name(game, p.from)}已失去过半领土。`, detail: { remaining, original }, importance: 3 });
    }
    return entries;
  }
  return null;
}
