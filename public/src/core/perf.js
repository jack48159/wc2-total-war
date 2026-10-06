// Performance monitor. Cheap enough to leave on. It answers "what is slow": JS (update / draw / an event handler) or the browser / GPU (the
// time between frames that is NOT our JS).
//   frame(t, updMs, drawMs)  called by the main loop every frame with the rAF timestamp
//   time(name, fn)           wraps an input event handler
//   mark(name, ms)           parts of a frame (the battle scene marks ground / accessories / units)
// Slow frames (interval > SLOW_MS) are recorded with their breakdown; every few seconds the report is POSTed to /api/perf, which writes
// data/perf_report.json. Press P in a battle for the on-screen panel.
import { E } from './kernel.js';

const SLOW_MS = 34, KEEP = 60, SAMPLES = 400;

export const Perf = {
  enabled: true, last: 0, intervals: [], slow: [], events: [], longTasks: [], parts: {}, evMs: 0, evCount: 0, frameNo: 0, counters: {},
  extra: null,                       // () => object with scene specific info (mode, gpu, repaint counters), set by the scene

  mark(name, ms) { this.parts[name] = (this.parts[name] || 0) + ms; },
  count(name, n = 1) { this.counters[name] = (this.counters[name] || 0) + n; },

  time(name, fn) {
    const t0 = performance.now();
    try { return fn(); } finally {
      const ms = performance.now() - t0; this.evMs += ms; this.evCount++;
      if (ms > 6) { this.events.push({ at: Math.round(t0), name, ms: +ms.toFixed(1) }); if (this.events.length > KEEP) this.events.shift(); }
    }
  },

  frame(t, updMs, drawMs) {
    if (!this.enabled) return;
    const dt = this.last ? t - this.last : 0; this.last = t; this.frameNo++;
    // rAF timestamps bracket the PREVIOUS frame's JS, not the frame whose
    // draw just finished. Attribute slow intervals to that previous work.
    const current = { js: updMs + drawMs, upd: updMs, draw: drawMs,
      parts: Object.fromEntries(Object.entries(this.parts).map(([k, v]) => [k, +v.toFixed(1)])) };
    if (dt > 0 && dt < 1000) {
      this.intervals.push(dt); if (this.intervals.length > SAMPLES) this.intervals.shift();
      const prior = this.previous || current;
      const wait = Math.max(0, dt - prior.js - this.evMs);
      if (dt > SLOW_MS) {
        this.slow.push({ frame: this.frameNo - 1, at: Math.round(t), interval: +dt.toFixed(1), js: +prior.js.toFixed(1), upd: +prior.upd.toFixed(1), draw: +prior.draw.toFixed(1),
          events: +this.evMs.toFixed(1), eventCount: this.evCount, otherWait: +wait.toFixed(1),
          parts: prior.parts, ...(this.extra ? this.extra() : {}) });
        if (this.slow.length > KEEP) this.slow.shift();
        this.dirty = true;
      }
    }
    this.previous = current;
    this.parts = {}; this.evMs = 0; this.evCount = 0;
    if (!this.timer && this.dirty && t - (this.sent || 0) > 4000) this.send(t);
  },

  stats() {
    const a = [...this.intervals].sort((x, y) => x - y), q = p => a.length ? +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(1) : 0;
    const mean = a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
    return { fps: mean ? +(1000 / mean).toFixed(1) : 0, p50: q(0.5), p95: q(0.95), max: a.length ? +a[a.length - 1].toFixed(1) : 0, frames: this.frameNo };
  },

  report() {
    const w = window, cv = E.cv;
    return {
      time: new Date().toISOString(), ua: navigator.userAgent, dpr: w.devicePixelRatio, inner: `${w.innerWidth}x${w.innerHeight}`, canvas: cv ? `${cv.width}x${cv.height}` : '',
      cores: navigator.hardwareConcurrency, memoryGB: navigator.deviceMemory, stats: this.stats(), counters: this.counters,
      scene: this.extra ? this.extra() : {}, slowFrames: this.slow.slice(-40), slowEvents: this.events.slice(-40), longTasks: this.longTasks.slice(-20),
    };
  },

  send(t) {
    this.sent = t; this.dirty = false;
    if (window.WC2_CONFIG?.staticWeb) return;
    try { fetch('/api/perf', { method: 'POST', body: JSON.stringify(this.report()) }).catch(() => {}); } catch (e) {}
  },
};

// main-thread blocks > 50 ms (from the browser, so it also catches work that is not ours, e.g. GC or image decoding)
try {
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) { Perf.longTasks.push({ at: Math.round(e.startTime), ms: +e.duration.toFixed(1) }); if (Perf.longTasks.length > KEEP) Perf.longTasks.shift(); Perf.dirty = true; }
  }).observe({ entryTypes: ['longtask'] });
} catch (e) {}

E.perf = Perf;
