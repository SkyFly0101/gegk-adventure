// Battle presentation (FRLG layout at 240x160) and the entry points the
// overworld uses: G.Battle.startWild / startTrainer.
'use strict';

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
    this.boxes = { 0: { visible: false, hp: 0, exp: 0 }, 1: { visible: false, hp: 0 } };
    this.playerTrainer = { visible: true, x: 40, frame: 0 };
    this.foeTrainer = { visible: !!trainer, x: 184 };
    this.slideIn = 0;
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
    cw.x = G.Config.WIDTH - cw.w - 2; cw.y = 110 - cw.h;
    this.choiceWin = cw;
    const r = yield* cw.run();
    this.choiceWin = null;
    return r;
  }
  *showFoe(b, fromBall) {
    const s = this.sprites[1];
    if (fromBall) {
      if (this.foeTrainer.visible) yield* this.trainerSlideOut();
      G.Audio.sfx('sendOut');
      s.visible = true; s.scale = 0;
      const t1 = G.time;
      while (G.time - t1 < 0.3) { s.scale = (G.time - t1) / 0.3; yield; }
      s.scale = 1;
      G.Audio.cry(b.p.species);
    } else { s.visible = true; s.scale = 1; }
    s.alpha = 1; s.yOff = 0;
    this.boxes[1].visible = true;
    this.boxes[1].hp = b.hp;
    yield* G.U.wait(0.2);
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
    G.Audio.sfx('sendOut');
    s.visible = true; s.scale = 0; s.alpha = 1; s.yOff = 0;
    const t1 = G.time;
    while (G.time - t1 < 0.3) { s.scale = (G.time - t1) / 0.3; yield; }
    s.scale = 1;
    G.Audio.cry(b.p.species);
    this.boxes[0].visible = true;
    this.boxes[0].hp = b.hp;
    this.boxes[0].exp = b.p.expFraction();
    yield* G.U.wait(0.25);
  }
  *recall(b) {
    G.Audio.sfx('recall');
    const s = this.sprites[b.side];
    const t0 = G.time;
    while (G.time - t0 < 0.3) { s.scale = 1 - (G.time - t0) / 0.3; yield; }
    s.visible = false; s.scale = 1;
    this.boxes[b.side].visible = false;
  }
  *faint(b) {
    G.Audio.sfx('faint');
    const s = this.sprites[b.side];
    const t0 = G.time;
    while (G.time - t0 < 0.4) { s.yOff = (G.time - t0) / 0.4 * 60; s.alpha = 1 - (G.time - t0) / 0.4; yield; }
    s.visible = false; s.yOff = 0; s.alpha = 1;
    this.boxes[b.side].visible = false;
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
    if (b.side === 0 && to > 0 && to <= b.totalHP / 4) G.Audio.sfx('lowHp');
  }
  *expAnim(b, from, to) {
    const box = this.boxes[0];
    G.Audio.sfx('expGain');
    const t0 = G.time;
    const len = Math.max(0.2, (to - from) * 1.2);
    while (G.time - t0 < len) { box.exp = G.U.lerp(from, to, (G.time - t0) / len); yield; }
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
  *throwBall(shakes, caught, blocked) {
    G.Audio.sfx('ballThrow');
    const fp = this.spritePos(1);
    const t0 = G.time;
    this.ball = { x: 40, y: 100 };
    while (G.time - t0 < 0.5) {
      const t = (G.time - t0) / 0.5;
      this.ball.x = G.U.lerp(40, fp.x, t);
      this.ball.y = G.U.lerp(100, fp.y - 40, t) - Math.sin(t * Math.PI) * 40;
      yield;
    }
    if (blocked) { this.ball = null; return; }
    G.Audio.sfx('ballHit');
    const s = this.sprites[1];
    s.scale = 1;
    const t1 = G.time;
    while (G.time - t1 < 0.25) { s.scale = 1 - (G.time - t1) / 0.25; yield; }
    s.visible = false;
    // drop
    const t2 = G.time;
    while (G.time - t2 < 0.3) { this.ball.y = G.U.lerp(fp.y - 40, fp.y - 12, (G.time - t2) / 0.3); yield; }
    G.Audio.sfx('ballDrop');
    for (let i = 0; i < shakes; i++) {
      yield* G.U.wait(0.35);
      G.Audio.sfx('ballShake');
      const t3 = G.time;
      while (G.time - t3 < 0.3) { this.ball.rot = Math.sin((G.time - t3) / 0.3 * Math.PI * 2) * 0.5; yield; }
      this.ball.rot = 0;
    }
    yield* G.U.wait(0.4);
    if (caught) { G.Audio.sfx('ballClick'); this.ball.caught = true; yield* G.U.wait(0.4); return; }
    this.ball = null;
    s.visible = true;
    const t4 = G.time;
    while (G.time - t4 < 0.25) { s.scale = (G.time - t4) / 0.25; yield; }
    s.scale = 1;
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
    if (base0) ctx.drawImage(base0, 56 - base0.width / 2 + slide, 136 - base0.height / 2);
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
        ctx.drawImage(img, this.playerTrainer.frame * fw, 0, fw, fw, Math.round(this.playerTrainer.x - fw / 2 + 16 + slide), 112 - fw, fw, fw);
      }
    }
    this.drawBattler(ctx, 0, slide);
    G.BattleAnim.drawCels(ctx, this.anim, true);
    if (this.flash && this.flash.side < 0 && G.time < this.flash.until) {
      const [r, g, b, a] = this.flash.color;
      ctx.fillStyle = `rgba(${r},${g},${b},${(a || 255) / 255})`;
      ctx.fillRect(0, 0, 240, 112);
    }
    if (this.ball) this.drawBall(ctx);
    this.drawBox(ctx, 1);
    this.drawBox(ctx, 0);
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
      cx.globalAlpha = 0.6;
      cx.fillStyle = o.color;
      cx.fillRect(0, 0, img.width, img.height);
      cx.globalCompositeOperation = 'source-over';
      cx.globalAlpha = 1;
      ctx.drawImage(c, 0, 0, img.width, img.height, x, y, w, h);
    }
  }
  drawBall(ctx) {
    const b = this.ball;
    ctx.save();
    ctx.translate(Math.round(b.x), Math.round(b.y));
    if (b.rot) ctx.rotate(b.rot);
    ctx.fillStyle = '#202020'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = b.caught ? '#a0a0a0' : '#e83018'; ctx.beginPath(); ctx.arc(0, 0, 5, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#f8f8f8'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#202020'; ctx.fillRect(-5, -1, 10, 2);
    ctx.fillStyle = '#f8f8f8'; ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  // FRLG-style data boxes (foe: top-left, player: right above the text box)
  drawBox(ctx, side) {
    const box = this.boxes[side];
    const b = this.core.battlers[side];
    if (!box.visible || !b.p) return;
    const p = b.p;
    const slide = Math.round(this.slideIn * 240);
    const bx = side === 0 ? 126 + slide : 12 - slide, by = side === 0 ? 72 : 14;
    const w = side === 0 ? 108 : 102, h = side === 0 ? 38 : 28;
    // panel: dark 2px border around a cream fill with a shaded bottom strip
    ctx.fillStyle = '#404850';
    ctx.fillRect(bx, by, w, h);
    ctx.fillStyle = '#f8f8e8';
    ctx.fillRect(bx + 2, by + 2, w - 4, h - 4);
    ctx.fillStyle = '#e0e0c8';
    ctx.fillRect(bx + 2, by + h - 6, w - 4, 4);
    G.Font.draw(ctx, p.name, bx + 6, by + 1, 'black');
    if (p.gender) G.Font.draw(ctx, p.gender === 'M' ? '♂' : '♀', bx + 8 + G.Font.width(p.name), by + 1, p.gender === 'M' ? 'blue' : 'red');
    G.Font.draw(ctx, 'Lv' + p.level, bx + w - 6, by + 1, 'black', { align: 'right' });
    const frac = G.U.clamp(box.hp / p.totalHP, 0, 1);
    G.UI.hpBar(ctx, bx + w - 70, by + 16, 48, frac);
    if (p.status) {
      const st = G.Assets.get('sprites/ui/battle/icon_statuses.png');
      const idx = { SLEEP: 0, POISON: 1, BURN: 2, PARALYSIS: 3, FROZEN: 4 }[p.status];
      if (st) ctx.drawImage(st, 0, idx * 8, 22, 8, bx + 6, by + 15, 22, 8);
    } else if (side === 1 && this.wild && G.Game.player.owned[p.species]) {
      ctx.fillStyle = '#e04030'; ctx.beginPath(); ctx.arc(bx + 10, by + 19, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f8f8f8'; ctx.fillRect(bx + 7, by + 19, 7, 3);
    }
    if (side === 0) {
      G.Font.draw(ctx, `${Math.ceil(box.hp)}/${p.totalHP}`, bx + w - 6, by + 20, 'black', { align: 'right' });
      G.UI.expBar(ctx, bx + 24, by + 32, 78, box.exp, { label: true });
    }
  }
  drawMessageArea(ctx) {
    // FireRed's dark text box with a gold-trimmed frame
    ctx.fillStyle = '#c89838'; ctx.fillRect(0, 112, 240, 48);
    ctx.fillStyle = '#304860'; ctx.fillRect(2, 114, 236, 44);
    ctx.fillStyle = '#285078'; ctx.fillRect(4, 116, 232, 40);
    if (this.menu === 'fight') { this.drawFightMenu(ctx); return; }
    if (this.text) {
      let remaining = this.text.shown;
      this.text.lines.forEach((line, i) => {
        const vis = line.slice(0, Math.max(0, remaining)).filter((t) => t.ch).map((t) => t.ch).join('');
        remaining -= line.length;
        G.Font.draw(ctx, vis, 10, 119 + i * 16, 'white');
      });
      if (this.text.arrow) G.UI.downArrow(ctx, 222, 146);
    }
    if (this.menu === 'command' || this.menu === 'safari') {
      G.UI.frame(ctx, 120, 112, 120, 48, 'menu');
      const s = G.Game.global.safari;
      const opts = this.menu === 'safari' ? [`BALL×${s ? s.balls : 0}`, 'BAIT', 'ROCK', 'RUN'] : ['FIGHT', 'BAG', 'POKéMON', 'RUN'];
      opts.forEach((o, i) => {
        const x = 136 + (i % 2) * 52, y = 119 + Math.floor(i / 2) * 18;
        G.Font.draw(ctx, o, x, y, 'black');
        if (i === this.cursor) G.UI.cursor(ctx, x - 8, y + 2, '#303030');
      });
    }
  }
  drawFightMenu(ctx) {
    G.UI.frame(ctx, 0, 112, 162, 48, 'menu');
    G.UI.frame(ctx, 160, 112, 80, 48, 'menu');
    const b = this.core.player;
    b.moves.forEach((m, i) => {
      const x = 14 + (i % 2) * 74, y = 119 + Math.floor(i / 2) * 18;
      const name = G.Data.moves[m.id].name.toUpperCase();
      G.Font.draw(ctx, name, x, y, 'black', { font: G.Font.width(name) > 64 ? 'narrow' : 'normal' });
      if (i === this.fightCursor) G.UI.cursor(ctx, x - 8, y + 2, '#303030');
    });
    for (let i = b.moves.length; i < 4; i++) G.Font.draw(ctx, '-', 14 + (i % 2) * 74, 119 + Math.floor(i / 2) * 18, 'gray');
    const m = b.moves[this.fightCursor];
    if (m) {
      const mx = G.Pokemon.maxPP(m);
      const ppColor = m.pp === 0 ? 'red' : m.pp <= mx / 4 ? ['#e08020', '#f8d0a0'] : 'black';
      G.Font.draw(ctx, 'PP', 168, 119, 'black');
      G.Font.draw(ctx, `${m.pp}/${mx}`, 232, 119, ppColor, { align: 'right' });
      const type = G.Data.moves[m.id].type;
      G.Font.draw(ctx, 'TYPE/' + (G.Data.types[type] ? G.Data.types[type].name : type).toUpperCase(), 168, 137, 'black', { font: 'narrow' });
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
  *transition(trainerBattle) {
    G.Audio.sfx('encounter');
    for (let i = 0; i < 3; i++) {
      yield* G.Fade.to(0.8, 0.08, '#fff');
      yield* G.Fade.to(0, 0.08);
    }
    yield* G.Fade.out(0.3, '#000');
    void trainerBattle;
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
