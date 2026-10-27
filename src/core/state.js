// Everything that gets saved: switches, variables, the player, bag, PC boxes,
// Pokédex, options and stats. G.Game is the live instance.
'use strict';

G.Switches = class Switches {
  constructor(data = []) { this.data = data; }
  get(id) { return !!this.data[id]; }
  set(id, v) {
    this.data[id] = !!v;
    for (const m of G.World.maps) m.needRefresh = true;
  }
};
G.Variables = class Variables {
  constructor(data = []) { this.data = data; }
  get(id) { const v = this.data[id]; return v === undefined || v === null ? 0 : v; }
  getNum(id) { const v = this.get(id); return typeof v === 'number' ? v : 0; }
  set(id, v) {
    this.data[id] = v;
    for (const m of G.World.maps) m.needRefresh = true;
  }
};
G.SelfSwitches = class SelfSwitches {
  constructor(data = {}) { this.data = data; }
  key(map, ev, ch) { return `${map},${ev},${ch}`; }
  get(map, ev, ch) { return !!this.data[this.key(map, ev, ch)]; }
  set(map, ev, ch, v) {
    if (v) this.data[this.key(map, ev, ch)] = true; else delete this.data[this.key(map, ev, ch)];
    for (const m of G.World.maps) if (m.id === map) m.needRefresh = true;
  }
};

// Bag with FRLG pockets. Essentials pocket numbers: 1 Items, 2 Medicine,
// 3 Poké Balls, 4 TMs & HMs, 5 Berries, 6 Mail, 7 Battle Items, 8 Key Items.
// FireRed shows them as ITEMS / KEY ITEMS / POKé BALLS / TM CASE / BERRY POUCH.
G.Bag = class Bag {
  constructor(data) {
    this.items = (data && data.items) || {}; // id -> qty
    this.registered = (data && data.registered) || null;
  }
  qty(id) { return this.items[id] || 0; }
  has(id, n = 1) { return this.qty(id) >= n; }
  add(id, n = 1) {
    if (!G.Data.items[id]) { console.warn('Unknown item', id); return false; }
    this.items[id] = Math.min(999, this.qty(id) + n);
    return true;
  }
  canAdd(id, n = 1) { return !!G.Data.items[id] && this.qty(id) + n <= 999; }
  remove(id, n = 1) {
    if (!this.has(id, n)) return false;
    this.items[id] -= n;
    if (this.items[id] <= 0) delete this.items[id];
    return true;
  }
  static pocketOf(id) {
    const it = G.Data.items[id];
    if (!it) return 'items';
    switch (it.pocket) {
      case 8: return 'key';
      case 3: return 'balls';
      case 4: return 'tms';
      case 5: return 'berries';
      default: return 'items';
    }
  }
  pocket(name) {
    const ids = Object.keys(this.items).filter((id) => G.Bag.pocketOf(id) === name);
    if (name === 'tms') ids.sort((a, b) => (a.startsWith('HM') - b.startsWith('HM')) || a.localeCompare(b, undefined, { numeric: true }));
    return ids;
  }
  toJSON() { return { items: this.items, registered: this.registered }; }
  // Ruby-facing API used by the story scripts
  'has?'(id, n) { return this.has(id, n); }
  'can_add?'(id, n) { return this.canAdd(id, n); }
};

G.Storage = class Storage {
  constructor(data) {
    this.boxes = (data && data.boxes) || Array.from({ length: G.Config.BOX_COUNT }, (_, i) => ({ name: `BOX ${i + 1}`, mons: Array(G.Config.BOX_SIZE).fill(null) }));
    for (const b of this.boxes) b.mons = b.mons.map((m) => (m && !(m instanceof G.Pokemon) ? G.Pokemon.fromJSON(m) : m));
    this.current = (data && data.current) || 0;
    this.items = (data && data.items) || {};
  }
  full() { return this.boxes.every((b) => b.mons.every((m) => m)); }
  store(pkmn) {
    for (let k = 0; k < this.boxes.length; k++) {
      const bi = (this.current + k) % this.boxes.length;
      const box = this.boxes[bi];
      const i = box.mons.indexOf(null);
      if (i >= 0) { box.mons[i] = pkmn; return bi; }
    }
    return -1;
  }
  toJSON() { return { boxes: this.boxes, current: this.current, items: this.items }; }
};

