// The player character (Essentials' Game_Player): input, running, ledges,
// surfing/cycling charsets, event triggers and walking between maps.
'use strict';

G.Player = class Player extends G.Character {
  constructor() {
    super(null);
    this.isPlayer = true;
    this.lastDir = 0;
    this.lastDirTime = 0;
    this.encounterCount = 0;
  }
  get map() { return G.World.map; }
  set map(v) { /* always the current map */ }

  meta() { return G.Data.metadata.players[String(G.Game.player.characterId || 1)] || {}; }
  charset(kind) {
    const m = this.meta();
    return { walk: m.WalkCharset, run: m.RunCharset, bike: m.CycleCharset, surf: m.SurfCharset, fish: m.FishCharset }[kind] || m.WalkCharset;
  }
  refreshCharset() {
    const g = G.Game.global;
    this.characterName = this.charset(g.surfing ? 'surf' : g.bicycle ? 'bike' : 'walk');
  }
  setMovementType(type) {
    const g = G.Game.global;
    let cs;
    if (g.surfing) { if (!this.moveRouteForcing) this.setMoveSpeed(type === 'jump' ? 3 : 4); cs = 'surf'; }
    else if (g.bicycle) { if (!this.moveRouteForcing) this.setMoveSpeed(type === 'jump' ? 3 : 5); cs = 'bike'; }
    else if (type === 'run') { if (!this.moveRouteForcing) this.setMoveSpeed(4); cs = 'run'; }
    else { if (!this.moveRouteForcing) this.setMoveSpeed(3); cs = 'walk'; }
    if (this.bumping) this.setMoveSpeed(3);
    this.characterName = this.charset(cs);
  }
  canRun() {
    if (this.moveRouteForcing) return this.moveSpeed > 3;
    if (this.bumping || G.Interpreter.mapRunning() || G.Game.inMenu) return false;
    const g = G.Game.global;
    if (!G.Game.player.hasRunningShoes && !g.surfing && !g.bicycle) return false;
    if (this.jumping() || G.Terrain.mustWalk(this.terrainTag())) return false;
    return G.Input.press('B');
  }

  // Leaving the current map's edge into a connected map?
  passable(x, y, d, strict) {
    const nx = x + G.U.dx(d), ny = y + G.U.dy(d);
    const m = this.map;
    if (!m.valid(nx, ny)) {
      const n = G.World.mapAt(nx, ny);
      if (!n || n === m) return false;
      if (!m.passable(x, y, d, this)) return false;
      const lx = nx - n.ox, ly = ny - n.oy;
      if (!n.playerPassable(lx, ly, 10 - d)) return false;
      for (const ev of Object.values(n.events)) if (ev.atCoordinate(lx, ly) && !ev.through && ev.characterName) return false;
      return true;
    }
    if (G.Config.DEBUG && G.Input.press('SELECT') && G.Input.press('L')) return true;
    return super.passable(x, y, d, strict);
  }
  bumpIntoObject() {
    if (!this.moveRouteForcing) G.Audio.sfx('bump');
    this.moveInitialX = this.x; this.moveInitialY = this.y;
    this.moveTimer = 0;
    this.bumping = true;
  }
  startMove(nx, ny) { this.bumping = false; super.startMove(nx, ny); }
  facingTerrainTag(dir = this.direction) {
    const nx = this.x + G.U.dx(dir), ny = this.y + G.U.dy(dir);
    if (this.map.valid(nx, ny)) return this.map.terrainTag(nx, ny);
    const n = G.World.mapAt(nx, ny);
    return n ? n.terrainTag(nx - n.ox, ny - n.oy) : 0;
  }
  moveGeneric(dir, turn = true) {
    if (turn) this.turnGeneric(dir);
    if (this.canMove(dir)) {
      if (this.facingTerrainTag(dir) === G.Terrain.Ledge) {
        if (this.jumpForward(2)) G.Audio.sfx('jump');
        return;
      }
      if (G.Field.endSurf(this, dir)) return;
      this.turnGeneric(dir);
      this.startMove(this.x + G.U.dx(dir), this.y + G.U.dy(dir));
      G.Game.stats.steps++;
    } else if (!this.checkEventTriggerTouch(dir)) {
      this.bumpIntoObject();
    }
  }
  jumpPassable(x, y) {
    if (!this.map.valid(x, y)) { const n = G.World.mapAt(x, y); return !!n && n.playerPassable(x - n.ox, y - n.oy, 0); }
    for (const ev of Object.values(this.map.events)) if (!ev.through && ev.characterName && ev.atCoordinate(x, y)) return false;
    return this.map.playerPassable(x, y, 0);
  }
  moveto(x, y) {
    super.moveto(x, y);
    this.makeEncounterCount();
  }
  makeEncounterCount() {
    const n = this.map.data.encounterStep || 30;
    this.encounterCount = G.U.rand(n) + G.U.rand(n) + 1;
  }

  // -------------------------------------------------------------- triggers
  checkEventTriggerHere(triggers) {
    if (G.Interpreter.mapRunning()) return false;
    let result = false;
    for (const ev of Object.values(this.map.events)) {
      if (!ev.atCoordinate(this.x, this.y) || !triggers.includes(ev.trigger)) continue;
      if (ev.jumping() || !ev.overTrigger()) continue;
      ev.start(); result = true;
    }
    return result;
  }
  checkEventTriggerThere(triggers) {
    if (G.Interpreter.mapRunning()) return false;
    let nx = this.x + G.U.dx(this.direction), ny = this.y + G.U.dy(this.direction);
    if (!this.map.valid(nx, ny)) return false;
    let result = false;
    const tryAt = (x, y) => {
      for (const ev of Object.values(this.map.events)) {
        if (!triggers.includes(ev.trigger) || !ev.atCoordinate(x, y)) continue;
        if (ev.jumping() || ev.overTrigger()) continue;
        ev.start(); result = true;
      }
    };
    tryAt(nx, ny);
    if (!result && this.map.counter(nx, ny)) {
      nx += G.U.dx(this.direction); ny += G.U.dy(this.direction);
      if (this.map.valid(nx, ny)) tryAt(nx, ny);
    }
    return result;
  }
  checkEventTriggerTouch(dir) {
    if (G.Interpreter.mapRunning()) return false;
    let result = false;
    const tx = this.x + G.U.dx(dir), ty = this.y + G.U.dy(dir);
    for (const ev of Object.values(this.map.events)) {
      if (ev.trigger !== 1 && ev.trigger !== 2) continue;
      if (!ev.atCoordinate(tx, ty)) continue;
      if (ev.sight && !G.Field.eventCanReachPlayer(ev, this, ev.sight)) continue;
      if (ev.counterRange && !G.Field.eventFacesPlayer(ev, this, ev.counterRange)) continue;
      if (ev.jumping() || ev.overTrigger()) continue;
      ev.start(); result = true;
    }
    return result;
  }
  triggeredTrainerEvents() {
    const out = [];
    if (G.Interpreter.mapRunning()) return out;
    for (const ev of Object.values(this.map.events)) {
      if (ev.trigger !== 2 || !(ev.sight || ev.counterRange)) continue;
      if (ev.sight ? !G.Field.eventCanReachPlayer(ev, this, ev.sight) : !G.Field.eventFacesPlayer(ev, this, ev.counterRange)) continue;
      if (ev.jumping() || ev.overTrigger()) continue;
      out.push(ev);
    }
    return out;
  }
  facingEvent() {
    const nx = this.x + G.U.dx(this.direction), ny = this.y + G.U.dy(this.direction);
    if (!this.map.valid(nx, ny)) return null;
    for (const ev of Object.values(this.map.events)) {
      if (ev.atCoordinate(nx, ny) && !ev.jumping() && !ev.overTrigger()) return ev;
    }
    return null;
  }

  // ---------------------------------------------------------------- update
  update() {
    this.lastTerrain = this.terrainTag();
    super.update();
    this.updateEventTriggering();
  }
  updateCommandNew() {
    const dir = G.Input.dir4();
    // No walking while a queued scene runs (e.g. the wild battle transition),
    // or while someone the player talked to (or a trainer who spotted them)
    // is about to start. Not other starting events: e.g. the doormat arrow
    // under every entrance restarts each frame while you stand on it.
    const busy = G.Interpreter.mapRunning() || G.Game.inMenu || G.Game.messageShowing || (G.MapScene && G.MapScene.current) ||
      Object.values(this.map.events).some((e) => e.starting && (e.trigger === 0 || e.sight || e.counterRange));
    if (busy) { this.holdUntilRelease = true; return; }
    // After talking to someone (or any scene), a direction still held from
    // before doesn't move or turn the player until it's let go.
    if (this.holdUntilRelease) {
      if (dir) return;
      this.holdUntilRelease = false;
    }
    if (this.slideDir) { this.continueSlide(); return; }
    if (this.movedLastFrame || (dir > 0 && dir === this.lastDir && G.time - this.lastDirTime >= 0.075)) {
      if (dir) this.moveGeneric(dir);
    } else if (dir !== this.lastDir && dir) {
      this.turnGeneric(dir);
    }
    if (dir !== this.lastDir) this.lastDirTime = G.time;
    this.lastDir = dir;
  }
  updateMove(dt) {
    this.bumpedLastMove = this.bumping;
    if (!this.movedLastFrame || this.stoppedLastFrame) {
      this.setMovementType(this.jumping() ? 'jump' : this.canRun() ? 'run' : 'walk');
    }
    super.updateMove(dt);
  }
  updateStop(dt) {
    if (this.stoppedLastFrame) this.setMovementType('stop');
    super.updateStop(dt);
  }
  updatePattern() {
    if (G.Game.global.surfing) {
      const bob = Math.floor((4 * G.time) / 1.5) % 4;
      if (!this.lockPattern) this.pattern = bob;
      this.yOffset = bob >= 2 ? -1 : 0;
      this.animeCount = 0;
      return;
    }
    this.yOffset = 0;
    super.updatePattern();
  }
  onStepTaken() {
    // Walked off the current map into a connected one?
    if (!this.map.valid(this.x, this.y)) {
      const n = G.World.mapAt(this.x, this.y);
      if (n) {
        const [dx, dy] = G.World.switchTo(n);
        this.x -= dx; this.y -= dy;
        this.realX -= dx * 16; this.realY -= dy * 16;
        G.MapScene && G.MapScene.onMapChanged(true);
      }
    }
  }
  updateEventTriggering() {
    if (this.moving() || this.jumping()) return;
    // A bump into a wall isn't a step: it must not re-trigger the warp or
    // ladder the player is standing on, or count for encounters.
    if (this.movedThisFrame && !this.bumpedLastMove) {
      let result = false;
      const trainers = this.triggeredTrainerEvents();
      for (const ev of trainers) { ev.start(); result = true; }
      result = this.checkEventTriggerHere([1, 2]) || result;
      G.Field.onStepTaken(result);
      this.checkSpinTile();
    }
  }
  // FireRed's arrow floor tiles (Viridian Gym): stepping on one sends the
  // player spinning in its direction until a stop tile or a wall.
  spinTileAt(x, y) {
    const tiles = G.Player.SPIN_TILES[this.map.data.tileset];
    if (!tiles || !this.map.valid(x, y)) return null;
    for (let z = 2; z >= 0; z--) { const d = tiles[this.map.tileId(x, y, z)]; if (d !== undefined) return d; }
    return null;
  }
  checkSpinTile() {
    const d = this.spinTileAt(this.x, this.y);
    if (d === 'stop') this.slideDir = null;
    else if (d) this.slideDir = d;
  }
  continueSlide() {
    if (G.Interpreter.mapRunning() || G.Game.messageShowing || (G.MapScene && G.MapScene.current)) return;
    const d = this.slideDir;
    if (!this.canMove(d)) { this.slideDir = null; return; }
    this.moveGeneric(d);
    // spin while sliding (down, left, up, right...)
    this.direction = [2, 4, 8, 6][Math.floor(G.time * 16) % 4];
  }
};
// Arrow / stop tiles by tileset (tileset 14: the gyms, used by Viridian Gym)
G.Player.SPIN_TILES = { 14: { 919: 4, 927: 6, 935: 8, 943: 2, 951: 'stop' } };
