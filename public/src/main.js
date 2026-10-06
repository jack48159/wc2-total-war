// Entry point. Layers (imports only point downwards):
//   scenes/  screens; compose ui/ and game/         ui/    shared widgets, Page base class
import './core/logger.js';
import { E } from './core/index.js';
import './ui/ui.js';
import { SCENES, routeFromHash } from './scenes/index.js';
import { World } from './game/world.js';
import { Game } from './game/game.js';
import * as controllers from './game/controllers.js';
import { requireLogin } from './core/auth.js';
import { SaveStore } from './game/savestore.js';
import { LiveGames } from './game/live_games.js';
import { platform } from './platform/detect.js';
import { Updates } from './core/updates.js';
import { installIosControls } from './platform/ios_controls.js';

// Dev / test hook (test/flow.js, test/probe.js, the browser console). Nothing in src/ reads it.
window.WC2 = Object.assign(E, { World, Game, SCENES, controllers });
E.platform = platform;
installIosControls(E);

E.user = await requireLogin();
await Promise.all([E.loadProfile(), SaveStore.preload()]);
const q = new URLSearchParams(location.search);
if (q.has('nofade')) E.noFade = true;
if (q.has('mute')) E.muted = true;                       // e.g. the studio's embedded debug page
// F2 opens the studio; on the studio's debug page (?edit) it starts / ends a layout recording instead.
const STUDIO_URL = 'http://localhost:8643/';               // the separate Studio project (../Studio)
E.openStudio = () => window.open(STUDIO_URL, 'wc2-studio');
E.layout.embedded = q.has('edit');
// Layout editor (F2 / ?edit) is loaded on demand; ?layout=<name> applies a saved recording.
E.layout.editorLoader = () => import('./debug/layout_editor.js');
// Global game config (data/game_config.json). Currently: `layout` = the adopted layout, embedded { name, scenes, added },
// written by "adopt" in the layout editor / Studio. ?layout=<name> tries a saved recording instead, ?layout=none turns layouts off.
{
  let cfg = {}; if (!platform.isPackaged) try { const r = await fetch(platform.isStaticWeb ? 'web_meta/game-config.json' : '/api/game-config'); if (r.ok) cfg = await r.json(); } catch (e) {}
  E.gameConfig = cfg;
  const want = q.get('layout');
  const saved = want === 'none' || want === 'off' ? null : want ? await E.layout.loadNamed(want) : cfg.layout && cfg.layout.scenes ? { scenes: cfg.layout.scenes, added: cfg.layout.added || {} } : null;
  if (saved) { E.layout.applied = saved; E.layout.overrides = JSON.parse(JSON.stringify(saved.scenes)); E.layout.added = JSON.parse(JSON.stringify(saved.added)); E.layout.applySaved = true; E.layout.refresh(); }
}
let [scene, ...args] = routeFromHash();
// 进行中的对局：URL 里带对局 ID 时从本地自动存档恢复；先清掉超过 3 天的未存档对局
LiveGames.purge();
if (scene === 'battle' && args[2]?.liveGameId) {
  const rec = await LiveGames.get(args[2].liveGameId);
  if (rec && rec.snapshot) args = [rec.stageName, rec.snapshot, { ...(rec.options || {}), liveRestore: true }];
  else { scene = 'home'; args = []; history.replaceState(null, '', new URL('#', location.href).href); }   // 记录不存在或已过期
}
await E.start('c', new SCENES[scene](...args));
void Updates.ready();
if (q.has('edit')) E.layout.toggle(q.get('edit'));
