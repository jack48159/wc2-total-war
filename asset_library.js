// Account-owned raster assets. Immutable IDs keep shared works on the same version.
const crypto=require('node:crypto');
const LIMIT=30*1024*1024,FILE_LIMIT=4*1024*1024;
module.exports=function library(db,userFor,json){
 db.exec(`CREATE TABLE IF NOT EXISTS sandbox_assets(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,body BLOB NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS sandbox_asset_refs(user_id INTEGER NOT NULL,work_id TEXT NOT NULL,title TEXT NOT NULL,asset_id TEXT NOT NULL,PRIMARY KEY(user_id,work_id,asset_id));`);
 const columns=new Set(db.prepare('PRAGMA table_info(sandbox_assets)').all().map(c=>c.name));
 for(const [name,type] of [['category',"TEXT NOT NULL DEFAULT 'other'"],['tags',"TEXT NOT NULL DEFAULT '[]'"],['width','INTEGER'],['height','INTEGER']])if(!columns.has(name))db.exec(`ALTER TABLE sandbox_assets ADD COLUMN ${name} ${type}`);
 const categories=new Set(['unit','card','event','cover','other']);
 const metadata=data=>{const name=String(data.name||'素材').trim().slice(0,80);if(!name)throw Error('请填写素材名称');const category=data.category||'other';if(!categories.has(category))throw Error('素材分类无效');const tags=[...new Set((Array.isArray(data.tags)?data.tags:[]).map(t=>String(t).trim().slice(0,20)).filter(Boolean))];if(tags.length>8)throw Error('每张素材最多 8 个标签');return {name,category,tags};};
 const references=(id,userId)=>{const rows=db.prepare('SELECT user_id,work_id,title FROM sandbox_asset_refs WHERE asset_id=?').all(id);return rows.map(r=>r.user_id===userId?{workId:r.work_id,title:r.title,shared:r.work_id.startsWith('share-'),own:true}:{title:'其他玩家的作品',own:false,shared:false});};
 async function readJson(req,limit=30000){let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>limit)throw Error('请求过大');}return JSON.parse(raw);}
 db.exec(`CREATE TABLE IF NOT EXISTS sandbox_content(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,kind TEXT NOT NULL,name TEXT NOT NULL,body TEXT NOT NULL,updated_at INTEGER NOT NULL);`);
 const contentRefs=(userId,workId,title,definition)=>{const found=new Set();const walk=(value,depth=0)=>{if(depth>24)return;if(typeof value==='string'){const match=/^https:\/\/208\.87\.207\.49\/api\/library\/files\/([0-9a-f-]{36})$/.exec(value);if(match)found.add(match[1]);}else if(value&&typeof value==='object')for(const child of Object.values(value))walk(child,depth+1);};walk(definition);for(const id of found)if(!db.prepare('SELECT id FROM sandbox_assets WHERE id=?').get(id))throw Error('内容引用的图片不存在');db.prepare('DELETE FROM sandbox_asset_refs WHERE user_id=? AND work_id=?').run(userId,workId);for(const id of found)db.prepare('INSERT INTO sandbox_asset_refs(user_id,work_id,title,asset_id) VALUES(?,?,?,?)').run(userId,workId,title,id);};
 const used=id=>Number(db.prepare('SELECT COALESCE(SUM(size),0) AS n FROM sandbox_assets WHERE user_id=?').get(id).n);
 return function handle(req,res,p){
  if(!p.startsWith('/api/library/'))return false;
  (async()=>{try{
   const file=/^\/api\/library\/files\/([0-9a-f-]{36})$/.exec(p);
   if(file&&req.method==='GET'){const row=db.prepare('SELECT mime,body,sha256 FROM sandbox_assets WHERE id=?').get(file[1]);if(!row)return json(res,404,{error:'素材不存在'});res.writeHead(200,{'Content-Type':row.mime,'Content-Length':row.body.length,'Cache-Control':'public,max-age=31536000,immutable','X-Content-Type-Options':'nosniff','ETag':'"'+row.sha256+'"'});return res.end(Buffer.from(row.body));}
   const user=userFor(req);if(!user)return json(res,401,{error:'请登录后使用个人素材库'});
   if(p==='/api/library/content'&&req.method==='GET'){
    const content=db.prepare('SELECT id,kind,name,body,updated_at FROM sandbox_content WHERE user_id=? ORDER BY updated_at DESC').all(user.id).map(({body,...row})=>({...row,definition:JSON.parse(body)}));return json(res,200,{content});
   }
   if(p==='/api/library/content'&&req.method==='POST'){
    const data=await readJson(req,65536),id=data.id||crypto.randomUUID(),kind=data.kind,definition=data.definition;
    if(!/^[0-9a-f-]{36}$/.test(id)||!['unit','card'].includes(kind)||!definition||typeof definition.name!=='string'||!definition.name.trim())throw Error('创作内容无效');
    const existing=db.prepare('SELECT user_id,kind FROM sandbox_content WHERE id=?').get(id);if(existing&&(existing.user_id!==user.id||existing.kind!==kind))throw Error('内容不存在');
    if(!existing&&db.prepare('SELECT COUNT(*) AS n FROM sandbox_content WHERE user_id=? AND kind=?').get(user.id,kind).n>=64)throw Error('兵种和卡牌各最多保存 64 项');
    db.exec('BEGIN IMMEDIATE');try{contentRefs(user.id,'content-'+id,definition.name.slice(0,80)+'（'+(kind==='unit'?'兵种':'卡牌')+'素材）',definition);db.prepare('INSERT INTO sandbox_content(id,user_id,kind,name,body,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,body=excluded.body,updated_at=excluded.updated_at').run(id,user.id,kind,definition.name.slice(0,80),JSON.stringify(definition),Date.now());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return json(res,200,{id,ok:true});
   }
   const contentFile=/^\/api\/library\/content\/([0-9a-f-]{36})$/.exec(p);
   if(contentFile&&req.method==='DELETE'){
    const row=db.prepare('SELECT id FROM sandbox_content WHERE id=? AND user_id=?').get(contentFile[1],user.id);if(!row)return json(res,404,{error:'内容不存在'});db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM sandbox_content WHERE id=? AND user_id=?').run(row.id,user.id);db.prepare('DELETE FROM sandbox_asset_refs WHERE user_id=? AND work_id=?').run(user.id,'content-'+row.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return json(res,200,{ok:true});
   }
   if(p==='/api/library/assets'&&req.method==='GET'){
    const assets=db.prepare('SELECT id,name,mime,size,sha256,created_at,category,tags,width,height FROM sandbox_assets WHERE user_id=? ORDER BY created_at DESC,rowid DESC').all(user.id);
    for(const a of assets){a.tags=JSON.parse(a.tags||'[]');a.referenceDetails=references(a.id,user.id);a.references=[...new Set(a.referenceDetails.map(r=>r.title))];}
    return json(res,200,{assets,used:used(user.id),limit:LIMIT,fileLimit:FILE_LIMIT});
   }
   const detail=/^\/api\/library\/assets\/([0-9a-f-]{36})$/.exec(p);
   if(detail&&req.method==='POST'){
    const row=db.prepare('SELECT id FROM sandbox_assets WHERE id=? AND user_id=?').get(detail[1],user.id);if(!row)return json(res,404,{error:'素材不存在'});
    const meta=metadata(await readJson(req));db.prepare('UPDATE sandbox_assets SET name=?,category=?,tags=? WHERE id=? AND user_id=?').run(meta.name,meta.category,JSON.stringify(meta.tags),detail[1],user.id);return json(res,200,{ok:true});
   }
   if(p==='/api/library/assets/delete'&&req.method==='POST'){
    const data=await readJson(req);if(!Array.isArray(data.ids)||!data.ids.length||data.ids.length>100)throw Error('一次最多删除 100 张素材');
    const deleted=[],blocked=[];db.exec('BEGIN IMMEDIATE');try{for(const id of new Set(data.ids)){const row=db.prepare('SELECT id,name FROM sandbox_assets WHERE id=? AND user_id=?').get(id,user.id);if(!row)continue;if(db.prepare('SELECT 1 FROM sandbox_asset_refs WHERE asset_id=? LIMIT 1').get(id)){blocked.push({id,name:row.name});continue;}db.prepare('DELETE FROM sandbox_assets WHERE id=? AND user_id=?').run(id,user.id);deleted.push(id);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return json(res,200,{deleted,blocked,used:used(user.id)});
   }
   if(p==='/api/library/refs/release'&&req.method==='POST'){
    const data=await readJson(req);if(typeof data.workId!=='string'||!/^share-[0-9a-f]{64}$/.test(data.workId))throw Error('只能取消自己的分享保留');db.prepare('DELETE FROM sandbox_asset_refs WHERE user_id=? AND work_id=?').run(user.id,data.workId);return json(res,200,{ok:true});
   }
   if(p==='/api/library/assets'&&req.method==='POST'){
    const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>6*1024*1024)return json(res,413,{error:'单张素材不能超过 4 MB'});parts.push(part);}let body=Buffer.concat(parts),uploadName=req.headers['x-asset-name'],uploadMeta={};if((req.headers['content-type']||'').includes('application/json')){const data=JSON.parse(body.toString('utf8'));uploadMeta=data;if(typeof data.base64!=='string'||!data.base64.match(/^[A-Za-z0-9+/]*={0,2}$/))throw Error('图片编码无效');body=Buffer.from(data.base64,'base64');uploadName=encodeURIComponent(String(data.name||'素材'));}size=body.length;if(size>FILE_LIMIT)throw Error('单张素材不能超过 4 MB');let mime;
    if(body.length>24&&body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){const w=body.readUInt32BE(16),h=body.readUInt32BE(20);if(!w||!h||w>4096||h>4096||w*h>16777216)throw Error('图片尺寸不能超过 4096×4096');mime='image/png';}
    else if(body.length>12&&body[0]===255&&body[1]===216&&body[2]===255)mime='image/jpeg';
    else if(body.length>20&&body.toString('ascii',0,4)==='RIFF'&&body.toString('ascii',8,12)==='WEBP'&&!body.includes(Buffer.from('ANIM')))mime='image/webp';
    else throw Error('只支持静态 PNG、JPEG、WebP 图片');
    let dimensions=mime==='image/png'?[body.readUInt32BE(16),body.readUInt32BE(20)]:null;
    if(mime==='image/jpeg'){let pos=2;while(pos+9<body.length){if(body[pos++]!==255)break;let marker=body[pos++];while(marker===255&&pos<body.length)marker=body[pos++];if(marker===217||marker===218)break;if(marker===216||(marker>=208&&marker<=215))continue;const len=body.readUInt16BE(pos);if(len<2||pos+len>body.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){dimensions=[body.readUInt16BE(pos+5),body.readUInt16BE(pos+3)];break;}pos+=len;}if(!dimensions)throw Error('JPEG 图片结构无效');}
    if(mime==='image/webp'){const kind=body.toString('ascii',12,16);if(kind==='VP8X'&&body.length>=30)dimensions=[1+body.readUIntLE(24,3),1+body.readUIntLE(27,3)];else if(kind==='VP8L'&&body.length>=25&&body[20]===47){const bits=body.readUInt32LE(21);dimensions=[(bits&16383)+1,((bits>>>14)&16383)+1];}else if(kind==='VP8 '&&body.length>=30&&body.toString('hex',23,26)==='9d012a')dimensions=[body.readUInt16LE(26)&16383,body.readUInt16LE(28)&16383];if(!dimensions)throw Error('WebP 图片结构无效');}
    if(dimensions&&(!dimensions[0]||!dimensions[1]||dimensions.some(d=>d>4096)||dimensions[0]*dimensions[1]>16777216))throw Error('图片尺寸不能超过 4096×4096');
    const name=decodeURIComponent(uploadName||'素材').slice(0,80),id=crypto.randomUUID(),sha256=crypto.createHash('sha256').update(body).digest('hex');
    const meta=metadata({...uploadMeta,name});const existing=db.prepare('SELECT id,name,mime,size,sha256,category,tags,width,height FROM sandbox_assets WHERE user_id=? AND sha256=?').get(user.id,sha256);if(existing){existing.tags=JSON.parse(existing.tags||'[]');return json(res,200,{asset:existing,duplicate:true,used:used(user.id),limit:LIMIT});}
    db.exec('BEGIN IMMEDIATE');try{if(used(user.id)+size>LIMIT)throw Error('个人素材库已达到 30 MB 上限');db.prepare('INSERT INTO sandbox_assets(id,user_id,name,mime,size,sha256,body,category,tags,width,height) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,user.id,meta.name,mime,size,sha256,body,meta.category,JSON.stringify(meta.tags),dimensions?.[0],dimensions?.[1]);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    return json(res,201,{asset:{id,...meta,mime,size,sha256,width:dimensions?.[0],height:dimensions?.[1]},used:used(user.id),limit:LIMIT});
   }
   if(file&&req.method==='DELETE'){const row=db.prepare('SELECT user_id FROM sandbox_assets WHERE id=?').get(file[1]);if(!row||row.user_id!==user.id)return json(res,404,{error:'素材不存在'});const references=db.prepare('SELECT DISTINCT title FROM sandbox_asset_refs WHERE asset_id=?').all(file[1]);if(references.length)return json(res,409,{error:'素材正在被作品引用，请先移除作品引用',references});db.prepare('DELETE FROM sandbox_assets WHERE id=? AND user_id=?').run(file[1],user.id);return json(res,200,{ok:true,used:used(user.id)});}
   if(p==='/api/library/refs'&&req.method==='POST'){let raw='';for await(const part of req){raw+=part;if(raw.length>30000)throw Error('素材引用请求过大');}const data=JSON.parse(raw);if(typeof data.workId!=='string'||data.workId.length>80||!Array.isArray(data.assets)||data.assets.length>128)throw Error('素材引用无效');const ids=[...new Set(data.assets)];for(const id of ids)if(!db.prepare('SELECT id FROM sandbox_assets WHERE id=?').get(id))throw Error('作品引用的素材不存在');db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM sandbox_asset_refs WHERE user_id=? AND work_id=?').run(user.id,data.workId);for(const id of ids)db.prepare('INSERT INTO sandbox_asset_refs(user_id,work_id,title,asset_id) VALUES(?,?,?,?)').run(user.id,data.workId,String(data.title||'沙盒作品').slice(0,80),id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return json(res,200,{ok:true});}
   return json(res,405,{error:'请求方法错误'});
  }catch(e){if(!res.headersSent)json(res,400,{error:e.message});}})();return true;
 };
};
