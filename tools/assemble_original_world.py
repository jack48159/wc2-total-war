"""Reassemble original WC2 map tiles; combine shipped regional scenarios without inventing geography."""
import json
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parent.parent
assets=root/'project/app/src/main/assets'
data=assets/'remake/data'
read=lambda p: json.loads(p.read_text(encoding='utf-8'))
canvas=Image.new('RGB',(16000,7000),'#d4c69a')
missing=[]
for y in range(7):
 for x in range(16):
  p=assets/'map'/f'{x}_{y}.webp'
  if not p.exists(): missing.append(p.name);continue
  with Image.open(p) as tile:canvas.paste(tile.convert('RGB'),(x*1000-12,y*1000-12))
if missing:raise RuntimeError('Missing original map tiles: '+str(missing))
out=assets/'map/original-world-full.webp'
canvas.save(out,'WEBP',quality=92,method=6)
canvas.resize((4000,1750),Image.Resampling.LANCZOS).save(assets/'map/original-world-preview.webp',quality=90,method=6)
(root/'dist').mkdir(exist_ok=True)
canvas.save(root/'dist/wc2-original-world-full.png')
meta=read(data/'areas.json');areas={};countries={}
for name in ['conquest_1','conquest_2','conquest_4','conquest_5','conquest_6','conquest_3','conquest_7']:
 stage=read(data/'stages'/f'{name}.json')
 for c in stage['countries']:countries.setdefault(c['id'],c)
 for a in stage['areas']:
  if a['id'] not in areas or not areas[a['id']].get('country'):areas[a['id']]=a
for a in meta['areas']:
 areas.setdefault(a['id'],{'id':a['id'],'country':None,'construction':'none','level':0,'installation':'none','armies':[]})
for c in countries.values():c.update(alliance=c['id'],ai=True)
stage={'name':'原版完整世界 · 跨关卡拼合','map':1,'enabled':list(areas),'countries':list(countries.values()),'areas':list(areas.values()),'diplomacy':{'enabled':True,'relations':{},'pacts':{}},'worldAssembly':True}
(data/'stages/sandbox_world.json').write_text(json.dumps(stage,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print(json.dumps({'tiles':112,'size':[16000,7000],'areas':len(areas),'countries':len(countries),'image':str(out)},ensure_ascii=False))
