// Account-owned raster assets. Immutable IDs keep shared works on the same version.
const crypto=require('node:crypto');
const LIMIT=30*1024*1024,FILE_LIMIT=4*1024*1024;
module.exports=function library(db,userFor,json){
 db.exec(`CREATE TABLE IF NOT EXISTS sandbox_assets(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,body BLOB NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS sandbox_asset_refs(user_id INTEGER NOT NULL,work_id TEXT NOT NULL,title TEXT NOT NULL,asset_id TEXT NOT NULL,PRIMARY KEY(user_id,work_id,asset_id));`);
 const used=id=>Number(db.prepare('SELECT COALESCE(SUM(size),0) AS n FROM sandbox_assets WHERE user_id=?').get(id).n);
 return function handle(req,res,p){
  if(!p.startsWith('/api/library/'))return false;
  (async()=>{try{
   const file=/^\/api\/library\/files\/([0-9a-f-]{36})$/.exec(p);
   if(file&&req.method==='GET'){const row=db.prepare('SELECT mime,body,sha256 FROM sandbox_assets WHERE id=?').get(file[1]);if(!row)return json(res,404,{error:'素材不存在'});res.writeHead(200,{'Content-Type':row.mime,'Content-Length':row.body.length,'Cache-Control':'public,max-age=31536000,immutable','X-Content-Type-Options':'nosniff','ETag':'"'+row.sha256+'"'});return res.end(Buffer.from(row.body));}
   const user=userFor(req);if(!user)return json(res,401,{error:'请登录后使用个人素材库'});
   if(p==='/api/library/assets'&&req.method==='GET'){const assets=db.prepare('SELECT id,name,mime,size,sha256,created_at FROM sandbox_assets WHERE user_id=? ORDER BY created_at DESC').all(user.id);for(const a of assets)a.references=db.prepare('SELECT DISTINCT title FROM sandbox_asset_refs WHERE asset_id=?').all(a.id).map(r=>r.title);return json(res,200,{assets,used:used(user.id),limit:LIMIT,fileLimit:FILE_LIMIT});}
   if(p==='/api/library/assets'&&req.method==='POST'){
    const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>6*1024*1024)return json(res,413,{error:'单张素材不能超过 4 MB'});parts.push(part);}let body=Buffer.concat(parts),uploadName=req.headers['x-asset-name'];if((req.headers['content-type']||'').includes('application/json')){const data=JSON.parse(body.toString('utf8'));if(typeof data.base64!=='string'||!data.base64.match(/^[A-Za-z0-9+/]*={0,2}$/))throw Error('图片编码无效');body=Buffer.from(data.base64,'base64');uploadName=encodeURIComponent(String(data.name||'素材'));}size=body.length;if(size>FILE_LIMIT)throw Error('单张素材不能超过 4 MB');let mime;
    if(body.length>24&&body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){const w=body.readUInt32BE(16),h=body.readUInt32BE(20);if(!w||!h||w>4096||h>4096||w*h>16777216)throw Error('图片尺寸不能超过 4096×4096');mime='image/png';}
    else if(body.length>12&&body[0]===255&&body[1]===216&&body[2]===255)mime='image/jpeg';
    else if(body.length>20&&body.toString('ascii',0,4)==='RIFF'&&body.toString('ascii',8,12)==='WEBP'&&!body.includes(Buffer.from('ANIM')))mime='image/webp';
    else throw Error('只支持静态 PNG、JPEG、WebP 图片');
    let dimensions=null;
    if(mime==='image/jpeg'){let pos=2;while(pos+9<body.length){if(body[pos++]!==255)break;let marker=body[pos++];while(marker===255&&pos<body.length)marker=body[pos++];if(marker===217||marker===218)break;if(marker===216||(marker>=208&&marker<=215))continue;const len=body.readUInt16BE(pos);if(len<2||pos+len>body.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){dimensions=[body.readUInt16BE(pos+5),body.readUInt16BE(pos+3)];break;}pos+=len;}if(!dimensions)throw Error('JPEG 图片结构无效');}
    if(mime==='image/webp'){const kind=body.toString('ascii',12,16);if(kind==='VP8X'&&body.length>=30)dimensions=[1+body.readUIntLE(24,3),1+body.readUIntLE(27,3)];else if(kind==='VP8L'&&body.length>=25&&body[20]===47){const bits=body.readUInt32LE(21);dimensions=[(bits&16383)+1,((bits>>>14)&16383)+1];}else if(kind==='VP8 '&&body.length>=30&&body.toString('hex',23,26)==='9d012a')dimensions=[body.readUInt16LE(26)&16383,body.readUInt16LE(28)&16383];if(!dimensions)throw Error('WebP 图片结构无效');}
    if(dimensions&&(!dimensions[0]||!dimensions[1]||dimensions.some(d=>d>4096)||dimensions[0]*dimensions[1]>16777216))throw Error('图片尺寸不能超过 4096×4096');
    const name=decodeURIComponent(uploadName||'素材').slice(0,80),id=crypto.randomUUID(),sha256=crypto.createHash('sha256').update(body).digest('hex');
    db.exec('BEGIN IMMEDIATE');try{if(used(user.id)+size>LIMIT)throw Error('个人素材库已达到 30 MB 上限');db.prepare('INSERT INTO sandbox_assets(id,user_id,name,mime,size,sha256,body) VALUES(?,?,?,?,?,?,?)').run(id,user.id,name,mime,size,sha256,body);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    return json(res,201,{asset:{id,name,mime,size,sha256},used:used(user.id),limit:LIMIT});
   }
   if(file&&req.method==='DELETE'){const row=db.prepare('SELECT user_id FROM sandbox_assets WHERE id=?').get(file[1]);if(!row||row.user_id!==user.id)return json(res,404,{error:'素材不存在'});const references=db.prepare('SELECT DISTINCT title FROM sandbox_asset_refs WHERE asset_id=?').all(file[1]);if(references.length)return json(res,409,{error:'素材正在被作品引用，请先移除作品引用',references});db.prepare('DELETE FROM sandbox_assets WHERE id=? AND user_id=?').run(file[1],user.id);return json(res,200,{ok:true,used:used(user.id)});}
   if(p==='/api/library/refs'&&req.method==='POST'){let raw='';for await(const part of req){raw+=part;if(raw.length>30000)throw Error('素材引用请求过大');}const data=JSON.parse(raw);if(typeof data.workId!=='string'||data.workId.length>80||!Array.isArray(data.assets)||data.assets.length>128)throw Error('素材引用无效');const ids=[...new Set(data.assets)];for(const id of ids)if(!db.prepare('SELECT id FROM sandbox_assets WHERE id=?').get(id))throw Error('作品引用的素材不存在');db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM sandbox_asset_refs WHERE user_id=? AND work_id=?').run(user.id,data.workId);for(const id of ids)db.prepare('INSERT INTO sandbox_asset_refs(user_id,work_id,title,asset_id) VALUES(?,?,?,?)').run(user.id,data.workId,String(data.title||'沙盒作品').slice(0,80),id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return json(res,200,{ok:true});}
   return json(res,405,{error:'请求方法错误'});
  }catch(e){if(!res.headersSent)json(res,400,{error:e.message});}})();return true;
 };
};
