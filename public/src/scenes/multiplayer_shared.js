// Shared utilities and metadata for Battlefield V style multiplayer lobby
import { COUNTRY_NAMES } from '../game/api/names.js';

export const RELATION_LABELS = { war: '交战', peace: '和平', alliance: '同盟' };
export const relationKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

// Well-known stage Chinese titles and backgrounds
export const STAGE_META = {
  conquest_germany_poland_1939: {name:'测试-德国与波兰 · 九月战役',type:'conquest',sub:'1939年9月 · 历史疆界细化战场',bg:'assets/maps/germany_poland_1939/preview.webp'},
  // Campaign - Axis
  battle_axis1: { name: '闪电战 (1939.9)', type: 'campaign', sub: '波兰战役 · 闪击战开端', bg: 'backdrops/room_de.jpg' },
  battle_axis1_de: { name: '闪电战 (德军视角)', type: 'campaign', sub: '波兰战役 · 第一集团军', bg: 'backdrops/room_de_b.jpg' },
  battle_axis2: { name: '威瑟演习 (1940.4)', type: 'campaign', sub: '北欧侵攻战 · 挪威丹麦', bg: 'backdrops/w_bunker.png' },
  battle_axis3: { name: '黄色方案 (1940.5)', type: 'campaign', sub: '西线突击 · 突破阿登', bg: 'backdrops/w_france_staff.jpg' },
  battle_axis4: { name: '海狮计划 (1940.8)', type: 'campaign', sub: '英伦决战 · 鹰击长空', bg: 'backdrops/w_gb.png' },
  battle_axis5: { name: '巴尔干战役 (1941.4)', type: 'campaign', sub: '轴心南进 · 希腊南斯拉夫', bg: 'backdrops/room_de.jpg' },
  battle_axis6: { name: '巴巴罗萨 (1941.6)', type: 'campaign', sub: '东方战线 · 突入苏联', bg: 'backdrops/w_ru.png' },
  battle_axis7: { name: '北非风暴 (1941.11)', type: 'campaign', sub: '托布鲁克 · 沙漠之狐', bg: 'backdrops/room_de.jpg' },
  battle_axis8: { name: '蓝色方案 (1942.6)', type: 'campaign', sub: '高加索油田 · 斯大林格勒', bg: 'backdrops/w_ru.png' },
  battle_axis9: { name: '堡垒行动 (1943.7)', type: 'campaign', sub: '库尔斯克 · 钢铁风暴', bg: 'backdrops/w_ru.png' },
  battle_axis10: { name: '守望莱茵 (1944.12)', type: 'campaign', sub: '突出部战役 · 最后一搏', bg: 'backdrops/w_bunker.png' },

  // Campaign - Allies
  battle_allies1: { name: '敦刻尔克撤退 (1940.5)', type: 'campaign', sub: '西欧大溃退 · 发电机行动', bg: 'backdrops/w_france_staff.jpg' },
  battle_allies2: { name: '不列颠空战 (1940.7)', type: 'campaign', sub: '帝国本土防御 · 鹰日', bg: 'backdrops/w_gb.png' },
  battle_allies3: { name: '莫斯科保卫战 (1941.10)', type: 'campaign', sub: '苏联首都决战 · 严冬反击', bg: 'backdrops/w_ru.png' },
  battle_allies4: { name: '阿拉曼战役 (1942.10)', type: 'campaign', sub: '北非转折点 · 蒙哥马利', bg: 'backdrops/w_gb.png' },
  battle_allies5: { name: '斯大林格勒大反攻 (1942.11)', type: 'campaign', sub: '天王星行动 · 围歼第6集团军', bg: 'backdrops/w_ru.png' },
  battle_allies6: { name: '西西里登陆 (1943.7)', type: 'campaign', sub: '哈士奇行动 · 进军亚平宁', bg: 'backdrops/w_us.png' },
  battle_allies7: { name: '库尔斯克防守战 (1943.7)', type: 'campaign', sub: '防御纵深 · 挫败堡垒', bg: 'backdrops/w_ru.png' },
  battle_allies8: { name: '霸王行动 (1944.6)', type: 'campaign', sub: '诺曼底登陆 · D-Day', bg: 'backdrops/w_us.png' },
  battle_allies9: { name: '巴格拉季昂行动 (1944.6)', type: 'campaign', sub: '击溃德国中央集团军群', bg: 'backdrops/w_ru.png' },
  battle_allies10: { name: '柏林战役 (1945.4)', type: 'campaign', sub: '帝国终结 · 胜利旗帜', bg: 'backdrops/w_chancellery.png' },

  // Cold War
  battle_nato1: { name: '北约第1战役', type: 'campaign', sub: '北约作战计划', bg: 'backdrops/w_whitehouse.png' },
  battle_nato2: { name: '北约第2战役', type: 'campaign', sub: '欧洲防线', bg: 'backdrops/w_whitehouse.png' },
  battle_nato3: { name: '北约第3战役', type: 'campaign', sub: '联合反击', bg: 'backdrops/w_whitehouse.png' },
  battle_nato4: { name: '北约第4战役', type: 'campaign', sub: '战略决胜', bg: 'backdrops/w_whitehouse.png' },
  battle_nato5: { name: '北约第5战役', type: 'campaign', sub: '空地一体', bg: 'backdrops/w_whitehouse.png' },
  battle_nato6: { name: '北约第6战役', type: 'campaign', sub: '纵深突破', bg: 'backdrops/w_whitehouse.png' },
  battle_nato7: { name: '北约第7战役', type: 'campaign', sub: '最终威慑', bg: 'backdrops/w_whitehouse.png' },

  battle_wto1: { name: '华约第1战役', type: 'campaign', sub: '红色风暴', bg: 'backdrops/w_ru.png' },
  battle_wto2: { name: '华约第2战役', type: 'campaign', sub: '钢铁洪流', bg: 'backdrops/w_ru.png' },
  battle_wto3: { name: '华约第3战役', type: 'campaign', sub: '波罗的海防线', bg: 'backdrops/w_ru.png' },
  battle_wto4: { name: '华约第4战役', type: 'campaign', sub: '反击作战', bg: 'backdrops/w_ru.png' },
  battle_wto5: { name: '华约第5战役', type: 'campaign', sub: '中欧会战', bg: 'backdrops/w_ru.png' },
  battle_wto6: { name: '华约第6战役', type: 'campaign', sub: '全面出击', bg: 'backdrops/w_ru.png' },
  battle_wto7: { name: '华约第7战役', type: 'campaign', sub: '红色黎明', bg: 'backdrops/w_ru.png' },

  // Conquests
  conquest_1: { name: '征服 1939 · 二战爆发', type: 'conquest', sub: '全球剧变 · 轴心国全盛出击', bg: 'backdrops/room_de.jpg' },
  conquest_2: { name: '征服 1941 · 太平洋烽火', type: 'conquest', sub: '东亚与太平洋 · 偷袭珍珠港', bg: 'backdrops/w_japan_staff.jpg' },
  conquest_3: { name: '征服 1943 · 战略转折', type: 'conquest', sub: '盟军反攻 · 轴心走向灭亡', bg: 'backdrops/w_chongqing.jpg' },
  conquest_4: { name: '征服 1945 · 最后的决战', type: 'conquest', sub: '第三帝国覆灭 · 战后新秩序', bg: 'backdrops/w_chancellery.png' },
  conquest_5: { name: '征服 1950 · 朝鲜战争', type: 'conquest', sub: '冷战前沿 · 东西阵营初锋', bg: 'backdrops/w_us.png' },
  conquest_6: { name: '征服 1960 · 红色危机', type: 'conquest', sub: '导弹危机 · 冷战最高潮', bg: 'backdrops/w_whitehouse.png' },
  conquest_7: { name: '征服 1975 · 终末风暴', type: 'conquest', sub: '中东与印支 · 代理人战争', bg: 'backdrops/w_ru.png' },
  conquest_8: { name: '征服 1982 · 战略反扑', type: 'conquest', sub: '大国军备博弈 · 铁幕崩裂前夕', bg: 'backdrops/w_bunker.png' },
  conquest_mirror_de: { name: '镜像征服 · 德国全面对抗', type: 'conquest', sub: '双向对抗实验战役', bg: 'backdrops/room_de_b.jpg' },
};

