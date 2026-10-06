import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = JSON.parse(await fs.readFile(path.join(root, 'dist/web/latest-build.json'), 'utf8'));
const files = [];
async function walk(dir) { for (const entry of await fs.readdir(dir, {withFileTypes:true})) { const file=path.join(dir,entry.name); if(entry.isDirectory()) await walk(file); else { const bytes=await fs.readFile(file);files.push({path:path.relative(build.output,file).split(path.sep).join('/'),size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}); } } }
await walk(build.output);files.sort((a,b)=>a.path.localeCompare(b.path));
const manifest = { release:build.release,version:'1.0.16',shell:1,protocol:'wc2-1',notes:'新增沙盒 Mod 大厅，支持账号署名共享、更新、取消共享与点赞；优化我的作品与手机布局；沙盒停用稳定度并支持各国自定义失败条件；检查更新移至左下角，交流群位于右上角。',base:`https://wc2-1324086514.cos.ap-guangzhou.myqcloud.com/web/releases/${build.release}/`,files };
if (!process.env.WC2_UPDATE_SIGN_KEY) throw Error('Set WC2_UPDATE_SIGN_KEY to the private signing key path');
const payload=Buffer.from(JSON.stringify(manifest));const signature=crypto.sign('sha256',payload,await fs.readFile(process.env.WC2_UPDATE_SIGN_KEY));
await fs.writeFile(path.join(root,'dist/web/stable.json'),JSON.stringify({payload:payload.toString('base64'),signature:signature.toString('base64')}));
console.log(JSON.stringify({release:build.release,files:files.length,manifest:'dist/web/stable.json'}));