G.GameState = class GameState {
  constructor(data = null) {
    const d = data || {};
    this.switches = new G.Switches(d.switches || []);
    this.variables = new G.Variables(d.variables || []);
    this.selfSwitches = new G.SelfSwitches(d.selfSwitches || {});
    this.player = Object.assign({
      name: G.Config.PLAYER_NAME,
      gender: 'male',
      characterId: 1,
      id: Math.floor(Math.random() * 65536),
      money: G.Config.START_MONEY,
      coins: 0,
      badges: [false, false, false, false, false, false, false, false],
      hasPokedex: false,
      hasRunningShoes: false,
      seen: {}, owned: {},
      playTime: 0,
      startTime: Date.now(),
      hallOfFame: [],
    }, d.player || {});
    this.party = (d.party || []).map((m) => G.Pokemon.fromJSON(m));
    this.bag = new G.Bag(d.bag);
    this.storage = new G.Storage(d.storage);
    this.global = Object.assign({
      surfing: false, bicycle: false, bridge: 0, repel: 0,
      healingSpot: null, pokecenter: null, visited: {}, eventVars: {},
      flags: {}, battleRules: {}, lastSaveSlot: null, flyPoints: {},
      daycare: [], dayCareSteps: 0, safari: null, gameClear: false,
    }, d.global || {});
    this.stats = Object.assign({ steps: 0, battles: 0, caught: 0, poke_center_count: 0, gym_leader_attempts: [0, 0, 0, 0, 0, 0, 0, 0],
      elite_four_attempts: 0, hall_of_fame_entry_count: 0, drinks_bought: 0, drinks_won: 0, revived_fossil_count: 0 }, d.stats || {});
    this.options = Object.assign({ textSpeed: 1, battleScene: true, battleStyle: 'shift', sound: 'stereo', autosave: true, musicVolume: 10, sfxVolume: 10 }, d.options || {});
    this.position = d.position || null; // {map, x, y, dir}
    this.inMenu = false;
    this.messageShowing = false;
    this.playerChar = null;
    // The rival is always Snitch.
    this.variables.data[G.Config.RIVAL_VAR] = G.Config.RIVAL_NAME;
  }
  get badgeCount() { return this.player.badges.filter(Boolean).length; }
  get seenCount() { return Object.keys(this.player.seen).length; }
  get ownedCount() { return Object.keys(this.player.owned).length; }
  setSeen(sp) { this.player.seen[sp] = true; }
  setOwned(sp) { this.player.seen[sp] = true; this.player.owned[sp] = true; }
  ablePokemon() { return this.party.filter((p) => p.hp > 0 && !p.egg); }
  firstAble() { return this.party.find((p) => p.hp > 0 && !p.egg) || null; }
  healParty() { for (const p of this.party) p.heal(); }
  // Adds a Pokémon to the party or PC. Returns 'party', 'box N', or null.
  addPokemon(pkmn) {
    this.setOwned(pkmn.species);
    if (this.party.length < G.Config.PARTY_SIZE) { this.party.push(pkmn); return 'party'; }
    const b = this.storage.store(pkmn);
    return b >= 0 ? this.storage.boxes[b].name : null;
  }
  toJSON() {
    const pc = G.Game.playerChar;
    return {
      version: 1,
      game: G.Config.TITLE,
      switches: this.switches.data,
      variables: this.variables.data,
      selfSwitches: this.selfSwitches.data,
      player: this.player,
      party: this.party,
      bag: this.bag,
      storage: this.storage,
      global: this.global,
      stats: this.stats,
      options: this.options,
      position: pc ? { map: G.World.map.id, x: pc.x, y: pc.y, dir: pc.direction } : this.position,
    };
  }
};
