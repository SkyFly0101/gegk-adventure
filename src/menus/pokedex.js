// Kanto POKéDEX: list of all 151 with seen/owned marks, and entry pages.
'use strict';

G.PokedexScene = class PokedexScene extends G.Scene {
  constructor() {
    super();
    this.list = Object.values(G.Data.pokemon).sort((a, b) => a.dex - b.dex);
    // Only show up to the highest number seen (like FRLG's numerical mode)
    const seen = G.Game.player.seen;
    const maxSeen = Math.max(1, ...this.list.filter((s) => seen[s.id]).map((s) => s.dex));
    this.list = this.list.filter((s) => s.dex <= maxSeen);
    this.index = G.PokedexScene.lastIndex || 0;
    if (this.index >= this.list.length) this.index = 0;
  }
  *main() {
    G.Audio.sfx('pokedexOpen');
    G.Input.clear();
    while (true) {
      yield;
      const n = this.list.length;
      if (G.Input.repeat('DOWN')) { this.index = Math.min(n - 1, this.index + 1); G.Audio.sfx('cursor'); }
      if (G.Input.repeat('UP')) { this.index = Math.max(0, this.index - 1); G.Audio.sfx('cursor'); }
      if (G.Input.repeat('RIGHT')) { this.index = Math.min(n - 1, this.index + 8); G.Audio.sfx('cursor'); }
      if (G.Input.repeat('LEFT')) { this.index = Math.max(0, this.index - 8); G.Audio.sfx('cursor'); }
      G.PokedexScene.lastIndex = this.index;
      const sp = this.list[this.index];
      if (sp) G.Assets.load(G.Assets.pokemon(sp.id, false, false));
      if (G.Input.trigger('A') && G.Game.player.seen[sp.id]) {
        G.Audio.sfx('select');
        yield* G.Scenes.call(new G.PokedexEntryScene(sp.id));
      }
      if (G.Input.trigger('B')) { G.Audio.sfx('cancel'); return; }
    }
  }
  draw(ctx) {
    const g = G.Game;
    ctx.fillStyle = '#d03028'; ctx.fillRect(0, 0, 240, 160);
    ctx.fillStyle = '#f0e8d8'; ctx.fillRect(4, 18, 232, 138);
    G.Font.draw(ctx, 'POKéDEX', 6, 2, 'white');
    G.Font.draw(ctx, `SEEN ${g.seenCount}   OWN ${g.ownedCount}`, 234, 2, 'white', { align: 'right', font: 'narrow' });
    const rows = 8;
    const top = G.U.clamp(this.index - 3, 0, Math.max(0, this.list.length - rows));
    for (let r = 0; r < rows; r++) {
      const sp = this.list[top + r];
      if (!sp) break;
      const y = 22 + r * 16;
      const seen = g.player.seen[sp.id], own = g.player.owned[sp.id];
      if (top + r === this.index) { ctx.fillStyle = '#f8c8a0'; ctx.fillRect(8, y - 1, 120, 15); }
      G.Font.draw(ctx, `No${String(sp.dex).padStart(3, '0')}`, 12, y, 'dark', { font: 'narrow' });
      if (own) G.UI.pixelBall(ctx, 48, y + 4);
      G.Font.draw(ctx, seen ? sp.name.toUpperCase() : '----------', 58, y, 'dark', { font: 'narrow' });
    }
    const sp = this.list[this.index];
    ctx.fillStyle = '#f8f8f8'; ctx.fillRect(134, 26, 96, 96);
    if (sp && g.player.seen[sp.id]) {
      const img = G.Assets.get(G.Assets.pokemon(sp.id, false, false));
      if (img) {
        if (g.player.owned[sp.id]) ctx.drawImage(img, 182 - img.width / 2, 74 - img.height / 2);
        else { // silhouette for seen-only
          const c = G.Screen.scratch(img.width, img.height); const cx = c.getContext('2d');
          cx.clearRect(0, 0, c.width, c.height); cx.drawImage(img, 0, 0); cx.globalCompositeOperation = 'source-in'; cx.fillStyle = '#404040'; cx.fillRect(0, 0, img.width, img.height); cx.globalCompositeOperation = 'source-over';
          ctx.drawImage(c, 0, 0, img.width, img.height, 182 - img.width / 2, 74 - img.height / 2, img.width, img.height);
        }
      }
    }
    G.Font.draw(ctx, 'A: entry   B: close', 182, 132, 'dark', { align: 'center', font: 'small' });
  }
};

G.PokedexEntryScene = class PokedexEntryScene extends G.Scene {
  constructor(species, opts = {}) { super(); this.sp = G.Data.pokemon[species]; this.opts = opts; }
  *main() {
    G.Assets.load(G.Assets.pokemon(this.sp.id, false, false));
    G.Audio.cry(this.sp.id);
    G.Input.clear();
    while (!G.Input.trigger('A') && !G.Input.trigger('B')) yield;
    G.Audio.sfx('cancel');
  }
  draw(ctx) {
    const sp = this.sp, own = G.Game.player.owned[sp.id];
    ctx.fillStyle = '#d03028'; ctx.fillRect(0, 0, 240, 160);
    ctx.fillStyle = '#f0e8d8'; ctx.fillRect(4, 4, 232, 152);
    const img = G.Assets.get(G.Assets.pokemon(sp.id, false, false));
    ctx.fillStyle = '#f8f8f8'; ctx.fillRect(10, 10, 84, 76);
    if (img) ctx.drawImage(img, 52 - img.width / 2, 48 - img.height / 2);
    G.Font.draw(ctx, `No${String(sp.dex).padStart(3, '0')}  ${sp.name.toUpperCase()}`, 102, 12, 'dark');
    G.Font.draw(ctx, own ? `${(sp.category || '').toUpperCase()} POKéMON` : '????? POKéMON', 102, 30, 'dark', { font: 'narrow' });
    const totalIn = Math.round(sp.height * 39.3701);
    G.Font.draw(ctx, `HT  ${own ? `${Math.floor(totalIn / 12)}'${String(totalIn % 12).padStart(2, '0')}"` : "?'??\""}`, 102, 48, 'dark', { font: 'narrow' });
    G.Font.draw(ctx, `WT  ${own ? (sp.weight * 2.20462).toFixed(1) + ' lbs.' : '????.? lbs.'}`, 102, 64, 'dark', { font: 'narrow' });
    sp.types.forEach((t, i) => G.UI.typeIcon(ctx, t, 168 + i * 34, 82));
    if (own) {
      const lines = G.MessageBox.layout(G.MessageBox.parse(sp.pokedex || '').tokens, 216);
      lines.slice(0, 4).forEach((l, i) => G.Font.draw(ctx, l.map((t) => t.ch || '').join(''), 12, 98 + i * 14, 'dark', { font: 'narrow' }));
    }
  }
};
