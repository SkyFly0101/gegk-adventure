// Overworld rules: trainer line of sight, wild encounters, step effects
// (repel, poison), whiting out, field moves (Cut, Surf, Strength, Rock Smash,
// Flash, Fly) and fishing.
'use strict';

G.Field = {
  stepCount: 0,
  chanceAccumulator: 0,

  // ---------------------------------------------------------- line of sight
  eventFacesPlayer(ev, p, dist) {
    if (!ev || !p || dist <= 0) return false;
    // compare in the event's map coordinates
    const px = p.x + (p.map.ox - ev.map.ox), py = p.y + (p.map.oy - ev.map.oy);
    let x0, x1, y0, y1;
    switch (ev.direction) {
      case 2: x0 = ev.x; x1 = ev.x + ev.width - 1; y0 = ev.y + 1; y1 = ev.y + dist; break;
      case 4: x0 = ev.x - dist; x1 = ev.x - 1; y0 = ev.y - ev.height + 1; y1 = ev.y; break;
      case 6: x0 = ev.x + ev.width; x1 = ev.x + ev.width - 1 + dist; y0 = ev.y - ev.height + 1; y1 = ev.y; break;
      case 8: x0 = ev.x; x1 = ev.x + ev.width - 1; y0 = ev.y - ev.height + 1 - dist; y1 = ev.y - ev.height; break;
      default: return false;
    }
    return px >= x0 && px <= x1 && py >= y0 && py <= y1;
  },
  eventCanReachPlayer(ev, p, dist) {
    if (!this.eventFacesPlayer(ev, p, dist)) return false;
    const px = p.x + (p.map.ox - ev.map.ox), py = p.y + (p.map.oy - ev.map.oy);
    const dx = G.U.dx(ev.direction), dy = G.U.dy(ev.direction);
    let real = 0;
    switch (ev.direction) {
      case 2: real = py - ev.y - 1; break;
      case 4: real = ev.x - px - 1; break;
      case 6: real = px - ev.x - ev.width; break;
      case 8: real = ev.y - ev.height - py; break;
    }
    // The tiles between must be walkable (ignoring the player, who is the target).
    const saved = p.through; p.through = true;
    try {
      for (let i = 0; i < real; i++) if (!ev.canMoveFrom(ev.x + i * dx, ev.y + i * dy, ev.direction)) return false;
    } finally { p.through = saved; }
    return true;
  },
  directionToward(from, to) {
    const dx = (to.x + to.map.ox) - (from.x + from.map.ox), dy = (to.y + to.map.oy) - (from.y + from.map.oy);
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 6 : 4;
    return dy > 0 ? 2 : 8;
  },
  *moveTowardPlayer(ev) {
    const p = G.Game.playerChar;
    if (!this.eventCanReachPlayer(ev, p, Math.max(ev.map.width, ev.map.height))) return;
    for (let guard = 0; guard < 64; guard++) {
      const x = ev.x, y = ev.y;
      ev.moveTowardPlayer();
      if (ev.x === x && ev.y === y) break;
      while (ev.moving()) yield;
    }
  },

  // ------------------------------------------------------------ step effects
  onStepTaken(eventTriggered) {
    const g = G.Game;
    if (g.global.repel > 0) {
      g.global.repel--;
      if (g.global.repel === 0) G.MapScene.queue(function* () { yield* G.MapScene.messageBox.show("REPEL's effect wore off..."); });
    }
    if (g.global.dayCareSteps !== undefined && g.global.daycare.length) for (const d of g.global.daycare) d.steps++;
    // Poison: 1 HP every 4 steps (FRLG lets Pokémon faint from poison)
    g.global.poisonSteps = ((g.global.poisonSteps || 0) + 1) % 4;
    if (g.global.poisonSteps === 0) {
      let hurt = false;
      for (const p of g.party) {
        if (p.status !== 'POISON' || p.hp <= 0) continue;
        p.hp--; hurt = true;
        if (p.hp <= 0) {
          p.status = null;
          G.MapScene.queue(function* () { yield* G.MapScene.messageBox.show(`${p.name} fainted...`); });
        }
      }
      if (hurt && !g.firstAble()) G.MapScene.queue(() => G.Field.whiteOut());
    }
    // Friendship: +1 every 128 steps
    if (g.stats.steps % 128 === 0) for (const p of g.party) if (p.happiness < 255 && Math.random() < 0.5) p.happiness++;
    if (this.safariStep()) return;
    if (!eventTriggered && !G.Interpreter.mapRunning()) this.checkWildEncounter();
  },

  encounterTable(map, kind) {
    const t = G.Data.encounters[map.id];
    if (!t) return null;
    if (kind === 'Land') return t.Land || t.LandDay || t.LandMorning || t.LandAfternoon || null;
    if (kind === 'Cave') return t.Cave || t.CaveDay || null;
    if (kind === 'Water') return t.Water || t.WaterDay || null;
    return t[kind] || null;
  },
  currentEncounterKind() {
    const p = G.Game.playerChar, m = G.World.map;
    if (G.Game.global.surfing) return this.encounterTable(m, 'Water') ? 'Water' : null;
    const tag = m.terrainTag(p.x, p.y);
    // Only grass tiles have land encounters (Essentials' land_wild_encounters:
    // Grass, TallGrass, UnderwaterGrass, SootGrass); dirt paths use the Sand tag.
    if ((G.Terrain.isGrass(tag) || tag === G.Terrain.UnderwaterGrass) && this.encounterTable(m, 'Land')) return 'Land';
    if (this.encounterTable(m, 'Cave')) return 'Cave';
    return null;
  },
  checkWildEncounter() {
    const kind = this.currentEncounterKind();
    if (!kind) return;
    const table = this.encounterTable(G.World.map, kind);
    if (!table || !table.density) return;
    let chance = table.density;
    let minSteps = G.U.clamp(8 - chance / 10, 0, 8);
    chance += this.chanceAccumulator / 200;
    if (G.Game.global.bicycle) chance *= 0.8;
    let hit = false;
    if (this.stepCount < minSteps) {
      this.stepCount++;
      if (G.U.rand(100) >= chance * 5 / (table.density + this.chanceAccumulator / 200)) return;
    }
    if (G.U.rand(100) < chance) hit = true;
    else { this.chanceAccumulator += table.density; if (G.Game.global.repel > 0) this.chanceAccumulator = 0; return; }
    if (!hit) return;
    const enc = this.chooseWild(table);
    if (!enc) return;
    // Repel blocks weaker Pokémon
    const lead = G.Game.firstAble();
    if (G.Game.global.repel > 0 && lead && enc.level < lead.level) { this.chanceAccumulator = 0; return; }
    this.stepCount = 0; this.chanceAccumulator = 0;
    G.MapScene.queue(function* () { yield* G.Battle.startWild(new G.Pokemon(enc.species, enc.level), {}); });
  },
  chooseWild(table) {
    const total = table.slots.reduce((s, x) => s + x.chance, 0);
    let r = G.U.rand(total);
    for (const s of table.slots) {
      if ((r -= s.chance) < 0) return { species: s.species, level: G.U.randRange(s.min, s.max) };
    }
    return null;
  },

  // ---------------------------------------------------------------- whiteout
  *whiteOut() {
    const g = G.Game;
    const lost = Math.min(g.player.money, Math.floor(g.player.money / 2));
    yield* G.MapScene.messageBox.show(`${G.Config.PLAYER_NAME} is out of usable POKéMON!`);
    if (lost > 0) yield* G.MapScene.messageBox.show(`${G.Config.PLAYER_NAME} panicked and lost ¥${lost}...`);
    g.player.money -= lost;
    yield* G.MapScene.messageBox.show(`... ... ... ...\\n${G.Config.PLAYER_NAME} whited out!`);
    yield* G.Fade.out(0.5);
    g.healParty();
    g.global.surfing = false; g.global.bicycle = false;
    const pc = g.global.pokecenter;
    if (pc) yield* G.MapScene.transferPlayer(pc.map, pc.x, pc.y, 8, false, { noFadeOut: true });
    else {
      // Before visiting a Pokémon Center you wake up at home next to Mom
      // (the kit's metadata "Home" points at its debug map).
      yield* G.MapScene.transferPlayer(7, 8, 4, 4, false, { noFadeOut: true });
    }
    G.Game.playerChar.refreshCharset();
  },

  // ---------------------------------------------------------------- naming
  *offerNickname(pkmn) {
    const r = yield* G.MapScene.messageBox.show(`Do you want to give a nickname to the ${pkmn.speciesName} you received?`, { choices: ['YES', 'NO'], cancelIndex: 1 });
    if (r !== 0) return;
    const name = yield* G.Scenes.call(new G.NameEntryScene({ title: `${pkmn.speciesName}'s nickname?`, max: 10, icon: pkmn.species }));
    if (name) pkmn.nickname = name;
  },

  // --------------------------------------------------------------- moves
  partyWithMove(move) { return G.Game.party.find((p) => !p.egg && p.knowsMove(move)) || null; },
  // FRLG field-move badge requirements
  badgeFor: { FLASH: 0, CUT: 1, FLY: 2, STRENGTH: 3, SURF: 4, ROCKSMASH: 5, WATERFALL: 6 },
  canUseFieldMove(move) {
    const b = this.badgeFor[move];
    return b === undefined || G.Game.player.badges[b] || G.Config.DEBUG;
  },
  *teachMove(pkmn, move) {
    const mname = G.Data.moves[move].name;
    if (pkmn.knowsMove(move)) { yield* G.MapScene.messageBox.show(`${pkmn.name} already knows ${mname}.`); return false; }
    if (pkmn.learnMove(move)) {
      G.Audio.sfx('moveLearnt');
      yield* G.MapScene.messageBox.show(`${pkmn.name} learned ${mname}!`);
      return true;
    }
    return yield* G.Battle.askForgetMove(pkmn, move, (t, o) => G.MapScene.messageBox.show(t, o));
  },
  *useFieldMoveOnEvent(move, ev) {
    const box = G.MapScene.messageBox;
    const texts = {
      CUT: ['This tree looks like it can be CUT down!', 'Would you like to use CUT?'],
      ROCKSMASH: ["It's a rugged rock, but a POKéMON may be able to smash it.", 'Would you like to use ROCK SMASH?'],
    }[move];
    const user = this.partyWithMove(move);
    if (!user || !this.canUseFieldMove(move)) { yield* box.show(texts[0]); return false; }
    const r = yield* box.show(texts[0] + '\\n' + texts[1], { choices: ['YES', 'NO'], cancelIndex: 1 });
    if (r !== 0) return false;
    yield* box.show(`${user.name} used ${G.Data.moves[move].name}!`);
    G.Audio.sfx(move === 'CUT' ? 'cut' : 'rockSmash');
    return true;
  },
  *smashEvent(ev) {
    if (!ev) return;
    for (let i = 0; i < 4; i++) { ev.opacity = i % 2 ? 255 : 80; yield* G.U.wait(0.06); }
    ev.erase();
    ev.opacity = 255;
  },
  *rockSmashEncounter() {
    const t = this.encounterTable(G.World.map, 'RockSmash');
    if (!t || G.U.rand(100) >= (t.density || 50)) return;
    const enc = this.chooseWild(t);
    if (enc) yield* G.Battle.startWild(new G.Pokemon(enc.species, enc.level), {});
  },
  *pushBoulder(ev) {
    if (!ev) return;
    if (!G.Game.global.strength) {
      const user = this.partyWithMove('STRENGTH');
      if (!user || !this.canUseFieldMove('STRENGTH')) { yield* G.MapScene.messageBox.show("It's a big boulder, but a POKéMON may be able to push it aside."); return; }
      const r = yield* G.MapScene.messageBox.show("It's a big boulder, but a POKéMON may be able to push it aside.\\nWould you like to use STRENGTH?", { choices: ['YES', 'NO'], cancelIndex: 1 });
      if (r !== 0) return;
      yield* G.MapScene.messageBox.show(`${user.name} used STRENGTH!\\n${user.name}'s STRENGTH made it possible to move boulders around!`);
      G.Game.global.strength = true;
      return;
    }
    const d = G.Game.playerChar.direction;
    const oldThrough = ev.through;
    if (ev.canMove(d, true)) {
      G.Audio.sfx('strength');
      ev.moveGeneric(d, false);
      while (ev.moving()) yield;
      const g = G.Game.global;
      ((g.movedEvents = g.movedEvents || {})[ev.map.id] = g.movedEvents[ev.map.id] || {})[ev.id] = [ev.x, ev.y];
    }
    ev.through = oldThrough;
  },
  // Surfing: talking to water
  *trySurf() {
    const box = G.MapScene.messageBox;
    const p = G.Game.playerChar;
    if (G.Game.global.surfing) return false;
    const tag = p.facingTerrainTag();
    if (!G.Terrain.canSurfFreely(tag)) return false;
    const user = this.partyWithMove('SURF');
    if (!user || !this.canUseFieldMove('SURF')) { yield* box.show('The water is dyed a deep blue...'); return true; }
    const r = yield* box.show('The water is dyed a deep blue...\\nWould you like to SURF?', { choices: ['YES', 'NO'], cancelIndex: 1 });
    if (r !== 0) return true;
    yield* box.show(`${user.name} used SURF!`);
    yield* this.startSurf();
    return true;
  },
  *startSurf() {
    const p = G.Game.playerChar;
    G.Game.global.bicycle = false;
    G.Game.global.surfing = true;
    p.refreshCharset();
    G.Audio.playMusicKey('surf');
    p.through = true;
    p.jumpForward(1);
    while (p.jumping()) yield;
    p.through = false;
  },
  // Called before a step: hop off the water onto land.
  endSurf(p, dir) {
    if (!G.Game.global.surfing) return false;
    const tag = p.facingTerrainTag(dir);
    if (G.Terrain.canSurf(tag)) return false;
    if (p.jumpForward(1)) {
      G.Game.global.surfing = false;
      p.refreshCharset();
      G.MapScene.autoplayBGM();
      return true;
    }
    return false;
  },
  // A on something interesting that isn't an event (water, etc.)
  *checkFacingTile() {
    if (yield* this.trySurf()) return true;
    return false;
  },

  // --------------------------------------------------------------- fishing
  *fish(rod) {
    const box = G.MapScene.messageBox;
    const p = G.Game.playerChar;
    const tag = p.facingTerrainTag();
    if (!G.Terrain.isWater(tag)) { yield* box.show("Can't use that here."); return; }
    const kind = { OLDROD: 'OldRod', GOODROD: 'GoodRod', SUPERROD: 'SuperRod' }[rod];
    const table = this.encounterTable(G.World.map, kind);
    const old = p.characterName;
    p.characterName = p.charset('fish'); p.lockPattern = true;
    for (let i = 0; i < 4; i++) { p.pattern = i; yield* G.U.wait(0.1); }
    const dots = 1 + G.U.rand(4);
    box.active = false;
    for (let i = 0; i < dots; i++) yield* G.U.wait(0.5);
    const bite = table && G.U.rand(100) < (rod === 'OLDROD' ? 75 : rod === 'GOODROD' ? 85 : 95);
    if (!bite) {
      yield* box.show('Not even a nibble...');
    } else {
      yield* box.show('Oh! A bite!');
      const enc = this.chooseWild(table);
      p.characterName = old; p.lockPattern = false; p.pattern = 0;
      if (enc) yield* G.Battle.startWild(new G.Pokemon(enc.species, enc.level), {});
      return;
    }
    p.characterName = old; p.lockPattern = false; p.pattern = 0;
  },

  // --------------------------------------------------------------- Safari
  // The Safari Game (Essentials SafariState): 600 steps and 30 Safari Balls.
  // The gate's events read `decision` (1 = the game is over) when the player
  // is sent back there.
  SAFARI_STEPS: 600,
  safariState() {
    const s = G.Game.global.safari || { steps: 0, balls: 0 };
    return {
      get decision() { return s.decision || 0; },
      get ballcount() { return s.balls; },
      pbStart: (balls) => {
        const p = G.Game.playerChar;
        G.Game.global.safari = { steps: G.Field.SAFARI_STEPS, balls, decision: 0, start: { map: G.World.map.id, x: p.x, y: p.y, dir: p.direction } };
      },
      pbEnd: () => { G.Game.global.safari = null; },
    };
  },
  inSafariZone() {
    const s = G.Game.global.safari;
    return !!(s && G.World.map.meta.SafariMap && G.Data.encounters[G.World.map.id]);
  },
  // Counts down Safari steps; returns true when the game just ended.
  safariStep() {
    const s = G.Game.global.safari;
    if (!s || !this.inSafariZone() || s.decision) return false;
    s.steps--;
    if (s.steps > 0) return false;
    G.MapScene.queue(function* () { yield* G.Field.safariOver('PA: Ding-dong!\\nTime\'s up!'); });
    return true;
  },
  *safariOver(text) {
    const s = G.Game.global.safari;
    if (!s) return;
    s.decision = 1;
    if (text) yield* G.MapScene.messageBox.show(text);
    yield* G.MapScene.messageBox.show('PA: Your SAFARI GAME is over!');
    const st = s.start;
    yield* G.MapScene.transferPlayer(st.map, st.x, st.y, 2, true);
  },
  // Leaving the Safari maps any other way (Fly, Escape Rope...) ends the game.
  onSafariMapChange() {
    const s = G.Game.global.safari;
    if (s && !G.World.map.meta.SafariMap) G.Game.global.safari = null;
  },
};
