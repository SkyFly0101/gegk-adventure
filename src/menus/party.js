// The POKéMON (party) screen in FRLG layout. Modes:
//   menu   - from the Start menu (summary, switch, items, field moves)
//   battle - choose a Pokémon to send out (returns index)
//   choose - pick a Pokémon for a script (returns index or -1)
//   item   - use/give an item (returns index or -1)
//   tutor  - shows ABLE / NOT ABLE for a move (returns index or -1)
'use strict';

G.PartyScene = class PartyScene extends G.Scene {
  constructor(opts = {}) {
    super();
    this.mode = opts.mode || 'menu';
    this.opts = opts;
    this.index = 0;
    this.switching = -1;
    this.help = opts.help || (this.mode === 'battle' ? 'Choose a POKéMON.' : this.mode === 'item' ? 'Use on which POKéMON?' : 'Choose a POKéMON.');
    this.msg = new G.MessageBox();
  }
  get party() { return G.Game.party; }
  *main() {
    for (const p of this.party) G.Assets.load(G.Assets.icon(p.species));
    const n = () => this.party.length;
    G.Input.clear();
    while (true) {
      yield;
      if (this.msg.active) continue;
      const count = n() + 1; // + CANCEL
      if (G.Input.repeat('DOWN')) { this.index = (this.index + 1) % count; G.Audio.sfx('cursor'); }
      if (G.Input.repeat('UP')) { this.index = (this.index + count - 1) % count; G.Audio.sfx('cursor'); }
      if (G.Input.repeat('RIGHT') && this.index === 0 && n() > 1) { this.index = 1; G.Audio.sfx('cursor'); }
      if (G.Input.repeat('LEFT') && this.index > 0 && this.index < n()) { this.index = 0; G.Audio.sfx('cursor'); }
      if (G.Input.trigger('B')) {
        if (this.switching >= 0) { this.switching = -1; G.Audio.sfx('cancel'); continue; }
        if (this.opts.canCancel === false) { G.Audio.sfx('buzzer'); continue; }
        G.Audio.sfx('cancel'); return this.mode === 'menu' ? null : -1;
      }
      if (!G.Input.trigger('A')) continue;
      if (this.index === n()) {
        if (this.opts.canCancel === false) { G.Audio.sfx('buzzer'); continue; }
        G.Audio.sfx('cancel'); return this.mode === 'menu' ? null : -1;
      }
      G.Audio.sfx('select');
      if (this.switching >= 0) {
        const a = this.switching, b = this.index;
        [this.party[a], this.party[b]] = [this.party[b], this.party[a]];
        this.switching = -1;
        G.Audio.sfx('partySwitch');
        continue;
      }
      const r = yield* this.selectPokemon(this.index);
      if (r !== undefined) return r;
    }
  }
  // Returns a value to close the screen, or undefined to stay.
  *selectPokemon(i) {
    const p = this.party[i];
    if (this.mode === 'choose' || this.mode === 'item' || this.mode === 'tutor') {
      if (this.opts.filter && !this.opts.filter(p)) { G.Audio.sfx('buzzer'); return undefined; }
      return i;
    }
    if (this.mode === 'battle') {
      const r = yield* this.popup(['SHIFT', 'SUMMARY', 'CANCEL']);
      if (r === 0) return i;
      if (r === 1) yield* G.Scenes.call(new G.SummaryScene(this.party, i));
      return undefined;
    }
    // Field menu: SUMMARY, field moves, SWITCH, ITEM, CANCEL
    const opts = [{ label: 'SUMMARY', id: 'summary' }];
    for (const m of p.moves) {
      const fm = G.PartyScene.FIELD_MOVES[m.id];
      if (fm) opts.push({ label: G.Data.moves[m.id].name.toUpperCase(), id: 'move', move: m.id, color: 'blue' });
    }
    if (this.party.length > 1) opts.push({ label: 'SWITCH', id: 'switch' });
    opts.push({ label: 'ITEM', id: 'item' }, { label: 'CANCEL', id: 'cancel' });
    const r = yield* this.popup(opts);
    const o = opts[r];
    if (!o || o.id === 'cancel') return undefined;
    if (o.id === 'summary') { this.index = yield* G.Scenes.call(new G.SummaryScene(this.party, i)) ?? i; return undefined; }
    if (o.id === 'switch') { this.switching = i; return undefined; }
    if (o.id === 'item') {
      const k = yield* this.popup(['GIVE', 'TAKE', 'CANCEL']);
      if (k === 0) {
        const pick = yield* G.Scenes.call(new G.BagScene({ mode: 'choose', help: `Give to ${p.name}?` }));
        if (pick) {
          if (G.Bag.pocketOf(pick.item) === 'key') { yield* this.say("This can't be held."); return undefined; }
          if (p.item) { G.Game.bag.add(p.item); }
          G.Game.bag.remove(pick.item);
          p.item = pick.item;
          yield* this.say(`${p.name} was given the ${G.Data.items[pick.item].name} to hold.`);
        }
      } else if (k === 1) {
        if (!p.item) yield* this.say(`${p.name} isn't holding anything.`);
        else { G.Game.bag.add(p.item); yield* this.say(`Received the ${G.Data.items[p.item].name} from ${p.name}.`); p.item = null; }
      }
      return undefined;
    }
    if (o.id === 'move') {
      const res = yield* G.PartyScene.FIELD_MOVES[o.move](p, this);
      if (res === 'close') return { close: true };
    }
    return undefined;
  }
  *popup(items) {
    const cw = new G.UI.CommandWindow(items, { cancelIndex: items.length - 1 });
    cw.x = G.Config.WIDTH - cw.w - 2; cw.y = G.Config.HEIGHT - cw.h - 2;
    this.popupWin = cw;
    const r = yield* cw.run();
    this.popupWin = null;
    return r;
  }
  *say(text) { yield* this.msg.show(text); }

  draw(ctx) {
    ctx.fillStyle = '#386848'; ctx.fillRect(0, 0, 240, 160);
    for (let y = 0; y < 160; y += 8) for (let x = (y / 8) % 2 * 8; x < 240; x += 16) { ctx.fillStyle = '#3e7050'; ctx.fillRect(x, y, 8, 8); }
    const party = this.party;
    const frame = Math.floor(G.time * 4) % 2;
    party.forEach((p, i) => {
      const sel = i === this.index, sw = i === this.switching;
      let x, y, w, h;
      if (i === 0) { x = 2; y = 18; w = 84; h = 56; } else { x = 90; y = 2 + (i - 1) * 24; w = 148; h = 22; }
      const fainted = p.hp <= 0;
      ctx.fillStyle = sw ? '#f8a050' : sel ? (fainted ? '#f8a0a0' : '#88d8f8') : (fainted ? '#c88080' : '#58a0d0');
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = sel ? '#f8f8f8' : '#284878';
      ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
      const ic = G.Assets.get(G.Assets.icon(p.species));
      const bob = sel && !fainted ? frame : 0;
      const big = i === 0;
      if (ic) ctx.drawImage(ic, (sel ? frame : 0) * ic.height, 0, ic.height, ic.height, x - 2, big ? y - 2 - bob : y - 9 - bob, ic.height, ic.height);
      const tx = x + (big ? 32 : 28), ty = y + (big ? 4 : -1);
      G.Font.draw(ctx, p.name, tx, ty, 'white', { font: G.Font.width(p.name) > 50 ? 'narrow' : 'normal' });
      const lvY = big ? ty + 13 : ty + 10;
      if (p.status) G.Font.draw(ctx, G.STATUS_NAMES[p.status], tx, lvY, ['#f8f8f8', '#a03030'], { font: 'small' });
      else G.Font.draw(ctx, 'Lv' + p.level, tx, lvY, 'white', { font: 'small' });
      if (p.gender) G.Font.draw(ctx, p.gender === 'M' ? '♂' : '♀', tx + 30, lvY, p.gender === 'M' ? 'blue' : 'red', { font: 'small' });
      if (p.item) { ctx.fillStyle = '#f8f8f8'; ctx.fillRect(x + 18, y + (big ? 22 : 8), 5, 5); ctx.fillStyle = '#e04030'; ctx.fillRect(x + 19, y + (big ? 23 : 9), 3, 3); }
      const bx = big ? x + 18 : x + 82, by = big ? y + 36 : y + 4;
      if (this.mode === 'tutor') {
        const able = this.opts.move && p.canLearn(this.opts.move) && !p.knowsMove(this.opts.move);
        G.Font.draw(ctx, able ? 'ABLE' : 'NOT ABLE', bx + 8, by - 3, able ? 'white' : 'gray');
      } else {
        G.UI.hpBar(ctx, bx, by, 48, p.hp / p.totalHP);
        G.Font.draw(ctx, `${p.hp}/${p.totalHP}`, bx + 63, by + 5, 'white', { align: 'right', font: 'small' });
      }
    });
    // empty slots
    for (let i = Math.max(1, party.length); i < 6; i++) { ctx.fillStyle = '#2c5878'; ctx.fillRect(90, 2 + (i - 1) * 24, 148, 22); }
    // Cancel button
    const csel = this.index === party.length;
    ctx.fillStyle = csel ? '#f8a050' : '#58a0d0';
    ctx.fillRect(182, 126, 56, 16);
    G.Font.draw(ctx, 'CANCEL', 210, 127, 'white', { align: 'center' });
    // Help text
    G.UI.frame(ctx, 2, 128, 176, 30, 'msg');
    G.Font.draw(ctx, this.switching >= 0 ? 'Move to where?' : this.help, 8, 135);
    if (this.popupWin) this.popupWin.draw(ctx);
    this.msg.draw(ctx);
  }
};

