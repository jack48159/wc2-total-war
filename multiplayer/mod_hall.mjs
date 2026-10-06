import crypto from 'node:crypto';

// Published designs live in the account database; local edits remain private.
export function createModHall({db,userFor,json,validateConfig}) {
  db.exec(`CREATE TABLE IF NOT EXISTS sandbox_mods (
    id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,work_id TEXT NOT NULL,
    title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',config TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,published INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(user_id,work_id));
    CREATE TABLE IF NOT EXISTS sandbox_mod_likes (
    mod_id TEXT NOT NULL,user_id INTEGER NOT NULL,PRIMARY KEY(mod_id,user_id));
    CREATE INDEX IF NOT EXISTS sandbox_mod_recent ON sandbox_mods(published,updated_at);`);
  async function body(req) {
    let size=0;const chunks=[];
    for await(const part of req){size+=part.length;if(size>9*1024*1024)throw Error('作品配置过大');chunks.push(part);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('请求格式错误');}
  }
  const references=config=>{
    const ids=new Set();
    const walk=(value,depth=0)=>{if(depth>30)throw Error('作品层级过深');
      if(typeof value==='string'){const m=/^https:\/\/208\.87\.207\.49\/api\/library\/files\/([0-9a-f-]{36})$/.exec(value);if(m)ids.add(m[1]);}
      else if(value&&typeof value==='object')for(const child of Object.values(value))walk(child,depth+1);};
    walk(config);return [...ids];
  };
  function pin(user,id,title,ids) {
    for(const asset of ids)if(!db.prepare('SELECT id FROM sandbox_assets WHERE id=?').get(asset))throw Error('作品使用的图片已不存在，请重新选择素材');
    db.prepare('DELETE FROM sandbox_asset_refs WHERE user_id=? AND work_id=?').run(user,'mod-'+id);
    for(const asset of ids)db.prepare('INSERT INTO sandbox_asset_refs(user_id,work_id,title,asset_id) VALUES(?,?,?,?)').run(user,'mod-'+id,title,asset);
  }
  const select=`SELECT m.*,u.username AS author,
    (SELECT COUNT(*) FROM sandbox_mod_likes l WHERE l.mod_id=m.id) AS likes,
    EXISTS(SELECT 1 FROM sandbox_mod_likes l WHERE l.mod_id=m.id AND l.user_id=?) AS liked
    FROM sandbox_mods m JOIN users u ON u.id=m.user_id`;
  function summary(row,user){const config=JSON.parse(row.config);return {
    id:row.id,title:row.title,description:row.description,author:row.author,authorId:row.user_id,
    version:row.version,published:!!row.published,createdAt:row.created_at,updatedAt:row.updated_at,
    likes:Number(row.likes),liked:!!row.liked,own:user?.id===row.user_id,workId:user?.id===row.user_id?row.work_id:undefined,
    stage:config.stage,coverUrl:config.features?.coverUrl||'',countries:config.countries.map(c=>({id:c.id,flag:c.flag})),
    countryCount:config.countries.length,areaCount:config.areas.length,
    unitCount:config.areas.reduce((n,a)=>n+(a.armies?.length||0),0),eventCount:config.scenarioEvents?.definitions?.length||0};}
  return async function handle(req,res,url){
    if(!url.pathname.startsWith('/api/mods'))return false;
    try {
      const user=userFor(req);
      if(url.pathname==='/api/mods'&&req.method==='GET'){
        const q=String(url.searchParams.get('q')||'').trim().slice(0,80),mine=url.searchParams.get('mine')==='1';
        if(mine&&!user){json(res,401,{error:'请登录后查看已发布作品'});return true;}
        const offset=Math.max(0,Math.min(100000,Math.floor(Number(url.searchParams.get('offset'))||0)));
        const count=24,where=mine?'m.user_id=?':'m.published=1',args=[user?.id||-1];if(mine)args.push(user.id);
        const pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
        const filter=`${where} AND (m.title LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\' OR m.description LIKE ? ESCAPE '\\')`;
        args.push(pattern,pattern,pattern);
        const order=url.searchParams.get('sort')==='popular'?'likes DESC,m.updated_at DESC,m.id':'m.updated_at DESC,m.id';
        const rows=db.prepare(`${select} WHERE ${filter} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args,count+1,offset);
        json(res,200,{mods:rows.slice(0,count).map(r=>summary(r,user)),hasMore:rows.length>count,offset});return true;
      }
      if(url.pathname==='/api/mods'&&req.method==='POST'){
        if(!user){json(res,401,{error:'请登录后发布作品'});return true;}
        const input=await body(req),workId=String(input.workId||''),config=input.config;
        if(!/^[a-zA-Z0-9_-]{1,80}$/.test(workId))throw Error('作品标识无效');
        const title=String(input.title||config?.name||'').trim(),description=String(input.description||'').trim();
        if(!title||title.length>80||description.length>1200)throw Error('标题最多80字，简介最多1200字');
        await validateConfig(config);config.name=title;
        const serialized=JSON.stringify(config);if(Buffer.byteLength(serialized)>8*1024*1024)throw Error('作品配置超过8MB');
        const previous=db.prepare('SELECT id FROM sandbox_mods WHERE user_id=? AND work_id=?').get(user.id,workId);
        if(!previous&&db.prepare('SELECT COUNT(*) AS n FROM sandbox_mods WHERE user_id=?').get(user.id).n>=100)throw Error('每个账号最多发布100个作品');
        const id=previous?.id||crypto.randomUUID(),now=Date.now(),ids=references(config);
        db.exec('BEGIN IMMEDIATE');
        try{pin(user.id,id,title,ids);
          db.prepare(`INSERT INTO sandbox_mods(id,user_id,work_id,title,description,config,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,work_id) DO UPDATE SET title=excluded.title,
            description=excluded.description,config=excluded.config,published=1,version=version+1,updated_at=excluded.updated_at`)
            .run(id,user.id,workId,title,description,serialized,now,now);db.exec('COMMIT');
        }catch(error){db.exec('ROLLBACK');throw error;}
        const row=db.prepare(`${select} WHERE m.id=?`).get(user.id,id);json(res,200,{mod:summary(row,user)});return true;
      }
      const route=url.pathname.match(/^\/api\/mods\/([0-9a-f-]{36})(\/like)?$/);
      if(!route){json(res,404,{error:'作品接口不存在'});return true;}
      const row=db.prepare(`${select} WHERE m.id=?`).get(user?.id||-1,route[1]);
      if(!row||(!row.published&&row.user_id!==user?.id)){json(res,404,{error:'作品不存在或已取消发布'});return true;}
      if(route[2]&&req.method==='PUT'){
        if(!user){json(res,401,{error:'请登录后点赞'});return true;}if(!row.published)throw Error('已取消发布的作品不能点赞');
        const input=await body(req);if(typeof input.liked!=='boolean')throw Error('点赞状态无效');
        if(input.liked)db.prepare('INSERT OR IGNORE INTO sandbox_mod_likes(mod_id,user_id) VALUES(?,?)').run(row.id,user.id);
        else db.prepare('DELETE FROM sandbox_mod_likes WHERE mod_id=? AND user_id=?').run(row.id,user.id);
        json(res,200,{liked:input.liked,likes:Number(db.prepare('SELECT COUNT(*) AS n FROM sandbox_mod_likes WHERE mod_id=?').get(row.id).n)});return true;
      }
      if(!route[2]&&req.method==='GET'){json(res,200,{mod:summary(row,user),config:JSON.parse(row.config)});return true;}
      if(!route[2]&&req.method==='DELETE'){
        if(!user){json(res,401,{error:'请登录'});return true;}if(row.user_id!==user.id){json(res,403,{error:'只能取消发布自己的作品'});return true;}
        db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE sandbox_mods SET published=0,updated_at=? WHERE id=?').run(Date.now(),row.id);
          db.prepare('DELETE FROM sandbox_asset_refs WHERE user_id=? AND work_id=?').run(user.id,'mod-'+row.id);db.exec('COMMIT');
        }catch(error){db.exec('ROLLBACK');throw error;}json(res,200,{ok:true});return true;
      }
      json(res,405,{error:'请求方法错误'});return true;
    }catch(error){if(!res.headersSent)json(res,400,{error:error.message});return true;}
  };
}
