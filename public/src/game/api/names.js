// Name dictionaries and formatting utilities for player view and actions
import { World } from '../world.js';
import { AREA_NAMES_MAP1 } from '../area_names_map1.js';
import { TACTIC_NAMES, TACTIC_DESCRIPTIONS } from '../tactics.js';

export const ARMY_NAMES = {
  infantry: '步兵',
  panzer: '装甲车',
  artillery: '大炮',
  rocket: '火箭炮',
  tank: '坦克',
  heavytank: '重坦克',
  eliteinfantry: '特种步兵',
  destroyer: '驱逐舰',
  cruiser: '巡洋舰',
  battleship: '战列舰',
  aircraftcarrier: '航空母舰',
};

export const CARD_NAMES = {
  0: '步兵',
  1: '装甲车',
  2: '大炮',
  3: '火箭炮',
  4: '坦克',
  5: '重坦克',
  6: '驱逐舰',
  7: '巡洋舰',
  8: '战列舰',
  9: '航空母舰',
  10: '空袭',
  11: '轰炸',
  12: '空降兵',
  13: '核弹',
  14: '城市',
  15: '工业',
  16: '机场',
  17: '要塞炮',
  18: '战壕',
  19: '防空机枪',
  20: '雷达',
  21: '研发科技',
  ...TACTIC_NAMES,
  25: '指挥官',
  26: '战地补给',
  27: '王牌部队/晋升',
  28: '特种步兵',
};

export const CARD_DESC = {
  0: '在所属城市组建步兵主力军',
  1: '在工业区组建高机动性装甲车',
  2: '在工业区部署大炮，具有攻击反击掩护',
  3: '在工业区部署火箭炮，实施2格范围打击',
  4: '在工业区部署坦克，突击冲锋',
  5: '在高级工业区部署重坦克，反击坚固重装甲',
  6: '在海域部署驱逐舰，负责海上护航巡逻',
  7: '在海域部署巡洋舰，海战主力舰艇',
  8: '在海域部署战列舰，拥有大口径厚装甲巨炮',
  9: '在海域部署航空母舰，执行远程舰载机空袭',
  10: '出动战机对敌方区域首位单位实施空中打击',
  11: '战略轰炸敌方区域内全部部队与工业建筑设施',
  12: '在指定陆地区域空降1支步兵单位进驻或夺取',
  13: '在指定区域投放核弹，彻底摧毁全部军队与设施',
  14: '提升城市等级，增加资金收入与部队补给',
  15: '提升工业等级，增加工业产值与部队补给',
  16: '建造机场，扩展空中打击与伞兵航程半径',
  17: '建造要塞炮，大幅强化阵地防御与对舰反击',
  18: '挖掘战壕，增加防御并阻挡敌军地面移动',
  19: '部署防空机枪，降低遭受空袭与轰炸的伤害',
  20: '建造雷达，侦测敌情并减少远程与空袭伤害',
  21: '研发升级国家科技等级，解锁高级军备与卡片',
  ...TACTIC_DESCRIPTIONS,
  25: '派遣国家指挥官/名将进驻部队，全面强化战力',
  26: '补给线：平均恢复单格伤兵生命；开启地区产出补给时按金币×2＋工业×5共享最多250点，否则共享200点',
  27: '王牌部队：指定部队军衔等级立即提升1级',
  28: '在城市或工业区组建精锐特种步兵单位',
};

export const CONSTRUCTION_NAMES = {
  city: '城市',
  industry: '工业',
  airport: '机场',
  none: '无',
};

export const INSTALLATION_NAMES = {
  fort: '要塞炮',
  entrenchment: '战壕',
  antiaircraft: '防空机枪',
  radar: '雷达',
  none: '无',
};

export const COUNTRY_NAMES = {
  rk: '韩国',
  dk: '丹麦',
  fl: '芬兰',
  nk: '朝鲜',
  pt: '葡萄牙',
  de: '德国',
  de1: '德意志第一装甲军团',
  de2: '德国',
  ru: '苏联',
  ru1: '苏联红军第一集团军',
  ru2: '苏联',
  gb: '英国',
  fr: '法国',
  it: '意大利',
  jp: '日本',
  ja: '日本',
  us: '美国',
  am: '美国',
  cn: '中国',
  pl: '波兰',
  tw: '民国远东军',
  tw1: '民国远东军',
  tw2: '民国远东军',
  fi: '芬兰',
  ro: '罗马尼亚',
  hu: '匈牙利',
  bg: '保加利亚',
  ca: '加拿大',
  au: '澳大利亚',
  in: '印度',
  eg: '埃及',
  es: '西班牙',
  tr: '土耳其',
  gr: '希腊',
  yu: '南斯拉夫',
  nl: '荷兰',
  be: '比利时',
  no: '挪威',
  se: '瑞典',
  ch: '瑞士',
  cu: '古巴',
  kp: '朝鲜',
  kr: '韩国',
  vn: '越南',
};

/** Full map-1 Chinese place names. Old handwritten FAMOUS_AREAS table was wrong and has been removed. */
export const FAMOUS_AREAS = AREA_NAMES_MAP1;
export { AREA_NAMES_MAP1 };

export function getAreaTypeName(area) {
  if (area.sea) return '海域';
  if (area.areaType === 1) return '首都';
  if (area.areaType === 3) return '重要城市';
  if (area.areaType === 4) return '普通城市';
  if (area.areaType === 2) return '港口';
  return '普通陆地';
}

export function getAreaName(areaId, stage = null) {
  const named = FAMOUS_AREAS[areaId] || FAMOUS_AREAS[Number(areaId)];
  if (named) return named;
  if (stage) {
    const area = stage.st ? stage.st(areaId) : null;
    if (area) {
      const typeName = getAreaTypeName(area);
      return `第 ${areaId} 区 (${typeName})`;
    }
  }
  const n = Number(areaId);
  return Number.isFinite(n) ? `第 ${n} 区` : '未知地区';
}

export function getUnitName(type) {
  return ARMY_NAMES[type] || type || '部队';
}

export function getCardName(cardId) {
  return CARD_NAMES[cardId] || `卡片 #${cardId}`;
}

export function getCountryName(countryId, stage = null) {
  if (!countryId) return '中立地区';
  if (COUNTRY_NAMES[countryId]) return COUNTRY_NAMES[countryId];
  if (stage && stage.countries) {
    const info = stage.countries.get(countryId);
    if (info && info.flag && COUNTRY_NAMES[info.flag]) {
      return COUNTRY_NAMES[info.flag];
    }
  }
  return `国家 [${countryId}]`;
}
