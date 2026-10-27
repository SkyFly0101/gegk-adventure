// Screen effects driven by events: tone (fades / tints), flash, shake,
// weather and "pictures" (images shown during cutscenes like Oak's intro).
'use strict';

// A value that eases from one array of numbers to another over time.
class Tween {
  constructor(v) { this.cur = v.slice(); this.from = v.slice(); this.to = v.slice(); this.start = 0; this.len = 0; }
  set(target, sec) {
    this.from = this.cur.slice(); this.to = target.slice(); this.start = G.time; this.len = sec;
    if (sec <= 0) this.cur = target.slice();
  }
  update() {
    if (this.len <= 0) { this.cur = this.to.slice(); return; }
    const t = Math.min(1, (G.time - this.start) / this.len);
    this.cur = this.from.map((f, i) => f + (this.to[i] - f) * t);
    if (t >= 1) this.len = 0;
  }
  get busy() { return this.len > 0 && G.time - this.start < this.len; }
}

// Applies an RGSS tone [r, g, b, gray] to whatever is already drawn in the rect.
function applyTone(ctx, tone, x = 0, y = 0, w = G.Config.WIDTH, h = G.Config.HEIGHT) {
  const [r, g, b] = tone;
  if (!r && !g && !b) return;
  ctx.save();
  if (r < 0 || g < 0 || b < 0) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${255 + Math.min(r, 0)},${255 + Math.min(g, 0)},${255 + Math.min(b, 0)})`;
    ctx.fillRect(x, y, w, h);
  }
  if (r > 0 || g > 0 || b > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgb(${Math.max(r, 0)},${Math.max(g, 0)},${Math.max(b, 0)})`;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

G.Picture = class Picture {
  constructor() { this.name = ''; }
  show(name, origin, x, y, zx, zy, opacity, blend) {
    this.name = name;
    this.origin = origin;
    this.pos = new Tween([x, y, zx, zy, opacity]);
    this.blend = blend;
    this.angle = 0; this.rotSpeed = 0;
    this.tone = new Tween([0, 0, 0, 0]);
    if (name) G.Assets.load(G.Assets.picture(name));
  }
  move(sec, origin, x, y, zx, zy, opacity, blend) {
    this.origin = origin; this.blend = blend;
    this.pos.set([x, y, zx, zy, opacity], sec);
  }
  erase() { this.name = ''; }
  update() {
    if (!this.name) return;
    this.pos.update(); this.tone.update();
    if (this.rotSpeed) this.angle += this.rotSpeed * 2 * G.dt * 20;
  }
  draw(ctx) {
    if (!this.name) return;
    const img = G.Assets.get(G.Assets.picture(this.name));
    if (!img) return;
    const [kx, ky, zx, zy, op] = this.pos.cur;
    // Kit coordinates are for a 512x384 screen around a 480x320 (2x GBA) area.
    const x = (kx - 16) / 2, y = (ky - 32) / 2;
    const w = img.width * zx / 100, h = img.height * zy / 100;
    ctx.save();
    ctx.globalAlpha = G.U.clamp(op / 255, 0, 1);
    if (this.blend === 1) ctx.globalCompositeOperation = 'lighter';
    ctx.translate(Math.round(x), Math.round(y));
    if (this.angle) ctx.rotate(-this.angle * Math.PI / 180);
    const dx = this.origin === 1 ? -w / 2 : 0, dy = this.origin === 1 ? -h / 2 : 0;
    // Tone a picture by drawing it to a scratch canvas first.
    const t = this.tone.cur;
    if (t[0] || t[1] || t[2]) {
      const c = G.Screen.scratch(img.width, img.height);
      const cx = c.getContext('2d');
      cx.clearRect(0, 0, c.width, c.height);
      cx.drawImage(img, 0, 0);
      applyTone(cx, t, 0, 0, img.width, img.height);
      cx.globalCompositeOperation = 'destination-in';
      cx.drawImage(img, 0, 0);
      cx.globalCompositeOperation = 'source-over';
      ctx.drawImage(c, 0, 0, img.width, img.height, Math.round(dx), Math.round(dy), w, h);
    } else ctx.drawImage(img, Math.round(dx), Math.round(dy), w, h);
    ctx.restore();
  }
};

G.Screen = {
  tone: new Tween([0, 0, 0, 0]),
  flash: null,
  shake: null,
  pictures: [],
  weather: { type: 0, power: 0, particles: [] },
  _scratch: null,
  scratch(w, h) {
    if (!this._scratch || this._scratch.width < w || this._scratch.height < h) {
      this._scratch = document.createElement('canvas');
      this._scratch.width = Math.max(w, 256); this._scratch.height = Math.max(h, 256);
    }
    return this._scratch;
  },
  reset() {
    this.tone = new Tween([0, 0, 0, 0]);
    this.flash = null; this.shake = null;
    this.pictures = [];
    this.weather = { type: 0, power: 0, particles: [] };
  },
  picture(n) { return (this.pictures[n] = this.pictures[n] || new G.Picture()); },
  startTone(tone, sec) { this.tone.set(tone, sec); },
  toneAll(tone, sec) {
    this.tone.set(tone, sec);
    for (const p of this.pictures) if (p && p.name) p.tone.set(tone, sec);
  },
  startFlash(color, sec) { this.flash = { color, start: G.time, len: Math.max(sec, 0.01) }; },
  startShake(power, speed, sec) { this.shake = { power, speed, until: G.time + sec }; },
  setWeather(type, power) { this.weather.type = type; this.weather.power = power; },
  shakeOffset() {
    if (!this.shake || G.time > this.shake.until) { this.shake = null; return 0; }
    return Math.round(Math.sin(G.time * this.shake.speed * 6) * this.shake.power);
  },
  update() {
    this.tone.update();
    for (const p of this.pictures) if (p) p.update();
    if (this.weather.type) this.updateWeather();
  },
  updateWeather() {
    const w = this.weather;
    const want = w.power * 6;
    while (w.particles.length < want) w.particles.push({ x: Math.random() * 260, y: Math.random() * 180 - 20, s: 0.5 + Math.random() });
    w.particles.length = Math.min(w.particles.length, want);
    for (const p of w.particles) {
      if (w.type === 1 || w.type === 2) { p.x -= 60 * G.dt * p.s; p.y += 220 * G.dt * p.s; }
      else { p.x -= 15 * G.dt * p.s; p.y += 30 * G.dt * p.s; }
      if (p.y > 170 || p.x < -10) { p.y = -10; p.x = Math.random() * 260; }
    }
  },
  // Map-layer effects (tone tints the map; pictures are drawn after).
  drawMapEffects(ctx) {
    const w = this.weather;
    if (w.type) {
      ctx.fillStyle = w.type === 3 ? '#f8f8f8' : 'rgba(200,220,255,0.8)';
      for (const p of w.particles) ctx.fillRect(Math.round(p.x), Math.round(p.y), w.type === 3 ? 2 : 1, w.type === 3 ? 2 : 4);
    }
    applyTone(ctx, this.tone.cur);
  },
  drawPictures(ctx) {
    for (const p of this.pictures) if (p) p.draw(ctx);
  },
  drawFlash(ctx) {
    const f = this.flash;
    if (!f) return;
    const t = (G.time - f.start) / f.len;
    if (t >= 1) { this.flash = null; return; }
    const [r, g, b, a] = f.color;
    ctx.fillStyle = `rgba(${r},${g},${b},${(a / 255) * (1 - t)})`;
    ctx.fillRect(0, 0, G.Config.WIDTH, G.Config.HEIGHT);
  },
};
G.applyTone = applyTone;
