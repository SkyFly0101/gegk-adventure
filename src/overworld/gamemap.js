// A loaded map (tiles, passability, events) and the World that stitches
// connected outdoor maps together, ported from Essentials' Game_Map and
// PokemonMapFactory.
'use strict';

// Essentials terrain tags
G.Terrain = {
  None: 0, Ledge: 1, Grass: 2, Sand: 3, Rock: 4, DeepWater: 5, StillWater: 6, Water: 7,
  Waterfall: 8, WaterfallCrest: 9, TallGrass: 10, UnderwaterGrass: 11, Ice: 12, Neutral: 13,
  SootGrass: 14, Bridge: 15, Puddle: 16, NoEffect: 17,
  canSurf: (t) => t === 5 || t === 6 || t === 7 || t === 8 || t === 9,
  canSurfFreely: (t) => t === 5 || t === 6 || t === 7,
  isWater: (t) => t >= 5 && t <= 9,
  isGrass: (t) => t === 2 || t === 10 || t === 14,
  ignorePassability: (t) => t === 13, // Neutral only; NoEffect (17) keeps its own passage flags
  mustWalk: (t) => t === 10 || t === 12,
  isBush: (t) => t === 2 || t === 10,
};

G.GameMap = class GameMap {
  constructor(data) {
    this.data = data;
    this.id = data.id;
    this.width = data.width;
    this.height = data.height;
    this.tiles = data.data;
    this.tileset = G.Data.tilesets[data.tileset];
    this.meta = G.Data.map_metadata[data.id] || {};
    this.ox = 0; this.oy = 0;   // offset (in tiles) relative to the current map
    this.events = {};
    this.needRefresh = false;
    for (const e of Object.values(data.events)) this.events[e.id] = new G.GameEvent(this, e);
    // Strength boulders stay where they were pushed (as in FireRed).
    const moved = G.Game && G.Game.global.movedEvents && G.Game.global.movedEvents[this.id];
    if (moved) for (const [id, [x, y]] of Object.entries(moved)) if (this.events[id]) this.events[id].moveto(x, y);
  }
  get name() { return G.Data.mapName(this.id); }
  valid(x, y) { return x >= 0 && y >= 0 && x < this.width && y < this.height; }
  tileId(x, y, z) { return this.tiles[x + y * this.width + z * this.width * this.height] || 0; }
  setTileId(x, y, z, id) { this.tiles[x + y * this.width + z * this.width * this.height] = id; }
  passage(id) { return this.tileset.passages[id] || 0; }
  priority(id) { return this.tileset.priorities[id] || 0; }
  tag(id) { return this.tileset.terrainTags[id] || 0; }

  terrainTag(x, y, countBridge = false) {
    if (!this.valid(x, y)) return 0;
    for (let z = 2; z >= 0; z--) {
      const id = this.tileId(x, y, z);
      if (id === 0) continue;
      const t = this.tag(id);
      if (t === G.Terrain.Bridge && !countBridge && !(G.Game && G.Game.global.bridge > 0)) continue;
      if (t > 0) return t;
    }
    return 0;
  }
  bush(x, y) {
    for (let z = 2; z >= 0; z--) {
      const id = this.tileId(x, y, z);
      if (this.tag(id) === G.Terrain.Bridge && G.Game.global.bridge > 0) return false;
      if (this.passage(id) & 0x40) return true;
    }
    return false;
  }
  deepBush(x, y) {
    for (let z = 2; z >= 0; z--) {
      const id = this.tileId(x, y, z);
      const t = this.tag(id);
      if (t === G.Terrain.Bridge && G.Game.global.bridge > 0) return false;
      if (t === G.Terrain.TallGrass && (this.passage(id) & 0x40)) return true;
    }
    return false;
  }
  counter(x, y) {
    for (let z = 2; z >= 0; z--) {
      const id = this.tileId(x, y, z);
      if (id === 0) continue;
      if (this.passage(id) & 0x80) return true;
    }
    return false;
  }

  // Can a character leave/enter (x, y) in direction d? (Game_Map#passable?)
  passable(x, y, d, self = null) {
    if (!this.valid(x, y)) return false;
    const bit = (1 << (d / 2 - 1)) & 0x0f;
    for (const ev of Object.values(this.events)) {
      if (ev.tileId <= 0 || ev === self || ev.through || !ev.atCoordinate(x, y)) continue;
      if (G.Terrain.ignorePassability(this.tag(ev.tileId))) continue;
      const p = this.passage(ev.tileId);
      if (p & bit || (p & 0x0f) === 0x0f) return false;
      if (this.priority(ev.tileId) === 0) return true;
    }
    if (self && self.isPlayer) return this.playerPassable(x, y, d);
    // All other events
    const nx = x + G.U.dx(d), ny = y + G.U.dy(d);
    if (!this.valid(nx, ny)) return false;
    // First real (non-None, non-ignored) terrain of the facing tile
    const facingTerrain = () => {
      for (let j = 2; j >= 0; j--) {
        const fid = this.tileId(nx, ny, j);
        if (fid === 0) continue;
        const ft = this.tag(fid);
        if (ft !== 0 && !G.Terrain.ignorePassability(ft)) return ft;
      }
      return 0;
    };
    for (let z = 2; z >= 0; z--) {
      const id = this.tileId(x, y, z);
      const t = this.tag(id);
      if (self && G.Terrain.canSurfFreely(t)) {
        // Already on water: only move onto other water
        return G.Terrain.canSurfFreely(facingTerrain());
      } else if (t === G.Terrain.Ice) {
        return false;
      } else if (self && self.x === x && self.y === y) {
        if (facingTerrain() === G.Terrain.Ledge) return false; // events can't walk onto ledges
      }
      if (G.Terrain.ignorePassability(t) || id === 0) continue;
      const p = this.passage(id);
      if (p & bit || (p & 0x0f) === 0x0f) return false;
      if (this.priority(id) === 0) return true;
    }
    return true;
  }
  playerPassable(x, y, d) {
    const bit = (1 << (d / 2 - 1)) & 0x0f;
    const g = G.Game.global;
    for (let z = 2; z >= 0; z--) {
      const id = this.tileId(x, y, z);
      if (id === 0) continue;
      const t = this.tag(id);
      const p = this.passage(id);
      if (t) {
        if (t === G.Terrain.Bridge && !(g.bridge > 0)) continue;
        if (g.surfing && G.Terrain.canSurf(t) && t !== G.Terrain.Waterfall) return true;
        if (g.bicycle && G.Terrain.mustWalk(t)) return false;
        if (t === G.Terrain.Bridge && g.bridge > 0) return (p & bit) === 0 && (p & 0x0f) !== 0x0f;
      }
      if (G.Terrain.ignorePassability(t)) continue;
      if (p & bit || (p & 0x0f) === 0x0f) return false;
      if (this.priority(id) === 0) return true;
    }
    return true;
  }
  // Fully passable with no blocking events (used for e.g. boulders)
  passableStrict(x, y, d, self) {
    if (!this.valid(x, y)) return false;
    for (const ev of Object.values(this.events)) {
      if (ev === self || ev.tileId < 0 || ev.through || !ev.atCoordinate(x, y)) continue;
      if (G.Terrain.ignorePassability(this.tag(ev.tileId))) continue;
      if (this.passage(ev.tileId) & 0x0f) return false;
      if (this.priority(ev.tileId) === 0) return true;
    }
    for (let z = 2; z >= 0; z--) {
      const id = this.tileId(x, y, z);
      if (id === 0) continue;
      if (G.Terrain.ignorePassability(this.tag(id))) continue;
      if (this.passage(id) & 0x0f) return false;
      if (this.priority(id) === 0) return true;
    }
    return true;
  }
  eventAt(x, y) { return Object.values(this.events).find((e) => e.atCoordinate(x, y) && !e.erased); }
  eventsAt(x, y) { return Object.values(this.events).filter((e) => e.atCoordinate(x, y)); }

  refresh() {
    for (const ev of Object.values(this.events)) ev.refresh();
    this.needRefresh = false;
  }
  update() {
    if (this.needRefresh) this.refresh();
    for (const ev of Object.values(this.events)) ev.update();
  }
};

