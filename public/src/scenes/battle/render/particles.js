// A small particle system that plays the original effect files (assets/effect_*.xml), drawn in map units.
// Each <emitter> emits for its `life` seconds; the `timetrack` gives particles per second over that time, every particle draws
// a random value from each param's min..max and is then scaled over its own life by the `lifetrack` (speed, gravity, scale,
// rotation speed, r/g/b/a multipliers). `blend="add"` = additive. Exact constants of the original engine are not known
// (rotation units, gravity strength), so those are approximations.
import { E } from '../../../core/index.js';

const GRAVITY_SCALE = 0.15, ROT_SCALE = Math.PI;      // approximations, see above
// The dark smoke (normal blending) and the additive dust clouds are toned down by the player's smoke setting (Options > 特效):
// 0 = no smoke, 1 = the raw original numbers. The default 0.4 gives the values I judged "not too heavy" (alpha 0.4 / scale 0.7 for the smoke).
// piecewise linear through (0, a) (0.4, b) (1, c): 0 removes it, 0.4 (default) is the toned-down look, 1 is the raw original
const tone3 = (d, a, b, c) => d < 0.4 ? a + (b - a) * d / 0.4 : b + (c - b) * (d - 0.4) / 0.6;
const smokeTone = () => { const d = Math.max(0, Math.min(1, E.state.smoke ?? 0.4)); return { smoke: { alpha: tone3(d, 0, 0.4, 1), scale: tone3(d, 0.3, 0.7, 1) }, glow: { alpha: tone3(d, 0, 0.65, 1), scale: tone3(d, 0.3, 0.85, 1) } }; };
const rnd = (min, max) => min + Math.random() * (max - min);
const lerpTrack = (track, key, at, prop) => {          // linear interpolation of track[prop] at position `at` (track sorted by `key`)
  if (at <= track[0][key]) return track[0][prop];
  for (let i = 1; i < track.length; i++) if (at <= track[i][key]) { const a = track[i - 1], b = track[i], k = (at - a[key]) / ((b[key] - a[key]) || 1); return a[prop] + (b[prop] - a[prop]) * k; }
  return track[track.length - 1][prop];
};

const cache = new Map();
// parse assets/<file> once -> { emitters: [...] }
export async function loadEffect(file) {
  if (cache.has(file)) return cache.get(file);
  const p = (async () => {
    const doc = new DOMParser().parseFromString(await (await fetch('assets/' + file)).text(), 'text/xml'), num = (n, a) => +n.getAttribute(a);
    const emitters = [...doc.querySelectorAll('emitter')].map(em => {
      const par = name => em.querySelector(`param[name="${name}"]`), range = name => { const n = par(name); return n ? [num(n, 'min'), num(n, 'max')] : [0, 0]; };
      const img = par('image'), tracks = (name, keys) => [...par(name).querySelectorAll('track')].map(t => Object.fromEntries(keys.map(k => [k, num(t, k)])));
      const lifeKeys = ['life', 'speed', 'gravity', 'scale', 'rotspeed', 'r', 'g', 'b', 'a'];
      return { duration: num(em, 'life'), image: img.getAttribute('file').replace(/\.png$/, ''), add: img.getAttribute('blend') === 'add', size: [num(img, 'width'), num(img, 'height')],
        life: range('life'), angle: range('angle'), speed: range('speed'), gravity: range('gravity'), scale: range('scale'), rotspeed: range('rotspeed'),
        r: range('r'), g: range('g'), b: range('b'), a: range('a'), timetrack: tracks('timetrack', ['time', 'quantity']), lifetrack: tracks('lifetrack', lifeKeys) };
    });
    return { emitters };
  })();
  cache.set(file, p); return p;
}

export class Particles {
  constructor(camera) { this.cam = camera; this.active = []; this.list = []; this.tints = new Map(); this.atlas = null; E.atlas('eff').then(a => { this.atlas = a; }); }

  // start an effect at a map position
  async fire(file, x, y) {
    const fx = await loadEffect(file);
    for (const em of fx.emitters) this.active.push({ em, x, y, t: 0, carry: 0 });
  }

