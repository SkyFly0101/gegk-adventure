// The BAG: pockets, item use in the field and in battle, give/toss/register.
//   field  - from the Start menu
//   battle - returns { item, target } for the battle to use
//   choose - returns { item } (giving items, PC deposits)
'use strict';

G.BagScene = class BagScene extends G.Scene {
  constructor(opts = {}) {
    super();
    this.mode = opts.mode || 'field';
    this.opts = opts;
    this.pockets = [
      { id: 'items', name: 'ITEMS' }, { id: 'key', name: 'KEY ITEMS' }, { id: 'balls', name: 'POKé BALLS' },
      { id: 'tms', name: 'TM CASE' }, { id: 'berries', name: 'BERRY POUCH' },
    ];
    this.p = G.BagScene.lastPocket || 0;
    this.cursor = {};
    this.msg = new G.MessageBox();
  }
  list() { return G.Game.bag.pocket(this.pockets[this.p].id); }
  *main() {
    G.Input.clear();
    while (true) {
      yield;
      const ids = this.list();
      const n = ids.length + 1;
      let c = this.cursor[this.p] || 0;
      if (c >= n) c = n - 1;
      if (G.Input.repeat('DOWN')) { c = (c + 1) % n; G.Audio.sfx('cursor'); }
      if (G.Input.repeat('UP')) { c = (c + n - 1) % n; G.Audio.sfx('cursor'); }
      if (G.Input.repeat('RIGHT')) { this.p = (this.p + 1) % this.pockets.length; G.Audio.sfx('cursor'); this.cursor[this.p] = this.cursor[this.p] || 0; continue; }
      if (G.Input.repeat('LEFT')) { this.p = (this.p + this.pockets.length - 1) % this.pockets.length; G.Audio.sfx('cursor'); this.cursor[this.p] = this.cursor[this.p] || 0; continue; }
      this.cursor[this.p] = c;
      G.BagScene.lastPocket = this.p;
      if (G.Input.trigger('B') || (G.Input.trigger('A') && c === ids.length)) { G.Audio.sfx('cancel'); return null; }
      if (G.Input.trigger('SELECT') && this.mode === 'field' && ids[c]) {
        const it = G.Data.items[ids[c]];
        if (it.pocket === 8 && it.fieldUse) { G.Game.bag.registered = G.Game.bag.registered === ids[c] ? null : ids[c]; G.Audio.sfx('select'); }
        continue;
      }
      if (!G.Input.trigger('A')) continue;
      G.Audio.sfx('select');
      const id = ids[c];
      const r = yield* this.selectItem(id);
      if (r !== undefined) return r;
    }
  }
  *selectItem(id) {
    const it = G.Data.items[id];
    if (this.mode === 'choose') return { item: id };
    if (this.mode === 'battle') {
      if (!it.battleUse) { yield* this.say(`${G.Config.PLAYER_NAME}'s mom's words echoed: "There's a time and place for everything..."`); return undefined; }
      if (it.battleUse === 'OnFoe') {
        if (it.flags.includes('PokeBall') && !this.opts.battle.wild) { yield* this.say("You can't throw a BALL at a trainer's POKéMON!"); return undefined; }
        return { item: id };
      }
      if (it.battleUse === 'OnPokemon' || it.battleUse === 'OnMove') {
        const i = yield* G.Scenes.call(new G.PartyScene({ mode: 'item', help: `Use on which POKéMON?` }));
        if (i < 0) return undefined;
        const p = G.Game.party[i];
        if (!G.Items.canUse(id, p)) { yield* this.say("It won't have any effect."); return undefined; }
        return { item: id, target: i };
      }
      if (it.battleUse === 'OnBattler' || it.battleUse === 'Direct' || it.battleUse === 'DirectWithTarget') return { item: id };
      return { item: id };
    }
    // Field
    const opts = [];
    if (it.fieldUse) opts.push('USE');
    if (it.pocket !== 8) opts.push('GIVE', 'TOSS');
    if (it.pocket === 8 && it.fieldUse) opts.push(G.Game.bag.registered === id ? 'DESELECT' : 'REGISTER');
    opts.push('CANCEL');
    const cw = new G.UI.CommandWindow(opts, { cancelIndex: opts.length - 1 });
    cw.x = G.Config.WIDTH - cw.w - 2; cw.y = 110 - cw.h;
    this.popup = cw;
    const r = yield* cw.run();
    this.popup = null;
    const o = opts[r];
    if (o === 'USE') {
      const res = yield* G.BagScene.useItem(id, this);
      if (res === 'close') return { close: true };
    } else if (o === 'GIVE') {
      const i = yield* G.Scenes.call(new G.PartyScene({ mode: 'choose', help: 'Give to which POKéMON?' }));
      if (i >= 0) {
        const p = G.Game.party[i];
        if (p.item) G.Game.bag.add(p.item);
        G.Game.bag.remove(id);
        p.item = id;
        yield* this.say(`${p.name} was given the ${it.name} to hold.`);
      }
    } else if (o === 'TOSS') {
      const qty = G.Game.bag.qty(id);
      const nw = new G.UI.NumberWindow({ min: 1, max: qty, value: 1, x: 180, y: 84 });
      this.popup = nw;
      G.Input.clear();
      while (nw.result === undefined) { yield; nw.update(); }
      this.popup = null;
      if (nw.result > 0) {
        const ok = yield* this.msg.show(`Throw away ${nw.result} ${it.name}?`, { choices: ['YES', 'NO'], cancelIndex: 1 });
        if (ok === 0) { G.Game.bag.remove(id, nw.result); yield* this.say(`Threw away ${nw.result} ${it.name}.`); }
      }
    } else if (o === 'REGISTER' || o === 'DESELECT') {
      G.Game.bag.registered = o === 'REGISTER' ? id : null;
    }
    return undefined;
  }
  *say(t) { yield* this.msg.show(t); }

  draw(ctx) {
    ctx.fillStyle = '#e8c870'; ctx.fillRect(0, 0, 240, 160);
    for (let y = 0; y < 160; y += 6) { ctx.fillStyle = '#e0c068'; ctx.fillRect(0, y, 240, 3); }
    // Bag picture for the current pocket (kit art; boy and girl versions)
    const kitPocket = { items: 1, key: 8, balls: 3, tms: 4, berries: 5 }[this.pockets[this.p].id];
    const bagPath = `sprites/ui/bag/bag_${kitPocket}${G.Game.player.gender === 'female' ? '_f' : ''}.png`;
    const bagImg = G.Assets.get(bagPath);
    if (bagImg) ctx.drawImage(bagImg, 44 - bagImg.width / 2, 58 - bagImg.height / 2);
    G.UI.frame(ctx, 2, 2, 84, 22, 'menu');
    G.Font.draw(ctx, this.pockets[this.p].name, 44, 6, 'dark', { align: 'center', font: 'narrow' });
    for (let i = 0; i < this.pockets.length; i++) { ctx.fillStyle = i === this.p ? '#e04030' : '#a08040'; ctx.fillRect(22 + i * 10, 92, 6, 6); }
    // Item list
    const ids = this.list();
    const c = this.cursor[this.p] || 0;
    G.UI.frame(ctx, 88, 2, 150, 104, 'menu');
    const rows = 6;
    const top = Math.max(0, Math.min(c - 2, ids.length + 1 - rows));
    for (let r = 0; r < rows; r++) {
      const i = top + r;
      const y = 8 + r * 16;
      if (i > ids.length) break;
      if (i === ids.length) G.Font.draw(ctx, 'CLOSE BAG', 102, y, 'dark');
      else {
        const it = G.Data.items[ids[i]];
        let label = it.name;
        if (this.pockets[this.p].id === 'tms' && it.move) label = `${it.name.replace(/^TM/, 'No').replace(/^HM/, 'HM')} ${G.Data.moves[it.move].name}`;
        G.Font.draw(ctx, label, 102, y, G.Game.bag.registered === ids[i] ? 'blue' : 'dark', { font: label.length > 14 ? 'narrow' : 'normal' });
        if (it.pocket !== 8 && it.pocket !== 4) G.Font.draw(ctx, '×' + G.Game.bag.qty(ids[i]), 232, y, 'dark', { align: 'right' });
      }
      if (i === c) G.UI.cursor(ctx, 94, y + 2);
    }
    // Description
    ctx.fillStyle = '#304860'; ctx.fillRect(0, 110, 240, 50);
    const id = ids[c];
    if (id) {
      const ic = G.Assets.get(G.Assets.item(id));
      if (ic) ctx.drawImage(ic, 6, 120); else G.Assets.load(G.Assets.item(id));
      const lines = G.MessageBox.layout(G.MessageBox.parse(G.Data.items[id].description || '').tokens, 196);
      lines.slice(0, 3).forEach((l, i) => G.Font.draw(ctx, l.map((t) => t.ch || '').join(''), 38, 112 + i * 14, 'white', { font: 'narrow' }));
    } else G.Font.draw(ctx, 'CLOSE BAG', 38, 118, 'white');
    if (this.popup) this.popup.draw(ctx);
    this.msg.draw(ctx);
  }

  // Using an item from the Bag (or the registered item via SELECT).
  // `scene` is the BagScene (for messages) or null when used from the map.
  static *useItem(id, scene) {
    const it = G.Data.items[id];
    const say = scene ? (t, o) => scene.msg.show(t, o) : (t, o) => G.MapScene.messageBox.show(t, o);
    const g = G.Game;
    // Medicine & things used on a Pokémon
    if (it.fieldUse === 'OnPokemon' || G.Items.isMedicine(id) || G.Items.STONES.includes(id)) {
      const i = yield* G.Scenes.call(new G.PartyScene({ mode: 'item', help: 'Use on which POKéMON?' }));
      if (i < 0) return;
      const p = g.party[i];
      if (G.Items.STONES.includes(id)) {
        const evo = p.checkEvolution('item', id);
        if (!evo) { yield* say("It won't have any effect."); return; }
        g.bag.remove(id);
        yield* G.Fade.out(0.3);
        yield* G.Scenes.call(new G.EvolutionScene(p, evo, { canCancel: false }));
        yield* G.Fade.in(0.3);
        return;
      }
      if (id === 'RARECANDY') {
        if (!G.Items.canUse(id, p)) { yield* say("It won't have any effect."); return; }
        g.bag.remove(id);
        const old = { ...p.stats };
        p.exp = p.expFor(p.level + 1);
        p.level++;
        p.calcStats();
        p.hp = Math.min(p.totalHP, p.hp + (p.stats.HP - old.HP));
        G.Audio.sfx('levelUp');
        yield* say(`${p.name} grew to LV. ${p.level}!`);
        for (const m of p.movesLearnedAt(p.level)) yield* G.Battle.learnMoveFlow(p, m, say, say);
        const evo = p.checkEvolution('level');
        if (evo) { yield* G.Fade.out(0.3); yield* G.Scenes.call(new G.EvolutionScene(p, evo)); yield* G.Fade.in(0.3); }
        return;
      }
      let moveIndex = -1;
      if (G.Items.needsMoveChoice(id)) {
        if (!G.Items.canUse(id, p)) { yield* say("It won't have any effect."); return; }
        moveIndex = yield* G.Scenes.call(new G.SummaryScene([p], 0, { chooseMove: true }));
        if (moveIndex < 0) return;
      }
      const res = G.Items.applyMedicine(id, p, { moveIndex });
      if (res.ok) { g.bag.remove(id); G.Audio.sfx('useItem'); }
      yield* say(res.message);
      return;
    }
    // TMs & HMs
    if (/^(TM|HM)\d/.test(id) && it.move) {
      const mname = G.Data.moves[it.move].name;
      yield* say(`Booted up a ${id.slice(0, 2)}.\\nIt contained ${mname}.`);
      const r = yield* say(`Teach ${mname} to a POKéMON?`, { choices: ['YES', 'NO'], cancelIndex: 1 });
      if (r !== 0) return;
      const i = yield* G.Scenes.call(new G.PartyScene({ mode: 'tutor', move: it.move, help: 'Teach which POKéMON?' }));
      if (i < 0) return;
      const p = g.party[i];
      if (!p.canLearn(it.move)) { yield* say(`${p.name} and ${mname} are not compatible.`); return; }
      const learned = yield* G.Battle.learnMoveFlow(p, it.move, say, say);
      if (learned && id.startsWith('TM')) g.bag.remove(id);
      return;
    }
    switch (id) {
      case 'REPEL': case 'SUPERREPEL': case 'MAXREPEL':
        if (g.global.repel > 0) { yield* say("But the effects of a REPEL lingered from earlier."); return; }
        g.global.repel = G.Items.REPELS[id];
        g.bag.remove(id);
        G.Audio.sfx('repel');
        yield* say(`${G.Config.PLAYER_NAME} used the ${it.name}.`);
        return;
      case 'ESCAPEROPE': {
        // back to the entrance of the cave / dungeon
        const e = g.global.escapePoint;
        if (G.World.map.meta.Outdoor || !e) { yield* say("Can't use that here."); return; }
        g.bag.remove(id);
        g.global.escapePoint = null;
        G.MapScene.queue(function* () {
          yield* G.MapScene.messageBox.show(`${G.Config.PLAYER_NAME} used the ${it.name}.`);
          yield* G.MapScene.transferPlayer(e.map, e.x, e.y, e.dir, true);
        });
        return 'close';
      }
      case 'BICYCLE': {
        if (g.global.surfing || (!G.World.map.meta.Bicycle && !G.World.map.meta.Outdoor && !g.global.bicycle)) { yield* say("Can't use that here."); return; }
        g.global.bicycle = !g.global.bicycle;
        G.Audio.sfx('bicycle');
        G.Game.playerChar.refreshCharset();
        G.MapScene.autoplayBGM();
        if (!g.global.bicycle) { const m = G.World.map; if (m.data.bgm) G.Audio.playBGM(m.data.bgm); }
        return 'close';
      }
      case 'OLDROD': case 'GOODROD': case 'SUPERROD':
        G.MapScene.queue(function* () { yield* G.Field.fish(id); });
        return 'close';
      case 'TOWNMAP':
        yield* G.Scenes.call(new G.TownMapScene({ mode: 'view' }));
        return;
      case 'POKEFLUTE':
        for (const p of g.party) if (p.status === 'SLEEP') p.status = null;
        yield* say('Played the POKé FLUTE.\\nNow, that\'s a catchy tune!');
        return;
      case 'TEACASE': case 'TEA':
        yield* say('This is for a guard somewhere.');
        return;
    }
    yield* say(`${G.Config.PLAYER_NAME}'s mom's words echoed: "There's a time and place for everything, but not now."`);
  }
  // Used by SELECT (registered item) from the map.
  static *useInField(id) {
    const r = yield* G.BagScene.useItem(id, null);
    return r;
  }
};
