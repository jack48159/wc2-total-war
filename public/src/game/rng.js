// Seeded random numbers. ALL randomness in the rules (dice, card draws, AI tie-breaks) must come from game.rng so that a
// game can be replayed from (stage, seed, command log) and saved / restored exactly. Never call Math.random() in game/.
export class Rng {
  constructor(seed = (Date.now() ^ 0x9e3779b9) >>> 0) { this.state = seed >>> 0; this.seed = this.state; }
  // mulberry32: returns a float in [0, 1)
  next() {
    let t = (this.state += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n) { return Math.floor(this.next() * n); }            // 0 .. n-1
  chance(p) { return this.next() < p; }
  dice(sides = 6) { return 1 + this.int(sides); }
  pick(list) { return list[this.int(list.length)]; }
  save() { return { seed: this.seed, state: this.state }; }
  static restore(o) { const r = new Rng(o.seed); r.state = o.state; return r; }
}
