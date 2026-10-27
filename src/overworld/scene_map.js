// The overworld scene: updates the world, runs events, draws the map with
// correct tile/character layering, and handles map transfers.
'use strict';

G.MapSceneClass = class MapScene extends G.Scene {
  constructor() {
    super();
    this.interpreter = new G.Interpreter(false);
    this.messageBox = new G.MessageBox();
    this.cam = { x: 0, y: 0 };
    this.scroll = { x: 0, y: 0 };   // event-driven map scrolling offset
    this.queueList = [];
    this.current = null;            // running queued coroutine
    this.overlay = null;
    this.areaPopup = null;
    this.saveIcon = 0;
    this.lastArea = null;
    this.transferring = false;
    G.MapScene = this;
  }

  // Run a coroutine (or a function returning one) on the map when idle.
  queue(fn) { this.queueList.push(fn); }

  autoplayBGM() {
    const m = G.World.map;
    if (G.Game.global.surfing) return G.Audio.playMusicKey('surf');
    if (G.Game.global.bicycle) return G.Audio.playMusicKey('bicycle');
    if (m.data.bgm) G.Audio.playBGM(m.data.bgm);
  }

  // --------------------------------------------------------------- update
  update() {
    const g = G.Game;
    g.player.playTime += G.dt;
    G.Screen.update();
    if (this.transferring) {
      // A transfer is in progress inside an event or a queued coroutine:
      // keep that coroutine running, but freeze the world meanwhile.
      if (this.current) this.runCurrent();
      else if (this.interpreter.running()) this.interpreter.update();
      return;
    }

    // queued coroutines (wild battles, whiteouts, step messages...)
    if (this.current || (this.queueList.length && !this.interpreter.running())) {
      if (!this.current) { const f = this.queueList.shift(); this.current = typeof f === 'function' ? f() : f; }
      this.runCurrent();
      G.World.update();
      g.playerChar.update();
      return;
    }

    G.World.update();
    g.playerChar.update();

    // Like Essentials' Interpreter#update: when an event finishes, the next
    // starting event is set up in the same frame (an event the player stands
    // on can't starve an autorun cutscene this way).
    let started = this.interpreter.running();
    if (started) this.interpreter.update();
    for (let i = 0; i < 8 && !this.interpreter.running(); i++) {
      if (!this.setupStartingEvent()) break;
      started = true;
    }
    if (!started && !this.interpreter.running()) {
      if (G.Save.pending) G.Save.autosave(G.Save.pending.reason, G.Save.pending.force);
      this.checkPlayerInput();
    }
    this.checkAutosaveTimer();
    if (this.pendingCredits) { this.pendingCredits = false; this.queue(() => G.Story.endingCredits()); }
  }
  runCurrent() {
    if (!this.current) return;
    try {
      const r = this.current.next();
      if (r.done) this.current = null;
    } catch (e) {
      console.error('Map coroutine error:', e);
      this.current = null; this.transferring = false; this.messageBox.close();
      G.Fade.alpha = 0;
    }
  }
  setupStartingEvent() {
    // Switch changes from the last event must flip pages (and clear stale
    // "starting" flags) before another event is picked.
    for (const m of G.World.maps) if (m.needRefresh) m.refresh();
    for (const ev of Object.values(G.World.map.events)) {
      if (!ev.starting) continue;
      if (ev.trigger < 3) { ev.clearStarting(); ev.lock(); }
      this.interpreter.setup(ev.list, ev.id, G.World.map.id);
      this.interpreter.update();
      return true;
    }
    // Autorun common events
    for (const ce of G.Data.common_events) {
      if (ce && ce.trigger === 1 && G.Game.switches.get(ce.switch)) {
        this.interpreter.setup(ce.list, 0, G.World.map.id);
        return true;
      }
    }
    return false;
  }
  checkPlayerInput() {
    const p = G.Game.playerChar;
    if (p.moving() || p.jumping() || p.moveRouteForcing) return;
    if (G.Input.trigger('A')) {
      if (p.checkEventTriggerHere([0]) || p.checkEventTriggerThere([0, 1, 2])) return;
      this.queue(function* () { yield* G.Field.checkFacingTile(); });
    } else if (G.Input.trigger('START')) {
      G.Audio.sfx('menuOpen');
      this.queue(function* () { yield* G.Scenes.call(new G.StartMenuScene()); });
    } else if (G.Input.trigger('SELECT')) {
      this.queue(function* () { yield* G.Menus.useRegisteredItem(); });
    }
  }

  // ------------------------------------------------------------- transfers
  *transferPlayer(mapId, x, y, dir, fade = true, { noFadeOut = false } = {}) {
    this.transferring = true;
    const p = G.Game.playerChar;
    if (fade && !noFadeOut) yield* G.Fade.out(0.2);
    else if (!noFadeOut) G.Fade.alpha = 1;
    const oldMap = G.World.map ? G.World.map.id : null;
    if (oldMap) this.lastTransferFrom = { map: oldMap, x: p.x, y: p.y, dir: p.direction };
    let done = false, err = null;
    G.World.setup(mapId).then(() => { done = true; }, (e) => { err = e; done = true; });
    while (!done) yield;
    if (err) { console.error(err); this.transferring = false; G.Fade.alpha = 0; return; }
    p.moveto(x, y);
    if (dir) p.direction = dir;
    p.straighten();
    p.moveRouteForcing = false;
    this.messageBox.close();
    if (oldMap !== mapId) this.onMapChanged(false);
    this.updateCamera(true);
    G.World.map.refresh();
    if (fade || noFadeOut) yield* G.Fade.in(0.2);
    else G.Fade.alpha = 0;
    this.transferring = false;
  }
  // Dark caves (Rock Tunnel): only a small circle around the player is lit
  // until Flash is used on this map, which widens it.
  drawDarkness(ctx, cam) {
    const m = G.World.map;
    if (!m.meta.DarkMap) { this.darkRadius = null; return; }
    const target = G.Game.global.flash === m.id ? 112 : 24;
    if (this.darkRadius == null || this.darkRadiusMap !== m.id) { this.darkRadius = target; this.darkRadiusMap = m.id; }
    this.darkRadius += Math.sign(target - this.darkRadius) * Math.min(Math.abs(target - this.darkRadius), 2);
    if (this.darkRadius >= 112) return;
    const c = this.darkCanvas || (this.darkCanvas = Object.assign(document.createElement('canvas'), { width: G.Config.WIDTH, height: G.Config.HEIGHT }));
    const d = c.getContext('2d');
    const pc = G.Game.playerChar;
    const cx = Math.round(pc.realX - cam.x + 8), cy = Math.round(pc.realY - cam.y + 8);
    d.globalCompositeOperation = 'source-over';
    d.fillStyle = '#000';
    d.fillRect(0, 0, c.width, c.height);
    d.globalCompositeOperation = 'destination-out';
    // hard-edged pixel circle, like the GBA window effect
    const r = this.darkRadius;
    for (let y = -r; y <= r; y++) {
      const hw = Math.floor(Math.sqrt(r * r - y * y));
      d.fillRect(cx - hw, cy + y, hw * 2, 1);
    }
    ctx.drawImage(c, 0, 0);
  }
  // Called after any map change (door, warp, or walking across a connection).
  onMapChanged(walked) {
    const m = G.World.map;
    G.Game.global.visited[m.id] = true;
    if (G.Game.global.flash !== m.id) G.Game.global.flash = 0; // Flash only lasts on its map
    G.Field.onSafariMapChange();
    // Escape Rope / Dig return to the last door taken from outdoors.
    const from = this.lastTransferFrom, fromMeta = from && G.Data.map_metadata[from.map];
    if (!walked && from && fromMeta && fromMeta.Outdoor && !m.meta.Outdoor) {
      G.Game.global.escapePoint = { map: from.map, x: from.x - G.U.dx(from.dir), y: from.y - G.U.dy(from.dir), dir: 10 - from.dir };
    }
    if (m.meta.Outdoor === false || !m.meta.Outdoor) G.Game.global.bicycle = G.Game.global.bicycle && !!m.meta.Bicycle;
    if (G.Game.global.surfing && !walked) { G.Game.global.surfing = false; }
    G.Game.playerChar.refreshCharset();
    this.autoplayBGM();
    G.Field.stepCount = 0;
    G.Game.playerChar.makeEncounterCount();
    // FRLG-style location popup for towns and routes
    const name = m.name;
    if (m.meta.ShowArea && name !== this.lastArea) this.areaPopup = { name, start: G.time };
    this.lastArea = name;
    // Remember fly points (healing spots of towns)
    if (m.meta.HealingSpot && m.meta.Outdoor) G.Game.global.flyPoints[m.id] = true;
    G.Save && G.Save.autosave('enter');
  }
  // Event command 203: scroll the camera
  *scrollMap(dir, dist, speed) {
    const total = dist * 16;
    const time = 2 / Math.pow(2, speed) * dist;
    const start = G.time;
    const sx = this.scroll.x, sy = this.scroll.y;
    while (G.time - start < time) {
      const t = (G.time - start) / time;
      this.scroll.x = sx + G.U.dx(dir) * total * t;
      this.scroll.y = sy + G.U.dy(dir) * total * t;
      yield;
    }
    this.scroll.x = sx + G.U.dx(dir) * total;
    this.scroll.y = sy + G.U.dy(dir) * total;
  }
  // Overworld animations from the kit (data/map_animations.json): played on
  // a tile at 20 frames per second, like RMXP.
  // `only` keeps just the frames using those cell patterns; `fps` overrides
  // the speed.
  playMapAnimation(id, map, x, y, { only = null, fps = 20 } = {}) {
    const a = G.Data.map_animations && G.Data.map_animations[id];
    if (!a) return;
    const frames = only ? a.frames.filter((f) => f.length && f.every((c) => only.includes(c[0]))) : a.frames;
    (this.mapAnims = this.mapAnims || []).push({ a, frames, fps, map, x, y, t0: G.time });
    G.Assets.get(`sprites/animations/${a.graphic}.png`); // start loading
  }
  // Grass you walk into sways for a moment: the top of the tile (the blades)
  // is redrawn shifted left/right, wrapping the tile's own pixels.
  shakeGrass(map, x, y) {
    (this.grassShakes = this.grassShakes || []).push({ map, x, y, t0: G.time });
  }
  drawGrassShakes(ctx, cam) {
    if (!this.grassShakes || !this.grassShakes.length) return;
    const SWAY = [1, -1, 1, -1, 0]; // offset per step, 0.07 s each
    this.grassShakes = this.grassShakes.filter((s) => G.time - s.t0 < SWAY.length * 0.07 && G.World.maps.includes(s.map));
    const c = this.grassCanvas || (this.grassCanvas = Object.assign(document.createElement('canvas'), { width: 16, height: 16 }));
    const g = c.getContext('2d');
    for (const s of this.grassShakes) {
      const dx = SWAY[Math.floor((G.time - s.t0) / 0.07)] || 0;
      if (!dx) continue;
      const m = s.map;
      g.clearRect(0, 0, 16, 16);
      for (let z = 0; z < 3; z++) {
        const id = m.tileId(s.x, s.y, z);
        if (id && m.priority(id) === 0) G.Tilemap.drawTile(g, m.tileset, id, 0, 0);
      }
      const sx = (s.x + m.ox) * 16 - cam.x, sy = (s.y + m.oy) * 16 - cam.y;
      // the tips move most: rows 0-5 by 2*dx, rows 6-10 by dx; the base stays
      for (const [y0, y1, off] of [[0, 6, 2 * dx], [6, 11, dx]]) {
        const h = y1 - y0, o = ((off % 16) + 16) % 16;
        ctx.drawImage(c, 0, y0, 16 - o, h, sx + o, sy + y0, 16 - o, h);
        if (o) ctx.drawImage(c, 16 - o, y0, o, h, sx, sy + y0, o, h);
      }
    }
  }
  drawMapAnimations(ctx, cam) {
    if (!this.mapAnims || !this.mapAnims.length) return;
    this.mapAnims = this.mapAnims.filter((s) => (G.time - s.t0) * s.fps < s.frames.length && G.World.maps.includes(s.map));
    for (const s of this.mapAnims) {
      const img = G.Assets.get(`sprites/animations/${s.a.graphic}.png`);
      if (!img) continue;
      const CELL = 96, cols = Math.max(1, Math.floor(img.width / CELL));
      const frame = s.frames[Math.floor((G.time - s.t0) * s.fps)] || [];
      // position 2 = the bottom of the tile, as for characters
      const cx = (s.x + s.map.ox) * 16 + 8 - cam.x, cy = (s.y + s.map.oy) * 16 + 16 - cam.y;
      for (const [pat, x, y, zoom, , mirror, opacity] of frame) {
        const z = zoom / 100;
        ctx.save();
        ctx.globalAlpha = G.U.clamp(opacity / 255, 0, 1);
        ctx.translate(Math.round(cx + x / 2), Math.round(cy + y / 2));
        ctx.scale(mirror ? -z : z, z);
        ctx.drawImage(img, (pat % cols) * CELL, Math.floor(pat / cols) * CELL, CELL, CELL, -CELL / 2, -CELL / 2, CELL, CELL);
        ctx.restore();
      }
    }
  }
  showAnimation(ch, id) { ch.bubble = { kind: id === 3 ? 'question' : 'exclamation', until: G.time + 0.8 }; }

  checkAutosaveTimer() {
    const g = G.Game;
    g.global.autosaveTimer = (g.global.autosaveTimer || 0) + G.dt;
    if (g.global.autosaveTimer >= G.Config.AUTOSAVE_INTERVAL && !this.interpreter.running()) {
      g.global.autosaveTimer = 0;
      G.Save.autosave('timer');
    }
  }

  // ---------------------------------------------------------------- draw
  updateCamera() {
    const p = G.Game.playerChar;
    this.cam.x = Math.round(p.realX + 8 - G.Config.WIDTH / 2 + this.scroll.x);
    this.cam.y = Math.round(p.realY + 8 - G.Config.HEIGHT / 2 + this.scroll.y);
  }
  draw(ctx) {
    const W = G.Config.WIDTH, H = G.Config.HEIGHT;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (!G.World.map || !G.Game.playerChar) return;
    this.updateCamera();
    const shake = G.Screen.shakeOffset();
    const cam = { x: this.cam.x - shake, y: this.cam.y };
    const sprites = [];
    // Tiles
    for (const m of G.World.maps) {
      const ts = m.tileset;
      const wx0 = Math.floor(cam.x / 16) - 1, wy0 = Math.floor(cam.y / 16) - 1;
      const x0 = Math.max(0, wx0 - m.ox), x1 = Math.min(m.width - 1, wx0 + 17 - m.ox);
      const y0 = Math.max(0, wy0 - m.oy), y1 = Math.min(m.height - 1, wy0 + 12 - m.oy);
      for (let ty = y0; ty <= y1; ty++) {
        const sy = (ty + m.oy) * 16 - cam.y;
        if (sy < -16 || sy > H) continue;
        for (let tx = x0; tx <= x1; tx++) {
          const sx = (tx + m.ox) * 16 - cam.x;
          if (sx < -16 || sx > W) continue;
          for (let z = 0; z < 3; z++) {
            const id = m.tileId(tx, ty, z);
            if (!id) continue;
            const pr = m.priority(id);
            if (pr === 0) G.Tilemap.drawTile(ctx, ts, id, sx, sy);
            else sprites.push({ z: sy + 16 + pr * 16 + 1, tile: true, ts, id, sx, sy, order: z });
          }
        }
      }
      for (const ev of Object.values(m.events)) {
        if ((!ev.characterName && !ev.tileId) || ev.transparent) continue;
        sprites.push({ z: ev.zIndex(cam), ch: ev, order: 10 });
      }
    }
    this.drawGrassShakes(ctx, cam);
    const pc = G.Game.playerChar;
    // The intro map (Oak's speech) never shows the player character.
    if (G.World.map.id !== 1) sprites.push({ z: pc.zIndex(cam), ch: pc, order: 11 });
    sprites.sort((a, b) => a.z - b.z || a.order - b.order);
    for (const s of sprites) {
      if (s.tile) G.Tilemap.drawTile(ctx, s.ts, s.id, s.sx, s.sy);
      else s.ch.draw(ctx, cam);
    }
    this.drawMapAnimations(ctx, cam);
    this.drawDarkness(ctx, cam);
    G.Screen.drawMapEffects(ctx);
    G.Screen.drawPictures(ctx);
    G.Screen.drawFlash(ctx);
    this.drawAreaPopup(ctx);
    this.messageBox.draw(ctx);
    if (this.overlay) this.overlay.draw(ctx);
    G.Save && G.Save.drawIcon(ctx);
  }
  drawAreaPopup(ctx) {
    const a = this.areaPopup;
    if (!a) return;
    const t = G.time - a.start;
    if (t > 2.4) { this.areaPopup = null; return; }
    const slide = t < 0.25 ? t / 0.25 : t > 2.1 ? (2.4 - t) / 0.3 : 1;
    const w = Math.max(80, G.Font.width(a.name) + 20);
    const y = Math.round(-26 + 30 * slide);
    G.UI.frame(ctx, 2, y, w, 24, 'sign');
    G.Font.draw(ctx, a.name, 2 + w / 2, y + 5, 'dark', { align: 'center' });
  }
};
