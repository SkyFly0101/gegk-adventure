// Shared menu scenes: nickname entry, controls help, Hall of Fame, credits,
// and the G.Menus helpers the story scripts call (PCs, marts, registered item).
'use strict';

// A scene that shows a framed list and returns the chosen index (or -1).
G.ListScene = class ListScene extends G.Scene {
  constructor(items, opts = {}) {
    super();
    this.transparent = true;
    this.win = new G.UI.CommandWindow(items, Object.assign({ x: 2, y: 2 }, opts));
    this.help = opts.help || null;
  }
  *main() { return yield* this.win.run(); }
  draw(ctx) {
    this.win.draw(ctx);
    if (this.help) { G.UI.frame(ctx, 2, 112, 236, 46, 'msg'); G.Font.draw(ctx, this.help, 10, 118); }
  }
};

// ---------------------------------------------------------------------------
// Nickname entry (FRLG-style character grid)
// ---------------------------------------------------------------------------
G.NameEntryScene = class NameEntryScene extends G.Scene {
  constructor({ title = 'Name?', max = 10, icon = null, initial = '' } = {}) {
    super();
    this.title = title; this.max = max; this.icon = icon;
    this.name = initial;
    this.pages = [
      ['ABCDEF .', 'GHIJKL ,', 'MNOPQRS ', 'TUVWXYZ '],
      ['abcdef .', 'ghijkl ,', 'mnopqrs ', 'tuvwxyz '],
      ['01234   ', '56789   ', '!?♂♀/-  ', '…“”‘’   '],
    ];
    this.page = 0; this.cx = 0; this.cy = 0;
  }
  *main() {
    if (this.icon) G.Assets.load(G.Assets.icon(this.icon));
    G.Input.clear();
    while (true) {
      yield;
      const rows = this.pages[this.page];
      const cols = 9; // 8 characters + side button column
      if (G.Input.repeat('LEFT')) { this.cx = (this.cx + cols - 1) % cols; G.Audio.sfx('cursor'); }
      if (G.Input.repeat('RIGHT')) { this.cx = (this.cx + 1) % cols; G.Audio.sfx('cursor'); }
      if (G.Input.repeat('UP')) { this.cy = (this.cy + 3) % 4; G.Audio.sfx('cursor'); }
      if (G.Input.repeat('DOWN')) { this.cy = (this.cy + 1) % 4; G.Audio.sfx('cursor'); }
      if (G.Input.trigger('SELECT')) { this.page = (this.page + 1) % 3; G.Audio.sfx('cursor'); }
      if (G.Input.trigger('START')) { this.cx = 8; this.cy = 3; }
      if (G.Input.trigger('B')) {
        if (this.name.length) { this.name = this.name.slice(0, -1); G.Audio.sfx('cancel'); }
        else { G.Audio.sfx('cancel'); return null; }
      }
      if (G.Input.trigger('A')) {
        if (this.cx === 8) {
          if (this.cy === 0) { this.page = (this.page + 1) % 3; G.Audio.sfx('select'); }
          else if (this.cy === 1) { this.name = this.name.slice(0, -1); G.Audio.sfx('cancel'); }
          else { G.Audio.sfx('select'); return this.name.trim() || null; }
        } else {
          const ch = rows[this.cy][this.cx];
          if (ch && ch !== ' ' || (ch === ' ' && this.cx === 6)) {
            if (this.name.length < this.max) { this.name += ch; G.Audio.sfx('cursor'); }
            else G.Audio.sfx('buzzer');
            if (this.name.length >= this.max) { this.cx = 8; this.cy = 3; }
          }
        }
      }
    }
  }
  draw(ctx) {
    ctx.fillStyle = '#88b8e8'; ctx.fillRect(0, 0, 240, 160);
    for (let i = 0; i < 160; i += 8) { ctx.fillStyle = '#80b0e0'; ctx.fillRect(0, i, 240, 4); }
    G.UI.frame(ctx, 4, 4, 232, 40, 'menu');
    const ic = this.icon && G.Assets.get(G.Assets.icon(this.icon));
    if (ic) ctx.drawImage(ic, 0, 0, ic.height, ic.height, 8, 6, ic.height, ic.height);
    G.Font.draw(ctx, this.title, 44, 8);
    let x = 60;
    for (let i = 0; i < this.max; i++) {
      const ch = this.name[i];
      if (ch) G.Font.draw(ctx, ch, x, 24);
      ctx.fillStyle = i === this.name.length ? '#e04030' : '#a0a0a0';
      ctx.fillRect(x, 38, 6, 1);
      x += 8;
    }
    G.UI.frame(ctx, 4, 48, 180, 96, 'menu');
    const rows = this.pages[this.page];
    rows.forEach((r, ry) => {
      for (let cx = 0; cx < 8; cx++) {
        const px = 16 + cx * 20, py = 54 + ry * 22;
        if (r[cx] && r[cx] !== ' ') G.Font.draw(ctx, r[cx], px, py);
        if (cx === this.cx && ry === this.cy) { ctx.strokeStyle = '#e04030'; ctx.strokeRect(px - 3.5, py - 1.5, 14, 16); }
      }
    });
    G.UI.frame(ctx, 188, 48, 48, 96, 'menu');
    ['PAGE', 'BACK', 'OK'].forEach((l, i) => {
      const y = 56 + i * 28;
      G.Font.draw(ctx, l, 212, y, 'dark', { align: 'center' });
      if (this.cx === 8 && (this.cy === i || (i === 2 && this.cy === 3))) { ctx.strokeStyle = '#e04030'; ctx.strokeRect(193.5, y - 2.5, 38, 18); }
    });
    G.Font.draw(ctx, 'SELECT: page   START: OK   X: delete', 120, 146, ['#203858', null], { align: 'center', font: 'small', shadow: false });
  }
};

