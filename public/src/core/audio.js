// Music and one-shot sound effects.
//   E.playPlaylist(list)  background music: the tracks play one after another and wrap around (default E.playlist);
//                         calling it again while it is already playing does nothing, so scenes can call it freely.
//   E.playMusic(name)     one looping track (special cases such as a defeat jingle).
// 随机播放：每一轮里每首都会放到一次(已放曲目记在 localStorage，重启后接着这一轮)，放完再随机开始新一轮。
import { E } from './kernel.js';

E.playlist = [
  // 原版游戏自带的战斗背景音乐
  'battle1.mp3',
  'battle2.mp3',
  'battle3.mp3',
  'battle4.mp3',
  // 用户加入的曲目
  'music/pearl_harbor_attack.mp3',
  'music/bilibili_BV19f4y1H7tq.mp3',
  'music/gwpw_p2_calm_etude.mp3',
  'music/gwpw_p4_fleeing_from_the_war.mp3',
  'hoi4/music/hoi4mainthemeallies.ogg',
  'hoi4/music/operationbarbarossa.ogg',
  'hoi4/music/axis1march.ogg',
  'hoi4/music/thegreatpatrioticwar.ogg',
  'hoi4/music/offensive.ogg',
  'hoi4/music/theredarmy.ogg',
  'hoi4/music/alliesfaction.ogg',
  'hoi4/music/axistheme.ogg',
  'hoi4/music/general_war_bringforththetanks.ogg',
  'hoi4/music/general_war_theattack.ogg',
  'hoi4/music/epicbattle.ogg',
  'hoi4/music/bigfleet.ogg',
  'hoi4/music/bigairforce.ogg',
  'hoi4/music/achtungpanzer.ogg',
  'hoi4/music/kriegsgewitter.ogg',
  'hoi4/music/luftwaffemarch_reprise.ogg',
  'hoi4/music/montgomerysmarch.ogg',
  'hoi4/music/rafheroesofthesky.ogg',
  'hoi4/music/motherrussia.ogg',
  'hoi4/music/themightofsovietunion.ogg',
  'hoi4/music/sovietsuite_finale.ogg',
  'hoi4/music/japanoverture.ogg',
  'hoi4/music/empireofthesun.ogg',
  'hoi4/music/warofresistance.ogg',
  'hoi4/music/battleofwuhan.ogg',
  'hoi4/music/heroesofelalamein.ogg',
  'hoi4/music/londoninflames.ogg',
  'hoi4/music/marchtothefront.ogg',
  'hoi4/music/war.ogg',
  'hoi4/music/lotsofbattles.ogg'
];
let pausedByHidden = false;
const audio = E.audio = { music: null, unlocked: false, list: null, idx: 0, pending: null };
const PLAYED_KEY = 'wc2.music.played';   // 本轮已放过的曲目；随机选曲，一轮内每首都放到，放完再开新一轮
const readPlayed = () => { try { const v = JSON.parse(localStorage.getItem(PLAYED_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const writePlayed = a => { try { localStorage.setItem(PLAYED_KEY, JSON.stringify(a)); } catch (e) {} };
const pick = (list, last) => {
  let played = readPlayed().filter(n => list.includes(n));
  let left = list.filter(n => !played.includes(n));
  if (!left.length) {            // 一轮放完：新一轮，尽量不让上一首紧接着重复
    played = [];
    left = list.length > 1 ? list.filter(n => n !== last) : list.slice();
  }
  const name = left[Math.floor(Math.random() * left.length)];
  writePlayed([...played, name]);
  return name;
};

const track = (name, loop) => {
  if (audio.music) { audio.music.onended = null; audio.music.pause(); }
  const a = new Audio('assets/' + name); a.loop = loop; a.volume = audio.music ? audio.music.volume : E.state.music; a.dataset.name = name;
  const next = () => {
    if (audio.music !== a || !audio.list) return;
    track(pick(audio.list, name), false);
  };
  a.onended = next;
  a.onerror = next;
  a.play().then(() => { audio.unlocked = true; }).catch(() => { audio.unlocked = false; });   // blocked until the first user gesture
  audio.music = a;
  if (document.hidden) { a.pause(); pausedByHidden = true; }   // 页面隐藏期间切歌：不出声，回来后恢复
};

E.playPlaylist = (list = E.playlist) => {
  audio.pending = { list };
  if (E.muted) return;
  if (audio.list === list && audio.music) { if (audio.music.paused && audio.unlocked) audio.music.play().catch(() => {}); return; }
  audio.list = list;
  track(pick(list, null), false);
};
E.playMusic = name => {
  audio.pending = { name };
  if (E.muted) return;
  if (!audio.list && audio.music && audio.music.dataset.name === name) { if (audio.music.paused) audio.music.play().catch(() => {}); return; }
  audio.list = null; track(name, true);
};
E.setMusicVolume = v => { if (audio.music) audio.music.volume = v; };
// Sound effects: each file is fetched and decoded once into a buffer; playing one is a cheap buffer source. (Creating a new <audio> element for
// every effect, as before, cost tens of ms each on the main thread and a fight plays many.) A not yet loaded effect plays as soon as it is ready.
let actx = null; const bufs = new Map(), loading = new Map();
const ctx = () => actx || (actx = new (window.AudioContext || window.webkitAudioContext)());
const load = name => bufs.has(name) ? Promise.resolve(bufs.get(name)) : loading.get(name) || (loading.set(name, fetch('assets/' + name).then(r => r.arrayBuffer())
  .then(b => ctx().decodeAudioData(b)).then(buf => { bufs.set(name, buf); return buf; }).catch(() => null)), loading.get(name));
const fire = (name, buf) => { const c = ctx(), s = c.createBufferSource(), g = c.createGain(); s.buffer = buf; g.gain.value = E.state.sfx; s.connect(g); g.connect(c.destination); s.start(); };
E.playSfx = name => {
  if (E.muted || document.hidden) return;
  try { const c = ctx(); if (c.state === 'suspended') c.resume().catch(() => {}); } catch (e) { return; }
  const buf = bufs.get(name);
  if (buf) { try { fire(name, buf); } catch (e) {} } else load(name).then(b => { if (b) try { fire(name, b); } catch (e) {} });
};
E.preloadSfx = names => { if (!E.muted) names.forEach(n => { try { load(n); } catch (e) {} }); };

// Called from the first pointer / key event: browsers refuse to start audio before a user gesture.
export const unlockAudio = () => {
  if (audio.unlocked && audio.music && !audio.music.paused) return;
  audio.unlocked = true;
  try { if (actx && actx.state === 'suspended') actx.resume().catch(() => {}); } catch (e) {}
  if (audio.music && audio.music.paused) audio.music.play().catch(() => {});
  else if (audio.pending) { const p = audio.pending; if (p.list) E.playPlaylist(p.list); else E.playMusic(p.name); }
};

// 页面不可见(切到其他标签页/最小化)时静音：暂停音乐、挂起音效上下文、丢弃新音效；回到本页后恢复。
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    const m = audio.music;
    pausedByHidden = !!(m && !m.paused);
    if (pausedByHidden) m.pause();
    try { if (actx && actx.state === 'running') actx.suspend().catch(() => {}); } catch (e) {}
  } else {
    try { if (actx && actx.state === 'suspended') actx.resume().catch(() => {}); } catch (e) {}
    if (pausedByHidden && audio.music && !E.muted) audio.music.play().catch(() => {});
    pausedByHidden = false;
  }
});
