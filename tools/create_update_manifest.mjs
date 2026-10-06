import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = JSON.parse(await fs.readFile(path.join(root, 'dist/web/latest-build.json'), 'utf8'));
const files = [];
async function walk(dir) { for (const entry of await fs.readdir(dir, {withFileTypes:true})) { const file=path.join(dir,entry.name); if(entry.isDirectory()) await walk(file); else { const bytes=await fs.readFile(file);files.push({path:path.relative(build.output,file).split(path.sep).join('/'),size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}); } } }
await walk(build.output);files.sort((a,b)=>a.path.localeCompare(b.path));
const manifest = { release:build.release,version:'1.0.17',shell:1,protocol:'wc2-1',notes:'修复安卓与 iOS 指挥部框选退出后地图操作受阻：框选完成自动恢复拖动和缩放，取消选择统一退出框选，清除已隐藏工具栏的点击区域；框选时提供退出按钮。包含 1.0.16 的全部更新。',base:`https://wc2-1324086514.cos.ap-guangzhou.myqcloud.com/web/releases/${build.release}/`,files };
if (!process.env.WC2_UPDATE_SIGN_KEY) throw Error('Set WC2_UPDATE_SIGN_KEY to the private signing key path');
const payload=Buffer.from(JSON.stringify(manifest));const signature=crypto.sign('sha256',payload,await fs.readFile(process.env.WC2_UPDATE_SIGN_KEY));
await fs.writeFile(path.join(root,'dist/web/stable.json'),JSON.stringify({payload:payload.toString('base64'),signature:signature.toString('base64')}));
console.log(JSON.stringify({release:build.release,files:files.length,manifest:'dist/web/stable.json'}));
