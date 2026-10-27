// Music (BGM), jingles (ME) and sound effects (SE).
// File lookup goes through G.SoundConfig (src/config/sounds.js). Anything that
// is missing is replaced by a generated chiptune so the game never goes silent,
// and the missing name is remembered for docs/MISSING_ASSETS.md.
'use strict';

G.Audio = (() => {
  const cfg = G.SoundConfig;
  let ctx = null;
  let unlocked = false;
  let muted = false;
  const missing = new Set();
  const opts = { music: 1, sfx: 1 };

  // ---------------------------------------------------------------- helpers
  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    return ctx;
  }
  function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  // Resolves a story/config name to a file path, or null for "use placeholder".
  function resolve(kind, name) {
    if (!name) return undefined;
    if (name[0] === '@') return name.slice(1);       // explicit path from config
    if (name[0] === '!') return null;                // config key with no file
    if (Object.prototype.hasOwnProperty.call(cfg.aliases, name)) return cfg.aliases[name];
    if (kind === 'bgm') return `music/${name}.ogg`;
    if (kind === 'me') return `music/me/${name}.ogg`;
    return `sfx/${name}.ogg`;
  }
  function makeEl(path) {
    const a = new Audio();
    a.src = 'assets/audio/' + encodeURI(path).replace(/#/g, '%23');
    a.preload = 'auto';
    if ('preservesPitch' in a) a.preservesPitch = false;
    return a;
  }

  // ------------------------------------------------- chiptune placeholders
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
  function blip(name, { len = 0.12, vol = 0.15 } = {}) {
    const c = ac(); if (!c || muted) return;
    const h = hash(name);
    const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = ['square', 'triangle', 'sawtooth'][h % 3];
    const base = 330 * Math.pow(2, (h % 12) / 12);
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * (h & 16 ? 2 : 0.5), t + len);
    g.gain.setValueAtTime(vol * opts.sfx * cfg.sfxVolume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + len + 0.02);
  }
  // A looping procedural tune, deterministic per name.
  class ChipTune {
    constructor(name, loop) {
      this.name = name; this.loop = loop; this.stopped = false;
      const h = hash(name);
      this.root = 196 * Math.pow(2, (h % 7) / 12);
      this.tempo = 0.16 + (h % 5) * 0.02;
      this.notes = [];
      let r = h;
      for (let i = 0; i < 32; i++) { r = (Math.imul(r, 1103515245) + 12345) >>> 0; this.notes.push(r % 11 === 0 ? null : SCALE[r % SCALE.length]); }
      this.bass = [0, 0, 5, 5, 7, 7, 3, 4].map((x) => x);
      this.i = 0; this.next = 0; this.volume = 1;
    }
    start() {
      const c = ac(); if (!c) return;
      this.gain = c.createGain();
      this.gain.connect(c.destination);
      this.next = c.currentTime + 0.05;
      this.timer = setInterval(() => this.schedule(), 50);
      this.schedule();
    }
    schedule() {
      const c = ac(); if (!c || this.stopped) return;
      this.gain.gain.value = muted ? 0 : 0.06 * opts.music * cfg.musicVolume * this.volume;
      while (this.next < c.currentTime + 0.3) {
        const n = this.notes[this.i % 32];
        if (n !== null) this.tone('square', this.root * Math.pow(2, n / 12), this.next, this.tempo * 0.9, 1);
        if (this.i % 4 === 0) this.tone('triangle', this.root / 2 * Math.pow(2, this.bass[(this.i / 4) % 8] / 12), this.next, this.tempo * 3.8, 1.6);
        this.next += this.tempo;
        this.i++;
        if (!this.loop && this.i >= 16) { this.stop(); break; }
      }
    }
    tone(type, f, t, len, v) {
      const c = ac(); const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.01, t + len);
      o.connect(g).connect(this.gain); o.start(t); o.stop(t + len);
    }
    stop() { this.stopped = true; clearInterval(this.timer); if (this.gain) this.gain.disconnect(); }
    get ended() { return this.stopped; }
  }

  // ------------------------------------------------------------------ BGM
  let bgm = null;          // { name, el|chip, volume, pitch }
  let memorized = null;
  let mePlaying = null;
  let fade = null;

  function bgmVolume(b) { return muted ? 0 : (b.volume / 100) * opts.music * cfg.musicVolume; }

  function startBgm(b) {
    const path = resolve('bgm', b.name);
    if (path) {
      const el = makeEl(path);
      el.loop = true;
      el.volume = bgmVolume(b);
      el.playbackRate = (b.pitch || 100) / 100;
      el.onerror = () => {
        if (bgm !== b) return;
        missing.add('music: ' + b.name.replace(/^[@!]/, ''));
        b.el = null; b.chip = new ChipTune(b.name, true); b.chip.start();
      };
      b.el = el;
      if (unlocked && !mePlaying) el.play().catch(() => {});
    } else {
      missing.add('music: ' + b.name.replace(/^[@!]/, ''));
      b.chip = new ChipTune(b.name, true);
      if (unlocked) b.chip.start();
    }
  }
  function stopBgmObj(b) {
    if (!b) return;
    if (b.el) { b.el.pause(); b.el.src = ''; }
    if (b.chip) b.chip.stop();
  }

  const api = {
    missing,
    get muted() { return muted; },
    setMuted(m) {
      muted = m;
      if (bgm && bgm.el) bgm.el.volume = bgmVolume(bgm);
    },
    setOptions(o) { Object.assign(opts, o); if (bgm && bgm.el) bgm.el.volume = bgmVolume(bgm); },
    unlock() {
      if (unlocked) return;
      unlocked = true;
      const c = ac(); if (c && c.state === 'suspended') c.resume();
      if (bgm) {
        if (bgm.el && !mePlaying) bgm.el.play().catch(() => {});
        if (bgm.chip && !bgm.chip.timer) bgm.chip.start();
      }
    },
    // name may be a string or {name, volume, pitch}
    playBGM(a, { force = false } = {}) {
      if (!a) return;
      if (typeof a === 'string') a = { name: a };
      if (!a.name) return api.stopBGM();
      const b = { name: a.name, volume: a.volume ?? 100, pitch: a.pitch ?? 100 };
      if (!force && bgm && bgm.name === b.name) {
        bgm.volume = b.volume;
        if (bgm.el) { bgm.el.volume = bgmVolume(bgm); if (bgm.el.paused && unlocked && !mePlaying) bgm.el.play().catch(() => {}); }
        return;
      }
      fade = null;
      stopBgmObj(bgm);
      bgm = b;
      startBgm(b);
    },
    playMusicKey(key, force) {
      const p = cfg.music[key];
      if (p === undefined) return;
      api.playBGM({ name: p ? '@' + p : '!' + key }, { force });
    },
    currentBGM() { return bgm ? { name: bgm.name, volume: bgm.volume, pitch: bgm.pitch } : null; },
    stopBGM() { stopBgmObj(bgm); bgm = null; fade = null; },
    fadeOutBGM(sec) {
      if (!bgm) return;
      if (sec <= 0) return api.stopBGM();
      fade = { b: bgm, start: G.time, len: sec, vol: bgm.volume };
    },
    memorizeBGM() { memorized = bgm ? { name: bgm.name, volume: bgm.volume, pitch: bgm.pitch } : null; },
    restoreBGM() { if (memorized) api.playBGM(memorized); else api.stopBGM(); },
    // ---------------------------------------------------------------- ME
    playME(a, key) {
      if (typeof a === 'string') a = { name: a };
      a = a || { name: key };
      let path;
      if (key) path = cfg.me[key];
      else path = resolve('me', a.name);
      if (path === undefined) return;
      if (mePlaying) { if (mePlaying.el) mePlaying.el.pause(); if (mePlaying.chip) mePlaying.chip.stop(); }
      if (bgm && bgm.el) bgm.el.pause();
      if (bgm && bgm.chip && bgm.chip.gain) bgm.chip.volume = 0;
      const me = { done: false };
      const finish = () => {
        if (me.done) return;
        me.done = true;
        if (mePlaying === me) {
          mePlaying = null;
          if (bgm && bgm.el && unlocked) bgm.el.play().catch(() => {});
          if (bgm && bgm.chip) bgm.chip.volume = 1;
        }
      };
      mePlaying = me;
      const usePlaceholder = () => {
        missing.add('jingle: ' + (key || a.name));
        me.chip = new ChipTune(key || a.name, false); me.chip.start();
        setTimeout(finish, 16 * me.chip.tempo * 1000 + 200);
      };
      if (path) {
        const el = makeEl(path);
        el.volume = muted ? 0 : ((a.volume ?? 100) / 100) * opts.music * cfg.musicVolume;
        el.onended = finish;
        el.onerror = () => { if (!me.done) usePlaceholder(); };
        me.el = el;
        if (unlocked) el.play().catch(finish); else setTimeout(finish, 100);
      } else usePlaceholder();
      return me;
    },
    get mePlaying() { return !!mePlaying; },
    // ---------------------------------------------------------------- SE
    // Plays an engine sound by config key (e.g. 'cursor').
    sfx(key) {
      if (muted) return;
      const path = cfg.sfx[key];
      if (path === undefined) { console.warn('Unknown sfx key', key); return; }
      if (!path) { missing.add('sfx: ' + key); blip(key); return; }
      return api.playFile(path, 100, 100, key);
    },
    // Stops a sound returned by sfx() / playFile() (e.g. the EXP-gain loop).
    stopSfx(el) { if (el) { el.pause(); el.currentTime = 0; } },
    // Plays a sound by the name used in the story data (e.g. "Door enter").
    playSE(a) {
      if (muted || !a) return;
      if (typeof a === 'string') a = { name: a };
      if (!a.name) return;
      const path = resolve('se', a.name);
      if (!path) { missing.add('sfx: ' + a.name); blip(a.name); return; }
      api.playFile(path, a.volume ?? 100, a.pitch ?? 100, a.name);
    },
    playFile(path, volume = 100, pitch = 100, label = path) {
      if (!unlocked) return;
      const el = makeEl(path);
      el.volume = Math.min(1, (volume / 100) * opts.sfx * cfg.sfxVolume);
      el.playbackRate = pitch / 100;
      el.onerror = () => { missing.add('sfx: ' + label); blip(label); };
      el.play().catch(() => {});
      return el;
    },
    cry(species, pitch = 100) {
      if (muted || !species) return;
      api.playFile(`sfx/cries/${species}.ogg`, 100, pitch, 'cry ' + species);
    },
    update() {
      if (fade && fade.b === bgm) {
        const t = (G.time - fade.start) / fade.len;
        if (t >= 1) api.stopBGM();
        else if (bgm.el) bgm.el.volume = bgmVolume(bgm) * (1 - t);
        else if (bgm.chip) bgm.chip.volume = 1 - t;
      }
    },
  };
  return api;
})();
