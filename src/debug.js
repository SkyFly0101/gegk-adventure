// Debug helpers, loaded only when the page URL contains ?debug.
// Use them from the browser console, e.g.  G.Debug.warp(39, 22, 20)
'use strict';

G.Debug = {
  // Teleport to a map (ids are listed in data/mapinfos.json)
  warp(map, x, y, dir = 2) { G.MapScene.queue(() => G.MapScene.transferPlayer(map, x, y, dir, true)); },
  give(species, level = 5) { const p = new G.Pokemon(species.toUpperCase(), level); G.Game.addPokemon(p); return p; },
  item(id, n = 1) { G.Game.bag.add(id.toUpperCase(), n); },
  heal() { G.Game.healParty(); },
  money(n) { G.Game.player.money = n; },
  badges(n) { for (let i = 0; i < 8; i++) G.Game.player.badges[i] = i < n; },
  switchOn(id, v = true) { G.Game.switches.set(id, v); },
  battle(species, level) { G.MapScene.queue(() => G.Battle.startWild(new G.Pokemon(species.toUpperCase(), level), {})); },
  trainer(type, name, v = 0) { G.MapScene.queue(() => G.Battle.startTrainer(new G.Trainer(type, name, v), {})); },
  // Jump straight to "just left Oak's Lab with a starter" (for testing later content).
  *skipIntroGen(starter = 'CHARMANDER', gender = 'male') {
    G.Game = new G.GameState();
    G.Bridge.fns.pbChangePlayer(gender === 'female' ? 2 : 1);
    G.Game.switches.data[gender === 'female' ? 37 : 36] = true;
    yield* G.Main.startWorld(5, 28, 14, 2);
    G.Game.addPokemon(new G.Pokemon(starter, 5));
    G.Game.variables.set(76, { BULBASAUR: 1, SQUIRTLE: 2, CHARMANDER: 3 }[starter] || 3);
    for (const s of [78, 79]) G.Game.switches.set(s, true);
    G.Game.selfSwitches.set(1, 3, 'A', true);
    G.Game.selfSwitches.set(6, 16, 'A', true);
    G.Game.player.gender = gender;
    G.Game.playerChar.refreshCharset();
  },
  // From the title screen: load a save slot directly.
  load(slot) { G.Scenes.top().co = G.Main.loadGame(slot); },
  // Walkable tiles on the current map's edge that lead into a connected map.
  exits(dir = 8) {
    const m = G.World.map, out = [];
    const n = dir === 2 || dir === 8 ? m.width : m.height;
    for (let i = 0; i < n; i++) {
      const x = dir === 2 || dir === 8 ? i : dir === 4 ? 0 : m.width - 1;
      const y = dir === 4 || dir === 6 ? i : dir === 8 ? 0 : m.height - 1;
      if (m.playerPassable(x, y, dir) && G.World.mapAt(x + G.U.dx(dir), y + G.U.dy(dir))) out.push([x, y]);
    }
    return out;
  },
  skipIntro(starter, gender) { G.Scenes.top().co = this.skipIntroGen(starter, gender); },
  missingAssets() { return { audio: [...G.Audio.missing], images: [...G.Assets.missing] }; },

  // ---- scripted input (used for automated play-testing) ----
  // Virtual time: the test scripts step the game themselves instead of
  // waiting on timers (which browsers throttle in hidden tabs).
  virtual: false,
  turbo(on = true) { this.virtual = on; G.paused = on; return on; },
  async sleep(ms) {
    if (!this.virtual) return new Promise((r) => setTimeout(r, ms));
    const n = Math.max(1, Math.round(ms / 16.67));
    const yieldNow = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
    for (let i = 0; i < n; i++) {
      G.Main.step();
      if (i % 8 === 7) await yieldNow(); // let network loads (maps, images) resolve
    }
    G.Main.draw();
    await yieldNow();
  },
  // Load a save slot in turbo mode and wait until the player can move.
  async boot(slot) {
    while (!(G.Scenes.top() instanceof G.TitleScene)) await new Promise((r) => setTimeout(r, 100));
    this.turbo(); this.load(slot);
    for (let i = 0; i < 300; i++) {
      await this.sleep(100);
      if (G.Scenes.top() === G.MapScene && G.World.map && !G.MapScene.transferring && G.Fade.alpha === 0 && G.Game.playerChar && G.Game.playerChar.map === G.World.map) { await this.sleep(300); return this.where(); }
    }
    return 'load timed out';
  },
  // Run a long async test in the background; poll G.Debug.jobs[name].
  // Cancel running goMap jobs (they check this before each hop).
  async stop() { this.abortAll = true; await new Promise((r) => setTimeout(r, 3000)); this.abortAll = false; },
  job(name, fn) {
    const j = (this.jobs = this.jobs || {})[name] = { state: 'running' };
    fn().then((r) => { j.state = 'done'; j.result = r; }, (e) => { j.state = 'error'; j.result = String(e.stack || e); });
    return 'started';
  },
  async tap(code, n = 1, gap = 120) {
    for (let i = 0; i < n; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code }));
      await this.sleep(50);
      window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code }));
      await this.sleep(gap);
    }
  },
  async walk(code, tiles) {
    const p = G.Game.playerChar;
    for (let i = 0; i < tiles; i++) {
      const sx = p.x, sy = p.y, m = G.World.map.id;
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code }));
      for (let t = 0; t < 40 && p.x === sx && p.y === sy && G.World.map.id === m; t++) await this.sleep(20);
      window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code }));
      while ((p.moving() || p.jumping()) && G.Scenes.top() === G.MapScene) await this.sleep(20); // a battle can start mid-step
      await this.sleep(30);
    }
    return [G.World.map.id, p.x, p.y];
  },
  // Walk to (tx, ty) on the current map (coordinates may lie in a connected
  // map, relative to the current one). Uses BFS over player passability.
  // Cut trees / Rock Smash rocks (on this map, or all loaded maps).
  obstacles(all = false) {
    const maps = all ? G.World.maps : [G.World.map];
    return maps.flatMap((m) => Object.values(m.events)).filter((e) => !e.erased && e.characterName && !e.through && /cut ?tree|rock ?smash|smash ?rock/i.test(e.name));
  },
  path(tx, ty, sx, sy) {
    const obs = this.obstacles(true);
    obs.forEach((e) => { e.through = true; });
    try { return this.pathRaw(tx, ty, sx, sy); } finally { obs.forEach((e) => { e.through = false; }); }
  },
  // Reach (tx, ty) on this map using its warp pads (Silph Co., Saffron Gym).
  async goWithin(tx, ty) {
    const pads = Object.values(G.World.map.events).map((e) => {
      const t = e.page && (e.page.trigger === 1 || e.page.trigger === 2) && (e.page.list || []).find((c) => c[0] === 201 && c[2][0] === 0 && c[2][1] === G.World.map.id);
      return t ? { x: e.x, y: e.y, ax: t[2][2], ay: t[2][3] } : null;
    }).filter(Boolean);
    const p = G.Game.playerChar;
    const start = [p.x, p.y];
    const prev = new Map([[start.join(','), null]]), q = [start];
    let goal = null;
    while (q.length && !goal) {
      const [x, y] = q.shift();
      if (this.path(tx, ty, x, y) || (x === tx && y === ty)) { goal = [x, y]; break; }
      for (const pad of pads) {
        const k = pad.ax + ',' + pad.ay;
        if (prev.has(k) || !this.path(pad.x, pad.y, x, y)) continue;
        prev.set(k, [x, y, pad]); q.push([pad.ax, pad.ay]);
      }
    }
    if (!goal) return 'no pad route';
    const steps = [];
    for (let k = goal.join(','); prev.get(k); ) { const [x, y, pad] = prev.get(k); steps.unshift(pad); k = x + ',' + y; }
    for (const pad of steps) {
      const r = await this.travel(pad.x, pad.y);
      for (let w = 0; w < 40 && !(p.x === pad.ax && p.y === pad.ay && !G.MapScene.interpreter.running()); w++) await this.sleep(100);
      if (!(p.x === pad.ax && p.y === pad.ay)) return 'pad failed: ' + r;
    }
    return this.travel(tx, ty);
  },
  canSurf() { return G.Field.canUseFieldMove('SURF') && !!G.Field.partyWithMove('SURF'); },
  // Tiles with warp events (doors, ladders, Silph Co. pads) on the current map.
  warpTiles() {
    const out = new Set();
    for (const e of Object.values(G.World.map.events)) {
      const pg = e.page;
      if (!pg || (pg.trigger !== 1 && pg.trigger !== 2) || !(pg.list || []).some((c) => c[0] === 201)) continue;
      for (let i = 0; i < (e.width || 1); i++) for (let j = 0; j < (e.height || 1); j++) out.add((e.x + i) + ',' + (e.y - j));
    }
    return out;
  },
  pathRaw(tx, ty, sx = G.Game.playerChar.x, sy = G.Game.playerChar.y) {
    const p = G.Game.playerChar, m = G.World.map;
    const warps = this.warpTiles();
    const key = (x, y) => x + ',' + y;
    const prev = new Map([[key(sx, sy), null]]);
    const q = [[sx, sy]];
    while (q.length) {
      const [x, y] = q.shift();
      if (x === tx && y === ty) break;
      for (const d of [2, 4, 6, 8]) {
        const nx = x + G.U.dx(d), ny = y + G.U.dy(d);
        const k = key(nx, ny);
        if (prev.has(k) || prev.size > 20000) continue;
        if (!G.World.mapAt(nx, ny)) continue;
        if (warps.has(k) && !(nx === tx && ny === ty)) continue; // don't step on warps on the way
        const ox = p.x, oy = p.y; p.x = x; p.y = y;
        let ok = p.passable(x, y, d);
        const water = (wx, wy) => m.valid(wx, wy) && G.Terrain.canSurfFreely(m.terrainTag(wx, wy));
        if (!ok && this.canSurf() && (water(nx, ny) || water(x, y))) {
          // onto / across water with Surf
          const g = G.Game.global, was = g.surfing; g.surfing = true;
          ok = p.passable(x, y, d);
          g.surfing = was;
        }
        const ledge = ok && m.valid(nx, ny) && m.terrainTag(nx, ny) === G.Terrain.Ledge;
        const jx = nx + G.U.dx(d), jy = ny + G.U.dy(d);
        const jumpOk = ledge && p.jumpPassable(jx, jy);
        p.x = ox; p.y = oy;
        if (!ok) continue;
        if (ledge) {
          // walking into a ledge jumps over it
          const jk = key(jx, jy);
          if (!jumpOk || prev.has(jk)) continue;
          prev.set(jk, [x, y, d]);
          q.push([jx, jy]);
          continue;
        }
        prev.set(k, [x, y, d]);
        q.push([nx, ny]);
      }
    }
    if (!prev.has(key(tx, ty))) return null;
    const dirs = [];
    for (let k = key(tx, ty); prev.get(k); ) { const [x, y, d] = prev.get(k); dirs.unshift(d); k = key(x, y); }
    return dirs;
  },
  async goto(tx, ty) {
    const dirs = this.path(tx, ty);
    if (!dirs) return 'no path';
    const codes = { 2: 'ArrowDown', 4: 'ArrowLeft', 6: 'ArrowRight', 8: 'ArrowUp' };
    const p = G.Game.playerChar;
    for (const d of dirs) {
      if (G.Scenes.top() !== G.MapScene || G.MapScene.interpreter.running() || G.MapScene.current) return 'interrupted';
      const m = G.World.map, nx = p.x + G.U.dx(d), ny = p.y + G.U.dy(d);
      if (!G.Game.global.surfing && m.valid(nx, ny) && G.Terrain.canSurfFreely(m.terrainTag(nx, ny))) {
        // start surfing: face the water and press A
        p.direction = d;
        await this.tap('KeyZ');
        await this.play({ choices: [0] });
        return 'interrupted';
      }
      const ob = this.obstacles().find((e) => e.x === nx && e.y === ny);
      if (ob) {
        // face it and use Cut / Rock Smash
        p.direction = d;
        await this.tap('KeyZ');
        await this.play({ choices: [0] });
        return 'interrupted';
      }
      const mapBefore = G.World.map;
      await this.walk(codes[d], 1);
      if (G.World.map !== mapBefore) return 'map changed';
    }
    return 'ok';
  },
  // Like goto, but keeps going through wild battles (running away) and
  // dialogue. Stops at trainer battles only if fightTrainers is false.
  async travel(tx, ty, { maxTries = 200, maxMs = 35000 } = {}) {
    const t0 = performance.now();
    for (let i = 0; i < maxTries; i++) {
      if (performance.now() - t0 > maxMs) return 'timeout (call again)';
      const top = G.Scenes.top();
      if (top instanceof G.BattleScene) {
        if (top.wild) { await this.runAway(); continue; }
        await this.autoBattle();
        if (this.autoHeal) G.Game.healParty(); // test convenience: G.Debug.autoHeal = true
        continue;
      }
      if (G.MapScene.messageBox.active && top === G.MapScene) { await this.tap('KeyZ', 1, 60); await this.sleep(200); continue; }
      if (G.MapScene.current || G.MapScene.transferring) { await this.sleep(200); i--; continue; }
      if (G.Audio.mePlaying) { await new Promise((r) => setTimeout(r, 100)); await this.sleep(16); i--; continue; }
      if (top instanceof G.NameEntryScene) { await this.tap('KeyX'); await this.sleep(250); continue; }
      if (top !== G.MapScene || G.MapScene.interpreter.running() || G.MapScene.messageBox.active) { await this.tap('KeyZ', 1, 60); await this.sleep(250); continue; }
      const p = G.Game.playerChar;
      if (p.x === tx && p.y === ty) return 'arrived';
      const r = await this.goto(tx, ty);
      if (r === 'no path') return 'no path';
      if (r === 'map changed') return 'map changed';
    }
    return 'gave up';
  },
  async runAway() {
    for (let i = 0; i < 40; i++) {
      const s = G.Scenes.top();
      if (!(s instanceof G.BattleScene)) return;
      if (s.menu === 'command' || s.menu === 'safari') { s.cursor = 3; await this.tap('KeyZ'); } else await this.tap('KeyZ', 1, 60);
      await this.sleep(250);
    }
  },
  msgText() {
    const mb = G.MapScene && G.MapScene.messageBox;
    return mb && mb.active ? mb.lines.map((l) => l.map((t) => t.ch || '').join('')).join(' / ') : null;
  },
  // Press A through messages until a choice, another scene, or idle.
  async advance(max = 60) {
    for (let i = 0; i < max; i++) {
      const ms = G.MapScene, mb = ms && ms.messageBox;
      if (G.Scenes.top() !== ms) return 'scene:' + G.Scenes.top().constructor.name;
      if (mb.choiceWin) return 'choice';
      if (!ms.interpreter.running() && !ms.current && !mb.active && !ms.transferring && i > 0) return 'idle';
      await this.tap('KeyZ', 1, 60);
      await this.sleep(250);
    }
    return 'max';
  },
  async waitScene(name, ms = 8000) {
    const t = performance.now();
    while (performance.now() - t < ms) {
      if (G.Scenes.top() && G.Scenes.top().constructor.name === name && G.Fade.alpha === 0) return true;
      await this.sleep(50);
    }
    return false;
  },
  async waitChoice(ms = 6000) {
    const t = performance.now();
    while (performance.now() - t < ms) {
      if (G.MapScene.messageBox.choiceWin && G.Scenes.top() === G.MapScene) return true;
      await this.sleep(50);
    }
    return false;
  },
  // Walk next to event `id` on the current map, face it and press A, then
  // play through the dialogue and any battle it starts. `choices` answers
  // YES/NO questions in order (index into the choice list; default 0).
  async talk(id, { choices = [], from } = {}) {
    const ev = G.World.map.events[id];
    if (!ev) return 'no event ' + id;
    const p = G.Game.playerChar;
    const m = G.World.map;
    const spots = from ? [from] : [[0, 1, 8], [0, -1, 2], [1, 0, 4], [-1, 0, 6]].map(([dx, dy, d]) =>
      // talk across shop counters
      (m.valid(ev.x + dx, ev.y + dy) && m.counter(ev.x + dx, ev.y + dy) ? [ev.x + 2 * dx, ev.y + 2 * dy, d] : [ev.x + dx, ev.y + dy, d]));
    let ok = false;
    for (const [x, y, d] of spots) {
      if (!(p.x === x && p.y === y) && !this.path(x, y)) continue;
      const r = await this.travel(x, y);
      if (r !== 'arrived') return 'travel: ' + r;
      const codes = { 2: 'ArrowDown', 4: 'ArrowLeft', 6: 'ArrowRight', 8: 'ArrowUp' };
      if (d) p.direction = d;
      await this.tap(codes[d] || 'ArrowUp', 1, 30);
      ok = true; break;
    }
    if (!ok) return 'unreachable';
    await this.tap('KeyZ');
    return this.play({ choices });
  },
  // Play through whatever is running: messages, choices, battles, menus.
  async play({ choices = [], max = 400 } = {}) {
    const log = [];
    let idle = 0;
    for (let i = 0; i < max; i++) {
      const top = G.Scenes.top();
      if (top instanceof G.BattleScene) { log.push('battle'); const r = await this.autoBattle(); if (r === 'max') return 'battle stuck'; continue; }
      if (top !== G.MapScene) {
        const n = top.constructor.name;
        if (/Evolution|PokedexEntry/.test(n)) { await this.tap('KeyZ'); await this.sleep(200); continue; }
        if (/NameEntry/.test(n)) { await this.tap('KeyX'); await this.sleep(200); continue; }
        return 'scene:' + n;
      }
      const ms = G.MapScene, mb = ms.messageBox;
      if (G.Audio.mePlaying) { await new Promise((r) => setTimeout(r, 100)); await this.sleep(16); i--; continue; } // jingles run in real time
      if (mb.choiceWin) {
        const c = choices.length ? choices.shift() : 0;
        log.push('choice ' + c);
        mb.choiceWin.index = c; await this.tap('KeyZ'); await this.sleep(150); continue;
      }
      if (mb.active) { const t = this.msgText(); if (t && log[log.length - 1] !== t) log.push(t); }
      if (!ms.interpreter.running() && !ms.current && !mb.active && !ms.transferring) {
        // idle: wait a little (an event may be about to start), never press A here
        if (++idle > 3) break;
        await this.sleep(100);
        continue;
      }
      idle = 0;
      await this.tap('KeyZ', 1, 40);
      await this.sleep(120);
    }
    this.lastLog = log;
    return 'done';
  },
  // Map-level links: map connections plus warp events (touch events whose
  // first command list contains a direct Transfer Player).
  async mapLinks(id) {
    let m; try { m = await G.Data.map(id); } catch (e) { return []; }
    const out = [];
    for (const c of G.Data.map_connections[id] || []) out.push({ to: c.map, kind: 'conn', c, key: id + '>' + c.map });
    for (const e of Object.values(m.events)) {
      for (const pg of e.pages) {
        if (pg.trigger !== 1 && pg.trigger !== 2) continue;
        // every direct transfer (conditional exits like elevators have several)
        const ts = (pg.list || []).filter((c) => c[0] === 201 && c[2][0] === 0);
        ts.forEach((t, k) => out.push({ to: t[2][1], kind: 'warp', ev: e.id, x: e.x, y: e.y, ax: t[2][2], ay: t[2][3], key: id + '#' + e.id + (k ? '.' + k : '') }));
        if (ts.length) break;
      }
    }
    return out;
  },
  // Can the player reach this link from where they stand?
  linkReachable(l) {
    if (l.kind === 'warp') return !!(this.path(l.x, l.y) || [2, 4, 6, 8].some((d) => this.path(l.x - G.U.dx(d), l.y - G.U.dy(d))));
    return this.connTiles(l.c).some(([x, y]) => this.path(x, y));
  },
  connTiles(c) {
    const m = G.World.map, out = [];
    for (let x = -1; x <= m.width; x++) for (const y of [-1, m.height]) out.push([x, y]);
    for (let y = 0; y < m.height; y++) for (const x of [-1, m.width]) out.push([x, y]);
    const p = G.Game.playerChar;
    return out.filter(([x, y]) => { const mm = G.World.mapAt(x, y); return mm && mm.id === c.map; })
      .sort((a, b) => Math.abs(a[0] - p.x) + Math.abs(a[1] - p.y) - Math.abs(b[0] - p.x) - Math.abs(b[1] - p.y));
  },
  // Walk (and take doors/ladders) to another map. Searches over arrival
  // points so split maps (cave floors) are handled.
  async goMap(target, { avoid = [], badArrivals = new Set() } = {}) {
    const blocked = new Set(); // links that failed from a given arrival point (this call only)
    for (let hop = 0; hop < 80; hop++) {
      if (this.abortAll) return 'aborted'; // set by stop() to cancel a running job
      const cur = G.World.map.id;
      if (cur === target && !badArrivals.has(this.arrival)) return 'arrived';
      const start = 'start';
      const prev = new Map([[start, null]]), q = [[start, cur]];
      let goal = null;
      while (q.length && !goal) {
        const [node, id] = q.shift();
        const here = node === start ? this.arrival : node;
        for (const l of await this.mapLinks(id)) {
          if (blocked.has(here + '|' + l.key) || avoid.includes(l.to)) continue;
          // what can't be reached from here is remembered for this arrival point
          if (node === start && !this.linkReachable(l)) { blocked.add(here + '|' + l.key); continue; }
          const nk = l.kind === 'warp' ? `${l.to}@${l.ax},${l.ay}` : `${l.to}<${id}`;
          if (prev.has(nk) || badArrivals.has(nk)) continue;
          prev.set(nk, [node, l]); q.push([nk, l.to]);
          if (l.to === target) { goal = nk; break; }
        }
        if (prev.size > 3000) break;
      }
      if (!goal) return 'no map route from ' + cur;
      let k = goal; while (prev.get(k)[0] !== start) k = prev.get(k)[0];
      const link = prev.get(k)[1];
      let r = 'no path';
      if (link.kind === 'warp') {
        const ev = G.World.map.events[link.ev];
        const p = G.Game.playerChar;
        const codes = { 2: 'ArrowDown', 4: 'ArrowLeft', 6: 'ArrowRight', 8: 'ArrowUp' };
        if (p.x === ev.x && p.y === ev.y) {
          // standing on it already: step off and back on
          for (const d of [2, 8, 4, 6]) {
            if (!this.path(ev.x + G.U.dx(d), ev.y + G.U.dy(d))) continue;
            await this.walk(codes[d], 1); await this.walk(codes[10 - d], 1); r = 'stepped'; break;
          }
        } else if (this.path(ev.x, ev.y)) r = await this.travel(ev.x, ev.y);
        else {
          // warp tiles are often impassable (doors, mats): stand next to it and step in
          for (const d of [2, 8, 4, 6]) {
            const sx = ev.x - G.U.dx(d), sy = ev.y - G.U.dy(d);
            if (!this.path(sx, sy)) continue;
            r = await this.travel(sx, sy);
            if (r === 'arrived') { await this.walk(codes[d], 1); r = 'stepped'; }
            break;
          }
        }
      } else {
        for (const [x, y] of this.connTiles(link.c)) if (this.path(x, y)) { r = await this.travel(x, y); break; }
      }
      // wait for door animations / transfers to finish
      for (let w = 0; w < 60; w++) {
        const ms = G.MapScene;
        if (!ms.transferring && !ms.current && !ms.interpreter.running() && G.Fade.alpha === 0 && w > 2) break;
        if (ms.messageBox.active) break;
        await this.sleep(100);
      }
      (this.hopLog = this.hopLog || []).push([cur, link.key, r, G.World.map.id].join(' '));
      const pc = G.Game.playerChar;
      // a warp pad to elsewhere on the same map (Silph Co.) counts as moving
      const moved = G.World.map.id !== cur || (link.kind === 'warp' && link.to === cur && pc.x === link.ax && pc.y === link.ay);
      if (moved) { this.arrival = link.kind === 'warp' ? `${link.to}@${link.ax},${link.ay}` : `${link.to}<${cur}`; continue; }
      if (/timeout|interrupted|map changed/.test(r)) continue;
      blocked.add(this.arrival + '|' + link.key);
    }
    return 'too many hops';
  },
  // First step (numpad dir) of the shortest walk to (tx, ty) on this map,
  // using the player's real passability (events like Cut trees included).
  bfsDir(tx, ty) {
    const m = G.World.map, p = G.Game.playerChar, key = (x, y) => x + ',' + y;
    const prev = new Map([[key(p.x, p.y), null]]), q = [[p.x, p.y]];
    while (q.length) {
      const [x, y] = q.shift();
      if (x === tx && y === ty) break;
      for (const d of [2, 4, 6, 8]) {
        let nx = x + G.U.dx(d), ny = y + G.U.dy(d);
        if (!m.valid(nx, ny) || !p.passable(x, y, d)) continue;
        if (m.terrainTag(nx, ny) === G.Terrain.Ledge) {
          // walking into a ledge (in its own direction) jumps to the tile beyond
          nx += G.U.dx(d); ny += G.U.dy(d);
          if (!m.valid(nx, ny) || !p.jumpPassable(nx, ny)) continue;
        }
        const k = key(nx, ny);
        if (prev.has(k)) continue;
        prev.set(k, [x, y, d]); q.push([nx, ny]);
      }
    }
    let k = key(tx, ty), d = null;
    if (!prev.has(k)) return null;
    while (prev.get(k)) { const [x, y, dd] = prev.get(k); d = dd; k = key(x, y); }
    return d;
  },
  // Walk step by step to (x, y), playing through any event or battle on the way.
  async stepTo(x, y, max = 300) {
    const p = G.Game.playerChar, codes = { 2: 'ArrowDown', 4: 'ArrowLeft', 6: 'ArrowRight', 8: 'ArrowUp' };
    const m0 = G.World.map.id;
    let fails = 0;
    for (let k = 0; k < max; k++) {
      if (this.abortAll) return 'aborted';
      if (G.World.map.id !== m0) return 'map changed';
      if (p.x === x && p.y === y) return 'arrived';
      if (G.Scenes.top() !== G.MapScene || G.MapScene.messageBox.active || G.Interpreter.mapRunning() || G.MapScene.current) { await this.play({ max: 300 }); continue; }
      const d = this.bfsDir(x, y);
      if (!d) return 'nopath';
      const b = p.x + ',' + p.y;
      await this.walk(codes[d], 1);
      if (p.x + ',' + p.y === b) { if (++fails > 6) return 'stuck at ' + b; } else fails = 0;
    }
    return 'max';
  },
  // Go through the door or map edge on this map that leads to map `to`.
  async goLink(to) {
    const p = G.Game.playerChar, m = G.World.map, codes = { 2: 'ArrowDown', 4: 'ArrowLeft', 6: 'ArrowRight', 8: 'ArrowUp' };
    const links = (G.Data.map_links[m.id] || []).filter((l) => l.to === to);
    if (!links.length) return 'no link';
    const here = (x, y) => p.x === x && p.y === y;
    for (const l of links) {
      if (l.dir) {
        const tiles = this.exits(l.dir).filter(([x, y]) => { const n = G.World.mapAt(x + G.U.dx(l.dir), y + G.U.dy(l.dir)); return n && n.id === to; });
        for (const [x, y] of tiles) {
          if (!here(x, y) && !this.bfsDir(x, y)) continue;
          if ((await this.stepTo(x, y)) !== 'arrived') continue;
          await this.walk(codes[l.dir], 2); await this.sleep(600);
          if (G.World.map.id === to) { await this.settle(); return 'ok'; }
        }
      } else {
        for (const d of [2, 8, 4, 6]) {
          const sx = l.x - G.U.dx(d), sy = l.y - G.U.dy(d);
          if (!m.valid(sx, sy) || (!here(sx, sy) && !this.bfsDir(sx, sy))) continue;
          if ((await this.stepTo(sx, sy)) !== 'arrived') continue;
          await this.walk(codes[d], 1);
          for (let w = 0; w < 30 && G.World.map.id === m.id; w++) await this.sleep(100);
          await this.sleep(500);
          if (G.World.map.id === to) { await this.settle(); return 'ok'; }
        }
      }
    }
    return 'failed';
  },
  // Let an entrance scene finish (tone fades, location previews, transfers).
  async settle() {
    for (let i = 0; i < 80; i++) {
      const ms = G.MapScene;
      if (!ms.interpreter.running() && !ms.transferring && !ms.current && G.Fade.alpha === 0) return;
      if (ms.messageBox.active) { await this.play({ max: 200 }); continue; }
      await this.sleep(100);
    }
  },
  // Follow a list of map ids with goLink; stops at the first failure.
  async route(ids) {
    const out = [];
    for (const to of ids) {
      if (G.World.map.id === to) continue;
      const r = await this.goLink(to);
      out.push(to + ':' + r);
      if (r !== 'ok') break;
    }
    return out;
  },
  // Go to a tile on a map, trying different entrances of split maps.
  async goTile(map, x, y) {
    const bad = new Set();
    for (let i = 0; i < 12; i++) {
      const r = await this.goMap(map, { badArrivals: bad });
      if (r !== 'arrived') return r;
      if (this.path(x, y) || (G.Game.playerChar.x === x && G.Game.playerChar.y === y)) {
        for (let k = 0; k < 4; k++) { const t = await this.travel(x, y); if (t !== 'timeout (call again)') return t; }
      }
      const w = await this.goWithin(x, y);
      if (w === 'arrived') return w;
      bad.add(this.arrival);
    }
    return 'no entrance reaches it';
  },
  where() { const p = G.Game.playerChar; return [G.World.map.id, G.Data.mapName(G.World.map.id), p.x, p.y]; },
  // List events on the current map (id, name, position, active page).
  events(filter) {
    return Object.values(G.World.map.events).filter((e) => !filter || new RegExp(filter, 'i').test(e.name)).map((e) => [e.id, e.name, e.x, e.y, e.erased ? 'erased' : e.page ? 'active' : 'no page']);
  },

  // Auto-play a battle by always using the first move.
  async autoBattle(max = 200) {
    for (let i = 0; i < max; i++) {
      const s = G.Scenes.top();
      if (s instanceof G.PartyScene) {
        // forced switch: pick the first healthy Pokémon, otherwise cancel
        const idx = G.Game.party.findIndex((p) => p.hp > 0);
        if (s.opts.canCancel === false) { s.index = idx; await this.tap('KeyZ'); await this.sleep(250); await this.tap('KeyZ'); } else await this.tap('KeyX');
        await this.sleep(300); continue;
      }
      if (s instanceof G.EvolutionScene || s instanceof G.PokedexEntryScene || s instanceof G.NameEntryScene) { await this.tap(s instanceof G.NameEntryScene ? 'KeyX' : 'KeyZ'); await this.sleep(300); continue; }
      if (!(s instanceof G.BattleScene)) return 'done';
      if (s.choiceWin) {
        const q = s.text ? s.text.lines.map((l) => l.map((t) => t.ch || '').join('')).join(' ') : '';
        s.choiceWin.index = /Stop learning/.test(q) ? 0 : s.choiceWin.items.length - 1;
        await this.tap('KeyZ');
      }
      else if (s.menu === 'command') {
        s.cursor = 0; await this.tap('KeyZ'); await this.sleep(250);
        // pick the strongest move with PP left
        const mv = s.core.player.moves, me = s.core.player, foe = me.opponent;
        let best = 0, bp = -1;
        mv.forEach((m, k) => {
          const d = G.Data.moves[m.id];
          let p = m.pp > 0 ? (d.category === 'Status' ? 1 : d.power || 40) : -1;
          if (p > 1 && foe) {
            try { p *= s.core.effectiveness(d.type, foe); } catch (e) { /* ignore */ }
            if ((me.types || []).includes(d.type)) p *= 1.5;
            if (/Recoil/i.test(d.effect || '')) p *= 0.8;
          }
          if (p > bp) { bp = p; best = k; }
        });
        s.fightCursor = best;
        await this.tap('KeyZ');
      }
      else await this.tap('KeyZ', 1, 60);
      await this.sleep(250);
    }
    return 'max';
  },
};
console.log('GEGK debug helpers loaded: G.Debug');
