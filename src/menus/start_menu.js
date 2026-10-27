// The FRLG Start menu and the in-game Save flow.
'use strict';

G.StartMenuScene = class StartMenuScene extends G.Scene {
  constructor() {
    super();
    this.transparent = true;
    this.index = G.StartMenuScene.lastIndex || 0;
  }
  items() {
    const g = G.Game;
    const out = [];
    if (g.player.hasPokedex) out.push({ id: 'dex', label: 'POKéDEX', help: 'A device that records POKéMON secrets upon meeting or catching them.' });
    if (g.party.length) out.push({ id: 'party', label: 'POKéMON', help: 'Check and organize POKéMON that are traveling with you in your party.' });
    out.push({ id: 'bag', label: 'BAG', help: 'Equipped with pockets for storing items you bought, received, or found.' });
    out.push({ id: 'card', label: G.Config.PLAYER_NAME.toUpperCase(), help: "Check your money and other game data." });
    out.push({ id: 'save', label: 'SAVE', help: 'Save your game with a complete record of your progress to take a break.' });
    out.push({ id: 'option', label: 'OPTION', help: 'Adjust various game settings such as text speed, game rules, etc.' });
    out.push({ id: 'exit', label: 'EXIT', help: 'Close this MENU window.' });
    return out;
  }
  *main() {
    G.Game.inMenu = true;
    try {
      while (true) {
        const items = this.items();
        this.win = new G.UI.CommandWindow(items, { x: G.Config.WIDTH - 2, y: 2, align: 'right', width: 76, index: Math.min(this.index, items.length - 1), cancelIndex: items.length - 1 });
        this.list = items;
        const r = yield* this.runWin();
        if (r < 0) return;
        this.index = G.StartMenuScene.lastIndex = r;
        const id = items[r].id;
        this.win = null;
        if (id === 'exit') return;
        if (id === 'dex') yield* this.open(new G.PokedexScene());
        else if (id === 'party') { const res = yield* this.open(new G.PartyScene({ mode: 'menu' })); if (res && res.close) return; }
        else if (id === 'bag') { const res = yield* this.open(new G.BagScene({ mode: 'field' })); if (res && res.close) return; }
        else if (id === 'card') yield* this.open(new G.TrainerCardScene());
        else if (id === 'option') yield* this.open(new G.OptionsScene());
        else if (id === 'save') { const saved = yield* G.SaveFlow.run(); if (saved) return; }
      }
    } finally {
      G.Game.inMenu = false;
    }
  }
  *runWin() {
    G.Input.clear();
    while (this.win.result === undefined) {
      yield;
      this.win.update();
      if (G.Input.trigger('START')) { G.Audio.sfx('menuClose'); return -1; }
    }
    return this.win.result;
  }
  *open(scene) {
    const r = yield* G.Scenes.call(scene);
    G.Input.clear();
    return r;
  }
  draw(ctx) {
    if (!this.win) return;
    this.win.draw(ctx);
    const it = this.list[this.win.index];
    if (it && it.help) {
      ctx.fillStyle = 'rgba(32,48,64,0.92)';
      ctx.fillRect(0, 128, 240, 32);
      const { tokens } = G.MessageBox.parse(it.help);
      G.MessageBox.layout(tokens, 228).slice(0, 2).forEach((line, i) => G.Font.draw(ctx, line.map((t) => t.ch || '').join(''), 6, 129 + i * 14, 'white'));
    }
  }
};

// FRLG save dialogue with a slot picker (3 manual slots).
G.SaveFlow = {
  *run() {
    const box = G.MapScene.messageBox;
    const scene = G.MapScene;
    scene.overlay = { draw: (ctx) => G.SaveFlow.drawInfo(ctx) };
    try {
      const r = yield* box.show('Would you like to save the game?', { choices: ['YES', 'NO'], cancelIndex: 1 });
      if (r !== 0) return false;
      const slots = ['1', '2', '3'].map((s) => {
        const sum = G.Save.summary(G.Save.read(s));
        return { label: `SLOT ${s}`, right: sum ? `${sum.name} ${G.U.formatTime(sum.time)}` : '(empty)', slot: s };
      });
      const def = Math.max(0, ['1', '2', '3'].indexOf(G.Game.global.lastSaveSlot || '1'));
      const pick = yield* box.show('Save to which slot?', { choices: slots.map((s) => ({ label: s.label, right: s.right })).concat(['CANCEL']), cancelIndex: 3, defaultIndex: def });
      if (pick < 0 || pick > 2) return false;
      const slot = slots[pick].slot;
      if (G.Save.exists(slot)) {
        const ok = yield* box.show('There is already a saved file. Is it okay to overwrite it?', { choices: ['YES', 'NO'], cancelIndex: 1 });
        if (ok !== 0) return false;
      }
      G.MapScene.messageBox.active = false;
      const w = box.show("SAVING... DON'T TURN OFF THE POWER.", { keepOpen: true });
      yield* w;
      const ok = G.Save.save(slot);
      G.Audio.playME(null, 'save');
      yield* G.U.wait(0.6);
      yield* box.show(ok ? `${G.Config.PLAYER_NAME} saved the game in SLOT ${slot}.` : 'Save failed! Your browser may be blocking storage.');
      return ok;
    } finally {
      scene.overlay = null;
    }
  },
  drawInfo(ctx) {
    const g = G.Game;
    G.UI.frame(ctx, 2, 2, 120, 72, 'menu');
    const rows = [['PLAYER', g.player.name], ['BADGES', String(g.badgeCount)], ['POKéDEX', String(g.ownedCount)], ['TIME', G.U.formatTime(g.player.playTime)]];
    G.Font.draw(ctx, G.World.map.name, 62, 6, 'blue', { align: 'center', font: 'narrow' });
    rows.forEach(([k, v], i) => {
      G.Font.draw(ctx, k, 10, 21 + i * 13, 'dark', { font: 'narrow' });
      G.Font.draw(ctx, v, 114, 21 + i * 13, 'dark', { align: 'right', font: 'narrow' });
    });
  },
};