// ---------------------------------------------------------------------------
// Controls help (shown from the Oak intro, the title screen, and pause)
// ---------------------------------------------------------------------------
G.ControlsHelpScene = class ControlsHelpScene extends G.Scene {
  *main() {
    G.Input.clear();
    while (!G.Input.trigger('A') && !G.Input.trigger('B') && !G.Input.trigger('START')) yield;
    G.Audio.sfx('select');
  }
  draw(ctx) {
    ctx.fillStyle = '#183048'; ctx.fillRect(0, 0, 240, 160);
    G.UI.frame(ctx, 8, 8, 224, 144, 'menu');
    G.Font.draw(ctx, 'CONTROLS', 120, 14, 'blue', { align: 'center' });
    const rows = [
      ['Arrow keys', 'Move / choose'],
      ['Z (or Space)', 'A button: talk, confirm'],
      ['X (or Esc)', 'B button: cancel, run (hold)'],
      ['Enter', 'START: open the menu'],
      ['Shift', 'SELECT: use registered item'],
      ['A / S', 'L / R buttons'],
      ['M', 'Mute / unmute sound'],
    ];
    rows.forEach(([k, v], i) => {
      G.Font.draw(ctx, k, 18, 30 + i * 14, 'red', { font: 'narrow' });
      G.Font.draw(ctx, v, 92, 30 + i * 14, 'dark', { font: 'narrow' });
    });
    G.Font.draw(ctx, 'Press Z to continue', 120, 134, 'gray', { align: 'center', font: 'small' });
  }
};

