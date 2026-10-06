import { cp, mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from './web-build/node_modules/esbuild/lib/main.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (flag, fallback) => { const i = args.indexOf(flag); return i < 0 ? fallback : args[i + 1]; };
const apiOrigin = value('--api-origin', 'https://208.87.207.49');
if (new URL(apiOrigin).protocol !== 'https:') throw new Error('Web API origin must use HTTPS');
const release = value('--release', new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14));
if (!/^[a-zA-Z0-9_-]+$/.test(release)) throw new Error('Invalid release name');
const source = path.join(root, 'public');
const gameAssets = path.join(root, 'project/app/src/main/assets');
const output = path.join(root, 'dist/web/releases', release);
try { await stat(output); throw new Error('Release already exists; choose a new --release'); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
const omitDirs = new Set(['verification', 'browser-profile', 'node_modules', '.git', '__pycache__', 'worldmap_draft']);
const filter = file => {
  const pieces = path.relative(root, file).split(path.sep);
  if (pieces.some(p => omitDirs.has(p))) return false;
  return !/(?:\.prev\.png|\.bak|\.log|\.dmp|\.db(?:-wal|-shm|-journal)?|\.zip|\.apk|\.ipa|\.pkm)$/i.test(file);
};
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true, filter });
// Match server.js: project assets/data take precedence over public fallbacks.
await cp(gameAssets, path.join(output, 'assets'), { recursive: true, force: true, filter });
await cp(path.join(gameAssets, 'remake/data'), path.join(output, 'data'), { recursive: true, force: true, filter });
const meta = path.join(output, 'web_meta');
await mkdir(meta, { recursive: true });
const json = (file, data) => writeFile(path.join(meta, file), JSON.stringify(data));
const counts = {};
for (const f of await readdir(path.join(output, 'leaders'))) {
  const m = /^([a-z0-9]+)_front(?:_v(\d+))?\.png$/i.exec(f);
  if (m) counts[m[1]] = Math.max(counts[m[1]] || 0, Number(m[2] || 1));
}
await json('leaders.json', counts);
await json('accessories.json', (await readdir(path.join(output, 'assets/Accessories'))).filter(f => /\.png$/i.test(f)).sort());
await json('desktops.json', (await readdir(path.join(output, 'assets/desktop'))).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).map(file => ({
  id: path.parse(file).name,
  file: file === 'desktop_cowhide_brown_aged_2x.png' ? 'assets/desktop/variants/desktop_cowhide_brown_smooth.png' : `assets/desktop/${file}`
})));
let config = {};
try { config = JSON.parse(await readFile(path.join(root, 'data/game_config.json'), 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
await json('game-config.json', config);
let layouts = [];
try {
  layouts = (await readdir(path.join(root, 'data/layouts'))).filter(f => f.endsWith('.json'));
  await mkdir(path.join(meta, 'layouts'), { recursive: true });
  for (const f of layouts) await cp(path.join(root, 'data/layouts', f), path.join(meta, 'layouts', f));
} catch (e) { if (e.code !== 'ENOENT') throw e; }
await json('layouts.json', layouts.map(f => f.slice(0, -5)));
await writeFile(path.join(output, 'runtime-config.js'), 'window.WC2_CONFIG = ' + JSON.stringify({
  staticWeb: true, apiOrigin, musicPreloadSeconds: 20, release, version: '1.0.14', protocol: 'wc2-1', updateSupport: true, iosUpdateSupport: true
}) + ';\n');
// Keep dynamic imports as separate chunks, while combining the hundreds of small
// startup modules into shared bundles. Runtime asset URLs still use the COS base.
await esbuild.build({
  entryPoints: [path.join(source, 'src/main.js')], outdir: path.join(output, 'web_app'),
  bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022',
  minify: true, keepNames: true, chunkNames: 'chunks/[name]-[hash]', logLevel: 'warning', external: ['node:*'],
});
const entryHtml = await readFile(path.join(output, 'index.html'), 'utf8');
await writeFile(path.join(output, 'index.html'), entryHtml.replace(/src\/main\.js(?:\?[^"']*)?/g, 'web_app/main.js'));
let totalBytes = 0, files = 0;
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) await walk(file);
    else { totalBytes += (await stat(file)).size; files++; }
  }
}
await walk(output);
const report = { release, output, apiOrigin, totalBytes, files };
await mkdir(path.join(root, 'dist/web'), { recursive: true });
await writeFile(path.join(root, 'dist/web/latest-build.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