// Field moves usable from the party menu.
G.PartyScene.FIELD_MOVES = {
  *CUT(p, scene) { yield* scene.say('Use CUT by talking to a small tree.'); },
  *ROCKSMASH(p, scene) { yield* scene.say('Use ROCK SMASH by talking to a cracked rock.'); },
  *STRENGTH(p, scene) { yield* scene.say('Use STRENGTH by talking to a big boulder.'); },
  *SURF(p, scene) {
    if (!G.Field.canUseFieldMove('SURF')) return yield* scene.say('A new BADGE is required to use this move outside of battle.');
    if (!G.Terrain.canSurfFreely(G.Game.playerChar.facingTerrainTag()) || G.Game.global.surfing) return yield* scene.say("Can't use that here.");
    G.MapScene.queue(function* () { yield* G.MapScene.messageBox.show(`${p.name} used SURF!`); yield* G.Field.startSurf(); });
    return 'close';
  },
  *FLASH(p, scene) {
    if (!G.Field.canUseFieldMove('FLASH')) return yield* scene.say('A new BADGE is required to use this move outside of battle.');
    if (!G.World.map.meta.DarkMap || G.Game.global.flash) return yield* scene.say("Can't use that here.");
    G.Game.global.flash = G.World.map.id;
    G.MapScene.queue(function* () { yield* G.MapScene.messageBox.show(`${p.name} used FLASH!\\nThe area was lit up!`); });
    return 'close';
  },
  *FLY(p, scene) {
    if (!G.Field.canUseFieldMove('FLY')) return yield* scene.say('A new BADGE is required to use this move outside of battle.');
    if (!G.World.map.meta.Outdoor) return yield* scene.say("Can't use that here.");
    const dest = yield* G.Scenes.call(new G.TownMapScene({ mode: 'fly' }));
    if (!dest) return undefined;
    G.MapScene.queue(function* () {
      G.Audio.sfx('fly');
      G.Game.global.surfing = false; G.Game.global.bicycle = false;
      yield* G.MapScene.transferPlayer(dest[0], dest[1], dest[2], 2, true);
    });
    return 'close';
  },
  // Dig: like an Escape Rope, back to the cave entrance.
  *DIG(p, scene) {
    const e = G.Game.global.escapePoint;
    if (!e || G.World.map.meta.Outdoor) return yield* scene.say("Can't use that here.");
    G.Game.global.escapePoint = null;
    G.MapScene.queue(function* () { yield* G.MapScene.transferPlayer(e.map, e.x, e.y, e.dir, true); });
    return 'close';
  },
  // Teleport: outdoors, back to the last Pokémon Center used.
  *TELEPORT(p, scene) {
    const pc = G.Game.global.pokecenter;
    if (!pc || !G.World.map.meta.Outdoor) return yield* scene.say("Can't use that here.");
    G.MapScene.queue(function* () { yield* G.MapScene.transferPlayer(pc.map, pc.x, pc.y, 2, true); });
    return 'close';
  },
  *SOFTBOILED(p, scene) {
    if (p.hp <= Math.floor(p.totalHP / 5)) return yield* scene.say('Not enough HP...');
    const i = yield* G.Scenes.call(new G.PartyScene({ mode: 'choose', help: 'Use on which POKéMON?' }));
    if (i < 0) return undefined;
    const t = G.Game.party[i];
    if (t === p || t.hp <= 0 || t.hp >= t.totalHP) return yield* scene.say("It won't have any effect.");
    const amt = Math.min(Math.floor(p.totalHP / 5), t.totalHP - t.hp);
    p.hp -= amt; t.hp += amt;
    yield* scene.say(`${t.name}'s HP was restored by ${amt} point(s).`);
  },
  *SWEETSCENT(p, scene) { yield* scene.say("Can't use that here."); },
};
G.PartyScene.FIELD_MOVES.MILKDRINK = G.PartyScene.FIELD_MOVES.SOFTBOILED;