// ---------------------------------------------------------------------------
// Hall of Fame (after the Champion)
// ---------------------------------------------------------------------------
G.HallOfFameScene = class HallOfFameScene extends G.Scene {
  *main() {
    const g = G.Game;
    const team = g.party.filter((p) => !p.egg).map((p) => ({ species: p.species, name: p.name, level: p.level, shiny: p.shiny }));
    g.player.hallOfFame.push({ team, time: g.player.playTime, date: Date.now() });
    g.global.gameClear = true;
    G.Audio.playMusicKey('hallOfFame', true);
    let done = false;
    G.Assets.loadAll(team.map((t) => G.Assets.pokemon(t.species, false, t.shiny))).then(() => { done = true; });
    while (!done) yield;
    yield* G.Fade.in(0.4);
    for (this.i = 0; this.i < team.length; this.i++) {
      this.cur = team[this.i];
      G.Audio.cry(this.cur.species);
      yield* G.U.wait(2.2);
    }
    this.cur = null;
    this.all = team;
    this.msg = `Welcome to the HALL OF FAME!`;
    G.Input.clear();
    while (!G.Input.trigger('A')) yield;
    yield* G.Fade.out(0.6);
    G.Save.autosave('halloffame', true);
  }
  draw(ctx) {
    ctx.fillStyle = '#081828'; ctx.fillRect(0, 0, 240, 160);
    for (let i = 0; i < 30; i++) { ctx.fillStyle = `rgba(255,255,200,${(Math.sin(G.time * 3 + i) + 1) / 3})`; ctx.fillRect((i * 53) % 240, (i * 37) % 112, 1, 1); }
    if (this.cur) {
      const img = G.Assets.get(G.Assets.pokemon(this.cur.species, false, this.cur.shiny));
      if (img) ctx.drawImage(img, 120 - img.width / 2, 16);
      G.UI.frame(ctx, 20, 112, 200, 40, 'menu');
      G.Font.draw(ctx, `${this.cur.name}`, 120, 118, 'dark', { align: 'center' });
      G.Font.draw(ctx, `Lv${this.cur.level}   OT/${G.Config.PLAYER_NAME}`, 120, 134, 'dark', { align: 'center' });
    } else if (this.all) {
      this.all.forEach((t, i) => {
        const img = G.Assets.get(G.Assets.pokemon(t.species, false, t.shiny));
        if (img) ctx.drawImage(img, 0, 0, img.width, img.height, 8 + (i % 3) * 76, 4 + Math.floor(i / 3) * 52, 56, 56);
      });
      G.UI.frame(ctx, 2, 112, 236, 46, 'msg');
      G.Font.draw(ctx, this.msg, 120, 118, 'dark', { align: 'center' });
      G.Font.draw(ctx, `Congratulations, ${G.Config.PLAYER_NAME}!`, 120, 134, 'blue', { align: 'center' });
    }
  }
};

G.CreditsScene = class CreditsScene extends G.Scene {
  *main() {
    G.Audio.playMusicKey('credits', true);
    yield* G.Fade.in(0.5);
    this.lines = ['GEGK ADVENTURE', '', 'A fan game based on', 'Pokémon FireRed', '', 'Starring', G.Config.PLAYER_NAME, '', 'Rival', G.Config.RIVAL_NAME, '',
      'Story, maps & graphics:', 'Pokémon Essentials FRLG kit', '', 'Pokémon © Nintendo,', 'Game Freak, Creatures', '', 'Thanks for playing!'];
    this.y = 170;
    while (this.y > -this.lines.length * 16 - 10) { this.y -= G.dt * 18; if (G.Input.press('A')) this.y -= G.dt * 60; yield; }
    yield* G.Fade.out(0.6);
  }
  draw(ctx) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 240, 160);
    (this.lines || []).forEach((l, i) => G.Font.draw(ctx, l, 120, Math.round(this.y + i * 16), i === 0 ? 'red' : 'white', { align: 'center' }));
  }
};

