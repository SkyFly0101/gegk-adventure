// Map events (Essentials' Game_Event): page selection by switches/variables,
// triggers, trainer line of sight, multi-tile "size(w,h)" events.
'use strict';

G.GameEvent = class GameEvent extends G.Character {
  constructor(map, ev) {
    super(map);
    this.ev = ev;
    this.id = ev.id;
    this.name = ev.name;
    this.originalX = ev.x; this.originalY = ev.y;
    const sz = ev.name.match(/size\((\d+),(\d+)\)/i);
    if (sz) { this.width = +sz[1]; this.height = +sz[2]; }
    const sight = ev.name.match(/(?:sight|trainer)\((\d+)\)/i);
    this.sight = sight ? +sight[1] : 0;
    // "Counter(n)": an NPC behind a counter who calls out when facing the
    // player within n tiles (e.g. the Safari Zone attendant)
    const counter = ev.name.match(/counter\((\d+)\)/i);
    this.counterRange = counter ? +counter[1] : 0;
    this.isTrainer = /trainer\(\d+\)/i.test(ev.name);
    this.erased = false;
    this.starting = false;
    this.through = true;
    this.tempSwitches = {};
    this.page = undefined;
    this.list = null;
    this.trigger = null;
    this.moveto(ev.x, ev.y);
    this.refresh();
  }

  get mapId() { return this.map.id; }
  start() { if (this.list && this.list.length > 1) this.starting = true; }
  clearStarting() { this.starting = false; }
  erase() { this.erased = true; this.refresh(); }
  tsOn(c) { return this.tempSwitches[c] === true; }
  tsOff(c) { return !this.tempSwitches[c]; }
  setTempSwitchOn(c) { this.tempSwitches[c] = true; this.refresh(); }
  setTempSwitchOff(c) { this.tempSwitches[c] = false; this.refresh(); }
  selfSwitch(c) { return G.Game.selfSwitches.get(this.map.id, this.id, c); }
  switchIsOn(id) {
    const name = G.Data.system.switches[id] || '';
    if (/^s:/.test(name)) return !!G.Bridge.evalScript(name.slice(2), { event: this });
    return G.Game.switches.get(id);
  }
  onEvent() {
    const p = G.Game.playerChar;
    return p.map === this.map && this.atCoordinate(p.x, p.y);
  }
  // An event the player can stand on (no graphic or "through")?
  overTrigger() {
    if (this.characterName !== '' && !this.through) return false;
    if (/hiddenitem/i.test(this.name)) return false;
    for (let i = this.x; i < this.x + this.width; i++)
      for (let j = this.y - this.height + 1; j <= this.y; j++)
        if (this.map.passable(i, j, 0, G.Game.playerChar)) return true;
    return false;
  }

  refresh() {
    let newPage = null;
    if (!this.erased) {
      const pages = this.ev.pages;
      for (let i = pages.length - 1; i >= 0; i--) {
        const c = pages[i].cond;
        if (c.s1 && !this.switchIsOn(c.s1)) continue;
        if (c.s2 && !this.switchIsOn(c.s2)) continue;
        if (c.v && G.Game.variables.getNum(c.v) < c.vv) continue;
        if (c.self && !this.selfSwitch(c.self)) continue;
        newPage = pages[i];
        break;
      }
    }
    if (newPage === this.page) return;
    this.page = newPage;
    this.clearStarting();
    if (!newPage) {
      this.tileId = 0; this.characterName = ''; this.moveType = 0;
      this.through = true; this.trigger = null; this.list = null;
      this.parallel = null;
      return;
    }
    const g = newPage.gfx;
    this.tileId = g.tile;
    this.characterName = g.name;
    this.hue = g.hue;
    if (this.originalDirection !== g.dir) { this.direction = g.dir; this.originalDirection = g.dir; this.prelockDirection = 0; }
    if (this.originalPattern !== g.pattern) { this.pattern = g.pattern; this.originalPattern = g.pattern; }
    this.opacity = g.opacity;
    this.blend = g.blend;
    this.moveType = newPage.moveType;
    this.setMoveSpeed(newPage.moveSpeed);
    this.setMoveFrequency(newPage.moveFreq);
    this.moveRoute = newPage.route;
    this.moveRouteIndex = 0;
    this.moveRouteForcing = false;
    this.walkAnime = newPage.walkAnime;
    this.stepAnime = newPage.stepAnime;
    this.dirFix = newPage.dirFix;
    this.through = newPage.through;
    this.onTop = newPage.onTop;
    this.calculateBushDepth();
    this.trigger = newPage.trigger;
    this.list = newPage.list;
    this.parallel = this.trigger === 4 ? new G.Interpreter(true) : null;
    if (g.name) G.Assets.load(G.Assets.character(g.name));
    this.checkEventTriggerAuto();
  }

  checkEventTriggerAuto() {
    if (this.map !== G.World.map) return;
    if (this.trigger === 2) {
      const p = G.Game.playerChar;
      if (p && this.atCoordinate(p.x, p.y) && !this.jumping() && this.overTrigger()) this.start();
    } else if (this.trigger === 3) this.start();
  }
  // Event touch: the event walked into the player.
  checkEventTriggerTouch(dir) {
    if (G.Interpreter.mapRunning() || this.trigger !== 2 || this.map !== G.World.map) return;
    const p = G.Game.playerChar;
    if (dir === 2 && p.y !== this.y + 1) return;
    if (dir === 4 && p.x !== this.x - 1) return;
    if (dir === 6 && p.x !== this.x + this.width) return;
    if (dir === 8 && p.y !== this.y - this.height) return;
    if (!this.inLineWith(p.x, p.y)) return;
    if (this.jumping() || this.overTrigger()) return;
    this.start();
  }
  onTurned() {
    if (G.Interpreter.mapRunning() || this.starting || this.trigger !== 2 || !this.sight) return;
    if (this.map !== G.World.map) return;
    if (!G.Field.eventCanReachPlayer(this, G.Game.playerChar, this.sight)) return;
    if (this.jumping() || this.overTrigger()) return;
    this.start();
  }
  update() {
    super.update();
    this.checkEventTriggerAuto();
    if (this.parallel && this.map === G.World.map) {
      if (!this.parallel.running()) this.parallel.setup(this.list, this.id, this.map.id);
      this.parallel.update();
    }
  }
};
