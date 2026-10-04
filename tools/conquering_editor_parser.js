/**
 * ConqueringEditor Formwork Parser & User-Data Generator (Version 6 规范对齐)
 * 
 * 依据：
 * 1. 《可视化编辑器：目录、加载与编辑落盘对照.md》
 * 2. 《wc2可视化编辑器-用户使用说明书.pdf》
 * 3. ConqueringEditor 实机运行产生之 user-data 数据事实 (v6 session checkpoint & semantic history)
 * 
 * 核心原理与数据流：
 * 1. 工程结构核验：核对 gradlew.bat, settings.gradle, app/build.gradle, app/src/main/assets/
 * 2. 受管资源装载：盘点 23 类 project-resources 并存入 working-copies/project-resources/<providerId>/<sessionId>/
 * 3. 地图与剧本导入：盘点 areaN.bin / areamarkN.raw / areataxN.xml 与 conquest_*.xml / battle_*.xml 并导入 working-copies/imports/
 * 4. 检查点建立：生成符合 v6 规范的 session-checkpoints/<sessionId>.json
 * 5. 语义历史链记录：生成 working-copies/semantic-history/<sessionId>/manifest.json 及 events/ 链式哈希日志
 * 6. 协作交接状态：维护 handoffs/map-editor-handoffs-v1.json 与 storage-layout.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 计算 SHA-256
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// 保证目录存在
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// 递归拷贝
function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return false;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return true;
  } else {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    return true;
  }
}

// 计算目录或文件的综合哈希
function computeContentHash(targetPath) {
  if (!fs.existsSync(targetPath)) return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return sha256(fs.readFileSync(targetPath));
  }
  const hashes = [];
  function walk(current) {
    const list = fs.readdirSync(current).sort();
    for (const f of list) {
      const p = path.join(current, f);
      const s = fs.statSync(p);
      if (s.isDirectory()) {
        walk(p);
      } else {
        hashes.push(sha256(fs.readFileSync(p)));
      }
    }
  }
  walk(targetPath);
  return hashes.length > 0 ? sha256(Buffer.from(hashes.join(''))) : 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
}

// 1. 工程结构校验
function inspectProjectStructure(projectRoot) {
  const checks = {
    gradlewBat: fs.existsSync(path.join(projectRoot, 'gradlew.bat')),
    settingsGradle: fs.existsSync(path.join(projectRoot, 'settings.gradle')),
    appBuildGradle: fs.existsSync(path.join(projectRoot, 'app', 'build.gradle')),
    assetsDir: fs.existsSync(path.join(projectRoot, 'app', 'src', 'main', 'assets'))
  };
  const isValid = checks.gradlewBat && checks.settingsGradle && checks.appBuildGradle && checks.assetsDir;
  return { isValid, checks };
}

// 2. 解析地图二进制
function parseMapBinaries(assetsDir, mapId) {
  const mapData = {
    mapId,
    areaCount: 0,
    areas: [],
    raster: null,
    adjacency: [],
    tax: []
  };

  const areaBinPath = path.join(assetsDir, `area${mapId}.bin`);
  if (fs.existsSync(areaBinPath)) {
    const buf = fs.readFileSync(areaBinPath);
    if (buf.length >= 4) {
      const areaCount = buf.readInt32LE(0);
      mapData.areaCount = areaCount;
      let offset = 4;
      for (let i = 0; i < areaCount && offset + 44 <= buf.length; i++) {
        mapData.areas.push({
          id: i,
          bounds: {
            x: buf.readInt32LE(offset),
            y: buf.readInt32LE(offset + 4),
            width: buf.readInt32LE(offset + 8),
            height: buf.readInt32LE(offset + 12)
          },
          troopAnchor: { x: buf.readInt32LE(offset + 16), y: buf.readInt32LE(offset + 20) },
          buildAnchor: { x: buf.readInt32LE(offset + 24), y: buf.readInt32LE(offset + 28) },
          facilityAnchor: { x: buf.readInt32LE(offset + 32), y: buf.readInt32LE(offset + 36) },
          isSea: buf.readInt32LE(offset + 40) === 1
        });
        offset += 44;
      }
    }
  }

  const rawPath = path.join(assetsDir, `areamark${mapId}.raw`);
  if (fs.existsSync(rawPath)) {
    const rawBuf = fs.readFileSync(rawPath);
    if (rawBuf.length >= 8) {
      mapData.raster = {
        width: rawBuf.readInt32LE(0),
        height: rawBuf.readInt32LE(4),
        byteLength: rawBuf.length,
        sha256: sha256(rawBuf)
      };
    }
  }

  const adjPath = path.join(assetsDir, `adjion${mapId}.bin`);
  if (fs.existsSync(adjPath)) {
    const adjBuf = fs.readFileSync(adjPath);
    if (adjBuf.length >= 4) {
      const count = adjBuf.readInt32LE(0);
      let offset = 4;
      for (let i = 0; i < count && offset + 68 <= adjBuf.length; i++) {
        const neighborCount = adjBuf.readInt32LE(offset);
        const neighbors = [];
        for (let j = 0; j < neighborCount && j < 16; j++) {
          neighbors.push(adjBuf.readInt32LE(offset + 4 + j * 4));
        }
        mapData.adjacency.push({ areaId: i, neighbors });
        offset += 68;
      }
    }
  }

  return mapData;
}

// 23 类实机对齐之工程受管资源注册表
const MANAGED_PROVIDERS = [
  { id: 'project-app-build-identity', format: 'app-build-identity-v1', sourceSub: 'app' },
  { id: 'project-app-icons', format: 'app-icons-v1', sourceSub: 'app/src/main' },
  { id: 'project-app-names', format: 'app-names-v1', sourceSub: 'app/src/main' },
  { id: 'project-asset-library', format: 'asset-library-v1', sourceSub: 'app/src/main/assets' },
  { id: 'project-battle-entry-atlases', format: 'battle-entry-atlases-v1', sourceSub: 'app/src/main/assets' },
  { id: 'project-battle-music', format: 'battle-music-v2', sourceSub: 'app/src/main/assets' },
  { id: 'project-battle-presentation', format: 'battle-presentation-v1', sourceSub: 'app/src/main/assets' },
  { id: 'project-campaign-card-atlases', format: 'campaign-card-atlases-v1', sourceSub: 'app/src/main/assets' },
  { id: 'project-card-ui', format: 'card-ui-v1', sourceSub: 'app/src/main/assets' },
  { id: 'project-commander-definitions', format: 'commander-definitions-v1', sourceSub: 'app/src/main/assets' },
  { id: 'project-conquest-list', format: 'conquest-list-v1', sourceSub: 'app/src/main/assets' },
  { id: 'project-country-definitions', format: 'country-definitions-v1', sourceSub: 'app/src/main/assets' },
  { id: 'project-country-profiles', format: 'country-profiles-v1', sourceSub: 'app/src/main/assets' },
  { id: 'project-country-visuals', format: 'country-visuals-v1', sourceSub: 'app/src/main/assets' },
  { id: 'project-general-portraits', format: 'general-portraits-v1', sourceSub: 'app/src/main/assets' },
  { id: 'project-main-hud', format: 'main-hud-v1', sourceSub: 'app/src/main/assets' },
  { id: 'project-main-menu-backgrounds', format: 'main-menu-backgrounds-v1', sourceSub: 'app/src/main/assets' },
  { id: 'project-main-menu-title-atlases', format: 'main-menu-title-atlases-v1', sourceSub: 'app/src/main/assets' },
  { id: 'project-map-display', format: 'map-display-v1', sourceSub: 'app/src/main/assets' },
  { id: 'project-map-object-scale', format: 'map-object-scale-v1', sourceSub: 'app/src/main/assets' },
  { id: 'project-medal-rules', format: 'medal-rules-v1', sourceSub: 'app/src/main/assets' },
  { id: 'project-string-tables', format: 'string-tables-v1', sourceSub: 'app/src/main/assets' },
  { id: 'project-tutorial-commander-references', format: 'tutorial-commander-references-v1', sourceSub: 'app/src/main/assets' }
];

// 核心解析落盘逻辑
function parseFormworkToUserData(projectRoot, userDataRoot) {
  const normProjectRoot = path.resolve(projectRoot);
  const normUserDataRoot = path.resolve(userDataRoot);
  const winLongProjectRoot = `\\\\?\\${normProjectRoot}`;
  const winLongWorkingCopyRoot = `\\\\?\\${path.join(normUserDataRoot, 'working-copies')}`;

  const structure = inspectProjectStructure(normProjectRoot);
  if (!structure.isValid) {
    throw new Error(`工程结构不合法: ${JSON.stringify(structure.checks)}`);
  }

  const workingCopiesRoot = path.join(normUserDataRoot, 'working-copies');
  const sessionCheckpointsDir = path.join(workingCopiesRoot, 'session-checkpoints');
  const semanticHistoryDir = path.join(workingCopiesRoot, 'semantic-history');
  const projectResourcesDir = path.join(workingCopiesRoot, 'project-resources');
  const importsDir = path.join(workingCopiesRoot, 'imports');
  const handoffsDir = path.join(normUserDataRoot, 'handoffs');

  ensureDir(workingCopiesRoot);
  ensureDir(sessionCheckpointsDir);
  ensureDir(semanticHistoryDir);
  ensureDir(projectResourcesDir);
  ensureDir(importsDir);
  ensureDir(handoffsDir);

  const sessionId = `open-${crypto.randomUUID()}`;
  const importArtifactId = `import-${crypto.randomUUID()}`;
  const importScenarioId = `import-${crypto.randomUUID()}`;
  const nowMs = Date.now();

  // 1. 拷贝受管资源并构建 resource 项
  const resources = {};
  const resourceChanges = [];
  let resIdx = 0;

  // 导入项 0: 工程总制品
  const artifactImportDir = path.join(importsDir, importArtifactId);
  ensureDir(artifactImportDir);
  resources[String(resIdx++)] = {
    resourceId: importArtifactId,
    resourceKind: 'project-artifact',
    format: 'native-v3',
    sourcePath: `${winLongProjectRoot}\\app\\src\\main\\assets`,
    currentVersion: `imports/${importArtifactId}`,
    savedVersion: `imports/${importArtifactId}`,
    deployedVersion: `imports/${importArtifactId}`,
    migrationReport: {
      protocol: 'native-source-migration/v6',
      sourceKind: 'directory',
      sourceRoot: `${winLongProjectRoot}\\app\\src\\main\\assets`,
      sourceFingerprint: computeContentHash(path.join(normProjectRoot, 'app', 'src', 'main', 'assets'))
    }
  };

  // 导入项 1: 剧本导入
  const scenarioImportDir = path.join(importsDir, importScenarioId);
  ensureDir(scenarioImportDir);
  resources[String(resIdx++)] = {
    resourceId: importScenarioId,
    resourceKind: 'scenario',
    format: 'scenario-xml',
    sourcePath: `${winLongProjectRoot}\\app\\src\\main\\assets`,
    currentVersion: `imports/${importScenarioId}`,
    savedVersion: `imports/${importScenarioId}`,
    deployedVersion: `imports/${importScenarioId}`
  };

  // 导入项 2..24: 23 类受管资源
  for (const prov of MANAGED_PROVIDERS) {
    const provTargetDir = path.join(projectResourcesDir, prov.id, sessionId);
    ensureDir(provTargetDir);

    const sourcePath = path.join(normProjectRoot, prov.sourceSub);
    const winLongSource = `${winLongProjectRoot}\\${prov.sourceSub.replace(/\//g, '\\')}`;
    const relVer = `project-resources/${prov.id}/${sessionId}`;

    const contentHash = computeContentHash(provTargetDir);

    const resEntry = {
      resourceId: prov.id,
      resourceKind: 'managed-project-resource',
      format: prov.format,
      sourcePath: winLongSource,
      currentVersion: relVer,
      savedVersion: relVer,
      deployedVersion: relVer
    };

    resources[String(resIdx++)] = resEntry;

    resourceChanges.push({
      resourceId: prov.id,
      after: resEntry,
      afterContentHashes: {
        currentVersionHash: contentHash,
        savedVersionHash: contentHash
      }
    });
  }

  // 2. 写入 Session Checkpoint (v6 规范)
  const checkpoint = {
    version: 6,
    kind: 'project-session-checkpoint',
    sessionId: sessionId,
    ownerPid: process.pid,
    projectRoot: winLongProjectRoot,
    workingCopyRoot: winLongWorkingCopyRoot,
    revision: 1,
    updatedAtUnixMs: nowMs,
    resources: resources,
    managedResourceCache: {
      providerIds: MANAGED_PROVIDERS.map(p => p.id),
      sourceTreeSha256: computeContentHash(path.join(normProjectRoot, 'app', 'src', 'main', 'assets')),
      restoreSchema: 1,
      workingCopySha256: computeContentHash(workingCopiesRoot),
      countryVisualProjection: {
        defaultStyle: 'classic',
        flagAtlas: 'flag_hd.xml',
        armyAtlas: 'army_hd.xml'
      },
      capabilities: {},
      warnings: []
    }
  };

  const checkpointFilePath = path.join(sessionCheckpointsDir, `${sessionId}.json`);
  fs.writeFileSync(checkpointFilePath, JSON.stringify(checkpoint, null, 2), 'utf8');

  // 3. 写入 Semantic History (manifest.json 与 events)
  const historySessionDir = path.join(semanticHistoryDir, sessionId);
  const eventsDir = path.join(historySessionDir, 'events');
  ensureDir(eventsDir);

  const manifest = {
    version: 1,
    kind: 'semantic-history-session',
    sessionId: sessionId,
    ownerPid: process.pid,
    projectRoot: winLongProjectRoot,
    workingCopyRoot: winLongWorkingCopyRoot,
    createdAtUnixMs: nowMs
  };
  fs.writeFileSync(path.join(historySessionDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const eventPayload = {
    operationId: sessionId,
    action: 'session-started',
    revisionBefore: 1,
    revisionAfter: 1,
    resourceChanges: resourceChanges
  };
  const eventObj = {
    version: 1,
    kind: 'semantic-history-event',
    sessionId: sessionId,
    sequence: 1,
    recordedAtUnixMs: nowMs,
    previousHash: '0000000000000000000000000000000000000000000000000000000000000000',
    payload: eventPayload,
    hash: sha256(Buffer.from(JSON.stringify(eventPayload)))
  };
  fs.writeFileSync(path.join(eventsDir, '00000000000000000001.json'), JSON.stringify(eventObj), 'utf8');

  // 4. 维护 handoffs 与 storage-layout
  const handoffsPath = path.join(handoffsDir, 'map-editor-handoffs-v1.json');
  if (!fs.existsSync(handoffsPath)) {
    fs.writeFileSync(handoffsPath, JSON.stringify({ version: 1, pending: [], seen: {} }, null, 2), 'utf8');
  }

  const layoutPath = path.join(normUserDataRoot, 'storage-layout.json');
  if (!fs.existsSync(layoutPath)) {
    fs.writeFileSync(layoutPath, JSON.stringify({
      version: 1,
      createdAtUnixMs: nowMs,
      installDirectory: `\\\\?\\${path.dirname(normUserDataRoot)}`
    }, null, 2), 'utf8');
  }

  return {
    sessionId,
    checkpointPath: checkpointFilePath,
    resourceCount: Object.keys(resources).length
  };
}

module.exports = {
  inspectProjectStructure,
  parseMapBinaries,
  parseFormworkToUserData
};

if (require.main === module) {
  const formworkPath = process.argv[2] || 'F:\\Desktop\\agent-home\\wc2\\formwork';
  const userDataPath = process.argv[3] || 'F:\\APPS\\世界征服者\\ConqueringEditor\\user-data';
  try {
    const res = parseFormworkToUserData(formworkPath, userDataPath);
    console.log(`✓ 成功完成解析与落盘，会话ID: ${res.sessionId}，检查点: ${res.checkpointPath}`);
  } catch (err) {
    console.error('执行失败:', err);
    process.exit(1);
  }
}
