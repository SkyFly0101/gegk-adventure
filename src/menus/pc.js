// Pokémon Storage System ("SOMEONE'S PC" / BILL'S PC): boxes, withdraw,
// deposit, move, release.
'use strict';

G.PCScene = class PCScene extends G.Scene {
  constructor() {
    super();
    this.st = G.Game.storage;
    this.mode = null;
    this.msg = new G.MessageBox();
    this.cx = 0; this.cy = 0;  // cursor in box grid (6x5); cy = -1 is the box name
    this.held = null;           // {pkmn, from:'box'|'party'}
  }
  *main() {
    while (true) {
      const r = yield* this.ask('What would you like to do?', ['WITHDRAW POKéMON', 'DEPOSIT POKéMON', 'MOVE POKéMON', 'SEE YA!']);
      if (r < 0 || r === 3) return;
      if (r === 0) yield* this.boxMode('withdraw');
      if (r === 1) yield* this.depositMode();
      if (r === 2) yield* this.boxMode('move');
    }
  }
  *ask(text, choices) {
    return yield* this.msg.show(text, { choices, cancelIndex: choices.length - 1 });
  }
  loadIcons() { for (const b of this.st.boxes) for (const m of b.mons) if (m) G.Assets.load(G.Assets.icon(m.species)); for (const m of G.Game.party) G.Assets.load(G.Assets.icon(m.species)); }
  get box() { return this.st.boxes[this.st.current]; }

  *depositMode() {
    while (true) {
      const i = yield* G.Scenes.call(new G.PartyScene({ mode: 'choose', help: 'Deposit which POKéMON?' }));
      if (i < 0) return;
      const party = G.Game.party;
      if (party.filter((p) => p.hp > 0).length <= 1 && party[i].hp > 0) { yield* this.msg.show("That's your last POKéMON!"); continue; }
      const p = party[i];
      const slot = this.box.mons.indexOf(null);
      const bi = slot >= 0 ? this.st.current : this.st.boxes.findIndex((b) => b.mons.includes(null));
      if (bi < 0) { yield* this.msg.show('The boxes are full.'); return; }
      const b = this.st.boxes[bi];
      b.mons[b.mons.indexOf(null)] = p;
      party.splice(i, 1);
      yield* this.msg.show(`${p.name} was stored in ${b.name}.`);
    }
  }
  *boxMode(mode) {
    this.mode = mode;
    this.loadIcons();
    G.Input.clear();
    while (true) {
      yield;
      if (this.msg.active) continue;
      if (G.Input.repeat('LEFT')) { if (this.cy < 0) this.st.current = (this.st.current + this.st.boxes.length - 1) % this.st.boxes.length; else this.cx = (this.cx + 5) % 6; G.Audio.sfx('cursor'); }
      if (G.Input.repeat('RIGHT')) { if (this.cy < 0) this.st.current = (this.st.current + 1) % this.st.boxes.length; else this.cx = (this.cx + 1) % 6; G.Audio.sfx('cursor'); }
      if (G.Input.repeat('UP')) { this.cy = this.cy <= -1 ? 4 : this.cy - 1; G.Audio.sfx('cursor'); }
      if (G.Input.repeat('DOWN')) { this.cy = this.cy >= 4 ? -1 : this.cy + 1; G.Audio.sfx('cursor'); }
      if (G.Input.trigger('L')) { this.st.current = (this.st.current + this.st.boxes.length - 1) % this.st.boxes.length; G.Audio.sfx('cursor'); }
      if (G.Input.trigger('R')) { this.st.current = (this.st.current + 1) % this.st.boxes.length; G.Audio.sfx('cursor'); }
      if (G.Input.trigger('B')) {
        if (this.held) { G.Audio.sfx('buzzer'); yield* this.msg.show("You're holding a POKéMON!"); continue; }
        G.Audio.sfx('cancel'); this.mode = null; return;
      }
      if (!G.Input.trigger('A') || this.cy < 0) continue;
      const i = this.cy * 6 + this.cx;
      const p = this.box.mons[i];
      if (this.held) {
        this.box.mons[i] = this.held; this.held = p || null;
        G.Audio.sfx('select');
        continue;
      }
      if (!p) continue;
      G.Audio.sfx('select');
      const opts = mode === 'withdraw' ? ['WITHDRAW', 'SUMMARY', 'RELEASE', 'CANCEL'] : ['MOVE', 'SUMMARY', 'RELEASE', 'CANCEL'];
      const r = yield* this.ask(`${p.name} is selected.`, opts);
      if (r === 0 && mode === 'withdraw') {
        if (G.Game.party.length >= 6) { yield* this.msg.show('Your party is full!'); continue; }
        G.Game.party.push(p); this.box.mons[i] = null;
        yield* this.msg.show(`${p.name} was taken out of the BOX.`);
      } else if (r === 0) { this.held = p; this.box.mons[i] = null; G.Audio.sfx('select'); }
      else if (r === 1) yield* G.Scenes.call(new G.SummaryScene([p], 0));
      else if (r === 2) {
        const ok = yield* this.ask(`Release ${p.name}?`, ['YES', 'NO']);
        if (ok === 0) { this.box.mons[i] = null; yield* this.msg.show(`${p.name} was released outside.\\nBye-bye, ${p.name}!`); }
      }
    }
  }
  draw(ctx) {
    ctx.fillStyle = '#7898c8'; ctx.fillRect(0, 0, 240, 160);
    if (this.mode) {
      const b = this.box;
      G.UI.frame(ctx, 40, 4, 160, 20, this.cy < 0 ? 'msg' : 'menu');
      G.Font.draw(ctx, `◀ ${b.name} ▶`, 120, 7, 'dark', { align: 'center' });
      ctx.fillStyle = '#a8c8a0'; ctx.fillRect(28, 28, 184, 116);
      for (let i = 0; i < 30; i++) {
        const x = 32 + (i % 6) * 30, y = 30 + Math.floor(i / 6) * 22;
        const m = b.mons[i];
        if (m) { const ic = G.Assets.get(G.Assets.icon(m.species)); if (ic) ctx.drawImage(ic, 0, 0, ic.height, ic.height, x - 2, y - 8, ic.height, ic.height); }
        if (this.cy >= 0 && i === this.cy * 6 + this.cx) {
          ctx.strokeStyle = '#e04030'; ctx.strokeRect(x - 1.5, y - 1.5, 28, 22);
          if (this.held) { const ic = G.Assets.get(G.Assets.icon(this.held.species)); if (ic) ctx.drawImage(ic, 0, 0, ic.height, ic.height, x - 2, y - 22, ic.height, ic.height); }
        }
      }
      const sel = this.cy >= 0 ? b.mons[this.cy * 6 + this.cx] : null;
      G.Font.draw(ctx, sel ? `${sel.name}  Lv${sel.level}` : '', 120, 146, 'white', { align: 'center' });
    } else {
      G.Font.draw(ctx, "POKéMON STORAGE SYSTEM", 120, 30, 'white', { align: 'center' });
    }
    this.msg.draw(ctx);
  }
};
