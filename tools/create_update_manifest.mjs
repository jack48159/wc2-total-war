import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = JSON.parse(await fs.readFile(path.join(root, 'dist/web/latest-build.json'), 'utf8'));
const files = [];
async function walk(dir) { for (const entry of await fs.readdir(dir, {withFileTypes:true})) { const file=path.join(dir,entry.name); if(entry.isDirectory()) await walk(file); else { const bytes=await fs.readFile(file);files.push({path:path.relative(build.output,file).split(path.sep).join('/'),size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}); } } }
await walk(build.output);files.sort((a,b)=>a.path.localeCompare(b.path));
const manifest = { release:build.release,version:'1.0.25',shell:1,protocol:'wc2-1',notes:'沙盒战区外的无人区恢复米白纸色并保留底图纹理。修复德法经典战场因自动地名误判而被移出战区的地块，恢复原版地图的领土轮廓；保留1940年态势的兵力与资源配置。战区外地区仍不可进入。包含此前全部更新。',base:`https://wc2-1324086514.cos.ap-guangzhou.myqcloud.com/web/releases/${build.release}/`,files };
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
