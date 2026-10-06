// Port of formwork's BuildSituationReport and CompareSituationRows
// Computes country rankings, power ratings, economy, and buff summaries for all belligerents.

import { World } from './world.js';

export const COUNTRY_NAMES = {
  de: '德国', de1: '德国', de2: '德国', it: '意大利', it1: '意大利', ja: '日本', ja1: '日本', ja2: '日本',
  gb: '英国', gb1: '英国', fr: '法国', fr1: '法国', dk: '丹麦', nl: '荷兰', be: '比利时',
  no: '挪威', ru: '苏联', ru1: '苏联', ru2: '苏联', fl: '芬兰', ch: '瑞士',
  nk: '朝鲜', kr: '韩国', rk: '韩国', in: '印度', am: '美国', am1: '美国',
  ca: '加拿大', mx: '墨西哥', cn: '中国', tw: '中国', tw1: '中国', tw2: '中国',
  au: '澳大利亚', yu: '南斯拉夫', ro: '罗马尼亚', hu: '匈牙利', bg: '保加利亚',
  gr: '希腊', tr: '土耳其', es: '西班牙', pt: '葡萄牙', pl: '波兰', se: '瑞典',
  ir: '伊朗', iq: '伊拉克', eg: '埃及', ly: '利比亚', sa: '沙特', br: '巴西',
  ar: '阿根廷', cu: '古巴'
};

export function getCountryDisplayName(countryId, flag) {
  return COUNTRY_NAMES[countryId] || COUNTRY_NAMES[flag] || countryId || '未知国家';
}

export function computeArmyPower(st, countryId, army) {
  if (!army) return 0;
  const def = st.armyDef(countryId, army);
  const hp = Math.max(0, army.hp || 0);
  const attack = (def.minAttack || 0) + (def.maxAttack || 0);
  const level = Math.max(0, army.level || 0);
  const mobility = Math.max(0, army.movement ?? def.movement ?? 1);
  let cardBonus = 0;
  if (army.cards & 1) cardBonus += 12; // ASSAULT
  if (army.cards & 2) cardBonus += 12; // DEFENCE
  if (army.cards & 4) cardBonus += 20; // CARRIER / transport
  if (army.cards & 8) cardBonus += 45; // COMMANDER
  return hp + attack * 3 + level * 18 + mobility * 4 + cardBonus;
}

export function buildSituationReport(game, sortType = 0) {
  const st = game.stage;
  const player = game.player;

  // 1. Collect country area and army stats
  const areaCounts = new Map();
  const armyCounts = new Map();
  const armyPowers = new Map();

  for (const c of st.data.countries) {
    areaCounts.set(c.id, 0);
    armyCounts.set(c.id, 0);
    armyPowers.set(c.id, 0);
  }

  for (const area of st.areas) {
    if (!st.enabled.has(area.id) || !area.country) continue;
    if (!area.sea) areaCounts.set(area.country, (areaCounts.get(area.country) || 0) + 1);
    for (const army of area.armies || []) {
      armyCounts.set(area.country, (armyCounts.get(area.country) || 0) + 1);
      armyPowers.set(area.country, (armyPowers.get(area.country) || 0) + computeArmyPower(st, area.country, army));
    }
  }

  // 2. Build rows
  const countryRows = st.data.countries.map(c => {
    const isPlayer = !game.spectating && c.id === player;
    const info = st.countries.get(c.id);
    // Spectator snapshots must not expose a country's private reserves.
    const money = game.spectating ? null : isPlayer ? game.money : (info?.money ?? c.money ?? 0);
    const industry = game.spectating ? null : isPlayer ? game.industry : (info?.industry ?? c.industry ?? 0);
    const tech = isPlayer ? game.tech : (info?.techlevel || c.techlevel || 1);
    const inc = game.income(c.id);
    const tax = inc.money;
    const production = inc.industry;
    const areaCount = areaCounts.get(c.id) || 0;
    const armyCount = armyCounts.get(c.id) || 0;
    const armyPower = armyPowers.get(c.id) || 0;
    const defeated = c.defeated === true || c.eliminated === true || info?.defeated === true || info?.eliminated === true || areaCount === 0;

    // Score calculation following formwork formula:
    // score = armyPower + areaCount * 70 + tax * 8 + production * 10 + money / 2 + industry / 2 + tech * 80;
    let score = armyPower + areaCount * 70 + tax * 8 + production * 10 + Math.floor(Math.max(0, money) / 2) + Math.floor(Math.max(0, industry) / 2) + tech * 80;
    if (defeated) score = Math.floor(score / 2);

    let buff = '';
    if (c.taxfactor && c.taxfactor > 1) buff += `税收+${Math.round((c.taxfactor - 1) * 100)}% `;
    if (c.commanderLevel && c.commanderLevel > 5) buff += `指挥官Lv${c.commanderLevel} `;
    if (!buff) buff = '正常';

    return {
      id: c.id,
      name: getCountryDisplayName(c.id, c.flag),
      flag: c.flag || c.id,
      alliance: c.alliance,
      isPlayer,
      defeated,
      money,
      industry,
      tax,
      production,
      armyCount,
      armyPower,
      areaCount,
      tech,
      score,
      buff: buff.trim(),
    };
  });

  // The source panel combines formations with the same displayed nation and alliance.
  const merged = new Map();
  for (const row of countryRows) {
    const key = `${row.alliance}:${row.name}`;
    const target = merged.get(key);
    if (!target) { merged.set(key, { ...row }); continue; }
    target.isPlayer ||= row.isPlayer;
    target.defeated &&= row.defeated;
    for (const field of ['money', 'industry', 'tax', 'production', 'armyCount', 'armyPower', 'areaCount', 'score']) {
      if (target[field] != null && row[field] != null) target[field] += row[field];
    }
    if (row.buff !== '正常' && !target.buff.includes(row.buff)) target.buff = target.buff === '正常' ? row.buff : `${target.buff} / ${row.buff}`;
  }
  const rows = [...merged.values()];

  // 3. Sort rows by sortType
  // Match formwork: score, reserves, tax income, unit count, land area.
  rows.sort((a, b) => {
    if (a.defeated !== b.defeated) return a.defeated ? 1 : -1;
    let valA = a.score, valB = b.score;
    if (sortType === 1) {
      valA = Math.max(0, a.money) + Math.max(0, a.industry);
      valB = Math.max(0, b.money) + Math.max(0, b.industry);
    } else if (sortType === 2) {
      valA = a.tax;
      valB = b.tax;
    } else if (sortType === 3) {
      valA = a.armyCount;
      valB = b.armyCount;
    } else if (sortType === 4) {
      valA = a.areaCount;
      valB = b.areaCount;
    }
    if (valA !== valB) return valB - valA;
    if (a.alliance !== b.alliance) return (a.alliance || 0) - (b.alliance || 0);
    return a.id.localeCompare(b.id);
  });

  return {
    round: game.round,
    totalCountries: rows.length,
    activeCountries: rows.filter(r => !r.defeated).length,
    sortType,
    rows,
  };
}
