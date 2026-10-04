/**
 * ConqueringEditor -> Node.js Game Asset Synchronizer
 * 
 * 作用：
 * 1. 同步地图底层数据：area1.bin, adjion1.bin, areatax1.xml -> public/data/areas.json, area_geometry.json
 * 2. 同步剧本与战役关卡：battle_*.xml, conquest_*.xml -> public/data/stages/<name>.json
 * 
 * 闭环实现：
 * 编辑器编辑 ➔ 点击部署 ➔ 落盘为 XML/BIN ➔ 本脚本自动转为 JSON ➔ 重制版游戏刷新立即可见！
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = fs.existsSync(path.join(ROOT, 'project', 'app', 'src', 'main', 'assets'))
  ? path.join(ROOT, 'project', 'app', 'src', 'main', 'assets')
  : path.join(ROOT, 'app', 'src', 'main', 'assets');
const REMAKE_DATA = path.join(ASSETS, 'remake', 'data');
const STAGES_DIR = path.join(REMAKE_DATA, 'stages');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// 1. 同步地图基础几何与邻接经济
function syncMapData(mapId = 1) {
  const areaBin = path.join(ASSETS, `area${mapId}.bin`);
  const adjBin = path.join(ASSETS, `adjion${mapId}.bin`);
  const taxXml = path.join(ASSETS, `areatax${mapId}.xml`);
  const rawFile = path.join(ASSETS, `areamark${mapId}.raw`);

  if (!fs.existsSync(areaBin) || !fs.existsSync(adjBin)) {
    return;
  }

  const areaBuf = fs.readFileSync(areaBin);
  const count = areaBuf.readInt32LE(0);
  const areasGeo = {};
  const areasList = [];

  let offset = 4;
  for (let i = 0; i < count && offset + 44 <= areaBuf.length; i++) {
    const bx = areaBuf.readInt32LE(offset);
    const by = areaBuf.readInt32LE(offset + 4);
    const bw = areaBuf.readInt32LE(offset + 8);
    const bh = areaBuf.readInt32LE(offset + 12);
    const tx = areaBuf.readInt32LE(offset + 16);
    const ty = areaBuf.readInt32LE(offset + 20);
    const cx = areaBuf.readInt32LE(offset + 24);
    const cy = areaBuf.readInt32LE(offset + 28);
    const fx = areaBuf.readInt32LE(offset + 32);
    const fy = areaBuf.readInt32LE(offset + 36);
    const sea = areaBuf.readInt32LE(offset + 40);

    areasGeo[i] = {
      bounds: [bx, by, bw, bh],
      troopAnchor: [tx, ty],
      buildAnchor: [cx, cy],
      facilityAnchor: [fx, fy],
      isSea: sea === 1
    };

    areasList.push({
      id: i,
      x: bx,
      y: by,
      w: bw,
      h: bh,
      pts: [ [ tx, ty ], [ cx, cy ], [ fx, fy ] ],
      f: sea,
      tax: 0,
      industry: 0,
      movementCost: 1,
      entryCosts: {},
      unitCapacity: 4,
      areaType: 0
    });

    offset += 44;
  }

  const adjBuf = fs.readFileSync(adjBin);
  const adjMap = {};
  if (adjBuf.length >= 4) {
    const adjCount = adjBuf.readInt32LE(0);
    let aOffset = 4;
    for (let i = 0; i < adjCount && aOffset + 68 <= adjBuf.length; i++) {
      const nCount = adjBuf.readInt32LE(aOffset);
      const neighbors = [];
      for (let j = 0; j < nCount && j < 16; j++) {
        neighbors.push(adjBuf.readInt32LE(aOffset + 4 + j * 4));
      }
      adjMap[i] = neighbors;
      aOffset += 68;
    }
  }

  const typeMap = {
    'normal': 0,
    'capital': 1,
    'port': 2,
    'large city': 3,
    'normal city': 4
  };

  if (fs.existsSync(taxXml)) {
    const taxContent = fs.readFileSync(taxXml, 'utf8');
    const regex = /<area\s+([^>]+)\/>/g;
    let m;
    while ((m = regex.exec(taxContent)) !== null) {
      const attrs = m[1];
      const getA = name => {
        const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
        return match ? match[1] : null;
      };
      const id = parseInt(getA('id') || '-1', 10);
      if (id >= 0 && id < areasList.length) {
        areasList[id].tax = parseInt(getA('tax') || '0', 10);
        areasList[id].industry = parseInt(getA('industry') || '0', 10);
        const movementCost = parseInt(getA('movementCost') || '1', 10);
        if (movementCost >= 1 && movementCost <= 99) areasList[id].movementCost = movementCost;
        const unitCapacity = parseInt(getA('unitCapacity') || '4', 10);
        if (unitCapacity >= 1 && unitCapacity <= 4) areasList[id].unitCapacity = unitCapacity;
        for (const item of (getA('entryCosts') || '').split(',')) {
          const pair = /^([0-9]+):([0-9]+)$/.exec(item);
          if (pair && +pair[2] >= 1 && +pair[2] <= 99) areasList[id].entryCosts[pair[1]] = +pair[2];
        }
        const tStr = getA('type') || 'normal';
        areasList[id].areaType = typeMap[tStr] !== undefined ? typeMap[tStr] : 0;
      }
    }
  }

  ensureDir(REMAKE_DATA);
  const geoFile = path.join(REMAKE_DATA, 'area_geometry.json');
  if (!fs.existsSync(geoFile)) {
    fs.writeFileSync(geoFile, JSON.stringify(areasGeo, null, 2), 'utf8');
  }
  fs.writeFileSync(path.join(REMAKE_DATA, 'areas.json'), JSON.stringify({ width: 8000, height: 3500, areas: areasList, adj: adjMap }, null, 2), 'utf8');
  if (fs.existsSync(rawFile)) {
    fs.copyFileSync(rawFile, path.join(REMAKE_DATA, `areamark${mapId}.raw`));
  }
}

// 2. 将剧本 XML 转换为重制版专用的 stage JSON
function syncStage(stageName) {
  const xmlPath = path.join(ASSETS, `${stageName}.xml`);
  const binPath = path.join(ASSETS, `${stageName}.bin`);

  if (!fs.existsSync(xmlPath)) return false;

  const xmlContent = fs.readFileSync(xmlPath, 'utf8');

  // 解析启用地块
  let enabled = [];
  if (fs.existsSync(binPath)) {
    const binBuf = fs.readFileSync(binPath);
    if (binBuf.length >= 4) {
      // 跳过前4字节头部，后面按字节判断是否启用 (非0即启用)
      for (let i = 4; i < binBuf.length; i++) {
        if (binBuf[i] !== 0) enabled.push(i - 4);
      }
    }
  }

  // 提取 map
  const mapMatch = xmlContent.match(/map="([^"]*)"/);
  const mapId = mapMatch ? mapMatch[1] : '1';

  // 解析国家列表
  const countries = [];
  const countryListMatch = xmlContent.match(/<list\s+name="country"[^>]*>([\s\S]*?)<\/list>/);
  if (countryListMatch) {
    const countryRegex = /<country\s+([^>]+)\/>/g;
    let cm;
    while ((cm = countryRegex.exec(countryListMatch[1])) !== null) {
      const attrs = cm[1];
      const getA = (name, dflt = '') => {
        const m = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
        return m ? m[1] : dflt;
      };
      countries.push({
        id: getA('id'),
        flag: getA('name'),
        commander: getA('commander'),
        ai: getA('ai') === '1',
        defeated: getA('defeated', 'land'),
        taxfactor: parseFloat(getA('taxfactor', '1.0')),
        money: parseInt(getA('money', '0'), 10),
        industry: parseInt(getA('industry', '0'), 10),
        techlevel: parseInt(getA('techlevel', '1'), 10),
        alliance: getA('alliance'),
        color: [
          parseInt(getA('r', '0'), 10),
          parseInt(getA('g', '0'), 10),
          parseInt(getA('b', '0'), 10),
          parseInt(getA('a', '90'), 10)
        ]
      });
    }
  }

  // 解析地块归属、建筑与驻军
  const stAreas = [];
  const areaListMatch = xmlContent.match(/<list\s+name="area"[^>]*>([\s\S]*?)<\/list>/);
  if (areaListMatch) {
    // 匹配每一个 <area ...> ... </area> 或 <area .../>
    const areaBlockRegex = /<area\s+([^>]*?)(\/>|>([\s\S]*?)<\/area>)/g;
    let am;
    while ((am = areaBlockRegex.exec(areaListMatch[1])) !== null) {
      const attrs = am[1];
      const inner = am[3] || '';
      const getA = (name, dflt = '') => {
        const m = attrs.match(new RegExp(`${name}="([^"]*)"`));
        return m ? m[1] : dflt;
      };

      const armies = [];
      if (inner) {
        const armyRegex = /<army\s+([^>]+)\/>/g;
        let arm;
        while ((arm = armyRegex.exec(inner)) !== null) {
          const aAttrs = arm[1];
          const getArmyA = (name, dflt = '') => {
            const m = aAttrs.match(new RegExp(`${name}="([^"]*)"`));
            return m ? m[1] : dflt;
          };
          armies.push({
            type: (getArmyA('type') || '').replace(/\s+/g, ''),
            level: parseInt(getArmyA('level', '0'), 10),
            cards: parseInt(getArmyA('cards', '0'), 10)
          });
        }
      }

      stAreas.push({
        id: parseInt(getA('id', '-1'), 10),
        country: getA('country'),
        construction: getA('construction', 'none'),
        level: parseInt(getA('level', '0'), 10),
        installation: getA('installation', 'none'),
        armies: armies
      });
    }
  }

  const stageObj = {
    name: stageName,
    map: mapId,
    enabled: enabled,
    countries: countries,
    areas: stAreas,
    extra: { dialogue: [] }
  };

  ensureDir(STAGES_DIR);
  const outJson = path.join(STAGES_DIR, `${stageName}.json`);
  fs.writeFileSync(outJson, JSON.stringify(stageObj), 'utf8');
  console.log(`✓ 关卡已同步至重制版: ${stageName}.json (地块数: ${stAreas.length}, 参战国: ${countries.map(c => c.id).join(', ')})`);
  return true;
}

// 3. 全量同步所有改动的资源
function syncAll() {
  syncMapData(1);
  if (fs.existsSync(ASSETS)) {
    const list = fs.readdirSync(ASSETS);
    for (const f of list) {
      const m = f.match(/^((conquest|battle)_.*)\.xml$/);
      if (m) {
        syncStage(m[1]);
      }
    }
  }
}

syncAll();

module.exports = { syncMapData, syncStage, syncAll };
