import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = JSON.parse(await fs.readFile(path.join(root, 'dist/web/latest-build.json'), 'utf8'));
const files = [];
async function walk(dir) { for (const entry of await fs.readdir(dir, {withFileTypes:true})) { const file=path.join(dir,entry.name); if(entry.isDirectory()) await walk(file); else { const bytes=await fs.readFile(file);files.push({path:path.relative(build.output,file).split(path.sep).join('/'),size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}); } } }
await walk(build.output);files.sort((a,b)=>a.path.localeCompare(b.path));
const manifest = { release:build.release,version:'1.0.24',shell:1,protocol:'wc2-1',notes:'修复三个经典沙盒战场外围白地，战区外土地改为灰色背景。德法战场按1940年态势调整：德国西线集中机动力量，法国坦克和炮兵较多，保留北方部署、后方预备队与梅斯—南锡要塞线。Windows、Android、Web独立发布更新清单；原地址专用于安卓，iOS暂停更新支持。包含此前全部更新。',base:`https://wc2-1324086514.cos.ap-guangzhou.myqcloud.com/web/releases/${build.release}/`,files };
if (!process.env.WC2_UPDATE_SIGN_KEY) throw Error('Set WC2_UPDATE_SIGN_KEY to the private signing key path');
const signingKey = await fs.readFile(process.env.WC2_UPDATE_SIGN_KEY);
for (const channel of ['windows','android','web']) {
  const payload = Buffer.from(JSON.stringify({...manifest, channel}));
  const signature = crypto.sign('sha256', payload, signingKey);
  const envelope = JSON.stringify({payload:payload.toString('base64'),signature:signature.toString('base64')});
  await fs.writeFile(path.join(root, `dist/web/stable-${channel}.json`), envelope);
  // The old address is now Android-only, preserving already-installed shells.
  if (channel === 'android') await fs.writeFile(path.join(root,'dist/web/stable.json'), envelope);
}
console.log(JSON.stringify({release:build.release,files:files.length,channels:['windows','android','web'],legacy:'android only'}));
