// Pokémon summary: INFO / SKILLS / MOVES pages. With {chooseMove:true}
// it returns the index of a chosen move (used when forgetting a move).
'use strict';

G.SummaryScene = class SummaryScene extends G.Scene {
  constructor(list, index = 0, opts = {}) {
    super();
    this.list = list; this.index = index; this.opts = opts;
    this.page = opts.chooseMove ? 2 : 0;
    this.moveCursor = 0;
    this.swapFrom = -1;
  }
  get p() { return this.list[this.index]; }
  *main() {
    const load = () => G.Assets.load(G.Assets.pokemon(this.p.species, false, this.p.shiny));
    load();
    G.Input.clear();
    let inMoves = !!this.opts.chooseMove;
    while (true) {
      yield;
      if (inMoves) {
        const n = this.p.moves.length + (this.opts.newMove ? 1 : 0);
        if (G.Input.repeat('DOWN')) { this.moveCursor = (this.moveCursor + 1) % n; G.Audio.sfx('cursor'); }
        if (G.Input.repeat('UP')) { this.moveCursor = (this.moveCursor + n - 1) % n; G.Audio.sfx('cursor'); }
        if (G.Input.trigger('A')) {
          G.Audio.sfx('select');
          if (this.opts.chooseMove) return this.moveCursor < this.p.moves.length ? this.moveCursor : -1;
          if (this.swapFrom < 0) this.swapFrom = this.moveCursor;
          else {
            const m = this.p.moves;
            [m[this.swapFrom], m[this.moveCursor]] = [m[this.moveCursor], m[this.swapFrom]];
            this.swapFrom = -1;
          }
        }
        if (G.Input.trigger('B')) {
          G.Audio.sfx('cancel');
          if (this.opts.chooseMove) return -1;
          if (this.swapFrom >= 0) this.swapFrom = -1; else inMoves = false;
        }
        continue;
      }
      if (G.Input.repeat('RIGHT') && this.page < 2) { this.page++; G.Audio.sfx('summaryPage'); }
      if (G.Input.repeat('LEFT') && this.page > 0) { this.page--; G.Audio.sfx('summaryPage'); }
      if (G.Input.repeat('DOWN') && this.index < this.list.length - 1) { this.index++; load(); G.Audio.cry(this.p.species); }
      if (G.Input.repeat('UP') && this.index > 0) { this.index--; load(); G.Audio.cry(this.p.species); }
      if (G.Input.trigger('A') && this.page === 2) { G.Audio.sfx('select'); inMoves = true; this.moveCursor = 0; }
      if (G.Input.trigger('B')) { G.Audio.sfx('cancel'); return this.index; }
    }
  }
  draw(ctx) {
    const p = this.p;
    ctx.fillStyle = '#f8f0d0'; ctx.fillRect(0, 0, 240, 160);
    const tabs = ['POKéMON INFO', 'POKéMON SKILLS', 'KNOWN MOVES'];
    ctx.fillStyle = ['#e07040', '#40a060', '#4070d0'][this.page];
    ctx.fillRect(0, 0, 240, 16);
    G.Font.draw(ctx, tabs[this.page], 6, 1, 'white');
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i === this.page ? '#f8f8f8' : '#a0a0a0'; ctx.fillRect(200 + i * 12, 6, 8, 4); }
    // Left panel: sprite and name
    ctx.fillStyle = '#d8e8f8'; ctx.fillRect(0, 16, 96, 144);
    const img = G.Assets.get(G.Assets.pokemon(p.species, false, p.shiny));
    if (img) ctx.drawImage(img, 48 - img.width / 2, 34);
    G.Font.draw(ctx, `Lv${p.level}`, 4, 19, 'dark');
    // long names (CHARMANDER, BUTTERFREE) switch to the narrow font so the
    // gender sign still fits inside the panel
    const nf = G.Font.width(p.name) > 50 ? 'narrow' : 'normal';
    G.Font.draw(ctx, p.name, 32, 19, 'dark', { font: nf });
    if (p.gender) G.Font.draw(ctx, p.gender === 'M' ? '♂' : '♀', Math.min(88, 33 + G.Font.width(p.name, nf)), 19, p.gender === 'M' ? 'blue' : 'red');
    if (p.status) G.Font.draw(ctx, G.STATUS_NAMES[p.status], 6, 112, 'red');
    if (p.item) { G.Font.draw(ctx, 'ITEM', 4, 126, 'dark', { font: 'small' }); G.Font.draw(ctx, G.Data.items[p.item].name, 4, 140, 'dark', { font: 'narrow' }); }
    const x0 = 102;
    if (this.page === 0) {
      const d = p.data;
      const rows = [['No.', String(d.dex).padStart(3, '0')], ['NAME', p.speciesName], ['TYPE', ''], ['OT', p.ot], ['IDNo.', String(p.otId).padStart(5, '0')], ['ITEM', p.item ? G.Data.items[p.item].name : 'NONE']];
      rows.forEach(([k, v], i) => {
        G.Font.draw(ctx, k, x0, 20 + i * 15, 'dark', { font: 'narrow' });
        if (k === 'TYPE') p.types.forEach((t, j) => G.UI.typeIcon(ctx, t, x0 + 46 + j * 34, 21 + i * 15));
        else G.Font.draw(ctx, v, x0 + 46, 20 + i * 15, 'dark');
      });
      // FireRed's trainer memo: "GENTLE nature." / "Met at Lv5," / "PLACE."
      G.UI.frame(ctx, 98, 109, 140, 49, 'menu');
      const met = (G.Data.mapName(p.obtainMap) || 'a faraway place').toUpperCase().replace(/É/g, 'é');
      [`${p.nature} nature.`, `Met at Lv${p.obtainLevel},`, `${met}.`].forEach((l, i) => G.Font.draw(ctx, l, 104, 111 + i * 12, 'dark', { font: 'narrow' }));
    } else if (this.page === 1) {
      G.UI.hpBar(ctx, x0, 24, 64, p.hp / p.totalHP);
      G.Font.draw(ctx, `${p.hp}/${p.totalHP}`, 236, 19, 'dark', { align: 'right' });
      const rows = [['ATTACK', 'ATTACK'], ['DEFENSE', 'DEFENSE'], ['SP. ATK', 'SPECIAL_ATTACK'], ['SP. DEF', 'SPECIAL_DEFENSE'], ['SPEED', 'SPEED']];
      const nat = G.NATURES[p.nature] || [];
      rows.forEach(([l, k], i) => {
        const col = nat[0] === k && nat[1] !== k ? 'red' : nat[1] === k && nat[0] !== k ? 'blue' : 'dark';
        G.Font.draw(ctx, l, x0, 32 + i * 12, col, { font: 'narrow' });
        G.Font.draw(ctx, String(p.stats[k]), 236, 32 + i * 12, 'dark', { align: 'right' });
      });
      G.Font.draw(ctx, 'EXP. POINTS', x0, 92, 'dark', { font: 'narrow' });
      G.Font.draw(ctx, String(p.exp), 236, 92, 'dark', { align: 'right' });
      G.Font.draw(ctx, 'NEXT LV.', x0, 104, 'dark', { font: 'narrow' });
      G.Font.draw(ctx, String(p.expToNext()), 236, 104, 'dark', { align: 'right' });
      G.UI.expBar(ctx, x0 + 40, 119, 92, p.expFraction());
      // ability name and what it does (FireRed shows both)
      const ab = p.ability && G.Data.abilities[p.ability];
      if (ab) {
        G.Font.draw(ctx, ab.name.toUpperCase(), x0, 126, 'blue', { font: 'narrow' });
        let desc = ab.description || '';
        // two narrow lines, like FireRed's ability box
        G.MessageBox.layout(G.MessageBox.parse(desc).tokens, 134).slice(0, 2)
          .forEach((l, i) => G.Font.draw(ctx, l.map((t) => t.ch || '').join(''), x0, 138 + i * 10, 'dark', { font: 'small' }));
      }
    } else {
      const moves = p.moves.slice();
      if (this.opts.newMove) moves.push({ id: this.opts.newMove, pp: G.Data.moves[this.opts.newMove].pp, ppUps: 0, isNew: true });
      moves.forEach((m, i) => {
        const md = G.Data.moves[m.id];
        const y = 20 + i * 24;
        if (i === this.moveCursor) { ctx.fillStyle = '#f8d8a0'; ctx.fillRect(x0 - 4, y - 2, 140, 22); }
        if (i === this.swapFrom) { ctx.fillStyle = '#f0a070'; ctx.fillRect(x0 - 4, y - 2, 140, 22); }
        G.UI.typeIcon(ctx, md.type, x0, y + 1);
        G.Font.draw(ctx, md.name.toUpperCase(), x0 + 36, y - 1, m.isNew ? 'blue' : 'dark', { font: 'narrow' });
        G.Font.draw(ctx, `PP ${m.isNew ? md.pp : m.pp}/${m.isNew ? md.pp : G.Pokemon.maxPP(m)}`, 236, y + 9, 'dark', { align: 'right', font: 'small' });
      });
      const sel = moves[this.moveCursor];
      if (sel) {
        const md = G.Data.moves[sel.id];
        ctx.fillStyle = '#f8f8f8'; ctx.fillRect(0, 118, 96, 42);
        G.Font.draw(ctx, `POWER ${md.power > 1 ? md.power : '---'}`, 4, 118, 'dark', { font: 'small' });
        G.Font.draw(ctx, `ACCURACY ${md.accuracy || '---'}`, 4, 132, 'dark', { font: 'small' });
        G.UI.frame(ctx, 98, 116, 140, 43, 'menu');
        G.MessageBox.layout(G.MessageBox.parse(md.description || '').tokens, 128).slice(0, 3).forEach((l, i) => G.Font.draw(ctx, l.map((t) => t.ch || '').join(''), 104, 117 + i * 12, 'dark', { font: 'narrow' }));
      }
      if (this.opts.chooseMove) G.Font.draw(ctx, 'Forget which move?', 120, 3, 'white', { align: 'center' });
    }
  }
};
