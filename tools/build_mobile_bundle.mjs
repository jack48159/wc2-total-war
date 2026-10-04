import { cp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'public'), output = path.join(root, 'dist', 'ios_web');
const gameAssets = path.join(root,'project','app','src','main','assets');
if (!output.startsWith(path.join(root,'dist') + path.sep) || output === source || output === gameAssets) throw new Error('Unsafe output path');
const minify = process.argv.includes('--minify'), obfuscate = process.argv.includes('--obfuscate');
const unknown = process.argv.slice(2).filter(x => !['--minify','--obfuscate'].includes(x));
if (unknown.length) throw new Error(`Unknown option: ${unknown.join(', ')}`);
const mobileRequire = createRequire(path.join(root,'mobile','ios','package.json'));
let terser, obfuscator;
if (minify) { try { terser = mobileRequire('terser').minify; } catch { throw new Error('Run npm install in mobile/ios first, or omit --minify'); } }
if (obfuscate) { try { obfuscator = mobileRequire('javascript-obfuscator'); } catch { throw new Error('Install optional javascript-obfuscator in mobile/ios or omit --obfuscate'); } }

await rm(output, { recursive:true, force:true });
await mkdir(output, { recursive:true });
await cp(source, output, { recursive:true });
// The desktop server resolves /assets and /data from the original project first.
await cp(gameAssets,path.join(output,'assets'),{recursive:true,force:true});
await cp(path.join(gameAssets,'remake','data'),path.join(output,'data'),{recursive:true,force:true});
await mkdir(path.join(output,'ios_meta'),{recursive:true});
const leaderCounts = {};
for (const f of await readdir(path.join(source,'leaders'))) {
  const m = /^([a-z0-9]+)_(front|left|right)(?:_v(\d+))?\.png$/i.exec(f);
  if (m && !f.endsWith('.prev.png')) leaderCounts[m[1]] = Math.max(leaderCounts[m[1]]||0,Number(m[3]||1));
}
await writeFile(path.join(output,'ios_meta','leaders.json'),JSON.stringify(leaderCounts));
const desktopDir = path.join(gameAssets,'desktop');
await writeFile(path.join(output,'ios_meta','desktops.json'),JSON.stringify((await readdir(desktopDir)).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).map(file => ({id:path.parse(file).name,file:`assets/desktop/${file}`}))));
await writeFile(path.join(output,'ios_meta','accessories.json'),JSON.stringify((await readdir(path.join(gameAssets,'Accessories'))).filter(f => /\.png$/i.test(f)).sort()));

async function walk(dir, files = []) {
  for (const item of await readdir(dir, { withFileTypes:true })) {
    const full = path.join(dir,item.name);
    if (item.isDirectory()) await walk(full,files);
    else if (item.isFile()) files.push(full);
  }
  return files;
}
const files = await walk(output);
if (minify || obfuscate) for (const file of files.filter(f => f.endsWith('.js') || f.endsWith('.mjs'))) {
  let code = await readFile(file,'utf8');
  if (minify) {
    const result = await terser(code, { module:true, compress:true, mangle:true, keep_classnames:true, keep_fnames:true, format:{ comments:false } });
    if (!result.code) throw new Error(`Cannot minify ${file}`);
    code = result.code;
  }
  if (obfuscate) code = obfuscator.obfuscate(code, { compact:true, controlFlowFlattening:false }).getObfuscatedCode();
  await writeFile(file,code);
}
const entries = await Promise.all((await walk(output)).map(async file => ({ path:path.relative(output,file).replaceAll('\\','/'), bytes:(await import('node:fs/promises')).stat(file).then(s=>s.size) })));
const resolved = await Promise.all(entries.map(async e => ({path:e.path,bytes:await e.bytes})));
const groups = new Map(); let total = 0;
for (const e of resolved) { const dir = e.path.split('/')[0]; groups.set(dir,(groups.get(dir)||0)+e.bytes); total += e.bytes; }
const report = { output, files:resolved.length, totalBytes:total, directories:Object.fromEntries([...groups].sort((a,b)=>b[1]-a[1])),
  advice:'Largest image directories (notably leaders/assets/backdrops) should be audited for unused variants, resized for iOS and transcoded to WebP/AVIF before release. No asset removal in this build.' };
await writeFile(path.join(root,'dist','ios_bundle_report.json'), JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