/** Get friendly stage metadata */
export function getStageMeta(stageId) {
  if (STAGE_META[stageId]) return STAGE_META[stageId];
  const isConquest = stageId.startsWith('conquest_');
  return {
    name: stageId.replace(/_/g, ' ').toUpperCase(),
    type: isConquest ? 'conquest' : 'campaign',
    sub: isConquest ? '征服大战略对局' : '特遣战役关卡',
    bg: 'backdrops/room_de.jpg'
  };
}

/** Get localized country name */
export function getCountryName(countryId, stage = null) {
  if (stage?.countries) {
    const item = stage.countries.find(c => c.id === countryId);
    if (item && item.name) return item.name;
  }
  return COUNTRY_NAMES[countryId] || countryId || '未知国家';
}

// Whitelist of verified existing flag assets in assets/
export const VALID_FLAGS = new Set([
  'al', 'am', 'au', 'be', 'bg', 'ca', 'ch', 'cn', 'de', 'dk',
  'es', 'fr', 'gb', 'gr', 'hu', 'it', 'ja', 'kr', 'mx', 'nk',
  'nl', 'no', 'pl', 'pt', 'rk', 'ro', 'ru', 'se', 'tr', 'tw',
  'vn', 'yu'
]);

/** Normalize country ID to standard 2-letter flag code */
export function normalizeFlagCode(idOrFlag) {
  if (!idOrFlag) return '';
  let code = String(idOrFlag).toLowerCase();
  // Strip trailing digits: de1 -> de, ru2 -> ru, am1 -> am, cn2 -> cn
  code = code.replace(/\d+$/, '');
  // Known alias mappings
  if (code === 'fl' || code === 'fi') return 'se'; // Finland fallback or Nordic
  if (code === 'us') return 'am';
  if (code === 'kp') return 'nk';
  if (code === 'jp') return 'ja';
  return code;
}

/** Get Flag asset URL or null if asset does not exist */
export function getCountryFlagSrc(flagOrId) {
  const code = normalizeFlagCode(flagOrId);
  if (VALID_FLAGS.has(code)) {
    return `assets/ew3stylecountryflag_${code}@2x.png`;
  }
  return null;
}

/** Format seconds to human string */
export function formatTurnSeconds(seconds) {
  if (!seconds || seconds <= 0) return '不限时';
  if (seconds < 60) return `${seconds}秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}分${s}秒` : `${m}分钟`;
}

/** Format reparation rate */
export function formatReparation(rate) {
  const r = Number(rate) || 1.8;
  return `×${r.toFixed(1)}`;
}

/** Check if room is private */
export function isRoomPrivate(room) {
  return !!room?.settings?.private;
}

/** Clean & extract 8-digit Room Code */
export function extractRoomCode(value) {
  const raw = String(value || '').trim();
  const compact = raw.replace(/[\s-]/g, '').toUpperCase();
  if (/^[A-F0-9]{8}$/.test(compact)) return compact;
  return /#multiplayer\/([A-F0-9]{8})(?:\/info)?(?:$|[?&])/i.exec(raw)?.[1].toUpperCase() || null;
}
