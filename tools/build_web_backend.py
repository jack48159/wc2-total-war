"""Package only server code and authoritative game data, never account databases."""
import json
import shutil
import tarfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
build = json.loads((root / 'dist/web/latest-build.json').read_text(encoding='utf-8-sig'))
output = root / 'dist/web/backend' / build['release']
output.mkdir(parents=True, exist_ok=False)
engine = output / 'multiplayer/engine'
shutil.copytree(root / 'public/src/game', engine / 'src/game')
shutil.copytree(root / 'public/scenarios', engine / 'scenarios')
shutil.copytree(Path(build['output']) / 'data', engine / 'data')
(engine / 'assets').mkdir()
for name in ['armydef.xml', 'commanderdef.xml']:
    shutil.copy2(root / 'project/app/src/main/assets' / name, engine / 'assets' / name)
for name in ['server.mjs', 'runtime.mjs', 'room_engine.mjs', 'package.json']:
    shutil.copy2(root / 'multiplayer' / name, output / 'multiplayer' / name)
shutil.copy2(root / 'auth_store.js', output / 'auth_store.js')
shutil.copy2(root / 'asset_library.js', output / 'asset_library.js')
archive = output.with_suffix('.tar.gz')
with tarfile.open(archive, 'w:gz') as bundle:
    for item in output.iterdir():
        bundle.add(item, arcname=item.name)
print(json.dumps({'archive': str(archive), 'bytes': archive.stat().st_size}))