// ---------------------------------------------------------------------------
// Helpers used by bridge.js
// ---------------------------------------------------------------------------
G.Menus = {
  *pokecenterPC() {
    const box = G.MapScene.messageBox;
    G.Audio.sfx('pcOn');
    yield* box.show(`${G.Config.PLAYER_NAME} booted up the PC.`);
    while (true) {
      const opts = [G.Game.switches.get(87) ? "BILL'S PC" : "SOMEONE'S PC",`${G.Config.PLAYER_NAME.toUpperCase()}'S PC`, "PROF. OAK'S PC", 'LOG OFF'];
      const r = yield* box.show('Which PC should be accessed?', { choices: opts, cancelIndex: 3 });
      if (r === 0) { G.Audio.sfx('pcAccess'); yield* G.Scenes.call(new G.PCScene()); }
      else if (r === 1) yield* this.itemStorage();
      else if (r === 2) yield* this.oakRating();
      else break;
    }
    G.Audio.sfx('pcOff');
  },
  *playerPC() {
    const box = G.MapScene.messageBox;
    G.Audio.sfx('pcOn');
    yield* box.show(`${G.Config.PLAYER_NAME} booted up the PC.`);
    yield* this.itemStorage();
    G.Audio.sfx('pcOff');
  },
  *itemStorage() {
    const box = G.MapScene.messageBox;
    const st = G.Game.storage.items;
    while (true) {
      const r = yield* box.show('What do you want to do?', { choices: ['WITHDRAW ITEM', 'DEPOSIT ITEM', 'TOSS ITEM', 'LOG OFF'], cancelIndex: 3 });
      if (r === 0) {
        const ids = Object.keys(st);
        if (!ids.length) { yield* box.show('There is nothing stored.'); continue; }
        const i = yield* G.Scenes.call(new G.ListScene(ids.map((id) => ({ label: G.Data.items[id].name, right: '×' + st[id] })).concat([{ label: 'CANCEL' }]), { cancelIndex: ids.length, visibleRows: 6, width: 150 }));
        if (i < 0 || i >= ids.length) continue;
        const id = ids[i];
        G.Game.bag.add(id, st[id]);
        yield* box.show(`Withdrew ${st[id]} ${G.Data.items[id].name}.`);
        delete st[id];
      } else if (r === 1) {
        const pick = yield* G.Scenes.call(new G.BagScene({ mode: 'choose' }));
        if (!pick) continue;
        const n = G.Game.bag.qty(pick.item);
        G.Game.bag.remove(pick.item, n);
        st[pick.item] = (st[pick.item] || 0) + n;
        yield* box.show(`${G.Data.items[pick.item].name} was stored via PC.`);
      } else if (r === 2) {
        const ids = Object.keys(st);
        if (!ids.length) { yield* box.show('There is nothing stored.'); continue; }
        const i = yield* G.Scenes.call(new G.ListScene(ids.map((id) => ({ label: G.Data.items[id].name, right: '×' + st[id] })).concat([{ label: 'CANCEL' }]), { cancelIndex: ids.length, visibleRows: 6, width: 150 }));
        if (i < 0 || i >= ids.length) continue;
        delete st[ids[i]];
        yield* box.show('Threw away the item.');
      } else break;
    }
  },
  *oakRating() {
    const box = G.MapScene.messageBox;
    const seen = G.Game.seenCount, owned = G.Game.ownedCount;
    yield* box.show(`\\bOak: POKéDEX evaluation...\\nSeen: ${seen}  Owned: ${owned}`);
    const lines = [[10, "You still have lots to do. Look for POKéMON in grassy areas!"], [20, "You're on the right track! Get a FLASH HM from my AIDE!"],
      [40, 'You need more POKéMON! Try to catch other species!'], [60, "Good, you're trying hard!"], [80, "You've caught a lot of POKéMON!"],
      [100, 'You finally got at least 100 species! I can\'t believe how good you are!'], [150, 'Thanks to you, the POKéDEX is nearly complete!'], [999, 'Your POKéDEX is entirely complete! Congratulations!']];
    yield* box.show('\\b' + lines.find(([n]) => owned < n)[1]);
  },
  *mart(stock, cantSell) {
    yield* G.Scenes.call(new G.MartScene(stock.filter((s) => G.Data.items[s]), { cantSell }));
  },
  *useRegisteredItem() {
    const id = G.Game.bag.registered;
    if (!id || !G.Game.bag.has(id)) { yield* G.MapScene.messageBox.show('An item in the BAG can be registered to SELECT for easy use.'); return; }
    yield* G.BagScene.useInField(id);
  },
};
