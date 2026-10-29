// Battle presentation (FRLG layout at 240x160) and the entry points the
// overworld uses: G.Battle.startWild / startTrainer.
'use strict';

// Battle data box colours (FireRed)
const BOX_COLORS_FR = { border: '#405048', fill: '#f8f8d8', fillShade: '#e0e0b8', base: '#506860' };

// The message box / command menus along the bottom (FireRed's is 48px; it's
// 40px here so it never overlaps the foe).
const BOX_H = 40, BOX_Y = 160 - BOX_H;

G.BattleScene = class BattleScene extends G.Scene {
  constructor({ wild, foeParty, trainer = null, rules = {} }) {
    super();
    const g = G.Game;
    const m = G.World.map;
    const meta = (m && m.meta) || {};
    this.bg = rules.backdrop || meta.BattleBack || (meta.Outdoor ? 'field' : 'interior');
    // Backgrounds named by the kit's map data but not shipped with it
    this.bg = { city: 'field', pokecenter: 'interior' }[this.bg] || this.bg;
    this.base = this.bg === 'field' ? 'grass' : this.bg;
    if (g.global.surfing) this.base = 'water';
    this.core = new G.BattleCore({ party: g.party, foeParty, trainer, wild, rules, ui: this });
    this.wild = wild;
    this.trainer = trainer;
    this.text = null;           // {lines, shown, wait}
    this.menu = null;           // 'command' | 'fight' | null
    this.cursor = 0; this.fightCursor = 0;
    this.sprites = {
      0: { visible: false, x: 0, y: 0, alpha: 1, flash: 0, scale: 1 },
      1: { visible: false, x: 0, y: 0, alpha: 1, flash: 0, scale: 1 },
    };
    this.boxes = { 0: { visible: false, hp: 0, exp: 0, slide: 0 }, 1: { visible: false, hp: 0, slide: 0 } };
    this.lineup = null;         // trainer battles: both parties' Poké Ball rows
    this.alarmAt = 0;           // next low-HP alarm beep
    this.playerTrainer = { visible: true, x: 40, frame: 0 };
    this.foeTrainer = { visible: !!trainer, x: 184 };
    this.slideIn = 1;           // start off-screen so the intro is one smooth slide
    this.overlayColor = null;
    this.ball = null;
    this.statsPanel = null;
    this.shake = 0;
  }
  *main() {
    const paths = [
      `sprites/battlebacks/${this.bg}_bg.png`, `sprites/battlebacks/${this.base}_base0.png`, `sprites/battlebacks/${this.base}_base1.png`,
      'sprites/battlebacks/field_message.png', 'sprites/ui/battle/overlay_command.png', 'sprites/ui/battle/overlay_fight.png',
      'sprites/ui/battle/databox_normal.png', 'sprites/ui/battle/databox_normal_foe.png', 'sprites/ui/battle/overlay_hp.png',
      'sprites/ui/battle/overlay_exp.png', 'sprites/ui/battle/icon_statuses.png', 'sprites/ui/types.png', 'sprites/ui/battle/icon_own.png',
      `sprites/trainers/${G.Game.player.gender === 'female' ? 'POKEMONTRAINER_Leaf' : 'POKEMONTRAINER_Red'}_back.png`,
    ];
    for (const p of G.Game.party) paths.push(G.Assets.pokemon(p.species, true, p.shiny));
    for (const p of this.core.foeParty) paths.push(G.Assets.pokemon(p.species, false, p.shiny));
    for (const id of new Set(['POKEBALL', ...G.Game.party.map((p) => p.ball || 'POKEBALL')])) {
      paths.push(`sprites/battle/balls/ball_${id}.png`, `sprites/battle/balls/ball_${id}_open.png`);
    }
    if (this.trainer) paths.push(this.trainer.spritePath);
    let done = false;
    G.Assets.loadAll(paths).then(() => { done = true; });
    while (!done) yield;
    const result = yield* this.core.run();
    yield* G.Fade.out(0.3);
    return { result, caught: this.core.caught, levelled: this.core.levelledUp };
  }

  // ------------------------------------------------------------- positions
  spritePos(side) {
    const b = this.core.battlers[side];
    const met = b.p && b.p.data.metrics ? b.p.data.metrics : { back: [0, 0], front: [0, 0], altitude: 0 };
    if (side === 0) return { x: 64 + met.back[0], y: 120 + met.back[1] };
    return { x: 184 + met.front[0], y: 72 + met.front[1] - met.altitude };
  }
  refresh() {
    for (const s of [0, 1]) {
      const b = this.core.battlers[s];
      if (b.p) this.boxes[s].hp = b.hp;
    }
  }

  // ======================================================== UI interface
  *intro() {
    G.Input.clear();
    this.refresh();
    const start = G.time;
    while (G.time - start < 0.8) { this.slideIn = 1 - (G.time - start) / 0.8; yield; }
    this.slideIn = 0;
    if (this.wild) {
      const f = this.core.foeParty[0];
      G.Audio.cry(f.species);
    }
  }
  *message(text, { wait = false } = {}) {
    const { tokens } = G.MessageBox.parse(text);
    const lines = G.MessageBox.layout(tokens, 220);
    for (let page = 0; page < lines.length; page += 2) {
      this.text = { lines: lines.slice(page, page + 2), shown: 0, arrow: false };
      const total = this.text.lines.flat().length;
      const speed = [1, 2, 4][G.Game.options.textSpeed];
      while (this.text.shown < total) {
        this.text.shown = Math.min(total, this.text.shown + (G.Input.press('A') || G.Input.press('B') ? 6 : speed));
        yield;
      }
      const last = page + 2 >= lines.length;
      if (wait || !last) {
        this.text.arrow = true;
        G.Input.clear();
        while (!G.Input.trigger('A') && !G.Input.trigger('B')) yield;
        G.Audio.sfx('cursor');
        this.text.arrow = false;
      } else {
        const t = G.time;
        while (G.time - t < 0.9 && !G.Input.trigger('A')) yield;
      }
    }
  }
  *choose(text, choices) {
    yield* this.message(text, { wait: false });
    const cw = new G.UI.CommandWindow(choices, { cancelIndex: choices.length - 1 });
    cw.x = G.Config.WIDTH - cw.w - 2; cw.y = BOX_Y - 2 - cw.h;
    this.choiceWin = cw;
    const r = yield* cw.run();
    this.choiceWin = null;
    return r;
  }
  *showFoe(b, fromBall) {
    const s = this.sprites[1];
    if (fromBall) {
      if (this.foeTrainer.visible) yield* this.trainerSlideOut();
      // the foe's ball flies in from the right and the Pokémon pops out
      yield* this.ballSendOut(1, b, 250, 20);
    } else { s.visible = true; s.scale = 1; }
    s.alpha = 1; s.yOff = 0;
    if (b.p.shiny) yield* this.commonAnimation('Shiny', b);
    this.boxes[1].hp = b.hp;
    yield* this.slideBox(1);
    yield* G.U.wait(0.1);
  }
  // A data box slides in from its side of the screen (FireRed).
  *slideBox(side) {
    const box = this.boxes[side];
    box.visible = true; box.slide = 1;
    const t0 = G.time;
    while (G.time - t0 < 0.25) { box.slide = 1 - (G.time - t0) / 0.25; yield; }
    box.slide = 0;
  }
  // Ball arcs from (x0, y0) to the battler's spot, opens, and the Pokémon
  // grows out of it as a white silhouette that fades to its real colours.
  *ballSendOut(side, b, x0, y0) {
    const s = this.sprites[side];
    const pos = this.spritePos(side);
    const img = this.battlerImage(side);
    // the sprite grows up from its feet, so the ball opens low on the body
    const hx = pos.x, hy = pos.y - (img ? img.height * 0.2 : 12);
    const id = b.p.ball && G.Assets.get(`sprites/battle/balls/ball_${b.p.ball}.png`) ? b.p.ball : 'POKEBALL';
    this.ball = { id, x: x0, y: y0, rot: 0, frame: 0, open: false, dark: 0, stars: null };
    const ball = this.ball;
    G.Audio.sfx('ballThrow');
    let t0 = G.time;
    while (G.time - t0 < 0.4) {
      const t = (G.time - t0) / 0.4;
      ball.x = G.U.lerp(x0, hx, t);
      ball.y = G.U.lerp(y0, hy, t) - Math.sin(t * Math.PI) * 24;
      ball.frame = Math.floor(t * 12) % 8;
      yield;
    }
    ball.x = hx; ball.y = hy; ball.frame = 0; ball.open = true;
    G.Audio.sfx('sendOut');
    s.visible = true; s.scale = 0; s.alpha = 1; s.yOff = 0;
    const glow = this.overlayColor = { side, color: '#ffffff', until: G.time + 2, alpha: 1 };
    t0 = G.time;
    while (G.time - t0 < 0.3) { s.scale = (G.time - t0) / 0.3; yield; }
    s.scale = 1;
    this.ball = null;
    G.Audio.cry(b.p.species);
    t0 = G.time;
    while (G.time - t0 < 0.25) { glow.alpha = 1 - (G.time - t0) / 0.25; yield; }
    if (this.overlayColor === glow) this.overlayColor = null;
  }
  // Trainer battles: each side's party as a row of Poké Balls (FireRed).
  *showLineups() {
    this.lineup = { slide: 1 };
    const t0 = G.time;
    while (G.time - t0 < 0.3) { this.lineup.slide = 1 - (G.time - t0) / 0.3; yield; }
    this.lineup.slide = 0;
  }
  *hideLineups() {
    if (!this.lineup) return;
    const t0 = G.time;
    while (G.time - t0 < 0.25) { this.lineup.slide = (G.time - t0) / 0.25; yield; }
    this.lineup = null;
  }
  // The foe trainer steps off to the right before sending out a Pokémon.
  *trainerSlideOut() {
    if (!this.foeTrainer.visible) return;
    const t0 = G.time;
    while (G.time - t0 < 0.4) { this.foeTrainer.x = 184 + (G.time - t0) * 200; yield; }
    this.foeTrainer.visible = false;
  }
  *sendOut(b) {
    const s = this.sprites[0];
    if (this.playerTrainer.visible) {
      const t0 = G.time;
      while (G.time - t0 < 0.45) {
        const t = (G.time - t0) / 0.45;
        this.playerTrainer.frame = Math.min(4, Math.floor(t * 5));
        this.playerTrainer.x = 40 - t * 90;
        yield;
      }
      this.playerTrainer.visible = false;
    }
    void s;
    yield* this.ballSendOut(0, b, 20, 96);
    if (b.p.shiny) yield* this.commonAnimation('Shiny', b);
    this.boxes[0].hp = b.hp;
    this.boxes[0].exp = b.p.expFraction();
    yield* this.slideBox(0);
    yield* G.U.wait(0.1);
  }
  // Recalled Pokémon turn white and shrink back into their ball.
  *recall(b) {
    G.Audio.sfx('recall');
    const s = this.sprites[b.side];
    const glow = this.overlayColor = { side: b.side, color: '#ffffff', until: G.time + 2, alpha: 0 };
    let t0 = G.time;
    while (G.time - t0 < 0.15) { glow.alpha = (G.time - t0) / 0.15; yield; }
    t0 = G.time;
    while (G.time - t0 < 0.3) { s.scale = 1 - (G.time - t0) / 0.3; yield; }
    s.visible = false; s.scale = 1;
    if (this.overlayColor === glow) this.overlayColor = null;
    this.boxes[b.side].visible = false;
  }
  // FireRed: the fainting Pokémon cries, then drops out of sight below its
  // platform while its data box disappears.
  *faint(b) {
    const s = this.sprites[b.side];
    yield* G.U.wait(0.5); // the core has just played its cry
    G.Audio.sfx('faint');
    this.boxes[b.side].visible = false;
    const img = this.battlerImage(b.side);
    const drop = img ? img.height : 64;
    const t0 = G.time;
    while (G.time - t0 < 0.35) { s.yOff = (G.time - t0) / 0.35 * drop; yield; }
    s.visible = false; s.yOff = 0; s.alpha = 1;
  }
  battlerImage(side) {
    const b = this.core.battlers[side];
    if (!b.p) return null;
    const species = this.sprites[side].transformInto && b.transformed ? this.sprites[side].transformInto : b.p.species;
    return G.Assets.get(G.Assets.pokemon(species, side === 0, b.p.shiny));
  }
  // Plays a "Common:..." animation (stat changes, status, weather) if the kit has it.
  *commonAnimation(name, b) {
    if (!G.Game.options.battleScene) return false;
    const found = G.BattleAnim.findNamed('Common:' + name);
    if (!found) return false;
    yield* G.BattleAnim.play(this, found, b.side, b.side);
    return true;
  }
  *moveAnimation(user, target, move) {
    if (!G.Game.options.battleScene) return;
    const found = G.BattleAnim.find(move.id, user.side);
    if (found) { yield* G.BattleAnim.play(this, found, user.side, target.side); return; }
    const us = this.sprites[user.side];
    // lunge forward
    const dir = user.side === 0 ? 1 : -1;
    const t0 = G.time;
    if (move.category !== 'Status') {
      while (G.time - t0 < 0.15) { us.dx = Math.sin((G.time - t0) / 0.15 * Math.PI) * 8 * dir; yield; }
      us.dx = 0;
    } else {
      this.overlayColor = { side: target.side, color: { NORMAL: '#ffffff', FIRE: '#ff7030', WATER: '#3090ff', GRASS: '#40d040', ELECTRIC: '#ffe040', PSYCHIC: '#ff60c0', POISON: '#a040c0', ICE: '#a0ffff', GHOST: '#6050a0' }[move.type] || '#ffffff', until: G.time + 0.3 };
      yield* G.U.wait(0.3);
      this.overlayColor = null;
    }
  }
  *hit(target, eff) {
    G.Audio.sfx(eff > 1 ? 'hitSuper' : eff < 1 ? 'hitWeak' : 'hitNormal');
    const s = this.sprites[target.side];
    for (let i = 0; i < 4; i++) { s.hidden = i % 2 === 0; yield* G.U.wait(0.06); }
    s.hidden = false;
  }
  *hpChange(b, from, to) {
    const box = this.boxes[b.side];
    const t0 = G.time;
    const len = Math.min(1, 0.25 + Math.abs(from - to) / b.totalHP);
    while (G.time - t0 < len) { box.hp = G.U.lerp(from, to, (G.time - t0) / len); yield; }
    box.hp = to;
  }
  // The EXP-gain sound plays only while the bar is filling, so it never runs
  // into the level-up sound that follows.
  *expAnim(b, from, to) {
    const box = this.boxes[0];
    const snd = G.Audio.sfx('expGain');
    const t0 = G.time;
    const len = Math.max(0.2, (to - from) * 1.2);
    while (G.time - t0 < len) { box.exp = G.U.lerp(from, to, (G.time - t0) / len); yield; }
    G.Audio.stopSfx(snd);
    box.exp = to >= 1 ? 0 : to;
  }
  *statAnim(b, up) {
    if (yield* this.commonAnimation(up ? 'StatUp' : 'StatDown', b)) return;
    G.Audio.sfx(up ? 'statUp' : 'statDown');
    this.overlayColor = { side: b.side, color: up ? '#ff6060' : '#6080ff', until: G.time + 0.35 };
    yield* G.U.wait(0.35);
    this.overlayColor = null;
  }
  *statusAnim(b, status) {
    const name = { POISON: b.fx && b.fx.toxic ? 'Toxic' : 'Poison', BURN: 'Burn', PARALYSIS: 'Paralysis', SLEEP: 'Sleep', FROZEN: 'Frozen' }[status];
    if (name && (yield* this.commonAnimation(name, b))) return;
    this.overlayColor = { side: b.side, color: { POISON: '#c060ff', BURN: '#ff6030', PARALYSIS: '#ffff40', SLEEP: '#a0a0ff', FROZEN: '#a0ffff' }[status] || '#fff', until: G.time + 0.3 };
    yield* G.U.wait(0.3);
    this.overlayColor = null;
  }
  *transform(u) { yield* G.U.wait(0.2); this.sprites[u.side].transformInto = u.opponent.p.species; }
  // FireRed-style capture: the ball arcs in spinning, opens and sucks the
  // Pokémon in (red flash), drops and bounces, wobbles up to 3 times, then
  // clicks shut with stars - or bursts open and the Pokémon comes back out.
  *throwBall(shakes, caught, blocked, ballId = 'POKEBALL') {
    const fp = this.spritePos(1);
    const s = this.sprites[1];
    const img = G.Assets.get(G.Assets.pokemon(this.core.foe.p.species, false, this.core.foe.p.shiny));
    const fh = img ? img.height : 64;
    // the ball lands on the foe's base (centred at y 72), not under the sprite's feet
    const hitX = fp.x, hitY = fp.y - fh * 0.55, groundY = 70;
    const sheet = `sprites/battle/balls/ball_${ballId}.png`;
    G.Assets.load(sheet); G.Assets.load(`sprites/battle/balls/ball_${ballId}_open.png`);
    this.ball = { id: ballId, x: 24, y: 104, rot: 0, frame: 0, open: false, dark: 0, stars: null };
    const b = this.ball;
    const anim = function* (len, step) { const t0 = G.time; while (G.time - t0 < len) { step((G.time - t0) / len); yield; } step(1); };
    // 1. throw: an arc from the player's side, spinning
    G.Audio.sfx('ballThrow');
    yield* anim(0.55, (t) => {
      b.x = G.U.lerp(24, hitX, t);
      b.y = G.U.lerp(104, hitY, t) - Math.sin(t * Math.PI) * 44;
      b.frame = Math.floor(t * 16) % 8;
    });
    b.frame = 0;
    if (blocked) {
      // knocked away by the trainer / dodged
      G.Audio.sfx('ballHit');
      yield* anim(0.4, (t) => { b.x = hitX - t * 50; b.y = hitY - Math.sin(t * Math.PI) * 20 + t * 40; b.rot = -t * 6; });
      this.ball = null;
      return;
    }
    // 2. hit: the ball opens, the Pokémon turns white and shrinks into it
    G.Audio.sfx('ballHit');
    b.open = true;
    const white = this.overlayColor = { side: 1, color: '#ffffff', until: G.time + 2, alpha: 0 };
    yield* anim(0.15, (t) => { white.alpha = t; });
    yield* anim(0.4, (t) => { s.scale = 1 - t; s.alpha = 1 - t * 0.5; });
    s.visible = false; s.scale = 1; s.alpha = 1;
    this.overlayColor = null;
    yield* G.U.wait(0.1);
    b.open = false;
    G.Audio.sfx('sendOut');
    yield* G.U.wait(0.15);
    // 3. drop to the ground with two smaller bounces
    yield* anim(0.32, (t) => { b.y = G.U.lerp(hitY, groundY, t * t); });
    G.Audio.sfx('ballDrop');
    for (const [height, len] of [[10, 0.24], [4, 0.14]]) {
      yield* anim(len, (t) => { b.y = groundY - Math.sin(t * Math.PI) * height; });
      G.Audio.sfx('ballDrop');
    }
    // 4. wobble once per shake check that passed
    for (let i = 0; i < shakes; i++) {
      yield* G.U.wait(0.45);
      G.Audio.sfx('ballShake');
      yield* anim(0.4, (t) => { b.rot = Math.sin(t * Math.PI * 2) * 0.45; b.x = hitX + Math.sin(t * Math.PI * 2) * 2; });
      b.rot = 0; b.x = hitX;
    }
    yield* G.U.wait(0.4);
    if (caught) {
      // 5. click, stars, and the ball dims
      G.Audio.sfx('ballClick');
      b.stars = G.time;
      yield* anim(0.5, (t) => { b.dark = t * 0.45; });
      yield* G.U.wait(0.3);
      return;
    }
    // 6. broke free: the ball bursts open and the Pokémon reappears
    G.Audio.sfx('recall');
    b.open = true;
    s.visible = true; s.scale = 0;
    const glow = this.overlayColor = { side: 1, color: '#ffffff', until: G.time + 1, alpha: 1 };
    yield* anim(0.3, (t) => { s.scale = t; });
    s.scale = 1;
    yield* anim(0.2, (t) => { glow.alpha = 1 - t; });
    this.overlayColor = null;
    this.ball = null;
    yield* G.U.wait(0.1);
  }
  *levelUpStats(pk, old) {
    this.statsPanel = { pk, old, phase: 0 };
    G.Input.clear();
    while (!G.Input.trigger('A') && !G.Input.trigger('B')) yield;
    this.statsPanel.phase = 1;
    G.Input.clear();
    while (!G.Input.trigger('A') && !G.Input.trigger('B')) yield;
    this.statsPanel = null;
  }
  *trainerReturn() {
    this.foeTrainer.visible = true;
    const t0 = G.time;
    while (G.time - t0 < 0.4) { this.foeTrainer.x = 260 - (G.time - t0) / 0.4 * 76; yield; }
    this.foeTrainer.x = 184;
  }
  *showDexEntry(species) {
    if (G.PokedexEntryScene) yield* G.Scenes.call(new G.PokedexEntryScene(species, { fromCatch: true }));
  }

  // Safari Zone turn: BALL / BAIT / ROCK / RUN
  *chooseSafari() {
    this.text = { lines: G.MessageBox.layout(G.MessageBox.parse(`What will\\n${G.Config.PLAYER_NAME} do?`).tokens, 110), shown: 999, arrow: false };
    this.menu = 'safari';
    G.Input.clear();
    while (true) {
      yield;
      const c = this.cursor;
      if (G.Input.trigger('LEFT') || G.Input.trigger('RIGHT')) { this.cursor = c ^ 1; G.Audio.sfx('cursor'); }
      else if (G.Input.trigger('UP') || G.Input.trigger('DOWN')) { this.cursor = c ^ 2; G.Audio.sfx('cursor'); }
      else if (G.Input.trigger('A')) { G.Audio.sfx('select'); this.menu = null; return this.cursor; }
    }
  }
  // Player's turn: FIGHT / BAG / POKéMON / RUN
  *chooseAction(b) {
    while (true) {
      this.text = { lines: G.MessageBox.layout(G.MessageBox.parse(`What will\\n${b.p.name} do?`).tokens, 110), shown: 999, arrow: false };
      this.menu = 'command';
      G.Input.clear();
      let pick = null;
      while (pick === null) {
        yield;
        const c = this.cursor;
        if (G.Input.trigger('LEFT') || G.Input.trigger('RIGHT')) { this.cursor = c ^ 1; G.Audio.sfx('cursor'); }
        else if (G.Input.trigger('UP') || G.Input.trigger('DOWN')) { this.cursor = c ^ 2; G.Audio.sfx('cursor'); }
        else if (G.Input.trigger('A')) { G.Audio.sfx('select'); pick = this.cursor; }
      }
      this.menu = null;
      if (pick === 0) {
        const r = yield* this.chooseMove(b);
        if (r !== null) return { type: 'fight', index: r };
      } else if (pick === 1) {
        const r = yield* G.Scenes.call(new G.BagScene({ mode: 'battle', battle: this.core }));
        if (r) return { type: 'item', item: r.item, target: r.target };
      } else if (pick === 2) {
        const idx = yield* this.choosePokemon({ canCancel: true });
        if (idx >= 0 && idx !== b.partyIndex) return { type: 'switch', index: idx };
      } else if (pick === 3) {
        return { type: 'run' };
      }
    }
  }
  *chooseMove(b) {
    this.menu = 'fight';
    G.Input.clear();
    while (true) {
      yield;
      const n = b.moves.length;
      const c = this.fightCursor;
      if (G.Input.trigger('LEFT') || G.Input.trigger('RIGHT')) { const nc = c ^ 1; if (nc < n) { this.fightCursor = nc; G.Audio.sfx('cursor'); } }
      else if (G.Input.trigger('UP') || G.Input.trigger('DOWN')) { const nc = c ^ 2; if (nc < n) { this.fightCursor = nc; G.Audio.sfx('cursor'); } }
      else if (G.Input.trigger('A')) { G.Audio.sfx('select'); this.menu = null; return this.fightCursor; }
      else if (G.Input.trigger('B')) { G.Audio.sfx('cancel'); this.menu = null; return null; }
      if (this.fightCursor >= n) this.fightCursor = 0;
    }
  }
  *choosePokemon({ canCancel = true, forced = false } = {}) {
    while (true) {
      const r = yield* G.Scenes.call(new G.PartyScene({ mode: 'battle', battle: this.core, canCancel: canCancel && !forced }));
      if (r === null || r === undefined || r < 0) { if (forced) continue; return -1; }
      const p = G.Game.party[r];
      if (p.hp <= 0) { yield* this.message(`${p.name} has no energy left to battle!`, { wait: true }); continue; }
      if (r === this.core.player.partyIndex && !this.core.player.fainted) { yield* this.message(`${p.name} is already in battle!`, { wait: true }); continue; }
      return r;
    }
  }

  // ================================================================ draw
  draw(ctx) {
    const W = G.Config.WIDTH;
    const A = G.Assets;
    ctx.fillStyle = '#f8f8f8';
    ctx.fillRect(0, 0, W, 160);
    const bg = A.get(`sprites/battlebacks/${this.bg}_bg.png`);
    if (bg) ctx.drawImage(bg, -8, -16);
    const slide = Math.round(this.slideIn * 240);
    const base0 = A.get(`sprites/battlebacks/${this.base}_base0.png`);
    const base1 = A.get(`sprites/battlebacks/${this.base}_base1.png`);
    if (base1) ctx.drawImage(base1, 184 - base1.width / 2 - slide, 72 - base1.height / 2);
    // the player's platform: its flat bottom edge sits just behind the top of
    // the message box, so the mound shows above it like in FireRed
    if (base0) ctx.drawImage(base0, 56 - base0.width / 2 + slide, BOX_Y + 3 - base0.height);
    // Foe trainer / Pokémon
    if (this.foeTrainer.visible && this.trainer) {
      const img = A.get(this.trainer.spritePath);
      if (img) ctx.drawImage(img, Math.round(this.foeTrainer.x - img.width / 2 - slide), 72 + 6 - img.height + 8);
    }
    G.BattleAnim.drawCels(ctx, this.anim, false);
    this.drawBattler(ctx, 1, -slide);
    // Player trainer / Pokémon
    if (this.playerTrainer.visible) {
      const img = A.get(`sprites/trainers/${G.Game.player.gender === 'female' ? 'POKEMONTRAINER_Leaf' : 'POKEMONTRAINER_Red'}_back.png`);
      if (img) {
        const fw = img.height;
        ctx.drawImage(img, this.playerTrainer.frame * fw, 0, fw, fw, Math.round(this.playerTrainer.x - fw / 2 + 16 + slide), BOX_Y - fw, fw, fw);
      }
    }
    this.drawBattler(ctx, 0, slide);
    G.BattleAnim.drawCels(ctx, this.anim, true);
    if (this.flash && this.flash.side < 0 && G.time < this.flash.until) {
      const [r, g, b, a] = this.flash.color;
      ctx.fillStyle = `rgba(${r},${g},${b},${(a || 255) / 255})`;
      ctx.fillRect(0, 0, 240, BOX_Y);
    }
    this.drawBox(ctx, 1);
    this.drawBox(ctx, 0);
    if (this.lineup) { this.drawLineup(ctx, 1); this.drawLineup(ctx, 0); }
    this.lowHpAlarm();
    if (this.ball) this.drawBall(ctx); // above the data boxes, so it never hides behind them
    this.drawMessageArea(ctx);
    if (this.statsPanel) this.drawStatsPanel(ctx);
    if (this.choiceWin) this.choiceWin.draw(ctx);
  }
  drawBattler(ctx, side, slide) {
    const s = this.sprites[side];
    const b = this.core.battlers[side];
    if (!s.visible || s.hidden || !b.p) return;
    const species = s.transformInto && b.transformed ? s.transformInto : b.p.species;
    const img = G.Assets.get(G.Assets.pokemon(species, side === 0, b.p.shiny));
    if (!img) return;
    const pos = this.spritePos(side);
    const ov = G.BattleAnim.battlerOverride(this.anim, side);
    const w = img.width * s.scale * (ov ? ov.zx : 1), h = img.height * s.scale * (ov ? ov.zy : 1);
    const x = Math.round(pos.x - w / 2 + slide + (s.dx || 0) + (ov ? ov.dx : 0));
    const y = Math.round(pos.y - img.height * s.scale / 2 - h / 2 + (s.yOff || 0) + (ov ? ov.dy : 0));
    ctx.save();
    ctx.globalAlpha = s.alpha * (ov ? ov.opacity : 1);
    if (s.yOff) { ctx.beginPath(); ctx.rect(0, 0, 240, pos.y); ctx.clip(); }
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
    let o = this.overlayColor;
    if (this.flash && this.flash.side === side && G.time < this.flash.until) {
      const [r, g, b] = this.flash.color;
      o = { side, color: `rgb(${r},${g},${b})`, until: this.flash.until };
    }
    if (o && o.side === side && G.time < o.until) {
      const c = G.Screen.scratch(img.width, img.height);
      const cx = c.getContext('2d');
      cx.clearRect(0, 0, c.width, c.height);
      cx.drawImage(img, 0, 0);
      cx.globalCompositeOperation = 'source-in';
      cx.globalAlpha = o.alpha !== undefined ? o.alpha : 0.6;
      cx.fillStyle = o.color;
      cx.fillRect(0, 0, img.width, img.height);
      cx.globalCompositeOperation = 'source-over';
      cx.globalAlpha = 1;
      ctx.drawImage(c, 0, 0, img.width, img.height, x, y, w, h);
    }
  }
  drawBall(ctx) {
    const b = this.ball;
    const closed = G.Assets.get(`sprites/battle/balls/ball_${b.id}.png`) || G.Assets.get('sprites/battle/balls/ball_POKEBALL.png');
    const open = G.Assets.get(`sprites/battle/balls/ball_${b.id}_open.png`);
    ctx.save();
    ctx.translate(Math.round(b.x), Math.round(b.y));
    if (b.rot) ctx.rotate(b.rot);
    // 16x32 frames (halved from the kit's 32x64), the ball sits in the middle
    if (b.open && open) ctx.drawImage(open, 0, 0, 16, 32, -8, -18, 16, 32);
    else if (closed) ctx.drawImage(closed, b.frame * 16, 0, 16, 32, -8, -16, 16, 32);
    else { ctx.fillStyle = '#e83018'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); }
    if (b.dark) { ctx.globalAlpha = b.dark; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    // stars flying up and out after a successful catch
    if (b.stars) {
      const t = (G.time - b.stars) / 0.7;
      if (t < 1) {
        ctx.fillStyle = '#f8f0a0';
        for (let i = 0; i < 3; i++) {
          const sx = Math.round(b.x + (i - 1) * 14 * t), sy = Math.round(b.y - 6 - 16 * Math.sin(t * Math.PI) - 4 * (i === 1));
          ctx.globalAlpha = 1 - t;
          ctx.fillRect(sx - 2, sy, 5, 1); ctx.fillRect(sx, sy - 2, 1, 5); ctx.fillRect(sx - 1, sy - 1, 3, 3);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  // FireRed keeps beeping while your Pokémon's HP is in the red.
  lowHpAlarm() {
    const box = this.boxes[0], b = this.core.battlers[0];
    const low = box.visible && b.p && !this.core.result && box.hp > 0 && box.hp <= b.totalHP / 4;
    if (!low) { this.alarmAt = 0; return; }
    if (G.time >= this.alarmAt) { G.Audio.sfx('lowHp'); this.alarmAt = G.time + 0.5; }
  }
  // A row of 6 small balls on a dark bar: foe's top-left, yours above the
  // text box on the right. Fainted = grey, status = yellow, empty = outline.
  drawLineup(ctx, side) {
    const party = side === 0 ? G.Game.party.filter((p) => !p.egg) : this.core.foeParty;
    const off = Math.round(this.lineup.slide * 140) * (side === 0 ? 1 : -1);
    const y = side === 0 ? BOX_Y - 22 : 34;
    const x0 = side === 0 ? 128 + off : 8 + off;
    const C = BOX_COLORS_FR;
    // bar: flat along the top, slanting away at the outer end
    for (let r = 0; r < 3; r++) {
      if (side === 0) G.UI.hline(ctx, x0 - r, y + 8 + r, 116 + r, C.border);
      else G.UI.hline(ctx, x0 - 8, y + 8 + r, 108 + r, C.border);
    }
    for (let i = 0; i < 6; i++) {
      const p = party[side === 0 ? i : 5 - i];
      const state = !p ? 'empty' : p.hp <= 0 ? 'faint' : p.status ? 'status' : 'ok';
      G.UI.pixelBall(ctx, x0 + 10 + i * 16, y, state);
    }
  }

  // FRLG-style data boxes (foe: top-left, player: right above the text box)
  drawBox(ctx, side) {
    const box = this.boxes[side];
    const b = this.core.battlers[side];
    if (!box.visible || !b.p) return;
    const p = b.p;
    const slide = Math.round(this.slideIn * 240) + Math.round(box.slide * 130);
    // FireRed layout: a cream panel with a thick dark rounded border, sitting
    // on a darker slanted base (the foe's trails off to the right; the
    // player's runs underneath, sloping down to the left, and carries EXP).
    // the player's box sits low, its EXP base resting on the message box (FireRed)
    const bx = side === 0 ? 132 + slide : 10 - slide, by = side === 0 ? BOX_Y - 39 : 14;
    const w = 102, h = side === 0 ? 32 : 26;
    const C = BOX_COLORS_FR;
    if (side === 1) {
      // shadow strip under the bottom edge, its right end slanting down-right
      for (let r = 0; r < 10; r++) G.UI.hline(ctx, bx + 12, by + h - 6 + r, w - 10 + r, C.base);
    } else {
      // base under the box: slants down-left on the left, juts out a little on the right
      for (let r = 0; r < 14; r++) {
        const y = by + h - 7 + r, left = bx + 8 - r;
        G.UI.hline(ctx, left, y, bx + w + 4 - left, C.base);
      }
      for (let r = 0; r < h - 10; r++) G.UI.hline(ctx, bx + w - 2, by + 8 + r, 6, C.base);
    }
    G.UI.roundRect(ctx, bx, by, w, h, 3, C.border);
    G.UI.roundRect(ctx, bx + 2, by + 2, w - 4, h - 4, 2, C.fill);
    G.UI.hline(ctx, bx + 4, by + h - 3, w - 8, C.fillShade);
    // long names (Charmander, Butterfree...) use the narrow font so they never touch "Lv"
    const nameFont = G.Font.width(p.name) > 56 ? 'narrow' : 'normal';
    G.Font.draw(ctx, p.name, bx + 6, by + 1, 'black', { font: nameFont });
    if (p.gender) G.Font.draw(ctx, p.gender === 'M' ? '♂' : '♀', bx + 7 + G.Font.width(p.name, nameFont), by + 1, p.gender === 'M' ? 'blue' : 'red');
    G.Font.draw(ctx, 'Lv' + p.level, bx + w - 6, by + 1, 'black', { align: 'right' });
    const frac = G.U.clamp(box.hp / p.totalHP, 0, 1);
    G.UI.hpCapsule(ctx, bx + w - 70, by + 14, 48, frac);
    if (p.status) {
      const st = G.Assets.get('sprites/ui/battle/icon_statuses.png');
      const idx = { SLEEP: 0, POISON: 1, BURN: 2, PARALYSIS: 3, FROZEN: 4 }[p.status];
      if (st) ctx.drawImage(st, 0, idx * 8, 22, 8, bx + 6, by + 15, 22, 8);
    } else if (side === 1 && this.wild && G.Game.player.owned[p.species]) {
      ctx.fillStyle = '#e04030'; ctx.beginPath(); ctx.arc(bx + 10, by + 19, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f8f8f8'; ctx.fillRect(bx + 7, by + 19, 7, 3);
    }
    if (side === 0) {
      // HP numbers under the bar, EXP on the dark base below the box
      G.UI.digits(ctx, `${Math.ceil(box.hp)}/${p.totalHP}`, bx + w - 7, by + 22, '#404040', { align: 'right' });
      const ey = by + h + 1;
      G.UI.micro(ctx, 'EXP', bx + 4, ey, '#f8b000');
      ctx.fillStyle = '#283830'; ctx.fillRect(bx + 18, ey + 1, w - 20, 3);
      ctx.fillStyle = '#40a8f8'; ctx.fillRect(bx + 18, ey + 1, Math.floor((w - 20) * G.U.clamp(box.exp, 0, 1)), 3);
    }
  }
  drawMessageArea(ctx) {
    // FireRed's dark text box with a gold-trimmed frame
    ctx.fillStyle = '#c89838'; ctx.fillRect(0, BOX_Y, 240, BOX_H);
    ctx.fillStyle = '#304860'; ctx.fillRect(2, BOX_Y + 2, 236, BOX_H - 4);
    ctx.fillStyle = '#285078'; ctx.fillRect(4, BOX_Y + 4, 232, BOX_H - 8);
    if (this.menu === 'fight') { this.drawFightMenu(ctx); return; }
    if (this.text) {
      let remaining = this.text.shown;
      this.text.lines.forEach((line, i) => {
        const vis = line.slice(0, Math.max(0, remaining)).filter((t) => t.ch).map((t) => t.ch).join('');
        remaining -= line.length;
        G.Font.draw(ctx, vis, 10, BOX_Y + 4 + i * 15, 'white');
      });
      if (this.text.arrow) G.UI.downArrow(ctx, 222, BOX_Y + 27);
    }
    if (this.menu === 'command' || this.menu === 'safari') {
      G.UI.frame(ctx, 120, BOX_Y, 120, BOX_H, 'menu');
      const s = G.Game.global.safari;
      const opts = this.menu === 'safari' ? [`BALL×${s ? s.balls : 0}`, 'BAIT', 'ROCK', 'RUN'] : ['FIGHT', 'BAG', 'POKéMON', 'RUN'];
      opts.forEach((o, i) => {
        const x = 136 + (i % 2) * 52, y = BOX_Y + 4 + Math.floor(i / 2) * 15;
        G.Font.draw(ctx, o, x, y, 'black');
        if (i === this.cursor) G.UI.cursor(ctx, x - 8, y + 2, '#303030');
      });
    }
  }
  drawFightMenu(ctx) {
    G.UI.frame(ctx, 0, BOX_Y, 162, BOX_H, 'menu');
    G.UI.frame(ctx, 160, BOX_Y, 80, BOX_H, 'menu');
    const b = this.core.player;
    b.moves.forEach((m, i) => {
      const x = 14 + (i % 2) * 74, y = BOX_Y + 4 + Math.floor(i / 2) * 15;
      const name = G.Data.moves[m.id].name.toUpperCase();
      G.Font.draw(ctx, name, x, y, 'black', { font: G.Font.width(name) > 64 ? 'narrow' : 'normal' });
      if (i === this.fightCursor) G.UI.cursor(ctx, x - 8, y + 2, '#303030');
    });
    for (let i = b.moves.length; i < 4; i++) G.Font.draw(ctx, '-', 14 + (i % 2) * 74, BOX_Y + 4 + Math.floor(i / 2) * 15, 'gray');
    const m = b.moves[this.fightCursor];
    if (m) {
      const mx = G.Pokemon.maxPP(m);
      const ppColor = m.pp === 0 ? 'red' : m.pp <= mx / 4 ? ['#e08020', '#f8d0a0'] : 'black';
      G.Font.draw(ctx, 'PP', 168, BOX_Y + 4, 'black');
      G.Font.draw(ctx, `${m.pp}/${mx}`, 232, BOX_Y + 4, ppColor, { align: 'right' });
      const type = G.Data.moves[m.id].type;
      G.Font.draw(ctx, 'TYPE/' + (G.Data.types[type] ? G.Data.types[type].name : type).toUpperCase(), 168, BOX_Y + 19, 'black', { font: 'narrow' });
    }
  }
  drawStatsPanel(ctx) {
    const { pk, old, phase } = this.statsPanel;
    G.UI.frame(ctx, 140, 8, 98, 102, 'menu');
    const labels = [['HP', 'HP'], ['ATTACK', 'ATTACK'], ['DEFENSE', 'DEFENSE'], ['SP. ATK', 'SPECIAL_ATTACK'], ['SP. DEF', 'SPECIAL_DEFENSE'], ['SPEED', 'SPEED']];
    labels.forEach(([l, k], i) => {
      const y = 13 + i * 15;
      G.Font.draw(ctx, l, 147, y, 'dark', { font: 'narrow' });
      const v = phase === 0 ? '+' + (pk.stats[k] - old[k]) : String(pk.stats[k]);
      G.Font.draw(ctx, v, 230, y, 'dark', { align: 'right' });
    });
  }
};

// ---------------------------------------------------------------------------
// Entry points from the overworld
// ---------------------------------------------------------------------------
G.Battle = {
  // FireRed: the screen flashes twice, then wild battles close in with
  // horizontal blinds sliding from alternate sides and trainer battles with
  // a Poké Ball-style spin wipe.
  *transition(trainerBattle) {
    G.Audio.sfx('encounter');
    for (let i = 0; i < 2; i++) {
      yield* G.Fade.to(0.75, 0.1, '#fff');
      yield* G.Fade.to(0, 0.1);
    }
    const W = G.Config.WIDTH, H = G.Config.HEIGHT;
    if (trainerBattle) {
      // two black wedges sweep round the centre like a spinning ball
      yield* G.Fade.wipe((ctx, t) => {
        const a = t * Math.PI, cx = W / 2, cy = H / 2, r = W;
        ctx.fillStyle = '#000';
        for (const off of [0, Math.PI]) {
          ctx.beginPath(); ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, r, -Math.PI / 2 + off, -Math.PI / 2 + off + a);
          ctx.closePath(); ctx.fill();
        }
      }, 0.6);
    } else {
      // 8px rows, even ones sliding in from the left and odd ones from the right
      yield* G.Fade.wipe((ctx, t) => {
        ctx.fillStyle = '#000';
        const e = t * t * (3 - 2 * t);
        for (let row = 0; row * 8 < H; row++) {
          const w = Math.ceil(e * W);
          ctx.fillRect(row % 2 ? W - w : 0, row * 8, w, 8);
        }
      }, 0.55);
    }
  },
  musicFor(trainer) {
    if (!trainer) return 'wildBattle';
    if (/^LEADER_/.test(trainer.type) || /^ELITEFOUR_/.test(trainer.type)) return 'gymBattle';
    if (/^RIVAL|^CHAMPION/.test(trainer.type)) return trainer.type === 'CHAMPION' ? 'championBattle' : 'rivalBattle';
    return 'trainerBattle';
  },
  victoryMusic(trainer) {
    if (!trainer) return 'wildVictory';
    if (/^LEADER_|^ELITEFOUR_|^CHAMPION/.test(trainer.type)) return 'gymVictory';
    return 'trainerVictory';
  },
  *startWild(pkmn, rules = {}) {
    if (G.Field.inSafariZone()) rules = { ...rules, safari: true };
    return yield* this.start({ wild: true, foeParty: [pkmn], rules });
  },
  *startTrainer(trainer, rules = {}) { return yield* this.start({ wild: false, foeParty: trainer.party, trainer, rules }); },
  *start(opts) {
    const g = G.Game;
    if (!g.firstAble() && !opts.rules.safari) return 'lose';
    const prevBGM = G.Audio.currentBGM();
    G.Game.stats.battles++;
    if (opts.trainer && /^LEADER_/.test(opts.trainer.type)) {
      const i = ['LEADER_Brock', 'LEADER_Misty', 'LEADER_Surge', 'LEADER_Erika', 'LEADER_Koga', 'LEADER_Sabrina', 'LEADER_Blaine', 'LEADER_Giovanni'].indexOf(opts.trainer.type);
      if (i >= 0) g.stats.gym_leader_attempts[i]++;
    }
    G.Audio.playMusicKey(this.musicFor(opts.trainer), true);
    yield* this.transition(!opts.wild);
    const scene = new G.BattleScene(opts);
    G.Fade.alpha = 0;
    const r = yield* G.Scenes.call(scene);
    const result = r ? r.result : 'lose';
    // Clean up battle-only state on the party
    for (const p of g.party) {
      p.moves = p.moves.map((m) => m);
      if (p.status === 'SLEEP' && p.statusCount <= 0) p.status = null;
    }
    if (result === 'win' || result === 'caught') {
      G.Audio.playMusicKey(this.victoryMusic(opts.trainer), true);
    }
    // Caught Pokémon: nickname + store
    if (r && r.caught) {
      const where = g.addPokemon(r.caught);
      if (where && where !== 'party') G.MapScene.queue(function* () { yield* G.MapScene.messageBox.show(`${r.caught.name} was transferred to ${where}.`); });
    }
    // Out of Safari Balls: back to the gate
    if (opts.rules.safari && g.global.safari && g.global.safari.decision) G.MapScene.queue(function* () { yield* G.Field.safariOver(null); });
    // Evolutions after battle
    if (r && r.levelled && result !== 'lose') {
      for (const i of r.levelled) {
        const p = g.party[i];
        if (!p || p.hp <= 0 && false) continue;
        const evo = p.checkEvolution('level');
        if (evo && !(p.item === 'EVERSTONE')) yield* G.Scenes.call(new G.EvolutionScene(p, evo));
      }
    }
    if (result === 'lose') {
      if (opts.rules.canlose) {
        g.healParty();
      } else {
        G.Audio.stopBGM();
        yield* G.Field.whiteOut();
        return result;
      }
    }
    // Back to the map
    if (prevBGM) G.Audio.playBGM(prevBGM, { force: true }); else G.MapScene.autoplayBGM();
    yield* G.Fade.in(0.2);
    // Auto-save after important battles
    if (opts.trainer && result === 'win' && /^(LEADER_|ELITEFOUR_|CHAMPION|RIVAL)/.test(opts.trainer.type)) G.Save.autosave('battle');
    G.Field.stepCount = 0;
    return result;
  },
  // Shared "X is trying to learn Y" flow. choose(text, {choices}) and msg(text)
  // are generator functions supplied by the caller (battle or overworld).
  *learnMoveFlow(pk, moveId, choose, msg) {
    const mname = G.Data.moves[moveId].name;
    if (pk.knowsMove(moveId)) return true;
    if (pk.learnMove(moveId)) {
      G.Audio.sfx('moveLearnt');
      yield* msg(`${pk.name} learned ${mname}!`);
      return true;
    }
    return yield* this.askForgetMove(pk, moveId, (t, o) => choose(t, o ? o : undefined), msg);
  },
  *askForgetMove(pk, moveId, ask, msg) {
    msg = msg || ((t) => ask(t));
    const mname = G.Data.moves[moveId].name;
    while (true) {
      yield* msg(`${pk.name} is trying to learn ${mname}.`);
      yield* msg(`But, ${pk.name} can't learn more than four moves.`);
      const r = yield* ask(`Delete a move to make room for ${mname}?`, { choices: ['YES', 'NO'], cancelIndex: 1 });
      if (r === 0) {
        const idx = yield* G.Scenes.call(new G.SummaryScene([pk], 0, { chooseMove: true, newMove: moveId }));
        if (idx !== null && idx !== undefined && idx >= 0 && idx < 4) {
          const old = G.Data.moves[pk.moves[idx].id].name;
          yield* msg(`1, 2, and... ... ... Poof!`);
          yield* msg(`${pk.name} forgot ${old}.`);
          pk.moves[idx] = G.Pokemon.newMove(moveId);
          G.Audio.sfx('moveLearnt');
          yield* msg(`And... ${pk.name} learned ${mname}!`);
          return true;
        }
      }
      const s = yield* ask(`Stop learning ${mname}?`, { choices: ['YES', 'NO'], cancelIndex: 1 });
      if (s === 0) { yield* msg(`${pk.name} did not learn ${mname}.`); return false; }
    }
  },
};
