import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = JSON.parse(await fs.readFile(path.join(root, 'dist/web/latest-build.json'), 'utf8'));
const files = [];
async function walk(dir) { for (const entry of await fs.readdir(dir, {withFileTypes:true})) { const file=path.join(dir,entry.name); if(entry.isDirectory()) await walk(file); else { const bytes=await fs.readFile(file);files.push({path:path.relative(build.output,file).split(path.sep).join('/'),size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}); } } }
await walk(build.output);files.sort((a,b)=>a.path.localeCompare(b.path));
const manifest = { release:build.release,version:'1.0.18',shell:1,protocol:'wc2-1',notes:'修复手机沙盒编辑菜单不可见及更新后旧界面缓存：固定编辑类别入口，国家下拉选择，作品紧凑列表；适配安卓与 iOS 横竖屏的素材库、编辑面板和分享窗口。包含此前全部更新。',base:`https://wc2-1324086514.cos.ap-guangzhou.myqcloud.com/web/releases/${build.release}/`,files };
if (!process.env.WC2_UPDATE_SIGN_KEY) throw Error('Set WC2_UPDATE_SIGN_KEY to the private signing key path');
const payload=Buffer.from(JSON.stringify(manifest));const signature=crypto.sign('sha256',payload,await fs.readFile(process.env.WC2_UPDATE_SIGN_KEY));
await fs.writeFile(path.join(root,'dist/web/stable.json'),JSON.stringify({payload:payload.toString('base64'),signature:signature.toString('base64')}));
console.log(JSON.stringify({release:build.release,files:files.length,manifest:'dist/web/stable.json'}));
