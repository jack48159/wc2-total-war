import { World } from './world.js';

// Designed scenarios, not a literal historical order of battle. Income scales with territory losses.
export const SANDBOX_BATTLES = [
  { id: 'de_pl', name: '德国 vs 波兰', year: '1939', countries: ['de', 'pl'],
    description: '德国装甲突破，对抗波兰纵深防线。双方都能补兵与反击。',
    economies: { de: [560, 180, 230, 70], pl: [620, 180, 215, 75] },
    forces: {
      de: { tank: [140,141,144,147,149,150], panzer: [124,128,145,172], artillery: [123,145,146,150], infantry: [124,149,167,172] },
      pl: { tank: [137,154,161], panzer: [134,156], artillery: [127,137,153,154,161], infantry: [127,134,135,136,138,139,151,154,158,161] }
    }, capitals: { de:149, pl:154 } },
  { id: 'de_fr', name: '德国 vs 法国', year: '1940', countries: ['de', 'fr'],
    description: '德国机动突击，对抗法国炮兵与纵深预备队；北方走廊可攻可守。',
    economies: { de: [650, 240, 290, 100], fr: [700, 260, 285, 105] },
    forces: {
      de: { tank:[140,141,144,147,149,150,172], panzer:[124,146,167,1020], artillery:[123,145,146,150,1024,1029], infantry:[124,145,149,167,171,1020,1046] },
      fr: { tank:[65,68,1028,1121,1126,1139], panzer:[1124,1159], artillery:[73,1025,1027,1028,1122,1132,1142], infantry:[63,65,68,71,1028,1049,1117,1121,1122,1137] }
    }, capitals:{de:149,fr:1121} },
  { id: 'de_ru', name: '德国 vs 苏联', year: '1941', countries: ['de', 'ru'],
    description: '德国前线集中，苏联后备更厚；争夺交通线、工业与恢复空间。',
    economies: { de: [850, 320, 400, 130], ru: [900, 340, 430, 150] },
    forces: {
      de: { tank:[128,134,137,140,141,144,147,149,154,161], panzer:[124,127,135,136,145,150,156,172], artillery:[123,127,134,137,145,154,161,1019], infantry:[124,128,149,151,154,161] },
      ru: { tank:[109,132,158,187,204,227,951,1036], panzer:[80,131,133,193,953], artillery:[109,130,132,158,190,205,213,227,233,1036], infantry:[83,106,129,131,132,133,157,158,183,193,204,227,939,1038,1062] }
    }, capitals:{de:149,ru:204} }
];

export function applySandboxBattle(data, id) {
  const preset = SANDBOX_BATTLES.find(p => p.id === id);
  if (!preset) throw new Error('未知经典战场');
  const sides = new Set(preset.countries), byArea = new Map(data.areas.map(a => [a.id, a]));
  // Supply the connecting fronts without introducing third-party belligerents.
  if (id === 'de_pl') for (const n of [129,130,131,132,133,157,158,159,160,161]) {
    if (byArea.has(n)) byArea.get(n).country = 'pl';
  }
  if (id === 'de_fr') for (const area of data.areas) {
    if (['be','nl'].includes(area.country)) area.country = 'fr';
  }
  if (id === 'de_ru') for (const area of data.areas) {
    if (area.country === 'pl') area.country = 'de';
  }
  for (const area of data.areas) {
    area.armies = [];
    if (!sides.has(area.country)) area.country = null;
  }
  data.countries = data.countries.filter(c => sides.has(c.id));
  data.diplomacy = { enabled:true, relations:{[preset.countries.slice().sort().join('_')]: 'war'}, pacts:{}, capitals:{...preset.capitals} };
  data.capitals = {...preset.capitals};
  delete data.scenarioEvents; delete data.events; delete data.ai_rules;
  for (const country of data.countries) {
    const [money, industry, income, industrialIncome] = preset.economies[country.id];
    Object.assign(country, { money, industry, techlevel:3, stability:100, commanderLevel:3, alliance:country.id, taxfactor:1 });
    const capital = byArea.get(preset.capitals[country.id]);
    Object.assign(capital, { country:country.id, construction:'city', level:4, installation:'fort' });
    for (const [type, positions] of Object.entries(preset.forces[country.id])) for (const n of positions) {
      const area = byArea.get(n);
      if (!area) throw new Error(`经典战场部署地块不存在：${n}`);
      area.country = country.id;
      if (area.armies.length >= (World.areas[n]?.unitCapacity || 4)) throw new Error(`经典战场部署超出容量：${n}`);
      area.armies.push({ type, level:1, cards:0 });
      if (type === 'artillery' && area.installation === 'none') area.installation = 'entrenchment';
    }
    let tax = 0, production = 0;
    for (const area of data.areas) if (area.country === country.id && World.areas[area.id]?.f !== 1) {
      const base = World.areas[area.id], kind = base?.areaType;
      const city = Math.max(kind === 1 ? 3 : kind === 3 ? 2 : kind === 4 ? 1 : 0, area.construction === 'city' ? area.level || 0 : 0);
      const factory = Math.max(kind === 1 ? 2 : kind === 3 ? 1 : 0, area.construction === 'industry' ? area.level || 0 : 0);
      tax += 5 * city + (base?.tax || 0); production += 5 * factory + (base?.industry || 0);
    }
    country.taxfactor = income / Math.max(1, tax);
    country.industryfactor = industrialIncome / Math.max(1, production);
  }
  // A closed theater prevents either side farming the rest of Europe for free income.
  const enabled = new Set(data.areas.filter(a => sides.has(a.country) && World.areas[a.id]?.f !== 1).map(a => a.id));
  for (const n of [...enabled]) for (const neighbour of World.adj[n] || []) {
    if (byArea.has(neighbour) && World.areas[neighbour]?.f !== 1) enabled.add(neighbour);
  }
  data.enabled = [...enabled]; data.areas = data.areas.filter(a => enabled.has(a.id));
  data.sandboxBattle = preset.id;
}