  update(dt) {
    for (const e of this.active) {                                          // emitters
      const em = e.em, t0 = e.t; e.t += dt;
      const from = Math.min(t0, em.duration), to = Math.min(e.t, em.duration);
      if (to > from) {
        e.carry += lerpTrack(em.timetrack, 'time', (from + to) / 2, 'quantity') * (to - from);
        while (e.carry >= 1) { e.carry -= 1; this.spawn(e); }
      }
    }
    this.active = this.active.filter(e => e.t < e.em.duration);
    for (const p of this.list) {                                            // particles
      p.age += dt;
      const k = Math.min(1, p.age / p.life), lt = p.em.lifetrack, m = prop => lerpTrack(lt, 'life', k, prop);
      const sp = p.speed * m('speed'), ax = Math.cos(p.angle), ay = Math.sin(p.angle);
      p.vy += p.gravity * m('gravity') * GRAVITY_SCALE * dt;
      p.x += ax * sp * dt; p.y += ay * sp * dt + p.vy * dt;
      p.rot += p.rotspeed * m('rotspeed') * ROT_SCALE * dt;
    }
    this.list = this.list.filter(p => p.age < p.life);
  }
  spawn(e) {
    const em = e.em, r = rnd(...em.r), g = rnd(...em.g), b = rnd(...em.b);
    this.list.push({ em, x: e.x, y: e.y, ox: e.x, oy: e.y, vy: 0, age: 0, life: rnd(...em.life), angle: rnd(...em.angle) * Math.PI / 180, rot: rnd(0, 360) * Math.PI / 180,
      speed: rnd(...em.speed), gravity: rnd(...em.gravity), scale: rnd(...em.scale), rotspeed: rnd(...em.rotspeed), r, g, b, a: rnd(...em.a) });
  }

  // the sprite multiplied by an (r, g, b) colour, cached with 4 bits per channel
  tinted(f, r, g, b) {
    const q = v => Math.max(0, Math.min(15, Math.round(v / 17))), key = `${f.x},${f.y}|${q(r)},${q(g)},${q(b)}`;
    let cv = this.tints.get(key); if (cv) return cv;
    cv = document.createElement('canvas'); cv.width = f.w; cv.height = f.h; const g2 = cv.getContext('2d');
    g2.drawImage(f.img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    g2.globalCompositeOperation = 'multiply'; g2.fillStyle = `rgb(${q(r) * 17},${q(g) * 17},${q(b) * 17})`; g2.fillRect(0, 0, f.w, f.h);
    g2.globalCompositeOperation = 'destination-in'; g2.drawImage(f.img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    this.tints.set(key, cv); return cv;
  }

  // draws in map units (the camera transform is applied here)
  draw(c) {
    if (!this.list.length || !this.atlas) return;
    const cam = this.cam;
    // one save/restore round the whole burst in BOTH views: each particle sets globalAlpha / 'lighter' outside its own save, so without this the
    // last particle's alpha and additive blending leaked into everything drawn after it - in 3D the HUD corners flickered with every frame
    c.save(); if (!cam.tilt) cam.apply(c);
    for (const p of this.list) {
      const f = this.atlas[p.em.image]; if (!f) continue;
      const k = Math.min(1, p.age / p.life), lt = p.em.lifetrack, m = prop => lerpTrack(lt, 'life', k, prop);
      const tone = p.em.add ? smokeTone().glow : smokeTone().smoke, isFire = p.em.add && p.em.image === 'cloud' && p.r > 240;   // the bright orange flash keeps its strength
      const fire = Math.max(0, Math.min(1, E.state.fire ?? 1));                                 // Options > 火光: 0 = no flash, 1 = original
      const alpha = Math.max(0, Math.min(1, p.a / 255 * m('a') * (isFire ? fire : tone.alpha))), s = p.scale * m('scale') * (isFire ? 0.5 + 0.5 * fire : tone.scale); if (alpha <= 0 || s <= 0) continue;
      const w = p.em.size[0] * s, h = p.em.size[1] * s;
      c.globalAlpha = alpha; c.globalCompositeOperation = (p.em.add && !E.exp('nolighter')) ? 'lighter' : 'source-over';
      c.save();
      let sk = 1;
      if (cam.tilt) {                                                    // tilt view: the burst is a billboard standing at the emitter, drawn at the perspective scale there
        const o = cam.toScreen(p.ox, p.oy); sk = cam.scaleAt(p.ox, p.oy);
        c.translate(o.x + (p.x - p.ox) * sk, o.y + (p.y - p.oy) * sk - 20 * sk);
      } else c.translate(p.x, p.y);
      c.rotate(p.rot);
      if (E.exp('notint')) c.drawImage(f.img, f.x, f.y, f.w, f.h, -w * sk / 2, -h * sk / 2, w * sk, h * sk);   // A/B: skip the per-colour tinted canvas
      else c.drawImage(this.tinted(f, p.r * m('r'), p.g * m('g'), p.b * m('b')), -w * sk / 2, -h * sk / 2, w * sk, h * sk);
      c.restore();
    }
    c.restore();
  }
}