// ---------------------------------------------------------------------------
// The world: current map plus its directly connected neighbours.
// ---------------------------------------------------------------------------
G.World = {
  maps: [],          // [current, ...neighbours]
  get map() { return this.maps[0]; },
  cache: {},         // id -> GameMap (keeps event state while you're nearby)

  async loadMap(id) {
    if (this.cache[id]) return this.cache[id];
    const data = await G.Data.map(id);
    const copy = { ...data, data: data.data.slice() };
    const ts = G.Data.tilesets[data.tileset];
    await G.Assets.loadAll(G.Tilemap.tilesetPaths(ts));
    const m = new G.GameMap(copy);
    await G.World.preloadEventGraphics(m);
    this.cache[id] = m;
    return m;
  },
  async preloadEventGraphics(m) {
    const names = new Set();
    for (const e of Object.values(m.data.events)) for (const p of e.pages) {
      if (p.gfx.name) names.add(p.gfx.name);
      for (const [code, , params] of p.list) if (code === 209) for (const [mc, mp] of params[1].list) if (mc === 41 && mp[0]) names.add(mp[0]);
      for (const [mc, mp] of p.route.list) if (mc === 41 && mp[0]) names.add(mp[0]);
    }
    await G.Assets.loadAll([...names].map(G.Assets.character));
  },
  // Make `id` the current map and load its neighbours.
  async setup(id) {
    const m = await this.loadMap(id);
    m.ox = 0; m.oy = 0;
    const list = [m];
    for (const c of G.Data.map_connections[id] || []) {
      const n = await this.loadMap(c.map);
      n.ox = c.dx; n.oy = c.dy;
      list.push(n);
    }
    this.maps = list;
    // Forget maps that are no longer nearby so their events reset like Essentials.
    for (const k of Object.keys(this.cache)) if (!list.some((x) => x.id === +k)) delete this.cache[k];
    for (const x of list) x.refresh();
  },
  // Switch to a neighbour the player just walked into (synchronous; the
  // neighbours' neighbours are loaded in the background).
  switchTo(n) {
    const dx = n.ox, dy = n.oy;
    const conns = G.Data.map_connections[n.id] || [];
    const list = [n];
    for (const c of conns) {
      const nn = this.cache[c.map];
      if (nn) { nn.ox = c.dx; nn.oy = c.dy; list.push(nn); }
    }
    n.ox = 0; n.oy = 0;
    this.maps = list;
    // load any missing neighbours asynchronously
    Promise.all(conns.filter((c) => !this.cache[c.map]).map((c) => this.loadMap(c.map))).then(() => {
      if (this.map !== n) return;
      for (const c of conns) {
        const nn = this.cache[c.map];
        if (nn && !this.maps.includes(nn)) { nn.ox = c.dx; nn.oy = c.dy; nn.refresh(); this.maps.push(nn); }
      }
    });
    return [dx, dy];
  },
  // Which loaded map contains the world tile (x, y) relative to the current map?
  mapAt(x, y) {
    for (const m of this.maps) if (m.valid(x - m.ox, y - m.oy)) return m;
    return null;
  },
  update() { for (const m of this.maps) m.update(); },
};
