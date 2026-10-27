// Runs RPG Maker XP event command lists (the story scripts from the kit).
// Each command handler is a generator, so messages, battles and waits simply
// `yield` until they finish.
'use strict';

G.Interpreter = class Interpreter {
  constructor(parallel = false, depth = 0) {
    this.parallel = parallel;
    this.depth = depth;
    this.co = null;
    this.list = null;
  }
  // RMXP choice cancel setting: 0 = can't cancel, 1..n = acts as that choice,
  // n+1 = its own "When Cancel" branch (returned as -1 -> branch 4).
  static cancelIndex(c, n) { return c === 0 ? -2 : c >= 1 && c <= n ? c - 1 : -1; }
  static mapRunning() { return !!(G.MapScene && G.MapScene.interpreter && G.MapScene.interpreter.running()); }

  running() { return !!this.co; }
  setup(list, eventId = 0, mapId = null) {
    this.list = list;
    this.eventId = eventId;
    this.mapId = mapId ?? (G.World.map ? G.World.map.id : 0);
    this.index = 0;
    this.branch = {};
    this.locals = {};
    this.co = list && list.length > 1 ? this.main() : null;
  }
  clear() { this.co = null; this.list = null; }
  update() {
    if (!this.co) return;
    try {
      const r = this.co.next();
      if (r.done) this.co = null;
    } catch (e) {
      console.error('Event script error (map', this.mapId, 'event', this.eventId + '):', e);
      G.MapScene && G.MapScene.messageBox.close();
      this.co = null;
      this.finish();
    }
  }
  get event() {
    const m = G.World.maps.find((x) => x.id === this.mapId) || G.World.map;
    return m && m.events[this.eventId];
  }
  character(id) {
    if (id < 0) return G.Game.playerChar;
    const m = G.World.maps.find((x) => x.id === this.mapId) || G.World.map;
    return m ? m.events[id === 0 ? this.eventId : id] : null;
  }
  finish() {
    if (!this.parallel && this.depth === 0) {
      const ev = this.event;
      if (ev) ev.unlock();
      G.MapScene && G.MapScene.messageBox.close();
    }
  }

  *main() {
    const list = this.list;
    while (this.index < list.length) {
      const cmd = list[this.index];
      const r = yield* this.execute(cmd);
      if (r === 'exit') break;
      if (r !== 'jumped') this.index++;
    }
    this.finish();
  }

  // Skip forward to the next command at the same indent (RMXP command_skip).
  skipBranch() {
    const indent = this.list[this.index][1];
    do { this.index++; } while (this.index < this.list.length && this.list[this.index][1] > indent);
    return 'jumped';
  }
  textAt(i) {
    let s = String(this.list[i][2][0]);
    let j = i + 1;
    while (this.list[j] && this.list[j][0] === 401) { s += (/\\n$|\s$/.test(s) || s === '' ? '' : ' ') + this.list[j][2][0]; j++; }
    return [s.replace(/ {2,}/g, ' '), j]; // some kit lines end in extra spaces
  }
  scriptAt(i) {
    let s = String(this.list[i][2][0]);
    let j = i + 1;
    while (this.list[j] && this.list[j][0] === 655) { s += '\n' + this.list[j][2][0]; j++; }
    return [s, j];
  }
  env() { return G.Bridge.env(this); }
  *runScript(src) {
    return yield* G.Ruby.run(src, this.env());
  }

  *execute(cmd) {
    const [code, indent, p] = cmd;
    const box = G.MapScene.messageBox;
    switch (code) {
      case 0: case 108: case 408: case 118: case 412: case 404: case 401: case 655: case 509:
        return;
      case 101: { // Show text (+ choices if a 102 follows)
        const [text, j] = this.textAt(this.index);
        const next = this.list[j];
        if (next && next[0] === 102) {
          const [choices, cancel] = next[2];
          G.Game.messageShowing = true;
          const r = yield* box.show(text, { choices, cancelIndex: Interpreter.cancelIndex(cancel, choices.length), keepOpen: false });
          G.Game.messageShowing = false;
          this.index = j;
          this.branch[next[1]] = r === -1 ? 4 : r;
          this.index++;
          return 'jumped';
        }
        if (next && next[0] === 103) {
          G.Game.messageShowing = true;
          yield* box.show(text, { keepOpen: true });
          this.index = j;
          yield* this.inputNumber(next[2]);
          box.close();
          G.Game.messageShowing = false;
          this.index++;
          return 'jumped';
        }
        G.Game.messageShowing = true;
        yield* box.show(text, { keepOpen: next && next[0] === 101 });
        G.Game.messageShowing = false;
        this.index = j;
        return 'jumped';
      }
      case 102: { // Choices without text
        const [choices, cancel] = p;
        const cw = new G.UI.CommandWindow(choices, { cancelIndex: Interpreter.cancelIndex(cancel, choices.length) });
        cw.x = G.Config.WIDTH - cw.w - 2; cw.y = 110 - cw.h;
        box.choiceWin = cw; box.active = true; box.box = { x: -100, y: 0, w: 0, h: 0 }; box.lines = []; box.opts = { skin: 'msg' };
        const r = yield* cw.run();
        box.close();
        this.branch[indent] = r === -1 ? 4 : r;
        return;
      }
      case 402: // When [choice]
        if (this.branch[indent] === p[0]) { delete this.branch[indent]; return; }
        return this.skipBranch();
      case 403: // When cancel
        if (this.branch[indent] === 4) { delete this.branch[indent]; return; }
        return this.skipBranch();
      case 103: yield* this.inputNumber(p); return;
      case 104: return; // message position settings
      case 105: return; // button input processing (unused)
      case 106: yield* G.U.wait(p[0] / 20); return;
      case 111: { // Conditional branch
        const r = yield* this.condition(p);
        this.branch[indent] = r;
        if (r) return;
        return this.skipBranch();
      }
      case 411: // Else
        if (this.branch[indent] === false) return;
        return this.skipBranch();
      case 112: return; // Loop
      case 413: { // Repeat above
        let i = this.index;
        do { i--; } while (i > 0 && !(this.list[i][0] === 112 && this.list[i][1] === indent));
        this.index = i + 1;
        return 'jumped';
      }
      case 113: { // Break loop
        let i = this.index;
        while (++i < this.list.length) if (this.list[i][0] === 413 && this.list[i][1] < indent) break;
        this.index = i + 1;
        return 'jumped';
      }
      case 115: return 'exit';
      case 116: { const ev = this.event; if (ev) ev.erase(); return; }
      case 117: { // Call common event
        const ce = G.Data.common_events[p[0]];
        if (ce) {
          const child = new G.Interpreter(this.parallel, this.depth + 1);
          child.setup(ce.list, this.eventId, this.mapId);
          while (child.running()) { child.update(); if (child.running()) yield; }
        }
        return;
      }
      case 119: { // Jump to label
        const i = this.list.findIndex((c) => c[0] === 118 && c[2][0] === p[0]);
        if (i >= 0) { this.index = i + 1; return 'jumped'; }
        return;
      }
      case 121: for (let i = p[0]; i <= p[1]; i++) G.Game.switches.set(i, p[2] === 0); return;
      case 122: this.controlVariables(p); return;
      case 123: {
        const ev = this.event;
        if (this.eventId > 0) G.Game.selfSwitches.set(this.mapId, this.eventId, p[0], p[1] === 0);
        if (ev) ev.map.needRefresh = true;
        return;
      }
      case 124: return; // timer
      case 125: {
        const v = p[1] === 0 ? p[2] : G.Game.variables.getNum(p[2]);
        G.Game.player.money = G.U.clamp(G.Game.player.money + (p[0] === 0 ? v : -v), 0, 999999);
        return;
      }
      case 201: yield* this.transfer(p); return;
      case 202: { // Set event location
        const ch = this.character(p[0]);
        if (!ch) return;
        if (p[1] === 0) ch.moveto(p[2], p[3]);
        else if (p[1] === 1) ch.moveto(G.Game.variables.getNum(p[2]), G.Game.variables.getNum(p[3]));
        else { const o = this.character(p[2]); if (o) { const ox = ch.x, oy = ch.y; ch.moveto(o.x, o.y); o.moveto(ox, oy); } }
        if (p[4] > 0) ch.direction = p[4];
        return;
      }
      case 203: yield* G.MapScene.scrollMap(p[0], p[1], p[2]); return;
      case 204: case 205: case 206: return;
      case 207: { const ch = this.character(p[0]); if (ch) G.MapScene.showAnimation(ch, p[1]); return; }
      case 208: G.Game.playerChar.transparent = p[0] === 0; return;
      case 209: { // Set move route
        const ch = this.character(p[0]);
        if (ch) ch.forceMoveRoute(p[1]);
        return;
      }
      case 210: // Wait for move completion
        while (this.anyForcedMoving()) yield;
        return;
      case 221: return; // Prepare for transition
      case 222: yield* G.Fade.in(0.3); return;
      case 223: G.Screen.startTone(p[0], p[1] / 20); return;
      case 224: G.Screen.startFlash(p[0], p[1] / 20); return;
      case 225: G.Screen.startShake(p[0], p[1], p[2] / 20); return;
      case 231: { // Show picture
        const [n, name, origin, appoint, x, y, zx, zy, op, blend] = p;
        const px = appoint === 0 ? x : G.Game.variables.getNum(x), py = appoint === 0 ? y : G.Game.variables.getNum(y);
        G.Screen.picture(n).show(name, origin, px, py, zx, zy, op, blend);
        yield* this.waitForPicture(name);
        return;
      }
      case 232: { // Move picture
        const [n, dur, origin, appoint, x, y, zx, zy, op, blend] = p;
        const px = appoint === 0 ? x : G.Game.variables.getNum(x), py = appoint === 0 ? y : G.Game.variables.getNum(y);
        G.Screen.picture(n).move(dur / 20, origin, px, py, zx, zy, op, blend);
        return;
      }
      case 233: G.Screen.picture(p[0]).rotSpeed = p[1]; return;
      case 234: G.Screen.picture(p[0]).tone.set(p[1], p[2] / 20); return;
      case 235: G.Screen.picture(p[0]).erase(); return;
      case 236: G.Screen.setWeather(p[0], p[1]); return;
      case 241: G.Audio.playBGM(p[0]); return;
      case 242: G.Audio.fadeOutBGM(p[0]); return;
      case 245: case 246: return; // BGS (none in the kit)
      case 247: G.Audio.memorizeBGM(); return;
      case 248: G.Audio.restoreBGM(); return;
      case 249: G.Audio.playME(p[0]); return;
      case 250: G.Audio.playSE(p[0]); return;
      case 251: return;
      case 314: // Recover all (Pokémon Center nurse, Mom)
        G.Game.healParty();
        G.Save.autosave('heal');
        return;
      case 355: { // Script
        const [src, j] = this.scriptAt(this.index);
        this.index = j;
        yield* this.runScript(src);
        // Scripts can change what "s:" switch conditions see (e.g. pbInSafari?),
        // so event pages are re-checked, as in Essentials.
        if (G.World.map) G.World.map.needRefresh = true;
        return 'jumped';
      }
      default:
        if (G.Config.DEBUG) console.warn('Unhandled event command', code, p);
        return;
    }
  }

  anyForcedMoving() {
    const p = G.Game.playerChar;
    if (p.moveRouteForcing) return true;
    for (const m of G.World.maps) for (const ev of Object.values(m.events)) if (ev.moveRouteForcing) return true;
    return false;
  }
  *waitForPicture(name) {
    const path = G.Assets.picture(name);
    const pr = G.Assets.load(path);
    let done = false;
    pr.then(() => { done = true; });
    while (!done) yield;
  }

  *inputNumber([varId, digits]) {
    const nw = new G.UI.NumberWindow({ min: 0, max: Math.pow(10, digits) - 1, value: G.Game.variables.getNum(varId), digits, prefix: '', x: 170, y: 82 });
    G.MapScene.overlay = nw;
    G.Input.clear();
    while (nw.result === undefined) { yield; nw.update(); }
    G.MapScene.overlay = null;
    if (nw.result >= 0) G.Game.variables.set(varId, nw.result);
  }

  *condition(p) {
    const g = G.Game;
    switch (p[0]) {
      case 0: { // switch
        const ev = this.event;
        const on = ev ? ev.switchIsOn(p[1]) : g.switches.get(p[1]);
        return on === (p[2] === 0);
      }
      case 1: { // variable
        const a = g.variables.get(p[1]);
        const b = p[2] === 0 ? p[3] : g.variables.get(p[3]);
        switch (p[4]) {
          case 0: return a === b;
          case 1: return a >= b;
          case 2: return a <= b;
          case 3: return a > b;
          case 4: return a < b;
          case 5: return a !== b;
        }
        return false;
      }
      case 2: return this.eventId > 0 && g.selfSwitches.get(this.mapId, this.eventId, p[1]) === (p[2] === 0);
      case 6: { // character facing direction
        const ch = this.character(p[1]);
        return !!ch && ch.direction === p[2];
      }
      case 7: return p[2] === 0 ? g.player.money >= p[1] : g.player.money <= p[1];
      case 12: return G.Ruby.truthy(yield* this.runScript(p[1]));
    }
    return false;
  }

  controlVariables(p) {
    const [start, end, op, type, a, b] = p;
    const g = G.Game;
    let v = 0;
    switch (type) {
      case 0: v = a; break;
      case 1: v = g.variables.getNum(a); break;
      case 2: v = G.U.randRange(a, b); break;
      case 6: {
        const ch = this.character(a);
        if (ch) v = [ch.x, ch.y, ch.direction, ch.realX * 2, ch.realY * 2, ch.terrainTag()][b] ?? 0;
        break;
      }
      case 7: v = [G.World.map.id, g.party.length, g.player.money, 0, Math.floor(g.player.playTime), 0, 0][a] ?? 0; break;
    }
    for (let i = start; i <= end; i++) {
      let cur = g.variables.getNum(i);
      switch (op) {
        case 0: cur = v; break;
        case 1: cur += v; break;
        case 2: cur -= v; break;
        case 3: cur *= v; break;
        case 4: if (v !== 0) cur = Math.trunc(cur / v); break;
        case 5: if (v !== 0) cur %= v; break;
      }
      g.variables.set(i, cur);
    }
  }

  *transfer(p) {
    const [desig, mapP, xP, yP, dir, noFade] = p;
    const v = G.Game.variables;
    const map = desig === 0 ? mapP : v.getNum(mapP);
    const x = desig === 0 ? xP : v.getNum(xP);
    const y = desig === 0 ? yP : v.getNum(yP);
    yield* G.MapScene.transferPlayer(map, x, y, dir, noFade === 0);
  }
};
