// Boot, main loop, scaling and new game / load game.
'use strict';

G.Main = {
  canvas: null,
  ctx: null,

  async boot() {
    const canvas = (this.canvas = document.getElementById('screen'));
    const ctx = (this.ctx = canvas.getContext('2d'));
    ctx.imageSmoothingEnabled = false;
    this.setupScale();
    this.setupButtons();
    try {
      await Promise.all([G.Data.load(), G.Font.init()]);
      await G.Assets.loadAll(['sprites/ui/types.png', 'sprites/ui/battle/icon_statuses.png']);
    } catch (e) {
      document.getElementById('loading').textContent = 'Failed to load game data: ' + e.message;
      console.error(e);
      return;
    }
    document.getElementById('loading').remove();
    G.Scenes.replaceAll(new G.TitleScene());
    G.Fade.alpha = 1;
    let last = performance.now(), acc = 0, lastRaf = 0;
    const STEP = 1 / 60;
    const frame = (now, fromTimer) => {
      if (!fromTimer) lastRaf = now;
      const speed = G.speed || 1; // >1 only from debug mode (fast-forward)
      acc += Math.min(0.25, (now - last) / 1000) * speed;
      last = now;
      if (G.paused) acc = 0; // debug mode drives frames itself (G.Main.step)
      let steps = 0;
      while (acc >= STEP && steps < 4 * speed) {
        this.step();
        acc -= STEP; steps++;
      }
      if (steps === 4 * speed) acc = 0;
      ctx.imageSmoothingEnabled = false;
      G.Scenes.draw(ctx);
      G.Fade.draw(ctx);
      if (!fromTimer) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    // If the browser throttles animation frames (e.g. an embedded or
    // partially hidden view), keep the game ticking with a timer.
    setInterval(() => {
      const now = performance.now();
      if (now - lastRaf > 120) frame(now, true);
    }, 16);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !(e.target && e.target.tagName === 'INPUT')) this.toggleMute();
    });
  },

  // One 1/60 s game update.
  step() {
    G.dt = 1 / 60;
    G.time += G.dt;
    G.Input.update();
    if (G.Input.trigger('A') || G.Input.trigger('START')) G.Audio.unlock();
    G.Scenes.update();
    G.Audio.update();
  },
  draw() {
    this.ctx.imageSmoothingEnabled = false;
    G.Scenes.draw(this.ctx);
    G.Fade.draw(this.ctx);
  },

  setupScale() {
    const sel = document.getElementById('scaleSel');
    let scale = 3;
    try { scale = Number(localStorage.getItem('gegk-adventure.scale')) || 3; } catch (e) { /* storage blocked */ }
    sel.value = String(scale);
    const apply = () => {
      // Use the chosen scale, shrinking it if the window is too small to fit.
      const fit = Math.max(1, Math.min(Math.floor(window.innerWidth / 240), Math.floor((window.innerHeight - 40) / 160)));
      const s = Math.min(Number(sel.value), fit);
      this.canvas.style.width = 240 * s + 'px';
      this.canvas.style.height = 160 * s + 'px';
      // a bigger scale than the window can show is shrunk to fit
      const note = document.getElementById('scaleNote');
      if (note) note.textContent = s < Number(sel.value) ? `(${s}× to fit the window)` : '';
      try { localStorage.setItem('gegk-adventure.scale', sel.value); } catch (e) { /* ignore */ }
    };
    sel.addEventListener('change', () => { apply(); this.canvas.focus(); });
    window.addEventListener('resize', apply);
    apply();
  },
  setupButtons() {
    document.getElementById('btnExport').addEventListener('click', () => {
      const n = G.Save.exportAll();
      if (!n) alert('There are no saves to export yet.');
      this.canvas.focus();
    });
    const file = document.getElementById('importFile');
    document.getElementById('btnImport').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      const res = G.Save.importAll(await f.text());
      alert(res.message);
      file.value = '';
      this.canvas.focus();
    });
    document.getElementById('btnMute').addEventListener('click', () => { this.toggleMute(); this.canvas.focus(); });
  },
  toggleMute() {
    G.Audio.setMuted(!G.Audio.muted);
    document.getElementById('btnMute').textContent = 'Sound: ' + (G.Audio.muted ? 'off' : 'on');
  },
  applyOptions() {
    const o = G.Game.options;
    G.Audio.setOptions({ music: o.musicVolume / 10, sfx: o.sfxVolume / 10 });
  },

  // Options can be opened from the main menu before a game exists.
  ensureTempGame() {
    if (!G.Game) {
      G.Game = new G.GameState();
      try { Object.assign(G.Game.options, JSON.parse(localStorage.getItem('gegk-adventure.options') || '{}')); } catch (e) { /* ignore */ }
      G.Game.temp = true;
    }
  },
  *startWorld(mapId, x, y, dir) {
    G.Screen.reset();
    G.World.cache = {};
    const scene = new G.MapSceneClass();
    const pc = new G.Player();
    G.Game.playerChar = pc;
    let done = false, err = null;
    G.World.setup(mapId).then(() => { done = true; }, (e) => { err = e; done = true; });
    while (!done) yield;
    if (err) throw err;
    pc.refreshCharset();
    pc.moveto(x, y);
    pc.direction = dir || 2;
    // The map scene replaces the menu that called us; it fades itself in.
    scene.current = G.Fade.in(0.4);
    G.Scenes.replaceAll(scene);
    scene.lastArea = G.World.map.name;
    G.Game.global.visited[mapId] = true;
    scene.autoplayBGM();
    this.applyOptions();
  },
  *newGame() {
    const opts = G.Game && G.Game.temp ? G.Game.options : null;
    G.Game = new G.GameState();
    if (opts) G.Game.options = opts;
    const sys = G.Data.system;
    G.Audio.stopBGM();
    yield* this.startWorld(sys.startMap, sys.startX, sys.startY, 2);
    G.MapScene.current = null;
    G.Fade.alpha = 0;
  },
  *loadGame(slot) {
    const data = G.Save.read(slot);
    if (!data) return;
    G.Game = new G.GameState(data);
    const pos = data.position || { map: 7, x: 25, y: 6, dir: 2 };
    yield* this.startWorld(pos.map, pos.x, pos.y, pos.dir);
    if (slot !== 'auto') G.Game.global.lastSaveSlot = slot;
  },
};

window.addEventListener('load', () => { G.Main.boot(); document.getElementById('screen').focus(); });
