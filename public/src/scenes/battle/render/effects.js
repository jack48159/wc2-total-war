// Turns game events into what you see and hear: floating damage numbers and sound effects.
// The rules only emit events (game/events.js); nothing in game/ knows this file exists.
import { E } from '../../../core/index.js';
import { World } from '../../../game/world.js';
import { EV } from '../../../game/events.js';
import { Particles, loadEffect } from './particles.js';

// Non-animated battle result, as in the original CFight::RenderAttackResults: for every side that took damage an explosion
// (effect_exp.xml) goes off at its army position and a red "-N" rises from 30 map units above it, fading out over 2 seconds
// (CFightText: alpha -0.5 per second); the explosion sound follows. The rise speed of the original is not known (~22 units/s).
const NAVAL = new Set(['cruiser', 'destroyer', 'battleship', 'aircraftcarrier']);
const pickOf = (...names) => names[Math.floor(Math.random() * names.length)];
const SFX_PRELOAD = ['sfx/bomb_1.mp3', 'sfx/bomb_2.mp3', 'sfx/bomb_3.mp3', 'sfx/nuke.mp3', 'sfx/art_1.mp3', 'sfx/art_2.mp3', 'sfx/tank_1.mp3', 'sfx/tank_2.mp3', 'sfx/heavy_1.mp3',
  'sfx/lightarm_1.mp3', 'sfx/mg_1.mp3', 'sfx/rocket_1.mp3', 'sfx/naval_1.mp3', 'sfx/naval_2.mp3', 'sfx/airfire_1.mp3', 'buff.wav', 'supply.wav', 'commander_lvup.wav', 'unlocked.wav', 'lvup.wav', 'celebrate.wav'];
// 卡片音效：建造类 build；伞兵 飞机；战术 buff；指挥官 commander_lvup；补给 supply；晋升 lvup；研发 unlocked
const CARD_SFX = id => id >= 14 && id <= 20 ? 'build.wav' : id === 12 ? 'sfx/airfire_1.mp3' : (id >= 22 && id <= 24) ? 'buff.wav' : id === 25 ? 'commander_lvup.wav' : id === 26 ? 'supply.wav' : id === 27 ? 'lvup.wav' : id === 21 ? 'unlocked.wav' : null;
// 按攻击方兵种选开火声(优先钢铁雄心音效)
function attackSfx(game, ev) {
  const t = ev.attackerType || '', cls = game.armyTypes?.[t]?.attackClass;
  if (t === 'battleship' || t === 'aircraftcarrier') return 'sfx/naval_2.mp3';
  if (NAVAL.has(t)) return 'sfx/naval_1.mp3';
  if (cls === 'air' || ev.kind === 'carrierAirStrike') return pickOf('sfx/bomb_1.mp3', 'sfx/bomb_2.mp3', 'sfx/bomb_3.mp3');
  if (cls === 'rocket') return 'sfx/rocket_1.mp3';
  if (cls === 'artillery') return pickOf('sfx/art_1.mp3', 'sfx/art_2.mp3');
  if (/infantry/.test(t)) return 'sfx/mg_1.mp3';
  if (/panzer|car/.test(t)) return 'sfx/lightarm_1.mp3';
  if (/heavy/.test(t)) return 'sfx/heavy_1.mp3';
  return pickOf('sfx/tank_1.mp3', 'sfx/tank_2.mp3');
}
const FLOAT_LIFE = 2, RISE = 22, FONT_UNITS = 15, TEXT_OFFSET = 30;

export class Effects {
  constructor(game, camera, { onCaptured }) {
    this.cam = camera; this.floats = []; this.onCaptured = onCaptured; this.particles = new Particles(camera);
    loadEffect('effect_exp.xml').catch(() => {});                          // parse the explosion effect now, not in the middle of the first fight
    E.preloadSfx(['btn.wav', 'pop.wav', 'select.wav', 'cancel.wav', 'exp.wav', 'move.wav', 'ship.wav', 'draft.wav', 'build.wav', 'occupy.wav', 'buy.wav']);
    game.on(EV.UNIT_MOVED, ev => E.playSfx(NAVAL.has(ev.armyType) ? 'ship.wav' : 'move.wav'));
    game.on(EV.UNIT_DEPLOYED, () => E.playSfx('draft.wav'));
    game.on(EV.CARD_USED, ev => { const sfx = CARD_SFX(ev.card); if (sfx) E.playSfx(sfx); });
    E.preloadSfx(SFX_PRELOAD);
    game.on(EV.UNIT_ATTACKED, ev => {
      this.hit(ev.to, ev.damage, 0);
      if (ev.counter > 0) this.hit(ev.from, ev.counter, 0);
      E.playSfx(attackSfx(game, ev));              // 按兵种放开火声(钢铁雄心音效)，再叠一声命中爆炸
      setTimeout(() => E.playSfx('exp.wav'), 160);
    });
    game.on(EV.AIR_STRIKE, ev => E.playSfx(ev.card === 13 ? 'sfx/nuke.mp3' : `sfx/bomb_${1 + Math.floor(Math.random() * 3)}.mp3`));
    game.on(EV.UNIT_PROMOTED, () => E.playSfx('lvup.wav'));
    game.on(EV.GAME_OVER, ev => { if (ev.result === 'victory' || ev.result === 'greatVictory') E.playSfx('celebrate.wav'); });
    game.on(EV.AREA_CAPTURED, ev => { E.playSfx('occupy.wav'); this.onCaptured(ev); });
  }
  // explosion + damage number over an area's army position
  hit(area, damage, delay) {
    if (damage <= 0) return;
    const p = World.areas[area].pts[0];
    this.particles.fire('effect_exp.xml', p[0], p[1]);
    this.floats.push({ x: p[0], y: p[1] - TEXT_OFFSET, text: `-${damage}`, t: -delay });
  }
  update(dt) {
    this.particles.update(dt);
    for (const f of this.floats) f.t += dt;
    this.floats = this.floats.filter(f => f.t < FLOAT_LIFE);
  }
  draw(c, showDamage = true) {
    if (!E.exp('noparticles')) this.particles.draw(c);
    if (!showDamage || E.exp('nofloats')) return;
    for (const f of this.floats) {
      if (f.t < 0) continue;
      const gy = f.y + TEXT_OFFSET, k = this.cam.scaleAt(f.x, gy), b = this.cam.toScreen(f.x, gy), s = { x: b.x, y: b.y - (TEXT_OFFSET + f.t * RISE) * k }, alpha = 1 - f.t / FLOAT_LIFE;   // k: px per map unit at the unit (perspective-aware)
      c.save(); c.globalAlpha = Math.max(0, alpha);
      E.text(f.text, s.x, s.y, { size: FONT_UNITS * k, bold: true, align: 'center', color: '#ff2a1a', stroke: '#3a0000', strokeW: Math.max(3, k * 2), font: E.NUM });
      c.restore();
    }
  }
}
