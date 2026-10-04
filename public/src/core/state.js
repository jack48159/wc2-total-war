// Persistent player profile (settings, medals, rank) in localStorage.
import { E } from './kernel.js';
import { authFetch } from './auth.js';

const KEY = 'wc2.remake.state.v1';
const DEFAULT_STATE = { music: 0.6, sfx: 0.7, battleAnimation: true, gameSpeed: 3, hudStyle: 'old', hudArt: 'original', medals: 50, unlocked: { axis: 99, allies: 99, wto: 99, nato: 99 }, medalLevels: {}, rank: 1, victories: 0, moveSpeed: 1, smoke: 0.4, fire: 1, selectionTransparency: 0.5, fatigueMultiplier: 1, activeGlowEffect: 1, groupGlowIntensity: 0.85, logEnabled: true };

// Profile is stored in device-local IndexedDB through the local data adapter.
const normalise = () => {
  E.state.ownedCommanders = [...new Set(Array.isArray(E.state.ownedCommanders) ? E.state.ownedCommanders.filter(id => typeof id === 'string') : [])];
  E.state.hudStyle = 'old'; // v2 rejected; keep its source dormant.
  const art = new URLSearchParams(location.search).get('hudArt');
  if (art === 'original' || art === 'redraw') E.state.hudArt = art;
  if (art !== 'redraw') E.state.hudArt = 'original';   // user: in-battle HUD back to the original art; ?hudArt=redraw previews the redraw
  for (const k in E.state.unlocked) E.state.unlocked[k] = 99;                            // everything is open by design
  E.state.battleAnimation = false; E.state.gameSpeed = 5;
  E.state.music = Math.min(1, Math.max(0, Number.isFinite(E.state.music) ? E.state.music : DEFAULT_STATE.music));
  E.state.sfx = Math.min(1, Math.max(0, Number.isFinite(E.state.sfx) ? E.state.sfx : DEFAULT_STATE.sfx));
};
E.state = Object.assign({}, DEFAULT_STATE);
E.state.fogOfWar ??= false;
normalise();

E.saveState = () => {
  normalise();
  const body = JSON.stringify(E.state);
  try { authFetch('/api/profile', { method: 'POST', body }).catch(() => {}); } catch (e) {}
};

E.aiConfig = null;   // takeover settings (Options > 接管), loaded at startup for the LLM / MCP bridge
E.loadProfile = async () => {
  Object.assign(E.state, DEFAULT_STATE);
  try { const r = await authFetch('/api/profile'); if (r.ok) { const profile = await r.json(); if (profile) Object.assign(E.state, profile); normalise(); } } catch (e) {}
  try { E.aiConfig = JSON.parse(localStorage.getItem('wc2.aiconfig') || 'null'); } catch (e) {}
};
E.updateAiConfig = async (cfg) => {
  E.aiConfig = JSON.parse(JSON.stringify(cfg));
  const body = JSON.stringify(cfg);
  try { localStorage.setItem('wc2.aiconfig', body); } catch (e) {}
  return E.aiConfig;
};
