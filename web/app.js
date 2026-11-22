/* Hoop Score: calm scoring feedback.
 * Design rule: nothing ever plays louder, longer, or more intensely than the caregiver set,
 * and nothing plays unless a score event (or a caregiver preview) asked for it. */
'use strict';
(function () {
  // ------------------------------------------------------------------ helpers
  const $ = (s, r) => (r || document).querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, d) => { const n = Number(v); return v === '' || v === null || !Number.isFinite(n) ? d : n; };
  const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function hexA(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    const n = m ? parseInt(m[1], 16) : 0x7aa2d6;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function seeded(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

  const params = new URLSearchParams(location.search);
  const DEMO = params.has('demo');
  // HOSTED: running from an https web link (GitHub Pages, or the Claude demo link). It can never reach the
  // ESP32 hoop (that is plain http), so the only real hoop it can use is a micro:bit over Bluetooth.
  const HOSTED = location.protocol === 'https:' && !params.get('ws');
  const FAKE = DEMO || params.has('fake') || location.protocol === 'file:';
  const NO_WS = HOSTED && !FAKE; // no Wi-Fi hoop and no fake hoop: wait for a micro:bit
  const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IN_FRAME = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  // Web Bluetooth: Chrome/Edge on Android and computers, and the Bluefy browser on iPhone/iPad. Needs https.
  const BLE_OK = !!(navigator.bluetooth && window.isSecureContext && !IN_FRAME);
  const WS_URL = 'ws://' + (params.get('ws') || location.host) + '/ws';
  const reducedMotion = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const CAN_VIBRATE = typeof navigator.vibrate === 'function';
  const CAN_RECORD = !IN_FRAME && !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

  // ------------------------------------------------------------------ constants
  const COLORS = ['#7aa2d6', '#8fbf9f', '#e3b778', '#c9a0dc', '#e8a598', '#9fd3d0', '#f0d58c', '#b8c4d6'];
  const BG_COLORS = ['#1f2a44', '#24343a', '#2d2a3e', '#1e3a34', '#3a2f2a', '#15181d', '#e9e4da', '#dfe7ef'];
  // group: shown as a heading in caregiver mode. note: one-line description.
  const ANIMS = [
    { id: 'glow', name: 'Soft glow', group: 'Very calm', note: 'Screen gently brightens from the middle, then fades' },
    { id: 'fade', name: 'Gentle fade', group: 'Very calm', note: 'The whole screen softly tints with color and back' },
    { id: 'ripple', name: 'Ripples', group: 'Very calm', note: 'Three soft rings spread out like a pebble in water' },
    { id: 'sunrise', name: 'Sunrise', group: 'Very calm', note: 'A warm sun slowly rises from the bottom' },
    { id: 'wave', name: 'Wave', group: 'Very calm', note: 'A soft wave rolls up the screen and back down' },
    { id: 'check', name: 'Big check', group: 'Shapes', note: 'A rounded checkmark draws itself in' },
    { id: 'heart', name: 'Heart', group: 'Shapes', note: 'A heart grows a little and settles' },
    { id: 'smile', name: 'Smiley face', group: 'Shapes', note: 'A friendly face draws itself' },
    { id: 'fill', name: 'Fill up', group: 'Shapes', note: 'A circle fills with color from the bottom' },
    { id: 'count', name: 'Number count', group: 'Shapes', note: 'Shows the score number, grows slightly and settles' },
    { id: 'stars', name: 'Floating stars', group: 'Playful (still gentle)', note: 'Stars drift slowly upward and fade' },
    { id: 'bubbles', name: 'Bubbles', group: 'Playful (still gentle)', note: 'Round bubbles float up with a little sway' },
    { id: 'confetti', name: 'Slow confetti', group: 'Playful (still gentle)', note: 'Soft paper pieces drift down slowly' },
    { id: 'orbit', name: 'Orbit', group: 'Playful (still gentle)', note: 'A ring of dots turns slowly around the middle' },
    { id: 'rainbow', name: 'Rainbow', group: 'Playful (still gentle)', note: 'Soft rainbow arcs draw in (uses its own muted colors)' },
  ];
  const BUILTIN = [
    { id: 'chime', name: 'Soft chime', group: 'Soft tones', note: 'One clear, quiet bell note', tag: 'default' },
    { id: 'bell', name: 'Temple bell', group: 'Soft tones', note: 'Low, warm bell that rings out slowly' },
    { id: 'musicbox', name: 'Music box', group: 'Soft tones', note: 'Three tiny high notes' },
    { id: 'pad', name: 'Warm chord', group: 'Soft tones', note: 'A happy chord that swells in and out' },
    { id: 'hum', name: 'Low hum swell', group: 'Soft tones', note: 'Deep, smooth hum. No sharp start at all' },
    { id: 'rise', name: 'Gentle two-note rise', group: 'Musical', note: 'Two notes going up: "you did it"' },
    { id: 'arpeggio', name: 'Marimba steps', group: 'Musical', note: 'Three wooden notes stepping up' },
    { id: 'harp', name: 'Harp sweep', group: 'Musical', note: 'Quick soft strum upward' },
    { id: 'kalimba', name: 'Thumb piano', group: 'Musical', note: 'Two plucky kalimba notes' },
    { id: 'tap', name: 'Wooden tap', group: 'Musical', note: 'One soft wooden knock' },
    { id: 'wind', name: 'Wind whoosh', group: 'Nature', note: 'Soft breeze passing by' },
    { id: 'ocean', name: 'Ocean wave', group: 'Nature', note: 'A slow wave washing in and out' },
    { id: 'rainstick', name: 'Rain stick', group: 'Nature', note: 'Gentle trickle of rain' },
    { id: 'bubble', name: 'Bubble pops', group: 'Nature', note: 'Two soft little bubble sounds' },
  ];
  const PROFILE_KEYS = ['animation', 'color', 'speed', 'duration', 'sound', 'volume', 'fadeIn', 'bg', 'showCounter', 'vibrate'];
  const DEFAULTS = {
    animation: 'glow', color: '#7aa2d6', speed: 'slow', duration: 2.5,
    sound: 'chime', volume: 40, maxVolume: 60, fadeIn: true,
    bg: '#1f2a44', showCounter: false, vibrate: false,
    pinEnabled: false, pin: '', score: 0, profiles: {},
    sensor: { dropCm: 15, minHoldMs: 40, cooldownMs: 2000 },
  };

  // ------------------------------------------------------------------ settings (localStorage)
  let S = loadSettings();
  function loadSettings() {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem('hoopSettings') || '{}') || {}; } catch (e) { raw = {}; }
    return sanitize(Object.assign({}, DEFAULTS, raw));
  }
  function sanitize(s) {
    if (!ANIMS.some((a) => a.id === s.animation)) s.animation = 'glow';
    if (!/^#[0-9a-f]{6}$/i.test(s.color)) s.color = DEFAULTS.color;
    if (!/^#[0-9a-f]{6}$/i.test(s.bg)) s.bg = DEFAULTS.bg;
    if (s.speed !== 'slow' && s.speed !== 'medium') s.speed = 'slow';
    s.duration = clamp(num(s.duration, 2.5), 1, 5);
    s.maxVolume = clamp(Math.round(num(s.maxVolume, 60)), 0, 100);
    s.volume = clamp(Math.round(num(s.volume, 40)), 0, s.maxVolume);
    s.fadeIn = s.fadeIn !== false;
    s.showCounter = !!s.showCounter;
    s.vibrate = !!s.vibrate && CAN_VIBRATE;
    s.score = Math.max(0, Math.round(num(s.score, 0)));
    s.pin = String(s.pin || '').replace(/\D/g, '').slice(0, 4);
    s.pinEnabled = !!s.pinEnabled;
    if (typeof s.sound !== 'string') s.sound = 'none';
    if (!s.profiles || typeof s.profiles !== 'object') s.profiles = {};
    s.sensor = Object.assign({}, DEFAULTS.sensor, s.sensor || {});
    return s;
  }
  function save() { try { localStorage.setItem('hoopSettings', JSON.stringify(S)); } catch (e) { /* storage full or blocked */ } }

  // ------------------------------------------------------------------ IndexedDB (custom sounds)
  const DB = (() => {
    let p = null;
    function open() {
      if (!p) p = new Promise((res, rej) => {
        const r = indexedDB.open('hoopScore', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('sounds', { keyPath: 'id' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return p;
    }
    async function tx(mode, fn) {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction('sounds', mode);
        const req = fn(t.objectStore('sounds'));
        t.oncomplete = () => res(req ? req.result : undefined);
        t.onerror = () => rej(t.error);
      });
    }
    return {
      all: () => tx('readonly', (s) => s.getAll()).catch(() => []),
      get: (id) => tx('readonly', (s) => s.get(id)).catch(() => null),
      put: (rec) => tx('readwrite', (s) => s.put(rec)),
      del: (id) => tx('readwrite', (s) => s.delete(id)),
    };
  })();

  // ------------------------------------------------------------------ sound engine
  // Every sound: source -> per-sound envelope -> ONE master GainNode (clamped volume) -> limiter -> speakers.
  function tone(ctx, out, freq, t, peak, attack, decay, type) {
    const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + attack + decay + 0.05);
  }
  function noiseBuffer(ctx, secs) {
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * secs), ctx.sampleRate);
    const d = b.getChannelData(0); const rnd = seeded(42);
    for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
    return b;
  }
  const SYNTHS = {
    chime(ctx, out, t) {
      tone(ctx, out, 880, t, 0.42, 0.02, 1.8);
      tone(ctx, out, 1320, t, 0.14, 0.02, 1.2);
      tone(ctx, out, 1760, t, 0.05, 0.02, 0.8);
      return 1.9;
    },
    tap(ctx, out, t) { // soft marimba-like wood knock
      tone(ctx, out, 392, t, 0.55, 0.008, 0.55);
      tone(ctx, out, 784, t, 0.08, 0.006, 0.2);
      tone(ctx, out, 1568, t, 0.06, 0.004, 0.08);
      return 0.65;
    },
    hum(ctx, out, t) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.34, t + 0.9);
      g.gain.setValueAtTime(0.34, t + 1.2);
      g.gain.linearRampToValueAtTime(0, t + 2.4);
      g.connect(out);
      [[196, 0.5], [294, 0.3], [392, 0.12]].forEach(([f, a]) => {
        const o = ctx.createOscillator(); o.frequency.value = f;
        const ag = ctx.createGain(); ag.gain.value = a;
        o.connect(ag); ag.connect(g); o.start(t); o.stop(t + 2.45);
      });
      return 2.5;
    },
    rise(ctx, out, t) {
      tone(ctx, out, 523.25, t, 0.38, 0.04, 0.9);
      tone(ctx, out, 659.25, t + 0.45, 0.38, 0.04, 1.0);
      return 1.6;
    },
    wind(ctx, out, t) {
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 2.3);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(1100, t + 0.9);
      bp.frequency.exponentialRampToValueAtTime(450, t + 2.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.9, t + 0.8);
      g.gain.linearRampToValueAtTime(0, t + 2.1);
      src.connect(bp); bp.connect(g); g.connect(out);
      src.start(t); src.stop(t + 2.2);
      return 2.2;
    },
    bell(ctx, out, t) { // inharmonic partials = bell
      [[1, 0.32, 2.6], [2, 0.12, 1.8], [2.76, 0.08, 1.2], [5.4, 0.03, 0.6]].forEach(([r, a, d]) => tone(ctx, out, 262 * r, t, a, 0.012, d));
      return 2.7;
    },
    musicbox(ctx, out, t) {
      [1046.5, 1318.5, 1568].forEach((f, i) => {
        tone(ctx, out, f, t + i * 0.22, 0.16, 0.008, 1.1);
        tone(ctx, out, f * 2, t + i * 0.22, 0.03, 0.005, 0.3);
      });
      return 1.8;
    },
    pad(ctx, out, t) { // C major chord, slightly detuned pairs for warmth
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.8);
      g.gain.setValueAtTime(0.3, t + 1.3);
      g.gain.linearRampToValueAtTime(0, t + 2.6);
      g.connect(out);
      [261.63, 329.63, 392].forEach((f) => [-3, 3].forEach((cents) => {
        const o = ctx.createOscillator(); o.frequency.value = f; o.detune.value = cents;
        const a = ctx.createGain(); a.gain.value = 0.16;
        o.connect(a); a.connect(g); o.start(t); o.stop(t + 2.65);
      }));
      return 2.7;
    },
    arpeggio(ctx, out, t) {
      [523.25, 659.25, 783.99].forEach((f, i) => {
        tone(ctx, out, f, t + i * 0.18, 0.32, 0.008, 0.7);
        tone(ctx, out, f * 4, t + i * 0.18, 0.04, 0.004, 0.08);
      });
      return 1.3;
    },
    harp(ctx, out, t) { // C pentatonic strum
      [523.25, 587.33, 659.25, 783.99, 880, 1046.5].forEach((f, i) => tone(ctx, out, f, t + i * 0.07, 0.15, 0.006, 0.9, 'triangle'));
      return 1.4;
    },
    kalimba(ctx, out, t) {
      [[587.33, 0], [880, 0.26]].forEach(([f, dt]) => {
        tone(ctx, out, f, t + dt, 0.38, 0.005, 0.65);
        tone(ctx, out, f * 5.9, t + dt, 0.025, 0.003, 0.08);
      });
      return 1.0;
    },
    ocean(ctx, out, t) {
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 3.4);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
      lp.frequency.setValueAtTime(400, t);
      lp.frequency.exponentialRampToValueAtTime(1000, t + 1.4);
      lp.frequency.exponentialRampToValueAtTime(350, t + 3.2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.75, t + 1.4);
      g.gain.linearRampToValueAtTime(0, t + 3.2);
      src.connect(lp); lp.connect(g); g.connect(out);
      src.start(t); src.stop(t + 3.3);
      return 3.3;
    },
    rainstick(ctx, out, t) {
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 2.2);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.9;
      const g = ctx.createGain();
      const n = 160, curve = new Float32Array(n), rnd = seeded(5);
      for (let i = 0; i < n; i++) {
        const env = Math.sin(Math.PI * i / (n - 1)); // swell in, swell out
        curve[i] = 0.55 * env * (0.35 + 0.65 * rnd()); // grainy trickle
      }
      g.gain.setValueCurveAtTime(curve, t, 2.0);
      src.connect(bp); bp.connect(g); g.connect(out);
      src.start(t); src.stop(t + 2.1);
      return 2.1;
    },
    bubble(ctx, out, t) {
      [[320, 900, 0], [420, 1150, 0.22]].forEach(([f0, f1, dt]) => {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(f0, t + dt);
        o.frequency.exponentialRampToValueAtTime(f1, t + dt + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + dt);
        g.gain.exponentialRampToValueAtTime(0.3, t + dt + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.25);
        o.connect(g); g.connect(out); o.start(t + dt); o.stop(t + dt + 0.3);
      });
      return 0.6;
    },
  };

  const Sound = {
    ctx: null, master: null, current: null, cache: new Map(),
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* iOS 17+ only */ }
        const ctx = new AC();
        const master = ctx.createGain();
        master.gain.value = this.level();
        const limiter = ctx.createDynamicsCompressor(); // safety net: catches any unexpected peaks
        limiter.threshold.value = -10; limiter.knee.value = 0; limiter.ratio.value = 20;
        limiter.attack.value = 0.002; limiter.release.value = 0.2;
        master.connect(limiter); limiter.connect(ctx.destination);
        // silent buffer: unlocks audio on iOS
        const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0);
        this.ctx = ctx; this.master = master;
      }
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      return this.ctx;
    },
    // Perceptual taper. Always clamped by the caregiver's ceiling.
    level() { const v = Math.min(S.volume, S.maxVolume) / 100; return v * v; },
    applyVolume() { if (this.master) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.05); },
    stopCurrent() {
      const c = this.current; if (!c) return;
      this.current = null;
      const t = this.ctx.currentTime;
      try { c.env.gain.cancelScheduledValues(t); c.env.gain.setValueAtTime(c.env.gain.value, t); c.env.gain.linearRampToValueAtTime(0, t + 0.12); } catch (e) {}
      setTimeout(() => { try { c.env.disconnect(); } catch (e) {} }, 250);
    },
    async decode(buf) {
      const ctx = this.ensure();
      return new Promise((res, rej) => ctx.decodeAudioData(buf.slice(0), res, rej));
    },
    analyse(buffer) {
      let peak = 0;
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const d = buffer.getChannelData(c);
        for (let i = 0; i < d.length; i += 2) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
      }
      return { buffer, norm: Math.min(3, 0.8 / Math.max(peak, 1e-4)) }; // level every file to the same peak
    },
    async loadCustom(id) {
      if (this.cache.has(id)) return this.cache.get(id);
      const rec = await DB.get(id);
      if (!rec) return null;
      try { const e = this.analyse(await this.decode(rec.data)); this.cache.set(id, e); return e; } catch (e) { return null; }
    },
    /** Plays once. Resolves when finished (timer-based, so it never hangs). */
    async play(id) {
      if (!id || id === 'none') return;
      const ctx = this.ensure(); if (!ctx) return;
      let custom = null;
      if (!SYNTHS[id]) { custom = await this.loadCustom(id); if (!custom) return; }
      this.stopCurrent(); // never overlap
      const now = ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.level(), now);
      const env = ctx.createGain(); env.connect(this.master);
      const t = now + 0.03;
      env.gain.setValueAtTime(0, now);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + (S.fadeIn ? 0.15 : 0.01));
      let dur;
      if (custom) {
        const src = ctx.createBufferSource(); src.buffer = custom.buffer;
        const g = ctx.createGain(); g.gain.value = custom.norm;
        src.connect(g); g.connect(env);
        dur = Math.min(custom.buffer.duration, 10);
        const fo = Math.max(t + 0.16, t + dur - 0.08);
        env.gain.setValueAtTime(1, fo);
        env.gain.linearRampToValueAtTime(0, Math.max(fo + 0.02, t + dur));
        src.start(t); src.stop(t + dur + 0.05);
      } else {
        dur = SYNTHS[id](ctx, env, t);
      }
      const me = { env }; this.current = me;
      await sleep(dur * 1000 + 100);
      if (this.current === me) { this.current = null; setTimeout(() => { try { env.disconnect(); } catch (e) {} }, 300); }
    },
  };

  // ------------------------------------------------------------------ animations
  // Rules: one brightness rise + fall per score (well under 3 changes/second), eased everywhere.
  const FX = $('#fx');
  const EASE = 'cubic-bezier(0.45, 0, 0.55, 1)';
  const eased = (frames) => frames.map((f) => Object.assign({ easing: EASE }, f));
  function run(el, frames, opts) {
    try { return el.animate(eased(frames), Object.assign({ fill: 'both' }, opts)).finished; }
    catch (e) { return sleep((opts.duration || 0) + (opts.delay || 0)); }
  }
  function mk(tag, cls, parent) { const e = document.createElement(tag); if (cls) e.className = cls; parent.appendChild(e); return e; }

  function drawIn(path, dur, endOffset) { // stroke draws itself in
    const L = path.getTotalLength ? path.getTotalLength() : 100;
    path.style.strokeDasharray = L; path.style.strokeDashoffset = L;
    return run(path, [{ strokeDashoffset: L }, { strokeDashoffset: 0, offset: Math.min(0.9, endOffset) }, { strokeDashoffset: 0 }], { duration: dur });
  }

  function playAnimation(kind, o) {
    const dur = Math.round(clamp(o.duration, 1, 5) * 1000);
    const peak = o.speed === 'medium' ? 0.32 : 0.5;
    const c = o.color;
    if (reducedMotion.matches) kind = 'fade';
    const root = mk('div', 'fx-run', FX);
    const done = [];
    switch (kind) {
      case 'glow': {
        const el = mk('div', 'fx-glow', root);
        el.style.background = `radial-gradient(circle at 50% 50%, ${hexA(c, 1)} 0%, ${hexA(c, 0.5)} 28%, ${hexA(c, 0)} 68%)`;
        done.push(run(el, [
          { opacity: 0, transform: 'scale(0.6)' },
          { opacity: 0.9, transform: 'scale(1.05)', offset: peak },
          { opacity: 0, transform: 'scale(1.2)' },
        ], { duration: dur }));
        break;
      }
      case 'stars': {
        const rnd = seeded(11); // same calm pattern every time: predictable
        for (let i = 0; i < 14; i++) {
          const s = mk('div', 'fx-star', root);
          const size = 20 + rnd() * 26;
          s.style.cssText = `left:${6 + rnd() * 84}%;bottom:${6 + rnd() * 28}%;width:${size}px;height:${size}px;background:${c}`;
          const delay = rnd() * dur * 0.25;
          const rise = 22 + rnd() * 20;
          done.push(run(s, [
            { opacity: 0, transform: 'translateY(0) scale(0.7)' },
            { opacity: 0.95, transform: `translateY(-${(rise * 0.4).toFixed(1)}vh) scale(1)`, offset: peak * 0.8 },
            { opacity: 0, transform: `translateY(-${rise.toFixed(1)}vh) scale(0.9)` },
          ], { duration: dur - delay, delay }));
        }
        break;
      }
      case 'fill': {
        const w = mk('div', 'fx-fill', root); w.style.borderColor = hexA(c, 0.6);
        const inner = mk('div', 'fx-fill-in', w); inner.style.background = c;
        done.push(run(w, [
          { opacity: 0, transform: 'scale(0.96)' },
          { opacity: 1, transform: 'scale(1)', offset: 0.12 },
          { opacity: 1, transform: 'scale(1)', offset: 0.78 },
          { opacity: 0, transform: 'scale(1.02)' },
        ], { duration: dur }));
        done.push(run(inner, [
          { transform: 'translateY(100%)' },
          { transform: 'translateY(0%)', offset: o.speed === 'medium' ? 0.45 : 0.65 },
          { transform: 'translateY(0%)' },
        ], { duration: dur }));
        break;
      }
      case 'check': {
        const w = mk('div', 'fx-check', root);
        w.innerHTML = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="${hexA(c, 0.16)}"/>` +
          `<path d="M27 52 L43 68 L74 35" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        const p = w.querySelector('path');
        const L = p.getTotalLength ? p.getTotalLength() : 80;
        p.style.strokeDasharray = L; p.style.strokeDashoffset = L;
        done.push(run(w, [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: dur }));
        done.push(run(p, [
          { strokeDashoffset: L },
          { strokeDashoffset: 0, offset: peak + 0.05 },
          { strokeDashoffset: 0 },
        ], { duration: dur }));
        break;
      }
      case 'count': {
        const el = mk('div', 'fx-count', root); el.textContent = String(o.scoreNum); el.style.color = c;
        const a = peak * 0.7;
        done.push(run(el, [
          { opacity: 0, transform: 'scale(0.9)' },
          { opacity: 1, transform: 'scale(1.12)', offset: a },
          { opacity: 1, transform: 'scale(1)', offset: a + 0.25 },
          { opacity: 1, transform: 'scale(1)', offset: 0.82 },
          { opacity: 0, transform: 'scale(1)' },
        ], { duration: dur }));
        break;
      }
      case 'ripple': {
        for (let i = 0; i < 3; i++) {
          const r = mk('div', 'fx-ring', root); r.style.borderColor = hexA(c, 0.85);
          const delay = i * dur * 0.16, d = dur - delay;
          done.push(run(r, [
            { opacity: 0, transform: 'scale(0.4)' },
            { opacity: 0.8, transform: 'scale(1)', offset: 0.3 },
            { opacity: 0, transform: 'scale(2.6)' },
          ], { duration: d, delay }));
        }
        break;
      }
      case 'sunrise': {
        const sky = mk('div', 'fx-sky', root);
        sky.style.background = `linear-gradient(to top, ${hexA(c, 0.55)}, ${hexA(c, 0)} 70%)`;
        const sun = mk('div', 'fx-sun', root);
        sun.style.background = `radial-gradient(circle, ${hexA(c, 1)} 0%, ${hexA(c, 0.85)} 45%, ${hexA(c, 0)} 72%)`;
        done.push(run(sky, [{ opacity: 0 }, { opacity: 1, offset: peak }, { opacity: 0 }], { duration: dur }));
        done.push(run(sun, [
          { opacity: 0, transform: 'translateY(55%)' },
          { opacity: 1, transform: 'translateY(0%)', offset: peak },
          { opacity: 0, transform: 'translateY(-8%)' },
        ], { duration: dur }));
        break;
      }
      case 'wave': {
        [[0.35, 0, 1], [0.6, 0.08, -1]].forEach(([alpha, lag, dir]) => {
          const w = mk('div', 'fx-wave', root); w.style.background = hexA(c, alpha);
          done.push(run(w, [
            { transform: `translate(${dir * -4}vw, 100%)` },
            { transform: `translate(${dir * 4}vw, ${45 + lag * 100}%)`, offset: peak },
            { transform: `translate(${dir * -2}vw, 100%)` },
          ], { duration: dur }));
        });
        break;
      }
      case 'heart': {
        const w = mk('div', 'fx-shape', root);
        w.innerHTML = `<svg viewBox="0 0 100 100"><path fill="${c}" d="M50 86 C20 64 8 46 8 32 C8 18 19 9 31 9 C40 9 46 14 50 21 C54 14 60 9 69 9 C81 9 92 18 92 32 C92 46 80 64 50 86 Z"/></svg>`;
        const a = peak * 0.7;
        done.push(run(w, [
          { opacity: 0, transform: 'scale(0.75)' },
          { opacity: 0.95, transform: 'scale(1.06)', offset: a },
          { opacity: 0.95, transform: 'scale(1)', offset: a + 0.25 },
          { opacity: 0.95, transform: 'scale(1)', offset: 0.82 },
          { opacity: 0, transform: 'scale(1)' },
        ], { duration: dur }));
        break;
      }
      case 'smile': {
        const w = mk('div', 'fx-shape', root);
        w.innerHTML = `<svg viewBox="0 0 100 100" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round">` +
          `<circle cx="50" cy="50" r="42" fill="${hexA(c, 0.14)}"/>` +
          `<circle class="eye" cx="36" cy="40" r="4.5" fill="${c}" stroke="none"/><circle class="eye" cx="64" cy="40" r="4.5" fill="${c}" stroke="none"/>` +
          `<path class="mouth" d="M31 58 Q50 76 69 58"/></svg>`;
        done.push(run(w, [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: dur }));
        done.push(drawIn(w.querySelector('.mouth'), dur, peak + 0.05));
        w.querySelectorAll('.eye').forEach((e) => done.push(run(e, [{ opacity: 0 }, { opacity: 1, offset: peak * 0.6 }, { opacity: 1 }], { duration: dur })));
        break;
      }
      case 'bubbles': {
        const rnd = seeded(23);
        for (let i = 0; i < 12; i++) {
          const b = mk('div', 'fx-bubble', root);
          const size = 26 + rnd() * 40;
          b.style.cssText = `left:${6 + rnd() * 82}%;bottom:${4 + rnd() * 26}%;width:${size}px;height:${size}px;` +
            `background:radial-gradient(circle at 35% 30%, rgba(255,255,255,.55), ${hexA(c, 0.45)} 40%, ${hexA(c, 0.15)} 75%);border-color:${hexA(c, 0.7)}`;
          const delay = rnd() * dur * 0.25, sway = (rnd() * 6 + 2) * (i % 2 ? 1 : -1), rise = 25 + rnd() * 20;
          done.push(run(b, [
            { opacity: 0, transform: 'translate(0,0)' },
            { opacity: 0.95, transform: `translate(${sway}vw, -${(rise * 0.45).toFixed(1)}vh)`, offset: peak * 0.8 },
            { opacity: 0, transform: `translate(${-sway / 2}vw, -${rise.toFixed(1)}vh)` },
          ], { duration: dur - delay, delay }));
        }
        break;
      }
      case 'confetti': {
        const rnd = seeded(31), cols = [c, c].concat(COLORS);
        for (let i = 0; i < 18; i++) {
          const p = mk('div', 'fx-paper', root);
          p.style.cssText = `left:${4 + rnd() * 90}%;top:${-4 + rnd() * 16}%;background:${cols[i % cols.length]}`;
          const delay = rnd() * dur * 0.25, fall = 30 + rnd() * 25, spin = (rnd() * 120 - 60) | 0, drift = rnd() * 6 - 3;
          done.push(run(p, [
            { opacity: 0, transform: `translate(0,0) rotate(0deg)` },
            { opacity: 0.95, transform: `translate(${drift / 2}vw, ${(fall * 0.4).toFixed(1)}vh) rotate(${spin / 2}deg)`, offset: peak * 0.8 },
            { opacity: 0, transform: `translate(${drift}vw, ${fall.toFixed(1)}vh) rotate(${spin}deg)` },
          ], { duration: dur - delay, delay }));
        }
        break;
      }
      case 'orbit': {
        const ring = mk('div', 'fx-orbit', root);
        for (let i = 0; i < 8; i++) {
          const d = mk('div', 'fx-orbit-dot', ring);
          d.style.background = c;
          d.style.transform = `rotate(${i * 45}deg) translateY(-24vmin) scale(${0.7 + (i % 2) * 0.3})`;
        }
        done.push(run(ring, [
          { opacity: 0, transform: 'rotate(0deg) scale(0.85)' },
          { opacity: 1, transform: 'rotate(60deg) scale(1)', offset: peak },
          { opacity: 0, transform: 'rotate(120deg) scale(1.05)' },
        ], { duration: dur }));
        break;
      }
      case 'rainbow': {
        const bands = ['#e8a598', '#e3b778', '#f0d58c', '#8fbf9f', '#7aa2d6', '#c9a0dc'];
        const w = mk('div', 'fx-rainbow', root);
        w.innerHTML = '<svg viewBox="0 0 100 60" fill="none" stroke-width="5" stroke-linecap="round">' +
          bands.map((col, i) => { const r = 42 - i * 6; return `<path stroke="${col}" d="M${50 - r} 56 A${r} ${r} 0 0 1 ${50 + r} 56"/>`; }).join('') + '</svg>';
        done.push(run(w, [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: dur }));
        w.querySelectorAll('path').forEach((p) => done.push(drawIn(p, dur, peak + 0.1)));
        break;
      }
      default: { // 'fade', and the reduced-motion fallback for everything
        if (kind !== 'fade') kind = 'fade';
        const el = mk('div', 'fx-fade', root); el.style.background = c;
        done.push(run(el, [{ opacity: 0 }, { opacity: 0.4, offset: 0.5 }, { opacity: 0 }], { duration: dur }));
      }
    }
    return Promise.all(done).then(() => root.remove(), () => root.remove());
  }

  // ------------------------------------------------------------------ score handling + queue
  let started = false, careOpen = false, busy = false, pending = false;

  function onScore() {
    if (!started && !careOpen) return; // not handed over yet: audio is locked, stay silent
    S.score += 1; save(); renderCounter();
    $('#lastScore').textContent = new Date().toLocaleTimeString();
    if (busy) { pending = true; return; } // let current finish; queue at most one more
    runEffect({ anim: true, sound: true });
  }

  async function runEffect(what) {
    busy = true;
    const sheet = $('#care');
    const peeking = careOpen;
    if (peeking) { sheet.classList.add('peek'); document.body.classList.add('peeking'); await sleep(350); }
    const jobs = [];
    if (what.anim) jobs.push(playAnimation(S.animation, Object.assign({ scoreNum: S.score }, S)));
    if (what.sound && S.sound !== 'none') jobs.push(Sound.play(S.sound).catch(() => {}));
    if (what.anim && what.sound && S.vibrate && CAN_VIBRATE) { try { navigator.vibrate(60); } catch (e) {} }
    await Promise.all(jobs);
    if (peeking) { sheet.classList.remove('peek'); document.body.classList.remove('peeking'); await sleep(200); }
    if (pending) { pending = false; await sleep(400); return runEffect({ anim: true, sound: true }); }
    if (wantPreview) { const w = wantPreview; wantPreview = null; await sleep(250); return runEffect(w); }
    busy = false;
  }
  let wantPreview = null; // caregiver tapped Preview mid-animation: play it (latest only) right after
  function preview(what) { Sound.ensure(); if (busy) { wantPreview = what; return; } runEffect(what); }

  function renderCounter() {
    const c = $('#counter'); c.hidden = !S.showCounter; c.textContent = String(S.score);
    const sn = $('#scoreNow'); if (sn) sn.textContent = String(S.score);
  }
  function applyBg() {
    document.documentElement.style.setProperty('--bg', S.bg);
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', S.bg);
    // light backgrounds need a darker counter
    const n = parseInt(S.bg.slice(1), 16), lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255));
    $('#counter').style.color = lum > 150 ? 'rgba(20,24,32,.7)' : 'rgba(255,255,255,.72)';
  }

  // ------------------------------------------------------------------ connection (WebSocket, or fake)
  class FakeSocket {
    constructor() {
      this.readyState = 0; this.base = 120; this.dip = 0; this.timers = [];
      this.cfg = Object.assign({}, S.sensor);
      setTimeout(() => {
        this.readyState = 1; if (this.onopen) this.onopen();
        this.emit(Object.assign({ type: 'config' }, this.cfg));
      }, 300);
      this.timers.push(setInterval(() => this.emit({
        type: 'status', baseline: this.base,
        distance: this.dip || +(this.base + (Math.random() - 0.5) * 1.5).toFixed(1),
      }), 500));
      if (DEMO) this.timers.push(setInterval(() => {
        this.dip = this.base - 40; setTimeout(() => { this.dip = 0; }, 400);
        this.emit({ type: 'score', ts: Math.round(performance.now()) });
      }, 5000));
    }
    emit(o) { if (this.readyState === 1 && this.onmessage) this.onmessage({ data: JSON.stringify(o) }); }
    send(str) {
      const m = JSON.parse(str);
      if (m.type === 'recalibrate') setTimeout(() => { this.base = +(100 + Math.random() * 40).toFixed(1); }, 2000);
      if (m.type === 'setThresholds') {
        ['dropCm', 'minHoldMs', 'cooldownMs'].forEach((k) => { if (k in m) this.cfg[k] = m[k]; });
        this.emit(Object.assign({ type: 'config' }, this.cfg));
      }
    }
    close() { this.timers.forEach(clearInterval); this.readyState = 3; }
  }

  const Conn = {
    ws: null, connected: false, retryT: 0, lastMsg: 0, stopped: false,
    connect() {
      clearTimeout(this.retryT);
      if (this.stopped) return;
      let ws;
      try { ws = FAKE ? new FakeSocket() : new WebSocket(WS_URL); } catch (e) { return this.drop(); }
      this.ws = ws;
      const openTimeout = setTimeout(() => { if (ws.readyState !== 1) this.drop(); }, 4000);
      ws.onopen = () => { clearTimeout(openTimeout); this.lastMsg = Date.now(); this.setConnected(true); };
      ws.onclose = () => this.drop();
      ws.onerror = () => this.drop();
      ws.onmessage = (e) => { this.lastMsg = Date.now(); this.handle(e.data); };
    },
    drop() { // silent: never show errors in player mode, just retry every 2 s
      const ws = this.ws; this.ws = null;
      if (ws) { ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null; try { ws.close(); } catch (e) {} }
      this.setConnected(false);
      clearTimeout(this.retryT);
      if (!this.stopped) this.retryT = setTimeout(() => this.connect(), 2000);
    },
    stop() { this.stopped = true; this.drop(); },        // a micro:bit took over
    start() { this.stopped = false; this.connect(); },
    send(obj) {
      if (BLE.connected) return BLE.sendObj(obj);
      if (this.ws && this.ws.readyState === 1) { try { this.ws.send(JSON.stringify(obj)); } catch (e) {} }
    },
    setConnected(on) { this.connected = on; updateDot(); renderConn(); },
    handle(data) { let m; try { m = JSON.parse(data); } catch (e) { return; } this.handleMsg(m); },
    handleMsg(m) {
      if (m.type === 'score') onScore();
      else if (m.type === 'status') renderStatus(m);
      else if (m.type === 'config') {
        ['dropCm', 'minHoldMs', 'cooldownMs'].forEach((k) => { if (Number.isFinite(m[k])) S.sensor[k] = m[k]; });
        save(); renderSensorSliders();
      }
    },
  };
  // watchdog: the hoop sends status every 500 ms; silence for 4 s means the link is dead
  setInterval(() => { if (Conn.connected && Date.now() - Conn.lastMsg > 4000) Conn.drop(); }, 1000);
  function updateDot() { $('#dot').classList.toggle('on', Conn.connected || BLE.connected); }

  // ------------------------------------------------------------------ micro:bit over Bluetooth (Web Bluetooth)
  // The micro:bit runs microbit/main.ts and talks over its Bluetooth UART service, one short text line per message:
  //   micro:bit -> app:  "S" score | "D,<distance>,<baseline>" status | "C,<dropCm>,<minHoldMs>,<cooldownMs>" config
  //   app -> micro:bit:  "R" recalibrate | "T,<dropCm>,<minHoldMs>,<cooldownMs>" thresholds | "W1"/"W0" status on/off
  const UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const UART_TX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // micro:bit -> app (indicate)
  const UART_RX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // app -> micro:bit (write)
  const BLE = {
    device: null, inChar: null, outChar: null, connected: false, wanted: false,
    buf: '', chain: Promise.resolve(), retryT: 0, error: '', log: [], connectedAt: 0,
    note(msg) { // short connection log shown in caregiver settings, for troubleshooting
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      this.log.push(`${t}  ${msg}`); if (this.log.length > 8) this.log.shift();
      renderBle();
    },
    async pick() { // must be called from a tap (browser rule)
      this.note('Opening the Bluetooth device list…');
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'BBC micro:bit' }], optionalServices: [UART_SERVICE],
      });
      this.note(`Picked ${device.name || 'a micro:bit'}.`);
      if (this.device !== device) {
        this.disconnect(true);
        this.device = device;
        device.addEventListener('gattserverdisconnected', () => this.onDrop());
      }
      try { await this.open(); }
      catch (e) {
        // first connection failed: stop and say why (don't pretend we're "reconnecting")
        this.wanted = false; clearTimeout(this.retryT);
        try { if (device.gatt.connected) device.gatt.disconnect(); } catch (x) {}
        throw e;
      }
      this.wanted = true;
    },
    async open() {
      let step = 'connecting to the micro:bit';
      try {
        const server = await this.device.gatt.connect();
        step = 'finding the UART service';
        const svc = await server.getPrimaryService(UART_SERVICE);
        step = 'finding the UART characteristics';
        let tx, rx;
        try { tx = await svc.getCharacteristic(UART_TX); rx = await svc.getCharacteristic(UART_RX); }
        catch (e) { // fallback: pick them by what they can do
          const chars = await svc.getCharacteristics();
          tx = chars.find((c) => c.properties.notify || c.properties.indicate);
          rx = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
        }
        if (!tx) throw new Error('no notify characteristic');
        this.inChar = tx; this.outChar = rx || null;
        if (!this.onValue) this.onValue = (e) => this.onData(e.target.value);
        this.inChar.addEventListener('characteristicvaluechanged', this.onValue);
        step = 'starting notifications';
        await this.inChar.startNotifications();
      } catch (e) {
        const msg = `Failed while ${step}: ${(e && e.message) || e}`;
        this.note(msg);
        const err = new Error(msg); err.step = step; err.name = (e && e.name) || 'Error';
        throw err;
      }
      this.buf = ''; this.error = ''; this.connected = true; this.connectedAt = Date.now();
      this.note('Connected. Waiting for baskets.');
      Conn.stop(); // stop Wi-Fi / demo hoop so only the micro:bit scores
      this.sendObj(Object.assign({ type: 'setThresholds' }, S.sensor));
      this.sendObj({ type: 'watch', on: careOpen });
      updateDot(); renderBle(); renderConn();
    },
    onData(dv) {
      this.buf += new TextDecoder().decode(dv);
      let i;
      while ((i = this.buf.search(/[\r\n]/)) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        if (line) this.handleLine(line);
      }
      if (this.buf.length > 200) this.buf = ''; // garbage guard
    },
    handleLine(line) {
      const p = line.split(',');
      if (p[0] === 'S') { this.note('Basket received.'); Conn.handleMsg({ type: 'score' }); }
      else if (p[0] === 'D') Conn.handleMsg({ type: 'status', distance: +p[1], baseline: +p[2] });
      else if (p[0] === 'C') Conn.handleMsg({ type: 'config', dropCm: +p[1], minHoldMs: +p[2], cooldownMs: +p[3] });
    },
    sendObj(o) {
      const line = o.type === 'recalibrate' ? 'R'
        : o.type === 'setThresholds' ? `T,${o.dropCm},${o.minHoldMs},${o.cooldownMs}`
          : o.type === 'watch' ? (o.on ? 'W1' : 'W0') : null;
      const c = this.outChar;
      if (!line || !c || !this.connected) return;
      const data = new TextEncoder().encode(line + '\n'); // always under the 20-byte Bluetooth packet size
      this.chain = this.chain.then(() => (c.properties.writeWithoutResponse && c.writeValueWithoutResponse
        ? c.writeValueWithoutResponse(data) : c.writeValue(data))).catch(() => {});
    },
    onDrop() { // silent, like the Wi-Fi link: grey dot, then quietly reconnect
      const was = this.connected;
      this.connected = false; this.inChar = this.outChar = null;
      if (was) this.note(`Link dropped after ${Math.round((Date.now() - this.connectedAt) / 1000)} s.`);
      updateDot(); renderBle(); renderConn();
      clearTimeout(this.retryT);
      if (this.wanted) this.retryT = setTimeout(() => this.retry(), 2000);
    },
    async retry() {
      if (!this.wanted || this.connected || !this.device) return;
      this.note('Reconnecting…');
      try { await this.open(); } catch (e) { this.error = e.message; this.retryT = setTimeout(() => this.retry(), 3000); }
    },
    disconnect(quiet) {
      this.wanted = false; clearTimeout(this.retryT);
      try { if (this.device && this.device.gatt.connected) this.device.gatt.disconnect(); } catch (e) {}
      this.connected = false;
      if (quiet) return;
      updateDot(); renderBle(); renderConn();
      if (!NO_WS) Conn.start();
    },
  };
  async function bleConnectTap() {
    if (!BLE_OK) return;
    BLE.error = 'Looking for micro:bits…'; renderBle();
    try { await BLE.pick(); }
    catch (e) {
      const msg = (e && e.message) || String(e);
      if (e && e.name === 'NotFoundError' && !e.step) { BLE.error = 'No micro:bit picked.'; BLE.note('Device list closed without a pick.'); }
      else if (e && e.step === 'finding the UART service') {
        BLE.error = 'The micro:bit connected, but its Bluetooth UART service is missing or hidden. '
          + 'Check that "bluetooth uart service" runs at start and "No Pairing Required" is on in Project Settings, re-download the program, '
          + 'then on the iPhone forget the micro:bit under Settings > Bluetooth (if listed), turn Bluetooth off and on, and try again.';
      } else BLE.error = `Couldn't connect. ${msg}`;
    }
    renderBle();
  }
  function renderBle() {
    $('#bleSec').hidden = !window.isSecureContext;
    $('#bleConnect').hidden = !BLE_OK || BLE.connected;
    $('#bleDisconnect').hidden = !BLE.connected;
    $('#bleState').textContent = BLE.connected ? `Connected to ${(BLE.device && BLE.device.name) || 'micro:bit'}.`
      : BLE.wanted ? 'Connection lost. Reconnecting to the micro:bit…' + (BLE.error ? ` (last try: ${BLE.error})` : '')
        : (BLE.error || 'No micro:bit connected.');
    $('#bleLog').textContent = BLE.log.join('\n');
    $('#bleLogWrap').hidden = !BLE.log.length;
    $('#bleHelp').textContent = !navigator.bluetooth
      ? (IS_IOS ? 'iPhone and iPad browsers (Safari, Chrome) can\'t use Bluetooth. Open this page in the free Bluefy app instead.'
        : 'This browser can\'t use Bluetooth. Use Chrome or Edge.')
      : IN_FRAME ? 'Bluetooth is blocked inside this embedded page. Open the GitHub Pages link directly.'
        : 'Turn on the micro:bit, tap Connect, and pick "BBC micro:bit [....]" from the list. It reconnects by itself if the link drops.';
    const sb = $('#startBle');
    sb.hidden = !BLE_OK;
    sb.textContent = BLE.connected ? 'micro:bit connected ✓' : BLE.wanted ? 'Reconnecting…' : 'Connect micro:bit';
    sb.classList.toggle('on', BLE.connected);
    const sm = $('#startBleMsg');
    sm.hidden = !BLE_OK || BLE.connected || !BLE.error;
    sm.textContent = BLE.error ? BLE.error + ' (More detail: Caregiver settings > micro:bit hoop.)' : '';
  }
  $('#bleConnect').addEventListener('click', bleConnectTap);
  $('#startBle').addEventListener('click', () => { if (!BLE.connected) bleConnectTap(); });
  $('#bleDisconnect').addEventListener('click', () => { BLE.disconnect(); BLE.error = 'Disconnected.'; renderBle(); });

  // ------------------------------------------------------------------ caregiver lock (hold top-right 3 s)
  (function setupLock() {
    const zone = $('#lockZone'), circle = $('#lockRing circle');
    const C = 2 * Math.PI * 16;
    circle.style.strokeDasharray = C;
    let t1 = 0, t2 = 0, ringAnim = null;
    function cancel() {
      clearTimeout(t1); clearTimeout(t2); zone.classList.remove('holding');
      if (ringAnim) { ringAnim.cancel(); ringAnim = null; }
    }
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault(); cancel();
      // faint progress ring appears only after 1 s of holding, so a quick tap shows nothing
      t1 = setTimeout(() => {
        zone.classList.add('holding');
        try { ringAnim = circle.animate([{ strokeDashoffset: C }, { strokeDashoffset: 0 }], { duration: 2000, fill: 'forwards' }); } catch (err) {}
      }, 1000);
      t2 = setTimeout(() => { cancel(); requestCare(); }, 3000);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => zone.addEventListener(ev, cancel));
    zone.addEventListener('contextmenu', (e) => e.preventDefault());
  })();

  function requestCare() {
    if (careOpen) return;
    if (S.pinEnabled && S.pin.length === 4) openPin(); else openCare();
  }

  // PIN pad
  let pinBuf = '', pinIdle = 0;
  function openPin() {
    pinBuf = ''; drawPin(); $('#pinPad').hidden = false; $('#pinPad .hint').textContent = 'Enter caregiver PIN';
    clearTimeout(pinIdle); pinIdle = setTimeout(closePin, 20000);
  }
  function closePin() { clearTimeout(pinIdle); $('#pinPad').hidden = true; pinBuf = ''; }
  function drawPin() { [...$('#pinDots').children].forEach((d, i) => d.classList.toggle('f', i < pinBuf.length)); }
  $('#pinKeys').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    clearTimeout(pinIdle); pinIdle = setTimeout(closePin, 20000);
    const k = b.dataset.k;
    if (k === 'cancel') return closePin();
    if (k === 'back') pinBuf = pinBuf.slice(0, -1);
    else if (pinBuf.length < 4) pinBuf += b.textContent;
    drawPin();
    if (pinBuf.length === 4) {
      if (pinBuf === S.pin) { closePin(); openCare(); }
      else { pinBuf = ''; setTimeout(drawPin, 300); $('#pinPad .hint').textContent = 'Not quite. Try again.'; }
    }
  });

  // ------------------------------------------------------------------ caregiver mode
  function openCare() {
    careOpen = true; $('#care').hidden = false; $('#care').scrollTop = 0;
    Sound.ensure(); renderCare();
    Conn.send({ type: 'watch', on: true }); // micro:bit: start sending live distance for the calibration panel
  }
  function closeCare() {
    Conn.send({ type: 'watch', on: false });
    Sound.stopCurrent();
    careOpen = false; $('#care').hidden = true; $('#care').classList.remove('peek');
    save();
  }
  $('#careClose').addEventListener('click', closeCare);
  $('#startCare').addEventListener('click', openCare);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && careOpen) closeCare(); });

  // In-page confirm / text prompt (native confirm() and prompt() are blocked in some browsers and web views).
  // ask(msg) resolves true/false; ask(msg, {value}) resolves the typed text or null.
  function ask(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const d = $('#dlg'), inp = $('#dlgInput'), ok = $('#dlgOk'), cancel = $('#dlgCancel');
      const wantsText = 'value' in opts;
      $('#dlgMsg').textContent = message;
      inp.hidden = !wantsText; inp.value = opts.value || '';
      ok.textContent = opts.ok || 'OK';
      d.hidden = false;
      (wantsText ? inp : ok).focus();
      const finish = (v) => { d.hidden = true; ok.onclick = cancel.onclick = inp.onkeydown = null; resolve(v); };
      ok.onclick = () => finish(wantsText ? inp.value : true);
      cancel.onclick = () => finish(wantsText ? null : false);
      inp.onkeydown = (e) => { if (e.key === 'Enter') ok.onclick(); };
    });
  }

  function setMsg(text, err) { const m = $('#soundMsg'); m.textContent = text || ''; m.classList.toggle('err', !!err); }

  function swatches(container, colors, current, onPick) {
    container.innerHTML = '';
    colors.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'sw' + (c.toLowerCase() === current.toLowerCase() ? ' sel' : '');
      b.style.background = c; b.setAttribute('aria-label', c);
      b.addEventListener('click', () => onPick(c));
      container.appendChild(b);
    });
    const custom = document.createElement('label');
    const isCustom = !colors.some((c) => c.toLowerCase() === current.toLowerCase());
    custom.className = 'btn sw sw-custom' + (isCustom ? ' sel' : '');
    custom.title = 'Custom color';
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = current;
    inp.addEventListener('change', () => onPick(inp.value));
    custom.appendChild(inp); container.appendChild(custom);
  }

  function renderAnimList() {
    const list = $('#animList'); list.innerHTML = '';
    let group = '';
    ANIMS.forEach((a) => {
      if (a.group !== group) { group = a.group; const h = document.createElement('p'); h.className = 'group'; h.textContent = group; list.appendChild(h); }
      const row = document.createElement('div'); row.className = 'item';
      row.innerHTML = `<label><input type="radio" name="anim" value="${a.id}"${S.animation === a.id ? ' checked' : ''}>` +
        `<span><span class="txt">${a.name}${a.id === 'glow' ? ' <span class="tag">default</span>' : ''}</span><span class="desc">${a.note}</span></span></label>` +
        `<button class="small" data-prev="${a.id}">Preview</button>`;
      list.appendChild(row);
    });
  }
  $('#animList').addEventListener('change', (e) => { if (e.target.name === 'anim') { S.animation = e.target.value; save(); } });
  $('#animList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-prev]'); if (!b) return;
    S.animation = b.dataset.prev; save(); renderAnimList(); preview({ anim: true });
  });

  async function renderSoundList() {
    const list = $('#soundList');
    const customs = (await DB.all()).sort((a, b) => a.created - b.created);
    if (S.sound !== 'none' && !SYNTHS[S.sound] && !customs.some((c) => c.id === S.sound)) { S.sound = 'none'; save(); }
    list.innerHTML = '';
    const rows = [{ id: 'none', name: 'None (silent)', group: 'Off', note: 'Animation only, no sound' }]
      .concat(BUILTIN, customs.map((c) => ({ id: c.id, name: c.name, custom: true, group: 'My sounds', note: '' })));
    let group = '';
    rows.forEach((r) => {
      if (r.group !== group) { group = r.group; const h = document.createElement('p'); h.className = 'group'; h.textContent = group; list.appendChild(h); }
      const row = document.createElement('div'); row.className = 'item';
      const safe = String(r.name).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
      row.innerHTML = `<label><input type="radio" name="sound" value="${r.id}"${S.sound === r.id ? ' checked' : ''}>` +
        `<span><span class="txt">${safe}${r.tag ? ` <span class="tag">${r.tag}</span>` : ''}</span>` +
        `${r.note ? `<span class="desc">${r.note}</span>` : ''}</span></label>` +
        (r.id !== 'none' ? `<button class="small" data-play="${r.id}">Preview</button>` : '') +
        (r.custom ? `<button class="small" data-ren="${r.id}">Rename</button><button class="small" data-del="${r.id}">Delete</button>` : '');
      list.appendChild(row);
    });
  }
  $('#soundList').addEventListener('change', (e) => { if (e.target.name === 'sound') { S.sound = e.target.value; save(); } });
  $('#soundList').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.play) { Sound.ensure(); Sound.play(b.dataset.play); }
    else if (b.dataset.ren) {
      const rec = await DB.get(b.dataset.ren); if (!rec) return;
      const name = ((await ask('New name for this sound:', { value: rec.name, ok: 'Rename' })) || '').trim().slice(0, 40);
      if (name) { rec.name = name; await DB.put(rec); renderSoundList(); }
    } else if (b.dataset.del) {
      const rec = await DB.get(b.dataset.del); if (!rec) return;
      if (!(await ask(`Delete "${rec.name}"? This can't be undone.`, { ok: 'Delete' }))) return;
      await DB.del(rec.id); Sound.cache.delete(rec.id);
      if (S.sound === rec.id) { S.sound = 'none'; save(); }
      renderSoundList(); setMsg(`Deleted "${rec.name}".`);
    }
  });

  async function addSound(arrayBuffer, type, maxSecs, fallbackName) {
    let analysed;
    try { analysed = Sound.analyse(await Sound.decode(arrayBuffer)); } catch (e) { setMsg('This phone could not read that file. Try an mp3, m4a or wav.', true); return; }
    if (analysed.buffer.duration > maxSecs + 0.5) { setMsg(`That sound is ${analysed.buffer.duration.toFixed(1)} s long. Please keep it under ${maxSecs} s.`, true); return; }
    const count = (await DB.all()).length;
    const name = ($('#newName').value.trim() || fallbackName || `My sound ${count + 1}`).slice(0, 40);
    const rec = { id: uid(), name, type, data: arrayBuffer, created: Date.now() };
    try { await DB.put(rec); } catch (e) { setMsg('Could not save the sound (phone storage may be full).', true); return; }
    Sound.cache.set(rec.id, analysed);
    S.sound = rec.id; save(); $('#newName').value = '';
    await renderSoundList();
    setMsg(`Saved "${name}" and selected it. Tap Preview to hear it.`);
  }

  $('#upload').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { setMsg('That file is over 2 MB. Please use a shorter or smaller file.', true); return; }
    setMsg('Checking the file…');
    await addSound(await f.arrayBuffer(), f.type, 10, f.name.replace(/\.[^.]+$/, ''));
  });

  let recorder = null;
  $('#recBtn').addEventListener('click', async () => {
    const btn = $('#recBtn');
    if (recorder) { if (recorder.state !== 'inactive') recorder.stop(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { setMsg('Microphone permission was not given.', true); return; }
    const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
    const mime = types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    let left = 5, tick = 0;
    rec.onstop = async () => {
      clearInterval(tick); recorder = null; btn.classList.remove('rec'); btn.textContent = 'Record (5 s)';
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
      if (blob.size > 2 * 1024 * 1024) { setMsg('Recording too large.', true); return; }
      await addSound(await blob.arrayBuffer(), blob.type, 5, null);
    };
    recorder = rec; rec.start();
    btn.classList.add('rec'); btn.textContent = `Stop (${left})`; setMsg('Recording…');
    tick = setInterval(() => { left -= 1; btn.textContent = `Stop (${left})`; if (left <= 0 && rec.state !== 'inactive') rec.stop(); }, 1000);
  });

  // simple inputs
  function bindRange(id, outId, fmt, onInput) {
    const el = $('#' + id);
    el.addEventListener('input', () => { onInput(+el.value); $('#' + outId).textContent = fmt(+el.value); });
    el.addEventListener('change', save);
  }
  bindRange('duration', 'durOut', (v) => v.toFixed(1) + ' s', (v) => { S.duration = v; });
  bindRange('volume', 'volOut', (v) => v + '%', (v) => {
    if (v > S.maxVolume) { v = S.maxVolume; $('#volume').value = v; } // ceiling is a hard stop
    S.volume = v; Sound.applyVolume();
  });
  bindRange('maxVolume', 'maxOut', (v) => v + '%', (v) => {
    S.maxVolume = v;
    if (S.volume > v) { S.volume = v; $('#volume').value = v; $('#volOut').textContent = v + '%'; }
    Sound.applyVolume();
  });
  $('#volume').addEventListener('change', () => preview({ sound: true })); // hear the new level once
  $('#fadeIn').addEventListener('change', (e) => { S.fadeIn = e.target.checked; save(); });
  $('#speedSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.speed = b.dataset.v; save(); renderCare();
  });
  $('#showCounter').addEventListener('change', (e) => { S.showCounter = e.target.checked; save(); renderCounter(); });
  $('#resetScore').addEventListener('click', async () => { if (await ask('Reset the score to 0?', { ok: 'Reset' })) { S.score = 0; save(); renderCounter(); } });
  $('#vibrate').addEventListener('change', (e) => { S.vibrate = e.target.checked; save(); });
  $('#testScore').addEventListener('click', () => preview({ anim: true, sound: true }));
  $('#pinEnabled').addEventListener('change', (e) => { S.pinEnabled = e.target.checked; save(); renderPinNote(); });
  $('#pin').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); S.pin = e.target.value; save(); renderPinNote(); });
  function renderPinNote() {
    $('#pinNote').textContent = !S.pinEnabled ? 'No PIN: holding the corner for 3 seconds opens settings.'
      : S.pin.length === 4 ? 'PIN is on. Remember it! (Forgot it? Clear the browser data for this page to reset all settings.)'
        : 'Enter 4 digits to turn the PIN on.';
  }

  // sensor calibration
  let thrT = 0;
  function sendThresholds() { clearTimeout(thrT); thrT = setTimeout(() => Conn.send(Object.assign({ type: 'setThresholds' }, S.sensor)), 300); }
  bindRange('dropCm', 'dropOut', (v) => v + ' cm', (v) => { S.sensor.dropCm = v; sendThresholds(); });
  bindRange('minHold', 'holdOut', (v) => v + ' ms', (v) => { S.sensor.minHoldMs = v; sendThresholds(); });
  bindRange('cooldown', 'coolOut', (v) => (v / 1000).toFixed(2).replace(/0$/, '') + ' s', (v) => { S.sensor.cooldownMs = v; sendThresholds(); });
  $('#recal').addEventListener('click', () => { Conn.send({ type: 'recalibrate' }); $('#calBase').textContent = '…'; });
  function renderSensorSliders() {
    $('#dropCm').value = S.sensor.dropCm; $('#dropOut').textContent = S.sensor.dropCm + ' cm';
    $('#minHold').value = S.sensor.minHoldMs; $('#holdOut').textContent = S.sensor.minHoldMs + ' ms';
    $('#cooldown').value = S.sensor.cooldownMs; $('#coolOut').textContent = (S.sensor.cooldownMs / 1000) + ' s';
  }
  function renderConn() {
    const el = $('#calConn'); if (!el) return;
    el.textContent = BLE.connected ? 'Connected to the micro:bit hoop over Bluetooth.'
      : NO_WS ? 'No hoop connected. Connect a micro:bit above, or use tap-to-score to try things out.'
      : FAKE ? (DEMO ? 'Demo mode: a fake basket every 5 seconds (no hoop needed).' : 'Practice mode: no hoop connected.')
      : Conn.connected ? 'Connected to the hoop.' : 'Not connected. Join the "HoopScore" Wi-Fi and reopen 192.168.4.1. Retrying every 2 s…';
  }
  function renderStatus(m) {
    if (!careOpen) return;
    const d = num(m.distance, -1), b = num(m.baseline, 0);
    $('#calDist').textContent = d > 0 ? d.toFixed(1) : '–';
    $('#calBase').textContent = b > 0 ? b.toFixed(1) : '–';
    const scale = Math.max(b * 1.2, 50);
    $('#calFill').style.width = (d > 0 ? clamp(d / scale, 0, 1) * 100 : 0) + '%';
    $('#calLine').style.left = (clamp((b - S.sensor.dropCm) / scale, 0, 1) * 100) + '%';
  }

  // profiles
  function renderProfiles() {
    const list = $('#profList'); list.innerHTML = '';
    const names = Object.keys(S.profiles);
    if (!names.length) { list.innerHTML = '<p class="note">No profiles yet. Set things up the way you like, then save them with a name.</p>'; return; }
    names.forEach((n) => {
      const row = document.createElement('div'); row.className = 'item';
      const lab = document.createElement('label'); lab.textContent = n;
      const load = document.createElement('button'); load.className = 'small'; load.textContent = 'Use';
      const del = document.createElement('button'); del.className = 'small'; del.textContent = 'Delete';
      load.addEventListener('click', () => {
        Object.assign(S, S.profiles[n]); sanitize(S); save(); applyBg(); renderCounter(); renderCare();
        setMsg('');
      });
      del.addEventListener('click', async () => { if (await ask(`Delete profile "${n}"?`, { ok: 'Delete' })) { delete S.profiles[n]; save(); renderProfiles(); } });
      row.append(lab, load, del); list.appendChild(row);
    });
  }
  $('#profSave').addEventListener('click', () => {
    const n = $('#profName').value.trim(); if (!n) { $('#profName').focus(); return; }
    const p = {}; PROFILE_KEYS.forEach((k) => { p[k] = S[k]; });
    S.profiles[n] = p; save(); $('#profName').value = ''; renderProfiles();
  });

  function renderCare() {
    renderAnimList();
    swatches($('#animColors'), COLORS, S.color, (c) => { S.color = c; save(); renderCare(); preview({ anim: true }); });
    swatches($('#bgColors'), BG_COLORS, S.bg, (c) => { S.bg = c; save(); applyBg(); renderCare(); });
    [...$('#speedSeg').children].forEach((b) => b.classList.toggle('sel', b.dataset.v === S.speed));
    $('#duration').value = S.duration; $('#durOut').textContent = S.duration.toFixed(1) + ' s';
    $('#rmNote').hidden = !reducedMotion.matches;
    renderSoundList();
    $('#volume').value = S.volume; $('#volOut').textContent = S.volume + '%';
    $('#maxVolume').value = S.maxVolume; $('#maxOut').textContent = S.maxVolume + '%';
    $('#fadeIn').checked = S.fadeIn;
    $('#recBtn').hidden = !CAN_RECORD; $('#recNote').hidden = CAN_RECORD;
    $('#showCounter').checked = S.showCounter;
    $('#vibRow').hidden = !CAN_VIBRATE; $('#vibrate').checked = S.vibrate;
    $('#pinEnabled').checked = S.pinEnabled; $('#pin').value = S.pin; renderPinNote();
    renderSensorSliders(); renderConn(); renderBle(); renderProfiles(); renderCounter();
  }

  // ------------------------------------------------------------------ start
  $('#startBtn').addEventListener('click', () => {
    Sound.ensure(); // must happen inside the tap to unlock audio
    started = true; $('#start').hidden = true; // start right away; never wait on fullscreen
    const el = document.documentElement;
    try {
      const fs = el.requestFullscreen || el.webkitRequestFullscreen;
      const p = fs && fs.call(el);
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* iPhone Safari has no fullscreen for pages; that's fine */ }
    keepAwake();
  });
  // Screen wake lock: only works on https pages (the web demo); on the hoop's http page the caregiver sets auto-lock to Never.
  let wakeLock = null;
  function keepAwake() {
    try {
      if (!navigator.wakeLock || wakeLock) return;
      navigator.wakeLock.request('screen').then((l) => { wakeLock = l; l.addEventListener('release', () => { wakeLock = null; }); }).catch(() => {});
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && started) keepAwake(); });
  // any touch on the player screen re-unlocks audio if the phone suspended it
  $('#player').addEventListener('pointerdown', () => { if (started) Sound.ensure(); });

  // Tap-to-score test mode: session only (never saved), so it can't be left on by accident.
  // On by default only where no real hoop can ever connect (e.g. an embedded page with Bluetooth blocked).
  let tapTest = params.has('tap') || (NO_WS && !BLE_OK);
  function renderTapTest() { $('#tapTest').checked = tapTest; $('#testBadge').hidden = !tapTest; }
  $('#tapTest').addEventListener('change', (e) => { tapTest = e.target.checked; renderTapTest(); });
  $('#player').addEventListener('click', () => { if (tapTest && started && !careOpen) onScore(); });
  renderTapTest();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Sound.ctx && started) Sound.ctx.resume().catch(() => {}); });

  if (FAKE) window.__hoop = { score: () => Conn.handle('{"type":"score"}'), Sound, SYNTHS, playAnimation, S, BLE, get busy() { return busy; } }; // dev hook

  applyBg(); renderCounter(); renderBle();
  if (NO_WS) Conn.stopped = true; else Conn.connect();
})();
